-- 1) 어필리에이트 판매 신청의 "담당자 중개" 단계.
--
--   인플루언서 판매 신청 → 브랜드 선정 → 픽스폴리오 담당자가 양쪽에 연락해 조건을 맞춘다
--   → 담당자가 진행 완료로 바꾸면 인플루언서 전용 판매 링크가 열린다.
--
--   manager_status: ''(해당 없음) | 'waiting'(연락 대기) | 'contacting'(연락 중) | 'done'(진행 완료)
--   이미 승인돼 링크를 쓰고 있는 신청은 그대로 쓰도록 'done' 으로 채운다.
ALTER TABLE affiliate_store_requests
  ADD COLUMN IF NOT EXISTS manager_status TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_note TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_updated_at TIMESTAMPTZ;

UPDATE affiliate_store_requests SET manager_status = 'done'
WHERE status = 'approved' AND manager_status = '';

CREATE INDEX IF NOT EXISTS affiliate_store_requests_manager_idx
  ON affiliate_store_requests (manager_status, updated_at DESC);

-- 2) 크리에이터 지원 · 승인.
--
--   자동 디엠과 어필리에이트는 승인된 크리에이터만 쓴다. 이 마이그레이션 시점에 이미 있던
--   계정(site_data · 브랜드 매칭 등록자)은 source = 'legacy' 로 승인 처리해 지금처럼 쓴다.
--   이후 가입한 인플루언서는 크리에이터 지원서를 내고 운영자 승인을 받아야 열린다.
CREATE TABLE IF NOT EXISTS creator_applications (
  username TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'application',   -- 'application' | 'legacy'
  name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  instagram_url TEXT NOT NULL DEFAULT '',
  privacy_consented_at TIMESTAMPTZ,              -- 개인정보 수집·이용 동의 시각
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'approved' | 'rejected'
  reject_reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS creator_applications_status_idx
  ON creator_applications (source, status, created_at DESC);

INSERT INTO creator_applications (username, source, status, reviewed_by, reviewed_at)
SELECT DISTINCT u, 'legacy', 'approved', 'system', NOW()
FROM (
  SELECT regexp_replace(LOWER(TRIM(username)), '^biz/', '') AS u FROM site_data
  UNION
  SELECT regexp_replace(LOWER(TRIM(applicant_username)), '^biz/', '') AS u
  FROM collab_directory_applications
  WHERE role = 'influencer' AND COALESCE(applicant_username, '') <> ''
) t
WHERE u <> ''
ON CONFLICT (username) DO NOTHING;
