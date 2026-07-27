import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * 사용자 본인 확인 (Supabase 액세스 토큰 검증).
 *
 * DM 자동화 관련 API 는 지금까지 경로의 `:username` 만 믿고 동작했다. 즉 남의
 * 아이디만 알면 자동화 설정을 읽고, 고치고, 인스타그램 연동까지 끊을 수 있었다.
 * 그래서 호출자가 실제로 그 계정으로 로그인한 사람인지 여기서 한 번 확인한다.
 *
 * 흐름:
 *   1. `Authorization: Bearer <supabase access_token>` 헤더를 읽는다.
 *   2. 서비스 롤 키로 토큰을 검증해 auth 사용자 ID 를 얻는다.
 *   3. `profiles` 에서 그 ID 의 username 을 읽어 경로의 username 과 대조한다.
 *   4. 관리자(role=admin)는 통과시킨다 — 고객 지원 시 대신 조회해야 한다.
 *
 * 비즈니스 계정은 `profiles.username` 에는 접두사 없이 저장되지만 화면/블롭에서는
 * `biz/<이름>` 으로 다루므로, 비교 전에 양쪽에서 접두사를 떼어낸다.
 */

/** src/services/supabase.ts 와 동일한 폴백. 공개 프로젝트 URL 이라 비밀값이 아니다. */
const FALLBACK_SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

let _client: SupabaseClient | null = null;

function getAuthClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;
  _client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

const stripBizPrefix = (name: string) => name.replace(/^biz\//, "");

/** 경로 파라미터와 프로필의 username 을 같은 형태로 맞춘다. */
function normalizeName(raw: string): string {
  return stripBizPrefix(decodeURIComponent(raw).trim().toLowerCase());
}

export function bearerToken(req: Request): string {
  const header = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export type AuthResult =
  | { ok: true; username: string; userId: string; isAdmin: boolean }
  | { ok: false; response: Response };

/**
 * 토큰을 검증해 "호출한 사람이 누구인지"까지만 확인한다.
 * 어느 계정에 접근할 수 있는지는 호출부에서 판단한다.
 */
export async function requireSignedInUser(req: Request): Promise<AuthResult> {
  const client = getAuthClient();
  if (!client) {
    // 키가 없으면 검증할 방법이 없다. 열어두면 인증이 있으나 마나이므로 막는다.
    console.error("[user-auth] SUPABASE_SERVICE_ROLE_KEY 미설정 — 요청을 거부한다");
    return {
      ok: false,
      response: Response.json({ error: "인증 서버가 준비되지 않았습니다." }, { status: 503 }),
    };
  }

  const token = bearerToken(req);
  if (!token) {
    return {
      ok: false,
      response: Response.json(
        { error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" },
        { status: 401 },
      ),
    };
  }

  const { data, error } = await client.auth.getUser(token);
  const user = data?.user;
  if (error || !user) {
    return {
      ok: false,
      response: Response.json(
        { error: "로그인이 만료되었습니다. 다시 로그인해 주세요.", code: "AUTH_EXPIRED" },
        { status: 401 },
      ),
    };
  }

  const { data: profile } = await client
    .from("profiles")
    .select("username, role")
    .eq("id", user.id)
    .maybeSingle();

  return {
    ok: true,
    username: normalizeName(String(profile?.username || "")),
    userId: user.id,
    isAdmin: (profile?.role || "").toLowerCase() === "admin",
  };
}

const forbidden = (): { ok: false; response: Response } => ({
  ok: false,
  response: Response.json(
    { error: "다른 계정의 정보에는 접근할 수 없습니다.", code: "AUTH_FORBIDDEN" },
    { status: 403 },
  ),
});

/** 접근 거부 응답. 소유자 목록을 나중에(자원을 읽은 뒤) 판단하는 곳에서 쓴다. */
export const forbiddenResponse = (): Response => forbidden().response;

/**
 * 이미 검증된 호출자가 후보 계정 중 하나인지 판단한다. 자원을 먼저 읽어야
 * 당사자를 알 수 있는 경우(타임라인 등) 토큰을 두 번 검증하지 않도록 분리해 둔다.
 *
 * 후보가 모두 비어 있으면 판단할 근거가 없으니 거부한다.
 */
export function callerIsAnyOf(
  caller: { username: string; isAdmin: boolean },
  usernames: (string | null | undefined)[],
): boolean {
  if (caller.isAdmin) return true;
  const targets = usernames
    .filter((u): u is string => typeof u === "string" && u.trim() !== "")
    .map(normalizeName);
  return !!caller.username && targets.includes(caller.username);
}

/**
 * `username` 계정의 소유자(또는 관리자)만 통과시킨다.
 * 실패하면 그대로 반환할 수 있는 Response 를 함께 돌려준다.
 */
export async function requireAccountOwner(req: Request, username: string): Promise<AuthResult> {
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller;

  const target = normalizeName(username);
  if (!caller.isAdmin && (!caller.username || caller.username !== target)) {
    return forbidden();
  }

  return { ok: true, username: target, userId: caller.userId, isAdmin: caller.isAdmin };
}

/**
 * 여러 당사자가 정당하게 접근하는 자원(예: 타임라인은 인플루언서와 업체 양쪽이
 * 본다)에 쓴다. 후보 중 하나라도 본인 계정이면 통과시킨다.
 *
 * 후보가 모두 비어 있으면(자원에 주인이 기록돼 있지 않으면) 판단할 근거가 없으니
 * 막는다 — 빈 목록을 통과시키면 인증이 있으나 마나가 된다.
 */
export async function requireAnyAccountOwner(
  req: Request,
  usernames: (string | null | undefined)[],
): Promise<AuthResult> {
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller;
  if (!callerIsAnyOf(caller, usernames)) return forbidden();
  return caller;
}
