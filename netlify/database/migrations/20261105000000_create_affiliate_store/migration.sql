-- 어필리에이트 스토어(ZVZO 방식). 카페24 연동 없이 플랫폼 안에서 상품을 올린다.
--
--   1) 브랜드가 입점 신청서를 낸다(사업자 · 브랜드 · 담당자 정보).
--   2) 운영자가 승인하면 브랜드의 어필리에이트 메뉴가 열린다.
--   3) 브랜드가 상품(정보 · 가격 · 재고 · 수수료)을 등록한다.
--   4) 인플루언서가 판매중인 상품을 보고 판매 신청을 낸다 → 브랜드가 승인/반려한다.

CREATE TABLE IF NOT EXISTS affiliate_store_applications (
  id TEXT PRIMARY KEY,
  business_username TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  business_number TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  channel_url TEXT NOT NULL,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_name TEXT NOT NULL,
  contact_position TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'approved' | 'rejected'
  reject_reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS affiliate_store_applications_status_idx
  ON affiliate_store_applications (status, created_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_store_products (
  id TEXT PRIMARY KEY,
  business_username TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ "name": "색상/사이즈", "stock": 10 }]
  retail_price INTEGER NOT NULL DEFAULT 0,      -- 정가(소비자가)
  sale_price INTEGER NOT NULL DEFAULT 0,        -- 판매가
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0, -- 인플루언서 수수료(%)
  stock INTEGER NOT NULL DEFAULT 0,
  shipping_fee INTEGER NOT NULL DEFAULT 0,
  product_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'on_sale' | 'paused'
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS affiliate_store_products_brand_idx
  ON affiliate_store_products (business_username, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_products_status_idx
  ON affiliate_store_products (status, created_at DESC);

CREATE TABLE IF NOT EXISTS affiliate_store_requests (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES affiliate_store_products(id) ON DELETE CASCADE,
  business_username TEXT NOT NULL,
  influencer_username TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  channel_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'approved' | 'rejected' | 'cancelled'
  brand_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, influencer_username)
);

CREATE INDEX IF NOT EXISTS affiliate_store_requests_brand_idx
  ON affiliate_store_requests (business_username, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_store_requests_influencer_idx
  ON affiliate_store_requests (influencer_username, created_at DESC);
