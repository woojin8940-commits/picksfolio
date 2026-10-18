import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import { loadBusinessContact } from "./_shared/business-contact.mts";
import { jsonError, norm } from "./_shared/affiliate.mts";
import { TERMS_VERSION, recordAgreement, termsSummary } from "./_shared/affiliate-terms.mts";

/**
 * 판매 수수료 이용약관 동의(브랜드).
 *
 *   GET  /api/affiliate-terms                 브랜드: 약관 본문 + 내 동의 상태 + 입력 기본값
 *   GET  /api/affiliate-terms?scope=admin     운영자: 브랜드별 동의 상태
 *   POST /api/affiliate-terms { companyName, representative, businessNumber,
 *                               contactName, contactPhone, contactEmail, agree: true }
 */

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const noStore = { "Cache-Control": "no-store" };

function validateInput(body: any) {
  const input = {
    companyName: clip(body?.companyName, 80),
    representative: clip(body?.representative, 30),
    businessNumber: clip(body?.businessNumber, 20).replace(/\D/g, ""),
    contactName: clip(body?.contactName, 30),
    contactPhone: clip(body?.contactPhone, 20).replace(/[^\d-]/g, ""),
    contactEmail: clip(body?.contactEmail, 120).toLowerCase(),
  };
  if (body?.agree !== true) return { error: "약관에 동의해 주세요." };
  if (!input.companyName) return { error: "상호를 입력해 주세요." };
  if (!input.representative) return { error: "대표자 이름을 입력해 주세요." };
  if (!/^\d{10}$/.test(input.businessNumber)) return { error: "사업자등록번호 10자리를 입력해 주세요." };
  if (input.contactName.length < 2) return { error: "담당자 이름을 2자 이상 입력해 주세요." };
  if (!/^0\d{8,10}$/.test(input.contactPhone.replace(/-/g, ""))) return { error: "담당자 연락처를 확인해 주세요." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) return { error: "담당자 이메일을 확인해 주세요." };
  const b = input.businessNumber;
  return { value: { ...input, businessNumber: `${b.slice(0, 3)}-${b.slice(3, 5)}-${b.slice(5)}` } };
}

export default async (req: Request, context: Context) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.get("scope") === "admin") {
      const op = await requireOperator(req);
      if (!op.ok) return op.response;
      // 판매 캠페인을 올렸거나 약관에 동의한 브랜드 전부.
      const brands = (await db.sql`
        SELECT business_username, MAX(company_name) AS company_name, COUNT(*) FILTER (WHERE kind = 'campaign')::int AS campaigns
        FROM (
          SELECT business_username, company_name, 'campaign' AS kind FROM affiliate_campaigns WHERE deleted_at IS NULL
          UNION ALL
          SELECT business_username, company_name, 'terms' AS kind FROM affiliate_brand_terms_agreements
        ) t GROUP BY business_username ORDER BY business_username LIMIT 500
      `) as any[];
      const list = await Promise.all(
        brands.map(async (b) => {
          const { terms: _terms, ...summary } = await termsSummary(db, String(b.business_username));
          return {
            businessUsername: String(b.business_username),
            companyName: String(b.company_name || ""),
            campaigns: Number(b.campaigns || 0),
            ...summary,
          };
        }),
      );
      return Response.json({ brands: list, currentVersion: TERMS_VERSION }, { headers: noStore });
    }

    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;
    const business = norm(caller.username);
    const summary = await termsSummary(db, business);
    // 입력 기본값: 지난 동의 → 가입 정보 순.
    const last = summary.agreement;
    let defaults = last
      ? {
          companyName: last.companyName, representative: last.representative, businessNumber: last.businessNumber,
          contactName: last.contactName, contactPhone: last.contactPhone, contactEmail: last.contactEmail,
        }
      : null;
    if (!defaults) {
      const contact = await loadBusinessContact(business).catch(() => null);
      defaults = {
        companyName: contact?.companyName || "", representative: "", businessNumber: "",
        contactName: contact?.contactPerson || "", contactPhone: contact?.contactPhone || "", contactEmail: contact?.contactEmail || "",
      };
    }
    return Response.json({ ...summary, defaults }, { headers: noStore });
  }

  if (req.method !== "POST") return jsonError("Method not allowed", 405);
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const business = norm(caller.username);
  const body = await req.json().catch(() => ({}));
  const checked = validateInput(body);
  if ("error" in checked) return jsonError(checked.error as string);
  const current = await termsSummary(db, business);
  if (current.valid) return Response.json(current, { headers: noStore });
  await recordAgreement(db, business, checked.value!, context?.ip || "");
  return Response.json(await termsSummary(db, business), { headers: noStore });
};

export const config: Config = {
  path: "/api/affiliate-terms",
};
