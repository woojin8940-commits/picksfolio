-- 리스트업(후보 제안) 단계를 위한 테이블.
--
-- 지금 구조에서 협업이 시작되는 길은 하나뿐이다. 인플루언서가 캠페인에 지원하고
-- (campaign_applications) 담당자가 그중에서 고른다. 그런데 실제 진행은 반대
-- 방향이 훨씬 많다. 브랜드가 캠페인을 열면 담당자가 어울리는 인플루언서를 직접
-- 찾아 명단을 만들고, 브랜드가 그 명단을 보고 고르고, 담당자가 고른 사람에게
-- 일정·가이드·단가를 들고 가서 "하시겠습니까"를 묻는다. 지원이 없어도 캠페인이
-- 굴러가야 한다.
--
-- 이 왕복을 메시지로만 처리하면 "누구에게 무슨 조건으로 제안했고 답이 무엇인지"가
-- 아무 데도 남지 않는다. 그래서 후보 한 명을 한 행으로 두고, 그 행 위에서
-- 리스트업 → 브랜드 선택 → 제안 발송 → 응답 → 협업 생성까지의 상태를 옮긴다.
--
--   brand_decision  : 브랜드가 명단을 보고 고른 결과 (pending/pick/pass)
--   outreach_status : 담당자가 제안을 보낸 뒤의 인플루언서 응답
--                     (not_sent/sent/accepted/declined/expired)
--
-- 두 축을 나눈 이유는 승인 주체가 다르기 때문이다. 브랜드는 고를 수만 있고,
-- 제안을 보내고 조율하는 것은 담당자다. 한 컬럼에 섞으면 "브랜드가 골랐지만 아직
-- 제안 전"과 "제안했는데 답이 없음"을 구분할 수 없다.

CREATE TABLE IF NOT EXISTS campaign_listups (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  influencer_username TEXT NOT NULL,

  -- 이 후보가 어디서 왔는지. manager = 담당자가 직접 찾아 넣음,
  -- directory = 협업 매칭 등록 풀에서, application = 지원자 중에서.
  source TEXT NOT NULL DEFAULT 'manager',
  directory_id TEXT DEFAULT '',

  -- 명단에 올린 순간의 채널 지표를 그대로 굳혀 둔다. 인플루언서가 나중에
  -- 계정 정보를 바꾸거나 조회수가 변해도, 브랜드가 무엇을 보고 골랐는지는
  -- 그대로 남아야 한다.
  snapshot JSONB DEFAULT '{}'::jsonb,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),

  -- 담당자가 브랜드에게 붙이는 추천 이유.
  manager_note TEXT DEFAULT '',

  brand_decision TEXT NOT NULL DEFAULT 'pending',
  brand_decision_note TEXT DEFAULT '',
  brand_decided_at TIMESTAMPTZ,

  outreach_status TEXT NOT NULL DEFAULT 'not_sent',
  -- 실제로 보낸 조건. 일정·가이드·단가를 그대로 담아 두고, 수락되면
  -- 이 값으로 collab_terms 와 단계 마감일을 채운다.
  offer JSONB DEFAULT '{}'::jsonb,
  offer_sent_at TIMESTAMPTZ,
  offer_sent_by TEXT DEFAULT '',
  responded_at TIMESTAMPTZ,
  response_note TEXT DEFAULT '',

  -- 수락 후 만들어진 협업. 여기까지 오면 이 행의 역할은 끝난다.
  collab_id TEXT DEFAULT '',

  listed_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 같은 캠페인에 같은 사람을 두 번 올릴 일은 없다. 두 번 올라가면 브랜드
  -- 화면에 중복 카드가 생기고 제안이 두 번 나간다.
  UNIQUE (campaign_id, influencer_username)
);

CREATE INDEX IF NOT EXISTS idx_campaign_listups_campaign
  ON campaign_listups(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_listups_influencer
  ON campaign_listups(influencer_username, outreach_status);
CREATE INDEX IF NOT EXISTS idx_campaign_listups_outreach
  ON campaign_listups(outreach_status, offer_sent_at DESC);

-- 리스트업으로 들어온 협업도 campaign_applications 행을 가진다.
-- campaign_collabs.application_id 가 NOT NULL 외래키라서 지울 수 없고, 굳이
-- 지울 이유도 없다. 지원자 목록·조인·통계가 모두 그 테이블을 본다. 대신 어느
-- 경로로 생긴 행인지는 구분해야 해서 컬럼을 하나 붙인다 — 담당자 대기 큐가
-- 리스트업으로 만든 행을 "선정 대기 지원자"로 다시 올리면 안 되기 때문이다.
ALTER TABLE campaign_applications
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'apply';

-- 인플루언서가 직접 등록하는 채널 정보.
--
-- 브랜드가 명단에서 고르려면 팔로워 숫자만으로는 부족하다. 최근 릴스와 평균
-- 조회수를 봐야 한다. 지표의 출처가 자기 입력인지 메타 API 로 받아온 값인지를
-- metrics_source 로 나눠 두는 것이 이 테이블의 핵심이다. 숫자를 한 칸에 섞어
-- 두면 브랜드는 어느 숫자를 믿어야 하는지 알 수 없다.
CREATE TABLE IF NOT EXISTS creator_channels (
  username TEXT PRIMARY KEY,
  instagram_handle TEXT DEFAULT '',
  instagram_url TEXT DEFAULT '',
  -- 메타 계정 연동 여부. 연동되면 sync 로 지표를 갱신할 수 있다.
  connected BOOLEAN DEFAULT FALSE,

  followers INTEGER DEFAULT 0,
  avg_views INTEGER DEFAULT 0,
  avg_likes INTEGER DEFAULT 0,
  avg_comments INTEGER DEFAULT 0,
  reels_count INTEGER DEFAULT 0,

  -- 'self' = 인플루언서 자기 입력, 'meta_api' = 그래프 API 응답.
  metrics_source TEXT NOT NULL DEFAULT 'self',
  -- 최근 릴스 목록. [{ id, permalink, thumbnailUrl, caption, views, likes, timestamp }]
  recent_reels JSONB DEFAULT '[]'::jsonb,
  synced_at TIMESTAMPTZ,

  intro TEXT DEFAULT '',
  categories TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creator_channels_followers
  ON creator_channels(followers DESC);
