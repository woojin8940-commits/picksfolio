-- 캠페인 협업 "리스트 등록" 지원 데이터.
-- role = 'influencer' (유저가 인플루언서로 지원) | 'brand' (비즈니스 계정이 광고주로 지원)
-- 한 테이블에 두 역할을 함께 저장하고, 역할별 컬럼은 NULL/기본값으로 둔다.
CREATE TABLE IF NOT EXISTS collab_directory_applications (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,                       -- 'influencer' | 'brand'
  applicant_username TEXT DEFAULT '',       -- 로그인 계정명(있을 경우)
  name TEXT DEFAULT '',                     -- 이름 / 담당자
  contact TEXT DEFAULT '',                  -- 연락처

  -- 인플루언서 전용
  instagram_url TEXT DEFAULT '',
  youtube_url TEXT DEFAULT '',
  tiktok_url TEXT DEFAULT '',
  naver_blog_url TEXT DEFAULT '',
  ad_price TEXT DEFAULT '',                 -- 광고 단가
  category TEXT DEFAULT '',                 -- 인플루언서 카테고리
  follower_count INTEGER DEFAULT 0,         -- 팔로워 수(크롤링 또는 수기 입력)
  follower_source TEXT DEFAULT 'manual',    -- 'crawled' | 'manual'

  -- 브랜드(광고주) 전용
  brand_homepage TEXT DEFAULT '',           -- 브랜드 홈페이지
  brand_instagram TEXT DEFAULT '',          -- 브랜드 인스타 링크
  desired_count TEXT DEFAULT '',            -- 희망 인원
  desired_followers TEXT DEFAULT '',        -- 원하는 팔로워 규모
  budget INTEGER DEFAULT 0,                 -- 예산(정렬용 숫자)
  budget_text TEXT DEFAULT '',              -- 예산 원문 표기
  desired_schedule TEXT DEFAULT '',         -- 원하는 일정(YYYY-MM-DD 등, 정렬용)
  desired_category TEXT DEFAULT '',         -- 원하는 인플루언서 카테고리

  note TEXT DEFAULT '',                     -- 추가 메모
  status TEXT DEFAULT 'pending',            -- 'pending' | 'reviewed' | 'contacted' | 'archived'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_dir_role ON collab_directory_applications (role);
CREATE INDEX IF NOT EXISTS idx_collab_dir_status ON collab_directory_applications (status);
CREATE INDEX IF NOT EXISTS idx_collab_dir_created ON collab_directory_applications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_dir_followers ON collab_directory_applications (follower_count DESC);
CREATE INDEX IF NOT EXISTS idx_collab_dir_budget ON collab_directory_applications (budget DESC);
CREATE INDEX IF NOT EXISTS idx_collab_dir_schedule ON collab_directory_applications (desired_schedule);
