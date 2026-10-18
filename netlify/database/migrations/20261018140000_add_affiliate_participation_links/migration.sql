-- 판매(어필리에이트) 캠페인 참여 신청에 인스타그램 말고 다른 채널 링크를 남긴다.
-- [{ "type": "tiktok" | "youtube" | "other", "url": "https://..." }] — 모두 선택 값이다.
ALTER TABLE affiliate_participations ADD COLUMN IF NOT EXISTS channel_links JSONB NOT NULL DEFAULT '[]'::jsonb;
