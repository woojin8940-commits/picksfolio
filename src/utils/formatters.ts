/**
 * 오늘 날짜(Asia/Seoul)를 'YYYY-MM-DD'로 반환.
 *
 * `new Date().toISOString().split('T')[0]` 은 UTC 기준이라 한국 시간 오전 9시
 * 이전에는 어제 날짜가 나온다. 화면의 "오늘"은 항상 한국 기준이어야 한다.
 */
export const todayInSeoul = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

export const formatNumberWithCommas = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const numbers = String(value).replace(/[^0-9]/g, '');
  if (!numbers) return '';
  return numbers.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const stripCommas = (value: string): string => {
  return value.replace(/[^0-9]/g, '');
};

export const formatKRW = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) return '0원';
  const num = typeof value === 'string' ? Number(value.replace(/[^0-9]/g, '')) : value;
  if (isNaN(num)) return '0원';
  return `${formatNumberWithCommas(num)}원`;
};

/**
 * 부호를 살린 금액. 마진처럼 음수가 나올 수 있는 값에 쓴다.
 *
 * formatKRW 는 숫자만 남기고 부호를 버리므로 -50000 이 "50,000원"으로 찍힌다.
 * 손해가 이익으로 보이는 자리라서, 그 자리만은 부호를 직접 붙인다.
 */
export const formatSignedKRW = (value: number | null | undefined): string => {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num === 0) return '0원';
  return `${num < 0 ? '-' : '+'}${formatNumberWithCommas(Math.abs(Math.round(num)))}원`;
};

// PortOne V2 requires paymentId / issueId / customerId to contain ASCII characters only.
// Korean (or any non-ASCII) usernames must be encoded before embedding in those IDs.
export const toAsciiSafeId = (s: string): string =>
  s.replace(/[^\x00-\x7F]/g, (ch) => `_${(ch.codePointAt(0) ?? 0).toString(36)}`);

export const formatKoreanWon = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'string' ? Number(String(value).replace(/[^0-9]/g, '')) : value;
  if (isNaN(num) || num === 0) return '0원';
  const eok = Math.floor(num / 100000000);
  const man = Math.floor((num % 100000000) / 10000);
  const rest = num % 10000;
  let result = '';
  if (eok > 0) result += `${eok}억`;
  if (man > 0) result += `${man}만`;
  if (rest > 0) result += `${formatNumberWithCommas(rest)}`;
  return result + '원';
};
