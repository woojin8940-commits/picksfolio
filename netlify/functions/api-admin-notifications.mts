import type { Config } from "@netlify/functions";
import { requireAdmin } from "./_shared/admin-auth.mts";
import { getSupabaseServer } from "./_shared/supabase.mts";

export default async (req: Request) => {
  if (req.method !== "GET" && req.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const supabase = getSupabaseServer();

  try {
    if (req.method === "GET") {
      const [{ data, error }, { count, error: countError }] = await Promise.all([
        supabase
          .from("admin_notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("admin_notifications")
          .select("id", { count: "exact", head: true })
          .eq("read", false),
      ]);
      if (error) throw error;
      if (countError) throw countError;
      return Response.json({ notifications: data || [], unreadCount: count || 0 });
    }

    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; markAllRead?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map(String).filter(Boolean).slice(0, 100)
      : [];
    if (ids.length === 0 && body.markAllRead !== true) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const query = supabase.from("admin_notifications").update({ read: true });
    const { error } = ids.length > 0
      ? await query.in("id", ids)
      : await query.eq("read", false);
    if (error) throw error;
    return Response.json({ success: true });
  } catch (error: any) {
    console.error("[admin-notifications]", error?.message || error);
    return Response.json({ error: "알림을 처리하지 못했습니다." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/admin/notifications",
  method: ["GET", "PATCH"],
};
