CREATE TABLE IF NOT EXISTS site_data_snapshots (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  data JSONB NOT NULL,
  snapshot_reason TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_site_data_snapshots_username ON site_data_snapshots (username, created_at DESC);
