BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.dm_jobs ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 10;
ALTER TABLE public.dm_jobs ADD COLUMN IF NOT EXISTS outcome text;
UPDATE public.dm_jobs SET priority = 0 WHERE job_type = 'comment_event' AND priority = 10;
CREATE INDEX IF NOT EXISTS dm_jobs_account_history_idx ON public.dm_jobs (ig_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dm_jobs_account_lease_idx ON public.dm_jobs (ig_account_id, lease_expires_at)
  WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS public.dm_worker_accounts (
  ig_account_id text PRIMARY KEY,
  worker_token uuid,
  lease_until timestamptz,
  dispatch_token uuid,
  dispatch_until timestamptz,
  last_dispatched_at timestamptz,
  cooldown_until timestamptz,
  send_token uuid,
  send_lease_until timestamptz,
  next_send_at timestamptz
);
INSERT INTO public.dm_worker_accounts(ig_account_id)
  SELECT DISTINCT ig_account_id FROM public.dm_jobs WHERE ig_account_id IS NOT NULL AND ig_account_id <> ''
  ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.dm_send_buckets (
  ig_account_id text NOT NULL REFERENCES public.dm_worker_accounts(ig_account_id),
  bucket text NOT NULL CHECK (bucket IN ('private_reply', 'direct', 'public_reply')),
  next_at timestamptz,
  PRIMARY KEY (ig_account_id, bucket)
);
CREATE TABLE IF NOT EXISTS public.dm_send_attempts (
  id uuid PRIMARY KEY,
  ig_account_id text NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('private_reply', 'direct', 'public_reply')),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'uncertain')),
  error_kind text,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS dm_send_attempts_account_time_idx
  ON public.dm_send_attempts(ig_account_id, bucket, created_at);
CREATE INDEX IF NOT EXISTS dm_send_attempts_time_idx ON public.dm_send_attempts(created_at);

ALTER TABLE public.dm_worker_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_send_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_send_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dm_worker_accounts, public.dm_send_buckets, public.dm_send_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dm_worker_accounts, public.dm_send_buckets, public.dm_send_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.dm_request_workers(p_accounts text[] DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE(ig_account_id text, token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.dm_worker_accounts(ig_account_id)
  SELECT DISTINCT j.ig_account_id FROM public.dm_jobs j
  WHERE j.ig_account_id IS NOT NULL AND j.ig_account_id <> ''
    AND (p_accounts IS NULL OR j.ig_account_id = ANY(p_accounts))
    AND (p_accounts IS NOT NULL OR (j.status = 'pending' AND j.due_at <= now()) OR (j.status = 'processing' AND j.lease_expires_at <= now()))
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  WITH due AS MATERIALIZED (
    SELECT w.ig_account_id FROM public.dm_worker_accounts w
    WHERE (p_accounts IS NULL OR w.ig_account_id = ANY(p_accounts))
      AND (w.lease_until IS NULL OR w.lease_until <= now())
      AND (w.dispatch_until IS NULL OR w.dispatch_until <= now())
      AND (w.cooldown_until IS NULL OR w.cooldown_until <= now())
      AND NOT EXISTS (SELECT 1 FROM public.dm_jobs j WHERE j.ig_account_id = w.ig_account_id
        AND j.status = 'processing' AND j.lease_expires_at > now())
      AND EXISTS (SELECT 1 FROM public.dm_jobs j WHERE j.ig_account_id = w.ig_account_id
        AND ((j.status = 'pending' AND j.due_at <= now()) OR (j.status = 'processing' AND j.lease_expires_at <= now())))
    ORDER BY w.last_dispatched_at ASC NULLS FIRST, w.ig_account_id
    FOR UPDATE OF w SKIP LOCKED LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.dm_worker_accounts a
  SET dispatch_token = gen_random_uuid(), dispatch_until = now() + interval '60 seconds', last_dispatched_at = now()
  FROM due
  WHERE a.ig_account_id = due.ig_account_id
  RETURNING a.ig_account_id, a.dispatch_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_start_worker(p_account text, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.dm_worker_accounts SET worker_token = p_token, lease_until = now() + interval '90 seconds',
    dispatch_token = NULL, dispatch_until = NULL
  WHERE ig_account_id = p_account AND dispatch_token = p_token AND dispatch_until > now()
    AND (lease_until IS NULL OR lease_until <= now()) AND (cooldown_until IS NULL OR cooldown_until <= now());
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_renew_worker(p_account text, p_token uuid, p_job text DEFAULT NULL, p_job_token uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.dm_worker_accounts SET lease_until = now() + interval '90 seconds'
  WHERE ig_account_id = p_account AND worker_token = p_token AND lease_until > now();
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_job IS NOT NULL THEN
    UPDATE public.dm_jobs SET lease_expires_at = now() + interval '2 minutes'
    WHERE id = p_job AND ig_account_id = p_account AND status = 'processing'
      AND lease_token = p_job_token AND lease_expires_at > now();
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_release_worker(p_account text, p_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.dm_worker_accounts SET worker_token = NULL, lease_until = NULL
  WHERE ig_account_id = p_account AND worker_token = p_token;
$$;

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
    ORDER BY GREATEST(0, q.priority - floor(EXTRACT(epoch FROM (now() - q.due_at)) / 60)), q.due_at, q.id
    FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.dm_jobs j SET status = 'processing', attempts = j.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
    FROM due WHERE j.id = due.id RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_pause_account(p_account text, p_delay_ms integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.dm_worker_accounts(ig_account_id, cooldown_until)
  VALUES (p_account, now() + LEAST(GREATEST(p_delay_ms, 1000), 86400000) * interval '1 millisecond')
  ON CONFLICT (ig_account_id) DO UPDATE SET cooldown_until = GREATEST(dm_worker_accounts.cooldown_until, EXCLUDED.cooldown_until);
$$;

CREATE OR REPLACE FUNCTION public.dm_claim_due_jobs(p_limit integer DEFAULT 1)
RETURNS SETOF public.dm_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE account text;
BEGIN
  INSERT INTO public.dm_worker_accounts(ig_account_id)
    SELECT DISTINCT j.ig_account_id FROM public.dm_jobs j WHERE j.ig_account_id IS NOT NULL
      AND ((j.status = 'pending' AND j.due_at <= now()) OR (j.status = 'processing' AND j.lease_expires_at <= now()))
    ON CONFLICT DO NOTHING;
  SELECT a.ig_account_id INTO account FROM public.dm_worker_accounts a
    WHERE (a.lease_until IS NULL OR a.lease_until <= now()) AND (a.cooldown_until IS NULL OR a.cooldown_until <= now())
      AND NOT EXISTS(SELECT 1 FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id AND j.status = 'processing' AND j.lease_expires_at > now())
      AND EXISTS(SELECT 1 FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id
        AND ((j.status = 'pending' AND j.due_at <= now()) OR (j.status = 'processing' AND j.lease_expires_at <= now())))
    ORDER BY (SELECT min(j.due_at) FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id AND j.status IN ('pending', 'processing')), a.ig_account_id
    FOR UPDATE OF a SKIP LOCKED LIMIT 1;
  IF account IS NULL THEN RETURN; END IF;
  RETURN QUERY WITH due AS MATERIALIZED (
    SELECT q.id FROM public.dm_jobs q WHERE q.ig_account_id = account
      AND ((q.status = 'pending' AND q.due_at <= now()) OR (q.status = 'processing' AND q.lease_expires_at <= now()))
    ORDER BY q.due_at,q.id FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit, 1), 20)
  ) UPDATE public.dm_jobs j SET status = 'processing', attempts = j.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes', updated_at = now()
    FROM due WHERE j.id = due.id RETURNING j.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_reserve_send(p_account text, p_bucket text, p_hour_limit integer, p_spacing_ms integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.dm_worker_accounts; next_at timestamptz; wait_until timestamptz; oldest timestamptz; used integer; token uuid;
BEGIN
  IF p_account IS NULL OR p_account = '' OR p_bucket NOT IN ('private_reply', 'direct', 'public_reply') THEN RAISE EXCEPTION 'Invalid send account or bucket'; END IF;
  INSERT INTO public.dm_worker_accounts(ig_account_id) VALUES(p_account) ON CONFLICT DO NOTHING;
  SELECT * INTO a FROM public.dm_worker_accounts WHERE ig_account_id = p_account FOR UPDATE;
  INSERT INTO public.dm_send_buckets(ig_account_id, bucket) VALUES(p_account, p_bucket) ON CONFLICT DO NOTHING;
  SELECT b.next_at INTO next_at FROM public.dm_send_buckets b WHERE b.ig_account_id = p_account AND b.bucket = p_bucket;
  wait_until := GREATEST(a.cooldown_until, a.send_lease_until, a.next_send_at, next_at);
  IF wait_until > now() THEN RETURN jsonb_build_object('allowed', false, 'retryAfterMs', CEIL(EXTRACT(epoch FROM (wait_until - now())) * 1000)); END IF;
  SELECT count(*), min(created_at) INTO used, oldest FROM public.dm_send_attempts
    WHERE ig_account_id = p_account AND bucket = p_bucket AND created_at > now() - interval '1 hour';
  IF used >= LEAST(GREATEST(p_hour_limit, 1), 100000) THEN
    RETURN jsonb_build_object('allowed', false, 'retryAfterMs', CEIL(EXTRACT(epoch FROM (oldest + interval '1 hour' - now())) * 1000) + 100);
  END IF;
  token := gen_random_uuid();
  UPDATE public.dm_worker_accounts SET send_token = token, send_lease_until = now() + interval '30 seconds', next_send_at = now() + interval '400 milliseconds' WHERE ig_account_id = p_account;
  UPDATE public.dm_send_buckets SET next_at = now() + LEAST(GREATEST(p_spacing_ms, 400), 3600000) * interval '1 millisecond' WHERE ig_account_id = p_account AND bucket = p_bucket;
  INSERT INTO public.dm_send_attempts(id, ig_account_id, bucket) VALUES(token, p_account, p_bucket);
  RETURN jsonb_build_object('allowed', true, 'token', token);
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_finish_send(p_account text, p_token uuid, p_status text, p_error_kind text DEFAULT NULL, p_retry_ms integer DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'uncertain') THEN RAISE EXCEPTION 'Invalid send result'; END IF;
  UPDATE public.dm_worker_accounts SET send_token = NULL, send_lease_until = NULL,
    cooldown_until = CASE WHEN p_error_kind = 'rate_limit' THEN GREATEST(cooldown_until, now() + LEAST(GREATEST(p_retry_ms, 60000), 86400000) * interval '1 millisecond') ELSE cooldown_until END
  WHERE ig_account_id = p_account AND send_token = p_token;
  UPDATE public.dm_send_attempts SET status = p_status, error_kind = p_error_kind, completed_at = now()
  WHERE id = p_token AND ig_account_id = p_account AND status = 'pending';
END;
$$;

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
      (SELECT count(*) FROM public.dm_send_attempts s WHERE s.ig_account_id = a.ig_account_id AND s.created_at > now() - interval '1 hour' AND s.status = 'failed') AS failed_hour,
      (SELECT count(*) FROM public.dm_send_attempts s WHERE s.ig_account_id = a.ig_account_id AND s.created_at > now() - interval '1 hour' AND (s.status = 'uncertain' OR (s.status = 'pending' AND s.created_at < now() - interval '30 seconds'))) AS uncertain_hour,
      (SELECT count(*) FROM public.dm_jobs j WHERE j.ig_account_id = a.ig_account_id AND (j.status IN ('failed', 'uncertain') OR j.outcome = 'partial')) AS needs_review
    FROM accounts a
  ) SELECT jsonb_build_object('accounts', COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY ig_account_id), '[]'::jsonb), 'generatedAt', now()) FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.dm_prune_send_attempts()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.dm_send_attempts WHERE id IN (
    SELECT id FROM public.dm_send_attempts WHERE created_at < now() - interval '8 days' ORDER BY created_at LIMIT 2000
  );
$$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('dm_request_workers', 'dm_start_worker', 'dm_renew_worker', 'dm_release_worker',
      'dm_claim_account_job', 'dm_claim_due_jobs', 'dm_pause_account', 'dm_reserve_send', 'dm_finish_send', 'dm_queue_overview', 'dm_prune_send_attempts')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
