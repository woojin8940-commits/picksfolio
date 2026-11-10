import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import { cleanCreatorName, readCreatorAccess } from "./_shared/creator-access.mts";

/**
 * 크리에이터 지원 · 승인.
 *
 *   GET  /api/creator-application                 본인: 승인 상태 + 내 지원서
 *   POST /api/creator-application { action: 'apply', name, contact, instagramUrl, privacyConsent: true, directDealAgreement: true }
 *   GET  /api/creator-application?scope=admin     운영자: 지원서 목록(기존 계정 제외)
 *   POST /api/creator-application { action: 'review', username, decision, reason }  운영자
 *
 * 승인되면 자동 디엠과 어필리에이트(인플루언서 쪽)가 열린다. 기존 계정은 legacy 로
 * 이미 승인돼 있어 지원할 필요가 없다.
 */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (message: string, status = 400) => Response.json({ error: message }, { status });
const isUrl = (v: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v);

function shape(r: any) {
  if (!r) return null;
  return {
    username: r.username,
    source: r.source,
    name: r.name,
    contact: r.contact,
    instagramUrl: r.instagram_url,
    privacyConsentedAt: r.privacy_consented_at || null,
    directDealAgreedAt: r.direct_deal_agreed_at || null,
    status: r.status,
    rejectReason: r.reject_reason,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function adminList(db: any) {
  const rows = (await db.sql`
    SELECT * FROM creator_applications
    WHERE source = 'application'
    ORDER BY (status = 'pending') DESC, created_at DESC
    LIMIT 1000
  `) as any[];
  return Response.json({ applications: rows.map(shape) });
}

async function adminReview(db: any, operator: string, body: any) {
  const username = cleanCreatorName(clip(body.username, 80));
  const decision = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "";
  if (!username || !decision) return err("승인 또는 반려를 선택해 주세요.");
  const reason = decision === "rejected" ? clip(body.reason, 500) : "";
  const rows = (await db.sql`
    UPDATE creator_applications
    SET status = ${decision}, reject_reason = ${reason}, reviewed_by = ${operator}, reviewed_at = NOW(), updated_at = NOW()
    WHERE username = ${username} AND source = 'application'
    RETURNING *
  `) as any[];
  if (!rows[0]) return err("지원서를 찾을 수 없습니다.", 404);
  return Response.json({ application: shape(rows[0]) });
}

async function apply(db: any, username: string, body: any) {
  const name = clip(body.name, 50);
  const contact = clip(body.contact, 30);
  const instagramUrl = clip(body.instagramUrl, 300);
  if (!name) return err("이름을 입력해 주세요.");
  if (!/^[0-9\-+\s]{8,20}$/.test(contact)) return err("연락처를 정확히 입력해 주세요.");
  if (!instagramUrl || !isUrl(instagramUrl)) return err("인스타그램 프로필 링크를 https:// 로 시작하는 주소로 입력해 주세요.");
  if (body.privacyConsent !== true) return err("개인정보 수집·이용에 동의해 주세요.");
  if (body.directDealAgreement !== true) {
    return err("직거래 금지 안내에 동의해 주세요. 픽스폴리오를 거치지 않은 직거래가 확인되면 바로 서비스 이용이 제한됩니다.");
  }

  const rows = (await db.sql`
    INSERT INTO creator_applications (username, source, name, contact, instagram_url, privacy_consented_at, direct_deal_agreed_at, status)
    VALUES (${username}, 'application', ${name}, ${contact}, ${instagramUrl}, NOW(), NOW(), 'pending')
    ON CONFLICT (username) DO UPDATE SET
      name = EXCLUDED.name, contact = EXCLUDED.contact, instagram_url = EXCLUDED.instagram_url,
      privacy_consented_at = NOW(), direct_deal_agreed_at = NOW(),
      status = 'pending', reject_reason = '', reviewed_by = '', reviewed_at = NULL, updated_at = NOW()
    WHERE creator_applications.status IN ('rejected', 'pending') AND creator_applications.source = 'application'
    RETURNING *
  `) as any[];
  if (!rows[0]) return err("이미 승인된 크리에이터입니다.");
  return Response.json({ application: shape(rows[0]) }, { status: 201 });
}

export default async (req: Request) => {
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  else if (req.method !== "GET") return err("Method not allowed", 405);
  const scope = req.method === "GET" ? url.searchParams.get("scope") : null;
  const action = String(body?.action || "");

  try {
    if (scope === "admin" || action === "review") {
      const op = await requireOperator(req);
      if (!op.ok) return op.response;
      const db = getDatabase();
      return scope === "admin" ? await adminList(db) : await adminReview(db, op.username, body);
    }

    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;
    const username = cleanCreatorName(caller.username);
    if (!username) return err("로그인이 필요합니다.", 401);
    const db = getDatabase();

    if (req.method === "GET") {
      const access = await readCreatorAccess(username);
      if (!access) return err("승인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      let rows: any[] = [];
      try {
        rows = (await db.sql`SELECT * FROM creator_applications WHERE username = ${username} LIMIT 1`) as any[];
      } catch { /* 마이그레이션 전: 지원서 없음 */ }
      return Response.json({
        access: { ...access, approved: access.approved || caller.isAdmin },
        application: rows[0]?.source === "application" ? shape(rows[0]) : null,
      });
    }
    if (action === "apply") return await apply(db, username, body);
    return err("알 수 없는 요청입니다.");
  } catch (e) {
    console.error("[creator-application]", action || scope, e);
    return err("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
};

export const config: Config = {
  path: "/api/creator-application",
};
