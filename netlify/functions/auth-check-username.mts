import type { Config } from "@netlify/functions";
import { checkUsernameRules, normalizeUsername } from "./_shared/username-rules.mts";

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

/** 수파베이스 조회 상한. 넘기면 "사용 불가" 가 아니라 "다시 시도" 로 답한다. */
const PROFILE_LOOKUP_TIMEOUT_MS = 3500;
const SITE_DATA_LOOKUP_TIMEOUT_MS = 2500;

/**
 * Netlify DB 핸들을 이 인스턴스에 한 번만 만든다.
 *
 * getDatabase() 는 부를 때마다 새 pg.Pool 을 만든다. 핸들러 안에서 부르면 중복확인
 * 한 번마다 Postgres 로 TCP + TLS 핸드셰이크를 새로 하게 되고, 그 왕복이 조회
 * 자체보다 오래 걸렸다. 모듈 스코프에 붙여 두면 같은 인스턴스로 들어오는 다음
 * 요청은 이미 열린 연결을 쓴다.
 *
 * import 도 동적으로 한다. 이 패키지는 pg · ws · @neondatabase/serverless ·
 * waddler 를 함께 끌고 오는데, 정적 import 면 콜드 스타트가 그것을 다 읽은 뒤에야
 * 요청을 받는다. 동적이면 수파베이스 왕복과 같은 시점에 시작해 겹쳐 끝난다.
 */
let dbPromise: Promise<{ sql: any }> | null = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = import("@picks/netlify-database")
      .then((m) => m.getDatabase())
      .catch((err) => {
        dbPromise = null; // 다음 요청에서 다시 시도할 수 있게 둔다
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

/**
 * 수파베이스 profiles 에 이 아이디가 있는지.
 *
 * @supabase/supabase-js 대신 REST 엔드포인트를 직접 부른다. 필요한 것은 행 하나가
 * 있는지 없는지이고, 그 한 줄을 위해 SDK 를 읽어 들이는 비용이 콜드 스타트에
 * 그대로 얹혔다. username 은 이 호출 전에 [a-z0-9_]{3,20} 로 검사된 값이다.
 */
async function profileExists(username: string, serviceKey: string): Promise<boolean> {
  const url =
    `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=id&limit=1&username=eq.${encodeURIComponent(username)}`;

  const response = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(PROFILE_LOOKUP_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`profiles lookup failed (${response.status})`);

  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0;
}

/** site_data 에 이 아이디로 남은 페이지가 있는지. username 은 이 테이블의 기본키다. */
async function siteDataExists(username: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.sql`SELECT 1 FROM site_data WHERE username = ${username} LIMIT 1`;
  return rows.length > 0;
}

const takenResponse = (username: string) =>
  Response.json({
    success: true,
    available: false,
    username,
    reason: "taken",
    error: "이미 사용 중인 아이디입니다.",
  });

/**
 * 가입 화면의 "중복확인". 이 아이디로 지금 가입할 수 있는지만 답한다.
 *
 * 판정은 auth-signup 이 실제로 거절하는 조건과 같은 순서로 본다 — 형식 → 예약어 →
 * profiles 중복 → site_data 잔여. 마지막 것까지 보는 이유는 auth-signup 이
 * site_data 를 `ON CONFLICT (username) DO NOTHING` 으로 넣기 때문이다. 탈퇴 등으로
 * profiles 에는 없고 site_data 에만 남은 이름을 그대로 내주면, 새 주인의 페이지가
 * 남의 옛 페이지 내용으로 열린다.
 *
 * 형식·예약어는 값만 보면 알 수 있으니 먼저 끝내고(네트워크 0회), 남은 두 조회는
 * 서로를 기다릴 이유가 없으므로 함께 보낸다. 예전에는 profiles 응답을 받은 뒤에야
 * site_data 를 물어 왕복 두 번이 직렬로 쌓였다.
 *
 * 그리고 둘 중 하나라도 "있다" 고 하면 그 자리에서 끝낸다. 두 조회의 "있다" 는
 * 똑같은 "이미 사용 중" 이라 나머지 응답이 판정을 바꿀 수 없기 때문이다. 실제로
 * site_data 는 username 이 기본키여서 10ms 안에 오고 profiles 왕복은 그보다 한참
 * 길다 — 이미 쓰는 이름이면 그 긴 왕복을 기다리지 않는다. "없다" 는 반대로 두
 * 조회가 모두 답해야 믿을 수 있으므로 그때만 끝까지 기다린다.
 *
 * 응답은 상태 코드가 아니라 본문의 available 로 말한다(auth-signup 과 같은 방식).
 * 아이디가 실재하는지 여부는 프로필 페이지 주소를 열어 보면 누구나 알 수 있는
 * 정보라 별도 인증을 두지 않고, 대신 짧은 창의 호출 제한을 둔다.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername((body as any)?.username);

    if (!username) {
      return Response.json({
        success: true,
        available: false,
        username,
        reason: "format",
        error: "사용할 아이디를 입력해 주세요.",
      });
    }

    const rules = checkUsernameRules(username);
    if (!rules.ok) {
      return Response.json({
        success: true,
        available: false,
        username,
        reason: rules.reason,
        error: rules.error,
      });
    }

    const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

    // 두 조회를 함께 띄운다. 어느 쪽도 reject 하지 않게 감싸 둔다 — 한쪽을 먼저
    // 돌려주고 끝낼 수 있어야 하는데, 버려진 promise 가 reject 하면 처리되지 않은
    // 거부가 된다.
    const profileLookup = withDeadline(profileExists(username, serviceKey), PROFILE_LOOKUP_TIMEOUT_MS)
      .then((taken) => ({ taken, failed: false }))
      .catch(() => ({ taken: false, failed: true }));

    const siteDataLookup = withDeadline(siteDataExists(username), SITE_DATA_LOOKUP_TIMEOUT_MS)
      .then((taken) => ({ taken, failed: false }))
      .catch(() => ({ taken: false, failed: true }));

    // 먼저 도착한 "있다" 로 끝낸다. 둘 다 "없다" 일 때만 양쪽을 다 기다린다.
    const taken = await new Promise<boolean>((resolve) => {
      let remaining = 2;
      const consider = ({ taken }: { taken: boolean }) => {
        if (taken) resolve(true);
        else if (--remaining === 0) resolve(false);
      };
      void profileLookup.then(consider);
      void siteDataLookup.then(consider);
    });

    if (taken) return takenResponse(username);

    const profile = await profileLookup;
    const siteData = await siteDataLookup;
    if (profile.failed || siteData.failed) {
      return Response.json(
        { success: false, error: "아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 }
      );
    }

    return Response.json({ success: true, available: true, username });
  } catch (err: any) {
    const missingKey = String(err?.message || "").includes("SUPABASE_SERVICE_ROLE_KEY");
    return Response.json(
      { success: false, error: "아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: missingKey ? 500 : 503 }
    );
  }
};

export const config: Config = {
  path: "/.netlify/functions/auth-check-username",
  // 가입 화면에서 아이디를 여러 번 바꿔 가며 눌러 보는 것이 정상적인 사용이라
  // 가입(10회)보다 넉넉하게 둔다. 화면이 입력이 멈춘 뒤 미리 한 번 확인해 두므로
  // (utils/usernameCheck) 한 사람이 쓰는 호출 수가 예전보다 늘어난다.
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: "ip" },
};
