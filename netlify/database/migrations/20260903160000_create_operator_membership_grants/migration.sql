CREATE TABLE IF NOT EXISTS operator_membership_grants (
  auth_user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL CHECK (plan IN ('standard', 'standard_ai', 'commerce', 'pro')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by TEXT NOT NULL DEFAULT '',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_membership_grants_username
  ON operator_membership_grants (LOWER(username));
