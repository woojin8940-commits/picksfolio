import type { Config } from "@netlify/functions";
import { getSupabaseServer } from "./_shared/supabase.mts";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { checkUsernameRules, normalizeUsername } from "./_shared/username-rules.mts";

/**
 * 가입 직후 "나만의 링크"(= 아이디)를 정하는 요청.
 *
 * 카카오로 가입한 사람은 아이디를 스스로 정해야 하는데, 지금까지 그 저장은 화면에서
 * 수파베이스 `profiles` 로 직접 upsert 하는 방식이었다. 그래서 다음이 모두 "저장 중
 * 오류가 발생했습니다." 한 줄로 보였다 — 사용자가 고칠 수 있는 것이 무엇인지 알 수
 * 없는 막다른 화면이다.
 *
 *   · 세션이 아직 복구되지 않아 화면이 들고 있던 사용자 ID 가 빈 문자열이었을 때
 *     (저장 버튼은 눌리고, 서버는 빈 값을 UUID 로 읽지 못해 거절한다)
 *   · RLS 가 그 쓰기를 거부했을 때
 *   · 이름이 이미 쓰이고 있어 고유 제약에 걸렸을 때 — 화면의 중복확인은 공개 뷰
 *     (`public_profiles`)만 보고, 그 조회가 실패하면 오류를 버린 뒤 그대로 저장을
 *     시도했다
 *
 * 그래서 이 쓰기를 서버로 옮긴다. 세 가지가 함께 정리된다.
 *
 *   1. 누구인지는 액세스 토큰에서 정한다. 화면이 보낸 사용자 ID 를 믿지 않으므로
 *      세션 복구와 경합하지 않고, 로그인이 끊긴 경우는 "다시 로그인" 으로 답한다.
 *   2. 판정 규칙이 일반 가입과 같아진다 — 형식 · 예약어(`username-rules`) ·
 *      `profiles` 중복 · `site_data` 잔여. 예전에는 예약어 검사가 없어서 `admin` ·
 *      `login` 같은 이름을 링크로 가져갈 수 있었고, 그렇게 만든 페이지는 라우터가
 *      먼저 화면 이름으로 읽기 때문에 아무도 열 수 없었다. `site_data` 잔여 검사가
 *      없으면 탈퇴한 계정의 페이지 내용이 새 주인의 주소에서 그대로 열린다.
 *   3. 실패는 이유를 붙여 돌려준다(`reason`). 화면은 그 이유대로 안내할 수 있다.
 */

/** 수파베이스 조회 상한. */
const PROFILE_LOOKUP_TIMEOUT_MS = 4_000;
const SITE_DATA_LOOKUP_TIMEOUT_MS = 2_500;

/**
 * Netlify DB 핸들을 이 인스턴스에 한 번만 만든다(auth-check-username 과 같은 이유).
 * getDatabase() 는 부를 때마다 새 풀을 만들고, 이 패키지는 정적으로 import 하면
 * 콜드 스타트가 pg · ws 까지 다 읽은 뒤에야 요청을 받는다.
 */
let dbPromise: Promise<{ sql: any }> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = import("@picks/netlify-database")
      .then((m) => m.getDatabase())
      .catch((err) => {
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("lookup timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** 탈퇴 등으로 `site_data` 에만 남은 이름인지. username 은 이 테이블의 기본키다. */
async function siteDataExists(username: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.sql`SELECT 1 FROM site_data WHERE username = ${username} LIMIT 1`;
  return rows.length > 0;
}

const TAKEN_MESSAGE = "이미 사용 중인 링크입니다. 다른 링크를 입력해 주세요.";

const fail = (reason: string, error: string, status = 200) =>
  Response.json({ success: false, reason, error }, { status });

export default async (req: Request) => {
  if (req.method !== "POST") {
    return fail("method", "Method not allowed", 405);
  }

  // 누구인지는 토큰으로만 정한다.
  const auth = await requireSignedInUser(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const username = normalizeUsername((body as any)?.username);

  const rules = checkUsernameRules(username);
  if (!rules.ok) return fail(rules.reason, rules.error);

  let supabase;
  try {
    supabase = getSupabaseServer();
  } catch (err) {
    console.error("[auth-claim-username] 수파베이스 환경변수 미설정:", err);
    return fail("server", "링크를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }

  try {
    // 이 이름의 주인이 있는지, 그리고 내 프로필에 이미 링크가 있는지를 함께 본다.
    // 주인 조회는 maybeSingle 이 아니라 limit(1) 로 한다 — 같은 이름의 행이 둘 이상
    // 있으면(고유 제약이 없던 시절의 잔여) maybeSingle 은 오류를 내고, 그러면 확실히
    // 쓰이고 있는 이름이 "확인하지 못했습니다" 로 답해진다.
    const [{ data: owners, error: ownerError }, { data: mine, error: mineError }] = await withDeadline(
      Promise.all([
        supabase.from("profiles").select("id").eq("username", username).limit(1),
        supabase.from("profiles").select("id, username").eq("id", auth.userId).maybeSingle(),
      ]),
      PROFILE_LOOKUP_TIMEOUT_MS,
    );

    // 조회 실패를 "빈 결과" 로 넘기지 않는다. 넘기면 중복인 이름을 그대로 저장하러
    // 갔다가 고유 제약에 걸려 다시 이유 없는 오류가 된다.
    if (ownerError || mineError) {
      console.error("[auth-claim-username] profiles 조회 실패:", ownerError || mineError);
      return fail("lookup", "링크를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    }

    const owner = Array.isArray(owners) ? owners[0] : null;
    if (owner && owner.id !== auth.userId) return fail("taken", TAKEN_MESSAGE);

    // 이미 이 링크로 저장돼 있으면 성공으로 답한다 — 저장은 됐는데 응답만 못 받아
    // 다시 누른 경우(모바일 회선에서 흔하다)가 오류로 끝나지 않아야 한다.
    const current = normalizeUsername(mine?.username);
    if (current === username) {
      return Response.json({ success: true, username });
    }
    // 이 계정에 이미 다른 링크가 있다. 화면이 열려 있는 동안 카카오 프로필 보정이
    // 늦게 끝나 이름을 채웠거나, 다른 탭에서 먼저 만든 경우다. 실제로 쓸 수 있는
    // 링크를 함께 돌려준다 — 화면은 그 링크로 대시보드에 들어가면 된다. 오류만
    // 남기면 이미 링크가 있는 사람이 링크 만들기 화면에 갇힌다.
    if (current) {
      return Response.json(
        {
          success: false,
          reason: "already_set",
          username: current,
          error: "이미 만들어 둔 링크가 있습니다.",
        },
        { status: 409 },
      );
    }

    try {
      if (await withDeadline(siteDataExists(username), SITE_DATA_LOOKUP_TIMEOUT_MS)) {
        return fail("taken", TAKEN_MESSAGE);
      }
    } catch (err) {
      console.error("[auth-claim-username] site_data 조회 실패:", err);
      return fail("lookup", "링크를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    }

    const payload = { username, updated_at: new Date().toISOString() };
    const { error: writeError } = mine
      ? await supabase.from("profiles").update(payload).eq("id", auth.userId)
      : await supabase.from("profiles").insert({ id: auth.userId, ...payload, role: "user" });

    if (writeError) {
      // 고유 제약 위반은 "방금 다른 사람이 같은 이름을 가져갔다" 는 뜻이다.
      // 위 조회와 이 쓰기 사이의 틈에서만 생기며, 사용자가 할 일은 다른 이름이다.
      const duplicate = (writeError as any).code === "23505"
        || /duplicate key|already exists/i.test(writeError.message || "");
      if (duplicate) return fail("taken", TAKEN_MESSAGE);
      console.error("[auth-claim-username] profiles 저장 실패:", writeError);
      return fail("write", "링크를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
    }

    return Response.json({ success: true, username });
  } catch (err) {
    console.error("[auth-claim-username] 처리 실패:", err);
    return fail("server", "링크를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
};

export const config: Config = {
  path: "/.netlify/functions/auth-claim-username",
  // 이름을 몇 번 바꿔 가며 시도하는 것이 정상적인 사용이다. 가입(10회)보다 넉넉히.
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: "ip" },
};
