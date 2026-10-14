-- 비즈니스 제안을 수락할 때 인플루언서가 브랜드에게 넘기는 연락처.
--
-- 제안 이후의 대화는 대부분 카카오톡으로 오간다. 그런데 브랜드 연락처는 제안서에
-- 담겨 인플루언서에게 보이지만, 반대로 브랜드는 수락 뒤에도 인플루언서에게 연락할
-- 방법이 협업 타임라인밖에 없었다. 수락하는 순간 인플루언서가 직접 적어 낸
-- 카카오톡 아이디와 휴대폰 번호를 이 제안에만 붙여, 그 브랜드만 보게 한다.
--
-- contact_shared_at 은 제3자 제공에 동의하고 넘긴 시각이다. 계정 정보에서 자동으로
-- 끌어오지 않고, 이 값이 있는 제안에만 연락처를 내려 준다.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS influencer_kakao_id TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS influencer_phone TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS contact_shared_at TIMESTAMPTZ;
