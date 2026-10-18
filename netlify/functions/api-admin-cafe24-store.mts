import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireOperator } from "./_shared/manager-auth.mts";
import { Cafe24Error, cafe24Request, connectionForMall, connectionHealth } from "./_shared/cafe24-api.mts";
import { cleanMallId } from "./_shared/cafe24-credentials.mts";

/**
 * 운영자용 연동 확인: GET /api/admin/cafe24/store?mall_id=
 *
 * 연동된 몰의 토큰으로 카페24 `GET /api/v2/admin/store` 를 불러 쇼핑몰 이름만 돌려준다
 * (Bearer 토큰 · X-Cafe24-Api-Version 헤더는 cafe24Request 가 붙이고, 만료가 가까우면 먼저 갱신한다).
 * 토큰 · 응답 원문은 내보내지 않는다.
 */
export default async (req: Request) => {
  if (req.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const op = await requireOperator(req);
  if (!op.ok) return op.response;

  const mallId = cleanMallId(new URL(req.url).searchParams.get("mall_id"));
  if (!mallId) return Response.json({ error: "mall_id 형식이 올바르지 않습니다." }, { status: 400 });

  const conn = await connectionForMall(getDatabase(), mallId);
  const health = connectionHealth(conn);
  if (!conn || !health.usable) {
    return Response.json(
      { error: "사용할 수 있는 연동이 없습니다.", state: conn ? conn.status : "none", reason: health.reason },
      { status: 409 },
    );
  }
  try {
    const json = await cafe24Request(conn, "/store");
    return Response.json({ mallId, shopName: String(json?.store?.shop_name || json?.store?.mall_name || "") });
  } catch (e) {
    const status = e instanceof Cafe24Error ? e.status : 0;
    const reconnect = e instanceof Cafe24Error && e.reconnect;
    return Response.json(
      {
        error: reconnect ? "토큰 갱신에 실패했습니다. 재연동이 필요합니다." : status === 403 ? "권한이 부족합니다." : "카페24 호출에 실패했습니다.",
        status,
        missingScopes: health.missingScopes,
      },
      { status: reconnect ? 409 : 502 },
    );
  }
};

export const config: Config = {
  path: "/api/admin/cafe24/store",
};
