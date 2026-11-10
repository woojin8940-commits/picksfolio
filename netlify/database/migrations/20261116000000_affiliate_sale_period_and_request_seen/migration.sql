-- 어필리에이트 상품 판매기간 · 브랜드가 확인하지 않은 판매 신청(상품별 알림).
--
--   sale_start_date / sale_end_date : 브랜드가 정한 판매기간(한국 날짜, 둘 다 포함). 비워 두면 제한 없음.
--     판매중(on_sale)이어도 기간 밖이면 인플루언서 목록 · 판매 신청 · 구매에서 막힌다.
--   brand_seen_at : 브랜드가 상품의 신청자 목록을 열어 확인한 시각. NULL 이면 "새 신청" 알림으로 센다.

ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS sale_start_date DATE;
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS sale_end_date DATE;

ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS brand_seen_at TIMESTAMPTZ;
-- 이미 처리한(선정 · 반려 · 취소) 신청은 확인한 것으로 둔다. 검토 대기 신청만 새 신청 알림으로 남긴다.
UPDATE affiliate_store_requests SET brand_seen_at = updated_at WHERE brand_seen_at IS NULL AND status <> 'pending';

CREATE INDEX IF NOT EXISTS affiliate_store_requests_product_created_idx
  ON affiliate_store_requests (product_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_requests_brand_unseen_idx
  ON affiliate_store_requests (business_username, product_id) WHERE brand_seen_at IS NULL AND status = 'pending';
