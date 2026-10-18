-- 판매 연동형 캠페인의 브랜드 약관 동의와 입금 확인.
--
-- 결제는 브랜드 자사몰에서 끝나고, 픽스폴리오는 매월 수수료를 청구해 픽스폴리오 계좌로
-- 입금받는다. 카드 자동결제가 없으므로 "언제까지 얼마를 어디로 보낸다"는 조건에 브랜드가
-- 동의한 기록이 남아 있어야 한다. 브랜드는 판매 캠페인을 심사 요청하기 전에 판매 수수료
-- 이용약관에 동의한다.

-- 브랜드 약관 동의 ----------------------------------------------------------------
--
-- 동의할 때마다 한 줄씩 쌓인다. 약관 버전이 바뀌면 다음 캠페인 등록 때 다시 동의받고,
-- 이전 동의 기록은 그대로 둔다. 동의 당시의 조건(미정산 한도 · 입금 계좌)과 브랜드 정보를
-- 함께 남겨, 나중에 설정이 바뀌어도 무엇에 동의했는지 알 수 있게 한다.
CREATE TABLE IF NOT EXISTS affiliate_brand_terms_agreements (
  id TEXT PRIMARY KEY,
  business_username TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  representative TEXT NOT NULL DEFAULT '',
  business_number TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  unsettled_limit INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT NOT NULL DEFAULT '',
  deposit_account TEXT NOT NULL DEFAULT '',
  -- 동의 근거. 원본 IP 는 남기지 않고 해시만 둔다.
  ip_hash TEXT NOT NULL DEFAULT '',
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_brand_terms_business ON affiliate_brand_terms_agreements(business_username, agreed_at DESC);

-- 입금 확인 ---------------------------------------------------------------------
--
-- 운영자가 통장을 보고 확인한 입금일 · 입금액 · 메모. 청구액과 입금액이 다르면 사유가
-- 메모로 남아야 한다(API 가 막는다). 입금 기한은 정산월 다음 달 15일이라 period 에서
-- 계산하고 따로 저장하지 않는다.
ALTER TABLE affiliate_settlement_batches ADD COLUMN IF NOT EXISTS paid_in_date DATE;
ALTER TABLE affiliate_settlement_batches ADD COLUMN IF NOT EXISTS paid_in_memo TEXT NOT NULL DEFAULT '';

-- 입금 계좌 · 약관 조건. 운영자가 플랫폼 설정 화면에서 입력한다.
INSERT INTO platform_settings (key, value, updated_by) VALUES
  ('deposit_bank_name', '', 'system'),
  ('deposit_account_number', '', 'system'),
  ('deposit_account_holder', '', 'system'),
  ('affiliate_unsettled_limit', '0', 'system')
ON CONFLICT (key) DO NOTHING;
