-- 리스트업으로 확정된 인플루언서의 연락처를 브랜드에 공개한 시각과 처리한 담당자.
-- 브랜드가 명단에서 고르고 담당자가 인플루언서와 이야기해 진행이 확정되면(협업 시작)
-- 그때부터 브랜드가 연락처를 본다. 비어 있으면 공개하지 않은 것이다.
ALTER TABLE campaign_listups ADD COLUMN IF NOT EXISTS contact_shared_at TIMESTAMPTZ;
ALTER TABLE campaign_listups ADD COLUMN IF NOT EXISTS contact_shared_by TEXT;
