-- 어필리에이트 스토어: 구매자 계정 분리 · 정산 기록 · 자동 처리.

-- 1) 계정 유형. 구매 경로(/shop · /my)로 처음 로그인했고 아이디가 없으면 'buyer'(구매자 전용).
--    인플루언서 · 브랜드 계정이 구매한 경우는 'member'. 운영자만 buyer → member 로 바꿀 수 있다.
ALTER TABLE affiliate_buyers ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'buyer';
ALTER TABLE affiliate_buyers ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;
ALTER TABLE affiliate_buyers ADD COLUMN IF NOT EXISTS converted_by TEXT NOT NULL DEFAULT '';
UPDATE affiliate_buyers SET account_type = 'member' WHERE username <> '' AND account_type = 'buyer';
CREATE INDEX IF NOT EXISTS affiliate_buyers_type_idx ON affiliate_buyers (account_type);

-- 2) 수수료(정산) 상태: pending(예정) → confirmed(구매확정) / cancelled(취소).
--    플랫폼 수수료율은 주문 시점 값으로 고정한다(브랜드 정산 예정액 계산용 · 표시만).
ALTER TABLE affiliate_store_orders ALTER COLUMN commission_status SET DEFAULT 'pending';
UPDATE affiliate_store_orders SET commission_status = CASE
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'confirmed' THEN 'confirmed'
    ELSE 'pending' END
  WHERE commission_status NOT IN ('pending', 'confirmed', 'cancelled');
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS platform_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS commission_confirmed_at TIMESTAMPTZ;

-- 3) 자동 처리 기록: 송장 미입력 자동 취소 하루 전 알림, 송장 입력 14일 뒤 자동 배송 완료.
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS auto_cancel_warned_at TIMESTAMPTZ;
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS delivered_auto BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO platform_settings (key, value, updated_by)
  VALUES ('affiliate_platform_rate', '5', 'system')
ON CONFLICT (key) DO NOTHING;
