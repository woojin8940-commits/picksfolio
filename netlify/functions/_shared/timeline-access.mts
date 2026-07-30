import { requireAdmin } from "./admin-auth.mts";
import { requireSignedInUser } from "./user-auth.mts";

/**
 * 대화방 접근 판정 — 인플루언서 / 브랜드 / 픽스폴리오 담당자.
 *
 * 캠페인 협업이 담당자 중개 구조로 바뀌면서 대화방의 종류가 셋이 됐다.
 *
 *   * brand_influencer   : 기존 방. 브랜드와 인플루언서가 직접 대화한다(신규 생성 없음).
 *   * influencer_support : 인플루언서 ↔ 담당자
 *   * brand_support      : 브랜드 ↔ 담당자
 *
 * 담당자 채널에서는 상대편 당사자가 방에 들어올 수 없어야 한다. 브랜드가
 * 인플루언서에게 한 말을 담당자가 다듬어 전달하는 구조인데, 원문 방을 서로 열 수
 * 있으면 중개가 형식만 남는다. 그래서 채널마다 참여자 목록을 다르게 넘긴다.
 *
 * 인증 경로가 두 개(운영 콘솔=Netlify Identity, 서비스 화면=Supabase)이므로 양쪽을
 * 한 번씩만 확인해 합친다. 각 호출부에서 두 경로를 따로 확인하면 Supabase 검증이
 * 요청당 두 번 일어난다.
 */

export type TimelineParticipants = {
  influencer?: string | null;
  business?: string | null;
  manager?: string | null;
};

export type TimelineAuthorType = "influencer" | "business" | "manager";

export type TimelineAccess =
  | { ok: true; username: string; authorType: TimelineAuthorType; isManager: boolean }
  | { ok: false; response: Response };

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const forbidden = () =>
  Response.json(
    { error: "이 대화방에 접근할 수 없습니다.", code: "AUTH_FORBIDDEN" },
    { status: 403 },
  );

export async function resolveTimelineAccess(
  req: Request,
  participants: TimelineParticipants,
): Promise<TimelineAccess> {
  // 1) 운영 콘솔 로그인(담당자). 담당자는 어느 방이든 열 수 있다 — 담당자가 자리를
  //    비운 사이 다른 담당자가 대응하지 못하면 협업이 그대로 멈춘다.
  const identity = await requireAdmin(req);
  if (identity.ok) {
    const email = String((identity.user as any)?.email || "");
    return {
      ok: true,
      username: norm(email.split("@")[0]) || "picksfolio",
      authorType: "manager",
      isManager: true,
    };
  }

  // 2) 서비스 화면 로그인.
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller;

  if (caller.isAdmin) {
    return { ok: true, username: caller.username, authorType: "manager", isManager: true };
  }

  const me = caller.username;
  if (!me) return { ok: false, response: forbidden() };

  if (norm(participants.influencer) === me) {
    return { ok: true, username: me, authorType: "influencer", isManager: false };
  }
  if (norm(participants.business) === me) {
    return { ok: true, username: me, authorType: "business", isManager: false };
  }
  // manager_username 이 일반 계정으로 기록된 경우(관리자 권한이 없는 운영 계정)도
  // 자기 방은 열 수 있어야 한다.
  if (norm(participants.manager) === me) {
    return { ok: true, username: me, authorType: "manager", isManager: false };
  }

  return { ok: false, response: forbidden() };
}

/** 이 방의 참여자 전원(빈 값 제외, 중복 제거). 알림 대상 계산에 쓴다. */
export function participantList(participants: TimelineParticipants): string[] {
  const all = [participants.influencer, participants.business, participants.manager]
    .map(norm)
    .filter((v) => v !== "");
  return Array.from(new Set(all));
}
