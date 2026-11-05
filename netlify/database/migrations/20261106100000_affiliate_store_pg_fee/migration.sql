-- 어필리에이트 스토어 정산식: PG(결제) 수수료는 브랜드가 부담한다.
--   브랜드 정산액 = 결제 금액(상품 + 배송비) − 인플루언서 수수료 − PG 수수료 − 플랫폼 수수료
--   인플루언서 · 플랫폼 수수료는 상품 금액 기준, PG 수수료는 결제 금액 전체(배송비 포함) 기준.
-- PG 수수료율은 결제 수단별 운영 설정이며, 주문을 만들 때의 값을 주문에 고정해 둔다.
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS pg_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS platform_setting_history (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (key, value, updated_by) VALUES
  ('affiliate_pg_rate_card', '3.3', 'system'),
  ('affiliate_pg_rate_kakaopay', '3.3', 'system')
ON CONFLICT (key) DO NOTHING;
