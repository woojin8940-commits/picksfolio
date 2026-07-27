import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import {
  COLLABS_STORE,
  RecordWriteConflictError,
  collabsKey,
  mutateRecords,
  parseAmount,
  readRecords,
} from "./_shared/collab-records.mts";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 협업 내역에는 업체명·금액이 들어 있다. 본인(또는 관리자)만 읽고 쓴다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const key = collabsKey(username);

  try {
    if (req.method === "GET") {
      const records = await readRecords(COLLABS_STORE, key);
      // 예전 레코드는 createdAt/updatedAt 로 저장돼 있다. 응답에서 맞춰준다.
      const normalized = records.map((r: any) => ({
        ...r,
        created_at: r.created_at || r.createdAt || "",
        updated_at: r.updated_at || r.updatedAt || undefined,
      }));
      return Response.json({ records: normalized });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const now = new Date().toISOString();
      const record = {
        id: `collab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ...body,
        fee: parseAmount(body.fee),
        // 프런트엔드 타입(CollabRecord)은 created_at / updated_at 를 읽는다.
        // 예전에는 createdAt 만 저장해서 화면에서 항상 undefined 였다.
        created_at: now,
        updated_at: now,
      };
      await mutateRecords(COLLABS_STORE, key, (records) => [...records, record]);
      return Response.json({ success: true, record });
    }
  } catch (err) {
    if (err instanceof RecordWriteConflictError) {
      return Response.json({ error: "협업 내역이 방금 변경되었습니다. 다시 시도해 주세요." }, { status: 409 });
    }
    console.error("[api-collabs] Unexpected error:", err);
    return Response.json({ error: "서버 오류" }, { status: 500 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/collabs/:username",
};
