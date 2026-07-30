import { getDatabase } from "@picks/netlify-database";
import { getUser } from "@netlify/identity";
import type { Config, Context } from "@netlify/functions";

const ADMIN_EMAILS = ["woojin8940@inplace-ad.com", "picksfolio@picks.me"];

function decodeJwtClaims(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    return payload;
  } catch {
    return null;
  }
}

async function authenticate(req: Request) {
  let user = await getUser();
  if (!user) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const claims = decodeJwtClaims(token);
      if (claims?.email) {
        user = {
          id: claims.sub || "",
          email: claims.email,
          app_metadata: claims.app_metadata || {},
        } as any;
      }
    }
  }
  if (!user) return null;
  const roles: string[] = (user as any).app_metadata?.roles || [];
  const email = ((user as any).email || "").trim().toLowerCase();
  if (!roles.includes("admin") && !ADMIN_EMAILS.includes(email)) return null;
  return user;
}

export default async (req: Request, context: Context) => {
  const admin = await authenticate(req);
  if (!admin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const status = url.searchParams.get("status");

      let result;
      if (status) {
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          WHERE c.status = ${status}
          ORDER BY c.created_at DESC
        `;
      } else {
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          ORDER BY c.created_at DESC
        `;
      }

      const pending = await db.sql`SELECT COUNT(*)::int as count FROM campaigns WHERE status = 'pending_approval'`;

      return Response.json({
        campaigns: result,
        pendingCount: pending[0]?.count || 0,
      });
    } catch (err: any) {
      return Response.json(
        { error: err?.message || "서버 오류" },
        { status: 500 }
      );
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = await req.json();
      const { id, action, reason } = body;

      if (!id || !action) {
        return Response.json(
          { error: "캠페인 ID와 액션이 필요합니다." },
          { status: 400 }
        );
      }

      if (!["approve", "reject", "assign_manager"].includes(action)) {
        return Response.json(
          { error: "잘못된 액션입니다." },
          { status: 400 }
        );
      }

      const existing = await db.sql`SELECT * FROM campaigns WHERE id = ${id}`;
      if (existing.length === 0) {
        return Response.json(
          { error: "캠페인을 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      // 담당자 식별자는 이메일 앞부분을 쓴다(운영 콘솔은 Netlify Identity 로그인).
      const actingManager = String((admin as any).email || "")
        .split("@")[0]
        .trim()
        .toLowerCase();

      if (action === "assign_manager") {
        const target = String(body.managerUsername || actingManager)
          .trim()
          .toLowerCase()
          .replace(/^biz\//, "");
        await db.sql`
          UPDATE campaigns
          SET manager_username = ${target}, manager_assigned_at = NOW(), updated_at = NOW()
          WHERE id = ${id}
        `;
        // 이미 진행 중인 협업의 담당자도 함께 옮긴다 — 캠페인 담당자와 협업 담당자가
        // 갈리면 지원자는 누구에게 물어야 할지 알 수 없다.
        await db.sql`
          UPDATE campaign_collabs
          SET manager_username = ${target}, updated_at = NOW()
          WHERE campaign_id = ${id}
        `;
        return Response.json({ success: true, managerUsername: target });
      }

      if (action === "approve") {
        // 승인하는 순간 담당자가 정해진다. 담당자 없는 캠페인은 지원이 들어와도
        // 아무도 선정하지 못하는 상태가 되므로 승인과 배정을 한 동작으로 묶는다.
        const target = String(body.managerUsername || actingManager)
          .trim()
          .toLowerCase()
          .replace(/^biz\//, "");
        await db.sql`
          UPDATE campaigns
          SET status = 'active',
              admin_approved_at = NOW(),
              admin_rejected_reason = '',
              manager_username = CASE WHEN COALESCE(manager_username, '') = '' THEN ${target} ELSE manager_username END,
              manager_assigned_at = COALESCE(manager_assigned_at, NOW()),
              updated_at = NOW()
          WHERE id = ${id}
        `;
      } else {
        await db.sql`
          UPDATE campaigns
          SET status = 'admin_rejected', admin_rejected_reason = ${reason || ''}, updated_at = NOW()
          WHERE id = ${id}
        `;
      }

      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json(
        { error: err?.message || "처리 실패" },
        { status: 500 }
      );
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/admin/campaigns",
};
