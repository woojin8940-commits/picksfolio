-- 어필리에이트 스토어: 구매자 계정 · 마이페이지 · 주문 취소 · 교환/반품 · 문의.
--
-- 구매자는 카카오 로그인한 Supabase 사용자(auth user id)로 구분한다. 인플루언서 · 브랜드
-- 계정도 같은 사용자 ID 로 구매할 수 있다. 인플루언서 판매 집계는 지금처럼 링크 코드 기준이다.

-- 구매자 계정(처음 구매하려고 로그인한 사람) + 저장된 배송지.
CREATE TABLE IF NOT EXISTS affiliate_buyers (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',          -- 인플루언서 · 브랜드 계정이면 그 아이디(구매자 전용이면 '')
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_phone TEXT NOT NULL DEFAULT '',
  buyer_email TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL DEFAULT '',
  address2 TEXT NOT NULL DEFAULT '',
  delivery_memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 주문: 구매자 연결 · 상태 시각 · 취소 기록 · 수수료 상태.
-- status: pending_payment | paid(결제 완료) | preparing(배송 준비) | shipped(배송 중) | delivered(배송 완료)
--         | confirmed(구매확정) | return_requested(반품 요청 중) | cancelled(취소·환불 완료)
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS buyer_user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS cancelled_by TEXT NOT NULL DEFAULT '';   -- buyer | brand | operator
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS cancel_memo TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS refund_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS commission_status TEXT NOT NULL DEFAULT 'active'; -- active | cancelled
-- 취소 처리 중 표시. 포트원 취소를 한 번만 부르게 한다(두 번 눌러도 한 번).
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS cancel_lock_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS brand_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS affiliate_store_orders_buyer_idx
  ON affiliate_store_orders (buyer_user_id, created_at DESC);

-- 교환·반품 요청(주문당 하나 — 거절되면 같은 행을 다시 쓴다).
CREATE TABLE IF NOT EXISTS affiliate_store_returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES affiliate_store_orders(id),
  business_username TEXT NOT NULL,
  buyer_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,                        -- 단순 변심 | 상품 불량 | 오배송 | 기타
  memo TEXT NOT NULL DEFAULT '',
  photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'requested',    -- requested | approved | rejected | refunded
  return_address TEXT NOT NULL DEFAULT '',
  pickup_message TEXT NOT NULL DEFAULT '',
  reject_reason TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_store_returns_brand_idx
  ON affiliate_store_returns (business_username, status, requested_at);

-- 구매자 문의(상품 · 주문). 브랜드가 답한다.
CREATE TABLE IF NOT EXISTS affiliate_store_inquiries (
  id TEXT PRIMARY KEY,
  buyer_user_id TEXT NOT NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  business_username TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  order_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  answered_by TEXT NOT NULL DEFAULT '',        -- brand | operator:<아이디>
  answered_at TIMESTAMPTZ,
  buyer_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_store_inquiries_brand_idx
  ON affiliate_store_inquiries (business_username, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_inquiries_buyer_idx
  ON affiliate_store_inquiries (buyer_user_id, created_at DESC);

-- 주문 처리 내역(누가 · 언제 · 무엇을). 구매자 주문 상세의 진행 내역과 운영자 처리 기록에 쓴다.
CREATE TABLE IF NOT EXISTS affiliate_store_order_events (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,                    -- buyer | brand | operator | system
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_store_order_events_order_idx
  ON affiliate_store_order_events (order_id, created_at);

-- 화면 알림(브랜드 · 구매자 · 운영자). 푸시는 별도로 보낸다.
CREATE TABLE IF NOT EXISTS affiliate_store_notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_type TEXT NOT NULL,                -- brand | buyer | operator
  recipient TEXT NOT NULL,                     -- 브랜드 아이디 · 구매자 user id · 'operator'
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS affiliate_store_notifications_recipient_idx
  ON affiliate_store_notifications (recipient_type, recipient, created_at DESC);

-- 판매자 정보(상품 페이지 "판매자 정보 보기"에 그대로 보인다).
ALTER TABLE affiliate_store_applications ADD COLUMN IF NOT EXISTS ceo_name TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_applications ADD COLUMN IF NOT EXISTS business_address TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_applications ADD COLUMN IF NOT EXISTS cs_phone TEXT NOT NULL DEFAULT '';

-- 결제 가드. 'true' 가 아니면 테스트 계정만 결제할 수 있다. 운영 콘솔에서 바꾼다.
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO platform_settings (key, value, updated_by)
  VALUES ('affiliate_store_checkout_open', 'false', 'system')
ON CONFLICT (key) DO NOTHING;
