-- 어필리에이트 목록 정렬(최신순 + id) · 커서 페이지에 맞춘 복합 인덱스.
-- 같은 앞부분을 가진 예전 인덱스(id 없음)는 새 인덱스가 대신하므로 지운다.

-- 주문: 브랜드 주문 관리 · 인플루언서 판매 내역 (… created_at DESC, id DESC)
CREATE INDEX IF NOT EXISTS affiliate_store_orders_brand_created_idx
  ON affiliate_store_orders (business_username, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_orders_influencer_created_idx
  ON affiliate_store_orders (influencer_username, created_at DESC, id DESC);
DROP INDEX IF EXISTS affiliate_store_orders_brand_idx;
DROP INDEX IF EXISTS affiliate_store_orders_influencer_idx;

-- 판매 신청: 브랜드 숫자(대기 · 전체) · 브랜드 받은 신청 목록 · 인플루언서 내 신청 목록
CREATE INDEX IF NOT EXISTS affiliate_store_requests_brand_status_idx
  ON affiliate_store_requests (business_username, status);
CREATE INDEX IF NOT EXISTS affiliate_store_requests_brand_created_idx
  ON affiliate_store_requests (business_username, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_requests_influencer_created_idx
  ON affiliate_store_requests (influencer_username, created_at DESC, id DESC);
DROP INDEX IF EXISTS affiliate_store_requests_brand_idx;
DROP INDEX IF EXISTS affiliate_store_requests_influencer_idx;

-- 상품: 브랜드 상품 관리(삭제 안 된 상품) · 인플루언서 상품 둘러보기(판매중)
CREATE INDEX IF NOT EXISTS affiliate_store_products_brand_created_idx
  ON affiliate_store_products (business_username, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS affiliate_store_products_on_sale_created_idx
  ON affiliate_store_products (created_at DESC, id DESC) WHERE deleted_at IS NULL AND status = 'on_sale';
