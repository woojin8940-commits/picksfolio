/**
 * 목록 커서(최신순 · created_at DESC, id DESC) 공용 처리.
 *
 * 페이지 번호(OFFSET) 대신 "마지막으로 본 항목의 (시각, id)" 다음부터 가져온다. 보는 도중에 항목이
 * 추가 · 삭제돼도 같은 항목이 두 번 나오거나 건너뛰지 않고, 뒤 페이지로 갈수록 느려지지 않는다.
 *
 *   요청: ?cursorAt=<ISO 시각>&cursorId=<id>   (둘 다 있어야 커서로 본다)
 *   응답: { hasMore, nextCursor: { cursorAt, cursorId } | null }
 *
 * 쿼리는 LIMIT pageSize + 1 로 한 건 더 읽어 다음 페이지가 있는지 본다.
 */

export interface ListCursor { cursorAt: string; cursorId: string }

export function readCursor(url: URL) {
  const cursorId = String(url.searchParams.get("cursorId") ?? "").trim().slice(0, 120);
  const raw = String(url.searchParams.get("cursorAt") ?? "").trim().slice(0, 60);
  const time = Date.parse(raw);
  const hasCursor = !!cursorId && Number.isFinite(time);
  return {
    hasCursor,
    /** 커서가 없을 때도 SQL 에 넘길 수 있는 값(조건에서 NOT hasCursor 로 무시된다). */
    cursorAt: hasCursor ? new Date(time).toISOString() : "1970-01-01T00:00:00.000Z",
    cursorId: hasCursor ? cursorId : "",
  };
}

/** pageSize + 1 건을 읽은 결과를 잘라 다음 커서를 만든다. at = 정렬 기준 시각. */
export function pageOf<T extends { id: unknown }>(rows: T[], pageSize: number, at: (row: T) => unknown) {
  const page = rows.slice(0, pageSize);
  const last = page[page.length - 1];
  const hasMore = rows.length > pageSize;
  const nextCursor: ListCursor | null = hasMore && last
    ? { cursorAt: new Date(at(last) as string).toISOString(), cursorId: String(last.id) }
    : null;
  return { page, hasMore, nextCursor };
}
