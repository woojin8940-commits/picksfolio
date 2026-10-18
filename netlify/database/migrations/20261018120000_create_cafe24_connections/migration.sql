-- 카페24 몰 연결(OAuth).
--
-- 판매 연동형 캠페인(affiliate_*)은 이 표를 읽어 상품을 가져오고 주문을 검증한다
-- (_shared/cafe24-api.mts). 연결은 몰 하나당 한 행이다 — 카페24 는 토큰을 갱신할
-- 때마다 이전 refresh token 을 폐기하므로, 같은 몰의 토큰이 두 벌 있으면 한쪽이 곧
-- 무효가 된다.
--
-- access_token · refresh_token 은 평문으로 두지 않는다. AFFILIATE_PII_KEY 로 만든 키로
-- AES-256-GCM 암호화한 값('t1.<iv>.<tag>.<암호문>')만 저장하고, 몰 아이디를 추가 인증
-- 데이터로 묶어 다른 행으로 옮겨 붙여도 풀리지 않게 한다. 연동 해제 시에는 빈 값으로 지운다.
CREATE TABLE IF NOT EXISTS cafe24_connections (
  id BIGSERIAL PRIMARY KEY,
  business_username TEXT NOT NULL,
  mall_id TEXT NOT NULL UNIQUE,
  -- 동의한 카페24 운영자 아이디 · 멀티쇼핑몰 번호(토큰 응답 값)
  user_id TEXT NOT NULL DEFAULT '',
  shop_no TEXT NOT NULL DEFAULT '1',
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  issued_at TIMESTAMPTZ,
  -- active: 사용 가능 · expired: 갱신 실패(재연동 필요) · revoked: 브랜드가 연동 해제
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cafe24_connections_business_idx ON cafe24_connections (business_username);
-- 하루 한 번 리프레시 만료가 가까운 연결을 미리 갱신한다.
CREATE INDEX IF NOT EXISTS cafe24_connections_refresh_due_idx
  ON cafe24_connections (refresh_token_expires_at) WHERE status = 'active';

-- OAuth state. 연동을 시작한 브랜드 · 몰에 묶이고 10분 뒤 만료되며 한 번만 쓸 수 있다.
-- 콜백은 used_at 이 비어 있고 만료 전인 행을 한 문장으로 사용 처리해야 통과한다.
CREATE TABLE IF NOT EXISTS cafe24_oauth_states (
  state TEXT PRIMARY KEY,
  business_username TEXT NOT NULL,
  mall_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cafe24_oauth_states_expires_idx ON cafe24_oauth_states (expires_at);
