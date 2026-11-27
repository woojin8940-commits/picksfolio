-- 인플루언서가 MY 캠페인에서 캠페인을 지울 수 있게 한다.
-- 협업 기록(단계 · 제출물 · 브랜드 쪽 진행 상황)은 그대로 두고, 인플루언서 목록에서만 내린다.
ALTER TABLE campaign_collabs ADD COLUMN IF NOT EXISTS creator_hidden_at TIMESTAMPTZ;
