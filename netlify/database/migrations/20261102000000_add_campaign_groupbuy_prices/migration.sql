-- 커머스형(공동구매) 상품 가격.
--
-- 공동구매는 정가보다 싸게 파는 것이 전제라, 브랜드가 수수료율만 적어서는 인플루언서가
-- "얼마짜리를 얼마에 파는지" 알 수 없었다. 두 값을 따로 받는다.
--
--   groupbuy_product_price  상품 정가(원).
--   groupbuy_sale_price     인플루언서 진행 가격(원). 할인이 들어간 판매가다.
--
-- 0 은 "해당 없음"이고, 커머스형이 아닌 캠페인과 예전 캠페인은 계속 0 이다.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS groupbuy_product_price INT DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS groupbuy_sale_price INT DEFAULT 0;
