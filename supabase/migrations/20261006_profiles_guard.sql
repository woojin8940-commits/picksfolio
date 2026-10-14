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

LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS public.public_profile_data (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (btrim(username) <> ''),
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  bio text,
  site_data jsonb,
  updated_at timestamptz
);

ALTER TABLE public.public_profile_data OWNER TO postgres;
ALTER TABLE public.public_profile_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_profile_data FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, full_name, avatar_url, bio, site_data, updated_at)
  ON public.public_profile_data TO anon, authenticated;
GRANT ALL ON public.public_profile_data TO service_role;

DROP POLICY IF EXISTS public_profile_data_read ON public.public_profile_data;
CREATE POLICY public_profile_data_read ON public.public_profile_data
  FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS public_profile_data_username_idx ON public.public_profile_data (username);

CREATE OR REPLACE FUNCTION public.sync_public_profile_data()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    DELETE FROM public.public_profile_data;
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profile_data WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
    DELETE FROM public.public_profile_data WHERE id = OLD.id;
  END IF;
  IF NEW.username IS NULL OR btrim(NEW.username) = '' THEN
    DELETE FROM public.public_profile_data WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.public_profile_data AS existing
    (id, username, full_name, avatar_url, bio, site_data, updated_at)
  VALUES (
    NEW.id, NEW.username,
    CASE
      WHEN jsonb_typeof(NEW.site_data #> '{profile,name}') = 'string' THEN NEW.site_data #>> '{profile,name}'
      WHEN lower(btrim(COALESCE(NEW.role, ''))) = 'operator' THEN COALESCE(NEW.full_name, '')
      ELSE ''
    END,
    NEW.avatar_url, NEW.bio, NEW.site_data, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username, full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url, bio = EXCLUDED.bio,
    site_data = EXCLUDED.site_data, updated_at = EXCLUDED.updated_at
  WHERE (existing.username, existing.full_name, existing.avatar_url, existing.bio, existing.site_data, existing.updated_at)
    IS DISTINCT FROM (EXCLUDED.username, EXCLUDED.full_name, EXCLUDED.avatar_url, EXCLUDED.bio, EXCLUDED.site_data, EXCLUDED.updated_at);
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_public_profile_data() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_public_profile_data() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER public_profiles_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile_data();
CREATE OR REPLACE TRIGGER public_profiles_sync_truncate
  AFTER TRUNCATE ON public.profiles
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_public_profile_data();

INSERT INTO public.public_profile_data AS existing
  (id, username, full_name, avatar_url, bio, site_data, updated_at)
SELECT id, username,
  CASE
    WHEN jsonb_typeof(site_data #> '{profile,name}') = 'string' THEN site_data #>> '{profile,name}'
    WHEN lower(btrim(COALESCE(role, ''))) = 'operator' THEN COALESCE(full_name, '')
    ELSE ''
  END AS full_name,
  avatar_url, bio, site_data, updated_at
FROM public.profiles
WHERE username IS NOT NULL AND btrim(username) <> ''
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username, full_name = EXCLUDED.full_name,
  avatar_url = EXCLUDED.avatar_url, bio = EXCLUDED.bio,
  site_data = EXCLUDED.site_data, updated_at = EXCLUDED.updated_at
WHERE (existing.username, existing.full_name, existing.avatar_url, existing.bio, existing.site_data, existing.updated_at)
  IS DISTINCT FROM (EXCLUDED.username, EXCLUDED.full_name, EXCLUDED.avatar_url, EXCLUDED.bio, EXCLUDED.site_data, EXCLUDED.updated_at);

DELETE FROM public.public_profile_data AS projected
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles AS original
  WHERE original.id = projected.id AND original.username IS NOT NULL AND btrim(original.username) <> ''
);

CREATE OR REPLACE VIEW public.public_profiles WITH (security_barrier = true, security_invoker = true) AS
SELECT id, username, full_name, avatar_url, bio, site_data, updated_at
FROM public.public_profile_data;

REVOKE ALL ON public.public_profiles FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.public_profiles FROM anon, authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profiles AS original
    FULL JOIN public.public_profile_data AS projected ON projected.id = original.id
    WHERE CASE
      WHEN original.id IS NULL THEN true
      WHEN original.username IS NULL OR btrim(original.username) = '' THEN projected.id IS NOT NULL
      ELSE projected.id IS NULL OR
        (projected.username, projected.full_name, projected.avatar_url, projected.bio, projected.site_data, projected.updated_at)
        IS DISTINCT FROM (
          original.username,
          CASE
            WHEN jsonb_typeof(original.site_data #> '{profile,name}') = 'string' THEN original.site_data #>> '{profile,name}'
            WHEN lower(btrim(COALESCE(original.role, ''))) = 'operator' THEN COALESCE(original.full_name, '')
            ELSE ''
          END,
          original.avatar_url, original.bio, original.site_data, original.updated_at
        )
      END
  ) OR EXISTS (
    SELECT 1 FROM (VALUES ('anon'), ('authenticated')) AS reader(role_name)
    WHERE has_table_privilege(reader.role_name, 'public.public_profile_data', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_table_privilege(reader.role_name, 'public.public_profiles', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_function_privilege(reader.role_name, 'public.sync_public_profile_data()', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Public profile synchronization or access validation failed';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
