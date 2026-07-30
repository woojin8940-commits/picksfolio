-- 캠페인 협업을 "담당자 중개" 구조로 바꾸기 위한 스키마.
--
-- 지금까지 캠페인 협업은 브랜드가 지원자를 직접 수락하고, 그 뒤로는 브랜드와
-- 인플루언서가 자유 대화로 알아서 진행하는 형태였다. 그래서 (1) 누가 무엇을
-- 언제까지 해야 하는지가 어디에도 기록되지 않고, (2) 진행률을 물어볼 방법이
-- 없고, (3) 정산이 실제 업로드와 무관하게 수락 시점 +30일로 고정됐다.
--
-- 새 구조에서 브랜드는 캠페인 등록과 검수 의견까지만, 인플루언서는 지원과
-- 산출물 제출까지만 한다. 그 사이의 모든 결정(선정, 조건 확정, 단계 진행,
-- 업로드 확인, 취소)은 픽스폴리오 담당자가 내린다.
--
-- 이 마이그레이션이 만드는 것:
--   * campaigns / campaign_applications : 담당자 배정과 브랜드의 "비구속" 의견
--   * campaign_collabs                  : 이미 있었지만 아무도 쓰지 않던 표를 실사용 형태로 확장
--   * collab_stages                     : 협업 1건의 단계 인스턴스 (누가·언제까지)
--   * collab_terms                      : 확정 조건 (금액·일정·산출물 규격) 잠금
--   * collab_deliverables               : 버전이 있는 산출물 (대본/콘텐츠/업로드)
--   * collab_feedbacks                  : 위치(장면·타임코드)에 붙는 피드백
--   * collab_schedule_changes           : 일정 변경 이력 (횟수 제한 근거)
--   * collab_events                     : 상태 변화 원장 — 알림과 감사(audit)의 단일 출처
--   * timelines                         : 담당자 채널 구분 (kind, manager_username)

-- 1) 담당자 배정 -------------------------------------------------------------
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS manager_username TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_assigned_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_campaigns_manager ON campaigns(manager_username);

-- 브랜드는 이제 지원자를 수락/거절하지 못한다. 대신 "이 사람이 좋다/아니다"를
-- 담당자에게 전달만 할 수 있다 — 구속력이 없으므로 status 와 분리해서 둔다.
ALTER TABLE campaign_applications
  ADD COLUMN IF NOT EXISTS brand_preference TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand_preference_note TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_note TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS decided_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP WITH TIME ZONE;

-- 2) 협업 본체 ---------------------------------------------------------------
ALTER TABLE campaign_collabs
  ADD COLUMN IF NOT EXISTS manager_username TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS campaign_title TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS company_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS campaign_type TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS template_key TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_stage_key TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS proposal_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS upload_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS ad_code TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_collabs_manager ON campaign_collabs(manager_username);
CREATE INDEX IF NOT EXISTS idx_collabs_creator ON campaign_collabs(creator_username);
CREATE INDEX IF NOT EXISTS idx_collabs_business ON campaign_collabs(business_username);
CREATE INDEX IF NOT EXISTS idx_collabs_status ON campaign_collabs(status);

-- 3) 단계 인스턴스 -----------------------------------------------------------
-- 템플릿(코드)이 아니라 "이 협업의 이 단계"를 행으로 남긴다. 템플릿이 나중에
-- 바뀌어도 진행 중인 협업의 약속은 흔들리지 않아야 한다.
CREATE TABLE IF NOT EXISTS collab_stages (
  id TEXT PRIMARY KEY,
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  owner_role TEXT NOT NULL DEFAULT 'influencer',
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT DEFAULT '',
  started_at TIMESTAMP WITH TIME ZONE,
  submitted_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  note TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  UNIQUE(collab_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_collab_stages_collab ON collab_stages(collab_id, seq);
CREATE INDEX IF NOT EXISTS idx_collab_stages_due ON collab_stages(due_date, status);

-- 4) 확정 조건 ---------------------------------------------------------------
-- 담당자가 잠그면(locked_at) 이후 금액·일정은 일정 변경 절차를 거치지 않고는
-- 바뀌지 않는다. 대화창에서 합의한 내용도 여기에 옮겨 적어야 효력이 생긴다.
CREATE TABLE IF NOT EXISTS collab_terms (
  collab_id TEXT PRIMARY KEY REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  fee INTEGER DEFAULT 0,
  reward_type TEXT DEFAULT '',
  reward_note TEXT DEFAULT '',
  script_due TEXT DEFAULT '',
  content_due TEXT DEFAULT '',
  upload_due TEXT DEFAULT '',
  deliverable_spec JSONB DEFAULT '{}'::jsonb,
  guide_url TEXT DEFAULT '',
  guide_note TEXT DEFAULT '',
  locked_at TIMESTAMP WITH TIME ZONE,
  locked_by TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 5) 산출물 (버전 보존) ------------------------------------------------------
-- 수정 요청이 오면 덮어쓰지 않고 새 버전을 쌓는다. "언제 무엇을 냈고 무엇이
-- 반영됐는지"를 나중에 되짚을 수 있어야 분쟁이 사실 확인으로 끝난다.
CREATE TABLE IF NOT EXISTS collab_deliverables (
  id TEXT PRIMARY KEY,
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'submitted',
  payload JSONB DEFAULT '{}'::jsonb,
  submitted_by TEXT DEFAULT '',
  reviewed_by TEXT DEFAULT '',
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_note TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  UNIQUE(collab_id, stage_key, version)
);

CREATE INDEX IF NOT EXISTS idx_collab_deliverables_collab ON collab_deliverables(collab_id, created_at DESC);

-- 6) 위치가 있는 피드백 -----------------------------------------------------
-- anchor 는 "3번 장면", "00:12" 처럼 산출물의 어디를 말하는지 가리킨다.
-- visible_to_influencer = false 인 항목은 브랜드가 담당자에게만 한 말이며,
-- 담당자가 다듬어 전달할 때 별도 항목으로 다시 남긴다.
CREATE TABLE IF NOT EXISTS collab_feedbacks (
  id TEXT PRIMARY KEY,
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  deliverable_id TEXT REFERENCES collab_deliverables(id) ON DELETE CASCADE,
  stage_key TEXT DEFAULT '',
  anchor TEXT DEFAULT '',
  body TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'manager',
  author_username TEXT DEFAULT '',
  visible_to_influencer BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT DEFAULT '',
  resolved_by TEXT DEFAULT '',
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_feedbacks_collab ON collab_feedbacks(collab_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collab_feedbacks_deliverable ON collab_feedbacks(deliverable_id);

-- 7) 일정 변경 이력 ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS collab_schedule_changes (
  id TEXT PRIMARY KEY,
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  stage_key TEXT DEFAULT '',
  previous_due TEXT DEFAULT '',
  next_due TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  requested_by_role TEXT DEFAULT '',
  requested_by TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_schedule_changes_collab ON collab_schedule_changes(collab_id);

-- 8) 이벤트 원장 -------------------------------------------------------------
-- 알림은 이 표를 읽어서 보낸다. 화면마다 알림을 따로 부르면 어떤 화면은 보내고
-- 어떤 화면은 잊는 일이 반드시 생기므로, 상태를 바꾼 곳은 반드시 여기에 남긴다.
CREATE TABLE IF NOT EXISTS collab_events (
  id TEXT PRIMARY KEY,
  collab_id TEXT NOT NULL REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_role TEXT DEFAULT '',
  actor_username TEXT DEFAULT '',
  stage_key TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  payload JSONB DEFAULT '{}'::jsonb,
  notified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_events_collab ON collab_events(collab_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_events_pending ON collab_events(notified_at) WHERE notified_at IS NULL;

-- 9) 담당자 채널 -------------------------------------------------------------
-- 기존 타임라인(브랜드↔인플루언서)은 그대로 남긴다. 새로 만드는 대화방은
-- kind 로 구분하고, 담당자를 참여자로 기록한다.
ALTER TABLE timelines
  ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'brand_influencer',
  ADD COLUMN IF NOT EXISTS manager_username TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS collab_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_timelines_manager ON timelines(manager_username);
CREATE INDEX IF NOT EXISTS idx_timelines_collab ON timelines(collab_id);
