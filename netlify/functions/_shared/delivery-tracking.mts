/**
 * 송장 배송 조회(스마트택배 · 스위트트래커 API).
 *
 * 환경변수 SWEETTRACKER_API_KEY 가 있어야 동작한다. 없으면 조회하지 않는다(null).
 * 택배사 코드는 스위트트래커 회사 목록 API 에서 이름으로 찾고, 목록을 못 받으면 아래 기본 코드를 쓴다.
 */

const API = "https://info.sweettracker.co.kr/api/v1";

/** 스위트트래커 택배사 코드(잘 알려진 것만 · 나머지는 회사 목록 API 에서 이름으로 찾는다). */
const FALLBACK_CODES: Record<string, string> = {
  "우체국택배": "01",
  "CJ대한통운": "04",
  "한진택배": "05",
  "로젠택배": "06",
  "롯데택배": "08",
  "일양로지스": "11",
  "천일택배": "17",
  "건영택배": "18",
  "대신택배": "22",
  "경동택배": "23",
  "합동택배": "32",
  "CU 편의점택배": "46",
};

/** 이름 비교용: 공백 · 괄호 · '택배' · '(주)' 같은 꾸밈을 뺀다. */
const norm = (s: string) =>
  String(s || "")
    .replace(/\(.*?\)/g, "")
    .replace(/주식회사|택배|로지스틱스|로지스|편의점|\s/g, "")
    .toLowerCase();

/** 우리 목록 이름 → 스위트트래커 이름에서 찾을 별칭. */
const ALIASES: Record<string, string[]> = {
  "CJ대한통운": ["cj대한통운", "대한통운"],
  "CU 편의점택배": ["cu", "cu편의점"],
  "GS25 편의점택배": ["gs", "gs25", "gspostbox", "cvsnet"],
  "SLX택배": ["slx"],
  "농협택배": ["농협", "nh"],
  "한의사랑택배": ["한의사랑"],
};

export const trackingApiKey = () => process.env.SWEETTRACKER_API_KEY || "";

/** 키가 무효(101)면 keyInvalid = true. 목록을 못 받으면 기본 코드로 조회한다. */
export async function loadCompanyCodes(key: string): Promise<Map<string, string> & { keyInvalid?: boolean }> {
  const out: Map<string, string> & { keyInvalid?: boolean } = new Map();
  try {
    const res = await fetch(`${API}/companylist?t_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) });
    const json: any = await res.json().catch(() => null);
    if (String(json?.code || "") === "101") { out.keyInvalid = true; return out; }
    if (!res.ok || !json) return out;
    for (const c of Array.isArray(json?.Company) ? json.Company : []) {
      if (c?.International === "true" || c?.International === true) continue;
      if (c?.Code && c?.Name) out.set(norm(c.Name), String(c.Code));
    }
  } catch { /* 기본 코드로 조회한다 */ }
  return out;
}

export function resolveCompanyCode(company: string, list: Map<string, string>): string {
  if (FALLBACK_CODES[company]) return FALLBACK_CODES[company];
  const names = [norm(company), ...(ALIASES[company] || [])];
  for (const n of names) {
    if (n && list.has(n)) return list.get(n)!;
  }
  for (const [name, code] of list) {
    if (names.some((n) => n && (name.startsWith(n) || n.startsWith(name)))) return code;
  }
  return "";
}

export type TrackingResult =
  | { ok: true; delivered: boolean; deliveredAt: Date | null; lastStatus: string }
  | { ok: false; error: string };

/** 송장 하나를 조회한다. 배송 완료(level 6 / complete)면 delivered = true. */
export async function lookupTracking(key: string, code: string, invoice: string): Promise<TrackingResult> {
  const num = String(invoice || "").replace(/[^0-9A-Za-z]/g, "");
  if (!num) return { ok: false, error: "NO_NUMBER" };
  try {
    const url = `${API}/trackingInfo?t_key=${encodeURIComponent(key)}&t_code=${encodeURIComponent(code)}&t_invoice=${encodeURIComponent(num)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const json: any = await res.json().catch(() => null);
    // 실패는 HTTP 400 + { status:false, code, msg } 로 온다(101 = 키 무효 · 104 = 송장 형식 오류 등).
    if (!json) return { ok: false, error: `HTTP_${res.status}` };
    if (json.status === false || json.code || !res.ok) return { ok: false, error: String(json.code || `HTTP_${res.status}`) };
    const details: any[] = Array.isArray(json?.trackingDetails) ? json.trackingDetails : [];
    const last = details[details.length - 1];
    const delivered = json?.complete === true || json?.complete === "true" || Number(json?.level) === 6
      || details.some((d) => Number(d?.level) === 6);
    let deliveredAt: Date | null = null;
    if (delivered) {
      const d = [...details].reverse().find((x) => Number(x?.level) === 6) || last;
      const t = Number(d?.time);
      if (Number.isFinite(t) && t > 0) deliveredAt = new Date(t);
    }
    return { ok: true, delivered, deliveredAt, lastStatus: String(last?.kind || "") };
  } catch {
    return { ok: false, error: "NETWORK" };
  }
}
