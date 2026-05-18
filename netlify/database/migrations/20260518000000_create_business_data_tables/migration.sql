CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  description TEXT,
  fee INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  contact_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_username ON proposals(username);

CREATE TABLE IF NOT EXISTS collabs (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '광고',
  fee INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  end_date TEXT,
  start_date TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collabs_username ON collabs(username);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  influencer_username TEXT NOT NULL,
  title TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  scheduled_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_username ON settlements(username);

CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  title TEXT,
  category TEXT,
  is_live BOOLEAN NOT NULL DEFAULT false,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  total_viewers INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  chat_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_sessions_username ON live_sessions(username);

CREATE TABLE IF NOT EXISTS broadcast_history (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  title TEXT,
  category TEXT,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  chat_count INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_history_username ON broadcast_history(username);
