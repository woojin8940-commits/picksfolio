BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- profiles 의 권한 칸은 서버만 바꾼다.
--
-- 화면은 로그인한 사용자 토큰으로 profiles 를 직접 쓴다(첫 로그인 때 행 만들기, 페이지
-- 설정 동기화). 그래서 행 단위 보안 정책이 "본인 행 수정"을 열어 두면 같은 경로로
-- role 을 admin 으로 바꾸거나 아이디를 다른 이름(지워진 계정의 이름 포함)으로 바꿀 수
-- 있다. role 은 관리자·브랜드 판정의 근거이고, 아이디는 페이지·연동·멤버십 기록이 묶인
-- 키다. 둘 다 서버 함수(service_role)가 확인을 거쳐 바꾼다.
--
-- 사용자 토큰(authenticated · anon)으로 들어온 쓰기에서만 막는다. 서버 함수 · 대시보드 ·
-- 인증 서비스가 쓰는 값은 그대로 둔다. 다른 칸(소개 · 사진 · 연락처 등)은 건드리지 않는다.
CREATE OR REPLACE FUNCTION public.profiles_guard_privileged()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  protected text[] := ARRAY['role', 'username', 'featured', 'featured_at', 'featured_note'];
  before_row jsonb;
  patch jsonb := '{}'::jsonb;
  col text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 권한을 뜻하는 값만 막는다. 허용할 값만 적어 두면, 화면이 role 없이 행을 만들 때 들어가는
    -- 열 기본값(이 저장소 밖, 대시보드에서 정해진다)이 그 목록 밖이면 첫 로그인이 통째로 실패한다.
    -- 서버는 앞뒤 공백을 지우고 소문자로 비교하므로, 여기서는 영문자만 남겨 비교한다 — 공백 ·
    -- 줄바꿈을 섞은 'admin' 도 같은 값으로 걸린다.
    IF regexp_replace(lower(COALESCE(to_jsonb(NEW) ->> 'role', '')), '[^a-z]', '', 'g')
       IN ('admin', 'operator', 'business', 'manager', 'brand') THEN
      RAISE EXCEPTION 'profiles.role can only be set by the server' USING ERRCODE = '42501';
    END IF;
    patch := jsonb_build_object('username', NULL);
    IF to_jsonb(NEW) ? 'featured' THEN
      patch := patch || jsonb_build_object('featured', false, 'featured_at', NULL, 'featured_note', NULL);
    END IF;
    RETURN jsonb_populate_record(NEW, patch);
  END IF;

  before_row := to_jsonb(OLD);
  FOREACH col IN ARRAY protected LOOP
    IF before_row ? col THEN
      patch := patch || jsonb_build_object(col, before_row -> col);
    END IF;
  END LOOP;
  RETURN jsonb_populate_record(NEW, patch);
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileged ON public.profiles;
CREATE TRIGGER profiles_guard_privileged
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_privileged();

COMMIT;
