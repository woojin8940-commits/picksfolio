/**
 * 허용한 주소만 따라가는 fetch.
 *
 * 사용자가 넣은 주소를 서버가 대신 여는 자리는 호스트를 허용 목록으로 묶어 두지만,
 * fetch 의 기본 동작은 리다이렉트를 끝까지 따라간다. 허용한 호스트 안에도 아무 주소로나
 * 보내 주는 경로(l.instagram.com 의 외부 링크 중계 등)가 있어, 결국 임의의 주소(내부망
 * 포함)를 서버가 열 수 있었다. 리다이렉트는 직접 따라가며 매번 같은 기준으로 확인한다.
 */
export async function fetchAllowed(
  url: string,
  init: RequestInit,
  isAllowed: (url: URL) => boolean,
  maxRedirects = 3,
): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; ; hop += 1) {
    if (!isAllowed(current)) throw new Error("redirect target not allowed");
    const res = await fetch(current.toString(), { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    if (hop >= maxRedirects) throw new Error("too many redirects");
    current = new URL(location, current);
  }
}
