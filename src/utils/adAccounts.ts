import { apiService } from '../services/apiService';
import type { MetaAdsDiagnosisPayload } from '../services/apiService';

/**
 * 메타 광고 계정 연동 — 광고 화면이 "누구의 광고인지"를 아는 자리.
 *
 * 광고 현황과 부스팅 창은 둘 다 메타 광고 계정 위에서 돌아간다. 지표를 읽는 것도,
 * 광고를 만드는 것도 계정 단위이기 때문에, 연동이 없으면 두 화면은 붙일 데이터가
 * 없는 상태다. 그래서 연동 상태를 여기 한 군데에 둔다.
 *
 * 예전에는 이 파일이 연동을 mock 으로 처리했다. 버튼을 누르면 localStorage 에
 * `connected: true` 를 적고 고정된 예시 계정 세 개를 돌려줬다 — 화면은 '연동됨' 이
 * 되지만 메타 쪽에는 아무 일도 없었고, 그 상태로 고른 광고 계정은 존재하지 않는
 * 계정이었다. 지금은 실제 페이스북 로그인 대화상자를 지나고(netlify/functions/
 * meta-ads-oauth-start · -callback), 화면이 보는 값은 서버가 메타에 물어본 결과다.
 *
 * 연동 상태를 브라우저에 적지 않는 이유가 그것이다 — 화면이 스스로 '연동됨' 을 쓸 수
 * 있으면 mock 시절의 문제가 그대로 돌아온다. 브라우저에 남는 것은 "이 브라우저에서
 * 어느 광고 계정을 보고 있는지" 하나뿐이고, 그 값도 서버가 돌려준 목록으로 검증한다.
 *
 * 토큰은 어디에도 저장하지 않는다. 광고 권한 심사 전이라 지금 연동의 목적은 진단까지고,
 * 콜백이 그 요청 안에서만 토큰을 쓰고 버린다.
 */

/** 심사·승인 상태. 'approved' 만 실제로 데이터를 받을 수 있다. */
export type MetaPermissionStatus = 'approved' | 'pending' | 'declined';

export type MetaPermission = {
  label: string;
  /** 메타 앱 심사에서 쓰는 권한 이름 그대로 둔다 — 심사 화면과 같은 말이어야 한다. */
  scope: string;
  status: MetaPermissionStatus;
  /** 이 권한으로 무엇이 되는지. 권한 이름만 적으면 브랜드가 읽을 수 없다. */
  purpose: string;
};

/**
 * 연동 안내에 그대로 그리는 권한 목록의 기본값(= 연동 전에 보이는 상태).
 *
 * 인스타그램 인사이트는 인스타그램 연동에서 이미 승인받은 권한이라 처음부터 승인됨으로
 * 둔다. 광고 쪽 세 개는 심사 대기 중이다. 연동을 마치면 이 상태는 실제 동의 결과
 * (`/me/permissions` 의 granted · declined)로 덮인다 — resolveMetaPermissions().
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
  /** 메타의 account_status(1 = 활성). 정지된 계정을 화면에서 구분할 수 있게 둔다. */
  accountStatus?: number;
};

/**
 * 광고 현황의 예시 광고가 매달려 있는 가상 계정.
 *
 * 광고 지표 권한 심사 전이라 목록의 숫자는 아직 예시다(그 사실은 화면에 적어 둔다).
 * 예시 광고도 계정을 나눠 두어야 "계정을 바꾸면 목록이 바뀐다"를 확인할 수 있어서
 * 남긴다. 연동해서 실제 계정이 생기면 광고 현황이 예시 광고를 그 계정들에 순서대로
 * 얹는다 — 이제 이 목록이 '연동된 계정' 으로 쓰이는 곳은 없다.
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
  /** 연동한 메타 계정 이름(/me 의 name). */
  metaUserName: string | null;
  /** 고른 광고 계정. 연동만 하고 아직 고르지 않은 상태가 있어서 따로 둔다. */
  selectedAccountId: string | null;
};

export type MetaAdDiagnosis = MetaAdsDiagnosisPayload;

const DISCONNECTED: MetaAdConnection = {
  connected: false,
  connectedAt: null,
  metaUserName: null,
  selectedAccountId: null,
};

const normalize = (username: string) => (username || '').replace(/^biz\//, '').toLowerCase().trim();

/** 고른 광고 계정만 브라우저에 남긴다. 연동 여부는 서버가 정한다. */
const selectionKey = (username: string) => `picks_meta_ad_selected_${normalize(username)}`;

/** 같은 탭 안의 다른 화면(광고 현황 ↔ 부스팅 창)에 바뀐 것을 알린다. */
const CHANGED_EVENT = 'picks:meta-ad-connection-changed';

const notify = () => {
  try {
    window.dispatchEvent(new Event(CHANGED_EVENT));
  } catch {}
};

/**
 * 서버에서 읽어 둔 진단 결과. 화면 두 곳(광고 현황·부스팅 창)이 같은 값을 봐야 하고,
 * 각자 요청하면 같은 것을 두 번 물어본다. 아직 읽지 않은 상태와 "읽었더니 연동 없음"
 * 은 다른 상태라 undefined / null 로 구분한다.
 */
const cache = new Map<string, MetaAdDiagnosis | null>();
const inflight = new Map<string, Promise<MetaAdDiagnosis | null>>();

export const readCachedDiagnosis = (username: string): MetaAdDiagnosis | null | undefined =>
  cache.get(normalize(username));

/** 진단 결과를 서버에서 읽어 온다. 이미 읽었으면 그 값을 그대로 쓴다(force 로 갱신). */
export const loadAdConnection = async (
  username: string,
  opts: { force?: boolean } = {},
): Promise<MetaAdDiagnosis | null> => {
  const key = normalize(username);
  if (!key) return null;
  if (!opts.force && cache.has(key)) return cache.get(key) ?? null;

  const existing = inflight.get(key);
  if (existing && !opts.force) return existing;

  const request = apiService
    .metaAdsConnection(key)
    .then((res) => {
      // 오류는 "연동 없음"과 다르다. 잠깐 끊긴 것이라면 다음 시도에서 살아나야 하므로
      // 캐시에 null 을 박아 두지 않는다 — 박아 두면 화면이 연동을 해제된 것으로 읽는다.
      if (res.error) throw new Error(res.error);
      cache.set(key, res.connection || null);
      notify();
      return res.connection || null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
};

/** 진단 결과를 화면이 쓰는 연동 상태로 옮긴다. */
export const toAdConnection = (
  username: string,
  diagnosis: MetaAdDiagnosis | null | undefined,
): MetaAdConnection => {
  if (!diagnosis || !diagnosis.connected) return DISCONNECTED;
  const accounts = diagnosis.accounts || [];
  let selected: string | null = null;
  try {
    const stored = localStorage.getItem(selectionKey(username));
    // 서버가 돌려준 목록에 있는 계정만 고른 상태로 인정한다. 계정이 회수되거나
    // 다른 메타 계정으로 다시 연동하면 예전에 고른 계정은 더 이상 존재하지 않는다.
    selected = stored && accounts.some((a) => a.id === stored) ? stored : null;
  } catch {
    selected = null;
  }
  return {
    connected: true,
    connectedAt: diagnosis.connectedAt || null,
    metaUserName: diagnosis.metaUserName || null,
    selectedAccountId: selected,
  };
};

/**
 * 메타 계정 연동 시작 — 실제 페이스북 로그인 대화상자로 이동한다.
 *
 * 서버에서 서명된 authorize URL 을 받아 그 주소로 이동한다. 서명 없는 링크를 화면이
 * 직접 만들면 임의의 사용자명으로 연동을 강제하는 CSRF 가 성립한다(그래서 URL 발급은
 * 인증된 POST 한 곳에서만 한다).
 *
 * 성공하면 이 함수는 돌아오지 않는다 — 브라우저가 facebook.com 으로 떠난다. 돌아오는
 * 경우는 시작하지 못한 경우뿐이라 오류만 돌려준다.
 */
export const startMetaAdConnect = async (
  username: string,
  returnTo?: string,
): Promise<{ error?: string }> => {
  const res = await apiService.metaAdsConnectUrl(normalize(username), returnTo);
  if (!res.url) return { error: res.error || '연동을 시작하지 못했습니다.' };
  window.location.assign(res.url);
  return {};
};

/**
 * 연동 해제 — 서버에 남은 진단 결과와 이 브라우저의 계정 선택을 지운다.
 *
 * 저장한 토큰이 없으므로 회수할 것이 없다. 메타 쪽 앱 권한까지 끊으려면 페이스북
 * 계정 설정에서 앱을 삭제해야 한다 — 화면에 그렇게 적어 둔다.
 */
export const disconnectMetaAccount = async (username: string): Promise<MetaAdConnection> => {
  const key = normalize(username);
  const ok = await apiService.metaAdsDisconnect(key);
  if (ok) {
    cache.set(key, null);
    try {
      localStorage.removeItem(selectionKey(username));
    } catch {}
    notify();
  }
  return ok ? DISCONNECTED : toAdConnection(username, cache.get(key));
};

/** 광고 계정 선택. 연동이 없으면 아무것도 하지 않는다. */
export const selectAdAccount = (username: string, accountId: string): MetaAdConnection => {
  const key = normalize(username);
  const diagnosis = cache.get(key);
  if (!diagnosis || !(diagnosis.accounts || []).some((a) => a.id === accountId)) {
    return toAdConnection(username, diagnosis);
  }
  try {
    localStorage.setItem(selectionKey(username), accountId);
  } catch {
    // 저장에 실패해도 이번 화면에서는 고른 계정으로 보여 준다. 새로고침하면 선택이
    // 풀리지만, 연동 자체는 서버에 남아 있어 다시 고르기만 하면 된다.
  }
  notify();
  return toAdConnection(username, diagnosis);
};

/** 연동으로 쓸 수 있게 된 광고 계정 목록(`/me/adaccounts` 응답). 연동 전에는 빈 목록이다. */
const NO_ACCOUNTS: MetaAdAccount[] = [];

export const listAdAccounts = (diagnosis: MetaAdDiagnosis | null | undefined): MetaAdAccount[] =>
  diagnosis?.connected && diagnosis.accounts?.length ? diagnosis.accounts : NO_ACCOUNTS;

export const findAdAccount = (
  accounts: MetaAdAccount[],
  accountId: string | null | undefined,
): MetaAdAccount | null => (accountId && accounts.find((a) => a.id === accountId)) || null;

/**
 * 권한 목록의 승인 상태를 실제 동의 결과로 덮는다.
 *
 * 출처는 콜백이 저장해 둔 `/me/permissions` 응답이다. 세 가지를 구별해야 한다 —
 * 승인(granted) · 사람이 동의 화면에서 끈 것(declined) · 그리고 요청은 했지만 답이
 * 없는 것(심사 전 앱에서 생기는 경우). 마지막은 대기중으로 남긴다.
 *
 * 인스타그램 인사이트는 이 동의 화면에서 요청하지 않는다(인스타그램 연동에서 받는다).
 * 메타가 그 권한에 대해 답을 준 경우에만 그 답을 쓰고, 아니면 기본값을 그대로 둔다.
 */
export const resolveMetaPermissions = (
  diagnosis: MetaAdDiagnosis | null | undefined,
): MetaPermission[] =>
  META_PERMISSIONS.map((base) => {
    if (!diagnosis?.connected) return base;
    if ((diagnosis.granted || []).includes(base.scope)) return { ...base, status: 'approved' };
    if ((diagnosis.declined || []).includes(base.scope)) return { ...base, status: 'declined' };
    if ((diagnosis.scopesRequested || []).includes(base.scope)) return { ...base, status: 'pending' };
    return base;
  });

/** 연동 상태가 바뀌면 다시 읽도록 구독한다. 다른 탭에서 바꾼 것도 받는다. */
export const subscribeAdConnection = (onChange: () => void): (() => void) => {
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
