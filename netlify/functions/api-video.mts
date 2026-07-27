import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("videos");
  const key = `video_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return Response.json(data || { videos: [] });
  }

  if (req.method === "POST") {
    // 저장은 이 계정의 영상 목록을 통째로 바꾼다. 예전에는 인증이 없어 남의
    // 아이디만 알면 영상 목록을 비워버릴 수 있었다.
    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    await store.setJSON(key, body);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/video/:username",
};
