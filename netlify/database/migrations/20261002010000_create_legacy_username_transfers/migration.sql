-- 예전 아이디·비밀번호 계정의 유저네임을 카카오 계정으로 옮기는 승인 기록.
--
-- 인플루언서 로그인을 카카오 간편로그인 하나로 줄이면서, 예전 계정으로 쓰던 유저네임을
-- 카카오로 다시 가입한 본인이 그대로 쓸 수 있어야 한다. 유저네임은 profiles 에서
-- 고유하므로 그냥 두면 "이미 사용 중인 링크" 로 막힌다.
--
-- 아무나 남의 예전 유저네임을 가져가면 그 사람의 페이지·협업 기록이 넘어가므로 본인
-- 확인을 거친다. 카카오 휴대폰 번호가 예전 계정 번호와 같으면 바로 옮기고, 아니면
-- 운영자가 연락해 본인을 확인한 뒤 발급한 이전 코드를 넣어야 옮겨진다.
-- 코드 원문은 저장하지 않는다(code_hash = SHA-256).
CREATE TABLE IF NOT EXISTS legacy_username_transfers (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_user_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS legacy_username_transfers_username_idx
  ON legacy_username_transfers (username, created_at DESC);

-- 옮겨진 기록. 예전 계정 행은 지우지 않고 유저네임만 비켜 두므로(_legacy_...) 어느
-- 계정의 유저네임이 어느 카카오 계정으로 갔는지 여기서 되짚는다.
CREATE TABLE IF NOT EXISTS legacy_username_moves (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  method TEXT NOT NULL,                     -- 'phone' | 'code'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
