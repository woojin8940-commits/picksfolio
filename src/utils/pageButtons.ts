/**
 * 공개 페이지 상단의 기본 버튼.
 *
 * 예전에는 상단 버튼이 "비즈니스 제안" 하나와, 인플루언서가 직접 이름·주소·색을
 * 정하는 커스텀 버튼뿐이었다. 그런데 거의 모든 사람이 만드는 첫 버튼은 정해져
 * 있었다 — 카카오톡 · 유튜브 · 틱톡 · 네이버. 매번 이름을 적고 색을 고르게 하면
 * 사람마다 "유튜브" / "YouTube" / "유튜브 채널" 로 갈리고, 색도 제각각이 되어
 * 페이지마다 버튼 줄이 다르게 생긴다.
 *
 * 그래서 이 네 개는 주소만 넣으면 나오는 기본 버튼으로 둔다. 이름·아이콘은 여기서
 * 정하고, 인플루언서는 주소만 넣는다. 여전히 특별한 버튼이 필요하면 커스텀 버튼을
 * 쓴다(두 방식은 함께 쓸 수 있다).
 *
 * 저장 위치는 새로 만들지 않았다. socials 에 이미 kakao / youtube / tiktok / naver
 * 칸이 있었고(연동용으로 만들어 두고 화면에서 쓰지 않던 값이다), 값이 비어 있으면
 * 버튼을 그리지 않는다 — 별도의 on/off 플래그를 두면 "주소는 있는데 꺼져 있음"
 * 같은 상태가 생겨 왜 안 나오는지 알 수 없게 된다.
 */

export type DefaultButtonKey = 'kakao' | 'youtube' | 'tiktok' | 'naver';

export type DefaultButtonDef = {
  key: DefaultButtonKey;
  label: string;
  /** 편집 화면의 입력칸 안내 문구. */
  placeholder: string;
};

export const DEFAULT_BUTTONS: DefaultButtonDef[] = [
  { key: 'kakao', label: '카카오톡', placeholder: 'pf.kakao.com/_채널ID 또는 오픈채팅 주소' },
  { key: 'youtube', label: '유튜브', placeholder: 'youtube.com/@채널' },
  { key: 'tiktok', label: '틱톡', placeholder: 'tiktok.com/@아이디' },
  { key: 'naver', label: '네이버', placeholder: 'blog.naver.com/아이디 또는 스마트스토어 주소' },
];

/**
 * 주소 없이 아이디만 적었을 때 채워 줄 채널 홈.
 *
 * 안내 문구에 도메인을 적어 두어도 "@내채널" 처럼 아이디만 넣는 사람이 많다.
 * 예전에는 카카오톡만 이걸 받아 주고 나머지는 https:// 만 붙였는데, 그러면
 * "@me" 가 "https://@me" 가 된다 — 주소 꼴은 맞아서 저장은 되지만 어디에도
 * 닿지 않으니, 버튼을 눌러도 아무 일이 없는 것처럼 보였다.
 */
const HANDLE_HOME: Record<DefaultButtonKey, (handle: string) => string> = {
  kakao: handle => `https://pf.kakao.com/${handle}`,
  youtube: handle => `https://www.youtube.com/@${handle}`,
  tiktok: handle => `https://www.tiktok.com/@${handle}`,
  naver: handle => `https://blog.naver.com/${handle}`,
};

/**
 * 입력값을 열 수 있는 주소로 만든다.
 *
 * 인플루언서는 주소를 복사해 오기도 하고("https://youtube.com/@me") 아이디만
 * 적기도 한다("@me"). https:// 를 안 붙이면 브라우저가 상대 경로로 읽어
 * /picks/youtube.com 같은 곳으로 가 버린다.
 *
 * 점도 슬래시도 없는 값은 도메인이 아니라 아이디로 본다 — 그때는 위의 채널 홈
 * 주소로 만들어 준다.
 */
export const normalizeButtonUrl = (key: DefaultButtonKey, raw: string): string => {
  const value = (raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.includes('.') && !value.includes('/')) {
    return HANDLE_HOME[key](value.replace(/^@/, ''));
  }
  return `https://${value.replace(/^\/+/, '')}`;
};

/** 값이 들어 있는 기본 버튼만, 정해진 순서대로. */
export const enabledDefaultButtons = (
  socials: Record<string, any> | null | undefined,
): Array<DefaultButtonDef & { url: string }> =>
  DEFAULT_BUTTONS
    .map(def => ({ ...def, url: normalizeButtonUrl(def.key, String(socials?.[def.key] ?? '')) }))
    .filter(b => !!b.url);
