-- 캠페인 등록을 "브리프"로 만들기 위한 컬럼.
--
-- 지금까지 브랜드가 남기는 것은 제목·설명·보상·기간뿐이었다. 그 정보만으로는
-- 담당자가 조건을 확정할 수 없어서, 선정 직후 담당자가 브랜드에게 "제품이
-- 무엇인지, 어느 채널에 올리는지, 언제 게시해야 하는지, 2차 활용은 하는지"를
-- 다시 물어보는 일이 매번 생긴다. 그 왕복을 없애려면 캠페인을 만드는 순간에
-- 받아 두어야 한다.
--
-- 컬럼을 나눠 두는 이유는 설명(description)에 섞어 적으면 화면이 그것을
-- 구조적으로 보여줄 수 없기 때문이다. 인플루언서 지원 화면의 "요청 광고" 카드,
-- 담당자의 조건 확정 폼, 가이드라인 미리보기가 모두 이 컬럼들을 그대로 읽는다.

ALTER TABLE campaigns
  -- 무엇을 광고하는지
  ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS product_url TEXT DEFAULT '',
  -- 어디에 어떤 형식으로 올리는지 (인스타그램/틱톡/유튜브 · 숏폼/릴스/롱폼)
  ADD COLUMN IF NOT EXISTS upload_channel TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS content_format TEXT DEFAULT '',
  -- 영상 컨셉과 가이드라인. guideline_note 는 필수 표기·해시태그·촬영 요건.
  ADD COLUMN IF NOT EXISTS video_concept TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guideline_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guideline_note TEXT DEFAULT '',
  -- 2차 활용(브랜드 계정 재게시·광고 소재 사용) 비용. 광고비와 별도로 받는다 —
  -- 하나로 합쳐 두면 "이 금액에 2차 활용이 포함되는가"로 반드시 분쟁이 난다.
  ADD COLUMN IF NOT EXISTS second_use_fee INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS second_use_note TEXT DEFAULT '',
  -- 희망 게시일 구간. 모집 기간(start_date~end_date)과 다른 날짜다.
  ADD COLUMN IF NOT EXISTS upload_from TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS upload_to TEXT DEFAULT '';
