-- 상품 정보(상품 설명 · 사이즈 가이드 · 배송 안내)를 글뿐 아니라 이미지로도 올릴 수 있게 한다.
-- 각 칸마다 이미지 주소 목록을 따로 두고, 구매 페이지와 인플루언서 상세 화면에서 글 아래에 이어서 보여 준다.
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS description_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS size_guide_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS delivery_guide_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
