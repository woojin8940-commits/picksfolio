/**
 * 픽스폴리오 담당자 확인.
 *
 * 캠페인 협업의 결정권이 브랜드에서 담당자로 넘어오면서, "이 요청을 보낸 사람이
 * 우리 쪽 담당자인가"를 판정할 곳이 필요해졌다. 문제는 이 저장소에 로그인 경로가
 * 두 개라는 점이다.
 *
 *   * 운영 콘솔(/admin)  : Netlify Identity — 쿠키 또는 Bearer 토큰, 역할은 app_metadata.roles
 *   * 서비스 화면        : Supabase — Bearer 토큰, 역할은 profiles.role
 *
 * 담당자는 운영 콘솔에서 일하지만, 담당자 채널 대화는 서비스 화면 쪽 API
 * (api-timeline-*)를 그대로 쓴다. 그래서 두 경로 중 **어느 쪽으로든** 관리자임이
 * 확인되면 담당자로 인정한다. 한쪽만 보면 같은 사람이 화면에 따라 권한을 잃는다.
 *
 * 여기에 세 번째 경로가 붙는다. 운영자가 일반 계정을 담당자로 배정하는 경로다
 * (platform_managers). 관리자 권한 없이 담당자 일만 하는 사람이 있어야 한다 —
 * 담당자를 늘리려고 매출·정산·회원 정보까지 열어 주는 관리자 계정을 찍어낼 수는 없다.
 * 이 경로로 들어온 사람은 관리자가 아니므로, 화면 범위를 정할 때 구분할 수 있도록
 * via 에 "assigned" 를 남긴다.
 *
 * 담당자 개인을 구분하는 값(managerUsername)은 큐 배정과 표시에 쓰고, 권한
 * 판정에는 쓰지 않는다. 담당자가 휴가·퇴사로 자리를 비웠을 때 다른 담당자가 손을
 * 댈 수 없으면 협업이 그대로 멈추기 때문이다 — 누가 처리했는지는 이벤트 원장에
 * 남으므로 사후 확인이 가능하다.
 */

import { requireAdmin } from "./admin-auth.mts";
import { requireSignedInUser } from "./user-auth.mts";

export type ManagerAuth =
  | { ok: true; managerUsername: string; via: "identity" | "supabase" | "assigned"; isAdmin: boolean }
  | { ok: false; response: Response };

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

/** 이메일에서 담당자 식별자를 만든다. `woojin8940@...` → `woojin8940` */
const usernameFromEmail = (email: unknown) => norm(String(email || "").split("@")[0]);

const forbidden = () =>
  Response.json(
    { error: "픽스폴리오 담당자만 처리할 수 있습니다.", code: "MANAGER_REQUIRED" },
    { status: 403 },
  );

/**
 * 운영자가 배정한 담당자인지 확인한다.
 *
 * 표가 아직 없는 환경(마이그레이션 전 프리뷰)에서도 관리자 경로는 살아 있어야
 * 하므로, 조회가 실패하면 "담당자 아님"으로만 처리하고 오류를 올리지 않는다.
 */
export async function isAssignedManager(username: string): Promise<boolean> {
  const uname = norm(username);
  if (!uname) return false;
  try {
    const { getDatabase } = await import("@picks/netlify-database");
    const db = getDatabase();
    const rows = (await db.sql`
      SELECT 1 FROM platform_managers WHERE username = ${uname} AND active LIMIT 1
    `) as any[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * 담당자 권한이 필요한 요청에 쓴다. 세 인증 경로를 차례로 시도하고, 실패 응답은
 * 마지막으로 시도한 경로의 것이 아니라 담당자 전용 메시지로 통일한다 — 호출자는
 * "관리자 로그인이 필요하다"는 사실만 알면 되고, 어떤 인증 체계를 쓰는지는 알
 * 필요가 없다.
 *
 * 순서를 resolveIdentities 에 맡긴다. 예전에는 여기서 운영 콘솔(Netlify Identity)을
 * **먼저** 봤는데, 그 인증은 `nf_jwt` 쿠키로도 성립한다. 그래서 운영 콘솔에 한 번
 * 로그인한 브라우저에서는 어떤 서비스 계정으로 로그인하든 담당자 아이디가 운영자
 * 이메일 앞부분으로 바뀌었다. 권한 판정은 통과하니 화면은 열리는데, 그 아이디로
 * "내 담당"을 조회하면 campaigns.manager_username 과 아무것도 맞지 않아 목록이
 * 통째로 빈다 — 배정된 담당자가 "담당되었는데 캠페인이 안 보인다"고 하던 것이
 * 이것이다. 탭 배지는 화면이 자기 아이디로 세므로 숫자만 남고 목록은 비어,
 * 증상이 데이터 문제처럼 보였다.
 *
 * 그래서 서비스 계정을 먼저 본다. 배정된 담당자는 서비스 계정으로 로그인하므로 그
 * 사람의 아이디가 자원을 찾는 기준과 같아야 한다. 운영 콘솔 경로는 서비스 계정이
 * 담당자가 아닐 때만 쓴다(운영자가 담당자 화면을 대신 열어 보는 경우).
 */
export async function requireManager(req: Request): Promise<ManagerAuth> {
  const { manager } = await resolveIdentities(req);
  if (!manager) return { ok: false, response: forbidden() };
  return {
    ok: true,
    managerUsername: manager.username,
    via: manager.via,
    isAdmin: manager.isAdmin,
  };
}

/**
 * 운영자(관리자)만 통과시킨다. 담당자 배정·해제처럼 담당자 자신이 해서는 안 되는
 * 일에 쓴다 — 담당자가 스스로를 해제하거나 동료를 배정할 수 있으면 배정 이력이
 * 권한의 근거가 되지 못한다.
 */
export async function requireOperator(
  req: Request,
): Promise<{ ok: true; username: string } | { ok: false; response: Response }> {
  const identity = await requireAdmin(req);
  if (identity.ok) {
    return { ok: true, username: usernameFromEmail((identity.user as any)?.email || "") };
  }
  const supabase = await requireSignedInUser(req);
  if (supabase.ok && supabase.isAdmin) {
    return { ok: true, username: supabase.username };
  }
  return {
    ok: false,
    response: Response.json(
      { error: "운영자만 처리할 수 있습니다.", code: "OPERATOR_REQUIRED" },
      { status: 403 },
    ),
  };
}

/**
 * 담당자인지 여부만 알고 싶을 때(권한 판정이 아니라 화면 범위 결정에 쓸 때).
 * 담당자가 아니어도 오류가 아니므로 Response 를 만들지 않는다.
 */
export async function resolveManager(req: Request): Promise<string | null> {
  const result = await requireManager(req);
  return result.ok ? result.managerUsername || "manager" : null;
}

/** resolveIdentities 가 돌려주는 두 신분. 둘 다 없을 수도, 둘 다 있을 수도 있다. */
export type Identities = {
  /** 서비스 계정(브랜드·인플루언서)으로 로그인한 사람. 확인되지 않으면 null. */
  account: { username: string; userId: string; isAdmin: boolean } | null;
  /** 담당자 자격. 없으면 null. */
  manager: { username: string; via: "identity" | "supabase" | "assigned"; isAdmin: boolean } | null;
  /** 서비스 계정 확인이 실패한 이유. 두 신분 모두 없을 때 그대로 반환한다. */
  accountError: Response | null;
};

/**
 * 두 신분을 **덮어쓰지 않고 나란히** 확인한다.
 *
 * requireManager 는 "담당자냐 아니냐"만 답하므로, 호출부가 그 답으로 호출자의
 * 아이디까지 정하면 사고가 난다. Netlify Identity 의 인증은 `nf_jwt` **쿠키**로도
 * 성립하기 때문에, 운영 콘솔에 로그인한 브라우저에서 같은 사람이 자기 브랜드
 * 계정으로 서비스 화면을 쓰면 모든 API 호출이 담당자로 판정된다. 그러면 호출자
 * 아이디가 담당자 아이디(운영자 이메일 앞부분)로 바뀌어, "내 캠페인" 조회가
 * 존재하지 않는 이름으로 나가고 목록이 통째로 빈다 — 진행확정한 협업이 인플루언서
 * 이력과 브랜드 진행사항에서 동시에 사라졌던 원인이 이것이다.
 *
 * 그래서 여기서는 판정을 합치지 않는다. 서비스 계정은 서비스 계정으로, 담당자
 * 자격은 담당자 자격으로 각각 돌려주고, 어느 쪽 아이디로 자원을 찾을지는 호출부가
 * 고른다.
 *
 * 서비스 계정을 먼저 본다. 배정된 담당자는 서비스 계정으로 로그인하므로, 그
 * 사람의 아이디가 운영자 쿠키의 이메일 아이디로 바뀌면 배정 큐가 어긋난다.
 */
export async function resolveIdentities(req: Request): Promise<Identities> {
  const supabase = await requireSignedInUser(req);
  const account = supabase.ok
    ? { username: supabase.username, userId: supabase.userId, isAdmin: supabase.isAdmin }
    : null;

  let manager: Identities["manager"] = null;
  if (account?.isAdmin) {
    manager = { username: account.username, via: "supabase", isAdmin: true };
  } else if (account && (await isAssignedManager(account.username))) {
    manager = { username: account.username, via: "assigned", isAdmin: false };
  } else {
    const identity = await requireAdmin(req);
    if (identity.ok) {
      manager = {
        username: usernameFromEmail((identity.user as any)?.email || ""),
        via: "identity",
        isAdmin: true,
      };
    }
  }

  return { account, manager, accountError: supabase.ok ? null : supabase.response };
}
