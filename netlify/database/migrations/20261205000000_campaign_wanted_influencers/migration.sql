-- 브랜드가 캠페인 등록 때 적는 "함께하고 싶은 인플루언서".
--
-- 픽스폴리오 담당자의 리스트업과 별개로, 브랜드가 이미 점찍어 둔 인플루언서가 있으면 인스타그램
-- 아이디 등을 적는다. 담당자가 직접 연락해 리스트업에 올린다.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS wanted_influencers TEXT NOT NULL DEFAULT '';
