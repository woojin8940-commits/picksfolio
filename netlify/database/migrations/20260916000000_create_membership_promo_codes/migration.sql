-- 출시 혜택 코드(프로모션 코드).
--
-- 코드를 등록한 계정은 등록일로부터 free_months 개월 동안 해당 플랜을 무료로 쓰고,
-- 무료 기간이 끝나면 등록해 둔 카드로 정상 결제가 이어진다(정기결제 스케줄러가
-- next_billing_date 를 보고 청구하므로, 무료 기간은 "첫 청구일을 6개월 뒤로 미룬
-- 구독"으로 표현된다 — 별도의 만료 처리가 필요 없다).
CREATE TABLE IF NOT EXISTS membership_promo_codes (
  code TEXT PRIMARY KEY,
  plan TEXT NOT NULL CHECK (plan IN ('standard', 'standard_ai', 'commerce', 'pro')),
  free_months INTEGER NOT NULL DEFAULT 6 CHECK (free_months > 0 AND free_months <= 24),
  -- NULL = 인원 제한 없음(여러 명이 함께 쓰는 공용 코드).
  -- 숫자를 넣으면 그 횟수까지만 등록되고 이후에는 소진된 코드가 된다.
  max_redemptions INTEGER,
  redemptions INTEGER NOT NULL DEFAULT 0,
  -- 코드를 즉시 닫아야 할 때 false 로 바꾼다. 이미 등록한 사람의 남은 무료 기간에는
  -- 영향을 주지 않는다(무료 기간은 구독 레코드의 next_billing_date 가 들고 있다).
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- 이 시각 이후로는 새로 등록할 수 없다. NULL = 기한 없음.
  expires_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 한 계정은 출시 혜택을 한 번만 받는다.
--
-- username 을 기본키로 둔 것이 그 규칙 자체다 — 코드를 바꿔 다시 등록해서 무료 기간을
-- 계속 늘리는 경로가 데이터베이스 차원에서 막힌다(공용 코드라 코드당 제한만으로는
-- 같은 사람이 여러 번 등록하는 것을 막을 수 없다).
CREATE TABLE IF NOT EXISTS membership_promo_redemptions (
  username TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES membership_promo_codes(code) ON DELETE CASCADE,
  auth_user_id TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL,
  free_months INTEGER NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 무료 기간이 끝나고 첫 정상 결제가 나가는 시각(= 구독의 next_billing_date).
  free_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_membership_promo_redemptions_code
  ON membership_promo_redemptions (code);

-- 출시 혜택 공용 코드 — 프로 플랜 6개월 무료. 9자리 숫자이며 인원 제한이 없다.
INSERT INTO membership_promo_codes (code, plan, free_months, max_redemptions, note, created_by)
VALUES ('323039109', 'pro', 6, NULL, '출시 혜택 — 프로 플랜 6개월 무료 (공용 코드)', 'launch')
ON CONFLICT (code) DO NOTHING;
