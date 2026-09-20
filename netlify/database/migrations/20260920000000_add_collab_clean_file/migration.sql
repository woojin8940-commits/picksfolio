-- 업로드 단계에 함께 올라오는 '클린본' 영상.
--
-- 브랜드가 인플루언서 게시물을 자기 광고로 돌릴 때 필요한 것은 두 가지다. 파트너십
-- 코드(campaign_collabs.ad_code)와, 자막·로고가 얹히지 않은 원본 영상 — 클린본이다.
-- 코드는 업로드 단계에서 받고 있었지만 클린본은 받을 칸이 없어서 카카오톡으로 오갔고,
-- 그래서 캠페인이 끝난 뒤 이력 화면에서는 다시 찾을 방법이 없었다(대화방을 뒤져야 했다).
--
-- 제출물 자체는 지금까지처럼 collab_deliverables(kind='upload') 의 payload 에 버전과
-- 함께 쌓인다. 여기 두 칸은 "지금 유효한 클린본" 한 벌이다. 업로드 주소·광고 코드와
-- 같은 자리에 있어야 브랜드 캠페인 이력이 협업 한 줄을 읽는 것으로 끝난다 — 이력은
-- 캠페인 200건의 협업을 한 번에 훑는 화면이고, 거기서 제출물 버전을 거슬러 올라가는
-- 조회를 더하면 화면 하나가 느려진다.
ALTER TABLE campaign_collabs
  ADD COLUMN IF NOT EXISTS clean_file_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS clean_file_name TEXT DEFAULT '';
