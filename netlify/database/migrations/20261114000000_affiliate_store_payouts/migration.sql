-- 어필리에이트 스토어 정산(계좌 등록 · 지급 신청 · 운영자 지급 처리).
-- 기존 테이블은 지우거나 이름을 바꾸지 않고 컬럼만 더한다.
--
--   구매확정 → 지급 가능 금액에 적립 → 브랜드 · 인플루언서가 "지급 신청"(전액)
--   → 매월 1일~말일 신청분을 다음 달 10일(주말이면 다음 평일) 지급
--   → 운영자가 직접 이체한 뒤 "지급 완료" (반려하면 금액이 지급 가능 금액으로 돌아간다)
--
-- 주민등록번호 · 계좌번호는 평문으로 두지 않는다. 서버가 AES-256-GCM 으로 암호화한 값과
-- 가린 값(주민번호 뒤 6자리 가림 · 계좌 뒤 4자리)만 저장한다.

-- 1) 인플루언서 정산 정보(기존 테이블 재사용). account_number(평문) 칸은 쓰지 않고 비워 둔다.
ALTER TABLE influencer_payout_accounts ADD COLUMN IF NOT EXISTS account_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE influencer_payout_accounts ADD COLUMN IF NOT EXISTS account_last4 TEXT NOT NULL DEFAULT '';
ALTER TABLE influencer_payout_accounts ADD COLUMN IF NOT EXISTS account_holder TEXT NOT NULL DEFAULT '';
ALTER TABLE influencer_payout_accounts ADD COLUMN IF NOT EXISTS privacy_consented_at TIMESTAMPTZ;
ALTER TABLE influencer_payout_accounts ADD COLUMN IF NOT EXISTS privacy_consent_version TEXT NOT NULL DEFAULT '';

-- 2) 개인정보 열람 기록(기존 테이블 재사용). 누구의(party_type · username) 무엇을 왜(purpose · detail) 봤는지.
ALTER TABLE affiliate_pii_access_log ADD COLUMN IF NOT EXISTS party_type TEXT NOT NULL DEFAULT 'influencer';
ALTER TABLE affiliate_pii_access_log ADD COLUMN IF NOT EXISTS detail TEXT NOT NULL DEFAULT '';

-- 3) 브랜드 정산 정보.
--    holder_mismatch: 예금주가 입점 신청서의 상호 · 대표자명과 달라 운영자 확인이 필요한 계좌.
CREATE TABLE IF NOT EXISTS affiliate_brand_payout_accounts (
  business_username TEXT PRIMARY KEY,
  bank_name TEXT NOT NULL DEFAULT '',
  account_encrypted TEXT NOT NULL DEFAULT '',
  account_last4 TEXT NOT NULL DEFAULT '',
  account_holder TEXT NOT NULL DEFAULT '',
  bankbook_key TEXT NOT NULL DEFAULT '',         -- 통장 사본(비공개 Blobs 저장소 키)
  tax_invoice_email TEXT NOT NULL DEFAULT '',
  holder_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) 지급 신청. 신청 시점의 계좌 · 금액을 그대로 고정해 둔다.
--    order_amount: 포함된 주문 정산액 합계, deduction_amount: 차감액 합계(환원은 음수),
--    gross_amount = order_amount − deduction_amount (원천징수 전 신청 금액)
--    인플루언서: income_tax = floor(gross × 3%), local_tax = floor(income_tax × 10%), net = gross − 세금
--    브랜드: 세금 0, net = gross
CREATE TABLE IF NOT EXISTS affiliate_payout_requests (
  id TEXT PRIMARY KEY,
  party_type TEXT NOT NULL CHECK (party_type IN ('brand', 'influencer')),
  party TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'rejected', 'cancelled')),
  order_amount INTEGER NOT NULL DEFAULT 0,
  deduction_amount INTEGER NOT NULL DEFAULT 0,
  gross_amount INTEGER NOT NULL DEFAULT 0,
  income_tax INTEGER NOT NULL DEFAULT 0,
  local_tax INTEGER NOT NULL DEFAULT 0,
  net_amount INTEGER NOT NULL DEFAULT 0,
  scheduled_date TEXT NOT NULL,                  -- 'YYYY-MM-DD'(한국 시간)
  legal_name TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  account_encrypted TEXT NOT NULL DEFAULT '',
  account_last4 TEXT NOT NULL DEFAULT '',
  account_holder TEXT NOT NULL DEFAULT '',
  holder_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
  payout_method TEXT NOT NULL DEFAULT 'manual',  -- 'manual'(운영자 이체) · 나중에 'portone_partner' 등
  external_ref TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  paid_date TEXT NOT NULL DEFAULT '',
  paid_by TEXT NOT NULL DEFAULT '',
  rejected_at TIMESTAMPTZ,
  rejected_by TEXT NOT NULL DEFAULT '',
  reject_reason TEXT NOT NULL DEFAULT '',
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_payout_requests_party_idx
  ON affiliate_payout_requests (party_type, party, requested_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_payout_requests_status_idx
  ON affiliate_payout_requests (status, scheduled_date);

-- 5) 신청에 포함된 주문(신청 시점 금액 고정). active = 지급 대기 · 지급 완료 신청에 들어가 있음.
--    같은 주문은 같은 쪽(브랜드 · 인플루언서)에서 살아 있는 신청 하나에만 들어간다 → 두 번 지급되지 않는다.
CREATE TABLE IF NOT EXISTS affiliate_payout_items (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES affiliate_payout_requests(id),
  party_type TEXT NOT NULL,
  party TEXT NOT NULL,
  order_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  confirmed_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payout_items_active_order_idx
  ON affiliate_payout_items (party_type, order_id) WHERE active;
CREATE INDEX IF NOT EXISTS affiliate_payout_items_request_idx ON affiliate_payout_items (request_id);
CREATE INDEX IF NOT EXISTS affiliate_payout_items_party_idx ON affiliate_payout_items (party_type, party) WHERE active;

-- 6) 차감 내역. 지급 신청에 들어간 주문이 그 뒤 환불되면 줄어든 만큼 남겨 다음 신청에서 뺀다.
--    applied_request_id 가 비어 있으면 아직 빼지 않은 차감액. amount 가 음수면 환원(차감을 만든
--    신청이 취소 · 반려되어 이미 다른 신청에서 뺀 금액을 되돌려 줌).
CREATE TABLE IF NOT EXISTS affiliate_payout_deductions (
  id BIGSERIAL PRIMARY KEY,
  party_type TEXT NOT NULL,
  party TEXT NOT NULL,
  order_id TEXT NOT NULL,
  source_request_id TEXT NOT NULL,
  source_item_id BIGINT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  applied_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_payout_deductions_party_idx
  ON affiliate_payout_deductions (party_type, party, applied_request_id);
CREATE INDEX IF NOT EXISTS affiliate_payout_deductions_item_idx ON affiliate_payout_deductions (source_item_id);

-- 7) 운영 설정: 최소 신청 금액(원). 인플루언서는 원천징수 전 금액 기준.
INSERT INTO platform_settings (key, value, updated_by) VALUES
  ('affiliate_payout_min_influencer', '10000', 'system'),
  ('affiliate_payout_min_brand', '0', 'system')
ON CONFLICT (key) DO NOTHING;
