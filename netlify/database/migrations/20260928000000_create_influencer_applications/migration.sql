-- 광고로 모집하는 인플루언서 지원서(/influencer-apply).
--
-- 로그인 없이 받는 공개 설문이라 계정과 묶지 않는다. 운영자가 목록을 보고 직접
-- 연락하므로, 연락했는지(status)와 통화 메모(memo)를 같은 행에 남긴다.
CREATE TABLE IF NOT EXISTS influencer_applications (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  instagram TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',       -- 'new' | 'contacted' | 'done'
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS influencer_applications_created_at_idx
  ON influencer_applications (created_at DESC);
