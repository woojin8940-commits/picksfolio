-- 판매(어필리에이트) 캠페인 참여 신청에 신청자 성함 · 연락처를 남긴다.
-- 신청은 브랜드 매칭받기에 등록한(인스타그램을 연동한) 인플루언서만 할 수 있고,
-- 인스타 프로필은 creator_channels 에서 읽어 브랜드에게 보여 준다. 성함 · 연락처는
-- 신청할 때 적은 값을 그대로 둔다 — 브랜드가 승인 뒤 샘플 발송 · 정산 안내로 연락한다.
ALTER TABLE affiliate_participations ADD COLUMN IF NOT EXISTS applicant_name TEXT NOT NULL DEFAULT '';
ALTER TABLE affiliate_participations ADD COLUMN IF NOT EXISTS applicant_contact TEXT NOT NULL DEFAULT '';
