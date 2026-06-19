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

// data.go.kr은 "Encoding"(이미 URL 인코딩, %2B·%2F 등 포함)과 "Decoding"(원본) 두 가지 형태의 키를 제공한다.
// 이미 인코딩된 키를 다시 인코딩하면 인증이 깨져 모든 조회가 실패하므로, 형태를 감지해 한 번만 인코딩한다.
function buildServiceKeyParam(serviceKey: string): string {
  const looksEncoded = /%[0-9A-Fa-f]{2}/.test(serviceKey);
  return looksEncoded ? serviceKey : encodeURIComponent(serviceKey);
}

async function callNts(path: string, serviceKey: string, payload: unknown) {
  const url = `${NTS_BASE}/${path}?serviceKey=${buildServiceKeyParam(serviceKey)}`;
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

  const entry = statusRes.json?.data?.[0];
  if (!entry) {
    return { verified: false, error: "국세청 조회 결과를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }

  const taxType: string = entry.tax_type || "";
  const sttCd: string = entry.b_stt_cd || "";

  // 국세청은 "미등록"인 경우에만 tax_type에 안내 문구를 넣어 응답한다.
  // match_cnt가 누락되거나 b_stt_cd가 비어 있어도(신규 등록 등) 등록된 사업자일 수 있으므로,
  // 명시적 미등록 응답일 때만 미등록으로 처리한다.
  if (taxType.includes("등록되지 않은")) {
    return { verified: false, status: entry.b_stt || "", error: "국세청에 등록되지 않은 사업자등록번호입니다." };
  }
  if (sttCd === "03") {
    return { verified: false, status: entry.b_stt || "폐업자", end_dt: entry.end_dt || "", error: "폐업된 사업자등록번호입니다." };
  }
  if (sttCd === "02") {
    return { verified: false, status: entry.b_stt || "휴업자", error: "휴업 중인 사업자등록번호입니다." };
  }

  // 계속사업자(01)이거나, 상태코드는 비어 있지만 미등록 안내가 없는 등록 사업자는 모두 통과시킨다.
  return {
    verified: true,
    b_no: entry.b_no || bNo,
    status: entry.b_stt || "계속사업자",
    status_code: sttCd || "01",
    tax_type: taxType,
  };
}
