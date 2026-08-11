import { getStore } from "@netlify/blobs";

/**
 * "우리가 보내지 않은 자동 DM" 감지 기록.
 *
 * 인스타그램 계정에는 이 서비스 말고도 댓글에 자동으로 DM 을 보낼 수 있는 경로가
 * 있다 — 인스타그램/메타가 제공하는 자체 자동 메시지 설정, 예전에 연결해 둔 다른
 * DM 자동화 서비스 등이다. 이들은 우리 설정과 무관하게 동작하므로, 사용자가 이
 * 화면에서 문구를 바꾸거나 자동 발송을 꺼도 예전 문구가 계속 도착한다. 화면에는
 * 아무 단서가 없어 "앱이 예전 메시지를 보낸다"로 읽히는데, 실제로는 우리가 보낸
 * 적이 없는 메시지다.
 *
 * 그래서 웹훅으로 들어오는 발신 메시지 에코(계정이 보낸 DM 알림)를 보고, 우리가
 * 보낸 문구가 아니면 여기에 기록해 화면에서 알려준다.
 *
 * 키 형식
 *   - `fdm_<사용자명>`                : 마지막으로 감지한 외부 자동 DM.
 *   - `seen_<사용자명>/<IGSID>_<시각>` : 이 사람의 댓글 이벤트를 방금 받았다는 표시.
 *
 * 댓글 표시를 함께 쓰는 이유: 에코만 보면 사장님이 손으로 직접 보낸 답장까지
 * "외부 자동 발송"으로 표시된다. 댓글 이벤트 직후에 나간 DM 만 자동 발송으로 본다.
 */

const STORE = "dm-automation-foreign";
/** 댓글 표시의 유효 시간. 이 시간 안에 나간 DM 만 자동 발송으로 본다. */
const MARKER_TTL_MS = 10 * 60 * 1000;
/** 오래된 댓글 표시를 정리할 확률. */
const PRUNE_CHANCE = 0.1;

const store = () => getStore({ name: STORE, consistency: "strong" });

const alertKey = (username: string) => `fdm_${username.toLowerCase()}`;
const markerPrefix = (username: string) => `seen_${username.toLowerCase()}/`;
const markerKeyPrefix = (username: string, igsid: string) => `${markerPrefix(username)}${igsid}_`;

export interface ForeignDmAlert {
  /** 실제로 도착한 문구(앞부분). */
  text: string;
  /** 마지막 감지 시각. */
  at: string;
  /** 감지 누적 횟수. */
  count: number;
}

/** 키 뒤에 붙은 시각(epoch ms)을 읽는다. */
function epochOf(key: string): number {
  const raw = key.slice(key.lastIndexOf("_") + 1);
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : 0;
}

/** 이 사람의 댓글 이벤트를 방금 받았다고 표시한다. */
export async function noteCommentSeen(username: string, igsid: string): Promise<void> {
  if (!username || !igsid) return;
  try {
    await store().set(`${markerKeyPrefix(username, igsid)}${Date.now()}`, "1");
    if (Math.random() < PRUNE_CHANCE) await pruneMarkers(username);
  } catch (e) {
    console.warn("[dm-foreign] marker write failed:", (e as Error)?.message);
  }
}

/** 최근(MARKER_TTL_MS 이내)에 이 사람의 댓글 이벤트를 받았는지. */
export async function commentSeenRecently(username: string, igsid: string): Promise<boolean> {
  if (!username || !igsid) return false;
  try {
    const { blobs } = await store().list({ prefix: markerKeyPrefix(username, igsid) });
    const cutoff = Date.now() - MARKER_TTL_MS;
    return blobs.some((b) => epochOf(b.key) >= cutoff);
  } catch {
    // 조회가 안 되면 판단하지 않는다 — 틀린 경고를 띄우는 쪽이 더 나쁘다.
    return false;
  }
}

async function pruneMarkers(username: string): Promise<void> {
  try {
    const s = store();
    const { blobs } = await s.list({ prefix: markerPrefix(username) });
    const cutoff = Date.now() - MARKER_TTL_MS;
    await Promise.all(
      blobs.filter((b) => epochOf(b.key) < cutoff).map((b) => s.delete(b.key).catch(() => {})),
    );
  } catch {
    // 정리는 실패해도 무방하다.
  }
}

/** 외부에서 나간 자동 DM 을 기록한다(같은 문구면 횟수만 올린다). */
export async function recordForeignDm(username: string, text: string): Promise<void> {
  const body = (text || "").trim();
  if (!username || !body) return;
  try {
    const s = store();
    const current = (await s.get(alertKey(username), { type: "json" })) as ForeignDmAlert | null;
    const same = current && current.text === body.slice(0, 300);
    await s.setJSON(alertKey(username), {
      text: body.slice(0, 300),
      at: new Date().toISOString(),
      count: same ? (Number(current?.count) || 0) + 1 : 1,
    } satisfies ForeignDmAlert);
  } catch (e) {
    console.warn("[dm-foreign] record failed:", (e as Error)?.message);
  }
}

/** 화면에 띄울 감지 기록. 없으면 null. */
export async function readForeignDm(username: string): Promise<ForeignDmAlert | null> {
  if (!username) return null;
  try {
    const data = (await store().get(alertKey(username), { type: "json" })) as ForeignDmAlert | null;
    if (!data || !data.text) return null;
    return { text: String(data.text), at: String(data.at || ""), count: Number(data.count) || 1 };
  } catch {
    return null;
  }
}

/** 사용자가 안내를 확인했을 때 기록을 지운다. */
export async function clearForeignDm(username: string): Promise<void> {
  if (!username) return;
  try {
    await store().delete(alertKey(username));
  } catch (e) {
    console.warn("[dm-foreign] clear failed:", (e as Error)?.message);
  }
}
