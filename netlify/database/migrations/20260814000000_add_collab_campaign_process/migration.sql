-- 캠페인 진행 프로세스를 다섯 단계로 정리하면서 필요해진 저장소.
--
--   1) 콘텐츠 가이드  브랜드가 올린 가이드 파일 (campaigns.guideline_files / collab_assets 로 이미 있음)
--   2) 제품 배송      인플루언서가 받을 주소를 적고 브랜드가 발송한다  ← 저장할 곳이 없었다
--   3) 기획안 피드백  인플루언서 기획안 + 그 밑에 붙는 브랜드 피드백 (collab_deliverables / collab_feedbacks)
--   4) 영상 피드백    초안 영상 + 그 밑에 붙는 브랜드 피드백          (collab_deliverables / collab_feedbacks)
--   5) 업로드         게시물 링크 · 광고 파트너십 코드 · 업로드 확인   ← 확인 시각을 남길 칸이 없었다
--
-- 2번과 5번만 새 칸이 필요하다. 나머지는 이미 있는 표를 그대로 쓴다 — 같은 것을
-- 두 곳에 저장하기 시작하면 어느 쪽이 진짜인지 아무도 모르게 된다.

-- 1) 배송 정보 --------------------------------------------------------------
-- 협업 1건당 한 줄. 주소는 인플루언서가 적고(status='pending'), 브랜드가 보낸 뒤
-- 송장을 적으면 status='shipped' 가 된다. 예전에는 이 왕복이 대화창에서 일어나서
-- 협업 기록에는 "제품을 언제 보냈는지"가 남지 않았다.
CREATE TABLE IF NOT EXISTS collab_shipping (
  collab_id TEXT PRIMARY KEY REFERENCES campaign_collabs(id) ON DELETE CASCADE,
  recipient TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  postcode TEXT DEFAULT '',
  address1 TEXT DEFAULT '',
  address2 TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  courier TEXT DEFAULT '',
  tracking_number TEXT DEFAULT '',
  shipped_at TIMESTAMP WITH TIME ZONE,
  saved_by TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_shipping_status ON collab_shipping(status);

-- 2) 업로드 확인 ------------------------------------------------------------
-- upload_url 은 이미 있지만 "그래서 확인이 끝났는가"는 어디에도 없었다. 브랜드가
-- 게시물을 열어 보고 누른 시각을 남겨야 업로드 단계가 완료로 닫힌다.
ALTER TABLE campaign_collabs
  ADD COLUMN IF NOT EXISTS upload_confirmed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS upload_confirmed_by TEXT DEFAULT '';
