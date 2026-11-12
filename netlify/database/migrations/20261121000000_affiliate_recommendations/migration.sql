-- 추천 어필리에이트 — 담당자가 인플루언서에게 어울리는 어필리에이트 상품을 골라 리스트업한다.
-- 인플루언서는 MY 어필리에이트 › '추천 어필리에이트' 탭에서 담당자가 추천한 상품을 본다.
-- 인플루언서 한 명에게 같은 상품은 한 번만 추천된다(다시 추천하면 메모 · 시각만 바뀐다).
CREATE TABLE IF NOT EXISTS affiliate_recommendations (
  id TEXT PRIMARY KEY,
  influencer_username TEXT NOT NULL,
  product_id TEXT NOT NULL,
  manager_username TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (influencer_username, product_id)
);

CREATE INDEX IF NOT EXISTS affiliate_recommendations_influencer_idx
  ON affiliate_recommendations (influencer_username, created_at DESC);
