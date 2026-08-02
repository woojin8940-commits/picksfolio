import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireOperator } from "./_shared/manager-auth.mts";
import { requireSignedInUser } from "./_shared/user-auth.mts";

/**
 * 담당자 계정 관리.
 *
 * 운영자는 이 API 로 일반 계정을 담당자로 올리고 내린다. 담당자 본인은 `?me=1` 로
 * 자기 상태만 확인한다 — 로그인 직후 어떤 대시보드를 띄울지 정해야 하기 때문이다.
 *
 * 목록에 "누가 담당자인가"만 담지 않고 지금 맡고 있는 캠페인 수까지 함께 세는 이유는,
 * 해제 버튼을 누르기 전에 그 사람이 무엇을 들고 있는지 보여야 하기 때문이다. 캠페인을
 * 열 개 맡은 담당자를 아무 표시 없이 해제하면 그 열 개가 조용히 멈춘다.
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const shape = (row: any) => ({
  username: row.username,
  displayName: row.display_name || "",
  email: row.email || "",
  active: !!row.active,
  note: row.note || "",
  assignedBy: row.assigned_by || "",
  assignedAt: row.assigned_at || null,
  revokedBy: row.revoked_by || "",
  revokedAt: row.revoked_at || null,
  campaignCount: Number(row.campaign_count || 0),
  collabCount: Number(row.collab_count || 0),
});

const listManagers = async (db: any) => {
  const rows = (await db.sql`
    SELECT m.*,
           (SELECT COUNT(*)::int FROM campaigns c
             WHERE LOWER(COALESCE(c.manager_username, '')) = m.username
               AND c.status = 'active') AS campaign_count,
           (SELECT COUNT(*)::int FROM campaign_collabs cc
             WHERE LOWER(COALESCE(cc.manager_username, '')) = m.username
               AND cc.status = 'in_progress') AS collab_count
    FROM platform_managers m
    ORDER BY m.active DESC, m.assigned_at DESC
  `) as any[];
  return rows.map(shape);
};

export default async (req: Request) => {
  const url = new URL(req.url);

  // ── 본인 확인 ─────────────────────────────────────────────────────────────
  // 담당자 여부만 알려 준다. 다른 담당자가 누구인지는 운영 정보라 여기서 새지 않는다.
  if (req.method === "GET" && url.searchParams.get("me") === "1") {
    const caller = await requireSignedInUser(req);
    if (!caller.ok) return Response.json({ isManager: false, username: "" });

    if (caller.isAdmin) {
      return Response.json({
        isManager: true,
        isAdmin: true,
        username: caller.username,
        displayName: "",
      });
    }

    try {
      const db = getDatabase();
      const rows = (await db.sql`
        SELECT username, display_name FROM platform_managers
        WHERE username = ${caller.username} AND active LIMIT 1
      `) as any[];
      const row = rows[0];
      return Response.json({
        isManager: !!row,
        isAdmin: false,
        username: caller.username,
        displayName: row?.display_name || "",
      });
    } catch {
      // 표가 없거나 조회가 실패하면 담당자 화면을 열지 않는다. 여는 쪽으로
      // 실패하면 권한 없는 사람에게 담당자 대시보드가 뜬다.
      return Response.json({ isManager: false, username: caller.username });
    }
  }

  const operator = await requireOperator(req);
  if (!operator.ok) return operator.response;

  const db = getDatabase();

  try {
    if (req.method === "GET") {
      return Response.json({ managers: await listManagers(db) });
    }

    if (req.method === "POST") {
      const body = (await req.json()) as any;
      const username = norm(body.username);
      if (!username) {
        return Response.json({ error: "계정 아이디를 입력해 주세요." }, { status: 400 });
      }

      await db.sql`
        INSERT INTO platform_managers (
          username, display_name, email, note, active, assigned_by, assigned_at,
          revoked_by, revoked_at, updated_at
        ) VALUES (
          ${username}, ${String(body.displayName || "")}, ${String(body.email || "")},
          ${String(body.note || "")}, TRUE, ${operator.username}, NOW(), '', NULL, NOW()
        )
        ON CONFLICT (username) DO UPDATE SET
          display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), platform_managers.display_name),
          email = COALESCE(NULLIF(EXCLUDED.email, ''), platform_managers.email),
          note = EXCLUDED.note,
          active = TRUE,
          assigned_by = EXCLUDED.assigned_by,
          assigned_at = NOW(),
          revoked_by = '',
          revoked_at = NULL,
          updated_at = NOW()
      `;

      return Response.json({ success: true, managers: await listManagers(db) });
    }

    // 해제. 행은 남기고 active 만 내린다 — 지난 배정 이력이 사라지면 안 된다.
    if (req.method === "DELETE" || req.method === "PATCH") {
      const body = (await req.json().catch(() => ({}))) as any;
      const username = norm(body.username || url.searchParams.get("username"));
      if (!username) {
        return Response.json({ error: "계정 아이디가 필요합니다." }, { status: 400 });
      }

      const active = req.method === "PATCH" ? body.active !== false : false;
      await db.sql`
        UPDATE platform_managers
        SET active = ${active},
            revoked_by = ${active ? "" : operator.username},
            revoked_at = ${active ? null : new Date().toISOString()},
            updated_at = NOW()
        WHERE username = ${username}
      `;

      return Response.json({ success: true, managers: await listManagers(db) });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "담당자 정보를 처리하지 못했습니다." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/managers",
};
