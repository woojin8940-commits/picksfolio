import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

const STORE = "timeline";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 이 계정의 활동 기록이다. 읽기·쓰기 모두 본인(또는 관리자)만.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore(STORE);
  const key = `timeline_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return Response.json(data || { events: [] });
  }

  if (req.method === "POST") {
    const body = await req.json();
    await mutateBlobJSON<{ events: any[] }>(STORE, key, (current) => ({
      ...(current ?? {}),
      events: [
        { ...body, createdAt: new Date().toISOString() },
        ...(Array.isArray(current?.events) ? current!.events : []),
      ],
    }));
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/:username",
};
