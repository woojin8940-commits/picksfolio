// 테스트 로그인: "Authorization: Bearer test:<아이디>" (운영자는 "test:<아이디>:admin").
export * from "../../../netlify/functions/_shared/user-auth.mts?real";

export async function requireSignedInUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer test:([^:]+)(:admin)?$/.exec(header);
  if (!m) {
    return { ok: false as const, response: Response.json({ error: "로그인이 필요합니다.", code: "AUTH_REQUIRED" }, { status: 401 }) };
  }
  return { ok: true as const, username: m[1].toLowerCase(), userId: `uid-${m[1]}`, isAdmin: !!m[2] };
}
