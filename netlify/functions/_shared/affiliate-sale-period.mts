/**
 * 어필리에이트 상품 판매기간(한국 날짜 기준, 시작일 · 종료일 모두 포함).
 * 판매중(on_sale) 상태여도 기간 밖이면 인플루언서 목록 · 판매 신청 · 구매에서 막는다.
 */

/** 오늘 한국 날짜 'YYYY-MM-DD'. SQL 에는 ${kstToday()}::date 로 넘긴다. */
export const kstToday = (now = Date.now()) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

/** DATE 칼럼 값(문자열 · Date)을 'YYYY-MM-DD' 로. 없으면 ''. */
export const dateOnly = (v: unknown): string => {
  if (!v) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};

/** 화면이 보낸 날짜 → 'YYYY-MM-DD' | '' (비움) | null (형식 오류). */
export const parseDateInput = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

export type SaleState = "on_sale" | "scheduled" | "ended" | "sold_out" | "paused" | "draft" | "deleted";

/** 인플루언서 · 구매자에게 보여 줄 실제 판매 상태. */
export function saleStateOf(r: any, today = kstToday()): SaleState {
  if (r.deleted_at) return "deleted";
  if (r.status === "paused") return "paused";
  if (r.status !== "on_sale") return "draft";
  const start = dateOnly(r.sale_start_date);
  const end = dateOnly(r.sale_end_date);
  if (start && start > today) return "scheduled";
  if (end && end < today) return "ended";
  if (r.stock !== undefined && r.stock !== null && !(Number(r.stock) > 0)) return "sold_out";
  return "on_sale";
}
