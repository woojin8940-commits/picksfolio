-- 브랜드가 보낸 일괄 정산금을 받았는지.
--
-- 돈의 순서는 브랜드 → 픽스폴리오 → 인플루언서다. 브랜드는 회차마다 픽스폴리오에
-- 한 번 보내고, 원천징수(3.3%)와 개별 지급은 픽스폴리오가 한다. 그러니까 인플루언서
-- 지급은 브랜드 입금이 들어온 다음에만 할 수 있는 일인데, 그 앞쪽 절반이 앱 밖에
-- 있었다 — 담당자는 통장을 열어 확인하고, 확인한 사실은 아무데도 남지 않았다.
--
-- 그래서 두 가지가 사고로 이어졌다.
--
--   · 담당자가 입금 전에 '정산완료'를 눌러 픽스폴리오 돈으로 먼저 지급한 건이 생겼다.
--     캠페인 정산 탭에는 "서류 냈으니 보낼 수 있다"까지만 적혀 있었고, 브랜드 입금
--     여부는 화면 어디에도 없었다.
--   · 브랜드는 자기가 보낸 돈이 접수됐는지 알 수 없어 담당자에게 물어봐야 했다.
--     캠페인 정산 화면의 '입금 완료' 배지는 인플루언서 지급이 끝났는지를 말하고
--     있었을 뿐, 브랜드가 확인하고 싶은 "내 입금이 접수됐나"와는 다른 사실이었다.
--
-- 캠페인 1건당 한 줄로 모은다. 브랜드가 여러 달에 걸쳐 회차를 나눠 보내는 캠페인도
-- 청구·수납 금액을 함께 적어 두면 얼마가 들어왔는지 남는다 — 지급을 여는 것은
-- 담당자가 '입금 확인 완료'를 누른 사실 하나이고, 그 판단은 통장을 본 사람이 한다.
CREATE TABLE IF NOT EXISTS campaign_brand_settlements (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  -- 캠페인을 등록한 브랜드 계정. 캠페인 행에도 있지만, 브랜드 화면이 자기 계정의
  -- 수납 기록을 한 번에 읽을 때 조인 없이 찾을 수 있어야 한다.
  business_username TEXT NOT NULL DEFAULT '',

  -- 청구 금액. 비어 있으면 확정된 보수의 합계를 청구액으로 본다(화면이 계산한다).
  invoice_amount INTEGER NOT NULL DEFAULT 0,
  -- 실제로 들어온 금액. 청구액보다 적으면 부분 수납이다.
  received_amount INTEGER NOT NULL DEFAULT 0,
  -- 통장에 찍힌 날짜(YYYY-MM-DD). 브랜드 정산 화면에 그대로 보인다.
  received_date DATE,
  -- 담당자가 '입금 확인 완료'를 누른 시각. **이 값이 채워져야 인플루언서 지급이
  -- 열린다** (api-collab-workflow 의 complete_settlement 가 확인한다).
  received_at TIMESTAMP WITH TIME ZONE,
  received_by TEXT NOT NULL DEFAULT '',
  -- 세금계산서 번호나 "1차분 입금" 같은 메모. 브랜드에게도 보인다.
  memo TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 브랜드 정산 화면은 계정 전체의 수납 기록을 한 번에 읽는다(캠페인 여러 건).
CREATE INDEX IF NOT EXISTS idx_campaign_brand_settlements_business
  ON campaign_brand_settlements(business_username);
