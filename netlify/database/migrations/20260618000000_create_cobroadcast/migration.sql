-- Co-broadcast ("함께 방송하기") — friends + invite sessions.
--
-- Two creators can broadcast together (Method A: each host keeps streaming on
-- their own channel, and viewers subscribe to both channels and see a split
-- screen). This needs two small pieces of persistent state:
--
--   live_friends         a directed friendship edge so a host can invite a
--                        previously-saved partner from a list instead of
--                        retyping their (unique) username every time.
--
--   cobroadcast_sessions the lightweight record that ties two channels into one
--                        co-broadcast and tracks the invite lifecycle
--                        (pending → accepted → live → ended/declined). It must
--                        survive while the invitee is offline and be queryable
--                        by viewers to discover the partner channel, so it lives
--                        in Postgres rather than the ephemeral signaling mailbox.

CREATE TABLE IF NOT EXISTS live_friends (
  id SERIAL PRIMARY KEY,
  owner_username TEXT NOT NULL,
  friend_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_username, friend_username)
);

CREATE INDEX IF NOT EXISTS idx_live_friends_owner ON live_friends(owner_username);

CREATE TABLE IF NOT EXISTS cobroadcast_sessions (
  id TEXT PRIMARY KEY,
  host_username TEXT NOT NULL,
  guest_username TEXT NOT NULL,
  -- pending: host invited, awaiting guest. accepted: guest said yes, not both
  -- live yet. live: both broadcasting. declined: guest refused. ended: finished
  -- or cancelled.
  status TEXT NOT NULL DEFAULT 'pending',
  invite_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cobroadcast_host ON cobroadcast_sessions(host_username);
CREATE INDEX IF NOT EXISTS idx_cobroadcast_guest ON cobroadcast_sessions(guest_username);
CREATE INDEX IF NOT EXISTS idx_cobroadcast_status ON cobroadcast_sessions(status);
