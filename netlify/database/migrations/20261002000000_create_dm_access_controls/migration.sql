-- 인플루언서 자동 디엠 이용 관리.
--
-- 인플루언서의 자동 디엠은 결제가 아니라 "브랜드 매칭받기" 등록으로 열린다. 시간이
-- 지났다고 자동으로 막지는 않는다 — 제안을 못 받은 것은 운영 쪽 사정일 수 있다.
-- 대신 제안을 계속 거절하는 사람은 담당자가 관리 화면에서 보고 직접 중단한다.
--
-- 중단한 사람이 담당자가 리스트업한 유가시딩(광고비 지급형) 제안을 수락하면 자동으로
-- 다시 열린다. 한 사람당 한 행이고, 누가 언제 무엇을 했는지는 events 에 쌓는다.
CREATE TABLE IF NOT EXISTS dm_access_controls (
  username TEXT PRIMARY KEY,
  suspended BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',             -- 담당자 메모(중단 여부와 별개로 남긴다)
  suspended_by TEXT NOT NULL DEFAULT '',
  suspended_at TIMESTAMPTZ,
  reopened_by TEXT NOT NULL DEFAULT '',     -- 'auto:listup' 이면 제안 수락으로 자동 재개
  reopened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dm_access_controls_suspended_idx
  ON dm_access_controls (suspended);

CREATE TABLE IF NOT EXISTS dm_access_events (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  action TEXT NOT NULL,                     -- 'suspend' | 'reopen' | 'auto_reopen' | 'note'
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dm_access_events_username_idx
  ON dm_access_events (username, created_at DESC);
