-- 크리에이터 지원서에 활동 카테고리(뷰티, 패션 …)를 받는다. 고른 이름을 쉼표로 이어 한 칸에 넣는다(creatorCategories.ts 와 같은 형식).
ALTER TABLE creator_applications ADD COLUMN IF NOT EXISTS categories TEXT NOT NULL DEFAULT '';
