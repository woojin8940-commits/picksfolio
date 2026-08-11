import { getStore } from "@netlify/blobs";

/**
 * Blobs 문서 한 덩어리를 "읽고 → 고치고 → 다시 쓰는" 공통 패턴.
 *
 * `get` 후 `setJSON` 하는 코드는 두 요청이 겹치면 나중에 쓴 쪽이 앞선 변경을
 * 조용히 덮어쓴다(주문 두 건이 동시에 들어오면 한 건이 사라지는 식). 읽을 때
 * 받은 ETag 로 조건부 쓰기를 걸어, 그 사이 값이 바뀌었으면 최신 값으로 다시
 * 계산한다. `consistency: "strong"` 은 "읽은 값이 최신"만 보장하고 덮어쓰기는
 * 막지 못하므로 조건부 쓰기가 같이 필요하다.
 *
 * 배열 전용 버전은 collab-records.mts 의 `mutateRecords` 로, 이 함수를 감싼다.
 */

export class BlobWriteConflictError extends Error {
  constructor(key: string) {
    super(`Concurrent write conflict on "${key}"`);
    this.name = "BlobWriteConflictError";
  }
}

/**
 * @param mutate 현재 문서(없으면 null)를 받아 새 문서를 반환한다.
 *               null 을 반환하면 쓰지 않고 현재 값을 그대로 돌려준다.
 * @returns 저장된 문서(쓰지 않았으면 읽은 값)
 */
export async function mutateBlobJSON<T>(
  storeName: string,
  key: string,
  mutate: (current: T | null) => T | null,
  attempts = 5,
): Promise<T | null> {
  const store = getStore(storeName);

  for (let attempt = 0; attempt < attempts; attempt++) {
    const snapshot = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    const current = (snapshot?.data ?? null) as T | null;
    const next = mutate(current);
    if (next === null) return current;

    // etag 가 있으면 "내가 읽은 그 값일 때만" 쓰고, 없으면(문서 없음)
    // "아직 없을 때만" 쓴다. 조건이 깨지면 modified=false 로 돌아온다.
    //
    // `setJSON` 이 아니라 `set` + 직렬화를 쓰는 이유: 현재 `@netlify/blobs`
    // 버전의 `setJSON` 은 조건을 요청에 실어 보내지 않아 조건이 무시된 채 항상
    // 성공한다(즉 덮어쓰기 방지가 동작하지 않는다). `set` 은 조건을 제대로
    // 전달한다. 읽는 쪽은 `type: "json"` 으로 본문을 파싱하므로 저장 형식은
    // 달라지지 않는다.
    const body = JSON.stringify(next);
    const result = snapshot?.etag
      ? await store.set(key, body, { onlyIfMatch: snapshot.etag })
      : await store.set(key, body, { onlyIfNew: true });

    if (result.modified) return next;
  }

  throw new BlobWriteConflictError(key);
}
