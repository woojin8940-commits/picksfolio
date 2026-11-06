import { brandSettlement } from "./affiliate-store-orders.mts";

/**
 * 어필리에이트 스토어 정산(지급 신청) 공통 로직.
 *
 *   지급 가능 금액 = (구매확정됐고 아직 어떤 신청에도 들어가지 않은 주문의 정산액 합계) − (아직 빼지 않은 차감액)
 *     브랜드     : 결제 금액 − 인플루언서 수수료 − 이용료(상품 금액 기준) − PG 수수료(결제 금액 기준, 배송비 포함)
 *                  (주문에 고정된 비율, brandSettlement). 반품 환불된 주문은 남은 배송비 − PG 수수료
 *     인플루언서 : 구매확정된 수수료(commission_amount)
 *   지급 신청은 지급 가능 금액 전액을 한 건으로 만들고, 대상 주문과 금액을 신청 건에 고정 저장한다.
 *   같은 주문은 살아 있는(지급 대기 · 지급 완료) 신청 하나에만 들어간다(부분 고유 인덱스로 막는다).
 *
 *   신청에 들어간 주문이 그 뒤 환불되면(정산액이 줄면) 줄어든 만큼 차감 내역을 남기고, 다음 신청에서 뺀다.
 *   신청이 취소 · 반려되면 포함 주문은 다시 지급 가능 금액으로 돌아가고, 그 신청에서 뺐던 차감액도 돌아간다.
 *
 * 규칙: 계좌번호 · 주민등록번호 원문은 여기서 다루지 않는다(암호문만 받아 신청 건에 복사한다).
 */

export type PartyType = "brand" | "influencer";

/** 인플루언서 원천징수: 소득세 3%(원 미만 절사), 지방소득세 = 소득세의 10%(원 미만 절사). */
export function withholding(gross: number) {
  const g = Math.max(0, Math.floor(Number(gross) || 0));
  const incomeTax = Math.floor((g * 3) / 100);
  const localTax = Math.floor(incomeTax / 10);
  return { gross: g, incomeTax, localTax, net: g - incomeTax - localTax };
}

// ─────────────────────────── 날짜(한국 시간) ───────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const kstParts = (d = new Date()) => {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
};
export const kstToday = (d = new Date()) => {
  const p = kstParts(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};

/** 이번 달(한국 시간) 신청분의 지급 예정일 = 다음 달 10일, 토 · 일이면 다음 월요일. 공휴일은 따로 빼지 않는다. */
export function scheduledDateFor(now = new Date()): string {
  const p = kstParts(now);
  const date = new Date(Date.UTC(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 0 : p.m, 10));
  const wd = date.getUTCDay();
  if (wd === 6) date.setUTCDate(12);
  else if (wd === 0) date.setUTCDate(11);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// ─────────────────────────── 주문별 정산액 ───────────────────────────

/** 브랜드 정산 대상 주문: 구매확정, 또는 반품 환불(상품 금액만 환불)로 끝나 배송비가 남은 주문(남은 배송비만). */
export const isBrandSettled = (o: any) =>
  o.status === "confirmed"
  || (o.status === "cancelled" && Number(o.refund_amount) > 0 && Number(o.refund_amount) < Number(o.total_amount));

export function brandEntitled(o: any): number {
  if (!isBrandSettled(o)) return 0;
  const s = brandSettlement(o);
  return s.included ? Math.max(0, Math.floor(s.amount)) : 0;
}

export function influencerEntitled(o: any): number {
  return o.commission_status === "confirmed" ? Math.max(0, Number(o.commission_amount) || 0) : 0;
}

export const entitled = (t: PartyType, o: any) => (t === "brand" ? brandEntitled(o) : influencerEntitled(o));

const partyColumn = (t: PartyType) => (t === "brand" ? "business_username" : "influencer_username");

/** 정산 예정(아직 구매확정 전) 주문 상태. */
const PENDING_STATUSES = ["paid", "preparing", "shipped", "delivered", "return_requested"];

// ─────────────────────────── 트랜잭션 ───────────────────────────

export async function withTx<T>(db: any, fn: (client: any) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 같은 신청자의 신청 · 취소 · 차감 계산이 겹치지 않게 트랜잭션 잠금을 건다. */
export const lockParty = (client: any, t: PartyType, party: string) =>
  client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`affiliate_payout:${t}:${party}`]);

// ─────────────────────────── 차감 ───────────────────────────

/**
 * 살아 있는 신청에 들어간 주문 중 지금 정산액이 신청 때보다 줄어든 주문(환불)에 차감 내역을 남긴다(멱등).
 * 이미 남긴 차감액을 빼고 모자란 만큼만 더한다.
 */
export async function syncDeductions(client: any, t: PartyType, party: string): Promise<number> {
  const rows = (await client.query(
    `SELECT i.id AS item_id, i.request_id AS payout_request_id, i.amount AS item_amount, i.product_name AS item_product,
            COALESCE((SELECT SUM(d.amount) FROM affiliate_payout_deductions d WHERE d.source_item_id = i.id), 0)::int AS deducted,
            o.*
       FROM affiliate_payout_items i JOIN affiliate_store_orders o ON o.id = i.order_id
      WHERE i.party_type = $1 AND i.party = $2 AND i.active`,
    [t, party],
  )).rows;
  let added = 0;
  for (const r of rows) {
    const current = entitled(t, r);
    const remaining = Number(r.item_amount) - Number(r.deducted);
    const diff = remaining - current;
    if (diff > 0) {
      const reason = r.status === "cancelled"
        ? (Number(r.refund_amount) >= Number(r.total_amount) ? "지급 신청 뒤 전액 환불" : "지급 신청 뒤 반품 환불(배송비만 정산)")
        : "지급 신청 뒤 정산액 변경";
      await client.query(
        `INSERT INTO affiliate_payout_deductions (party_type, party, order_id, source_request_id, source_item_id, amount, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [t, party, r.id, r.payout_request_id, r.item_id, diff, reason],
      );
      added += diff;
    }
  }
  return added;
}

// ─────────────────────────── 지급 가능 금액 ───────────────────────────

export interface AvailableSnapshot {
  orders: { id: string; productName: string; amount: number; confirmedAt: string | null }[];
  deductions: { id: number; orderId: string; amount: number; reason: string; createdAt: string }[];
  orderAmount: number;
  deductionAmount: number;
  available: number;
}

/** 지금 신청하면 들어갈 주문 · 차감 내역과 금액. syncDeductions 뒤에 부른다. */
export async function availableSnapshot(client: any, t: PartyType, party: string): Promise<AvailableSnapshot> {
  const col = partyColumn(t);
  const where = t === "brand"
    ? `(o.status = 'confirmed' OR (o.status = 'cancelled' AND o.refund_amount > 0 AND o.refund_amount < o.total_amount))`
    : `o.commission_status = 'confirmed' AND o.commission_amount > 0`;
  const orderRows = (await client.query(
    `SELECT o.* FROM affiliate_store_orders o
      WHERE o.${col} = $1 AND ${where}
        AND NOT EXISTS (SELECT 1 FROM affiliate_payout_items i WHERE i.party_type = $2 AND i.order_id = o.id AND i.active)
      ORDER BY COALESCE(o.commission_confirmed_at, o.confirmed_at, o.cancelled_at, o.created_at)`,
    [party, t],
  )).rows;
  const orders = orderRows
    .map((o: any) => ({
      id: o.id as string,
      productName: `${o.product_name}${o.option_name ? ` · ${o.option_name}` : ""}`,
      amount: entitled(t, o),
      confirmedAt: (o.commission_confirmed_at || o.confirmed_at || o.cancelled_at || null) as string | null,
    }))
    .filter((o: any) => o.amount > 0);
  const dedRows = (await client.query(
    `SELECT id, order_id, amount, reason, created_at FROM affiliate_payout_deductions
      WHERE party_type = $1 AND party = $2 AND applied_request_id IS NULL ORDER BY id`,
    [t, party],
  )).rows;
  const deductions = dedRows.map((d: any) => ({ id: Number(d.id), orderId: d.order_id, amount: Number(d.amount), reason: d.reason, createdAt: d.created_at }));
  const orderAmount = orders.reduce((s: number, o: any) => s + o.amount, 0);
  const deductionAmount = deductions.reduce((s: number, d: any) => s + d.amount, 0);
  return { orders, deductions, orderAmount, deductionAmount, available: orderAmount - deductionAmount };
}

/** 정산 화면 상단 숫자: 지급 가능 · 정산 예정 · 지급 신청 중 · 누적 지급. */
export async function payoutSummary(db: any, t: PartyType, party: string) {
  return withTx(db, async (client) => {
    await lockParty(client, t, party);
    await syncDeductions(client, t, party);
    const snap = await availableSnapshot(client, t, party);
    const col = partyColumn(t);
    const pendingRows = (await client.query(
      `SELECT * FROM affiliate_store_orders o WHERE o.${col} = $1 AND o.status = ANY($2::text[])
         ${t === "influencer" ? "AND o.commission_status = 'pending'" : ""}`,
      [party, PENDING_STATUSES],
    )).rows;
    const pending = pendingRows.reduce((s: number, o: any) =>
      s + (t === "brand" ? Math.max(0, brandSettlement(o).amount) : Number(o.commission_amount) || 0), 0);
    const agg = (await client.query(
      `SELECT
         COALESCE(SUM(gross_amount) FILTER (WHERE status = 'requested'), 0)::bigint AS requested_gross,
         COALESCE(SUM(net_amount) FILTER (WHERE status = 'requested'), 0)::bigint AS requested_net,
         COUNT(*) FILTER (WHERE status = 'requested')::int AS requested_count,
         COALESCE(SUM(gross_amount) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_gross,
         COALESCE(SUM(net_amount) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_net
       FROM affiliate_payout_requests WHERE party_type = $1 AND party = $2`,
      [t, party],
    )).rows[0];
    return {
      available: snap.available,
      availableOrderAmount: snap.orderAmount,
      availableDeductionAmount: snap.deductionAmount,
      availableOrders: snap.orders,
      availableDeductions: snap.deductions,
      pending,
      pendingCount: pendingRows.length,
      requested: Number(agg.requested_gross) || 0,
      requestedNet: Number(agg.requested_net) || 0,
      requestedCount: Number(agg.requested_count) || 0,
      paidGross: Number(agg.paid_gross) || 0,
      paid: Number(agg.paid_net) || 0,
    };
  });
}

// ─────────────────────────── 신청 · 취소 · 반려 ───────────────────────────

export interface AccountSnapshot {
  legalName: string;
  bankName: string;
  accountEncrypted: string;
  accountLast4: string;
  accountHolder: string;
  holderMismatch: boolean;
}

export type CreateOutcome =
  | { ok: true; requestId: string }
  | { ok: false; status: number; error: string; code?: string };

/** 지급 가능 금액 전액으로 신청 한 건을 만든다. 대상 주문 · 차감 내역을 신청 건에 고정한다. */
export async function createPayoutRequest(
  db: any,
  t: PartyType,
  party: string,
  account: AccountSnapshot,
  opt: { id: string; minAmount: number },
): Promise<CreateOutcome> {
  return withTx(db, async (client) => {
    await lockParty(client, t, party);
    await syncDeductions(client, t, party);
    const snap = await availableSnapshot(client, t, party);
    if (snap.available <= 0) {
      return { ok: false as const, status: 400, error: "지금 신청할 수 있는 금액이 없어요.", code: "NOTHING_AVAILABLE" };
    }
    if (snap.available < opt.minAmount) {
      return {
        ok: false as const, status: 400, code: "BELOW_MINIMUM",
        error: `최소 신청 금액은 ${opt.minAmount.toLocaleString("ko-KR")}원이에요${t === "influencer" ? "(원천징수 전 기준)" : ""}. 지금 지급 가능 금액은 ${snap.available.toLocaleString("ko-KR")}원이에요.`,
      };
    }
    const tax = t === "influencer" ? withholding(snap.available) : { gross: snap.available, incomeTax: 0, localTax: 0, net: snap.available };
    await client.query(
      `INSERT INTO affiliate_payout_requests
         (id, party_type, party, status, order_amount, deduction_amount, gross_amount, income_tax, local_tax, net_amount,
          scheduled_date, legal_name, bank_name, account_encrypted, account_last4, account_holder, holder_mismatch, payout_method)
       VALUES ($1, $2, $3, 'requested', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'manual')`,
      [opt.id, t, party, snap.orderAmount, snap.deductionAmount, tax.gross, tax.incomeTax, tax.localTax, tax.net,
       scheduledDateFor(), account.legalName, account.bankName, account.accountEncrypted, account.accountLast4,
       account.accountHolder, account.holderMismatch],
    );
    for (const o of snap.orders) {
      await client.query(
        `INSERT INTO affiliate_payout_items (request_id, party_type, party, order_id, product_name, amount, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [opt.id, t, party, o.id, o.productName.slice(0, 200), o.amount, o.confirmedAt],
      );
    }
    if (snap.deductions.length) {
      await client.query(
        `UPDATE affiliate_payout_deductions SET applied_request_id = $1 WHERE id = ANY($2::bigint[]) AND applied_request_id IS NULL`,
        [opt.id, snap.deductions.map((d) => d.id)],
      );
    }
    return { ok: true as const, requestId: opt.id };
  });
}

/**
 * 신청을 되돌린다(신청자 취소 · 운영자 반려). 지급 대기(requested)일 때만.
 *   - 포함 주문은 신청에서 빠져 다시 지급 가능 금액으로 돌아간다(active = false).
 *   - 이 신청에서 뺐던 차감액은 다시 "빼지 않은 차감액"으로 돌아간다.
 *   - 이 신청의 주문에서 생긴 차감액: 아직 빼지 않았으면 지우고, 이미 다른 신청에서 뺐으면 환원(음수)을 남긴다.
 */
export async function releasePayoutRequest(
  db: any,
  id: string,
  next: "cancelled" | "rejected",
  opt: { party?: { type: PartyType; party: string }; operator?: string; reason?: string },
): Promise<{ ok: true; request: any } | { ok: false; status: number; error: string }> {
  return withTx(db, async (client) => {
    const head = (await client.query(`SELECT party_type, party FROM affiliate_payout_requests WHERE id = $1`, [id])).rows[0];
    if (!head || (opt.party && (head.party_type !== opt.party.type || head.party !== opt.party.party))) {
      return { ok: false as const, status: 404, error: "지급 신청을 찾을 수 없어요." };
    }
    await lockParty(client, head.party_type, head.party);
    const cur = (await client.query(`SELECT * FROM affiliate_payout_requests WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (cur.status !== "requested") {
      return { ok: false as const, status: 409, error: cur.status === "paid" ? "이미 지급 완료된 신청이에요." : "이미 처리된 신청이에요." };
    }
    const updated = (await client.query(
      next === "cancelled"
        ? `UPDATE affiliate_payout_requests SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`
        : `UPDATE affiliate_payout_requests SET status = 'rejected', rejected_at = NOW(), rejected_by = $2, reject_reason = $3, updated_at = NOW()
           WHERE id = $1 RETURNING *`,
      next === "cancelled" ? [id] : [id, opt.operator || "", (opt.reason || "").slice(0, 500)],
    )).rows[0];
    await client.query(`UPDATE affiliate_payout_deductions SET applied_request_id = NULL WHERE applied_request_id = $1`, [id]);
    const sourced = (await client.query(
      `SELECT * FROM affiliate_payout_deductions WHERE source_request_id = $1 AND amount > 0`, [id],
    )).rows;
    for (const d of sourced) {
      if (!d.applied_request_id) {
        await client.query(`DELETE FROM affiliate_payout_deductions WHERE id = $1`, [d.id]);
      } else {
        await client.query(
          `INSERT INTO affiliate_payout_deductions (party_type, party, order_id, source_request_id, source_item_id, amount, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [d.party_type, d.party, d.order_id, id, d.source_item_id, -Number(d.amount),
           `차감 환원(차감을 만든 신청이 ${next === "cancelled" ? "취소" : "반려"}됨)`],
        );
      }
    }
    await client.query(`UPDATE affiliate_payout_items SET active = FALSE WHERE request_id = $1`, [id]);
    return { ok: true as const, request: updated };
  });
}

// ─────────────────────────── 조회 ───────────────────────────

/** 신청 건 화면 모양. 계좌는 뒤 4자리만, 암호문은 내보내지 않는다. */
export function shapePayoutRequest(r: any, items: any[] = [], deductions: any[] = []) {
  return {
    id: r.id,
    partyType: r.party_type as PartyType,
    party: r.party,
    status: r.status as "requested" | "paid" | "rejected" | "cancelled",
    orderAmount: Number(r.order_amount) || 0,
    deductionAmount: Number(r.deduction_amount) || 0,
    grossAmount: Number(r.gross_amount) || 0,
    incomeTax: Number(r.income_tax) || 0,
    localTax: Number(r.local_tax) || 0,
    netAmount: Number(r.net_amount) || 0,
    scheduledDate: r.scheduled_date,
    legalName: r.legal_name || "",
    bankName: r.bank_name,
    accountMasked: r.account_last4 ? `****${r.account_last4}` : "",
    accountHolder: r.account_holder,
    holderMismatch: !!r.holder_mismatch,
    payoutMethod: r.payout_method,
    requestedAt: r.requested_at,
    paidAt: r.paid_at,
    paidDate: r.paid_date || "",
    paidBy: r.paid_by || "",
    rejectedAt: r.rejected_at,
    rejectReason: r.reject_reason || "",
    cancelledAt: r.cancelled_at,
    items: items.map((i) => ({ orderId: i.order_id, productName: i.product_name, amount: Number(i.amount) || 0, confirmedAt: i.confirmed_at })),
    deductions: deductions.map((d) => ({ orderId: d.order_id, amount: Number(d.amount) || 0, reason: d.reason, createdAt: d.created_at })),
  };
}

/** 신청 목록 + 포함 주문 + 이 신청에서 뺀 차감 내역. */
export async function loadRequests(db: any, where: { partyType?: PartyType; party?: string; status?: string; scheduledDate?: string }, limit = 200) {
  const t = where.partyType || "";
  const p = where.party || "";
  const st = where.status || "";
  const sd = where.scheduledDate || "";
  const rows = (await db.sql`
    SELECT * FROM affiliate_payout_requests
    WHERE (${t} = '' OR party_type = ${t}) AND (${p} = '' OR party = ${p})
      AND (${st} = '' OR status = ${st}) AND (${sd} = '' OR scheduled_date = ${sd})
    ORDER BY requested_at DESC LIMIT ${limit}
  `) as any[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [items, deds] = await Promise.all([
    db.sql`SELECT * FROM affiliate_payout_items WHERE request_id = ANY(${ids}::text[]) ORDER BY id` as Promise<any[]>,
    db.sql`SELECT * FROM affiliate_payout_deductions WHERE applied_request_id = ANY(${ids}::text[]) ORDER BY id` as Promise<any[]>,
  ]);
  return rows.map((r) => shapePayoutRequest(
    r,
    items.filter((i) => i.request_id === r.id),
    deds.filter((d) => d.applied_request_id === r.id),
  ));
}

// ─────────────────────────── 설정 ───────────────────────────

export const PAYOUT_SETTING_KEYS = {
  minInfluencer: "affiliate_payout_min_influencer",
  minBrand: "affiliate_payout_min_brand",
} as const;
const DEFAULT_MIN = { minInfluencer: 10000, minBrand: 0 };

export async function payoutSettings(db: any): Promise<{ minInfluencer: number; minBrand: number }> {
  const out = { ...DEFAULT_MIN };
  try {
    const rows = (await db.sql`SELECT key, value FROM platform_settings WHERE key = ANY(${Object.values(PAYOUT_SETTING_KEYS)}::text[])`) as any[];
    for (const r of rows) {
      const n = Math.floor(Number(r.value));
      if (!Number.isFinite(n) || n < 0) continue;
      if (r.key === PAYOUT_SETTING_KEYS.minInfluencer) out.minInfluencer = n;
      if (r.key === PAYOUT_SETTING_KEYS.minBrand) out.minBrand = n;
    }
  } catch { /* 기본값 */ }
  return out;
}
