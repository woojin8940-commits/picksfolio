-- Migration: Admin dashboard enhancements
-- - profiles: featured curation flag
-- - broadcast_history: highlight clip flag, force-end metadata
-- - chat_moderation: flagged messages + banned word rules
-- Run in Supabase SQL Editor

-- 1) Featured influencer curation
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS featured_at timestamptz;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS featured_note text;

CREATE INDEX IF NOT EXISTS idx_profiles_featured ON public.profiles(featured) WHERE featured = true;

-- 2) Broadcast history highlight + force-end
ALTER TABLE public.broadcast_history
  ADD COLUMN IF NOT EXISTS highlight boolean NOT NULL DEFAULT false;
ALTER TABLE public.broadcast_history
  ADD COLUMN IF NOT EXISTS highlight_note text;
ALTER TABLE public.broadcast_history
  ADD COLUMN IF NOT EXISTS force_ended_by text;
ALTER TABLE public.broadcast_history
  ADD COLUMN IF NOT EXISTS force_end_reason text;
ALTER TABLE public.broadcast_history
  ADD COLUMN IF NOT EXISTS revenue numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_broadcast_history_highlight ON public.broadcast_history(highlight) WHERE highlight = true;

-- 3) Chat moderation flagged messages
CREATE TABLE IF NOT EXISTS public.chat_moderation_log (
  id text PRIMARY KEY,
  broadcast_username text NOT NULL,
  viewer_id text,
  viewer_user text,
  message text NOT NULL,
  matched_word text,
  reason text,
  status text NOT NULL DEFAULT 'flagged' CHECK (status IN ('flagged', 'allowed', 'blocked', 'hidden')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_moderation_log_username ON public.chat_moderation_log(broadcast_username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_moderation_log_status ON public.chat_moderation_log(status, created_at DESC);

ALTER TABLE public.chat_moderation_log ENABLE ROW LEVEL SECURITY;

-- 4) Chat moderation banned-word rules
CREATE TABLE IF NOT EXISTS public.chat_moderation_rules (
  id text PRIMARY KEY,
  word text NOT NULL UNIQUE,
  severity text NOT NULL DEFAULT 'flag' CHECK (severity IN ('flag', 'block')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_moderation_rules ENABLE ROW LEVEL SECURITY;
