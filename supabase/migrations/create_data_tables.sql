-- Migration: Move Netlify Blobs data to Supabase tables
-- Run this in Supabase SQL Editor before deploying

-- 1. analytics: daily view/click tracking per user
CREATE TABLE IF NOT EXISTS public.analytics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL,
  date date NOT NULL,
  views integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  block_clicks jsonb NOT NULL DEFAULT '{}',
  UNIQUE(username, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_username_date ON public.analytics(username, date);

-- 2. broadcast_history: live broadcast session records
CREATE TABLE IF NOT EXISTS public.broadcast_history (
  id text PRIMARY KEY,
  username text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 0,
  products jsonb NOT NULL DEFAULT '[]',
  cart_stats jsonb NOT NULL DEFAULT '{}',
  peak_viewers integer NOT NULL DEFAULT 0,
  total_messages integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_history_username ON public.broadcast_history(username, created_at DESC);

-- 3. admin_notifications: admin dashboard notifications
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id text PRIMARY KEY,
  type text NOT NULL,
  influencer_username text,
  proposal_id text,
  proposal_title text,
  company_name text,
  category text,
  fee numeric,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created ON public.admin_notifications(created_at DESC);

-- 4. settlements: payment/settlement tracking
CREATE TABLE IF NOT EXISTS public.settlements (
  id text PRIMARY KEY,
  proposal_id text,
  influencer_username text NOT NULL,
  business_username text NOT NULL,
  company_name text,
  title text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  scheduled_date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'pending', 'completed')),
  completed_at timestamptz,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_settlements_influencer ON public.settlements(influencer_username);
CREATE INDEX IF NOT EXISTS idx_settlements_business ON public.settlements(business_username);

-- 5. collab_records: collaboration/project history
CREATE TABLE IF NOT EXISTS public.collab_records (
  id text PRIMARY KEY,
  username text NOT NULL,
  title text NOT NULL,
  company_name text,
  category text NOT NULL DEFAULT '기타' CHECK (category IN ('광고', '커머스', '기타')),
  date date NOT NULL,
  end_date date,
  fee numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_collab_records_username ON public.collab_records(username);

-- 6. business_accounts: business user accounts
CREATE TABLE IF NOT EXISTS public.business_accounts (
  id text PRIMARY KEY,
  company_name text NOT NULL,
  business_number text NOT NULL,
  contact_person text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_business_accounts_username ON public.business_accounts(username);

-- 7. business_proposals: proposals sent to influencers
CREATE TABLE IF NOT EXISTS public.business_proposals (
  id text PRIMARY KEY,
  influencer_username text NOT NULL,
  category text NOT NULL CHECK (category IN ('광고', '커머스')),
  company_name text NOT NULL,
  contact_person text,
  contact_email text,
  contact_phone text,
  title text NOT NULL,
  content text,
  start_date text,
  end_date text,
  fee numeric NOT NULL DEFAULT 0,
  revenue_share numeric,
  reference_links jsonb NOT NULL DEFAULT '[]',
  attachments jsonb NOT NULL DEFAULT '[]',
  business_username text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'completed')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_business_proposals_influencer ON public.business_proposals(influencer_username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_proposals_company ON public.business_proposals(company_name);
CREATE INDEX IF NOT EXISTS idx_business_proposals_business_user ON public.business_proposals(business_username);

-- Enable RLS on all tables (using service role key bypasses RLS)
ALTER TABLE public.analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collab_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_proposals ENABLE ROW LEVEL SECURITY;
