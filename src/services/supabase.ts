
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// NOTE: anon keys are safe to ship in client bundles by design — actual access
// control must come from RLS policies on the Supabase side. Even so, prefer
// reading from environment variables so the project can rotate keys without
// a code change. The fallback keeps existing builds working until the env
// vars are configured in Netlify.
const FALLBACK_SUPABASE_URL = 'https://rjksilpewohjvtbxrsvu.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqa3NpbHBld29oanZ0Ynhyc3Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjQ1NTMsImV4cCI6MjA4NzE0MDU1M30.CI7tbV4J7r2gpX6Ac6XdbOgutQlb01uR85CU9Jff0Dc';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || FALLBACK_SUPABASE_URL;
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || FALLBACK_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

// In-process fallback lock: serializes concurrent calls within this tab without
// blocking on other tabs. Used when navigator.locks is unavailable or deadlocks.
const inProcessLockQueues = new Map<string, Promise<unknown>>();
async function inProcessLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const previous = inProcessLockQueues.get(name) || Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  inProcessLockQueues.set(name, previous.then(() => next));
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (inProcessLockQueues.get(name) === previous.then(() => next)) {
      // best-effort cleanup; Map retains most-recent pointer
    }
  }
}

/**
 * Resilient Supabase auth lock.
 *
 * The default `navigatorLock` tries to take an exclusive Navigator LockManager
 * lock across all tabs of the same origin. When a background tab holds the
 * lock (e.g. stuck on a slow network, hidden tab paused by the browser), the
 * foreground tab's `_acquireLock` waits 10s and then throws
 *   "Acquiring an exclusive Navigator LockManager lock ... timed out waiting 10000ms"
 * which aborts session initialization and leaves the app unauthenticated.
 *
 * We:
 *   1. Race the navigator lock against a shorter timeout (4s).
 *   2. On timeout (or when navigator.locks is unavailable, e.g. private mode
 *      / older Safari), fall back to an in-process lock so calls within this
 *      tab still serialize but we don't block on sibling tabs.
 *
 * This trades strict cross-tab token-refresh serialization for availability —
 * acceptable because the auth server itself is the source of truth and a
 * double-refresh is harmless beyond one wasted request.
 */
const resilientLock = async <R,>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => {
  const hasNavigatorLocks =
    typeof navigator !== 'undefined' &&
    typeof (navigator as any).locks !== 'undefined' &&
    typeof (navigator as any).locks.request === 'function';

  if (!hasNavigatorLocks) {
    return inProcessLock(name, acquireTimeout, fn);
  }

  const effectiveTimeout = Math.min(acquireTimeout || 4000, 4000);

  return new Promise<R>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      console.warn(
        `[Supabase] Navigator LockManager timeout on "${name}" after ${effectiveTimeout}ms — falling back to in-process lock`,
      );
      try {
        resolve(await inProcessLock(name, acquireTimeout, fn));
      } catch (e) {
        reject(e);
      }
    }, effectiveTimeout);

    try {
      (navigator as any).locks
        .request(name, { mode: 'exclusive' }, async () => {
          if (settled) return; // fallback already took over
          try {
            const out = await fn();
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(out);
            }
          } catch (e) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(e);
            }
          }
        })
        .catch((e: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          console.warn('[Supabase] navigator.locks.request rejected — falling back to in-process lock:', e);
          inProcessLock(name, acquireTimeout, fn).then(resolve, reject);
        });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.warn('[Supabase] navigator.locks.request threw — falling back to in-process lock:', e);
      inProcessLock(name, acquireTimeout, fn).then(resolve, reject);
    }
  });
};

try {
  const projectRef = supabaseUrl.replace(/^https?:\/\//, '').split('.')[0];
  supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      lock: resilientLock,
      storageKey: `sb-${projectRef}-auth-token`,
    },
  });
} catch (error) {
  console.error('[Supabase] 클라이언트 초기화 중 오류 발생:', error);
  supabase = null;
}

// Swallow LockManager timeout rejections that escape into the global scope —
// they're expected on tab-switch / slow networks and the resilient lock has
// already recovered the session via fallback, so logging is enough.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason: any = event.reason;
    const msg = typeof reason === 'string' ? reason : reason?.message || '';
    if (typeof msg === 'string' && msg.includes('Navigator LockManager lock')) {
      console.warn('[Supabase] Suppressed unhandled LockManager timeout:', msg);
      event.preventDefault();
    }
  });
}

// 타임아웃 유틸리티: Promise 또는 thenable을 지정 시간(ms) 후 자동 reject
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[Timeout] ${label}: ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Safe non-blocking profile fetch: returns default value on failure/timeout,
 * then retries in the background and calls onSuccess when data arrives.
 */
export function safeFetchProfile(
  uid: string,
  opts: {
    timeoutMs?: number;
    defaultValue?: any;
    onSuccess?: (data: any) => void;
    maxRetries?: number;
    retryDelayMs?: number;
  } = {}
): Promise<any> {
  const {
    timeoutMs = 5000,
    defaultValue = null,
    onSuccess,
    maxRetries = 2,
    retryDelayMs = 3000,
  } = opts;

  if (!supabase) {
    console.log('[Info] Using local profile — Supabase client unavailable');
    return Promise.resolve(defaultValue);
  }

  const doFetch = () =>
    withTimeout(
      supabase!
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle(),
      timeoutMs,
      'safeFetchProfile'
    );

  // Background retry logic — never blocks the caller
  const backgroundRetry = (attemptsLeft: number) => {
    if (attemptsLeft <= 0) return;
    setTimeout(async () => {
      try {
        const { data, error } = await doFetch();
        if (data && !error) {
          console.log('[Info] Profile fetched successfully:', data.username);
          onSuccess?.(data);
        } else {
          if (attemptsLeft - 1 > 0) {
            console.log(`[Info] Profile fetch retry scheduled (${attemptsLeft - 1} left)`);
          }
          backgroundRetry(attemptsLeft - 1);
        }
      } catch (e) {
        if (attemptsLeft - 1 > 0) {
          console.log(`[Info] Profile fetch retry scheduled (${attemptsLeft - 1} left)`);
        }
        backgroundRetry(attemptsLeft - 1);
      }
    }, retryDelayMs);
  };

  return doFetch()
    .then(({ data, error }) => {
      if (data && !error) return data;
      console.log('[Info] Using local profile — server fetch pending in background');
      backgroundRetry(maxRetries);
      return defaultValue;
    })
    .catch(() => {
      console.log('[Info] Using local profile — server fetch pending in background');
      backgroundRetry(maxRetries);
      return defaultValue;
    });
}

// 프로필 가져오기 헬퍼
export const debugFetchProfile = async (uid: string) => {
  if (!supabase) return null;

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle(),
      5000,
      'debugFetchProfile 프로필 조회'
    );

    if (error) {
      console.warn('[Supabase] 프로필 조회 오류:', error.message);
    }
    return data;
  } catch (e) {
    console.error('[Supabase] 프로필 조회 실패/타임아웃:', e);
    return null;
  }
};

export { supabase };
