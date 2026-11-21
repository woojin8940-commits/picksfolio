-- AI 공구 상담원이 고객 DM에 답할 때 쓰는 상품 정보.
-- 기존 상품이 깨지지 않게 모두 비어 있어도 되는 칸으로 추가만 한다.
-- ship_start_date: 출고 예정일(이 날부터 순차 출고). NULL 이면 "주문 후 바로 출고".
-- key_ingredients · volume · shelf_life · caution: 뷰티 · 스킨케어 상품의 주요 성분 · 용량 · 사용 기한 · 주의사항.
-- faq: 브랜드가 적은 자주 묻는 질문 [{ "q": "질문", "a": "답변" }] (최대 20개).
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS ship_start_date DATE;
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS key_ingredients TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS volume TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS shelf_life TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS caution TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS faq JSONB NOT NULL DEFAULT '[]'::jsonb;
