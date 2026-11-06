-- 상세페이지 이미지 없이도 구매 페이지에서 상품 정보를 볼 수 있도록
-- 브랜드가 상품마다 사이즈 가이드와 배송·교환·반품 안내를 글로 적는다.
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS size_guide TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS delivery_guide TEXT NOT NULL DEFAULT '';
