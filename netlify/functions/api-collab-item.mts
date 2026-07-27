import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import {
  COLLABS_STORE,
  RecordWriteConflictError,
  collabsKey,
  mutateRecords,
  parseAmount,
} from "./_shared/collab-records.mts";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  const recordId = context.params.id;
  if (!username || !recordId) {
    return Response.json({ error: "Missing params" }, { status: 400 });
  }

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const key = collabsKey(username);

  try {
    if (req.method === "PATCH") {
      const body = await req.json();
      const now = new Date().toISOString();
      let notFound = false;

      await mutateRecords(COLLABS_STORE, key, (records) => {
        const idx = records.findIndex((r: any) => r.id === recordId);
        if (idx === -1) {
          notFound = true;
          return null;
        }
        notFound = false;
        const patch: any = { ...body };
        if (patch.fee !== undefined) patch.fee = parseAmount(patch.fee);
        const next = [...records];
        next[idx] = { ...records[idx], ...patch, updated_at: now };
        return next;
      });

      if (notFound) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      return Response.json({ success: true });
    }

    if (req.method === "DELETE") {
      await mutateRecords(COLLABS_STORE, key, (records) => {
        const next = records.filter((r: any) => r.id !== recordId);
        return next.length === records.length ? null : next;
      });
      return Response.json({ success: true });
    }
  } catch (err) {
    if (err instanceof RecordWriteConflictError) {
      return Response.json({ error: "협업 내역이 방금 변경되었습니다. 다시 시도해 주세요." }, { status: 409 });
    }
    console.error("[api-collab-item] Unexpected error:", err);
    return Response.json({ error: "서버 오류" }, { status: 500 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/collabs/:username/:id",
};
