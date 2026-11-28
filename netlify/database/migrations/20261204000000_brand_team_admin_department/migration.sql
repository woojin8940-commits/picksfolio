-- 브랜드 직원의 부서와 관리자 권한.
--
-- department: 초대 링크로 가입할 때 직원이 직접 적는 부서. 관리자가 팀 목록에서 누구인지
--             알아보기 쉽게 이름과 함께 보여 준다.
-- is_admin:   회사 관리자가 직원을 관리자로 바꾸면 true. 직원 초대 · 계정 삭제 · 관리자 변경을
--             함께 할 수 있다(결제 · 좌석 결제 · 등급 변경은 회사 대표 계정만).
ALTER TABLE brand_team_members ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_team_members ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
