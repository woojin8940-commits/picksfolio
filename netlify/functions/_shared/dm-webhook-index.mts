import { getStore } from "@netlify/blobs";

/**
 * 웹훅 → 계정 역인덱스와 수신 흔적.
 *
 * 인스타그램 웹훅 payload 에는 사용자명이 없다. `entry.id`(IG 계정 ID)만 오므로,
 * "이 계정이 누구 것인지"를 우리 쪽에서 찾아야 자동 발송이 시작된다. 그 역인덱스가
 * 이 모듈이 다루는 `ig_<IG 계정 ID> → 사용자명` 매핑이다.
 *
 * 매핑은 원래 OAuth 콜백에서 한 번만 기록했다. 그래서 그 코드가 없던 시절에 연동한
 * 계정이나, 웹훅이 저장된 ID 와 다른 ID 로 이벤트를 보내는 계정은 조회가 비어
 * 조용히 무시됐다 — 화면에서는 자동 발송이 켜져 있고 수동 발송은 되는데 댓글에는
 * 아무 일도 일어나지 않는 상태다. 그래서 여기서는 조회가 비면 저장된 설정을 훑어
 * 주인을 찾고 인덱스를 다시 채운다(자기 치유).
 *
 * 수신 흔적(`seen_*`)은 진단용이다. "댓글을 달아도 DM 이 안 온다"는 신고에서 원인이
 * (1) Meta 가 이벤트를 보내지 않는 것인지 (2) 받고도 우리가 처리하지 못한 것인지
 * 구분해야 하는데, 이 값이 없으면 코드만 봐서는 알 수 없다.
 */

const INDEX_STORE = "dm-automation-index";
const SETTINGS_STORE = "dm-automation";

/** 주인을 못 찾은 계정 ID 를 다시 훑기 전에 기다리는 시간. */
const MISS_TTL_MS = 10 * 60 * 1000;

const indexStore = () => getStore({ name: INDEX_STORE, consistency: "strong" });

interface StoredSettings {
  igUserId?: string;
  igAccountId?: string;
}

/** 이 계정의 모든 IG ID 를 역인덱스에 채운다. 이미 같은 값이면 그대로 덮어쓴다. */
export async function indexDmAccount(username: string, igIds: (string | undefined)[]): Promise<void> {
  const store = indexStore();
  const ids = Array.from(new Set(igIds.filter(Boolean) as string[]));
  await Promise.all(
    ids.map(async (id) => {
      try {
        await store.set(`ig_${id}`, username.toLowerCase());
        await store.delete(`miss_ig_${id}`).catch(() => {});
      } catch (e) {
        console.warn("[dm-index] index write failed:", (e as Error)?.message);
      }
    }),
  );
}

/**
 * IG 계정 ID 로 사용자명을 찾는다. 인덱스에 없으면 설정 블롭을 훑어 찾고 인덱스를
 * 채운다. 그래도 못 찾으면 잠시 동안(MISS_TTL_MS) 다시 훑지 않는다.
 */
export async function resolveDmAccountByIgId(igAccountId: string): Promise<string | null> {
  if (!igAccountId) return null;
  const store = indexStore();

  const cached = await store.get(`ig_${igAccountId}`, { type: "text" }).catch(() => null);
  if (cached) return cached;

  const missAt = await store.get(`miss_ig_${igAccountId}`, { type: "text" }).catch(() => null);
  if (missAt && Date.now() - Date.parse(missAt) < MISS_TTL_MS) return null;

  const settings = getStore({ name: SETTINGS_STORE, consistency: "strong" });
  try {
    const { blobs } = await settings.list({ prefix: "dm_" });
    for (const blob of blobs) {
      const data = (await settings.get(blob.key, { type: "json" }).catch(() => null)) as StoredSettings | null;
      if (!data) continue;
      const ids = [data.igUserId, data.igAccountId].filter(Boolean) as string[];
      if (!ids.includes(igAccountId)) continue;

      const username = blob.key.slice("dm_".length);
      await indexDmAccount(username, [...ids, igAccountId]);
      console.warn("[dm-index] rebuilt missing webhook index for", username);
      return username;
    }
  } catch (e) {
    console.warn("[dm-index] index rebuild failed:", (e as Error)?.message);
    return null;
  }

  await store.set(`miss_ig_${igAccountId}`, new Date().toISOString()).catch(() => {});
  return null;
}

/** 웹훅 이벤트를 받았다는 사실을 남긴다(계정 ID 기준 + 주인을 찾았으면 사용자 기준). */
export async function noteWebhookReceived(igAccountId: string, username?: string | null): Promise<void> {
  const at = new Date().toISOString();
  const store = indexStore();
  try {
    if (igAccountId) await store.set(`seen_ig_${igAccountId}`, at);
    if (username) await store.set(`seen_user_${username.toLowerCase()}`, at);
  } catch (e) {
    console.warn("[dm-index] receipt write failed:", (e as Error)?.message);
  }
}

/** 이 계정으로 웹훅이 마지막으로 도착한 시각(없으면 null). */
export async function readWebhookReceipt(args: {
  username: string;
  igIds: (string | undefined)[];
}): Promise<string | null> {
  const store = indexStore();
  const keys = [
    `seen_user_${args.username.toLowerCase()}`,
    ...(args.igIds.filter(Boolean) as string[]).map((id) => `seen_ig_${id}`),
  ];
  const values = await Promise.all(
    keys.map((key) => store.get(key, { type: "text" }).catch(() => null)),
  );
  const times = values.filter(Boolean) as string[];
  if (times.length === 0) return null;
  return times.sort().reverse()[0];
}
