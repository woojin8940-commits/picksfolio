/**
 * 회사 안에서의 캠페인 담당자.
 *
 * 브랜드 회사 계정은 관리자(owner) 1명과 직원(member)들이 함께 쓴다. 캠페인마다 담당자
 * (campaigns.owner_member)가 있고 — 직원 아이디, 빈 문자열이면 관리자 —
 *
 *   · 캠페인 메뉴에는 각자 맡은 캠페인만 보인다(회사 전체 진행 예정 요약은 모두가 따로 본다).
 *   · 진행이 확정된 인플루언서의 연락처는 그 캠페인 담당자에게만 보인다.
 *   · 캠페인을 고치고 인플루언서를 고르는 일도 담당자만 한다.
 *
 * 브랜드 팀 계정이 아닌 호출자(픽스폴리오 운영자 등, teamRole 이 없다)는 예전처럼 전부 본다.
 */

export type TeamCaller = { teamRole?: "owner" | "member"; memberUsername?: string; isAdmin?: boolean };

const clean = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** 이 호출자의 담당자 값. 관리자면 '', 직원이면 직원 아이디. */
export const seatOf = (caller: TeamCaller): string =>
  caller.teamRole === "member" ? clean(caller.memberUsername) : "";

/** 이 호출자가 이 캠페인의 담당자인지. */
export const ownsCampaign = (caller: TeamCaller, ownerMember: unknown): boolean => {
  if (caller.isAdmin) return true;
  if (!caller.teamRole) return true;
  return clean(ownerMember) === seatOf(caller);
};

/** 담당자 표시 이름. 회사 대표 계정 담당이면 '대표 관리자'. */
export const ownerLabel = (ownerMember: unknown, names: Map<string, string>): string => {
  const key = clean(ownerMember);
  if (!key) return "대표 관리자";
  return names.get(key) || key;
};

/** 회사 직원 이름표(내보낸 직원 포함 — 지난 캠페인의 담당자 이름을 보여 줘야 한다). */
export async function memberNames(company: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { getDatabase } = await import("@picks/netlify-database");
    const rows = (await getDatabase().sql`
      SELECT member_username, display_name, department, removed_at
      FROM brand_team_members
      WHERE company_username = ${clean(company).replace(/^biz\//, "")}
      ORDER BY joined_at ASC
    `) as any[];
    for (const r of rows) {
      const key = clean(r.member_username);
      const base = String(r.display_name || "").trim() || key;
      const dept = String(r.department || "").trim();
      // 회사 안에서 알아보기 쉽게 "부서 / 이름"(예: 인플루언서 마케터 1팀 / 신우진).
      const name = dept ? `${dept} / ${base}` : base;
      map.set(key, r.removed_at ? `${name} · 퇴사` : name);
    }
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") console.error("[campaign-owner] names failed:", (e as Error)?.message);
  }
  return map;
}
