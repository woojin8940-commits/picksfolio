-- 어필리에이트 협업의 콘텐츠 업로드 단계.
--
-- 선정 → 배송정보 입력 → 브랜드 송장 입력(발송) → 인플루언서 상품 수령 → 수령 후 10일 이내 콘텐츠 업로드 · 판매 시작.
-- 인플루언서는 MY 어필리에이트에서 업로드한 콘텐츠 링크와 브랜디드 콘텐츠 파트너십 코드를 올리고,
-- 브랜드는 진행관리(진행 단계)와 캠페인 이력에서 그 링크 · 코드를 확인하고 2차 광고(부스팅)로 돌린다.
--
--   ship_delivered_at     인플루언서가 협찬 상품을 받은 시각(직접 수령 확인 · 송장 조회 배송 완료 · 발송 5일 뒤 자동).
--                         업로드 마감 = 이 시각 + 10일.
--   content_url           인플루언서가 올린 콘텐츠(게시물) 주소
--   partnership_code      브랜디드 콘텐츠 파트너십(광고) 코드
--   content_submitted_at  콘텐츠 링크를 처음 올린 시각
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_delivered_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS content_url TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS partnership_code TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS content_submitted_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS affiliate_store_requests_awaiting_delivery_idx
  ON affiliate_store_requests (shipped_at) WHERE shipping_status = 'shipped' AND ship_delivered_at IS NULL;
