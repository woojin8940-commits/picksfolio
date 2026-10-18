import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { clientIp } from "./_shared/rate-limit.mts";
import { hashValue, todayKst } from "./_shared/affiliate.mts";

/**
 * 추적 링크 /go/{code}.
 *
 * 클릭을 기록하고(코드 · 인플루언서 · 상품 · 시각 · 해시된 IP/UA) 브랜드 상품 페이지로
 * 보내면서 ?pf={code} 를 붙인다. 브랜드 몰의 추적 스크립트가 그 값을 브라우저에 저장했다가
 * 주문완료 페이지에서 주문번호와 함께 돌려보낸다.
 *
 *   · 판매 중이 아닌 링크(참여 중단 · 캠페인 종료 · 상품 내림)는 기록하지 않고 pf 없이
 *     상품 페이지로만 보낸다. 이미 공유된 링크가 죽은 링크가 되지 않게.
 *   · 봇과 같은 기기(IP + 브라우저)의 30분 안 반복 클릭은 기록은 하되 집계에서 뺀다(counted=false).
 *     IP 만 보면 통신사 공유 IP 뒤의 다른 사람 클릭까지 반복으로 빠진다.
 *   · 원본 IP·UA 는 저장하지 않는다.
 */

const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|slurp|bingpreview|kakaotalk-scrap|yeti|daumoa|headless|python|curl|wget/i;

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer-when-downgrade" },
  });

function withParam(target: string, code: string): string {
  try {
    const u = new URL(target);
    u.searchParams.set("pf", code);
    return u.toString();
  } catch {
    return target;
  }
}

export default async (req: Request) => {
  const code = decodeURIComponent(new URL(req.url).pathname.split("/").filter(Boolean)[1] || "").toLowerCase();
  if (!/^[a-z0-9]{6,20}$/.test(code)) return redirect("/");

  const db = getDatabase();
  const today = todayKst();
  let row: any;
  try {
    row = ((await db.sql`
      SELECT l.code, l.status AS link_status, l.campaign_id, l.campaign_product_id, l.influencer_username,
             p.status AS part_status, c.status AS campaign_status, c.deleted_at,
             (c.start_date <= ${today} AND c.end_date >= ${today}) AS in_period,
             cp.product_url, cp.active AS product_active
      FROM affiliate_links l
      JOIN affiliate_participations p ON p.id = l.participation_id
      JOIN affiliate_campaigns c ON c.id = l.campaign_id
      JOIN affiliate_campaign_products cp ON cp.id = l.campaign_product_id
      WHERE l.code = ${code}
    `) as any[])[0];
  } catch {
    return redirect("/");
  }
  if (!row?.product_url) return redirect("/");

  const trackable =
    row.link_status === "active" && row.part_status === "approved" && row.campaign_status === "active" &&
    !row.deleted_at && row.in_period && row.product_active;
  if (!trackable) return redirect(row.product_url);

  const ua = req.headers.get("user-agent") || "";
  const ipHash = hashValue(clientIp(req));
  const uaHash = hashValue(ua);
  let referrerHost = "";
  try {
    referrerHost = new URL(req.headers.get("referer") || "").host.slice(0, 120);
  } catch {}

  try {
    await db.sql`
      INSERT INTO affiliate_clicks (code, campaign_id, campaign_product_id, influencer_username, ip_hash, ua_hash, referrer_host, counted)
      SELECT ${code}, ${row.campaign_id}, ${row.campaign_product_id}, ${row.influencer_username}, ${ipHash}, ${uaHash}, ${referrerHost},
             ${!BOT_UA.test(ua)} AND NOT EXISTS (
               SELECT 1 FROM affiliate_clicks WHERE ip_hash = ${ipHash} AND ua_hash = ${uaHash} AND code = ${code}
                 AND counted AND clicked_at > NOW() - INTERVAL '30 minutes'
             )
    `;
  } catch (e) {
    // 기록이 실패해도 방문자는 상품 페이지로 가야 한다.
    console.warn("[affiliate-go] click insert failed", e instanceof Error ? e.message : "");
  }
  return redirect(withParam(row.product_url, code));
};

export const config: Config = {
  path: "/go/:code",
};
