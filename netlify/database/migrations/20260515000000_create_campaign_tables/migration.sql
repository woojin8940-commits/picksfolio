CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  business_username TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  brand_name TEXT DEFAULT '',
  thumbnail_url TEXT DEFAULT '',
  category TEXT DEFAULT '',
  reward_type TEXT DEFAULT '',
  reward_amount TEXT DEFAULT '',
  requirements TEXT DEFAULT '',
  max_applicants INTEGER DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE campaign_applications (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  applicant_username TEXT NOT NULL,
  message TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  portfolio_url TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  UNIQUE(campaign_id, applicant_username)
);

CREATE INDEX idx_campaigns_business ON campaigns(business_username);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_type ON campaigns(type);
CREATE INDEX idx_applications_campaign ON campaign_applications(campaign_id);
CREATE INDEX idx_applications_applicant ON campaign_applications(applicant_username);
