-- 브랜드가 상품을 등록할 때 상세페이지 이미지(세로로 긴 상세 이미지 여러 장)를 함께 올린다.
-- 인플루언서 상품 상세 화면과 구매자 상품 페이지에서 순서대로 이어 붙여 보여 준다.
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS detail_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
