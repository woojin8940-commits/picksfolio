-- Performance indexes for business menu queries

-- Timeline list query: filter by LOWER(business_username) / LOWER(influencer_username)
CREATE INDEX IF NOT EXISTS idx_timelines_business_lower ON timelines(LOWER(business_username));
CREATE INDEX IF NOT EXISTS idx_timelines_influencer_lower ON timelines(LOWER(influencer_username));

-- Timeline messages: unread aggregation uses proposal_id + read_by
CREATE INDEX IF NOT EXISTS idx_timeline_messages_proposal_readby ON timeline_messages(proposal_id, created_at DESC);

-- Campaign applications: accepted status filtered by applicant or business
CREATE INDEX IF NOT EXISTS idx_applications_status_applicant ON campaign_applications(status, applicant_username);
CREATE INDEX IF NOT EXISTS idx_applications_status ON campaign_applications(status);

-- Campaigns: business_username lookup with LOWER/REPLACE
CREATE INDEX IF NOT EXISTS idx_campaigns_business_lower ON campaigns(LOWER(REPLACE(business_username, 'biz/', '')));

-- Proposals: business_username with LOWER/COALESCE for filtered queries
CREATE INDEX IF NOT EXISTS idx_proposals_business_lower ON proposals(LOWER(COALESCE(business_username, '')));
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
