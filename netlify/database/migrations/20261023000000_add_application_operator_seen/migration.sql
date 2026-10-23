-- 운영 콘솔의 '커머스 캠페인' 탭이 새로 선정된 지원자를 알림으로 띄운다.
--
-- 브랜드가 지원자를 수락해도 운영자 화면에는 표시가 없어서, 담당자가 조율을 시작해야 하는
-- 건을 캠페인마다 열어 봐야 알 수 있었다. 운영자가 그 캠페인의 선정 내역을 열어 본 시각을
-- 남겨 두고, 그 뒤에 선정된 건만 "새 선정"으로 센다.

ALTER TABLE campaign_applications ADD COLUMN IF NOT EXISTS operator_seen_at TIMESTAMPTZ;

-- 이 컬럼이 생기기 전에 이미 선정된 건은 알림으로 쏟아지지 않게 본 것으로 둔다.
UPDATE campaign_applications SET operator_seen_at = NOW()
WHERE status = 'accepted' AND operator_seen_at IS NULL;
