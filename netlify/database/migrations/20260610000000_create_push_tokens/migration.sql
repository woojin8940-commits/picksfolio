-- Native push notification device tokens, one row per device.
-- Used to deliver immediate push alerts for new collaboration timeline (chat)
-- messages to the recipient's mobile app. The Expo push token is the primary
-- key so re-registering the same device updates (not duplicates) its owner.
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  user_type TEXT,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_username ON push_tokens(username);
