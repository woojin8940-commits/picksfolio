import { getStore } from "@netlify/blobs";
import { getSupabaseServer } from "./supabase.mts";

/**
 * 댓글 자동 DM 의 2단계 발송(미끼 → 본 메시지) 상태.
 *
 * 댓글 비공개 답장은 댓글 1건당 1통이고 대화창을 열어주지 않는다. 그래서 첫 통은
 * 짧은 문구 + postback 버튼 하나("미끼")로 보내고, 사람이 그 버튼을 누르면(= 우리에게
 * 말을 건 것으로 처리돼 24시간 창이 열린다) 본 메시지를 IGSID 로 여러 통 보낸다.
 *
 * 이 파일이 들고 있는 것:
 *  - 대기 기록 `pending/<사용자명>/<댓글ID>` — 미끼를 보낸 댓글. 버튼 payload 에는
 *    댓글 ID 만 싣고, 어떤 자동화 후보였는지·누가 단 댓글인지는 여기서 찾는다
 *    (payload 는 사람이 들고 다니는 값이라 짧고 의미 없는 편이 안전하다).
 *  - 상태 기록 `health/<사용자명>` — 버튼 클릭 뒤 본 메시지가 "대화창 밖"으로 연달아
 *    거부되면 Meta 가 버튼 클릭을 더 이상 대화 수락으로 인정하지 않는다는 뜻이다.
 *    그때는 2단계 발송을 잠시 멈추고 기존 1통 카드 방식으로 되돌린다(서킷 브레이커).
 */

const STORE = "dm-bait";
const store = () => getStore({ name: STORE, consistency: "strong" });

/** 대기 기록 보관 기간. 비공개 답장은 댓글 뒤 7일까지 나가고, 사람은 그 뒤에도 버튼을 누를 수 있다. */
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 이만큼 연달아 실패하면 2단계 발송을 멈춘다. 한 번의 우연한 실패로 전체를 끄지 않기 위해서다. */
const TRIP_AFTER = 3;
/** 멈춘 뒤 다시 시도해 볼 때까지의 시간. */
const SUSPEND_MS = 24 * 60 * 60 * 1000;

const PAYLOAD_PREFIX = "bait_";

/** 미끼 버튼(및 팔로우 재확인 버튼) payload. */
export const baitPayload = (commentId: string) => `${PAYLOAD_PREFIX}${commentId}`;

/** payload 에서 댓글 ID 를 되돌린다. 우리 형식이 아니면 null. */
export function commentIdFromBaitPayload(payload: string): string | null {
  const value = String(payload || "");
  if (!value.startsWith(PAYLOAD_PREFIX)) return null;
  const id = value.slice(PAYLOAD_PREFIX.length);
  return /^[A-Za-z0-9_-]{1,120}$/.test(id) ? id : null;
}

/** 본 메시지를 이 댓글에 이미 보냈는지 표시하는 발송 대장 키(댓글당 1회). */
export const baitMainKey = (commentId: string) => `baitmain_${commentId}`;
/** 팔로우 안내를 이 클릭 이벤트에 이미 보냈는지 표시하는 키(재전송 대비). */
export const baitGateKey = (eventId: string) => `baitgate_${eventId}`;

export interface BaitPending {
  commentId: string;
  /** 댓글 작성자 IGSID. 버튼을 누른 사람이 같아야 본 메시지를 보낸다. */
  fromId: string;
  /** 우선순위 순서의 자동화 후보. 클릭 시점의 팔로우 여부로 이 중 하나를 고른다. */
  automationIds: string[];
  createdAt: string;
}

const pendingKey = (username: string, commentId: string) =>
  `pending/${username.toLowerCase()}/${commentId}`;

export async function saveBaitPending(username: string, pending: BaitPending): Promise<void> {
  try {
    await store().setJSON(pendingKey(username, pending.commentId), pending);
  } catch (e) {
    // 기록을 못 남기면 버튼을 눌러도 본 메시지가 나가지 않는다. 발송 자체는 되돌릴
    // 수 없으니 흔적만 남긴다.
    console.error("[dm-bait] pending save failed:", (e as Error)?.message);
  }
}

export async function getBaitPending(username: string, commentId: string): Promise<BaitPending | null> {
  const found = (await store().get(pendingKey(username, commentId), { type: "json" }).catch(() => null)) as
    | BaitPending
    | null;
  if (!found) return null;
  const at = Date.parse(found.createdAt || "");
  if (!Number.isNaN(at) && Date.now() - at > PENDING_TTL_MS) return null;
  return found;
}

export interface BaitHealth {
  consecutiveFailures: number;
  /** 이 시각까지 2단계 발송을 멈춘다(ISO). */
  suspendedUntil?: string;
  lastError?: string;
  lastFailureAt?: string;
}

const healthKey = (username: string) => `health/${username.toLowerCase()}`;

export async function readBaitHealth(username: string): Promise<BaitHealth | null> {
  return ((await store().get(healthKey(username), { type: "json" }).catch(() => null)) as BaitHealth | null) || null;
}

/** 지금 2단계 발송이 멈춰 있는지. 조회에 실패하면 멈추지 않은 것으로 본다. */
export async function baitSuspended(username: string): Promise<boolean> {
  const health = await readBaitHealth(username);
  const until = Date.parse(health?.suspendedUntil || "");
  return !Number.isNaN(until) && until > Date.now();
}

export async function noteBaitSuccess(username: string): Promise<void> {
  const health = await readBaitHealth(username);
  if (!health || (health.consecutiveFailures === 0 && !health.suspendedUntil)) return;
  await store().setJSON(healthKey(username), { consecutiveFailures: 0 }).catch(() => undefined);
}

/**
 * 2단계 방식 자체가 막힌 것으로 보이는 실패를 기록한다.
 * 연속 실패가 기준을 넘으면 발송을 멈추고 true 를 돌려준다(이번에 막 멈춘 경우만).
 */
export async function noteBaitFailure(username: string, error: string): Promise<boolean> {
  const health = (await readBaitHealth(username)) || { consecutiveFailures: 0 };
  const failures = (health.consecutiveFailures || 0) + 1;
  const alreadySuspended = Date.parse(health.suspendedUntil || "") > Date.now();
  const trip = failures >= TRIP_AFTER && !alreadySuspended;
  const next: BaitHealth = {
    consecutiveFailures: failures,
    suspendedUntil: trip ? new Date(Date.now() + SUSPEND_MS).toISOString() : health.suspendedUntil,
    lastError: error.slice(0, 300),
    lastFailureAt: new Date().toISOString(),
  };
  await store().setJSON(healthKey(username), next).catch(() => undefined);
  return trip;
}

/**
 * 운영자 알림.
 *
 * 2단계 발송이 막혔다는 건 한 사용자의 문제가 아니라 Meta 정책 변경의 신호일 수
 * 있어 운영자 알림함(admin_notifications)에 남긴다. 알림 실패는 발송에 영향을 주지
 * 않는다 — 함수 로그에도 같은 내용을 남긴다.
 */
export async function notifyAdminBaitIssue(username: string, detail: string, tag: string): Promise<void> {
  console.error(`[dm-bait] ${tag} for ${username}: ${detail}`);
  try {
    const { error } = await getSupabaseServer().from("admin_notifications").upsert(
      {
        id: `dm_bait_${tag}_${username.toLowerCase()}_${new Date().toISOString().slice(0, 10)}`,
        type: `dm_bait_${tag}`,
        influencer_username: username,
        proposal_title: `댓글 자동 DM 2단계 발송 문제: ${detail}`.slice(0, 300),
        created_at: new Date().toISOString(),
        read: false,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  } catch (e) {
    console.warn("[dm-bait] admin notification failed:", (e as Error)?.message);
  }
}
