import type { Config } from "@netlify/functions";
import { verifyBusinessStatus, cleanBizNo } from "./_shared/nts-business.mts";

// 국세청 사업자등록정보 진위확인 및 상태조회 서비스 (data.go.kr / odcloud.kr)
// 사업자등록번호가 국세청에 실제 등록된 계속사업자인지 검증한다.
const NTS_BASE = "https://api.odcloud.kr/api/nts-businessman/v1";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: "잘못된 요청입니다." }, { status: 400 });
  }

  const result = await verifyBusinessStatus(body?.business_number || body?.b_no || "");

  if (!result.verified) {
    return Response.json({
      success: false,
      verified: false,
      status: result.status || "",
      end_dt: result.end_dt || "",
      error: result.error || "사업자 조회에 실패했습니다.",
    });
  }

  // 선택적 진위확인: 대표자명/개업일자가 함께 오면 등록증 정보와 대조한다.
  const serviceKey = Netlify.env.get("NTS_BUSINESS_API_KEY") || "";
  const startDt = cleanBizNo(body?.start_dt || ""); // YYYYMMDD
  const pNm = (body?.representative_name || body?.p_nm || "").trim();
  let validated: boolean | null = null;
  let validMsg = "";

  if (serviceKey && startDt.length === 8 && pNm) {
    try {
      const res = await fetch(
        `${NTS_BASE}/validate?serviceKey=${encodeURIComponent(serviceKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ businesses: [{ b_no: result.b_no, start_dt: startDt, p_nm: pNm }] }),
        }
      );
      const json = await res.json();
      const vEntry = json?.data?.[0];
      if (vEntry) {
        validated = vEntry.valid === "01";
        validMsg = vEntry.valid_msg || "";
      }
    } catch {
      // 진위확인 실패는 상태조회 결과에 영향을 주지 않는다.
    }
  }

  return Response.json({
    success: true,
    verified: true,
    b_no: result.b_no,
    status: result.status,
    status_code: result.status_code,
    tax_type: result.tax_type,
    validated,
    valid_msg: validMsg,
    message: "정상 영업 중인 사업자로 확인되었습니다.",
  });
};

export const config: Config = {
  path: "/.netlify/functions/business-verify-nts",
};
