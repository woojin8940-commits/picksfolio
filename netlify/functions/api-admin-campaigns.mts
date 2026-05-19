import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import type { Config, Context } from "@netlify/functions";

const ADMIN_EMAILS = ["woojin8940@inplace-ad.com"];

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

      if (!["approve", "reject"].includes(action)) {
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

      if (action === "approve") {
        await db.sql`
          UPDATE campaigns
          SET status = 'active', admin_approved_at = NOW(), admin_rejected_reason = '', updated_at = NOW()
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
