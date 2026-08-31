import { getStore } from "@netlify/blobs";
import { mutateBlobJSON } from "./blob-write.mts";

/**
 * 삭제한 제안의 묘비(tombstone) 목록.
 *
 * 비즈니스 수신함에서 제안을 지우면 SQL 행과 두 쪽 Blobs 캐시에서 함께 지운다.
 * 그런데도 협업 현황에 다시 나타나는 길이 세 개 남아 있었다.
 *
 *  1. 목록 조회(GET)는 SQL 과 Blobs 를 합친 결과를 `context.waitUntil` 로 캐시에
 *     다시 써 넣는다. 삭제 직전에 시작된 조회의 이 지연 쓰기가 삭제 뒤에 도착하면
 *     지운 제안이 캐시에 되살아난다. 사용자에게는 "지웠는데 새로고침하면 있다"로
 *     보인다.
 *  2. 정산 목록은 SQL 에서 파생 행을 만든다. SQL 삭제가 조용히 실패하면(연결
 *     오류를 로그만 남기고 넘어간다) 협업 현황 · 정산금에 그대로 남는다.
 *  3. 예전 Supabase 미러는 지우지 않는다.
 *
 * 각 경로를 따로 고쳐도 "지운 것은 안 보인다"는 약속은 어느 한 곳이 새면 깨진다.
 * 그래서 지운 id 를 한 곳에 적어 두고, 읽는 쪽 전부가 그 목록을 걸러 낸다. 되살아난
 * 데이터가 있어도 화면에는 올라오지 않는다.
 *
 * 목록은 최신 것부터 쌓고 `MAX_TOMBSTONES` 개로 자른다. 무한히 자라면 조회마다
 * 읽는 문서가 커지고, 아주 오래전에 지운 제안은 어차피 되살아날 경로가 없다.
 */

const STORE = "proposals";
const KEY = "deleted_proposal_ids";
const MAX_TOMBSTONES = 5000;

type Tombstones = { ids: string[]; updatedAt?: string };

const normalize = (value: unknown): string => String(value ?? "").trim();

const toIdList = (current: Tombstones | string[] | null): string[] => {
  if (Array.isArray(current)) return current.map(normalize).filter(Boolean);
  const ids = (current as Tombstones | null)?.ids;
  return Array.isArray(ids) ? ids.map(normalize).filter(Boolean) : [];
};

/** 지운 제안 id 를 묘비 목록에 적는다. 이미 있으면 아무것도 쓰지 않는다. */
export async function markProposalDeleted(proposalId: string): Promise<void> {
  const id = normalize(proposalId);
  if (!id) return;

  await mutateBlobJSON<Tombstones>(STORE, KEY, (current) => {
    const ids = toIdList(current);
    if (ids.includes(id)) return null;
    return { ids: [id, ...ids].slice(0, MAX_TOMBSTONES), updatedAt: new Date().toISOString() };
  });
}

/**
 * 지운 제안 id 집합. 읽기 경로에서 쓴다.
 *
 * 조회 한 번을 묘비 때문에 실패시키지 않는다 — 목록을 못 읽으면 빈 집합으로 돌아가,
 * 필터가 없던 예전과 같게 동작한다.
 */
export async function loadDeletedProposalIds(): Promise<Set<string>> {
  try {
    const store = getStore(STORE);
    const current = (await store.get(KEY, { type: "json" })) as Tombstones | string[] | null;
    return new Set(toIdList(current));
  } catch (err) {
    console.error("[proposal-tombstones] Failed to read tombstones:", err);
    return new Set<string>();
  }
}

/**
 * 제안 행 하나가 살아 있는가.
 *
 * 정산 행은 제안 id 를 `proposal_<id>` 로 감싸 들고 있어서, 그 접두어를 떼고도
 * 확인한다. 캠페인 협업(`campaign_<캠페인>_<인플루언서>`)은 제안 묘비와 무관하므로
 * 그대로 통과한다.
 */
export const isProposalAlive = (deleted: Set<string>, id: unknown): boolean => {
  const raw = normalize(id);
  if (!raw) return true;
  if (deleted.has(raw)) return false;
  if (raw.startsWith("proposal_") && deleted.has(raw.slice("proposal_".length))) return false;
  return true;
};
