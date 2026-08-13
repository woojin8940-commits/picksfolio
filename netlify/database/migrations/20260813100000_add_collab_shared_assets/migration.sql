-- 선정된 브랜드와 인플루언서가 협업별 파일을 공유하고 확인 상태를 남기는 자료함.
CREATE TABLE IF NOT EXISTS collab_assets (
  id TEXT PRIMARY KEY,
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  uploaded_by_role TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'shared',
  reviewed_by TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_assets_collab_created
  ON collab_assets (collab_id, created_at DESC);
