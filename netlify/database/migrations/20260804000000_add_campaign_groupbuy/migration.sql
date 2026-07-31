-- 공동구매 진행 방식.
--
-- 진행 방식(reward_mode)에 'groupbuy' 가 하나 더 생긴다. 광고비도 아니고 제품 협찬도
-- 아니라, 제품을 함께 팔고 판매 금액의 일부를 수수료로 지급하는 방식이다. 값 자체는
-- reward_mode 가 TEXT 라 새 컬럼이 필요 없지만, 수수료율은 저장할 곳이 없었다.
--
--   groupbuy_commission_rate  판매 수수료(%). 금액이 아니라 비율인 것은 판매량이
--                             정해지지 않은 상태에서 등록하기 때문이다. 0 은 "해당 없음"
--                             이고, 공동구매가 아닌 캠페인은 계속 0 이다.
--
-- 컬럼 이름에 groupbuy 를 붙여 둔 것은 budget_krw·seeding_count 처럼 방식마다 다른
-- 의미로 재사용되는 칸을 하나 더 만들지 않기 위해서다. seeding_count 는 이미 제품
-- 협찬형의 협찬 인원으로 쓰이고 있어, 여기에 수수료를 겹쳐 넣으면 어느 방식의 값인지
-- 컬럼만 보고는 알 수 없게 된다.
--
-- 협업 단계는 캠페인 유형(type = 'group_buy')으로 갈린다 — 상품 정보 전달 → 콘텐츠
-- 검수 → 판매 시작 → 수수료 정산. 그 템플릿은 이미 있어서 여기서 손댈 것이 없다.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS groupbuy_commission_rate INT DEFAULT 0;
