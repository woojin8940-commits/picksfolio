-- 캠페인 진행 방식과 규모별 모집 인원.
--
-- 예전에는 패키지(package_tier)가 1인 단가를 정하고, 모집 인원은 예산 ÷ 단가로
-- 계산됐다. 그 나눗셈이 실제 섭외와 맞지 않아 패키지를 걷어내고 두 값을 직접 받는다.
--
--   reward_mode  진행 방식. 'paid' 는 광고비 지급형(구성안·콘텐츠 검수와 정산이 붙는다),
--                'barter' 는 제품 협찬형(광고비 없이 제품만 제공하므로 정산이 없다).
--                기존 캠페인은 모두 광고비를 지급했으므로 'paid' 가 기본값이다.
--
--   tier_counts  규모별 모집 인원. 'nano:10,micro:3,mega:1' 처럼 규모:인원을 쉼표로 잇는다.
--                컬럼을 규모마다 따로 두지 않은 것은 규모 구분이 앞으로 바뀔 수 있어서다 —
--                구간이 하나 늘 때마다 마이그레이션을 다시 돌리지 않아도 된다.
--
-- package_tier 는 남겨 둔다. 이미 등록된 캠페인이 그 값으로 협업 단계를 만들었고,
-- 협업 단계 템플릿은 reward_mode 가 없으면 package_tier 로 되돌아가 판단한다.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reward_mode TEXT DEFAULT 'paid';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tier_counts TEXT DEFAULT '';

-- 진행 방식별로 캠페인을 갈라 보는 목록 화면이 있다.
CREATE INDEX IF NOT EXISTS idx_campaigns_reward_mode ON campaigns(reward_mode);
