/**
 * 콘텐츠 그리드(개인페이지의 큐레이션 카드)에서 카드가 놓이는 자리를 정하는 곳.
 *
 * 편집기에서 고르는 값은 "1칸 · 2칸 · 3칸"(한 줄에 몇 개를 늘어놓을지)이다. 예전에는
 * 여섯 칸 트랙에 span 6 · 3 · 2 로 얹고 브라우저의 `grid-auto-flow: dense` 에 배치를
 * 맡겼는데, 넓은 화면에서 두 가지가 어색했다.
 *
 *  1. 줄이 다 채워지지 않으면 카드가 왼쪽에 몰리고 오른쪽이 빈 채로 남았다. 카드가
 *     하나뿐인 페이지에서 특히 두드러진다 — 절반 폭 카드 하나가 왼쪽에 붙고 나머지
 *     절반은 아무것도 없는 빈 칸이 된다.
 *  2. dense 는 뒤에 있는 작은 카드를 앞 줄의 빈 자리로 끌어올린다. 편집기에서 정한
 *     순서와 공개 페이지의 순서가 달라지는 이유가 이것이었다.
 *
 * 그래서 배치를 여기서 직접 계산한다. 카드는 정한 순서대로 줄에 담고(끌어올리지
 * 않는다), 덜 찬 줄은 남는 칸을 좌우로 나눠 가운데에 놓는다.
 *
 * 한 줄은 12칸이다. 6칸이던 예전에는 절반 카드 하나가 남긴 3칸을 좌우로 나눌 수 없어
 * (1.5칸) 가운데 맞춤이 불가능했다. 12칸이면 1칸=12 · 2칸=6 · 3칸=4 이므로 어떤
 * 조합이든 남는 칸이 짝수로 떨어진다.
 *
 * 공개 페이지(UserPage)와 편집기의 미리보기(PagePreview)가 같은 답을 써야 한다 —
 * 한쪽만 고치면 미리보기와 실제 페이지의 배치가 달라진다.
 */

/** 한 줄의 칸 수. */
export const GRID_TRACKS = 12;

/** 배치 계산에 필요한 만큼만 본 카드. */
export interface GridBlockLike {
  id: string;
  displayType?: string;
  colSpan?: number;
}

export interface GridPlacement {
  /** 1부터 세는 시작 칸(`grid-column-start`). */
  colStart: number;
  /** 차지하는 칸 수. */
  span: number;
}

/**
 * 카드 하나가 차지하는 칸 수.
 *
 * 그리드 형식이 아닌 카드(미니멀 · 텍스트)는 칸 선택이 없으므로 항상 한 줄을 통째로
 * 쓴다 — 예전 구현과 같은 규칙이다.
 */
export function blockTrackSpan(block: GridBlockLike): number {
  if ((block.displayType || 'grid') !== 'grid') return GRID_TRACKS;
  const colSpan = block.colSpan || 1;
  if (colSpan === 2) return GRID_TRACKS / 2;
  if (colSpan === 3) return GRID_TRACKS / 3;
  return GRID_TRACKS;
}

/**
 * 카드 목록을 순서대로 줄에 담고, 각 카드의 시작 칸을 돌려준다.
 *
 * 돌려주는 값은 `id → 자리` 지도다. 그리는 쪽은 목록을 그대로 순회하면서 자기 자리만
 * 찾아 쓰면 된다. 지도에 없는 카드는(있을 수 없지만) 한 줄 전체로 그리면 안전하다.
 */
export function packGridPlacements(blocks: GridBlockLike[]): Map<string, GridPlacement> {
  const placements = new Map<string, GridPlacement>();
  let row: Array<{ id: string; span: number }> = [];
  let used = 0;

  const flushRow = () => {
    if (row.length === 0) return;
    // 남는 칸의 절반만큼 오른쪽으로 밀어 줄을 가운데에 둔다. 꽉 찬 줄은 0 이므로
    // 예전과 똑같이 왼쪽 끝에서 시작한다.
    let cursor = 1 + Math.floor((GRID_TRACKS - used) / 2);
    for (const item of row) {
      placements.set(item.id, { colStart: cursor, span: item.span });
      cursor += item.span;
    }
    row = [];
    used = 0;
  };

  for (const block of blocks) {
    const span = blockTrackSpan(block);
    if (used + span > GRID_TRACKS) flushRow();
    row.push({ id: block.id, span });
    used += span;
    if (used >= GRID_TRACKS) flushRow();
  }
  flushRow();

  return placements;
}
