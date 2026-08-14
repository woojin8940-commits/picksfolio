/**
 * 탭별 계정 슬롯.
 *
 * 한 브라우저에서 일반 유저 · 비즈니스 · 운영자를 동시에 열어 두고 쓰려면 각
 * 로그인이 서로를 덮지 않아야 한다. 비즈니스 로그인은 이미 `picks_business_*`
 * 라는 자기 키를 쓰지만, 일반 유저와 운영자는 `picks_user_session` 과 Supabase
 * 세션(`sb-<ref>-auth-token`)을 그대로 나눠 써서 나중에 로그인한 쪽이 먼저
 * 로그인한 쪽을 밀어냈다. 새로고침하면 그 탭은 남의 계정이 되거나 아예
 * 로그아웃돼 보였다.
 *
 * 그래서 탭마다 슬롯을 하나 정해 둔다. 슬롯은 sessionStorage 에 있으므로 탭마다
 * 다르고 새로고침에는 살아남는다. 기본 슬롯(`user`)은 예전 키 이름을 그대로 쓰고,
 * 다른 슬롯만 키 뒤에 `@@슬롯` 을 붙인다. 덕분에 이미 로그인해 둔 사람이 이 변경
 * 때문에 로그아웃되지 않는다.
 *
 * 비즈니스 키는 일부러 슬롯을 나누지 않았다 — 이름이 이미 겹치지 않고, 나누면
 * 지금 로그인해 있는 비즈니스 계정이 한 번 풀리기 때문이다. 대신 다른 계정의
 * 정리 로직이 비즈니스 키를 지우지 않도록 App 쪽에서 항상 제외한다.
 */

export type AccountScope = 'user' | 'operator';

const TAB_SCOPE_KEY = 'picks_account_scope';
const SCOPE_MARK = '@@';
const DEFAULT_SCOPE: AccountScope = 'user';

let cached: AccountScope | null = null;

const isScope = (value: unknown): value is AccountScope =>
  value === 'user' || value === 'operator';

/** 이 탭이 쓰는 계정 슬롯. */
export function getAccountScope(): AccountScope {
  if (cached) return cached;
  try {
    const stored = sessionStorage.getItem(TAB_SCOPE_KEY);
    cached = isScope(stored) ? stored : DEFAULT_SCOPE;
  } catch {
    cached = DEFAULT_SCOPE;
  }
  return cached;
}

/** 이 탭의 슬롯을 정한다. 실제로 바뀌었으면 true. */
export function setAccountScope(scope: AccountScope): boolean {
  const previous = getAccountScope();
  cached = scope;
  try {
    if (scope === DEFAULT_SCOPE) sessionStorage.removeItem(TAB_SCOPE_KEY);
    else sessionStorage.setItem(TAB_SCOPE_KEY, scope);
  } catch {
    // 저장하지 못해도 이번 페이지 동안은 메모리 값으로 동작한다.
  }
  return previous !== scope;
}

/** `@@슬롯` 꼬리표를 뗀 원래 키 이름. */
export function baseKey(key: string): string {
  const at = key.lastIndexOf(SCOPE_MARK);
  if (at < 0) return key;
  return isScope(key.slice(at + SCOPE_MARK.length)) ? key.slice(0, at) : key;
}

/** 저장된 키가 어느 슬롯의 것인지. 꼬리표가 없으면 기본 슬롯이다. */
export function scopeOfKey(key: string): AccountScope {
  const at = key.lastIndexOf(SCOPE_MARK);
  if (at < 0) return DEFAULT_SCOPE;
  const tail = key.slice(at + SCOPE_MARK.length);
  return isScope(tail) ? tail : DEFAULT_SCOPE;
}

/** 이 탭 슬롯에서 쓸 실제 저장소 키 이름. */
export function scopedKey(key: string, scope: AccountScope = getAccountScope()): string {
  const base = baseKey(key);
  return scope === DEFAULT_SCOPE ? base : `${base}${SCOPE_MARK}${scope}`;
}

/** 이 키가 지금 탭 슬롯의 것인지. */
export function isOwnKey(key: string, scope: AccountScope = getAccountScope()): boolean {
  return scopeOfKey(key) === scope;
}

export function sessionGet(key: string): string | null {
  try {
    return localStorage.getItem(scopedKey(key));
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string): void {
  try {
    localStorage.setItem(scopedKey(key), value);
  } catch {
    // 저장 실패(사파리 프라이빗 등)는 로그인 자체를 막지 않는다.
  }
}

export function sessionRemove(key: string): void {
  try {
    localStorage.removeItem(scopedKey(key));
  } catch {
    // 무시
  }
}

/**
 * 이 탭 슬롯이 소유한 `picks_` 키들. 로그아웃·계정 전환 때 저장소를 청소하는 쪽이
 * 쓴다. 다른 슬롯(=다른 탭에 열려 있는 계정)의 키와 `keep` 에 준 키는 빠진다.
 */
export function ownPicksKeys(keep: string[] = []): string[] {
  try {
    return Object.keys(localStorage).filter(
      (key) => key.startsWith('picks_') && isOwnKey(key) && !keep.includes(baseKey(key)),
    );
  } catch {
    return [];
  }
}

/** 이 탭 슬롯이 소유한 Supabase 인증 키들. */
export function ownSupabaseKeys(): string[] {
  try {
    return Object.keys(localStorage).filter(
      (key) => (key.startsWith('sb-') || key.includes('supabase.auth')) && isOwnKey(key),
    );
  } catch {
    return [];
  }
}

/** 이 탭 슬롯에 Supabase 세션이 저장돼 있는지. */
export function hasOwnSupabaseSession(): boolean {
  try {
    return Object.keys(localStorage).some(
      (key) => isOwnKey(key) && /^sb-.*-auth-token$/.test(baseKey(key)),
    );
  } catch {
    return false;
  }
}

/**
 * sessionStorage 를 비우되 이 탭의 슬롯 표시는 남긴다.
 *
 * 로그아웃은 탭 안의 임시 상태를 모두 지우지만, 슬롯까지 지우면 운영자 탭이
 * 기본 슬롯으로 돌아가 다른 탭에 로그인해 둔 일반 계정을 그대로 읽어 버린다.
 */
export function clearTabStateKeepScope(): void {
  const scope = getAccountScope();
  try {
    sessionStorage.clear();
  } catch {
    // 무시
  }
  cached = null;
  setAccountScope(scope);
}

/**
 * Supabase 클라이언트가 쓸 저장소. 키 이름은 항상 "지금" 탭 슬롯으로 옮겨 적는다.
 * 로그인 도중 슬롯이 바뀌어도(일반 → 운영자) 토큰이 새 슬롯에 저장되므로,
 * 새로고침하면 그 탭은 자기 계정으로 되살아난다.
 */
export const scopedAuthStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(scopedKey(key));
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(scopedKey(key), value);
    } catch {
      // 무시
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(scopedKey(key));
    } catch {
      // 무시
    }
  },
};

/**
 * Supabase 클라이언트를 만들 때 줄 storageKey. 슬롯별로 이름이 달라야 탭 사이의
 * BroadcastChannel(이름이 곧 storageKey 다) 이 갈라져서, 운영자 탭의 로그인
 * 이벤트가 일반 유저 탭으로 넘어가지 않는다.
 */
export function authStorageKey(base: string): string {
  return scopedKey(base);
}
