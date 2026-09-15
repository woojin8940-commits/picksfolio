/**
 * 아이디 중복확인 호출을 한 군데로 모은다(가입 화면 · 비즈니스 가입 화면).
 *
 * 화면 두 곳이 같은 함수를 각자 fetch 로 부르고 있었다. 한쪽만 고치면 두 화면의
 * 판정이 갈라지고, 무엇보다 "같은 아이디를 다시 확인" 하는 흔한 동작이 매번 서버
 * 왕복이었다. 여기서 세 가지를 한다.
 *
 *  1. 같은 아이디에 대한 동시 요청을 하나로 묶는다(버튼 연타).
 *  2. 성공한 답을 짧게 들고 있는다 — 화면이 이미 "결과가 지금 입력값에 대한
 *     답일 때만 인정" 하는 방식이라(SignupPage 의 checkResult), 이 캐시는 그보다
 *     짧게 살고 판정을 느슨하게 만들지 않는다. 최종 판정은 어차피 auth-signup 이다.
 *  3. 미리 확인(prefetch)을 허용한다. 입력이 멈춘 뒤 답을 받아 두면 사용자가
 *     버튼을 누른 순간에는 기다릴 것이 없다.
 *
 * 실패는 캐시하지 않는다. 일시적인 오류가 캐시되면 다시 눌러도 같은 오류가 난다.
 */

/** 서버(auth-check-username · auth-signup)와 같은 아이디 규칙. */
const ID_PATTERN = /^[a-z0-9_]{3,20}$/;

/** 성공한 답을 들고 있는 시간. */
const TTL_MS = 30_000;

type Success = { ok: true; available: boolean; message?: string };
type Failure = { ok: false; message?: string };
export type UsernameCheckResult = Success | Failure;

const cache = new Map<string, { at: number; result: Success }>();
const inFlight = new Map<string, Promise<UsernameCheckResult>>();

const fresh = (username: string): Success | null => {
  const hit = cache.get(username);
  if (!hit) return null;
  if (Date.now() - hit.at >= TTL_MS) {
    cache.delete(username);
    return null;
  }
  return hit.result;
};

async function request(username: string): Promise<UsernameCheckResult> {
  try {
    const response = await fetch('/.netlify/functions/auth-check-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      return { ok: false, message: data?.error };
    }

    const result: Success = {
      ok: true,
      available: !!data.available,
      message: data.error,
    };
    cache.set(username, { at: Date.now(), result });
    return result;
  } catch {
    return { ok: false };
  }
}

/** 중복확인. 이미 받아 둔 답이 있으면 왕복 없이 그대로 돌려준다. */
export function checkUsername(username: string): Promise<UsernameCheckResult> {
  const hit = fresh(username);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(username);
  if (pending) return pending;

  const promise = request(username).finally(() => {
    inFlight.delete(username);
  });
  inFlight.set(username, promise);
  return promise;
}

/**
 * 결과를 미리 받아 둔다. 실패는 조용히 버린다 — 사용자가 요청한 확인이 아니므로
 * 여기서 알릴 것이 없고, 버튼을 누르면 그때 다시 물어 제대로 안내한다.
 */
export function prefetchUsername(username: string): void {
  if (!ID_PATTERN.test(username)) return;
  if (fresh(username) || inFlight.has(username)) return;
  void checkUsername(username);
}
