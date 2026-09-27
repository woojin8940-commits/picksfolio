import { getSupabaseServer } from "./supabase.mts";
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { resolveDmAccountByIgId } from "./dm-webhook-index.mts";
import { queueRpc, wakeDmWorkers } from "./dm-worker.mts";

export interface DmJob {
  id: string;
  job_type: "comment_event" | "scheduled";
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

export const scheduledJobId = (username: string, id: string) =>
  `schedule:${username.toLowerCase()}:${id}`;

export async function enqueueCommentEvents(events: QueuedComment[]): Promise<void> {
  if (events.length === 0) return;
  const client = getSupabaseServer();
  const accounts = new Map<string, { id: string; username: string | null }>();
  for (const id of new Set(events.map((event) => event.igAccountId))) {
    const username = await resolveDmAccountByIgId(id);
    const settings = username ? await getStore({ name: "dm-automation", consistency: "strong" }).get(`dm_${username}`, { type: "json" }) as any : null;
    accounts.set(id, { id: String(settings?.igUserId || settings?.igAccountId || id), username: username || null });
  }
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
    .is("error_kind", null)
    .contains("payload", { source: "comment", ruleId });
  if (error) throw error;
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
  status: "sent" | "failed" | "uncertain",
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

export async function cancelStoredScheduledJob(username: string, id: string): Promise<boolean> {
  const { data, error } = await getSupabaseServer()
    .from("dm_jobs")
    .update({ status: "canceled", completed_at: new Date().toISOString() })
    .eq("id", scheduledJobId(username, id))
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
