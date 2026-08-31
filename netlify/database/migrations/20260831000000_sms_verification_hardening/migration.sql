-- 휴대폰 인증 표에 "언제 인증됐는지"와 "이미 썼는지"를 기록한다.
--
-- 지금까지 아이디 찾기 · 비밀번호 재설정은 sms_verifications 의 verified 플래그만
-- 보고 통과시켰고, 유효 시간은 expires_at(= 문자를 *보낸* 시각 + 5분)으로 쟀다.
-- 그래서 두 가지가 어긋나 있었다.
--
--  1. 인증 시각을 아무도 기록하지 않아, 실제로 인증한 시점이 아니라 발송 시점을
--     기준으로 창이 열렸다.
--  2. 한 번 verified 가 된 줄은 계속 남아 있어, 같은 인증으로 비밀번호를 몇 번이고
--     다시 바꿀 수 있었다.
--
-- verified_at 은 verify-sms 가 코드를 실제로 맞췄을 때만 채운다. 그러므로 기존에
-- verified = TRUE 로 남아 있는 줄은 verified_at 이 NULL 이고, 새 판정에서는 전부
-- 인증되지 않은 것으로 취급된다 — 과거에 잘못 세워진 플래그를 되돌리는 것이
-- 목적이므로 채워 넣지 않는다(백필 없음).
--
-- consumed_at 은 그 인증을 근거로 실제 조치(비밀번호 변경 등)를 한 시각이다.
-- 채워지면 그 줄은 다시 쓸 수 없다.
ALTER TABLE sms_verifications
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN sms_verifications.verified_at IS
  '인증번호가 실제로 일치한 시각. verify-sms 만 채운다. NULL 이면 아직(또는 한 번도) 인증되지 않은 줄이다.';
COMMENT ON COLUMN sms_verifications.consumed_at IS
  '이 인증을 근거로 조치(비밀번호 재설정 · 아이디 조회 등)를 수행한 시각. 채워진 줄은 재사용할 수 없다.';

-- 인증 완료 · 미사용 줄을 최신순으로 찾는 조회를 받쳐 준다.
CREATE INDEX IF NOT EXISTS idx_sms_verifications_verified_at
  ON sms_verifications (phone, purpose, verified_at DESC);
