/**
 * 크리에이터 승인 — 자동 디엠과 어필리에이트(인플루언서 쪽)를 여는 조건.
 *
 *   · 기존 인플루언서(source = 'legacy'): 마이그레이션 시점에 이미 있던 계정. 지금처럼 쓴다.
 *   · 새로 들어온 인플루언서: 크리에이터 지원서를 내고 운영자가 승인하면 열린다.
 *
 * 한 사람당 creator_applications 한 행. 행이 없으면 아직 지원하지 않은 새 계정이다.
 */

import { getDatabase } from "@picks/netlify-database";

export type CreatorStatus = "approved" | "pending" | "rejected" | "none";

export type CreatorAccess = {
  status: CreatorStatus;
  /** 기존 계정이라 지원 없이 쓰는 사람. */
  legacy: boolean;
  /** 자동 디엠 · 어필리에이트를 쓸 수 있는지. */
  approved: boolean;
  rejectReason: string;
};

export const CREATOR_APPROVAL_REQUIRED_MESSAGE =
  "크리에이터 승인 후 이용할 수 있어요. 크리에이터 지원서를 내면 담당자가 확인 후 승인해 드립니다.";

export const cleanCreatorName = (username: string | null | undefined) =>
  String(username || "").trim().toLowerCase().replace(/^biz\//, "").replace(/^@+/, "");

const missingTable = (e: unknown) => /creator_applications/.test(String((e as Error)?.message || "")) &&
  /does not exist/i.test(String((e as Error)?.message || ""));

/** 크리에이터 승인 상태. 조회 실패는 null(호출부가 막을지 정한다). */
export async function readCreatorAccess(username: string | null | undefined): Promise<CreatorAccess | null> {
  const name = cleanCreatorName(username);
  if (!name) return { status: "none", legacy: false, approved: false, rejectReason: "" };
  try {
    const db = getDatabase();
    const rows = (await db.sql`
      SELECT source, status, reject_reason FROM creator_applications WHERE username = ${name} LIMIT 1
    `) as any[];
    const row = rows[0];
    if (!row) return { status: "none", legacy: false, approved: false, rejectReason: "" };
    const status = (["approved", "pending", "rejected"].includes(row.status) ? row.status : "pending") as CreatorStatus;
    return {
      status,
      legacy: row.source === "legacy",
      approved: status === "approved",
      rejectReason: status === "rejected" ? String(row.reject_reason || "") : "",
    };
  } catch (e) {
    // 마이그레이션 전 환경: 승인 제도가 아직 없으므로 지금처럼 연다.
    if (missingTable(e)) return { status: "approved", legacy: true, approved: true, rejectReason: "" };
    console.warn("[creator-access] lookup failed:", (e as Error)?.message);
    return null;
  }
}
