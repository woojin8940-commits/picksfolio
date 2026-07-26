import { getStore } from "@netlify/blobs";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import type { Config, Context } from "@netlify/functions";

/**
 * 방송 이력(방송 시간 · 매출 등). 셀러 본인의 운영 데이터이고 라이브 사용량 정산의
 * 근거 자료이기도 하다 — 읽기·쓰기 모두 본인만. 무인증이면 남의 방송 시간을 조회하는
 * 것은 물론, 가짜 이력을 밀어 넣어 사용량/정산을 왜곡할 수 있다.
 */

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore("broadcast-history");
  const key = `history_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return Response.json({ records: data || [] });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any[] || [];
    const record = {
      id: `broadcast_${Date.now()}`,
      ...body,
      createdAt: new Date().toISOString(),
    };
    existing.unshift(record);
    await store.setJSON(key, existing);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/broadcast-history/:username",
};
