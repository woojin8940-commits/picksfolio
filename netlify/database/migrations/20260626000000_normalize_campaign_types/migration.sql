-- 캠페인 유형(type) 값 정규화.
-- 캠페인 협업 화면의 유형 필터/등록 폼은 'ad_collab'(광고 협업) · 'group_buy'(공동구매)
-- · 'other'(기타) 세 가지 값만 사용하도록 정리됐으나, 과거 버전에서 등록된 캠페인은
-- 'advertisement' · 'collaboration' · 'review' · 'event' 같은 옛 값으로 저장되어 있다.
-- 이 옛 값들은 '전체' 탭에는 보이지만 '광고 협업' 등 유형 탭 필터(type=ad_collab)에는
-- 매칭되지 않아 누락되는 문제가 있어, 현재 유형 체계로 일괄 매핑한다.
UPDATE campaigns SET type = 'ad_collab' WHERE type IN ('advertisement', 'collaboration');
UPDATE campaigns SET type = 'other' WHERE type IN ('review', 'event');
