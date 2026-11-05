-- 어필리에이트 인플루언서 전용 링크와 주문.
--
-- 브랜드가 판매 신청을 승인하면 그 신청(affiliate_store_requests)에 링크 코드가 붙는다.
-- 고객은 /shop/<코드> 에서 픽스폴리오 안에서 주문 · 결제(포트원)하고, 결제가 확인된
-- 주문은 그 코드의 인플루언서 판매로 잡힌다. 수수료율 · 금액은 결제 시점 값으로 고정한다.
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS link_code TEXT;
ALTER TABLE affiliate_store_requests ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_store_requests_link_code_idx
  ON affiliate_store_requests (link_code) WHERE link_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS affiliate_store_orders (
  id TEXT PRIMARY KEY,                       -- 포트원 paymentId 와 같다
  request_id TEXT NOT NULL REFERENCES affiliate_store_requests(id),
  product_id TEXT NOT NULL REFERENCES affiliate_store_products(id),
  business_username TEXT NOT NULL,
  influencer_username TEXT NOT NULL,
  link_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL,
  commission_amount INTEGER NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  buyer_email TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  postcode TEXT NOT NULL DEFAULT '',
  address1 TEXT NOT NULL,
  address2 TEXT NOT NULL DEFAULT '',
  delivery_memo TEXT NOT NULL DEFAULT '',
  pay_method TEXT NOT NULL DEFAULT 'CARD',
  status TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | paid | shipped | delivered | cancelled
  pg_tx_id TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  tracking_company TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS affiliate_store_orders_brand_idx
  ON affiliate_store_orders (business_username, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_orders_influencer_idx
  ON affiliate_store_orders (influencer_username, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_orders_request_idx
  ON affiliate_store_orders (request_id, status);
