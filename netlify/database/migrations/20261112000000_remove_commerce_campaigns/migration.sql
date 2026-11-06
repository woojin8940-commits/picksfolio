-- 커머스형(공동구매) 캠페인을 없앤다. 어필리에이트 스토어가 같은 역할을 맡는다.
-- 다른 캠페인 삭제와 같게 목록에서 내리기만 하고(deleted_at), 협업 · 지원 기록은 이력으로 남긴다.
UPDATE campaigns
SET deleted_at = NOW(), updated_at = NOW()
WHERE (reward_mode = 'groupbuy' OR type = 'group_buy') AND deleted_at IS NULL;
