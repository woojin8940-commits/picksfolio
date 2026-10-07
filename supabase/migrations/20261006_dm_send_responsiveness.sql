BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 버튼 클릭(postback)·받은 DM 도 댓글처럼 대기열에서 처리한다.
--
-- 예전에는 웹훅 요청 안에서 곧바로 발송까지 마쳤다. Meta 는 웹훅에 5초 안에 응답하길
-- 기대하고 함수에는 실행 시간 한도가 있어서, 본 메시지가 여러 통이면 응답이 늦어지거나
-- 함수가 중간에 끊겼다. 끊긴 클릭은 "이미 보냄" 표시만 남고 나머지 통이 나가지 않았다.
ALTER TABLE public.dm_jobs DROP CONSTRAINT IF EXISTS dm_jobs_job_type_check;
ALTER TABLE public.dm_jobs ADD CONSTRAINT dm_jobs_job_type_check
  CHECK (job_type IN ('comment_event', 'scheduled', 'message_event'));

-- 발송 예약.
--
-- 다른 발송이 진행 중이면(send_lease_until) 예전에는 임대가 끝나는 30초 뒤에 다시 오라고
-- 답했다. 임대는 발송이 중간에 죽었을 때의 안전장치일 뿐이고, 정상 발송은 1초 안팎에
-- 끝나면서 임대를 바로 푼다. 그래서 두 발송이 겹칠 때마다 뒤쪽이 30초씩 밀렸고, 버튼을
-- 누른 사람에게는 본 메시지가 한참 뒤에 도착했다. 진행 중인 발송은 짧게 다시 확인한다.
CREATE OR REPLACE FUNCTION public.dm_reserve_send(p_account text, p_bucket text, p_hour_limit integer, p_spacing_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.dm_worker_accounts; next_at timestamptz; wait_until timestamptz; oldest timestamptz; used integer; token uuid;
BEGIN
  IF p_account IS NULL OR p_account = '' OR p_bucket NOT IN ('private_reply', 'direct', 'public_reply') THEN RAISE EXCEPTION 'Invalid send account or bucket'; END IF;
  INSERT INTO public.dm_worker_accounts(ig_account_id) VALUES(p_account) ON CONFLICT DO NOTHING;
  SELECT * INTO a FROM public.dm_worker_accounts WHERE ig_account_id = p_account FOR UPDATE;
  INSERT INTO public.dm_send_buckets(ig_account_id, bucket) VALUES(p_account, p_bucket) ON CONFLICT DO NOTHING;
  SELECT b.next_at INTO next_at FROM public.dm_send_buckets b WHERE b.ig_account_id = p_account AND b.bucket = p_bucket;
  IF a.cooldown_until IS NOT NULL AND a.cooldown_until > now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'cooldown',
      'retryAfterMs', CEIL(EXTRACT(epoch FROM (a.cooldown_until - now())) * 1000));
  END IF;
  IF a.send_lease_until IS NOT NULL AND a.send_lease_until > now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'busy',
      'retryAfterMs', LEAST(250, CEIL(EXTRACT(epoch FROM (a.send_lease_until - now())) * 1000)));
  END IF;
  wait_until := GREATEST(a.next_send_at, next_at);
  IF wait_until > now() THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'spacing',
      'retryAfterMs', CEIL(EXTRACT(epoch FROM (wait_until - now())) * 1000));
  END IF;
  SELECT count(*), min(created_at) INTO used, oldest FROM public.dm_send_attempts
    WHERE ig_account_id = p_account AND bucket = p_bucket AND created_at > now() - interval '1 hour';
  IF used >= LEAST(GREATEST(p_hour_limit, 1), 100000) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'hourly',
      'retryAfterMs', CEIL(EXTRACT(epoch FROM (oldest + interval '1 hour' - now())) * 1000) + 100);
  END IF;
  token := gen_random_uuid();
  UPDATE public.dm_worker_accounts SET send_token = token, send_lease_until = now() + interval '30 seconds', next_send_at = now() + interval '400 milliseconds' WHERE ig_account_id = p_account;
  UPDATE public.dm_send_buckets SET next_at = now() + LEAST(GREATEST(p_spacing_ms, 400), 3600000) * interval '1 millisecond' WHERE ig_account_id = p_account AND bucket = p_bucket;
  INSERT INTO public.dm_send_attempts(id, ig_account_id, bucket) VALUES(token, p_account, p_bucket);
  RETURN jsonb_build_object('allowed', true, 'token', token);
END;
$$;

-- 계정 작업자가 다음에 처리할 작업.
--
-- 사람이 지금 대화창에서 기다리는 작업(버튼 클릭·받은 DM, 이미 시작한 대화의 나머지
-- 통)을 새 댓글보다 먼저 처리한다. 댓글이 몰릴 때 버튼을 누른 사람이 그 뒤에 줄을 서면
-- "눌렀는데 아무 일도 없다"가 된다. 그 밖의 순서는 예전과 같다.
CREATE OR REPLACE FUNCTION public.dm_claim_account_job(p_account text, p_token uuid)
RETURNS SETOF public.dm_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.dm_worker_accounts WHERE ig_account_id = p_account AND worker_token = p_token
    AND lease_until > now() AND (cooldown_until IS NULL OR cooldown_until <= now()) FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.dm_jobs WHERE ig_account_id = p_account AND status = 'processing' AND lease_expires_at > now()) THEN RETURN; END IF;
  RETURN QUERY WITH due AS MATERIALIZED (
    SELECT q.id FROM public.dm_jobs q WHERE q.ig_account_id = p_account
      AND ((q.status = 'pending' AND q.due_at <= now()) OR (q.status = 'processing' AND q.lease_expires_at <= now()))
    ORDER BY COALESCE(q.job_type = 'message_event' OR (q.job_type = 'scheduled' AND q.payload->>'source' = 'trigger'), FALSE) DESC,
      GREATEST(0, q.priority - floor(EXTRACT(epoch FROM (now() - q.due_at)) / 60)), q.due_at, q.id
    FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.dm_jobs j SET status = 'processing', attempts = j.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
    FROM due WHERE j.id = due.id RETURNING j.*;
END;
$$;

-- 운영 화면 집계.
--
-- 상대 계정이 메시지를 받을 수 없는 상태(삭제·비활성화·차단 등)로 끝난 건은 우리가
-- 처리할 일이 없다. 실패·확인할 작업에 섞이면 정상 상황이 장애처럼 보인다.
CREATE OR REPLACE FUNCTION public.dm_queue_overview(p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH accounts AS (
    SELECT * FROM public.dm_worker_accounts ORDER BY ig_account_id
    OFFSET GREATEST(p_offset, 0) LIMIT LEAST(GREATEST(p_limit, 1), 100) + 1
  ), rows AS (
    SELECT a.ig_account_id, a.lease_until, a.cooldown_until,
      (SELECT j.username FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id AND j.username IS NOT NULL ORDER BY j.created_at DESC LIMIT 1) AS username,
      (SELECT count(*) FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id AND j.status = 'pending') AS pending,
      (SELECT count(*) FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id AND j.status = 'processing') AS processing,
      (SELECT min(j.due_at) FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id AND j.status = 'pending' AND j.due_at <= now()) AS oldest_due_at,
      (SELECT count(*) FROM public.dm_send_attempts s WHERE s.ig_account_id = a.ig_account_id AND s.created_at > now() - interval '1 hour' AND s.status = 'sent') AS sent_hour,
      (SELECT count(*) FROM public.dm_send_attempts s WHERE s.ig_account_id = a.ig_account_id AND s.created_at > now() - interval '1 hour' AND s.status = 'failed'
        AND COALESCE(s.error_kind, '') NOT IN ('recipient_unavailable', 'throttled')) AS failed_hour,
      (SELECT count(*) FROM public.dm_send_attempts s WHERE s.ig_account_id = a.ig_account_id AND s.created_at > now() - interval '1 hour' AND (s.status = 'uncertain' OR (s.status = 'pending' AND s.created_at < now() - interval '30 seconds'))) AS uncertain_hour,
      (SELECT count(*) FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id
        AND (j.status IN ('failed', 'uncertain') OR j.outcome = 'partial')
        AND NOT (j.status = 'failed' AND COALESCE(j.error_kind, '') = 'recipient_unavailable')) AS needs_review
    FROM accounts a
  ) SELECT jsonb_build_object('accounts', COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY ig_account_id), '[]'::jsonb), 'generatedAt', now()) FROM rows;
$$;

-- 끝난 작업 정리. 표가 끝없이 커지면 계정별 집계와 작업 선점이 갈수록 느려진다.
-- 실패·확인 필요 건은 운영자가 살펴볼 시간을 두고 더 오래 남긴다.
CREATE OR REPLACE FUNCTION public.dm_prune_jobs()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.dm_jobs WHERE id IN (
    SELECT id FROM public.dm_jobs
    WHERE (status IN ('sent', 'canceled') AND COALESCE(completed_at, updated_at) < now() - interval '30 days')
       OR (status IN ('failed', 'uncertain') AND COALESCE(completed_at, updated_at) < now() - interval '60 days')
    LIMIT 2000
  );
$$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('dm_reserve_send', 'dm_claim_account_job', 'dm_queue_overview', 'dm_prune_jobs')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
