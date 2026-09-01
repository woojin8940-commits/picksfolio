-- 캠페인 성과(조회수 · 좋아요 · 댓글)를 굳혀 두는 표.
--
-- 지금까지 캠페인 인사이트 화면은 "집계 전"이라는 말만 있었다. 업로드 단계에서
-- 게시물 주소(campaign_collabs.upload_url)는 받아 두었지만, 그 게시물이 얼마나
-- 보였는지는 아무도 세지 않았다. 브랜드는 결국 인플루언서에게 캡처를 받아 보고,
-- 담당자는 그 캡처를 옮겨 적었다.
--
-- 그 숫자를 받아올 곳은 이미 있다. 인플루언서가 캠페인용으로 연동해 둔 인스타그램
-- 계정(스코프 'collab')의 토큰으로 자기 게시물의 like_count · comments_count 와
-- 인사이트 views 를 조회할 수 있다. 이 표는 그 조회 결과를 협업 1건당 한 줄로 굳힌다.
--
-- ── 왜 캐시가 아니라 표인가 ──
-- 메타는 시간당 호출 한도가 있고, 게시물이 지워지거나 계정 연동이 끊기면 그 숫자는
-- 두 번 다시 받을 수 없다. 한 번 관측한 값은 남겨 두어야 정산 근거로 쓸 수 있다.
--
-- ── NULL 과 0 을 구분한다 ──
-- views 를 NULL 로 두는 것은 "메타가 조회수를 주지 않았다"는 뜻이고 0 은 "아무도
-- 보지 않았다"는 뜻이다. 둘을 같은 값으로 접으면 앱 심사 권한이 없는 계정의 게시물이
-- 조회수 0 으로 읽히고, 그 0 이 CPV 의 분모로 들어간다.

CREATE TABLE IF NOT EXISTS collab_post_metrics (
  collab_id TEXT PRIMARY KEY REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  -- 캠페인 단위 합계를 낼 때 협업 표를 다시 조인하지 않도록 함께 들고 있는다.
  campaign_id TEXT NOT NULL,
  creator_username TEXT NOT NULL DEFAULT '',

  -- 관측 대상 게시물. permalink 는 인플루언서가 업로드 단계에 적은 주소이고,
  -- media_id 는 그 주소를 메타 미디어 목록에서 찾아 맞춘 값이다. 한 번 찾으면
  -- 다음 갱신부터는 목록을 다시 훑지 않고 이 id 로 바로 조회한다.
  permalink TEXT NOT NULL DEFAULT '',
  media_id TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  posted_at TIMESTAMPTZ,

  views INTEGER,
  likes INTEGER,
  comments INTEGER,

  -- 'meta_api'      = 게시물 주인의 토큰으로 받은 값
  -- 'channel_cache' = 연동이 없어, 인플루언서 채널에 저장된 최근 게시물에서 맞춘 값
  --                   (마지막 동기화 시점의 숫자다 — 연동으로 받은 값보다 오래될 수 있다)
  -- 'unlinked'  = 계정 연동도 채널 자료도 없어 받지 못함 (숫자는 NULL)
  -- 'not_found' = 연동은 있으나 그 계정의 게시물에서 주소를 찾지 못함
  -- 'error'     = 메타가 거절했다 (사유는 note)
  source TEXT NOT NULL DEFAULT 'meta_api',
  note TEXT NOT NULL DEFAULT '',
  -- 마지막으로 조회를 시도한 시각. 성공·실패 모두 남긴다(실패를 남기지 않으면
  -- 화면을 열 때마다 죽은 연동에 다시 물어보게 된다).
  collected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_post_metrics_campaign
  ON collab_post_metrics(campaign_id);
CREATE INDEX IF NOT EXISTS idx_collab_post_metrics_collected
  ON collab_post_metrics(collected_at);

-- 일자별 추이.
--
-- 인스타그램은 "지금 조회수 몇"만 알려 준다. 어제 몇이었는지는 물어볼 곳이 없어서,
-- 팔로워 스냅샷(creator_follower_snapshots)과 같은 방식으로 우리가 하루 한 줄씩
-- 남긴다. 배치를 켠 날부터만 값이 쌓이므로 화면은 점이 하나뿐인 구간을 선으로
-- 잇지 않는다.
--
-- captured_on 은 한국 날짜(Asia/Seoul)다. UTC 로 찍으면 한국 새벽에 도는 배치가
-- 전날 줄을 덮어쓴다.
CREATE TABLE IF NOT EXISTS collab_post_metric_snapshots (
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (collab_id, captured_on)
);

-- 그래프는 언제나 "한 캠페인의 최근 N일"을 읽는다.
CREATE INDEX IF NOT EXISTS idx_post_metric_snapshots_campaign_date
  ON collab_post_metric_snapshots(campaign_id, captured_on);
