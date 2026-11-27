-- 브랜드 정액제의 직원 좌석.
-- 회사 관리자 계정(profiles.username = 회사 아이디)이 좌석을 사고, 빈 좌석마다 1회용 초대
-- 링크를 만들어 직원에게 보낸다. 직원은 링크로 자기 아이디 · 비밀번호를 만들어 가입하고,
-- 그 회사 워크스페이스로 들어간다. 좌석 수(결제)는 멤버십 레코드(블롭)에 있다.

CREATE TABLE IF NOT EXISTS brand_team_members (
  id BIGSERIAL PRIMARY KEY,
  company_username TEXT NOT NULL,
  member_user_id UUID NOT NULL,
  member_username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  team_role TEXT NOT NULL DEFAULT 'member',
  invite_id BIGINT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removed_by TEXT
);

-- 한 사람은 한 회사에만 속한다(내보내진 기록은 남긴다).
CREATE UNIQUE INDEX IF NOT EXISTS brand_team_members_active_user
  ON brand_team_members (member_user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS brand_team_members_company
  ON brand_team_members (company_username) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS brand_seat_invites (
  id BIGSERIAL PRIMARY KEY,
  company_username TEXT NOT NULL,
  -- 링크에 담긴 토큰은 저장하지 않고 SHA-256 해시만 둔다.
  token_hash TEXT NOT NULL UNIQUE,
  team_role TEXT NOT NULL DEFAULT 'member',
  label TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_user_id UUID,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS brand_seat_invites_company_open
  ON brand_seat_invites (company_username) WHERE used_at IS NULL AND revoked_at IS NULL;
