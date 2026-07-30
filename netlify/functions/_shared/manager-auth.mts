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
 * 담당자 개인을 구분하는 값(managerUsername)은 큐 배정과 표시에 쓰고, 권한
 * 판정에는 쓰지 않는다. 담당자가 휴가·퇴사로 자리를 비웠을 때 다른 담당자가 손을
 * 댈 수 없으면 협업이 그대로 멈추기 때문이다 — 누가 처리했는지는 이벤트 원장에
 * 남으므로 사후 확인이 가능하다.
 */

import { requireAdmin } from "./admin-auth.mts";
import { requireSignedInUser } from "./user-auth.mts";

export type ManagerAuth =
  | { ok: true; managerUsername: string; via: "identity" | "supabase" }
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
 * 담당자 권한이 필요한 요청에 쓴다. 두 인증 경로를 차례로 시도한다.
 * 실패 응답은 마지막으로 시도한 경로의 것이 아니라 담당자 전용 메시지로 통일한다 —
 * 호출자는 "관리자 로그인이 필요하다"는 사실만 알면 되고, 어떤 인증 체계를 쓰는지는
 * 알 필요가 없다.
 */
export async function requireManager(req: Request): Promise<ManagerAuth> {
  const identity = await requireAdmin(req);
  if (identity.ok) {
    const email = (identity.user as any)?.email || "";
    return { ok: true, managerUsername: usernameFromEmail(email), via: "identity" };
  }

  const supabase = await requireSignedInUser(req);
  if (supabase.ok && supabase.isAdmin) {
    return { ok: true, managerUsername: supabase.username, via: "supabase" };
  }

  return { ok: false, response: forbidden() };
}

/**
 * 담당자인지 여부만 알고 싶을 때(권한 판정이 아니라 화면 범위 결정에 쓸 때).
 * 담당자가 아니어도 오류가 아니므로 Response 를 만들지 않는다.
 */
export async function resolveManager(req: Request): Promise<string | null> {
  const result = await requireManager(req);
  return result.ok ? result.managerUsername || "manager" : null;
}
