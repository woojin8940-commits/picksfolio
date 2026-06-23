-- 캠페인 협업 "매칭 받기"(collab_directory_applications) 인플루언서 지원서에
-- 채널별 팔로워 수와 콘텐츠 유형별 단가를 분리해서 저장하기 위한 컬럼 추가.
-- 기존 단일 follower_count(정렬/구간 분류용)와 ad_price(표기용)는 그대로 유지하고,
-- 백엔드가 아래 채널별 값으로부터 둘을 파생해 채운다.
ALTER TABLE collab_directory_applications ADD COLUMN IF NOT EXISTS instagram_followers INTEGER DEFAULT 0; -- 인스타 팔로워(수기 입력)
ALTER TABLE collab_directory_applications ADD COLUMN IF NOT EXISTS youtube_followers INTEGER DEFAULT 0;   -- 유튜브 구독자(수기 입력)
ALTER TABLE collab_directory_applications ADD COLUMN IF NOT EXISTS tiktok_followers INTEGER DEFAULT 0;    -- 틱톡 팔로워(수기 입력)
ALTER TABLE collab_directory_applications ADD COLUMN IF NOT EXISTS post_price TEXT DEFAULT '';            -- 게시물 단가
ALTER TABLE collab_directory_applications ADD COLUMN IF NOT EXISTS short_price TEXT DEFAULT '';           -- 숏폼 단가
