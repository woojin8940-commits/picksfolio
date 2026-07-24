-- 함께 방송 친구를 "요청 → 수락" 흐름으로 바꾼다.
--
-- 기존 live_friends 는 owner 가 friend 를 일방적으로 저장하는 단방향 엣지였다.
-- 이제 한 사람이 친구를 추가하면 상대에게 수락 요청이 가고, 상대가 수락해야
-- 양쪽 친구 목록에 서로가 나타난다. 이를 위해 상태 컬럼을 추가한다.
--
--   status = 'pending'   owner_username(요청자)이 friend_username(수신자)에게
--                        친구 요청을 보냈고 아직 수락 전.
--   status = 'accepted'  수신자가 수락함 → 양방향 친구.
--
-- 기존 행은 이미 맺어진 관계이므로 'accepted' 로 기본값을 준다(하위 호환).
-- owner_username 은 언제나 요청을 보낸 쪽을 의미한다.

ALTER TABLE live_friends ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE live_friends ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 수신자 기준으로 들어온 요청을 빠르게 조회하기 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_live_friends_friend ON live_friends(friend_username);
CREATE INDEX IF NOT EXISTS idx_live_friends_status ON live_friends(status);
