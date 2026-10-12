/**
 * 글자 수를 잘라 저장할 때 쓰는 자르기.
 *
 * `String.slice(0, n)` 은 글자가 아니라 UTF-16 단위로 자른다. 이모지 하나는 두 단위
 * (서로게이트 쌍)라서, 마침 그 가운데에서 잘리면 짝 잃은 반쪽이 남는다. 그 문자열을
 * JSON.stringify 하면 `"\ud83c"` 가 되고, Postgres JSONB 는 이것을 받지 않아 행 전체
 * 저장이 실패한다 — 캡션 한 줄 때문에 팔로워·조회수·연동 표시까지 함께 사라진다.
 * (실제로 연동을 마친 인플루언서가 브랜드 매칭 명단에서 계속 "연동 필요"로 보였다.)
 *
 * 그래서 글자(코드 포인트) 단위로 자르고, 원문에 이미 섞여 온 짝 잃은 반쪽도 지운다.
 */
export function clipText(value: unknown, max: number): string {
  const chars = Array.from(String(value ?? ""));
  const clipped = chars.length > max ? chars.slice(0, max).join("") : chars.join("");
  return clipped.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
}
