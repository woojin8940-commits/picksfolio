-- 판매 연동형(어필리에이트) 캠페인.
--
-- 공동구매(reward_mode='groupbuy')는 광고 캠페인 틀에 수수료율 칸 하나를 붙인
-- 것이었다. 판매량을 셀 방법이 없어서 담당자가 금액을 손으로 넣기 전에는 정산이
-- 생기지 않았다. 새 구조는 브랜드 자사몰(카페24)에서 실제로 일어난 주문을 세고,
-- 확정된 판매액 × 수수료율로 청구·지급한다.
--
--   브랜드 몰 연동 → 판매 캠페인(상품·수수료율) → 인플루언서 참여·승인 → 상품별 추적 링크
--   → 클릭 기록 → 몰의 추적 스크립트가 주문 신호 → 카페24 주문 API 로 검증 → 주문 장부
--   → 매일 상태 동기화(예정 → 확정 / 제외) → 매월 1일 마감 → 브랜드 승인 → 입금 → 지급
--
-- 정산은 기존 협업 정산(Blobs)에 섞지 않고 이 데이터베이스 안에서만 끝낸다. 협업
-- 정산은 브랜드·인플루언서 두 키를 차례로 쓰는 구조라 한쪽만 써지는 일이 있었다.
-- 여기서는 마감·승인·지급을 모두 한 트랜잭션으로 묶는다.
--
-- 기존 공동구매 캠페인은 운영자가 시험으로 올린 것뿐이다(실제 브랜드 등록 없음).
-- 행을 지우지 않고 소프트 삭제해 목록에서만 내린다.

-- 플랫폼 설정 -----------------------------------------------------------------
--
-- 운영자가 바꾸는 값. 수수료율은 캠페인 등록 시점 값을 캠페인 행에 복사해 두므로
-- 여기서 바꿔도 이미 등록된 캠페인에는 영향이 없다.
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (key, value, updated_by) VALUES
  ('affiliate_platform_rate', '5', 'system'),
  ('affiliate_auto_confirm_days', '14', 'system')
ON CONFLICT (key) DO NOTHING;

-- 누가 언제 무엇을 바꿨는지. 수수료율은 돈이 걸린 값이라 이력이 남아야 한다.
CREATE TABLE IF NOT EXISTS platform_setting_history (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 추적 스크립트 설치 상태 --------------------------------------------------------
--
-- 몰 연결 자체(토큰)는 별도 연동 작업의 cafe24_connections 가 갖는다. 여기에는
-- 이 기능이 몰에 심은 스크립트의 상태만 둔다.
CREATE TABLE IF NOT EXISTS affiliate_shop_scripts (
  shop_type TEXT NOT NULL DEFAULT 'cafe24',
  mall_id TEXT NOT NULL,
  business_username TEXT NOT NULL,
  -- auto: ScriptTags API 로 설치 · manual: 브랜드가 직접 붙였다고 표시 · none
  mode TEXT NOT NULL DEFAULT 'none' CHECK (mode IN ('auto', 'manual', 'none')),
  script_no TEXT NOT NULL DEFAULT '',
  installed_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  last_received_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_type, mall_id)
);

-- 판매 캠페인 -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_campaigns (
  id TEXT PRIMARY KEY,
  business_username TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  shop_type TEXT NOT NULL DEFAULT 'cafe24',
  mall_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  -- 브랜드가 내는 총 수수료(%). 이 안에서 플랫폼 몫을 뺀 나머지가 인플루언서 몫이다.
  commission_rate NUMERIC(5, 2) NOT NULL CHECK (commission_rate > 0 AND commission_rate <= 90),
  -- 등록 시점의 플랫폼 수수료율. 운영자가 설정을 바꿔도 이 값은 그대로다.
  platform_rate NUMERIC(5, 2) NOT NULL CHECK (platform_rate >= 0),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  -- approval: 신청 후 브랜드 승인(기본) · open: 누구나 바로 참여
  join_mode TEXT NOT NULL DEFAULT 'approval' CHECK (join_mode IN ('approval', 'open')),
  sample_offered BOOLEAN NOT NULL DEFAULT FALSE,
  sample_note TEXT NOT NULL DEFAULT '',
  follower_discount TEXT NOT NULL DEFAULT '',
  content_guide TEXT NOT NULL DEFAULT '',
  banned_phrases TEXT NOT NULL DEFAULT '',
  -- 광고 표기 안내. 서버가 넣는다(브랜드가 지울 수 없다).
  disclosure_text TEXT NOT NULL DEFAULT '',
  -- 관리자 승인 후 공개. pending_approval → active / rejected, active → ended
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'active', 'rejected', 'ended')),
  reject_reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  CHECK (platform_rate < commission_rate)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_campaigns_business ON affiliate_campaigns(business_username);
CREATE INDEX IF NOT EXISTS idx_affiliate_campaigns_status ON affiliate_campaigns(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_affiliate_campaigns_mall ON affiliate_campaigns(shop_type, mall_id);

-- 캠페인 상품. 등록 시점의 이름·가격·이미지·URL 을 저장한다(몰에서 바뀌어도 장부는 그대로).
CREATE TABLE IF NOT EXISTS affiliate_campaign_products (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES affiliate_campaigns(id) ON DELETE CASCADE,
  shop_product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  product_url TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, shop_product_id)
);

-- 참여 -------------------------------------------------------------------------
--
-- 승인제 캠페인은 신청 → 브랜드 승인 뒤에만 링크가 발급된다. 즉시 참여 캠페인은
-- 신청과 동시에 approved 로 들어간다.
CREATE TABLE IF NOT EXISTS affiliate_participations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES affiliate_campaigns(id) ON DELETE CASCADE,
  influencer_username TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked', 'cancelled')),
  reject_reason TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, influencer_username)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_participations_influencer ON affiliate_participations(influencer_username);

-- 추적 링크: 인플루언서 × 상품마다 하나.
CREATE TABLE IF NOT EXISTS affiliate_links (
  code TEXT PRIMARY KEY,
  participation_id TEXT NOT NULL REFERENCES affiliate_participations(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES affiliate_campaigns(id) ON DELETE CASCADE,
  campaign_product_id TEXT NOT NULL REFERENCES affiliate_campaign_products(id) ON DELETE CASCADE,
  influencer_username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (participation_id, campaign_product_id)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_influencer ON affiliate_links(influencer_username);

-- 클릭. 원본 IP·UA 는 남기지 않는다 — 서버 비밀값을 섞은 해시만 둔다.
-- counted=FALSE 는 봇이나 같은 방문자의 짧은 반복 클릭(집계 제외).
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_product_id TEXT NOT NULL,
  influencer_username TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT NOT NULL DEFAULT '',
  ua_hash TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  counted BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_code ON affiliate_clicks(code, clicked_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_campaign ON affiliate_clicks(campaign_id, clicked_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_dedupe ON affiliate_clicks(ip_hash, code, clicked_at);

-- 주문 장부 ----------------------------------------------------------------------
--
-- 고객 이름·연락처·주소·회원 아이디는 저장하지 않는다. 정산에 필요한 주문번호·금액·
-- 상태·품목만 둔다. 같은 주문번호는 한 번만 들어온다(UNIQUE).
--
-- 수수료 금액(brand_fee 등)은 "지금 이 주문이 확정되면 받을 금액"이다. 정산에 실제로
-- 들어간 금액은 affiliate_settlement_entries 의 합계이고, 둘의 차이가 다음 마감의
-- 정산(또는 차감) 대상이다 — 마감 뒤에 반품이 나도 지난 정산을 고치지 않는다.
CREATE TABLE IF NOT EXISTS affiliate_orders (
  id TEXT PRIMARY KEY,
  shop_type TEXT NOT NULL DEFAULT 'cafe24',
  mall_id TEXT NOT NULL,
  shop_order_id TEXT NOT NULL,
  code TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES affiliate_campaigns(id),
  influencer_username TEXT NOT NULL,
  business_username TEXT NOT NULL,
  -- 스크립트가 보낸 결제금액. 참고용일 뿐 계산에 쓰지 않는다.
  reported_amount INTEGER NOT NULL DEFAULT 0,
  -- unverified: 카페24 로 아직 확인 못 함(정산 제외) · verified · failed: 확인 불가 확정
  verification TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified', 'verified', 'failed')),
  verify_attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  ordered_at TIMESTAMPTZ,
  -- 캠페인 상품 품목의 실결제액 합(할인 후, 배송비 제외) − 반품·취소액
  gross_base INTEGER NOT NULL DEFAULT 0,
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  commission_base INTEGER NOT NULL DEFAULT 0,
  -- 캠페인에서 복사한 비율(주문이 들어온 시점 기준으로 고정)
  commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  platform_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  brand_fee INTEGER NOT NULL DEFAULT 0,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  influencer_fee INTEGER NOT NULL DEFAULT 0,
  -- pending=예정 · confirmed=확정 · excluded=제외
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'excluded')),
  status_reason TEXT NOT NULL DEFAULT '',
  shop_status TEXT NOT NULL DEFAULT '',
  delivered_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_type, mall_id, shop_order_id)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_orders_campaign ON affiliate_orders(campaign_id, ordered_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_orders_influencer ON affiliate_orders(influencer_username, ordered_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_orders_business ON affiliate_orders(business_username);
CREATE INDEX IF NOT EXISTS idx_affiliate_orders_open ON affiliate_orders(last_synced_at)
  WHERE status = 'pending' OR verification = 'unverified';

-- 품목. 부분 반품 차감과 "캠페인 상품만 수수료 대상"을 계산하려면 품목 단위가 필요하다.
CREATE TABLE IF NOT EXISTS affiliate_order_items (
  order_id TEXT NOT NULL REFERENCES affiliate_orders(id) ON DELETE CASCADE,
  shop_item_code TEXT NOT NULL,
  shop_product_id TEXT NOT NULL,
  campaign_product_id TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  refunded_quantity INTEGER NOT NULL DEFAULT 0,
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  item_status TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_id, shop_item_code)
);

-- 월 정산 ----------------------------------------------------------------------
--
-- 브랜드별 월 청구서(batch)와 그 안의 인플루언서별 지급 내역(line).
-- draft(집계) → brand_approved(브랜드 확인·승인) → paid_in(운영자 입금 확인)
-- → completed(모든 인플루언서 지급 완료). 세금계산서 자동 발행은 추후 연동한다.
CREATE TABLE IF NOT EXISTS affiliate_settlement_batches (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  business_username TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'brand_approved', 'paid_in', 'completed')),
  total_sales INTEGER NOT NULL DEFAULT 0,
  brand_fee INTEGER NOT NULL DEFAULT 0,
  vat INTEGER NOT NULL DEFAULT 0,
  billed_total INTEGER NOT NULL DEFAULT 0,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  influencer_gross INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  brand_approved_at TIMESTAMPTZ,
  brand_approved_by TEXT NOT NULL DEFAULT '',
  paid_in_at TIMESTAMPTZ,
  paid_in_by TEXT NOT NULL DEFAULT '',
  paid_in_amount INTEGER NOT NULL DEFAULT 0,
  invoice_no TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period, business_username)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_batches_business ON affiliate_settlement_batches(business_username);

CREATE TABLE IF NOT EXISTS affiliate_settlement_lines (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES affiliate_settlement_batches(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  business_username TEXT NOT NULL,
  influencer_username TEXT NOT NULL,
  sales_amount INTEGER NOT NULL DEFAULT 0,
  brand_fee INTEGER NOT NULL DEFAULT 0,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  influencer_gross INTEGER NOT NULL DEFAULT 0,
  -- 원천징수 3.3% = 소득세 3% + 지방소득세 0.3%(각각 원 단위 절사)
  income_tax INTEGER NOT NULL DEFAULT 0,
  local_tax INTEGER NOT NULL DEFAULT 0,
  withholding INTEGER NOT NULL DEFAULT 0,
  influencer_net INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TIMESTAMPTZ,
  paid_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, influencer_username)
);
CREATE INDEX IF NOT EXISTS idx_affiliate_lines_influencer ON affiliate_settlement_lines(influencer_username);

-- 어떤 주문이 어느 지급 내역에 얼마로 들어갔는지. 판매(sale)와 마감 후 반품 차감
-- (adjustment)이 모두 여기에 쌓인다. 주문별 합계가 "이미 정산된 금액"이다.
CREATE TABLE IF NOT EXISTS affiliate_settlement_entries (
  id BIGSERIAL PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES affiliate_settlement_lines(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES affiliate_orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'adjustment')),
  base_amount INTEGER NOT NULL DEFAULT 0,
  brand_fee INTEGER NOT NULL DEFAULT 0,
  platform_fee INTEGER NOT NULL DEFAULT 0,
  influencer_fee INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_entries_order ON affiliate_settlement_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_entries_line ON affiliate_settlement_entries(line_id);

-- 지급 정보 ----------------------------------------------------------------------
--
-- 판매 수수료는 협업 단위가 아니라 인플루언서 단위로 매달 지급되므로 계정에 한 번
-- 받아 둔다. 받는 것은 성명 · 주민등록번호 · 계좌뿐이다(신분증 사본은 받지 않는다).
-- 성명은 원천징수(3.3%) 신고 이름이자 예금주이고, 주민등록번호는 신고에 필요하다.
--
-- 주민등록번호는 평문으로 두지 않는다. 서버가 AES-256-GCM 으로 암호화한 값만 저장하고,
-- 화면에는 뒤 6자리를 가린 값(rrn_masked)만 내려간다. 원문은 운영자가 "지급 정보 보기"를
-- 누를 때만 복호화되고, 그 열람은 affiliate_pii_access_log 에 남는다.
CREATE TABLE IF NOT EXISTS influencer_payout_accounts (
  username TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL DEFAULT '',
  rrn_encrypted TEXT NOT NULL DEFAULT '',
  rrn_masked TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_pii_access_log (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  viewed_by TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_affiliate_pii_access_log_user ON affiliate_pii_access_log(username, viewed_at);

-- 기존 공동구매 캠페인 정리 --------------------------------------------------------
UPDATE campaigns
SET deleted_at = NOW(), updated_at = NOW()
WHERE reward_mode = 'groupbuy' AND deleted_at IS NULL;
