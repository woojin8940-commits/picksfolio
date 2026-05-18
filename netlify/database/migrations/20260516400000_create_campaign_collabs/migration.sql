CREATE TABLE campaign_collabs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES campaign_applications(id) ON DELETE CASCADE,
  business_username TEXT NOT NULL,
  creator_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  deliverable_url TEXT DEFAULT '',
  deliverable_note TEXT DEFAULT '',
  business_note TEXT DEFAULT '',
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(campaign_id, creator_username)
);

CREATE INDEX idx_collabs_business ON campaign_collabs(business_username);
CREATE INDEX idx_collabs_creator ON campaign_collabs(creator_username);
CREATE INDEX idx_collabs_campaign ON campaign_collabs(campaign_id);
CREATE INDEX idx_collabs_status ON campaign_collabs(status);
