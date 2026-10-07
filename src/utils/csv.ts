/**
 * CSV 칸 하나.
 *
 * 내려받는 표에는 다른 사람이 적은 값(이름 · 주소 · 요청사항 · 메모)이 들어간다. 엑셀은
 * `=`, `+`, `-`, `@` 로 시작하는 칸을 수식으로 실행하므로, 그런 값은 앞에 작은따옴표를
 * 붙여 글자로 남긴다. 나머지는 따옴표로 감싸고 안의 따옴표를 겹쳐 쓴다.
 */
export const csvCell = (value: unknown): string => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
