-- 협업 기록을 어디까지 봤는가.
--
-- 진행사항은 collab_events 에 한 줄씩 쌓인다(기획안 제출 · 피드백 · 배송 등록…).
-- 그런데 그 기록을 "읽었다"는 표시가 없어서, 상대가 무엇을 했는지 알려면 캠페인을
-- 열고 사람을 하나씩 눌러 봐야 했다. 인플루언서가 기획안을 올려도 브랜드는 모르고,
-- 브랜드가 피드백을 달아도 인플루언서는 다음에 들어올 때까지 몰랐다 — 협업
-- 타임라인(메시지)에만 안 읽은 표시가 있었기 때문에, 진행사항은 늘 뒤늦게 확인됐다.
--
-- 그래서 사람마다 "이 협업의 기록을 여기까지 봤다"는 시각 하나만 남긴다. 기록
-- 한 줄마다 읽음 표시를 붙이지 않는 이유는 두 가지다. 첫째, 진행사항은 메시지처럼
-- 한 줄씩 읽는 것이 아니라 화면을 열면 전부 보인다 — 열었으면 다 본 것이다.
-- 둘째, 협업 하나에 기록이 수십 줄 쌓이는데 줄마다 읽은 사람 목록을 들고 있으면
-- 안 읽은 수를 세는 일이 협업 수 x 기록 수가 된다.
--
-- 안 읽은 수 = 이 시각 이후에 상대가 남긴 기록의 수. 시각이 없으면(한 번도 열지
-- 않았으면) 상대가 남긴 기록 전부다.
CREATE TABLE IF NOT EXISTS collab_event_seen (
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  -- 보는 사람. 소문자로 정규화된 계정 이름(브랜드는 `biz/` 를 뗀 이름, 담당자는
  -- 담당자 계정). 역할을 함께 두지 않는 이유는, 같은 사람이 두 역할로 같은 협업을
  -- 볼 일이 없고 열었으면 그 사람은 다 본 것이기 때문이다.
  username TEXT NOT NULL,
  seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  PRIMARY KEY (collab_id, username)
);

-- 대시보드는 "내가 안 읽은 것이 몇 건인가"를 먼저 묻는다(메뉴의 빨간 표시).
CREATE INDEX IF NOT EXISTS idx_collab_event_seen_user ON collab_event_seen(username);
