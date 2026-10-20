import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";

/**
 * 브랜드 영업용 링크 — 공개 조회.
 *
 * 로그인 없이 열리는 주소라, 브랜드에게 보여 줄 값만 골라 내려 준다. 인플루언서에게
 * 주는 금액(base_price)·운영자 메모·연락처는 응답에 넣지 않는다.
 */
function parseJsonArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const token = String(context.params.token || "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) return Response.json({ error: "링크를 찾을 수 없습니다." }, { status: 404 });

  try {
    const db = getDatabase();
    const [link] = await db.sql`SELECT id, title, brand_name, intro, is_active, updated_at FROM sales_links WHERE token = ${token}`;
    if (!link || !link.is_active) return Response.json({ error: "링크를 찾을 수 없습니다." }, { status: 404 });
    const rows = await db.sql`
      SELECT id, instagram_handle, profile_url, display_name, profile_image_url, category,
        followers, following, recent_reels, price, price_note
      FROM sales_link_influencers
      WHERE link_id = ${link.id}
      ORDER BY sort_order ASC, created_at ASC
    `;
    return Response.json(
      {
        link: { title: link.title, brand_name: link.brand_name, intro: link.intro, updated_at: link.updated_at },
        influencers: rows.map((r: any) => ({
          id: r.id,
          handle: r.instagram_handle,
          profile_url: r.profile_url,
          display_name: r.display_name,
          profile_image_url: r.profile_image_url,
          category: r.category,
          followers: Number(r.followers || 0),
          following: Number(r.following || 0),
          price: Number(r.price || 0),
          price_note: r.price_note,
          recent_reels: parseJsonArray(r.recent_reels)
            .slice(0, 3)
            .map((x: any) => ({
              permalink: String(x?.permalink || ""),
              thumbnailUrl: String(x?.thumbnailUrl || ""),
              views: Number(x?.views || 0),
            })),
        })),
      },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch (err: any) {
    return Response.json({ error: "링크를 불러오지 못했습니다." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/sales-link/:token",
};
