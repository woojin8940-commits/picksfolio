import type { Config } from "@netlify/functions";
import { requireAdmin } from "./_shared/admin-auth.mts";
import { readDmLog } from "./_shared/dm-automation-log.mts";
import { queueRpc } from "./_shared/dm-worker.mts";
import { getSupabaseServer } from "./_shared/supabase.mts";

export default async (req: Request) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  if (req.method !== "GET") return new Response(null, { status: 405 });
  const headers = { "Cache-Control": "private, no-store" };
  const url = new URL(req.url);
  const offset = Math.max(0, Math.min(100000, Math.floor(Number(url.searchParams.get("offset")) || 0)));
  const account = url.searchParams.get("account");
  const logsFor = url.searchParams.get("logs");
  try {
    /**
     * 계정의 최근 자동 DM 활동 기록(발송 · 건너뜀 · 실패와 그 이유).
     *
     * 발송 경로는 "왜 보내지 않았는지"를 이 기록에 남기지만, 지금까지 이 기록을 볼 수 있는
     * 화면이 없었다. "버튼을 눌렀는데 다음 메시지가 안 왔다" 같은 문의는 이 기록이 있어야
     * 원인을 가릴 수 있다.
     */
    if (logsFor !== null) {
      const username = logsFor.trim().toLowerCase();
      if (!/^[a-z0-9._/-]{1,80}$/.test(username)) return Response.json({ error: "잘못된 계정입니다." }, { status: 400, headers });
      return Response.json({ logs: await readDmLog(username, 100) }, { headers });
    }
    if (account) {
      if (!/^\d{1,64}$/.test(account)) return Response.json({ error: "잘못된 계정입니다." }, { status: 400, headers });
      const { data, error } = await getSupabaseServer().from("dm_jobs")
        .select("id,job_type,status,outcome,last_error,error_kind,attempts,due_at,completed_at")
        .eq("ig_account_id", account).or("status.in.(failed,uncertain),outcome.eq.partial")
        .order("completed_at", { ascending: false }).range(offset, offset + 49)
        .abortSignal(AbortSignal.timeout(8_000));
      if (error) throw error;
      return Response.json({ jobs: data || [] }, { headers });
    }
    const data = await queueRpc<{ accounts: unknown[]; generatedAt: string }>("dm_queue_overview", { p_offset: offset, p_limit: 50 });
    return Response.json({ ...data, accounts: data.accounts.slice(0, 50), hasMore: data.accounts.length > 50 }, { headers });
  } catch {
    return Response.json({ error: "DM 대기열을 불러오지 못했습니다." }, { status: 503, headers });
  }
};

export const config: Config = { path: "/api/admin/dm-queue" };
