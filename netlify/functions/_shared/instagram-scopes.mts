/**
 * 인스타그램 연동(Instagram API with Instagram Login) 동의 화면에서 요청하는 권한.
 * 연동 시작(instagram-oauth-start)이 요청하고, 콜백이 모두 허용됐는지 확인한다.
 * 각 권한의 쓰임새는 instagram-oauth-start 의 설명을 본다.
 */
export const REQUIRED_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
] as const;

export function parseInstagramTokenResponse(value: unknown): { token: string; permissions: string[] | null } {
  if (!value || typeof value !== "object") return { token: "", permissions: null };
  const body = value as Record<string, unknown>;
  const data = Array.isArray(body.data) && body.data.length === 1 ? body.data[0] : null;
  const payload = typeof body.access_token === "string"
    ? body
    : data && typeof data === "object" ? data as Record<string, unknown> : {};
  const token = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  const raw = payload.permissions;
  const permissions = typeof raw === "string"
    ? raw.split(",").map((permission) => permission.trim()).filter(Boolean)
    : Array.isArray(raw) && raw.every((permission) => typeof permission === "string")
      ? raw.map((permission: string) => permission.trim()).filter(Boolean)
      : null;
  return { token, permissions };
}
