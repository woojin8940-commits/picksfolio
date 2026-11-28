-- 캠페인 담당자(회사 안에서 누가 맡은 캠페인인지).
--
-- 브랜드 회사 계정은 관리자 1명과 직원들이 함께 쓴다. 캠페인 메뉴에는 각자 맡은 캠페인만
-- 보이고, 진행이 확정된 인플루언서의 연락처도 그 캠페인 담당자에게만 보인다.
--
-- 값은 담당 직원의 아이디(brand_team_members.member_username)이고, 빈 문자열이면 회사
-- 관리자 계정이 맡은 캠페인이다. 이 칸이 생기기 전의 캠페인은 모두 관리자 담당이 된다.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS owner_member TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS campaigns_business_owner_member_idx
  ON campaigns (business_username, owner_member);
