-- 어필리에이트 상품을 상위 카테고리(뷰티 · 패션 · 스킨케어 · 라이프스타일)와
-- 하위 카테고리(TOP · BOTTOM · OUTER …)로 나눠 본다. 기존 category 칸이 상위,
-- 새 subcategory 칸이 하위다.
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS subcategory TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS affiliate_store_products_category_idx
  ON affiliate_store_products (status, category, subcategory, created_at DESC);

-- 입점 브랜드 목록(수천 개)을 브랜드명으로 찾는다.
CREATE INDEX IF NOT EXISTS affiliate_store_applications_brand_name_idx
  ON affiliate_store_applications (status, lower(brand_name));
