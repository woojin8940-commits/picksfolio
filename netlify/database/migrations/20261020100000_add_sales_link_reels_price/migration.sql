-- 영업 링크 단가를 피드 / 릴스로 나눈다.
--
-- 기존 base_price·price 는 피드(게시물) 단가로 그대로 쓰고, 릴스 단가 두 칸을 더한다.
-- reels_base_price 는 인플루언서에게 주는 금액(운영자만 본다), reels_price 는 브랜드에게
-- 보이는 금액이다.

ALTER TABLE sales_link_influencers ADD COLUMN IF NOT EXISTS reels_base_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_link_influencers ADD COLUMN IF NOT EXISTS reels_price INTEGER NOT NULL DEFAULT 0;

-- 매칭 등록자 중 숏폼 단가만 적은 사람은 기존 단가가 숏폼 금액이었다. 릴스 칸으로 옮긴다.
UPDATE sales_link_influencers s
SET reels_base_price = s.base_price, reels_price = s.price, base_price = 0, price = 0
FROM collab_directory_applications a
WHERE s.source = 'registered' AND s.application_id = a.id
  AND COALESCE(a.post_price, '') = '' AND COALESCE(a.short_price, '') <> ''
  AND s.reels_price = 0;
