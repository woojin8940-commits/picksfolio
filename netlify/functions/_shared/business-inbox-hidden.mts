import { getStore } from "@netlify/blobs";
import { mutateBlobJSON } from "./blob-write.mts";

/**
 * 비즈니스 제안 현황에서 업체가 목록에서 내린 줄.
 *
 * 이 화면에는 두 갈래가 섞여 들어온다 — 업체가 직접 보낸 비즈니스 제안과, 담당자를
 * 거쳐 돌아가는 캠페인 협업이다. 두 갈래를 같은 방식으로 지울 수는 없다.
 *
 *   · 비즈니스 제안은 업체가 만든 것이라 실제로 지운다(인플루언서 수신함의 삭제와
 *     같은 경로를 쓴다).
 *   · 캠페인 협업은 담당자와 인플루언서가 함께 쓰는 진행 기록이다. 업체 화면에서
 *     지웠다고 협업 자체를 없애면 인플루언서의 진행사항과 담당자 큐가 함께 사라진다.
 *     그래서 이쪽은 "내 목록에서만 내린다".
 *
 * 목록에서 내린 id 는 업체 계정별로 모아 둔다. 브랜드 협업현황에는 그대로 남아 있어서
 * 진행은 계속 볼 수 있고, 끝난 건으로 길어진 제안 현황만 정리된다.
 */

const STORE = "business-proposals";
const MAX_HIDDEN = 2000;

type Hidden = { ids: string[]; updatedAt?: string };

const hiddenKey = (username: string) => `biz_inbox_hidden_${username}`;

const normalize = (value: unknown): string => String(value ?? "").trim();

const toIdList = (current: Hidden | string[] | null): string[] => {
  if (Array.isArray(current)) return current.map(normalize).filter(Boolean);
  const ids = (current as Hidden | null)?.ids;
  return Array.isArray(ids) ? ids.map(normalize).filter(Boolean) : [];
};

/** 업체가 목록에서 내린 id 집합. 읽기에 실패하면 빈 집합 — 목록이 비어 보이는 쪽보다 낫다. */
export async function loadHiddenInboxIds(username: string): Promise<Set<string>> {
  try {
    const store = getStore(STORE);
    const current = (await store.get(hiddenKey(username), { type: "json" })) as Hidden | string[] | null;
    return new Set(toIdList(current));
  } catch (err) {
    console.error("[business-inbox-hidden] Failed to read hidden ids:", err);
    return new Set<string>();
  }
}

export async function hideInboxItem(username: string, itemId: string): Promise<void> {
  const id = normalize(itemId);
  if (!id) return;
  await mutateBlobJSON<Hidden>(STORE, hiddenKey(username), (current) => {
    const ids = toIdList(current);
    if (ids.includes(id)) return null;
    return { ids: [id, ...ids].slice(0, MAX_HIDDEN), updatedAt: new Date().toISOString() };
  });
}
