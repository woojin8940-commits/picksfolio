import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const id = url.searchParams.get("id");

      if (id) {
        const result = await db.sql`SELECT * FROM campaigns WHERE id = ${id}`;
        if (result.length === 0) {
          return Response.json({ error: "Campaign not found" }, { status: 404 });
        }
        const appCount = await db.sql`SELECT COUNT(*)::int as count FROM campaign_applications WHERE campaign_id = ${id}`;
        return Response.json({
          campaign: { ...result[0], application_count: appCount[0].count || 0 },
        });
      }

      const type = url.searchParams.get("type");
      const category = url.searchParams.get("category");
      const status = url.searchParams.get("status") || "active";
      const business = url.searchParams.get("business");
      const search = url.searchParams.get("search");

      let result;
      if (business) {
        if (type) {
          result = await db.sql`
            SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
            FROM campaigns c
            WHERE c.business_username = ${business} AND c.type = ${type}
            ORDER BY c.created_at DESC
          `;
        } else {
          result = await db.sql`
            SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
            FROM campaigns c
            WHERE c.business_username = ${business}
            ORDER BY c.created_at DESC
          `;
        }
      } else if (search && type) {
        const pattern = `%${search}%`;
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          WHERE c.status = ${status} AND c.type = ${type} AND (c.title ILIKE ${pattern} OR c.brand_name ILIKE ${pattern} OR c.description ILIKE ${pattern})
          ORDER BY c.created_at DESC
        `;
      } else if (search && category) {
        const pattern = `%${search}%`;
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          WHERE c.status = ${status} AND c.category = ${category} AND (c.title ILIKE ${pattern} OR c.brand_name ILIKE ${pattern} OR c.description ILIKE ${pattern})
          ORDER BY c.created_at DESC
        `;
      } else if (category) {
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          WHERE c.status = ${status} AND c.category = ${category}
          ORDER BY c.created_at DESC
        `;
      } else if (type) {
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          WHERE c.status = ${status} AND c.type = ${type}
          ORDER BY c.created_at DESC
        `;
      } else if (search) {
        const pattern = `%${search}%`;
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          WHERE c.status = ${status} AND (c.title ILIKE ${pattern} OR c.brand_name ILIKE ${pattern} OR c.description ILIKE ${pattern})
          ORDER BY c.created_at DESC
        `;
      } else {
        result = await db.sql`
          SELECT c.*, (SELECT COUNT(*)::int FROM campaign_applications WHERE campaign_id = c.id) as application_count
          FROM campaigns c
          WHERE c.status = ${status}
          ORDER BY c.created_at DESC
        `;
      }

      return Response.json({ campaigns: result });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (!body.business_username || !body.type || !body.title) {
        return Response.json({ error: "필수 항목을 입력해 주세요." }, { status: 400 });
      }
      const id = `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await db.sql`
        INSERT INTO campaigns (id, business_username, type, title, description, brand_name, thumbnail_url, category, reward_type, reward_amount, requirements, max_applicants, start_date, end_date, status)
        VALUES (${id}, ${body.business_username}, ${body.type}, ${body.title}, ${body.description || ""}, ${body.brand_name || ""}, ${body.thumbnail_url || ""}, ${body.category || ""}, ${body.reward_type || ""}, ${body.reward_amount || ""}, ${body.requirements || ""}, ${body.max_applicants || 0}, ${body.start_date || null}, ${body.end_date || null}, 'pending_approval')
      `;

      return Response.json({ success: true, id });
    } catch (err: any) {
      return Response.json({ error: err?.message || "캠페인 생성 실패" }, { status: 500 });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = await req.json();
      const { id, ...updates } = body;
      if (!id) {
        return Response.json({ error: "캠페인 ID가 필요합니다." }, { status: 400 });
      }

      const existing = await db.sql`SELECT * FROM campaigns WHERE id = ${id}`;
      if (existing.length === 0) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      const c = existing[0] as Record<string, any>;

      let newStatus = updates.status ?? c.status;
      if (c.status === 'pending_approval' || c.status === 'admin_rejected') {
        newStatus = c.status;
      }

      await db.sql`
        UPDATE campaigns
        SET title = ${updates.title ?? c.title},
            type = ${updates.type ?? c.type},
            description = ${updates.description ?? c.description},
            brand_name = ${updates.brand_name ?? c.brand_name},
            thumbnail_url = ${updates.thumbnail_url ?? c.thumbnail_url},
            category = ${updates.category ?? c.category},
            reward_type = ${updates.reward_type ?? c.reward_type},
            reward_amount = ${updates.reward_amount ?? c.reward_amount},
            requirements = ${updates.requirements ?? c.requirements},
            max_applicants = ${updates.max_applicants ?? c.max_applicants},
            start_date = ${updates.start_date ?? c.start_date},
            end_date = ${updates.end_date ?? c.end_date},
            status = ${newStatus},
            updated_at = NOW()
        WHERE id = ${id}
      `;

      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "캠페인 수정 실패" }, { status: 500 });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!id) {
        return Response.json({ error: "캠페인 ID가 필요합니다." }, { status: 400 });
      }
      await db.sql`DELETE FROM campaigns WHERE id = ${id}`;
      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "캠페인 삭제 실패" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/campaigns",
};
