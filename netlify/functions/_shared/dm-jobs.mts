import { getSupabaseServer } from "./supabase.mts";
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { resolveDmAccountByIgId } from "./dm-webhook-index.mts";
import { queueRpc, wakeDmWorkers } from "./dm-worker.mts";

export interface DmJob {
  id: string;
  job_type: "comment_event" | "scheduled" | "message_event";
  username: string | null;
  ig_account_id: string | null;
  payload: Record<string, any>;
  due_at: string;
  status: "pending" | "processing" | "sent" | "failed" | "canceled" | "uncertain";
  attempts: number;
  lease_token: string | null;
  error_kind: string | null;
  last_error: string | null;
  created_at: string;
  completed_at: string | null;
  priority?: number;
  outcome?: string | null;
}

export interface QueuedComment {
  igAccountId: string;
  entryTime?: number;
  change: Record<string, any>;
}

/**
 * 버튼 클릭(postback)·받은 DM 한 건.
 *
 * 댓글과 달리 상대가 지금 대화창에서 답을 기다리고 있다. 대기열에서는 댓글보다 먼저
 * 처리된다(dm_claim_account_job).
 */
export interface QueuedMessage {
  igAccountId: string;
  entryTime?: number;
  event: Record<string, any>;
}

export const scheduledJobId = (username: string, id: string) =>
  `schedule:${username.toLowerCase()}:${id}`;

/**
 * 웹훅의 계정 ID 를 발송기가 쓰는 계정 ID 와 사용자명으로 바꾼다.
 *
 * 발송 예약(dm_reserve_send)과 작업자 선점은 settings.igUserId 기준이라, 작업 행도 같은
 * 값으로 넣어야 같은 줄에서 순서와 발송 간격이 지켜진다.
 */
async function resolveJobAccounts(igAccountIds: string[]) {
  const accounts = new Map<string, { id: string; username: string | null }>();
  for (const id of new Set(igAccountIds)) {
    const username = await resolveDmAccountByIgId(id);
    const settings = username ? await getStore({ name: "dm-automation", consistency: "strong" }).get(`dm_${username}`, { type: "json" }) as any : null;
    accounts.set(id, { id: String(settings?.igUserId || settings?.igAccountId || id), username: username || null });
  }
  return accounts;
}

/** Meta 가 같은 이벤트를 다시 보내도 같은 값이 나와야 한다(중복 작업 방지). */
function messageEventId(event: Record<string, any>): string {
  const mid = String(event?.postback?.mid || event?.message?.mid || "").trim();
  if (mid) return mid.slice(0, 200);
  return createHash("sha256").update(JSON.stringify(event ?? null)).digest("hex").slice(0, 40);
}

export async function enqueueMessageEvents(events: QueuedMessage[]): Promise<void> {
  if (events.length === 0) return;
  const accounts = await resolveJobAccounts(events.map((event) => event.igAccountId));
  const rows = events.map(({ igAccountId, entryTime, event }) => ({
    id: `message:${igAccountId}:${messageEventId(event)}`,
    job_type: "message_event",
    ig_account_id: accounts.get(igAccountId)!.id,
    username: accounts.get(igAccountId)!.username,
    priority: 0,
    payload: { igAccountId, entryTime, event },
  }));
  const { error } = await getSupabaseServer().from("dm_jobs").upsert(rows, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  await wakeDmWorkers([...accounts.values()].map((account) => account.id)).catch((e) => console.error("[dm-queue] wake failed:", (e as Error)?.message));
}

export async function enqueueCommentEvents(events: QueuedComment[]): Promise<void> {
  if (events.length === 0) return;
  const client = getSupabaseServer();
  const accounts = await resolveJobAccounts(events.map((event) => event.igAccountId));
  for (let offset = 0; offset < events.length; offset += 200) {
    const rows = events.slice(offset, offset + 200).map(({ igAccountId, entryTime, change }) => ({
      id: `comment:${igAccountId}:${String(change.value.id)}`,
      job_type: "comment_event",
      ig_account_id: accounts.get(igAccountId)!.id,
      username: accounts.get(igAccountId)!.username,
      priority: 0,
      payload: { igAccountId, entryTime, change },
    }));
    const { error } = await client.from("dm_jobs").upsert(rows, {
      onConflict: "id",
      ignoreDuplicates: true,
    });
    if (error) throw error;
  }
  await wakeDmWorkers([...accounts.values()].map((account) => account.id)).catch((e) => console.error("[dm-queue] wake failed:", (e as Error)?.message));
}

export async function backupCommentEvents(events: QueuedComment[]): Promise<void> {
  const store = getStore({ name: "dm-comment-backup", consistency: "strong" });
  for (const event of events) {
    const key = createHash("sha256").update(`${event.igAccountId}:${event.change.value.id}`).digest("hex");
    await store.set(key, JSON.stringify(event), { onlyIfNew: true });
  }
}

export async function restoreCommentEvents(deadline: number): Promise<void> {
  const store = getStore({ name: "dm-comment-backup", consistency: "strong" });
  const { blobs } = await store.list();
  for (const blob of blobs.slice(0, 20)) {
    if (Date.now() >= deadline) break;
    const event = await store.get(blob.key, { type: "json" }) as QueuedComment | null;
    if (!event) continue;
    await enqueueCommentEvents([event]);
    await store.delete(blob.key);
  }
}

export async function restoreMissingJobAccounts(deadline: number): Promise<void> {
  const client = getSupabaseServer();
  const { data, error } = await client.from("dm_jobs").select("id,username,payload")
    .eq("status", "pending").is("ig_account_id", null).limit(20).abortSignal(AbortSignal.timeout(4_000));
  if (error) throw error;
  for (const job of data || []) {
    if (Date.now() >= deadline) break;
    const username = String(job.username || job.payload?.username || "");
    const settings = username ? await getStore({ name: "dm-automation", consistency: "strong" }).get(`dm_${username}`, { type: "json" }) as any : null;
    const account = String(job.payload?.igAccountId || settings?.igUserId || settings?.igAccountId || "");
    const fields = /^\d+$/.test(account)
      ? { ig_account_id: account }
      : { status: "failed", completed_at: new Date().toISOString(), error_kind: "account_lookup", last_error: "인스타그램 계정 연결 정보를 찾지 못했습니다." };
    const result = await client.from("dm_jobs").update(fields).eq("id", job.id).eq("status", "pending").is("ig_account_id", null);
    if (result.error) throw result.error;
  }
}

export async function enqueueScheduledJob(
  username: string,
  id: string,
  igAccountId: string,
  sendAt: string,
  payload: Record<string, any>,
): Promise<void> {
  const { error } = await getSupabaseServer().from("dm_jobs").upsert(
    {
      id: scheduledJobId(username, id),
      job_type: "scheduled",
      username: username.toLowerCase(),
      ig_account_id: igAccountId || null,
      due_at: sendAt,
      priority: payload.source === "trigger" ? 0 : payload.backfill ? 20 : 10,
      payload,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw error;
  if (igAccountId) {
    await wakeDmWorkers([igAccountId]).catch((e) => console.error("[dm-queue] wake failed:", (e as Error)?.message));
  }
}

export async function reschedulePendingCommentJobs(
  username: string,
  ruleId: string,
  scheduledAt: string,
): Promise<void> {
  const target = Date.parse(scheduledAt);
  if (!username || !ruleId || Number.isNaN(target)) throw new Error("Invalid scheduled comment time");
  const dueAt = new Date(Math.max(target, Date.now())).toISOString();
  const { error } = await getSupabaseServer()
    .from("dm_jobs")
    .update({ due_at: dueAt, updated_at: new Date().toISOString() })
    .eq("job_type", "scheduled")
    .eq("username", username.toLowerCase())
    .eq("status", "pending")
    .eq("attempts", 0)
    // 예약 시각 전에 깨어난 작업은 "throttled" 로 다시 대기한다(dm-job-processor).
    // 그 작업도 함께 옮겨야 예약 시각을 앞당겼을 때 이미 쌓인 댓글이 새 시각에 나간다.
    .or("error_kind.is.null,error_kind.eq.throttled")
    .contains("payload", { source: "comment", ruleId });
  if (error) throw error;
}

/** 이 계정에서 다음으로 시간이 되는 대기 작업의 시각(epoch ms). 없으면 null. */
export async function nextPendingDueAt(igAccountId: string): Promise<number | null> {
  const { data, error } = await getSupabaseServer()
    .from("dm_jobs")
    .select("due_at")
    .eq("ig_account_id", igAccountId)
    .eq("status", "pending")
    .order("due_at", { ascending: true })
    .limit(1)
    .abortSignal(AbortSignal.timeout(4_000));
  if (error) throw error;
  const due = Date.parse(String(data?.[0]?.due_at || ""));
  return Number.isNaN(due) ? null : due;
}

export async function claimDueJobs(limit = 1): Promise<DmJob[]> {
  const { data, error } = await getSupabaseServer().rpc("dm_claim_due_jobs", { p_limit: limit });
  if (error) throw error;
  return (data || []) as DmJob[];
}

async function updateClaimedJob(
  job: DmJob,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!job.lease_token) throw new Error("Missing DM job lease");
  const { data, error } = await getSupabaseServer()
    .from("dm_jobs")
    .update({ ...fields, lease_token: null, lease_expires_at: null, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("lease_token", job.lease_token)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("DM job lease changed");
}

export async function completeDmJob(
  job: DmJob,
  status: "sent" | "failed" | "uncertain" | "canceled",
  error?: string,
  errorKind?: string,
  messageId?: string,
  outcome?: string,
): Promise<void> {
  await updateClaimedJob(job, {
    status,
    completed_at: new Date().toISOString(),
    last_error: error?.slice(0, 1000) || null,
    error_kind: errorKind || null,
    message_id: messageId || null,
    outcome: outcome || status,
  });
}

export async function retryDmJob(
  job: DmJob,
  delayMs: number,
  error: string,
  errorKind: string,
): Promise<void> {
  await updateClaimedJob(job, {
    status: "pending",
    due_at: new Date(Date.now() + delayMs).toISOString(),
    last_error: error.slice(0, 1000),
    error_kind: errorKind,
    ...(errorKind === "throttled" ? { attempts: Math.max(0, job.attempts - 1) } : {}),
  });
}

export async function pauseDmAccount(igAccountId: string, delayMs: number): Promise<void> {
  if (!igAccountId) return;
  await queueRpc("dm_pause_account", { p_account: igAccountId, p_delay_ms: Math.min(Math.ceil(delayMs), 86_400_000) });
}

export async function listStoredScheduledJobs(username: string): Promise<DmJob[]> {
  const { data, error } = await getSupabaseServer()
    .from("dm_jobs")
    .select("id,job_type,username,ig_account_id,payload,due_at,status,attempts,lease_token,error_kind,last_error,created_at,completed_at")
    .eq("job_type", "scheduled")
    .eq("username", username.toLowerCase())
    .order("due_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as DmJob[];
}

/** 대기 중인 예약을 취소한다. 취소했으면 그 예약의 내용을, 취소할 것이 없었으면 null 을 돌려준다. */
export async function cancelStoredScheduledJob(username: string, id: string): Promise<Record<string, any> | null> {
  const { data, error } = await getSupabaseServer()
    .from("dm_jobs")
    .update({ status: "canceled", completed_at: new Date().toISOString() })
    .eq("id", scheduledJobId(username, id))
    .eq("status", "pending")
    .select("id,payload")
    .maybeSingle();
  if (error) throw error;
  return data ? ((data.payload || {}) as Record<string, any>) : null;
}
