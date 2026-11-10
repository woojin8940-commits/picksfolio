-- 브랜드가 선정한 어필리에이트 협업을 운영자 대시보드에서 바로 보고 담당자가 조율한다.
--   operator_seen_at : 운영자가 "어필리에이트 협업 진행" 목록에서 확인한 시각. NULL 이면 새 선정으로 센다(메뉴 배지).
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS operator_seen_at TIMESTAMPTZ;
-- 이미 있던 선정은 확인한 것으로 둔다.
UPDATE affiliate_store_requests SET operator_seen_at = NOW() WHERE operator_seen_at IS NULL;
CREATE INDEX IF NOT EXISTS affiliate_store_requests_operator_unseen_idx
  ON affiliate_store_requests (updated_at DESC) WHERE operator_seen_at IS NULL AND status = 'approved';
