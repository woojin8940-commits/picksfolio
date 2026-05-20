-- Add missing columns to proposals table for full data recovery
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS business_username TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS influencer_username TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS content TEXT;

CREATE INDEX IF NOT EXISTS idx_proposals_business_username ON proposals(business_username);
CREATE INDEX IF NOT EXISTS idx_proposals_influencer_username ON proposals(influencer_username);

-- Backfill influencer_username from username where missing
UPDATE proposals SET influencer_username = username WHERE influencer_username IS NULL;

-- Create timelines table for SQL-backed persistence
CREATE TABLE IF NOT EXISTS timelines (
    proposal_id TEXT PRIMARY KEY NOT NULL,
    influencer_username TEXT NOT NULL,
    business_username TEXT NOT NULL,
    company_name TEXT,
    proposal_title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timelines_influencer ON timelines(influencer_username);
CREATE INDEX IF NOT EXISTS idx_timelines_business ON timelines(business_username);

-- Create timeline_messages table for message persistence
CREATE TABLE IF NOT EXISTS timeline_messages (
    id TEXT PRIMARY KEY NOT NULL,
    proposal_id TEXT NOT NULL,
    author_type TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_username TEXT NOT NULL,
    content TEXT,
    attachments JSONB,
    read_by TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_timeline_messages_proposal ON timeline_messages(proposal_id);
CREATE INDEX IF NOT EXISTS idx_timeline_messages_created ON timeline_messages(proposal_id, created_at);
