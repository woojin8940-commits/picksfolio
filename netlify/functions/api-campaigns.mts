import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { isRecruitClosed, todayInSeoul } from "./_shared/campaign-recruit.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 조회 결과에 모집 마감 여부(recruit_closed)를 붙인다.
 * 브랜드가 직접 마감하지 않았더라도 종료일이 지난 캠페인은 지원을 받을 수 없으므로,
 * 화면에서 "마감"으로 표시할 수 있도록 계산해 준다.
 * (모집 인원이 다 차는 것은 마감 사유가 아니다 — 정원을 넘겨도 계속 지원받는다.)
 */
const withRecruitState = (rows: any[]) => {
  const today = todayInSeoul();
  return rows.map((c) => ({ ...c, recruit_closed: isRecruitClosed(c, today) }));
};

/**
 * 브리프에 들어오는 금액. "150,000원"처럼 사람이 적은 형태로 와도 숫자로 만든다 —
 * 숫자 컬럼에 문자열이 들어가면 저장 자체가 실패해서 캠페인 등록이 통째로 막힌다.
 */
const briefFee = (raw: unknown) => {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const id = url.searchParams.get("id");

      if (id) {
        const result = await db.sql`
          SELECT c.*, COALESCE(ac.cnt, 0)::int as application_count
          FROM campaigns c
          LEFT JOIN (SELECT campaign_id, COUNT(*) as cnt FROM campaign_applications GROUP BY campaign_id) ac ON ac.campaign_id = c.id
          WHERE c.id = ${id}
        `;
        if (result.length === 0) {
          return Response.json({ error: "Campaign not found" }, { status: 404 });
        }
        return Response.json({ campaign: withRecruitState(result)[0] });
      }

      const type = url.searchParams.get("type") || "";
      const category = url.searchParams.get("category") || "";
      const business = url.searchParams.get("business") || "";
      const search = url.searchParams.get("search") || "";
      // 브랜드 관리 화면은 승인 대기·마감 등 모든 상태를 봐야 하므로, business 조회에는
      // status 조건을 걸지 않는다(명시로 넘긴 경우는 제외). 공개 목록은 기본 'active'.
      const statusParam = url.searchParams.get("status") || "";
      const status = business ? statusParam : statusParam || "active";
      const pattern = search ? `%${search}%` : "";

      // 조건별로 쿼리를 복사하지 않고, 넘어오지 않은 조건은 빈 문자열로 비활성화한다.
      // (조건 조합이 늘어날 때마다 분기를 추가하다 보면 category+type 처럼 빠지는
      //  조합이 생긴다.)
      const result = await db.sql`
        SELECT c.*, COALESCE(ac.cnt, 0)::int as application_count
        FROM campaigns c
        LEFT JOIN (SELECT campaign_id, COUNT(*) as cnt FROM campaign_applications GROUP BY campaign_id) ac ON ac.campaign_id = c.id
        WHERE (${business} = '' OR c.business_username = ${business})
          AND (${status} = '' OR c.status = ${status})
          AND (${type} = '' OR c.type = ${type})
          AND (${category} = '' OR c.category = ${category})
          AND (${pattern} = '' OR c.title ILIKE ${pattern} OR c.brand_name ILIKE ${pattern} OR c.description ILIKE ${pattern})
        ORDER BY c.created_at DESC
      `;

      const campaigns = withRecruitState(result as any[]);

      // 공개 목록(브랜드 자신의 관리 화면이 아닌 경우)에서는 모집이 끝난 캠페인을
      // 제외한다. 브랜드가 "마감"을 누르지 않았더라도 종료일이 지난 캠페인은
      // 지원할 수 없어, 노출해 봐야 막다른 길이기 때문이다.
      // 브랜드 관리 화면(business 파라미터)에서는 마감된 캠페인도 그대로 보여
      // 준다 — 수정·재개·삭제해야 하므로.
      if (!business) {
        return Response.json({ campaigns: campaigns.filter((c) => !c.recruit_closed) });
      }

      return Response.json({ campaigns });
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

      // 남의 브랜드 이름으로 캠페인을 올릴 수 없도록 계정 주인인지 확인한다.
      const auth = await requireAccountOwner(req, String(body.business_username));
      if (!auth.ok) return auth.response;

      const id = `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await db.sql`
        INSERT INTO campaigns (
          id, business_username, type, title, description, brand_name, thumbnail_url, category,
          reward_type, reward_amount, requirements, max_applicants, start_date, end_date, status,
          product_name, product_url, upload_channel, content_format, video_concept,
          guideline_url, guideline_note, second_use_fee, second_use_note, upload_from, upload_to
        )
        VALUES (
          ${id}, ${body.business_username}, ${body.type}, ${body.title}, ${body.description || ""},
          ${body.brand_name || ""}, ${body.thumbnail_url || ""}, ${body.category || ""},
          ${body.reward_type || ""}, ${body.reward_amount || ""}, ${body.requirements || ""},
          ${body.max_applicants || 0}, ${body.start_date || null}, ${body.end_date || null}, 'pending_approval',
          ${body.product_name || ""}, ${body.product_url || ""}, ${body.upload_channel || ""},
          ${body.content_format || ""}, ${body.video_concept || ""},
          ${body.guideline_url || ""}, ${body.guideline_note || ""},
          ${briefFee(body.second_use_fee)}, ${body.second_use_note || ""},
          ${body.upload_from || ""}, ${body.upload_to || ""}
        )
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

      // 캠페인 ID 만 알면 남의 캠페인을 고칠 수 있었다. 등록한 브랜드(또는 관리자)만
      // 수정할 수 있도록 확인한다.
      const auth = await requireAccountOwner(req, String(c.business_username || ""));
      if (!auth.ok) return auth.response;

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
            product_name = ${updates.product_name ?? c.product_name ?? ""},
            product_url = ${updates.product_url ?? c.product_url ?? ""},
            upload_channel = ${updates.upload_channel ?? c.upload_channel ?? ""},
            content_format = ${updates.content_format ?? c.content_format ?? ""},
            video_concept = ${updates.video_concept ?? c.video_concept ?? ""},
            guideline_url = ${updates.guideline_url ?? c.guideline_url ?? ""},
            guideline_note = ${updates.guideline_note ?? c.guideline_note ?? ""},
            second_use_fee = ${updates.second_use_fee === undefined ? Number(c.second_use_fee || 0) : briefFee(updates.second_use_fee)},
            second_use_note = ${updates.second_use_note ?? c.second_use_note ?? ""},
            upload_from = ${updates.upload_from ?? c.upload_from ?? ""},
            upload_to = ${updates.upload_to ?? c.upload_to ?? ""},
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

      const existing = await db.sql`SELECT id, business_username FROM campaigns WHERE id = ${id}`;
      if (existing.length === 0) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      // 예전에는 business 쿼리 파라미터를 넘겼을 때만 소유자를 확인해서, 파라미터를
      // 빼면 누구나 남의 캠페인을 지울 수 있었다. 이제 토큰으로 확인한다.
      const auth = await requireAccountOwner(req, String((existing[0] as any).business_username || ""));
      if (!auth.ok) return auth.response;

      await db.sql`DELETE FROM campaign_collabs WHERE campaign_id = ${id}`;
      await db.sql`DELETE FROM campaign_applications WHERE campaign_id = ${id}`;
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
