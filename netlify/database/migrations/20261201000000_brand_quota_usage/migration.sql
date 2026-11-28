-- 브랜드 멤버십 월 한도 사용 기록.
--   kind = 'campaign' : 그 캠페인에 리스트업을 처음 올린 시점(캠페인 1건 차감)
--   kind = 'selected' : 진행이 확정되어 연락처를 공개한 인플루언서(선정 1명 차감)
-- 같은 캠페인 · 같은 후보는 한 번만 센다(ref_id 유일). 결제 주기 시작 이후의 행만 그 달 사용량이다.
CREATE TABLE IF NOT EXISTS brand_quota_usage (
  id BIGSERIAL PRIMARY KEY,
  company_username TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_username, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS brand_quota_usage_company_time
  ON brand_quota_usage (company_username, kind, created_at);
