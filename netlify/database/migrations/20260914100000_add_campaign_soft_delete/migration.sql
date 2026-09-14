-- 캠페인 삭제를 기록으로 남긴다.
--
-- 지금까지 캠페인 삭제는 행을 지우는 일이었다(campaigns + campaign_collabs +
-- campaign_applications). 그런데 브랜드의 '캠페인 이력' 메뉴는 campaigns 를 읽어
-- 지난 집행을 보여 주는 화면이다 — 협업 메뉴에서 끝난 캠페인을 정리하면 이력에서도
-- 같이 사라졌고, 이미 집행한 광고비와 실제 성과가 통째로 없어졌다. 이력은 기록이니
-- 남아 있어야 한다.
--
-- 그래서 삭제는 "목록에서 내린다"로 바꾼다. 시각 하나(deleted_at)만 남기고, 진행
-- 중이던 협업과 지원서는 그대로 둔다 — 이력의 집행 금액과 성과가 그 두 표에서
-- 계산되기 때문이다(api-business-campaign-history).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- 살아 있는 캠페인만 읽는 목록이 대부분이다(협업 메뉴 · 공개 목록 · 담당자 목록).
-- 부분 인덱스로 두면 삭제된 행은 색인에서 빠져 목록 조회가 그만큼 가벼워진다.
CREATE INDEX IF NOT EXISTS idx_campaigns_alive
  ON campaigns (created_at DESC)
  WHERE deleted_at IS NULL;
