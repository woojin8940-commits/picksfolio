-- 담당자 계정과 리스트업 제시 조건.
--
-- 두 가지를 한 번에 연다. 둘 다 "담당자가 브랜드에게 명단을 내민다"는 같은 흐름의
-- 앞뒤라서 따로 두면 한쪽만 배포됐을 때 화면이 반쪽이 된다.
--
--   1) platform_managers  — 누가 담당자인가
--   2) campaign_listups 제시 조건 + campaigns 확정 기한 — 명단에 무엇이 적히는가

-- 1) 담당자 계정 -------------------------------------------------------------
--
-- 지금까지 "담당자"는 곧 관리자였다. 운영 콘솔(Netlify Identity)이나 Supabase
-- profiles.role = 'admin' 인 사람만 담당자 권한을 가졌다는 뜻이고, 그래서 담당자를
-- 한 명 늘리려면 서비스 전체를 볼 수 있는 관리자 계정을 하나 더 만들어야 했다.
-- 매출·정산·회원 정보까지 열어 주지 않으면 인플루언서 배정을 맡길 수 없는 구조다.
--
-- 그래서 역할을 분리한다. 일반 계정으로 가입해 쓰던 사람을 운영자가 이 표에 올리면
-- 그 계정은 담당자 권한만 얻는다. 관리자 권한은 그대로 관리자에게만 남는다.
--
-- profiles.role 을 고치지 않고 별도 표를 두는 이유:
--   * profiles 는 Supabase 쪽 스키마이고 캠페인·협업 데이터는 이 데이터베이스에 있다.
--     권한 판정이 두 데이터베이스에 걸치면 한쪽만 롤백됐을 때 권한이 어긋난다.
--   * 배정·해제 이력(누가 언제 왜)을 남길 자리가 role 컬럼 하나에는 없다. 담당자는
--     남의 캠페인과 인플루언서 연락처를 보는 자리라서 이력이 남아야 한다.
--
-- 해제는 행을 지우지 않고 active = FALSE 로 둔다. 지워 버리면 "이 캠페인을 배정한
-- 담당자가 누구였는지"를 나중에 되짚을 수 없다.
CREATE TABLE IF NOT EXISTS platform_managers (
  username TEXT PRIMARY KEY,
  display_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT DEFAULT '',
  assigned_by TEXT DEFAULT '',
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_by TEXT DEFAULT '',
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 권한 판정은 요청마다 일어난다. 활성 담당자만 훑도록 부분 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS idx_platform_managers_active
  ON platform_managers(username) WHERE active;

-- 2) 명단에 적히는 제시 조건 -------------------------------------------------
--
-- 지금 campaign_listups.offer 는 "브랜드가 고른 뒤 담당자가 인플루언서에게 보낸
-- 조건"이다. 즉 브랜드가 고르는 시점에는 비어 있다. 그런데 브랜드가 명단을 보고
-- 고르려면 그 전에 금액을 알아야 한다 — 팔로워 수만 보고 고르라고 하면 고를 수 없고,
-- 담당자에게 "이 사람 얼마예요"를 한 명씩 물어보게 된다.
--
-- 그래서 담당자가 명단에 올릴 때 함께 적는 제시 조건을 별도 컬럼으로 둔다.
-- offer 와 합치지 않는 이유는 승인 주체가 다르기 때문이다. 여기 적힌 값은 브랜드에게
-- 보여 주는 견적이고, offer 는 인플루언서와 합의된 최종 조건이다. 한 칸에 섞으면
-- 담당자가 협의 중에 금액을 조정한 순간 브랜드가 보고 고른 근거가 덮어써진다.
ALTER TABLE campaign_listups
  -- 브랜드가 보는 광고비(제시가).
  ADD COLUMN IF NOT EXISTS quoted_fee INTEGER DEFAULT 0,
  -- 2차 활용(재편집·광고 소재 전용) 추가 비용.
  ADD COLUMN IF NOT EXISTS quoted_second_use_fee INTEGER DEFAULT 0,
  -- 보장 조회수. 이 숫자와 quoted_fee 로 CPV 를 계산해 브랜드에게 보여 준다.
  -- CPV 를 따로 저장하지 않는 이유는 두 값 중 하나만 고쳐졌을 때 서로 어긋나기
  -- 때문이다 — 나눗셈은 화면에서 한다.
  ADD COLUMN IF NOT EXISTS guaranteed_views INTEGER DEFAULT 0,
  -- '인기' 같은 짧은 강조 문구. 담당자가 붙인다.
  ADD COLUMN IF NOT EXISTS badge TEXT DEFAULT '',
  -- 브랜드의 찜. brand_decision 과 분리한다 — 찜은 "나중에 다시 볼 사람"이고
  -- pick 은 "진행해 달라"는 요청이라서, 하나로 묶으면 담당자가 어느 쪽인지 모른다.
  ADD COLUMN IF NOT EXISTS brand_favorite BOOLEAN DEFAULT FALSE;

-- 3) 명단 확정 기한 -----------------------------------------------------------
--
-- 담당자가 만든 추천 조합은 오래 두면 못 쓴다. 인플루언서의 일정이 먼저 차고,
-- 캠페인 게시 일정은 그대로이기 때문이다. 그래서 브랜드가 언제까지 고르면 되는지를
-- 캠페인에 적어 두고 명단 화면에 남은 시간으로 보여 준다.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS listup_confirm_due TIMESTAMPTZ,
  -- 담당자가 명단을 브랜드에게 공개한 시점. 공개 전에는 브랜드 화면에 아무것도
  -- 뜨지 않아야 한다 — 만들다 만 명단을 브랜드가 먼저 보면 다시 물어보게 된다.
  ADD COLUMN IF NOT EXISTS listup_published_at TIMESTAMPTZ;
