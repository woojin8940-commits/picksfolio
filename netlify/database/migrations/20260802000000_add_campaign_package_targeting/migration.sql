-- 캠페인 등록을 "고르는 일"로 바꾸기 위한 컬럼.
--
-- 지금 등록 화면은 다섯 단계에 걸쳐 스무 칸을 직접 적게 한다. 제목, 소개, 보상
-- 유형, 광고비, 모집 인원, 모집 시작일, 모집 종료일, 콘텐츠 형식, 2차 활용 비용과
-- 범위... 브랜드가 처음 캠페인을 올릴 때 이 값들을 스스로 정할 수 있는 경우는 거의
-- 없다. 정하지 못하면 비워 두고, 비워 둔 칸은 담당자가 다시 물어본다.
--
-- 그래서 방향을 뒤집는다. 브랜드는 "어떤 패키지로 진행할지"를 고르고, 그 선택에서
-- 단가·진행 단계·2차 활용 조건이 따라 나온다. 직접 적는 것은 제품과 예산, 그리고
-- 어떤 인플루언서를 원하는지뿐이다.
--
--   package_tier : full(올인원 풀패키지) / lite(알뜰 패키지) / seeding(유가 시딩)
--                  단가와 진행 단계가 여기서 정해진다. 풀패키지는 대본·영상·최종본
--                  검수를 모두 거치고, 알뜰은 대본 검수를 빼고, 시딩은 검수 없이
--                  가이드와 업로드만 남는다.
--
-- 예산을 budget_krw 로 따로 두는 이유는 reward_amount 가 TEXT 이고 "인플루언서 1명
-- 단가"를 담고 있기 때문이다. 총 예산과 1인 단가는 다른 값이고, 둘을 한 칸에 두면
-- 모집 인원을 계산할 수 없다. (인원 = 예산 / 단가)
--
-- 시딩은 예산 대신 건수로 집행한다(1건 10만원 × N건). 같은 컬럼에 넣으면 화면이
-- 무엇을 보여줘야 하는지 알 수 없어서 seeding_count 를 나눠 둔다.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS package_tier TEXT DEFAULT 'full',
  -- 인플루언서에게 제품을 어떻게 주는지. 배송이 필요하면 주소를 받아야 하고,
  -- 방문형이면 일정을 잡아야 한다 — 담당자가 선정 직후 확인해야 하는 값이다.
  ADD COLUMN IF NOT EXISTS product_provide TEXT DEFAULT 'provide',
  -- 광고 목적. awareness(인지도) / engagement(참여) / conversion(전환).
  -- 목적에 따라 담당자가 추천하는 인플루언서가 달라진다.
  ADD COLUMN IF NOT EXISTS ad_objective TEXT DEFAULT 'awareness',
  -- 총 광고 집행 예산(원). 1인 단가는 reward_amount 에 그대로 둔다.
  ADD COLUMN IF NOT EXISTS budget_krw INTEGER DEFAULT 0,
  -- 유가 시딩 집행 건수.
  ADD COLUMN IF NOT EXISTS seeding_count INTEGER DEFAULT 0,
  -- 대본 단계를 빼고 일정을 앞당기는 요청. 알뜰 패키지의 기본 동작과 같지만,
  -- 풀패키지에서도 급할 때 쓸 수 있어야 해서 별도 플래그로 둔다.
  ADD COLUMN IF NOT EXISTS fast_track BOOLEAN DEFAULT FALSE,

  -- 희망 인플루언서 조건. 담당자가 리스트업을 만들 때 읽는 값이다.
  -- 여러 개를 고를 수 있는 항목은 쉼표로 이어 둔다 — 별도 표로 빼면 조회할 때마다
  -- 조인이 붙지만, 이 값들은 항상 캠페인과 함께 읽히고 따로 검색되지 않는다.
  ADD COLUMN IF NOT EXISTS influencer_gender TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS influencer_ages TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS sns_category TEXT DEFAULT '',
  -- nano / micro / macro / mega. 팔로워 규모별 단가 구간과 짝을 이룬다.
  ADD COLUMN IF NOT EXISTS follower_tiers TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS min_views INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS influencer_styles TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS exclude_keywords TEXT DEFAULT '';

-- 패키지별 집계(관리자 화면, 단가 정산)를 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_campaigns_package_tier ON campaigns(package_tier);
