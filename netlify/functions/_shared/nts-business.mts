// 국세청 사업자등록정보 상태조회/진위확인 공통 헬퍼
// data.go.kr (odcloud.kr) - 국세청_사업자등록정보 진위확인 및 상태조회 서비스
const NTS_BASE = "https://api.odcloud.kr/api/nts-businessman/v1";

export type NtsVerifyResult = {
  verified: boolean;
  b_no?: string;
  status?: string; // 계속사업자 / 휴업자 / 폐업자
  status_code?: string; // 01 / 02 / 03
  tax_type?: string;
  end_dt?: string;
  error?: string;
};

export function cleanBizNo(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

async function callNts(path: string, serviceKey: string, payload: unknown) {
  const url = `${NTS_BASE}/${path}?serviceKey=${encodeURIComponent(serviceKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 오류 시 국세청 API가 비-JSON을 반환할 수 있다.
  }
  return { ok: res.ok, json };
}

// 사업자등록번호 상태조회: 등록 여부 + 계속/휴업/폐업 상태를 확인한다.
export async function verifyBusinessStatus(rawBizNo: string): Promise<NtsVerifyResult> {
  const serviceKey = Netlify.env.get("NTS_BUSINESS_API_KEY");
  if (!serviceKey) {
    return { verified: false, error: "사업자 조회 서비스가 설정되지 않았습니다." };
  }

  const bNo = cleanBizNo(rawBizNo);
  if (bNo.length !== 10) {
    return { verified: false, error: "사업자등록번호 10자리를 정확히 입력해 주세요." };
  }

  const statusRes = await callNts("status", serviceKey, { b_no: [bNo] });
  if (!statusRes.ok || !statusRes.json) {
    return { verified: false, error: "국세청 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const entry = statusRes.json?.data?.[0] || {};
  const matched = Number(statusRes.json?.match_cnt ?? 0);

  if (!matched || !entry.b_stt_cd) {
    return { verified: false, status: entry.b_stt || "", error: "국세청에 등록되지 않은 사업자등록번호입니다." };
  }
  if (entry.b_stt_cd === "03") {
    return { verified: false, status: entry.b_stt || "폐업자", end_dt: entry.end_dt || "", error: "폐업된 사업자등록번호입니다." };
  }
  if (entry.b_stt_cd === "02") {
    return { verified: false, status: entry.b_stt || "휴업자", error: "휴업 중인 사업자등록번호입니다." };
  }

  return {
    verified: true,
    b_no: entry.b_no || bNo,
    status: entry.b_stt || "계속사업자",
    status_code: entry.b_stt_cd,
    tax_type: entry.tax_type || "",
  };
}
