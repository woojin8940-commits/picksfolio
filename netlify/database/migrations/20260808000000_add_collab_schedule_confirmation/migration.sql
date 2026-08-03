-- 캠페인 협업의 "협업 내역 일정 확정".
--
-- 캠페인 협업으로 성사된 건은 담당자가 조건을 확정하고 단계를 굴리지만, 그 결과가
-- 당사자의 협업 내역(협업 현황 → 협업 내역 / 캘린더)에는 업로드 확인 뒤 만들어지는
-- 정산 항목으로만 나타났다. 즉 협업이 확정된 시점부터 업로드 확인까지 몇 주 동안
-- 인플루언서의 캘린더에는 그 협업이 아예 없었고, 촬영·업로드 일정이 겹치는지
-- 확인할 방법도 없었다.
--
-- 담당자가 협업 기간(시작·종료)을 확인해 체크하면 그 즉시 협업 내역에 일정으로
-- 올라가도록 한다. 아래 컬럼은 그 확인 사실과 확인된 기간을 협업 행에 남긴다 —
-- 협업 내역 레코드는 Blobs 에 있으므로, "이미 체크했는지"를 판단할 근거가 협업
-- 쪽에도 있어야 한다.
--
--   schedule_start / schedule_end : 담당자가 확정한 협업 기간 (YYYY-MM-DD, 단계
--                                   마감일과 같은 TEXT 표기를 쓴다)
--   schedule_confirmed_at / _by   : 누가 언제 체크했는지
--   schedule_record_id            : 협업 내역에 만들어진 레코드 id (재확인 시 갱신 대상)

ALTER TABLE campaign_collabs
  ADD COLUMN IF NOT EXISTS schedule_start TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS schedule_end TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS schedule_confirmed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS schedule_confirmed_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS schedule_record_id TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_collabs_schedule_confirmed
  ON campaign_collabs(schedule_confirmed_at);
