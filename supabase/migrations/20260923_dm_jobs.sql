CREATE TABLE IF NOT EXISTS public.dm_jobs (
  id text PRIMARY KEY,
  job_type text NOT NULL CHECK (job_type IN ('comment_event', 'scheduled')),
  username text,
  ig_account_id text,
  payload jsonb NOT NULL,
  due_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'canceled', 'uncertain')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  error_kind text,
  last_error text,
  message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS dm_jobs_due_idx ON public.dm_jobs (due_at, id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS dm_jobs_lease_idx ON public.dm_jobs (lease_expires_at)
  WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS dm_jobs_user_idx ON public.dm_jobs (username, created_at DESC)
  WHERE job_type = 'scheduled';
CREATE INDEX IF NOT EXISTS dm_jobs_account_idx ON public.dm_jobs (ig_account_id, due_at)
  WHERE status = 'pending';

ALTER TABLE public.dm_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dm_jobs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dm_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.dm_claim_due_jobs(p_limit integer DEFAULT 1)
RETURNS SETOF public.dm_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.dm_jobs AS job
  SET status = 'processing',
      attempts = job.attempts + 1,
      lease_token = pg_catalog.gen_random_uuid(),
      lease_expires_at = pg_catalog.now() + interval '2 minutes',
      updated_at = pg_catalog.now()
  FROM (
    SELECT id
    FROM public.dm_jobs
    WHERE (status = 'pending' AND due_at <= pg_catalog.now())
       OR (status = 'processing' AND lease_expires_at < pg_catalog.now())
    ORDER BY due_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 20)
  ) AS due
  WHERE job.id = due.id
  RETURNING job.*;
$$;

REVOKE ALL ON FUNCTION public.dm_claim_due_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dm_claim_due_jobs(integer) TO service_role;
