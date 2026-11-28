-- 브랜드가 직접 요청한 인플루언서(캠페인 등록 때 "함께하고 싶은 인플루언서"에 적은 사람).
--
-- 담당자가 연락해 리스트업에 올린 후보 중 이 표시가 있으면, 캠페인당 2명까지는 진행이 확정돼도
-- 선정 인원 한도에서 빼 준다(brand_quota_usage 에 kind = 'brand_free' 로 남긴다).
-- 명단에 올릴 때 요청 목록과 아이디가 맞으면 자동으로 켜지고, 담당자가 직접 켜고 끌 수도 있다.
ALTER TABLE campaign_listups ADD COLUMN IF NOT EXISTS brand_requested BOOLEAN NOT NULL DEFAULT false;
