-- 브랜드가 선정하면 담당자 연락 없이 바로 전용 링크가 열리도록 바뀌었다.
-- 이미 선정됐지만 담당자 연락을 기다리던(waiting · contacting) 신청도 진행 확정으로 넘긴다.
-- 링크 코드는 인플루언서가 MY 어필리에이트를 열 때 붙는다.
UPDATE affiliate_store_requests
SET manager_status = 'done', manager_updated_at = NOW(), updated_at = NOW()
WHERE status = 'approved' AND manager_status IN ('', 'waiting', 'contacting');
