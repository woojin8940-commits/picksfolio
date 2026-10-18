import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import { closePeriod, decryptPii, isPeriod, jsonError, norm, previousPeriod, todayKst, withTransaction } from "./_shared/affiliate.mts";
import { creatorPayoutDate, loadBillingSettings, paymentDueDate } from "./_shared/affiliate-terms.mts";

/**
 * 판매 수수료 월 정산.
 *
 *   GET   /api/affiliate-settlements?scope=brand              브랜드: 내 월별 청구서
 *   GET   /api/affiliate-settlements?scope=creator            인플루언서: 내 지급 내역(브랜드 승인 이후만)
 *   GET   /api/affiliate-settlements?scope=admin&period=      운영자: 전체 + 지급 계좌 제출 여부
 *   PATCH /api/affiliate-settlements { action, ... }
 *           브랜드  brand_approve { batchId }                         draft → brand_approved
 *           운영자  mark_paid_in  { batchId, paidDate, amount, memo, invoiceNo? } brand_approved → paid_in
 *                                 입금액이 청구액과 다르면 memo(사유)가 있어야 한다
 *                   pay_line      { lineId }                          paid_in 일 때만, 지급 정보 제출 필요
 *                   reveal_account { lineId }                         지급 정보 원문(열람 기록이 남는다)
 *                   save_memo     { batchId, memo?, invoiceNo? }
 *                   run_close     { period }                          월 마감 수동 실행
 *
 * 금액은 서버가 주문 장부에서 계산한 것(closePeriod)뿐이다. 이 API 에는 금액을 쓰는
 * 입력이 없다 — 브랜드는 승인만, 운영자는 입금 확인과 지급 처리만 한다. 인플루언서는
 * 읽기만 한다. 상태는 언제나 "이전 상태가 X 일 때만" 바뀐다(조건부 UPDATE).
 *
 * 입금: 브랜드는 픽스폴리오 계좌(플랫폼 설정)로 정산월 다음 달 15일까지 청구 합계를 보낸다.
 * 운영자가 통장을 확인하고 입금 확인을 누르면 인플루언서 지급이 열린다. 인플루언서 지급
 * 예정일은 정산월 다음 달 말일이다.
 *
 * 세금계산서 자동 발행은 추후 연동한다. 지금은 발행 번호를 메모로 남길 수만 있다.
 */

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);
const dateOnly = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const shapeLine = (l: any, account?: any) => ({
  id: String(l.id),
  influencerUsername: String(l.influencer_username),
  salesAmount: Number(l.sales_amount),
  brandFee: Number(l.brand_fee),
  platformFee: Number(l.platform_fee),
  influencerGross: Number(l.influencer_gross),
  incomeTax: Number(l.income_tax),
  localTax: Number(l.local_tax),
  withholding: Number(l.withholding),
  influencerNet: Number(l.influencer_net),
  status: String(l.status),
  paidAt: iso(l.paid_at),
  ...(account !== undefined ? { payoutAccount: account } : {}),
});

const shapeBatch = (b: any, lines: any[]) => ({
  id: String(b.id),
  period: String(b.period),
  businessUsername: String(b.business_username),
  companyName: String(b.company_name || ""),
  status: String(b.status),
  totalSales: Number(b.total_sales),
  brandFee: Number(b.brand_fee),
  vat: Number(b.vat),
  billedTotal: Number(b.billed_total),
  platformFee: Number(b.platform_fee),
  influencerGross: Number(b.influencer_gross),
  brandApprovedAt: iso(b.brand_approved_at),
  paidInAt: iso(b.paid_in_at),
  paidInAmount: Number(b.paid_in_amount),
  paidInDate: dateOnly(b.paid_in_date),
  paidInBy: String(b.paid_in_by || ""),
  paidInMemo: String(b.paid_in_memo || ""),
  // 입금 기한(정산월 다음 달 15일)과 연체 여부. 연체 = 브랜드 승인 이후 기한이 지났는데 입금 확인 전.
  dueDate: paymentDueDate(String(b.period)),
  overdue: ["draft", "brand_approved"].includes(String(b.status)) && todayKst() > paymentDueDate(String(b.period)),
  creatorPayoutDate: creatorPayoutDate(String(b.period)),
  invoiceNo: String(b.invoice_no || ""),
  memo: String(b.memo || ""),
  orderCount: Number(b.order_count),
  lines,
});

/**
 * 지급 정보 제출 여부와 요약. 원천징수 신고에 주민등록번호가 필요하므로 판매 수수료용
 * 지급 정보(성명 · 주민등록번호 · 계좌)를 낸 사람만 "제출"로 본다. 목록에는 가린 값만
 * 싣는다 — 원문은 reveal_account 로 한 사람씩 열어 본다.
 */
async function payoutAccounts(db: any, usernames: string[]) {
  const map = new Map<string, any>();
  if (usernames.length === 0) return map;
  const rows = (await db.sql`
    SELECT username, legal_name, rrn_masked, bank_name, account_number FROM influencer_payout_accounts
    WHERE username = ANY(${usernames}::text[]) AND submitted_at IS NOT NULL AND rrn_encrypted <> ''
  `) as any[];
  for (const r of rows) {
    map.set(r.username, {
      submitted: true,
      legalName: String(r.legal_name || ""),
      rrnMasked: String(r.rrn_masked || ""),
      bankName: String(r.bank_name || ""),
      accountTail: String(r.account_number || "").replace(/\D/g, "").slice(-4),
    });
  }
  for (const u of usernames) if (!map.has(u)) map.set(u, { submitted: false, legalName: "", rrnMasked: "", bankName: "", accountTail: "" });
  return map;
}

async function loadBatches(db: any, where: { business?: string; period?: string; status?: string; ids?: string[] }) {
  const business = where.business || "";
  const period = where.period || "";
  const status = where.status || "";
  const ids = where.ids || null;
  const batches = (await db.sql`
    SELECT * FROM affiliate_settlement_batches
    WHERE (${business} = '' OR business_username = ${business})
      AND (${period} = '' OR period = ${period})
      AND (${status} = '' OR status = ${status})
      AND (${ids === null} OR id = ANY(${ids || []}::text[]))
    ORDER BY period DESC, created_at DESC LIMIT 200
  `) as any[];
  const batchIds = batches.map((b) => b.id);
  const lines = batchIds.length
    ? ((await db.sql`
        SELECT * FROM affiliate_settlement_lines WHERE batch_id = ANY(${batchIds}::text[]) ORDER BY influencer_gross DESC
      `) as any[])
    : [];
  return { batches, lines };
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const scope = url.searchParams.get("scope") || "brand";
    const period = isPeriod(url.searchParams.get("period")) ? String(url.searchParams.get("period")) : "";
    const status = String(url.searchParams.get("status") || "");

    if (scope === "admin") {
      const op = await requireOperator(req);
      if (!op.ok) return op.response;
      const { batches, lines } = await loadBatches(db, { period, status });
      const accounts = await payoutAccounts(db, Array.from(new Set(lines.map((l) => String(l.influencer_username)))));
      return Response.json({
        batches: batches.map((b) =>
          shapeBatch(b, lines.filter((l) => l.batch_id === b.id).map((l) => shapeLine(l, accounts.get(l.influencer_username)))),
        ),
      });
    }

    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;

    if (scope === "creator") {
      const mine = (await db.sql`
        SELECT l.batch_id FROM affiliate_settlement_lines l JOIN affiliate_settlement_batches b ON b.id = l.batch_id
        WHERE l.influencer_username = ${caller.username} AND b.status <> 'draft'
      `) as any[];
      if (mine.length === 0) return Response.json({ batches: [] });
      const { batches, lines } = await loadBatches(db, { ids: mine.map((m) => m.batch_id) });
      return Response.json({
        batches: batches.map((b) => ({
          ...shapeBatch(b, lines.filter((l) => l.batch_id === b.id && l.influencer_username === caller.username).map((l) => shapeLine(l))),
          // 인플루언서에게는 브랜드 청구 금액을 보이지 않는다.
          brandFee: 0, vat: 0, billedTotal: 0, platformFee: 0, paidInAmount: 0, invoiceNo: "", memo: "",
          paidInDate: null, paidInBy: "", paidInMemo: "", dueDate: "", overdue: false,
        })),
      });
    }

    const { batches, lines } = await loadBatches(db, { business: caller.username, period, status });
    const billing = await loadBillingSettings(db);
    return Response.json({
      batches: batches.map((b) => ({
        ...shapeBatch(b, lines.filter((l) => l.batch_id === b.id).map((l) => shapeLine(l))),
        paidInBy: "",
        paidInMemo: "",
      })),
      // 승인한 청구서에 보여 줄 입금 계좌. 운영자가 플랫폼 설정에서 입력한다.
      depositAccount: billing.bankName && billing.accountNumber
        ? { bankName: billing.bankName, accountNumber: billing.accountNumber, accountHolder: billing.accountHolder }
        : null,
    });
  }

  if (req.method !== "PATCH") return jsonError("Method not allowed", 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const batchId = String(body?.batchId || "");

  const respondBatch = async (id: string, admin: boolean) => {
    const { batches, lines } = await loadBatches(db, { ids: [id] });
    const accounts = admin ? await payoutAccounts(db, lines.map((l) => String(l.influencer_username))) : null;
    const b = batches[0];
    return Response.json({
      batch: b ? shapeBatch(b, lines.map((l) => shapeLine(l, accounts ? accounts.get(l.influencer_username) : undefined))) : null,
    });
  };

  if (action === "brand_approve") {
    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;
    const rows = (await db.sql`
      UPDATE affiliate_settlement_batches
      SET status = 'brand_approved', brand_approved_at = NOW(), brand_approved_by = ${caller.username}, updated_at = NOW()
      WHERE id = ${batchId} AND business_username = ${norm(caller.username)} AND status = 'draft'
      RETURNING id
    `) as any[];
    if (!rows[0]) return jsonError("확인 대기 중인 청구서가 아닙니다.", 409);
    return respondBatch(batchId, false);
  }

  const op = await requireOperator(req);
  if (!op.ok) return op.response;

  if (action === "run_close") {
    const period = isPeriod(body?.period) ? body.period : previousPeriod();
    const result = await closePeriod(db, period);
    const { batches, lines } = await loadBatches(db, { period });
    const accounts = await payoutAccounts(db, Array.from(new Set(lines.map((l) => String(l.influencer_username)))));
    return Response.json({
      created: result.batches,
      entries: result.entries,
      batches: batches.map((b) =>
        shapeBatch(b, lines.filter((l) => l.batch_id === b.id).map((l) => shapeLine(l, accounts.get(l.influencer_username)))),
      ),
    });
  }

  if (action === "mark_paid_in") {
    const paidDate = String(body?.paidDate || "");
    const amount = Math.round(Number(body?.amount));
    const memo = String(body?.memo || "").trim().slice(0, 500);
    if (!isDate(paidDate)) return jsonError("입금일을 입력해 주세요.");
    if (paidDate > todayKst()) return jsonError("입금일이 오늘보다 늦습니다.");
    if (!Number.isFinite(amount) || amount <= 0) return jsonError("입금액을 입력해 주세요.");
    const current = ((await db.sql`SELECT billed_total, status FROM affiliate_settlement_batches WHERE id = ${batchId}`) as any[])[0];
    if (!current) return jsonError("청구서를 찾을 수 없습니다.", 404);
    if (amount !== Number(current.billed_total) && !memo) {
      return jsonError("입금액이 청구액과 다릅니다. 사유를 메모로 남겨 주세요.", 400, { code: "amount_mismatch" });
    }
    const rows = (await db.sql`
      UPDATE affiliate_settlement_batches
      SET status = 'paid_in', paid_in_at = NOW(), paid_in_by = ${op.username}, paid_in_amount = ${amount},
          paid_in_date = ${paidDate}::date, paid_in_memo = ${memo},
          invoice_no = COALESCE(NULLIF(${String(body?.invoiceNo || "").slice(0, 80)}, ''), invoice_no),
          updated_at = NOW()
      WHERE id = ${batchId} AND status = 'brand_approved'
      RETURNING id
    `) as any[];
    if (!rows?.[0]) return jsonError("브랜드가 승인한 청구서만 입금 확인할 수 있습니다.", 409);
    return respondBatch(batchId, true);
  }

  if (action === "save_memo") {
    const rows = (await db.sql`
      UPDATE affiliate_settlement_batches
      SET memo = ${String(body?.memo ?? "").slice(0, 500)}, invoice_no = ${String(body?.invoiceNo ?? "").slice(0, 80)}, updated_at = NOW()
      WHERE id = ${batchId} RETURNING id
    `) as any[];
    if (!rows[0]) return jsonError("청구서를 찾을 수 없습니다.", 404);
    return respondBatch(batchId, true);
  }

  // 지급 · 원천징수 신고에 필요한 원문(성명 · 주민등록번호 · 계좌)을 한 사람씩 연다.
  // 누가 언제 열었는지 남긴다. 로그에는 값을 남기지 않는다.
  if (action === "reveal_account") {
    const lineId = String(body?.lineId || "");
    const line = ((await db.sql`SELECT influencer_username FROM affiliate_settlement_lines WHERE id = ${lineId}`) as any[])[0];
    if (!line) return jsonError("지급 내역을 찾을 수 없습니다.", 404);
    const acct = ((await db.sql`
      SELECT legal_name, rrn_encrypted, bank_name, account_number FROM influencer_payout_accounts
      WHERE username = ${line.influencer_username} AND submitted_at IS NOT NULL
    `) as any[])[0];
    if (!acct?.rrn_encrypted) return jsonError("인플루언서가 지급 정보를 아직 제출하지 않았습니다.", 404);
    const rrn = decryptPii(acct.rrn_encrypted);
    if (!rrn) return jsonError("지급 정보를 읽지 못했습니다. 암호화 키 설정을 확인해 주세요.", 500);
    await db.sql`
      INSERT INTO affiliate_pii_access_log (username, viewed_by, purpose)
      VALUES (${line.influencer_username}, ${op.username}, ${`payout:${lineId}`})
    `;
    return Response.json({
      account: {
        legalName: String(acct.legal_name),
        rrn,
        bankName: String(acct.bank_name),
        accountNumber: String(acct.account_number),
      },
    });
  }

  if (action === "pay_line") {
    const lineId = String(body?.lineId || "");
    const line = ((await db.sql`SELECT * FROM affiliate_settlement_lines WHERE id = ${lineId}`) as any[])[0];
    if (!line) return jsonError("지급 내역을 찾을 수 없습니다.", 404);
    const account = (await payoutAccounts(db, [line.influencer_username])).get(line.influencer_username);
    if (!account?.submitted && Number(line.influencer_net) > 0) {
      return jsonError("인플루언서가 지급 정보(성명 · 주민등록번호 · 계좌)를 아직 제출하지 않았습니다.", 409);
    }
    const result = await withTransaction(db, async (q) => {
      const batch = (await q(`SELECT id, status FROM affiliate_settlement_batches WHERE id = $1 FOR UPDATE`, [line.batch_id]))[0];
      if (!batch || batch.status !== "paid_in") return { error: "브랜드 입금이 확인된 청구서만 지급할 수 있습니다." };
      const paid = await q(
        `UPDATE affiliate_settlement_lines SET status = 'paid', paid_at = NOW(), paid_by = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [lineId, op.username],
      );
      if (!paid[0]) return { error: "이미 지급된 내역입니다." };
      const left = await q(`SELECT 1 FROM affiliate_settlement_lines WHERE batch_id = $1 AND status = 'pending' LIMIT 1`, [batch.id]);
      if (left.length === 0) {
        await q(`UPDATE affiliate_settlement_batches SET status = 'completed', updated_at = NOW() WHERE id = $1`, [batch.id]);
      }
      return { ok: true };
    });
    if ("error" in result) return jsonError(result.error as string, 409);
    return respondBatch(line.batch_id, true);
  }

  return jsonError("알 수 없는 요청입니다.");
};

export const config: Config = {
  path: "/api/affiliate-settlements",
};
