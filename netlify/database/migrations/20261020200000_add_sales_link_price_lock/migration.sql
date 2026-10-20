-- 영업 링크 단가를 운영자가 정한 금액 그대로 지킨다.
--
-- 매칭 등록자 줄은 화면에 낼 때마다 등록서의 숏폼 단가로 릴스 원가를 바꾸고 마진만 얹었다.
-- 그래서 등록자가 단가를 고치면, 운영자가 저장한 제안가와 다른 금액이 브랜드에게 보였다.
-- 이제 운영자가 단가를 저장한 칸(price_locked / reels_price_locked)은 저장한 금액 그대로
-- 내고, 손대지 않은 칸만 등록서 단가를 따라간다.
--
-- 등록서를 취소하고 다시 접수하면 등록서 id 가 바뀌어 연동이 끊겼다. 사람(계정)으로 다시
-- 찾을 수 있게 등록자 계정명을 함께 적어 둔다.

ALTER TABLE sales_link_influencers ADD COLUMN IF NOT EXISTS applicant_username TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_link_influencers ADD COLUMN IF NOT EXISTS price_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales_link_influencers ADD COLUMN IF NOT EXISTS reels_price_locked BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE sales_link_influencers s
SET applicant_username = LOWER(REGEXP_REPLACE(COALESCE(a.applicant_username, ''), '^biz/', ''))
FROM collab_directory_applications a
WHERE s.source = 'registered' AND s.application_id = a.id AND s.applicant_username = '';

-- 마진을 붙여 둔 칸은 운영자가 정한 금액이다.
UPDATE sales_link_influencers
SET price_locked = (price <> base_price), reels_price_locked = (reels_price <> reels_base_price)
WHERE source = 'registered';
