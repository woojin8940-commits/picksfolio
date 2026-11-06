-- 어필리에이트 스토어 오픈 전 보완. 테이블 · 컬럼은 추가만 한다(삭제 · 이름 변경 없음).

-- 1) 브랜드 판매자 정보 · 구매자 문의 링크.
--    inquiry_url: 구매자가 "문의하기"를 누르면 새 창으로 열리는 자사몰 · 고객센터 주소(https:// 만).
--    mail_order_number: 통신판매업 신고번호(상품 페이지 판매자 정보에 표시).
--    이미 승인된 브랜드는 비어 있으므로 브랜드 화면 상단 배너로 등록을 요청한다.
ALTER TABLE affiliate_store_applications ADD COLUMN IF NOT EXISTS inquiry_url TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_store_applications ADD COLUMN IF NOT EXISTS mail_order_number TEXT NOT NULL DEFAULT '';

-- 2) 반품 거절 시 반품 기간 · 구매확정 기준일을 거절 시점부터 다시 센다.
--    기준 시각 = GREATEST(return_window_from, delivered_at).
ALTER TABLE affiliate_store_orders ADD COLUMN IF NOT EXISTS return_window_from TIMESTAMPTZ;

-- 3) 반품 환불 금액 · 차감한 왕복 배송비(단순 변심 부분 환불).
ALTER TABLE affiliate_store_returns ADD COLUMN IF NOT EXISTS refund_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE affiliate_store_returns ADD COLUMN IF NOT EXISTS shipping_deduction INTEGER NOT NULL DEFAULT 0;

-- 4) 결제 누락 점검: 30분 넘게 결제되지 않은 주문서는 status = 'expired' 로 정리한다(새 상태값 · 컬럼 변경 없음).
CREATE INDEX IF NOT EXISTS affiliate_store_orders_pending_idx
  ON affiliate_store_orders (status, created_at) WHERE status = 'pending_payment';

-- 5) 수수료 규칙.
--    PG 수수료 기본값 4%(카드 · 카카오페이 모두). 변경 이력을 남긴다.
INSERT INTO platform_setting_history (key, old_value, new_value, changed_by)
SELECT key, value, '4', 'system' FROM platform_settings
WHERE key IN ('affiliate_pg_rate_card', 'affiliate_pg_rate_kakaopay') AND value <> '4';
INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES
  ('affiliate_pg_rate_card', '4', 'system', NOW()),
  ('affiliate_pg_rate_kakaopay', '4', 'system', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW();

--    픽스폴리오(플랫폼) 수수료는 무조건 5%. 설정값과, 아직 정산이 확정되지 않은 주문의 고정값을 5로 맞춘다.
INSERT INTO platform_setting_history (key, old_value, new_value, changed_by)
SELECT key, value, '5', 'system' FROM platform_settings
WHERE key = 'affiliate_platform_rate' AND value <> '5';
INSERT INTO platform_settings (key, value, updated_by, updated_at)
  VALUES ('affiliate_platform_rate', '5', 'system', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW();
UPDATE affiliate_store_orders SET platform_rate = 5
WHERE platform_rate <> 5 AND commission_status = 'pending';
