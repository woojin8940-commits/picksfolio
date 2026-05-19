ALTER TABLE campaigns ADD COLUMN admin_approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE campaigns ADD COLUMN admin_rejected_reason TEXT DEFAULT '';

CREATE INDEX idx_campaigns_pending_approval ON campaigns(status) WHERE status = 'pending_approval';
