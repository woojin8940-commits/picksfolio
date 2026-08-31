-- 정산 단계에 필요한 저장소.
--
-- 지금까지 정산은 "담당자가 업로드를 확인하면 다음 달 말일로 예약된다"까지만
-- 있었다. 실제로 돈을 보내려면 그 뒤에 두 가지가 더 필요한데, 둘 다 앱 밖에서
-- 오갔다.
--
--   · 인플루언서의 신분증 사본과 입금 계좌  — 원천징수(3.3%) 신고에 필요하다.
--     카카오톡·메일로 주고받다 보니 어느 협업의 것인지 짝이 맞지 않고, 계좌를
--     잘못 옮겨 적어 반송되는 일이 있었다.
--   · 담당자가 정한 실제 지급일           — 자동으로 잡히는 "다음 달 말일"은
--     예정일이고, 정산 회차에 따라 앞뒤로 움직인다. 인플루언서는 그 날짜를 물어봐야
--     알 수 있었다.
--
-- 협업 1건당 한 줄로 모은다. 인플루언서가 자기 칸(신분증·계좌)을 채우고, 담당자가
-- 그것을 확인한 뒤 지급일을 적는다.
--
-- 개인정보이므로 브랜드에게는 내려보내지 않는다. 이 표를 읽는 API 는 역할이
-- 인플루언서(자기 것) 또는 담당자일 때만 신분증 URL·계좌번호를 응답에 담는다.
-- 브랜드는 "제출 완료 / 미제출"과 지급일까지만 본다.
CREATE TABLE IF NOT EXISTS collab_settlement_info (
  collab_id TEXT PRIMARY KEY REFERENCES campaign_collabs(id) ON DELETE CASCADE,

  -- 인플루언서가 채우는 칸 -------------------------------------------------
  -- 신분증 사본. 업로드된 파일 URL 하나만 둔다(주민등록증·운전면허증 등).
  id_card_url TEXT DEFAULT '',
  id_card_name TEXT DEFAULT '',
  -- 예금주는 신분증의 이름과 같아야 한다. 다르면 은행에서 반송된다.
  bank_name TEXT DEFAULT '',
  account_holder TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  submitted_at TIMESTAMP WITH TIME ZONE,
  submitted_by TEXT DEFAULT '',

  -- 담당자가 채우는 칸 -----------------------------------------------------
  -- 제출물을 열어 보고 "이 계좌로 지급 가능"을 확인한 시각.
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by TEXT DEFAULT '',
  -- 실제 지급일(YYYY-MM-DD). 이 값이 정산 항목의 scheduled_date 가 되고,
  -- 인플루언서 협업 현황 캘린더에 '정산' 일정으로 올라간다.
  payout_date DATE,
  payout_memo TEXT DEFAULT '',
  scheduled_at TIMESTAMP WITH TIME ZONE,
  scheduled_by TEXT DEFAULT '',
  -- 실제로 보낸 시각. 채워지면 정산 항목이 '지급 완료'가 된다.
  paid_at TIMESTAMP WITH TIME ZONE,
  paid_by TEXT DEFAULT '',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 담당자 큐에서 "지급일이 아직 없는 제출 건"을 먼저 처리한다.
CREATE INDEX IF NOT EXISTS idx_collab_settlement_info_pending
  ON collab_settlement_info(payout_date) WHERE paid_at IS NULL;
