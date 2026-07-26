import { getStore } from "@netlify/blobs";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  const recordId = context.params.id;
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 방송 이력 삭제는 본인만 — 무인증이면 남의 정산 근거 자료를 지울 수 있다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore("broadcast-history");
  const key = `history_${username}`;

  if (req.method === "DELETE" && recordId) {
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    const filtered = existing.filter((r: any) => r.id !== recordId);
    await store.setJSON(key, filtered);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/broadcast-history/:username/:id",
};
