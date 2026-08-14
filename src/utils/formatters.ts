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

/**
 * 사람 수·조회수를 짧게 줄인 표기(1,395 → 1,395 / 24,300 → 2.4만).
 *
 * 후보를 한 줄씩 쌓아 놓고 비교하는 목록에서 쓴다. 자릿수가 다른 숫자가 세로로
 * 늘어서면 "458"과 "45,800"이 같은 길이로 보여 한 눈에 크기 비교가 안 된다.
 * 만 단위로 접으면 자릿수 대신 단위가 보이므로 훑어 읽을 수 있다.
 *
 * 만 미만은 그대로 둔다 — 소수로 접어 봐야 짧아지지도 않고 정확도만 잃는다.
 * 접은 값은 어림수이므로, 쓰는 쪽에서 정확한 값을 title 로 함께 달아 준다.
 */
export const formatCountKo = (value: number | string | null | undefined): string => {
  const num = typeof value === 'string' ? Number(String(value).replace(/[^0-9]/g, '')) : Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '0';
  const short = (n: number) => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
  if (num >= 100000000) return `${short(num / 100000000)}억`;
  if (num >= 10000) return `${short(num / 10000)}만`;
  return formatNumberWithCommas(num);
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

/** 숫자만 남긴다. 전화번호·금액 입력에서 사람이 넣은 하이픈·콤마·공백을 걷어낼 때 쓴다. */
export const digitsOnly = (value: string | number | null | undefined): string =>
  String(value ?? '').replace(/[^0-9]/g, '');

/**
 * 사람이 적어 둔 금액 문장을 원 단위 숫자로 읽는다.
 *
 * 예전에는 단가·예산을 자유 입력으로 받아서 "30만원", "1억 2,000만원", "300000"이
 * 한 칸에 섞여 들어왔다. 그 값을 숫자로 쓰는 쪽(예산 정렬)은 숫자가 아닌 글자를
 * 지우고 읽었는데, 그러면 "500만원"이 500원이 된다 — 예산이 가장 큰 브랜드가 목록
 * 맨 아래로 내려갔다. 입력을 원 단위로 바꾼 뒤에도 예전에 적어 둔 값은 남아 있으므로,
 * 그것을 되읽을 때 여기서 단위를 풀어 준다.
 */
export const parseWonText = (value: string | number | null | undefined): number => {
  const raw = String(value ?? '').replace(/[\s,]/g, '');
  if (!raw) return 0;
  if (/[억만]/.test(raw)) {
    let total = 0;
    const eok = raw.match(/(\d+(?:\.\d+)?)억/);
    if (eok) total += Number(eok[1]) * 100000000;
    const man = raw.match(/(\d+(?:\.\d+)?)만/);
    if (man) total += Number(man[1]) * 10000;
    // '만' 뒤에 남은 자릿수("1억2,000만5,000원")까지 더한다.
    const rest = raw.match(/만(\d+)/);
    if (rest) total += Number(rest[1]);
    return Math.round(total);
  }
  const num = Number(digitsOnly(raw));
  return Number.isFinite(num) ? num : 0;
};

/**
 * 전화번호에 하이픈을 붙인다.
 *
 * 저장은 숫자만으로 하는 편이 낫다 — "010-1234-5678"과 "01012345678"이 섞이면 같은
 * 사람을 두 번 저장하게 된다. 대신 화면에서는 하이픈이 있어야 한다. 하이픈 없는 열한
 * 자리는 눈으로 끊어 읽어야 해서 옮겨 적을 때 틀린다.
 *
 * 국번 길이가 지역마다 다르므로 앞자리를 보고 끊는다. 서울(02)은 두 자리, 그 밖의
 * 지역번호와 휴대폰은 세 자리, 1588 같은 대표번호는 네 자리다. 어디에도 맞지 않는
 * 자릿수(입력 중인 번호나 해외 번호)는 손대지 않고 그대로 돌려준다 — 잘못 끊어 놓으면
 * 맞는 번호가 틀린 번호처럼 보인다.
 */
export const formatPhone = (value: string | number | null | undefined): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // 국제표기(+82…)는 우리가 끊을 규칙이 없다. 사람이 적은 그대로 둔다.
  if (raw.startsWith('+')) return raw;
  const d = digitsOnly(raw);
  if (!d) return raw;

  if (d.startsWith('02')) {
    if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    if (d.length === 10) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
    return raw;
  }
  // 15xx · 16xx · 18xx 대표번호는 지역번호가 없다.
  if (/^1[5678]\d{2}/.test(d) && d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
};

/**
 * 적는 도중에도 하이픈이 따라 붙는 형태.
 *
 * formatPhone 은 다 적은 번호를 보여 주는 쪽이라 자릿수가 안 맞으면 손대지 않는다.
 * 입력칸은 반대로 매 글자마다 반응해야 하므로, 지금까지 적은 만큼만 끊어 준다.
 * 숫자가 아닌 글자는 버리고 열한 자리에서 멈춘다 — 그 뒤는 눌러도 들어가지 않는다.
 */
export const formatPhoneInput = (value: string): string => {
  const d = digitsOnly(value).slice(0, 11);
  if (!d) return '';
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2, d.length - 4)}-${d.slice(d.length - 4)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
};

/**
 * 전화번호일 때만 하이픈을 붙인다.
 *
 * 연락처 칸 하나로 번호와 이메일을 함께 받는 자리가 있다. 거기에 formatPhone 을 그냥
 * 걸면 이메일에서 숫자만 뽑아내 엉뚱한 번호로 바꿔 버린다. 숫자·하이픈·공백·괄호로만
 * 이루어진 값일 때만 손대고, 나머지는 적은 그대로 둔다.
 */
export const formatContact = (value: string | null | undefined): string => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^[0-9()\-\s+]+$/.test(raw)) return raw;
  return formatPhone(raw);
};

