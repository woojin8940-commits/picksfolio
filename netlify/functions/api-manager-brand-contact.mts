import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";
import { loadBusinessContact, withCampaignContact } from "./_shared/business-contact.mts";

/**
 * 캠페인을 올린 브랜드 담당자의 연락처. 픽스폴리오 담당자만 읽는다.
 *
 * 캠페인 목록(api-manager-campaigns)에 함께 담지 않고 따로 뺀 이유가 두 가지 있다.
 *
 *   1. 개인정보다. 목록에 넣으면 담당자가 캠페인 목록을 여는 것만으로 브랜드
 *      담당자 200명의 이름과 휴대폰 번호가 브라우저로 내려온다. 실제로 연락할
 *      캠페인은 그중 한 건이다.
 *   2. 조회 비용이다. 연락처는 Supabase 두 곳(profiles · auth metadata)을 합쳐야
 *      나오므로 계정 수만큼 왕복이 생긴다. 목록에 붙이면 목록이 그만큼 늦어진다.
 *
 * 캠페인 id 로 물어보면 그 캠페인에 적힌 담당자를 먼저 쓴다. 계정 정보는 담당자 칸이
 * 비어 있는 옛 캠페인의 폴백이다 — 계정 하나에 담당자가 여러 명인 경우(대행사, 담당
 * 교체) 가입자에게 전화하면 이 캠페인을 모르는 사람이 받는다.
 *
 * `campaign` 으로 물어보는 것을 기본으로 한다. 캠페인 id 로 브랜드를 되짚으면
 * "실제로 올라와 있는 캠페인의 브랜드"만 조회되므로, 임의의 계정 연락처를 훑는
 * 통로가 되지 않는다. `business` 는 캠페인 id 가 없는 자리를 위해 남겨 두고,
 * 이때는 그 계정이 캠페인 · 제안 · 협업 어느 쪽으로든 담당자의 상대였는지 확인한다.
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

export default async (req: Request) => {
  const manager = await requireManager(req);
  if (!manager.ok) return manager.response;

  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const campaignId = String(url.searchParams.get("campaign") || "").trim();
  const askedBusiness = norm(url.searchParams.get("business"));

  if (!campaignId && !askedBusiness) {
    return Response.json({ error: "캠페인 또는 브랜드를 지정해 주세요." }, { status: 400 });
  }

  try {
    const db = getDatabase();
    let businessUsername = "";
    let brandName = "";
    let campaignRow: any = null;

    if (campaignId) {
      const rows = (await db.sql`
        SELECT business_username, brand_name, contact_person, contact_phone, contact_email
        FROM campaigns WHERE id = ${campaignId} LIMIT 1
      `) as any[];
      if (!rows?.length) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }
      campaignRow = rows[0];
      businessUsername = norm(rows[0].business_username);
      brandName = String(rows[0].brand_name || "");
    } else {
      // 담당자 일감에 등장한 적 있는 브랜드만 조회한다. 캠페인 · 제안 · 협업
      // 어느 쪽으로든 상대였던 계정이면 담당자가 연락할 이유가 있고, 그 밖의
      // 계정(인플루언서 등)은 이 통로로 연락처가 나가지 않는다.
      const rows = (await db.sql`
        SELECT brand_name FROM campaigns
        WHERE LOWER(REPLACE(COALESCE(business_username, ''), 'biz/', '')) = ${askedBusiness}
        ORDER BY created_at DESC
        LIMIT 1
      `) as any[];
      if (rows?.length) {
        brandName = String(rows[0].brand_name || "");
      } else {
        const seen = (await db.sql`
          SELECT 1 FROM proposals
          WHERE LOWER(COALESCE(business_username, '')) = ${askedBusiness}
          UNION ALL
          SELECT 1 FROM campaign_collabs
          WHERE LOWER(REPLACE(COALESCE(business_username, ''), 'biz/', '')) = ${askedBusiness}
          LIMIT 1
        `) as any[];
        if (!seen?.length) {
          return Response.json({ error: "브랜드를 찾을 수 없습니다." }, { status: 404 });
        }
      }
      businessUsername = askedBusiness;
    }

    const account = await loadBusinessContact(businessUsername);
    const contact = withCampaignContact(account, campaignRow);
    return Response.json({ contact: { ...contact, brandName } });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "연락처를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/manager-brand-contact",
};
