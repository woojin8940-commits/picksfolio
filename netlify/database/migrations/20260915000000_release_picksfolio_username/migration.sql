-- 'picksfolio' 아이디를 다시 쓸 수 있게 비운다.
--
-- 수파베이스를 비운 뒤에도 가입 화면의 중복확인이 이 아이디를 "이미 사용 중" 으로
-- 답했다. 회원(수파베이스 profiles)과 개인 페이지 내용(여기 site_data)이 서로 다른
-- 데이터베이스에 있고, auth-check-username 은 둘 다 보기 때문이다 — site_data 에만
-- 남은 이름을 내주면 새 주인의 페이지가 남의 옛 내용으로 열리므로 일부러 막는다.
-- 수파베이스 쪽은 이미 비어 있으니 남은 잔여는 이 두 테이블뿐이다.
--
-- created_at 조건은 "이 마이그레이션을 쓴 시점보다 먼저 만들어진 행" 만 지우기
-- 위한 것이다. 이 파일은 프리뷰 브랜치에서 한 번, 배포 때 프로덕션에서 다시
-- 적용되는데, 그 사이에 같은 아이디로 새로 가입했다면 방금 만든 페이지가 지워진다.
-- 시각으로 끊어 두면 옛 행만 사라진다.
DELETE FROM site_data
WHERE username = 'picksfolio'
  AND created_at < TIMESTAMPTZ '2026-09-15 00:00:00+00';

-- 스냅샷이 남으면 복구 기능(api-site-restore)이 새 주인의 페이지에 옛 내용을
-- 되살릴 수 있다. 아이디를 비우는 일에는 스냅샷 정리까지 포함된다.
DELETE FROM site_data_snapshots
WHERE username = 'picksfolio'
  AND created_at < TIMESTAMPTZ '2026-09-15 00:00:00+00';
