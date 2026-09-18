/**
 * 메타 광고 계정 연동 — 광고 화면이 "누구의 광고인지"를 아는 자리.
 *
 * 광고 현황과 부스팅 창은 둘 다 메타 광고 계정 위에서 돌아간다. 지표를 읽는 것도,
 * 광고를 만드는 것도 계정 단위이기 때문에, 연동이 없으면 두 화면은 붙일 데이터가
 * 없는 상태다. 지금까지는 그 사실이 화면에 없어서 예시 숫자만 서 있었다.
 *
 * 그래서 연동 상태를 여기 한 군데에 둔다. 광고 현황이 연동/계정 선택을 하고,
 * 부스팅 창은 같은 값을 읽어 '연동 광고 계정' 을 채운다 — 두 화면이 각자 계정을
 * 기억하면 브랜드는 이력에서 A 계정으로 집행을 요청하고 광고 현황에서는 B 계정을
 * 보는 일이 생긴다.
 *
 * 아직 실제 OAuth 는 붙지 않았다(ads_management · ads_read · business_management
 * 심사 전). 연동 동작은 mock 으로 상태만 바꾸고, 계정 목록도 고정된 예시다. 심사가
 * 끝나면 바꿀 곳은 두 함수뿐이다 — connectMetaAccount() 를 OAuth 리다이렉트로,
 * listAdAccounts() 를 /me/adaccounts 응답으로. 화면은 그대로 둔다.
 *
 * 저장은 브라우저에만 한다. 이 값은 아직 계정의 데이터가 아니라 화면 확인용 임시
 * 기록이고, 실제 연동이 붙으면 토큰과 함께 서버에 남아야 하는 값이다 — 지금 테이블을
 * 먼저 만들어 두면 심사 후 실제 연동 정보와 두 갈래로 갈라진다(adBoosts 와 같은 이유).
 */

/** 심사 상태. 'approved' 만 실제로 데이터를 받을 수 있다. */
export type MetaPermissionStatus = 'approved' | 'pending';

export type MetaPermission = {
  label: string;
  /** 메타 앱 심사에서 쓰는 권한 이름 그대로 둔다 — 심사 화면과 같은 말이어야 한다. */
  scope: string;
  status: MetaPermissionStatus;
  /** 이 권한으로 무엇이 되는지. 권한 이름만 적으면 브랜드가 읽을 수 없다. */
  purpose: string;
};

/**
 * 연동 안내에 그대로 그리는 권한 목록.
 *
 * 인스타그램 인사이트만 승인된 상태다. 광고 쪽 세 개는 심사 대기 중이라, 연동을
 * 눌러도 광고 데이터는 아직 오지 않는다 — 그 사실을 목록 위에 먼저 적는다.
 */
export const META_PERMISSIONS: MetaPermission[] = [
  {
    label: '인스타그램 인사이트',
    scope: 'instagram_manage_insights',
    status: 'approved',
    purpose: '게시물·채널 지표 조회',
  },
  { label: '광고 관리', scope: 'ads_management', status: 'pending', purpose: '광고 생성·집행' },
  { label: '광고 조회', scope: 'ads_read', status: 'pending', purpose: '광고 지표 조회' },
  {
    label: '비즈니스 관리',
    scope: 'business_management',
    status: 'pending',
    purpose: '광고 계정·비즈니스 자산 접근',
  },
];

export type MetaAdAccount = {
  /** 메타 광고 계정 ID(act_ 접두어 포함). 실제 연동에서도 이 값이 키다. */
  id: string;
  name: string;
  /** 이 광고 계정이 매달린 비즈니스 관리자 이름. 같은 이름의 계정을 구분해 준다. */
  businessName: string;
  currency: string;
};

/**
 * 연동 전 화면 확인용 예시 계정. 실제 연동에서는 /me/adaccounts 응답으로 바뀐다.
 * 한 브랜드가 계정을 여러 개 들고 있는 경우(본사/서브 브랜드, 대행사 계정)를
 * 담아 둔다 — 계정이 하나면 드롭다운이 필요한 이유가 화면에 드러나지 않는다.
 */
export const MOCK_AD_ACCOUNTS: MetaAdAccount[] = [
  { id: 'act_1029384756', name: '픽스폴리오 메인 광고 계정', businessName: '픽스폴리오 비즈니스', currency: 'KRW' },
  { id: 'act_5647382910', name: '브랜드 서브 계정', businessName: '픽스폴리오 비즈니스', currency: 'KRW' },
  { id: 'act_8812930457', name: '신규 테스트 계정', businessName: '픽스폴리오 비즈니스', currency: 'KRW' },
];

export type MetaAdConnection = {
  connected: boolean;
  /** 연동 시각(ISO). 연동 설정 화면에서 언제 붙였는지 적어 준다. */
  connectedAt: string | null;
  /** 연동한 메타 계정 이름. 실제 연동에서는 /me 의 name 이 들어온다. */
  metaUserName: string | null;
  /** 고른 광고 계정. 연동만 하고 아직 고르지 않은 상태가 있어서 따로 둔다. */
  selectedAccountId: string | null;
};

const DISCONNECTED: MetaAdConnection = {
  connected: false,
  connectedAt: null,
  metaUserName: null,
  selectedAccountId: null,
};

const keyFor = (username: string) => `picks_meta_ad_connection_${username}`;

/** 같은 탭 안의 다른 화면(광고 현황 ↔ 부스팅 창)에 바뀐 것을 알린다. */
const CHANGED_EVENT = 'picks:meta-ad-connection-changed';

const notify = () => {
  try {
    window.dispatchEvent(new Event(CHANGED_EVENT));
  } catch {}
};

export const readAdConnection = (username: string): MetaAdConnection => {
  try {
    const raw = localStorage.getItem(keyFor(username));
    if (!raw) return DISCONNECTED;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.connected) return DISCONNECTED;
    const selectedAccountId =
      typeof parsed.selectedAccountId === 'string' &&
      MOCK_AD_ACCOUNTS.some((a) => a.id === parsed.selectedAccountId)
        ? parsed.selectedAccountId
        : null;
    return {
      connected: true,
      connectedAt: typeof parsed.connectedAt === 'string' ? parsed.connectedAt : null,
      metaUserName: typeof parsed.metaUserName === 'string' ? parsed.metaUserName : null,
      selectedAccountId,
    };
  } catch {
    return DISCONNECTED;
  }
};

const write = (username: string, next: MetaAdConnection): MetaAdConnection => {
  try {
    localStorage.setItem(keyFor(username), JSON.stringify(next));
  } catch {
    // 저장에 실패해도 화면은 바뀐 상태로 둔다 — 이 값은 화면 확인용이라 저장 실패를
    // 브랜드가 할 일로 바꿔 줄 방법이 없다. 새로고침하면 연동 전으로 돌아간다.
  }
  notify();
  return next;
};

/**
 * 메타 계정 연동.
 *
 * TODO(실제 OAuth): 심사가 끝나면 이 함수가 곧바로 상태를 바꾸는 대신 메타 로그인
 * 대화상자로 리다이렉트한다 —
 *   window.location.assign(
 *     'https://www.facebook.com/v21.0/dialog/oauth?client_id=…&redirect_uri=…' +
 *     '&scope=ads_management,ads_read,business_management,instagram_manage_insights' +
 *     '&state=…',
 *   )
 * 돌아온 code 는 서버(netlify/functions)에서 장기 토큰으로 바꿔 저장하고, 이 함수는
 * 그 결과를 받아 연동 상태로 둔다. 지금은 연동 후 화면을 확인할 수 있게 mock 으로
 * 바로 '연동됨' 으로 바꾼다.
 */
export const connectMetaAccount = (username: string): MetaAdConnection =>
  write(username, {
    connected: true,
    connectedAt: new Date().toISOString(),
    // 실제 연동에서는 메타에서 받은 사용자 이름이 들어온다.
    metaUserName: '픽스폴리오 비즈니스 관리자',
    // 연동만 한 상태로 둔다. 계정은 브랜드가 고르게 한다 — 첫 계정을 자동으로
    // 골라 두면 어느 계정을 보고 있는지 모른 채 숫자를 읽는다.
    selectedAccountId: null,
  });

/** 연동 해제. 실제 연동에서는 서버에 저장한 토큰도 같이 지운다. */
export const disconnectMetaAccount = (username: string): MetaAdConnection => {
  try {
    localStorage.removeItem(keyFor(username));
  } catch {}
  notify();
  return DISCONNECTED;
};

/** 광고 계정 선택. 연동이 없으면 아무것도 하지 않는다. */
export const selectAdAccount = (username: string, accountId: string): MetaAdConnection => {
  const current = readAdConnection(username);
  if (!current.connected) return current;
  return write(username, { ...current, selectedAccountId: accountId });
};

/** 연동 전에 돌려주는 빈 목록. 매번 새 배열을 만들면 화면이 의존성으로 쓰기 어렵다. */
const NO_ACCOUNTS: MetaAdAccount[] = [];

/**
 * 연동으로 쓸 수 있게 된 광고 계정 목록.
 *
 * TODO(실제 연동): GET /me/adaccounts?fields=id,name,currency,account_status,business
 * 응답을 이 모양으로 맞춰 돌려준다. 연동 전에는 목록이 비어 있어야 한다 — 계정을
 * 고를 수 있는 상태와 연동이 된 상태는 같은 것이다.
 */
export const listAdAccounts = (username: string): MetaAdAccount[] =>
  readAdConnection(username).connected ? MOCK_AD_ACCOUNTS : NO_ACCOUNTS;

export const findAdAccount = (accountId: string | null | undefined): MetaAdAccount | null =>
  (accountId && MOCK_AD_ACCOUNTS.find((a) => a.id === accountId)) || null;

/** 연동 상태가 바뀌면 다시 읽도록 구독한다. 다른 탭에서 바꾼 것도 받는다. */
export const subscribeAdConnection = (onChange: () => void): (() => void) => {
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
