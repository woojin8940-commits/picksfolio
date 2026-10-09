import { getStore } from "@netlify/blobs";

/**
 * 계정별 "답글/DM 발송 속도"(시간당 발송량) 설정.
 *
 * 짧은 시간에 답글·DM 이 몰려 나가면 메타가 비정상 활동(스팸)으로 보고 기능을
 * 제한할 수 있다. 발송은 댓글이 달리는 대로 곧바로 나가고(연이은 발송 사이 최소
 * 0.4초), 지난 한 시간 동안 고른 발송량에 닿으면 남은 발송은 대기열에 남아
 * 한도에 여유가 생기는 대로 들어온 순서대로 나간다.
 *
 *  · 안전 50~200건 · 기본 201~500건 · 주의 501~700건 (기본값 500건)
 *
 * 설정 문서(dm-automation)는 사용자명으로 저장되지만 발송기는 인스타그램 계정 ID 만
 * 안다. 그래서 값을 계정 ID 별로 한 번 더 적어 두고, 발송기는 그쪽을 읽는다.
 */

export const DM_SEND_SPEED_MIN = 50;
export const DM_SEND_SPEED_MAX = 700;
export const DM_SEND_SPEED_DEFAULT = 500;

const STORE_NAME = "dm-send-speed";
/** 바꾼 값이 곧바로 반영되도록 짧게만 기억한다. */
const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { value: number; at: number }>();

export function normalizeDmSendSpeed(raw: unknown): number {
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return DM_SEND_SPEED_DEFAULT;
  return Math.min(DM_SEND_SPEED_MAX, Math.max(DM_SEND_SPEED_MIN, value));
}

const keyFor = (igId: string) => `acct_${igId}`;

export async function readDmSendSpeed(igId: string): Promise<number> {
  if (!igId) return DM_SEND_SPEED_DEFAULT;
  const hit = cache.get(igId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let value = DM_SEND_SPEED_DEFAULT;
  try {
    const stored = (await getStore({ name: STORE_NAME, consistency: "strong" }).get(keyFor(igId), { type: "json" })) as
      | { hourlyLimit?: number }
      | null;
    if (stored?.hourlyLimit != null) value = normalizeDmSendSpeed(stored.hourlyLimit);
  } catch (e) {
    // 읽지 못해도 발송은 멈추지 않는다 — 직전 값(없으면 기본값)으로 계속 보낸다.
    console.warn("[dm-send-speed] read failed:", (e as Error)?.message);
    if (hit) return hit.value;
  }
  cache.set(igId, { value, at: Date.now() });
  return value;
}

/** 연동된 계정 ID(인스타그램 사용자 ID · 비즈니스 계정 ID) 모두에 같은 값을 적는다. */
export async function writeDmSendSpeed(igIds: Array<string | undefined>, hourlyLimit: number): Promise<void> {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const value = normalizeDmSendSpeed(hourlyLimit);
  const ids = [...new Set(igIds.filter((id): id is string => Boolean(id)))];
  await Promise.all(ids.map(async (id) => {
    const current = (await store.get(keyFor(id), { type: "json" }).catch(() => null)) as { hourlyLimit?: number } | null;
    if (current?.hourlyLimit !== value) {
      await store.setJSON(keyFor(id), { hourlyLimit: value, updatedAt: new Date().toISOString() });
    }
    cache.set(id, { value, at: Date.now() });
  }));
}
