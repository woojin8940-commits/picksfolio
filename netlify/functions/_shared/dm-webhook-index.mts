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
 * ## 한 인스타그램 계정을 여러 앱 계정이 연동한 경우
 *
 * 이 매핑은 한동안 값 하나만 담았고, 인덱스를 쓰는 쪽(OAuth 콜백 · 웹훅 재구독 ·
 * 설정 화면의 자기 수리)이 모두 자기 사용자명으로 덮어썼다. 같은 인스타그램 계정을
 * 여러 앱 계정이 연동해 두면(테스트 계정, 사장님 계정과 대행사 계정) **가장 마지막에
 * 설정 화면을 연 사람**이 그 계정의 웹훅 스트림을 가져가 버린다. 자동 발송을 켜 둔
 * 사람의 댓글 이벤트가 자동화가 하나도 없는 다른 앱 계정으로 배달되면, 그쪽에서
 * "스위치 꺼짐"으로 조용히 버려진다 — 실제로 이 상태에서 수동 발송만 되고 자동
 * 발송은 아무 기록도 남기지 않는 신고가 있었다.
 *
 * 그래서 인덱스는 후보 **목록**을 담고, 주인은 저장된 설정을 읽어 정한다. 자동
 * 발송을 켜 두고 토큰이 있고 실행 중인 자동화가 있는 쪽이 그 계정의 주인이다.
 * 후보가 하나뿐인 흔한 경우에는 설정을 읽지 않으므로 비용도 예전과 같다.
 *
 * 수신 흔적(`seen_*`)은 진단용이다. "댓글을 달아도 DM 이 안 온다"는 신고에서 원인이
 * (1) Meta 가 이벤트를 보내지 않는 것인지 (2) 받고도 우리가 처리하지 못한 것인지
 * 구분해야 하는데, 이 값이 없으면 코드만 봐서는 알 수 없다.
 */

const INDEX_STORE = "dm-automation-index";
const SETTINGS_STORE = "dm-automation";

/** 주인을 못 찾은 계정 ID 를 다시 훑기 전에 기다리는 시간. */
const MISS_TTL_MS = 10 * 60 * 1000;

/** 후보 목록을 고쳐 쓸 때 조건부 쓰기를 다시 시도하는 횟수. */
const INDEX_WRITE_ATTEMPTS = 5;

type BlobStore = ReturnType<typeof getStore>;

const indexStore = (): BlobStore => getStore({ name: INDEX_STORE, consistency: "strong" });

interface StoredSettings {
  igUserId?: string;
  igAccountId?: string;
  /** 자동 발송 전체 스위치. */
  enabled?: boolean;
  accessToken?: string;
  automations?: { enabled?: boolean }[];
  updatedAt?: string;
}

const idKey = (igAccountId: string) => `ig_${igAccountId}`;
const missKey = (igAccountId: string) => `miss_ig_${igAccountId}`;

/**
 * 후보 목록을 읽는다.
 *
 * 예전 형식(사용자명 한 개를 평문으로 저장)도 그대로 읽는다. 이미 저장된 값을
 * 마이그레이션하지 않아도 되고, 목록을 고쳐 쓸 때 자연히 새 형식으로 바뀐다.
 */
function parseCandidates(raw: string | null): string[] {
  if (!raw) return [];
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(parsed.map((v) => String(v || "").toLowerCase()).filter(Boolean)),
        );
      }
    } catch {
      return [];
    }
    return [];
  }
  return [text.toLowerCase()];
}

/**
 * 후보 목록을 조건부로 고쳐 쓴다.
 *
 * 같은 인스타그램 계정을 연동한 여러 사용자가 동시에 설정 화면을 열면 이 키에
 * 동시 쓰기가 일어난다. 그냥 덮어쓰면 한쪽의 추가가 사라지고, 사라진 쪽은 다음
 * 재구독까지 자기 웹훅을 못 받는다 — 이 모듈이 고치려는 바로 그 증상이다.
 * 그래서 읽은 값이 그대로일 때만 쓴다(etag).
 */
async function updateCandidates(
  store: BlobStore,
  igAccountId: string,
  change: (current: string[]) => string[] | null,
): Promise<string[]> {
  const key = idKey(igAccountId);
  for (let attempt = 0; attempt < INDEX_WRITE_ATTEMPTS; attempt++) {
    const snapshot = await store
      .getWithMetadata(key, { type: "text", consistency: "strong" })
      .catch(() => null);
    const current = parseCandidates(snapshot?.data ?? null);
    const next = change(current);
    if (next === null) return current;

    // `setJSON` 은 현재 버전에서 조건을 요청에 실어 보내지 않아 조건이 무시된다.
    // `set` + 직렬화를 쓴다(읽는 쪽은 문자열로 읽어 직접 파싱한다).
    const body = JSON.stringify(next);
    const result = snapshot?.etag
      ? await store.set(key, body, { onlyIfMatch: snapshot.etag })
      : await store.set(key, body, { onlyIfNew: true });
    if (result.modified) return next;
  }
  console.warn("[dm-index] candidate list write gave up after conflicts:", igAccountId);
  return parseCandidates(await store.get(key, { type: "text" }).catch(() => null));
}

/**
 * 이 계정의 모든 IG ID 를 역인덱스에 채운다.
 *
 * 이미 있는 후보는 지우지 않는다 — 한 인스타그램 계정을 여러 앱 계정이 연동한
 * 경우 서로를 밀어내면 안 된다. 연동이 끊긴 사용자는 주인을 정할 때 설정을 읽어
 * 걸러낸다.
 */
export async function indexDmAccount(username: string, igIds: (string | undefined)[]): Promise<void> {
  const store = indexStore();
  const ids = Array.from(new Set(igIds.filter(Boolean) as string[]));
  const name = username.toLowerCase();
  await Promise.all(
    ids.map(async (id) => {
      try {
        await updateCandidates(store, id, (current) =>
          current.includes(name) ? null : [...current, name],
        );
        await store.delete(missKey(id)).catch(() => {});
      } catch (e) {
        console.warn("[dm-index] index write failed:", (e as Error)?.message);
      }
    }),
  );
}

/**
 * 연동을 끊은 사용자를 후보에서 뺀다.
 *
 * 키를 통째로 지우면 같은 인스타그램 계정을 연동한 다른 사용자의 라우팅까지 함께
 * 날아간다(빈 키는 설정 전체를 훑어 복구되지만, 그 훑기가 이벤트마다 붙는다).
 * 그래서 자기 이름만 뺀다. 후보가 아무도 남지 않으면 키를 지워 둔다.
 */
export async function unindexDmAccount(
  username: string,
  igIds: (string | undefined)[],
): Promise<void> {
  const store = indexStore();
  const ids = Array.from(new Set(igIds.filter(Boolean) as string[]));
  const name = username.toLowerCase();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const left = await updateCandidates(store, id, (current) =>
          current.includes(name) ? current.filter((u) => u !== name) : null,
        );
        if (left.length === 0) await store.delete(idKey(id)).catch(() => {});
      } catch (e) {
        console.warn("[dm-index] index cleanup failed:", (e as Error)?.message);
      }
    }),
  );
}

/** 저장된 설정에서 이 IG ID 를 쓰는 사용자명을 모두 찾는다. */
async function scanForOwners(igAccountId: string): Promise<string[]> {
  const settings = getStore({ name: SETTINGS_STORE, consistency: "strong" });
  const found: string[] = [];
  const { blobs } = await settings.list({ prefix: "dm_" });
  for (const blob of blobs) {
    const data = (await settings
      .get(blob.key, { type: "json" })
      .catch(() => null)) as StoredSettings | null;
    if (!data) continue;
    const ids = [data.igUserId, data.igAccountId].filter(Boolean) as string[];
    if (!ids.includes(igAccountId)) continue;
    found.push(blob.key.slice("dm_".length).toLowerCase());
  }
  return Array.from(new Set(found));
}

/**
 * 주인 후보의 순위.
 *
 * 웹훅 이벤트는 한 곳에서만 처리해야 한다 — 두 사용자가 같은 댓글을 처리하면 공개
 * 답글이 두 번 달리고, 비공개 답장은 댓글 1건당 한 통뿐이라 뒤쪽은 실패로 기록된다.
 * 그래서 "가장 그럴듯한 주인" 하나를 고른다. 자동 발송을 켜 둔 쪽이 최우선이다 —
 * 그 사람이 지금 댓글에 반응이 오기를 기다리는 사람이다.
 */
function ownerRank(s: StoredSettings): number {
  let rank = 0;
  if (s.enabled) rank += 4;
  if (s.accessToken) rank += 2;
  if ((s.automations || []).some((a) => a?.enabled)) rank += 1;
  return rank;
}

/**
 * 후보가 여럿일 때 설정을 읽어 주인을 고른다.
 *
 * 연동이 끊긴(이 IG ID 를 더 이상 쓰지 않는) 후보는 인덱스에서도 지운다. 남겨 두면
 * 매 이벤트마다 그 사람의 설정을 헛읽는다.
 */
async function pickOwner(
  store: BlobStore,
  igAccountId: string,
  candidates: string[],
): Promise<string | null> {
  const settings = getStore({ name: SETTINGS_STORE, consistency: "strong" });
  const rows = await Promise.all(
    candidates.map(async (username) => {
      const data = (await settings
        .get(`dm_${username}`, { type: "json" })
        .catch(() => null)) as StoredSettings | null;
      const linked =
        Boolean(data) &&
        [data!.igUserId, data!.igAccountId].filter(Boolean).includes(igAccountId);
      return { username, data, linked };
    }),
  );

  const live = rows.filter((r) => r.linked);
  const stale = rows.filter((r) => !r.linked).map((r) => r.username);
  if (stale.length > 0) {
    await updateCandidates(store, igAccountId, (current) => {
      const next = current.filter((u) => !stale.includes(u));
      return next.length === current.length ? null : next;
    }).catch(() => undefined);
  }

  if (live.length === 0) return null;

  live.sort((a, b) => {
    const byRank = ownerRank(b.data!) - ownerRank(a.data!);
    if (byRank !== 0) return byRank;
    // 같은 조건이면 최근에 저장한 쪽. 방금 설정을 만진 사람이 기다리는 사람이다.
    return (
      (Date.parse(String(b.data!.updatedAt || "")) || 0) -
      (Date.parse(String(a.data!.updatedAt || "")) || 0)
    );
  });

  if (live.length > 1) {
    console.warn(
      `[dm-index] IG ${igAccountId} is linked by ${live.length} accounts; routing to`,
      live[0].username,
    );
  }
  return live[0].username;
}

/**
 * IG 계정 ID 로 사용자명을 찾는다. 인덱스에 없으면 설정 블롭을 훑어 찾고 인덱스를
 * 채운다. 그래도 못 찾으면 잠시 동안(MISS_TTL_MS) 다시 훑지 않는다.
 */
export async function resolveDmAccountByIgId(igAccountId: string): Promise<string | null> {
  if (!igAccountId) return null;
  const store = indexStore();

  let candidates = parseCandidates(
    await store.get(idKey(igAccountId), { type: "text" }).catch(() => null),
  );

  if (candidates.length === 0) {
    const missAt = await store.get(missKey(igAccountId), { type: "text" }).catch(() => null);
    if (missAt && Date.now() - Date.parse(missAt) < MISS_TTL_MS) return null;

    try {
      candidates = await scanForOwners(igAccountId);
    } catch (e) {
      console.warn("[dm-index] index rebuild failed:", (e as Error)?.message);
      return null;
    }

    if (candidates.length === 0) {
      await store.set(missKey(igAccountId), new Date().toISOString()).catch(() => {});
      return null;
    }
    await updateCandidates(store, igAccountId, (current) =>
      Array.from(new Set([...current, ...candidates])),
    ).catch(() => undefined);
    console.warn("[dm-index] rebuilt missing webhook index for", candidates.join(", "));
  }

  // 흔한 경우(후보 한 명)에는 설정을 읽지 않는다.
  if (candidates.length === 1) return candidates[0];
  return pickOwner(store, igAccountId, candidates);
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
