-- 크리에이터 지원서에 숏폼 광고 단가(원, 부가세 별도 여부는 인플루언서 입력 그대로)를 받는다.
ALTER TABLE creator_applications ADD COLUMN IF NOT EXISTS short_price INTEGER;
