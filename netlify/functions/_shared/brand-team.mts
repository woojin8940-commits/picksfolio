/**
 * 브랜드 회사 계정의 직원(팀원)과 좌석 초대.
 *
 * 회사 관리자 계정(profiles.username = 회사 아이디, role = 'operator')이 정액제를 쓰면서
 * 직원 좌석을 산다(brand-seats). 빈 좌석마다 1회용 초대 링크(7일 유효, 취소 가능)를 만들어
 * 직원에게 보내면, 직원은 링크로 자기 아이디 · 비밀번호를 만들어 가입하고 그 좌석에 들어간다.
 *
 * 직원 계정도 Supabase 사용자다(biz_<직원 아이디>@picks.me, role = 'operator'). 로그인하면
 * user-auth 가 이 표를 보고 "회사 아이디"로 바꿔 읽는다 — 직원은 회사 워크스페이스(캠페인 ·
 * 이력 · 자동 디엠 등)를 함께 쓰고, 결제 · 좌석 · 팀원 관리는 회사 관리자 계정만 한다.
 * 역할은 회사 관리자 / 직원 두 가지뿐이다.
 *
 * 직원이 쓸 수 있는 좌석은 결제된 직원 좌석 수까지다. 정액제가 끝났거나 좌석보다 직원이
 * 많으면(먼저 들어온 순서로 좌석을 채운다) 남는 직원은 회사 워크스페이스에 들어오지 못한다.
 */
import { createHash, randomBytes } from "node:crypto";
import { paidExtraSeats, readSeatRecord } from "./brand-seats.mts";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const db = async () => (await import("@picks/netlify-database")).getDatabase();

export const normalizeCompany = (raw: unknown): string =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

export const hashInviteToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const newInviteToken = (): string => randomBytes(32).toString("base64url");


export interface TeamMemberRow {
  id: number;
  memberUsername: string;
  displayName: string;
  joinedAt: string;
  /** 좌석 안에 들어 있는지(좌석보다 직원이 많으면 나중에 들어온 직원부터 false). */
  seated: boolean;
}

export interface SeatInviteRow {
  id: number;
  label: string;
  createdAt: string;
  expiresAt: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v || ""));

export const listTeam = async (company: string, extraSeats: number) => {
  const sql = (await db()).sql;
  const members = (await sql`
    SELECT id, member_username, display_name, joined_at
    FROM brand_team_members
    WHERE company_username = ${company} AND removed_at IS NULL
    ORDER BY joined_at ASC, id ASC
  `) as any[];
  const invites = (await sql`
    SELECT id, label, created_at, expires_at
    FROM brand_seat_invites
    WHERE company_username = ${company} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    ORDER BY created_at ASC, id ASC
  `) as any[];
  return {
    members: members.map((r, i): TeamMemberRow => ({
      id: Number(r.id),
      memberUsername: String(r.member_username || ""),
      displayName: String(r.display_name || ""),
      joinedAt: iso(r.joined_at),
      seated: i < extraSeats,
    })),
    invites: invites.map((r): SeatInviteRow => ({
      id: Number(r.id),
      label: String(r.label || ""),
      createdAt: iso(r.created_at),
      expiresAt: iso(r.expires_at),
    })),
  };
};

/** 지금 좌석을 쓰는 수(직원 + 대기 중인 초대). 관리자 좌석은 세지 않는다. */
export const usedSeats = async (company: string): Promise<number> => {
  const sql = (await db()).sql;
  const rows = (await sql`
    SELECT
      (SELECT COUNT(*) FROM brand_team_members WHERE company_username = ${company} AND removed_at IS NULL)::int AS members,
      (SELECT COUNT(*) FROM brand_seat_invites WHERE company_username = ${company}
         AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW())::int AS invites
  `) as any[];
  return Number(rows[0]?.members || 0) + Number(rows[0]?.invites || 0);
};

/**
 * 빈 좌석에 초대를 만든다. 좌석 수 확인과 생성을 한 문장으로 해서, 동시에 눌러도 좌석보다
 * 많이 만들어지지 않게 한다. 토큰은 만든 사람에게 한 번만 돌려주고 저장하지 않는다.
 */
export const createInvite = async (
  company: string,
  extraSeats: number,
  input: { label?: string; createdBy: string },
): Promise<{ token: string; invite: SeatInviteRow } | null> => {
  const sql = (await db()).sql;
  const token = newInviteToken();
  const label = String(input.label || "").trim().slice(0, 40);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const rows = (await sql`
    INSERT INTO brand_seat_invites (company_username, token_hash, label, created_by, expires_at)
    SELECT ${company}, ${hashInviteToken(token)}, ${label}, ${input.createdBy}, ${expiresAt}
    WHERE (
      (SELECT COUNT(*) FROM brand_team_members WHERE company_username = ${company} AND removed_at IS NULL) +
      (SELECT COUNT(*) FROM brand_seat_invites WHERE company_username = ${company}
         AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW())
    ) < ${extraSeats}
    RETURNING id, label, created_at, expires_at
  `) as any[];
  const r = rows[0];
  if (!r) return null;
  return {
    token,
    invite: { id: Number(r.id), label: String(r.label || ""), createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) },
  };
};

export const revokeInvite = async (company: string, inviteId: number): Promise<boolean> => {
  const sql = (await db()).sql;
  const rows = (await sql`
    UPDATE brand_seat_invites SET revoked_at = NOW()
    WHERE id = ${inviteId} AND company_username = ${company} AND used_at IS NULL AND revoked_at IS NULL
    RETURNING id
  `) as any[];
  return rows.length > 0;
};

export const removeMember = async (company: string, memberId: number, by: string): Promise<boolean> => {
  const sql = (await db()).sql;
  const rows = (await sql`
    UPDATE brand_team_members SET removed_at = NOW(), removed_by = ${by}
    WHERE id = ${memberId} AND company_username = ${company} AND removed_at IS NULL
    RETURNING id
  `) as any[];
  return rows.length > 0;
};

/** 초대 링크로 들어온 사람에게 보여 줄 정보. 쓸 수 없는 링크면 null. */
export const findOpenInvite = async (token: string) => {
  if (!token || token.length < 20 || token.length > 100) return null;
  const sql = (await db()).sql;
  const rows = (await sql`
    SELECT id, company_username, label, expires_at
    FROM brand_seat_invites
    WHERE token_hash = ${hashInviteToken(token)} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `) as any[];
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    company: String(r.company_username || ""),
    label: String(r.label || ""),
    expiresAt: iso(r.expires_at),
  };
};

/** 초대를 한 번만 쓰게 잡는다. 이미 쓰였거나 취소 · 만료됐으면 null. */
export const claimInvite = async (token: string, userId: string) => {
  const sql = (await db()).sql;
  const rows = (await sql`
    UPDATE brand_seat_invites SET used_at = NOW(), used_by_user_id = ${userId}
    WHERE token_hash = ${hashInviteToken(token)} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    RETURNING id, company_username
  `) as any[];
  const r = rows[0];
  return r ? { id: Number(r.id), company: String(r.company_username || "") } : null;
};

export const releaseInvite = async (inviteId: number) => {
  const sql = (await db()).sql;
  await sql`UPDATE brand_seat_invites SET used_at = NULL, used_by_user_id = NULL WHERE id = ${inviteId}`;
};

export const insertMember = async (input: {
  company: string; userId: string; username: string; displayName: string; inviteId: number;
}) => {
  const sql = (await db()).sql;
  await sql`
    INSERT INTO brand_team_members (company_username, member_user_id, member_username, display_name, invite_id)
    VALUES (${input.company}, ${input.userId}, ${input.username}, ${input.displayName.slice(0, 40)}, ${input.inviteId})
  `;
};

export type TeamMembership =
  | { kind: "none" }
  | { kind: "member"; company: string; memberUsername: string; seated: boolean };

/**
 * 이 Supabase 사용자가 어느 회사의 직원인지. 좌석 안에 들어 있는지(정액제 활성 · 좌석 순서)까지
 * 함께 판단한다. 표가 아직 없는 환경(마이그레이션 전)은 직원이 없는 것으로 본다. 그 밖의 조회
 * 실패는 던진다 — 호출부가 막는다.
 */
export const resolveTeamMembership = async (userId: string): Promise<TeamMembership> => {
  let rows: any[];
  try {
    const sql = (await db()).sql;
    rows = (await sql`
      SELECT m.company_username, m.member_username,
        (SELECT COUNT(*) FROM brand_team_members o
          WHERE o.company_username = m.company_username AND o.removed_at IS NULL
            AND (o.joined_at < m.joined_at OR (o.joined_at = m.joined_at AND o.id < m.id)))::int AS ahead
      FROM brand_team_members m
      WHERE m.member_user_id = ${userId} AND m.removed_at IS NULL
      LIMIT 1
    `) as any[];
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") return { kind: "none" };
    throw e;
  }
  const r = rows[0];
  if (!r) return { kind: "none" };
  const company = normalizeCompany(r.company_username);
  const record = await readSeatRecord(company);
  return {
    kind: "member",
    company,
    memberUsername: String(r.member_username || ""),
    seated: Number(r.ahead || 0) < paidExtraSeats(record),
  };
};
