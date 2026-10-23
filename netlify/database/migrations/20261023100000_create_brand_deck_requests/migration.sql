-- 메타 광고로 받는 브랜드 "서비스 소개서 신청"(/brand-deck).
--
-- 로그인 없이 받는 공개 폼이라 계정과 묶지 않는다. 운영자가 소개서를 보내고 직접
-- 연락하므로, 진행 상태(status)와 메모(memo)를 같은 행에 남긴다.
CREATE TABLE IF NOT EXISTS brand_deck_requests (
  id BIGSERIAL PRIMARY KEY,
  company TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  position TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',       -- 'new' | 'sent' | 'done'
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brand_deck_requests_created_at_idx
  ON brand_deck_requests (created_at DESC);
