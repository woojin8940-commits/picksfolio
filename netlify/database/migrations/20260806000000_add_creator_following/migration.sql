-- Meta API에서 확인한 인스타그램 팔로잉 수를 채널 스냅샷에 함께 보관한다.
-- 기존 팔로워·릴스 지표와 같은 시점에 갱신되어 운영자 지원자 명단에서 사용된다.
ALTER TABLE creator_channels
  ADD COLUMN IF NOT EXISTS following INTEGER DEFAULT 0;
