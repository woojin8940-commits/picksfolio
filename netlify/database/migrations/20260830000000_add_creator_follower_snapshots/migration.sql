-- 인플루언서 팔로워 수 일별 스냅샷.
--
-- 인스타그램 그래프 API 는 "지금 팔로워 몇 명"만 알려준다. 어제 몇 명이었는지는
-- 물어볼 곳이 없다. 그래서 증감 추이를 보여 주려면 우리가 매일 한 줄씩 남겨 두는
-- 수밖에 없다. 배치를 켠 날부터만 값이 쌓이므로, 화면은 값이 없는 구간을
-- "데이터 수집 중"으로 말한다 — 0 으로 그리면 그날 팔로워가 전부 빠진 것으로 읽힌다.
--
-- 하루에 한 줄만 남긴다(username, captured_on). 배치가 두 번 돌거나, 인플루언서가
-- 인사이트 화면을 열어 그 자리에서 팔로워 수를 받아 온 경우에도 같은 날 줄이
-- 늘어나면 그래프에 같은 날짜가 여러 점으로 찍힌다. 나중 값이 그날의 값이다.
--
-- captured_on 은 한국 날짜(Asia/Seoul)다. UTC 로 찍으면 한국 새벽에 도는 배치가
-- 전날 줄을 덮어쓴다.
CREATE TABLE IF NOT EXISTS creator_follower_snapshots (
  username TEXT NOT NULL,
  captured_on DATE NOT NULL,
  followers INTEGER NOT NULL DEFAULT 0,
  -- 팔로잉도 같이 남긴다. 팔로워만 늘고 팔로잉이 함께 늘어난 계정은 맞팔로 부풀린
  -- 것일 수 있어, 나중에 이 둘을 나란히 봐야 할 때가 온다.
  following INTEGER NOT NULL DEFAULT 0,
  -- 'batch'  = 매일 도는 스냅샷 배치가 남긴 값
  -- 'live'   = 인플루언서가 인사이트 화면을 열어 그 자리에서 받아 온 값
  source TEXT NOT NULL DEFAULT 'batch',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (username, captured_on)
);

-- 그래프는 언제나 "한 사람의 최근 N일"을 읽는다.
CREATE INDEX IF NOT EXISTS idx_follower_snapshots_user_date
  ON creator_follower_snapshots(username, captured_on DESC);
