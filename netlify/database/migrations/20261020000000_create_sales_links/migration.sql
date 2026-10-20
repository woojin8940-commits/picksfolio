-- 브랜드 영업용 링크.
--
-- 운영자가 브랜드에게 보낼 인플루언서 명단을 링크 하나로 만든다. 명단에는 브랜드
-- 매칭 받기에 등록한 인플루언서뿐 아니라 등록하지 않은 계정도 들어간다. 그래서
-- 각 줄은 등록서를 가리키지 않고, 링크에 담는 순간의 프로필(팔로워·팔로잉·최근
-- 릴스 3편)을 이 표에 따로 굳혀 둔다. 기존 명단·등록서는 건드리지 않는다.
--
-- 단가는 두 칸이다. base_price 는 인플루언서에게 주는 금액(운영자만 본다), price 는
-- 마진을 붙여 브랜드에게 보이는 금액이다. 공개 링크는 price 만 내려 준다.

CREATE TABLE IF NOT EXISTS sales_links (
  id TEXT PRIMARY KEY,
  -- 공개 주소에 들어가는 값. 추측할 수 없게 길게 만든다.
  token TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  brand_name TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_link_influencers (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES sales_links(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- 'registered' = 브랜드 매칭 등록자에서 가져옴, 'external' = 프로필 링크로 추가
  source TEXT NOT NULL DEFAULT 'external',
  application_id TEXT NOT NULL DEFAULT '',
  instagram_handle TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  profile_image_url TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  followers INTEGER NOT NULL DEFAULT 0,
  following INTEGER NOT NULL DEFAULT 0,
  -- [{ id, permalink, thumbnailUrl }] 최대 3개
  recent_reels JSONB NOT NULL DEFAULT '[]'::jsonb,
  base_price INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0,
  price_note TEXT NOT NULL DEFAULT '',
  -- 운영자 메모. 공개 링크에는 나가지 않는다.
  memo TEXT NOT NULL DEFAULT '',
  fetch_error TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_link_influencers_link ON sales_link_influencers(link_id, sort_order);
