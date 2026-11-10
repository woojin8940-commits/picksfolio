-- 어필리에이트 선정 → 협찬 배송 흐름 · 직거래 금지 동의.
--
-- 브랜드가 선정해도 바로 판매 링크가 열리지 않는다. 인플루언서에게 선정 알림이 가고,
-- 인플루언서가 배송정보를 입력하면 협업이 진행(링크 발급)되고 브랜드가 송장번호를 입력해 보낸다.
-- 인플루언서가 배송정보 대신 반려하면 협업은 진행되지 않는다.
--
--   shipping_status : '' (해당 없음 · 예전 흐름으로 이미 링크가 열린 선정)
--                     'awaiting_info'  브랜드 선정 → 인플루언서 배송정보 입력 대기
--                     'info_submitted' 인플루언서가 배송정보 입력 → 브랜드 발송 대기(협업 진행)
--                     'shipped'        브랜드가 송장번호 입력(협업 진행)
--                     'declined'       인플루언서가 반려(협업 진행 안 함)
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS shipping_status TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_recipient_name TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_recipient_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_postcode TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_address1 TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_address2 TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_memo TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_info_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_tracking_company TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS ship_tracking_number TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS declined_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS affiliate_store_requests_shipping_idx
  ON affiliate_store_requests (shipping_status, updated_at DESC) WHERE shipping_status <> '';

-- 직거래 금지 동의(어필리에이트 입점 심사 때 체크). 이미 승인된 브랜드 · 크리에이터는
-- 처음 선정하거나 판매 신청할 때 한 번 동의한다.
ALTER TABLE affiliate_store_applications ADD COLUMN IF NOT EXISTS direct_deal_agreed_at TIMESTAMPTZ;
ALTER TABLE creator_applications ADD COLUMN IF NOT EXISTS direct_deal_agreed_at TIMESTAMPTZ;
