-- 판매가 끝난(판매 중지 · 종료 · 삭제) 어필리에이트를 각자의 목록에서 지울 수 있게 한다.
-- 기록(주문 · 수수료)은 그대로 두고, 화면에서만 내린다.
--   인플루언서: MY 어필리에이트 '진행 상품'에서 내린 협업(진행 이력 탭에는 남는다).
--   브랜드: 어필리에이트 이력에서 삭제한 상품.
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS creator_hidden_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_products ADD COLUMN IF NOT EXISTS brand_history_hidden_at TIMESTAMPTZ;
