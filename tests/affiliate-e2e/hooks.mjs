// 모듈 바꿔치기 규칙(테스트 전용).
//   @picks/netlify-database → PGlite 어댑터
//   @netlify/identity       → getUser() 가 항상 null
//   _shared/user-auth.mts   → "Authorization: Bearer test:<아이디>[:admin]" 로 로그인
// 원본이 필요한 곳은 "?real" 을 붙여 가져간다.
const stub = (name) => new URL(`./stubs/${name}`, import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier.endsWith("?real")) {
    const r = await next(specifier.slice(0, -5), context);
    return { ...r, url: `${r.url}?real`, shortCircuit: true };
  }
  if (specifier === "@picks/netlify-database") return { url: stub("database.mjs"), shortCircuit: true };
  if (specifier === "@netlify/identity") return { url: stub("identity.mjs"), shortCircuit: true };
  const r = await next(specifier, context);
  if (r.url.endsWith("/_shared/user-auth.mts")) return { url: stub("user-auth.mts"), shortCircuit: true };
  return r;
}
