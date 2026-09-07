/**
 * 공개 페이지 상단의 기본 버튼.
 *
 * 예전에는 상단 버튼이 "비즈니스 제안" 하나와, 인플루언서가 직접 이름·주소·색을
 * 정하는 커스텀 버튼뿐이었다. 그런데 거의 모든 사람이 만드는 첫 버튼은 정해져
 * 있었다 — 카카오톡 · 유튜브 · 틱톡 · 네이버. 매번 이름을 적고 색을 고르게 하면
 * 사람마다 "유튜브" / "YouTube" / "유튜브 채널" 로 갈리고, 색도 제각각이 되어
 * 페이지마다 버튼 줄이 다르게 생긴다.
 *
 * 그래서 이 네 개는 주소만 넣으면 나오는 기본 버튼으로 둔다. 로고와 주소 형식은
 * 여기서 정하고, 인플루언서는 주소만 넣는다. 여전히 특별한 버튼이 필요하면 커스텀
 * 버튼을 쓴다(두 방식은 함께 쓸 수 있다).
 *
 * 이름은 플랫폼이 정해 두지 않는다. 로고는 어느 플랫폼인지 알려 주지만 "카카오톡"
 * 이라고만 적혀 있으면 그 안의 어떤 채널인지 — 공지 채널인지, 공동구매 오픈챗인지,
 * 상담 창구인지 — 누르기 전에 알 수 없었다. 그래서 이름은 인플루언서가 바꿀 수 있게
 * 두고, 여기 적은 값은 아무것도 적지 않았을 때 쓰는 기본값이다.
 *
 * 저장 위치는 새로 만들지 않았다. socials 에 이미 kakao / youtube / tiktok / naver
 * 칸이 있었고(연동용으로 만들어 두고 화면에서 쓰지 않던 값이다), 값이 비어 있으면
 * 버튼을 그리지 않는다 — 별도의 on/off 플래그를 두면 "주소는 있는데 꺼져 있음"
 * 같은 상태가 생겨 왜 안 나오는지 알 수 없게 된다. 이름도 같은 자리에 kakaoLabel
 * 처럼 나란히 둔다(socials 는 자유 형식 JSON 이라 칸을 늘려도 마이그레이션이
 * 필요하지 않다).
 */

export type DefaultButtonKey = 'kakao' | 'youtube' | 'tiktok' | 'naver';

export type DefaultButtonDef = {
  key: DefaultButtonKey;
  /** 이름을 적지 않았을 때 쓰는 기본 이름. */
  label: string;
  /** 편집 화면의 주소 입력칸 안내 문구. */
  placeholder: string;
};

export const DEFAULT_BUTTONS: DefaultButtonDef[] = [
  { key: 'kakao', label: '카카오톡', placeholder: 'pf.kakao.com/@채널이름 또는 오픈채팅 주소' },
  { key: 'youtube', label: '유튜브', placeholder: 'youtube.com/@채널' },
  { key: 'tiktok', label: '틱톡', placeholder: 'tiktok.com/@아이디' },
  { key: 'naver', label: '네이버', placeholder: 'blog.naver.com/아이디 또는 스마트스토어 주소' },
];

/** 이름이 저장되는 socials 칸. 주소 칸(`kakao`) 옆의 `kakaoLabel`. */
export const buttonLabelKey = (key: DefaultButtonKey): string => `${key}Label`;

/**
 * 화면에 그릴 버튼 이름.
 *
 * 인플루언서가 적은 이름이 있으면 그것을, 비웠으면 플랫폼 기본 이름을 쓴다 — 이름을
 * 지웠다고 이름 없는 버튼(로고만 있는 칸)이 되면 무슨 버튼인지 더 알 수 없어진다.
 */
export const resolveButtonLabel = (
  socials: Record<string, any> | null | undefined,
  key: DefaultButtonKey,
): string => {
  const custom = String(socials?.[buttonLabelKey(key)] ?? '').trim();
  if (custom) return custom;
  return DEFAULT_BUTTONS.find(def => def.key === key)?.label ?? key;
};

/**
 * 주소 없이 아이디만 적었을 때 채워 줄 채널 홈.
 *
 * 안내 문구에 도메인을 적어 두어도 "@내채널" 처럼 아이디만 넣는 사람이 많다.
 * 예전에는 카카오톡만 이걸 받아 주고 나머지는 https:// 만 붙였는데, 그러면
 * "@me" 가 "https://@me" 가 된다 — 주소 꼴은 맞아서 저장은 되지만 어디에도
 * 닿지 않으니, 버튼을 눌러도 아무 일이 없는 것처럼 보였다.
 *
 * 넘겨받는 값은 사람이 적은 그대로다(`@` 를 떼지 않는다). 예전에는 여기 오기 전에
 * `@` 를 먼저 떼어 냈는데, 유튜브·틱톡은 자기 주소를 만들 때 `@` 를 다시 붙이니
 * 문제가 없었지만 카카오톡은 붙이지 않았다. 그래서 카카오톡만 결과가
 * `https://pf.kakao.com/내채널` — 카카오가 알지 못하는 주소라 눌러도 채널로
 * 가지 않았다. `@` 를 떼는 일은 각 플랫폼이 자기 주소 형식에 맞게 처리한다.
 */
const HANDLE_HOME: Record<DefaultButtonKey, (handle: string) => string> = {
  // 카카오톡 채널 홈은 두 가지 꼴만 받는다 — 채널 공개 ID(`_xXxXx`)와 검색용
  // 이름(`@내채널`). `_` 로 시작하면 공개 ID 그대로, 아니면 `@` 를 붙인다.
  kakao: handle => `https://pf.kakao.com/${handle.startsWith('_') ? handle : `@${handle.replace(/^@/, '')}`}`,
  youtube: handle => `https://www.youtube.com/@${handle.replace(/^@/, '')}`,
  tiktok: handle => `https://www.tiktok.com/@${handle.replace(/^@/, '')}`,
  naver: handle => `https://blog.naver.com/${handle.replace(/^@/, '')}`,
};

/**
 * 붙여 넣은 카카오톡 주소 다듬기.
 *
 * 카카오톡 채널 관리자에서 주소를 복사해 오면 대개 제대로 된 주소지만, 채널
 * 이름만 손으로 이어 붙여 `pf.kakao.com/내채널` 로 저장해 둔 값도 있다. 그
 * 주소는 카카오에 없어서 열리지 않으므로, 경로가 이름 한 칸뿐이고 `@` 도 `_` 도
 * 없을 때만 `@` 를 붙여 준다(뒤에 /chat, /posts 같은 칸이 더 붙은 주소는
 * 사람이 실제로 복사해 온 주소이므로 건드리지 않는다).
 *
 * http 로 저장된 카카오 주소는 https 로 올린다 — 카카오가 어차피 https 로
 * 넘기고, 인앱 브라우저는 http 요청을 아예 막는 경우가 있다.
 */
const repairKakaoUrl = (url: string): string => {
  let value = url.replace(/^http:\/\//i, 'https://');
  const match = value.match(/^(https:\/\/pf\.kakao\.com\/)([^/?#]+)$/i);
  if (match && !/^[@_]/.test(match[2])) {
    value = `${match[1]}@${match[2]}`;
  }
  return value;
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
  const finish = (url: string) => (key === 'kakao' ? repairKakaoUrl(url) : url);
  if (/^https?:\/\//i.test(value)) return finish(value);
  if (!value.includes('.') && !value.includes('/')) {
    return HANDLE_HOME[key](value);
  }
  return finish(`https://${value.replace(/^\/+/, '')}`);
};

/** 값이 들어 있는 기본 버튼만, 정해진 순서대로. 이름은 인플루언서가 적은 것으로. */
export const enabledDefaultButtons = (
  socials: Record<string, any> | null | undefined,
): Array<DefaultButtonDef & { url: string }> =>
  DEFAULT_BUTTONS
    .map(def => ({
      ...def,
      label: resolveButtonLabel(socials, def.key),
      url: normalizeButtonUrl(def.key, String(socials?.[def.key] ?? '')),
    }))
    .filter(b => !!b.url);
