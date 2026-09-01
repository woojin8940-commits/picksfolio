-- 브랜드가 픽스폴리오에 보내는 입금일 — 미리 정해 두지 않고 양쪽이 조율한다.
--
-- 그동안 브랜드 정산 화면에는 "입금 예정 2026년 9월 30일" 처럼 날짜가 이미 박혀
-- 있었다. 그 날짜는 브랜드와 합의한 날이 아니라 인플루언서 지급 예정일(업로드를
-- 확인한 달의 익월 말일)을 그대로 옮겨 놓은 것이었다. 두 날짜는 성격이 다르다.
--
--   · 인플루언서 지급일 : 픽스폴리오가 원천징수(3.3%)를 떼고 개인에게 보내는 날.
--                         지급 주기가 정해져 있어 자동으로 잡아도 된다.
--   · 브랜드 입금일     : 브랜드가 픽스폴리오에 한 번에 보내는 날. 세금계산서 발행,
--                         브랜드 내부 결의·지급 주기(말일 마감 · 익월 10일 지급 등)에
--                         따라 달라지므로 우리가 정할 수 없다.
--
-- 정해 둔 날짜를 보여 주면 브랜드는 "왜 이 날짜인가"를 묻고, 담당자는 "그 날짜는
-- 그냥 표시된 것"이라고 답해야 했다. 화면이 약속처럼 보이는데 실제 약속이 아니어서,
-- 입금이 늦어도 누가 어긴 것인지 말할 수 없었다.
--
-- 그래서 회차마다 "제안 → 동의" 를 남긴다. 어느 쪽이든 날짜를 제안할 수 있고,
-- 상대가 동의하면 그때 확정된다. 실제 대화는 카카오톡·유선으로 오가므로(브랜드와
-- 담당자 사이에는 앱 안 타임라인을 두지 않았다) 이 표는 그 대화의 결론만 붙잡는다.
--
-- 회차 키는 브랜드 계정 + 'YYYY-MM' 이다. 캠페인별로 두지 않는 이유는, 브랜드가
-- 캠페인마다 따로 송금하지 않기 때문이다 — 한 회차에 한 번 보낸다. 그래서 캠페인
-- 하나만 열어 놓고 봐도, 브랜드 전체 정산 화면에서 봐도 같은 약속이 보인다.
CREATE TABLE IF NOT EXISTS brand_settlement_schedule (
  -- 'biz/' 접두사를 뗀 소문자 브랜드 계정 아이디.
  business_username TEXT NOT NULL,
  -- 정산 회차. 인플루언서 지급 예정월(YYYY-MM)을 회차 이름으로 쓴다 — 같은 회차에
  -- 묶인 건들을 브랜드가 한 번에 보낸다.
  round_key TEXT NOT NULL,

  -- 제안 -------------------------------------------------------------------
  -- 마지막으로 올라온 제안. 다시 제안하면 이 칸이 덮이고 동의는 지워진다(아래
  -- agreed_* 를 함께 비운다) — 지난 합의가 새 제안과 함께 남아 있으면 어느 날짜가
  -- 유효한지 화면에서 판단할 수 없다.
  proposed_date DATE,
  -- 'brand' | 'manager'. 누가 제안했는지 알아야 "상대의 동의"를 판정할 수 있다.
  proposed_side TEXT DEFAULT '',
  proposed_by TEXT DEFAULT '',
  -- 조건을 함께 적는 칸. "세금계산서 발행 후", "익월 10일 지급 규정" 처럼 날짜만으로
  -- 설명되지 않는 사정이 붙는다.
  proposed_note TEXT DEFAULT '',
  proposed_at TIMESTAMP WITH TIME ZONE,

  -- 동의 -------------------------------------------------------------------
  -- 채워지면 확정된 입금일이다. 제안한 쪽이 스스로 채우지 못한다.
  agreed_date DATE,
  agreed_side TEXT DEFAULT '',
  agreed_by TEXT DEFAULT '',
  agreed_at TIMESTAMP WITH TIME ZONE,

  -- 입금 확인 ---------------------------------------------------------------
  -- 담당자가 실제로 받은 것을 확인한 시각. 브랜드 화면의 '입금 완료'는 이 값으로만
  -- 판단한다. 예전에는 인플루언서 지급 완료 여부를 브랜드의 입금 완료로 보여 주고
  -- 있었는데, 그 둘은 순서도 주체도 다르다.
  received_at TIMESTAMP WITH TIME ZONE,
  received_by TEXT DEFAULT '',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  PRIMARY KEY (business_username, round_key)
);

-- 담당자 큐: 아직 입금이 확인되지 않은 회차를 합의일 순으로 본다.
CREATE INDEX IF NOT EXISTS idx_brand_settlement_schedule_open
  ON brand_settlement_schedule(agreed_date) WHERE received_at IS NULL;
