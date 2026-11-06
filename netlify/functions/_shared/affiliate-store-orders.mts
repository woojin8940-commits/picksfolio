import { SolapiMessageService } from "solapi";
import { sendPushToUser } from "./push.mts";
import { verifyPortOnePayment } from "./portone-payment.mts";
import { STORE_TESTERS } from "./store-testers.mts";

/**
 * 어필리에이트 스토어 주문 공통 로직.
 *
 *   - 결제 가드(affiliate_store_checkout_open)와 테스트 계정
 *   - 결제 확인(구매자 화면 · 포트원 웹훅 · 시간별 점검이 같은 함수): 검증 → 재고 차감 → 수수료 예정 (멱등)
 *   - 주문 취소: 포트원 취소(발송 전 취소 = 전액 · 반품 = 상품 금액만 부분 취소) → 재고 복구 → 인플루언서 수수료 취소 (멱등)
 *   - 주문 처리 내역(이벤트) · 화면 알림 + 푸시
 *
 * 로그 규칙: 구매자 개인정보, 결제 키 · 토큰, 포트원 응답 원문은 남기지 않는다.
 * 실패 로그에는 주문번호와 HTTP 상태 · 오류 코드만 남긴다.
 */

// 테스트 계정 명단은 store-testers.mts 한 곳에서 관리한다(여기서는 다시 내보내기만).
export { STORE_TESTERS };

/** 구매자에게 보이는 주문 상태(결제 대기는 목록에서 뺀다). */
export const LIVE_ORDER_STATUSES = ["paid", "preparing", "shipped", "delivered", "confirmed", "return_requested", "cancelled"];
/** 인플루언서 판매로 세는 상태. 취소된 주문은 수수료도 취소다. */
export const SALE_STATUSES = ["paid", "preparing", "shipped", "delivered", "confirmed", "return_requested"];
/** 결제 확인으로 결제완료가 될 수 있는 상태. expired: 결제 대기 30분이 지나 정리된 주문(늦게 결제가 확인되면 살린다). */
export const PAYABLE_STATUSES = ["pending_payment", "expired"];
/** 구매자가 바로 취소할 수 있는 상태(송장 입력 전). */
export const BUYER_CANCELLABLE = ["paid", "preparing"];
/** 구매자가 반품을 요청할 수 있는 상태(송장 입력 후 ~ 구매확정 전). */
export const BUYER_RETURNABLE = ["shipped", "delivered"];
/** 배송 완료 후 반품 요청 가능 기간. 지나면 자동 구매확정된다. (배송 중 상태는 기간 제한 없음) */
export const RETURN_WINDOW_DAYS = 7;
/** 반품 거절 뒤 구매확정까지 최소한 남겨 두는 여유(일). 거절 시점부터 반품 기간을 다시 세므로 늘 이보다 길다. */
export const MIN_DAYS_AFTER_RETURN_REJECT = 3;
/** 브랜드가 '배송 완료'를 직접 누를 수 있는 시점: 송장 입력 후 이 시간이 지나야 한다. */
export const DELIVER_MIN_HOURS_AFTER_SHIP = 24;
/** 결제창을 열고 이 시간(분)이 지나도 결제 완료가 안 된 주문은 시간별 점검에서 포트원에 조회해 정리한다. */
export const PENDING_PAYMENT_EXPIRE_MINUTES = 30;
/**
 * (예전 규칙) 단순 변심 반품의 왕복 배송비 차감. 지금은 반품 사유와 관계없이 상품 금액 전액을 환불하고
 * 배송비는 환불하지 않으므로 차감에 쓰지 않는다. 예전 화면 · 응답과의 호환을 위해 이름만 남겨 둔다.
 */
export const PARTIAL_REFUND_REASONS: string[] = [];

/**
 * 반품 환불 금액 = 상품 금액 전액(판매가 × 수량). 반품 사유와 관계없이 같다.
 * 주문 배송비는 환불하지 않는다(왕복 배송비는 브랜드와 구매자가 플랫폼 밖에서 협의).
 * 배송비가 0원이면 상품 금액 = 결제 금액이므로 전액 취소가 된다(partial 없음).
 */
export function returnRefundPlan(o: { unit_price: number; quantity: number; total_amount: number }) {
  const product = Math.max(0, Number(o.unit_price) * Number(o.quantity) || 0);
  const total = Number(o.total_amount) || 0;
  const refundAmount = Math.min(product, total);
  const keptShipping = Math.max(0, total - refundAmount);
  return { refundAmount, keptShipping, full: keptShipping <= 0 };
}

/**
 * 반품 기간 · 자동 구매확정의 기준 시각 = 배송 완료 시각과 반품 거절 시각(return_window_from) 중 늦은 쪽.
 * 반품이 거절되면 그 시점부터 다시 센다. SQL 에서도 같은 식(GREATEST(return_window_from, delivered_at))을 쓴다.
 */
export const returnWindowStart = (o: { return_window_from?: string | Date | null; delivered_at?: string | Date | null }): Date | null => {
  const t = [o.return_window_from, o.delivered_at].filter(Boolean).map((v) => new Date(v as any).getTime()).filter(Number.isFinite);
  return t.length ? new Date(Math.max(...t)) : null;
};

export const CANCEL_FAILED_MESSAGE = "취소 처리에 실패했습니다. 고객센터로 문의해 주세요.";

/** 결제 가드. 'true' 가 아니면 테스트 계정만 결제할 수 있다. */
export async function checkoutOpen(db: any): Promise<boolean> {
  try {
    const rows = (await db.sql`SELECT value FROM platform_settings WHERE key = 'affiliate_store_checkout_open'`) as any[];
    return String(rows[0]?.value || "").trim().toLowerCase() === "true";
  } catch {
    return false; // 확인하지 못하면 닫힌 것으로 본다
  }
}

export async function logEvent(
  q: { query?: any; sql?: any } | any,
  orderId: string,
  actorType: "buyer" | "brand" | "operator" | "system",
  actor: string,
  action: string,
  note = "",
) {
  const text = `INSERT INTO affiliate_store_order_events (order_id, actor_type, actor, action, note) VALUES ($1, $2, $3, $4, $5)`;
  const params = [orderId, actorType, actor, action, note.slice(0, 1000)];
  if (typeof q.query === "function") await q.query(text, params);
  else await q.sql`INSERT INTO affiliate_store_order_events (order_id, actor_type, actor, action, note) VALUES (${orderId}, ${actorType}, ${actor}, ${action}, ${params[4]})`;
}

/**
 * 화면 알림을 남기고, 받을 사람에게 앱 푸시를 보낸다(가능할 때만 · 실패해도 무시).
 * 구매자는 user id 로 남기고, 푸시는 그 구매자가 아이디(인플루언서 · 브랜드)를 가진 경우에만 간다.
 */
export async function notify(
  db: any,
  n: { recipientType: "brand" | "buyer" | "operator"; recipient: string; kind: string; title: string; body?: string; link?: string; pushUsername?: string },
) {
  try {
    await db.sql`
      INSERT INTO affiliate_store_notifications (recipient_type, recipient, kind, title, body, link)
      VALUES (${n.recipientType}, ${n.recipient}, ${n.kind}, ${n.title.slice(0, 200)}, ${(n.body || "").slice(0, 500)}, ${n.link || ""})
    `;
  } catch (e: any) {
    console.error("[affiliate-store] notification insert failed", n.kind, e?.code || "");
  }
  const pushTo = n.recipientType === "brand" ? n.recipient : n.pushUsername || "";
  if (pushTo) {
    sendPushToUser(pushTo, { title: n.title, body: n.body || "", data: { path: n.link || "" } }).catch(() => {});
  }
}

type CancelResult = { ok: true } | { ok: false; status: number; code?: string };

/** 포트원 결제 단건 조회(원본 응답은 로그에 남기지 않는다). */
export async function fetchPortOnePayment(paymentId: string): Promise<{ ok: true; payment: any } | { ok: false; status: number }> {
  const secret = process.env.PORTONE_V2_API_SECRET;
  if (!secret) return { ok: false, status: 503 };
  try {
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `PortOne ${secret}` },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, payment: await res.json() };
  } catch {
    return { ok: false, status: 502 };
  }
}

/**
 * 포트원 결제 취소. partial 이 없으면 전액, 있으면 그 금액만 부분 취소한다.
 * 전액: 이미 취소된 결제면 성공으로 본다(멱등).
 * 부분: currentCancellableAmount 로 "지금 취소 가능 금액이 결제 금액 그대로일 때만" 취소한다. 지난 시도에서
 *       이미 같은 금액이 취소됐다면(마무리 단계만 실패한 경우) 다시 취소하지 않고 성공으로 본다.
 */
async function portoneCancel(paymentId: string, reason: string, partial?: { amount: number; cancellable: number }): Promise<CancelResult> {
  const secret = process.env.PORTONE_V2_API_SECRET;
  if (!secret) return { ok: false, status: 503, code: "NO_SECRET" };
  const headers = { Authorization: `PortOne ${secret}`, "Content-Type": "application/json" };
  try {
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        reason: reason.slice(0, 200) || "주문 취소",
        ...(partial ? { amount: partial.amount, currentCancellableAmount: partial.cancellable } : {}),
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.ok) {
      const st = String(json?.cancellation?.status || "");
      if (st === "SUCCEEDED" || st === "REQUESTED") return { ok: true };
      return { ok: false, status: 502, code: st || "UNKNOWN" };
    }
    const type = String(json?.type || "");
    if (!partial && type === "PAYMENT_ALREADY_CANCELLED") return { ok: true };
    if (partial && (type === "CANCELLABLE_AMOUNT_CONSISTENCY_BROKEN" || type === "PAYMENT_ALREADY_CANCELLED")) {
      const cur = await fetchPortOnePayment(paymentId);
      const cancelled = cur.ok ? Number(cur.payment?.amount?.cancelled) || 0 : -1;
      if (cancelled === partial.amount) return { ok: true };
    }
    return { ok: false, status: res.status, code: type };
  } catch {
    return { ok: false, status: 502, code: "NETWORK" };
  }
}

export interface CancelOptions {
  actorType: "buyer" | "brand" | "operator" | "system";
  actor: string;
  reason: string;
  memo?: string;
  /** 이 상태일 때만 취소한다. */
  allowed: string[];
  /** 접근 범위. 다른 사람 주문이면 찾을 수 없는 것으로 답한다(404). */
  buyerUserId?: string;
  businessUsername?: string;
  /** 같은 트랜잭션에서 함께 처리할 일(반품 요청을 환불 완료로 바꾸는 등). */
  inTransaction?: (client: any, order: any) => Promise<void>;
  /** 재고를 되돌릴지. 결제 확인 단계의 품절 취소처럼 재고를 아직 줄이지 않은 주문은 false. */
  restoreStock?: boolean;
  /** 구매자 문자 문구(생략하면 "취소 · 환불 완료" 기본 문구). */
  buyerSms?: string;
  /**
   * 부분 환불(반품: 상품 금액만 환불 · 배송비는 환불하지 않음). 없으면 전액 환불.
   * refundAmount: 구매자에게 돌려줄 상품 금액, deduction: 환불하지 않은 금액(= 주문 배송비).
   * 상품 금액 전액을 돌려주므로 인플루언서 수수료는 0원(commission_status 'cancelled')이 된다.
   */
  partial?: { refundAmount: number; deduction: number };
}

/**
 * 부분 환불 뒤 남는 상품 금액 · 인플루언서 수수료. 환불액은 상품 금액부터 돌려준 것으로 본다
 * (= 차감액이 원래 배송비를 넘는 만큼만 상품 금액이 남는다).
 */
export function partialRefundSplit(o: { unit_price: number; quantity: number; commission_amount: number }, refundAmount: number) {
  const product = Number(o.unit_price) * Number(o.quantity);
  const productRefunded = Math.min(product, Math.max(0, refundAmount));
  const productKept = product - productRefunded;
  const commission = product > 0 ? Math.floor((Number(o.commission_amount) || 0) * productKept / product) : 0;
  return { product, productRefunded, productKept, commission };
}

export type CancelOutcome =
  | { ok: true; order: any; alreadyCancelled: boolean }
  | { ok: false; status: number; error: string };

/**
 * 주문 전액 취소(멱등). 순서: 처리 중 표시 → 포트원 취소 → (성공 시) 재고 복구 · 주문 취소 ·
 * 수수료 취소를 한 트랜잭션으로. 포트원 취소가 실패하면 주문 상태는 그대로 둔다.
 * 같은 주문을 동시에 여러 번 불러도 포트원 취소는 한 번만 나간다(처리 중 표시를 먼저 잡는다).
 */
export async function cancelOrderFully(db: any, orderId: string, opt: CancelOptions): Promise<CancelOutcome> {
  const buyer = opt.buyerUserId || "";
  const brand = opt.businessUsername || "";
  const partial = opt.partial || null;
  const claimed = (await db.sql`
    UPDATE affiliate_store_orders SET cancel_lock_at = NOW()
    WHERE id = ${orderId}
      AND (${buyer} = '' OR buyer_user_id = ${buyer})
      AND (${brand} = '' OR business_username = ${brand})
      AND status = ANY(${opt.allowed}::text[])
      AND (${opt.actorType} <> 'buyer' OR tracking_number = '')
      AND (cancel_lock_at IS NULL OR cancel_lock_at < NOW() - INTERVAL '3 minutes')
    RETURNING *
  `) as any[];
  if (!claimed[0]) {
    const cur = (await db.sql`
      SELECT * FROM affiliate_store_orders WHERE id = ${orderId}
        AND (${buyer} = '' OR buyer_user_id = ${buyer})
        AND (${brand} = '' OR business_username = ${brand})
    `) as any[];
    if (!cur[0]) return { ok: false, status: 404, error: "주문을 찾을 수 없습니다." };
    if (cur[0].status === "cancelled") return { ok: true, order: cur[0], alreadyCancelled: true };
    if (cur[0].cancel_lock_at && opt.allowed.includes(cur[0].status)) {
      return { ok: false, status: 409, error: "취소를 처리하고 있어요. 잠시 후 다시 확인해 주세요." };
    }
    return { ok: false, status: 400, error: "지금 상태에서는 바로 취소할 수 없어요." };
  }

  const total = Number(claimed[0].total_amount) || 0;
  if (partial && !(partial.refundAmount > 0 && partial.refundAmount < total)) {
    await db.sql`UPDATE affiliate_store_orders SET cancel_lock_at = NULL WHERE id = ${orderId}`;
    return { ok: false, status: 400, error: "환불 금액을 확인해 주세요." };
  }
  const pc = await portoneCancel(orderId, opt.reason, partial ? { amount: partial.refundAmount, cancellable: total } : undefined);
  if (!pc.ok) {
    console.error("[affiliate-store] portone cancel failed", orderId, pc.status, pc.code || "");
    await db.sql`UPDATE affiliate_store_orders SET cancel_lock_at = NULL WHERE id = ${orderId}`;
    return { ok: false, status: 502, error: CANCEL_FAILED_MESSAGE };
  }

  const client = await db.pool.connect();
  let order: any;
  let didCancel = false;
  try {
    await client.query("BEGIN");
    order = (await client.query(`SELECT * FROM affiliate_store_orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (order && order.status !== "cancelled") {
      // 재고 복구(옵션이 있으면 그 옵션으로).
      const prod = opt.restoreStock === false ? null
        : (await client.query(`SELECT options, stock FROM affiliate_store_products WHERE id = $1 FOR UPDATE`, [order.product_id])).rows[0];
      if (prod) {
        const options = Array.isArray(prod.options) ? prod.options : [];
        let stock = Number(prod.stock) || 0;
        if (order.option_name && options.some((o: any) => String(o.name) === order.option_name)) {
          for (const o of options) if (String(o.name) === order.option_name) o.stock = (Number(o.stock) || 0) + order.quantity;
          stock = options.reduce((s: number, o: any) => s + (Number(o.stock) || 0), 0);
        } else {
          stock += order.quantity;
        }
        await client.query(
          `UPDATE affiliate_store_products SET options = $2::jsonb, stock = $3, updated_at = NOW() WHERE id = $1`,
          [order.product_id, JSON.stringify(options), stock],
        );
      }
      const refund = partial ? partial.refundAmount : Number(order.total_amount);
      // 반품은 상품 금액 전액을 돌려주므로 인플루언서 수수료도 0원(취소)이다.
      const keptCommission = 0;
      const beforeCommission = Number(order.commission_amount) || 0;
      order = (await client.query(
        `UPDATE affiliate_store_orders SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
           cancel_reason = $3, cancel_memo = $4, refund_amount = $5,
           commission_amount = CASE WHEN $6::boolean THEN $7 ELSE commission_amount END,
           commission_status = CASE WHEN $6::boolean AND $7 > 0 THEN 'confirmed' ELSE 'cancelled' END,
           commission_confirmed_at = CASE WHEN $6::boolean AND $7 > 0 THEN NOW() ELSE commission_confirmed_at END,
           cancel_lock_at = NULL, brand_seen_at = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [orderId, opt.actorType, opt.reason.slice(0, 100), (opt.memo || "").slice(0, 500), refund, !!partial, keptCommission],
      )).rows[0];
      if (opt.inTransaction) await opt.inTransaction(client, order);
      didCancel = true;
      const amountNote = partial
        ? `반품 환불(상품 금액) ${refund.toLocaleString("ko-KR")}원 · 배송비 ${partial.deduction.toLocaleString("ko-KR")}원 환불 안 함(PG 수수료 뺀 금액 브랜드 정산) · 인플루언서 수수료 ${beforeCommission.toLocaleString("ko-KR")}원 → ${keptCommission.toLocaleString("ko-KR")}원`
        : `전액 환불 ${Number(order.total_amount).toLocaleString("ko-KR")}원`;
      await logEvent(client, orderId, opt.actorType, opt.actor, "cancelled",
        `${amountNote} · ${opt.reason}${opt.memo ? ` · ${opt.memo}` : ""}`);
    }
    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    // 포트원 취소는 이미 끝났다. 다시 부르면 "이미 취소"로 성공 처리되어 마저 정리된다.
    try { await db.sql`UPDATE affiliate_store_orders SET cancel_lock_at = NULL WHERE id = ${orderId}`; } catch { /* 3분 뒤 자동 해제 */ }
    console.error("[affiliate-store] cancel finalize failed", orderId, e?.code || "");
    return { ok: false, status: 500, error: CANCEL_FAILED_MESSAGE };
  } finally {
    client.release();
  }
  // 문자는 취소가 끝난 뒤 보낸다. 실패해도 취소 결과는 그대로다.
  if (didCancel) await sendBuyerSms(order, opt.buyerSms
    || (partial
      ? `${order.product_name} 반품 환불(상품 금액) ${partial.refundAmount.toLocaleString("ko-KR")}원이 처리되었습니다. 배송비는 환불되지 않으며, 필요하면 판매자와 협의해 주세요.`
      : `${order.product_name} 주문이 취소되어 ${Number(order.total_amount).toLocaleString("ko-KR")}원이 전액 환불되었습니다.`),
    orderLink(order.id));
  return { ok: true, order, alreadyCancelled: false };
}

/** 한국 시간 기준 영업일(토 · 일 제외) 수. 공휴일은 따로 빼지 않는다. */
export function businessDaysSince(iso: string | Date, now = new Date()): number {
  const toKstDate = (d: Date) => {
    const k = new Date(d.getTime() + 9 * 3600_000);
    return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  };
  let d = toKstDate(new Date(iso));
  const end = toKstDate(now);
  let count = 0;
  while (d < end) {
    d = new Date(d.getTime() + 86400_000);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

/** 송장 번호로 배송 조회 링크(택배사별). 모르는 택배사는 네이버 검색으로 보낸다. */
export function trackingUrl(company: string, number: string): string {
  const n = encodeURIComponent(String(number || "").replace(/\s/g, ""));
  if (!n) return "";
  switch (company) {
    case "CJ대한통운": return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${n}`;
    case "한진택배": return `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=${n}`;
    case "롯데택배": return `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${n}`;
    case "우체국택배": return `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${n}`;
    case "로젠택배": return `https://www.ilogen.com/web/personal/trace/${n}`;
    case "경동택배": return `https://kdexp.com/service/delivery/etc/delivery.do?barcode=${n}`;
    default: return `https://search.naver.com/search.naver?query=${encodeURIComponent(`${company} ${number}`)}`;
  }
}

// ─────────────────────────── 구매자 문자(솔라피) ───────────────────────────

/** 사이트 주소. 배포 환경의 URL 을 쓰고, 없으면 운영 주소. */
export const siteUrl = () => (process.env.URL || "https://picks-folio.com").replace(/\/+$/, "");
export const orderLink = (orderId: string) => `${siteUrl()}/my/orders/${encodeURIComponent(orderId)}`;
export const inquiriesLink = () => `${siteUrl()}/my/inquiries`;

/**
 * 구매자에게 SMS/LMS(길이에 따라 솔라피가 고른다). 구매자는 앱 푸시를 받지 못해 문자로 알린다.
 * 기존 솔라피 연동 키 · 발신번호(SOLAPI_API_KEY · SOLAPI_API_SECRET · SOLAPI_FROM_NUMBER)를 쓴다.
 *
 * 문자 실패가 주문 처리를 막으면 안 되므로 절대 예외를 던지지 않는다. 실패 로그에는 주문번호와
 * 오류 코드만 남긴다(전화번호 · 문구 · 솔라피 응답 원문은 남기지 않는다).
 */
export async function sendBuyerSms(order: { id?: string; buyer_phone?: string } | null, body: string, link: string): Promise<boolean> {
  const orderId = String(order?.id || "");
  try {
    if (process.env.AFFILIATE_STORE_SMS_DISABLED === "true") return false;
    const apiKey = process.env.SOLAPI_API_KEY || "";
    const apiSecret = process.env.SOLAPI_API_SECRET || "";
    const from = String(process.env.SOLAPI_FROM_NUMBER || "").replace(/\D/g, "");
    if (!apiKey || !apiSecret || !from) {
      console.warn("[affiliate-sms] skipped", orderId, "NOT_CONFIGURED");
      return false;
    }
    const to = String(order?.buyer_phone || "").replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(to)) {
      console.warn("[affiliate-sms] skipped", orderId, "NO_PHONE");
      return false;
    }
    const text = `[픽스폴리오] ${body}\n${link}`.slice(0, 1900);
    await new SolapiMessageService(apiKey, apiSecret).sendOne({ to, from, text });
    return true;
  } catch (e: any) {
    console.warn("[affiliate-sms] failed", orderId, String(e?.errorCode || e?.code || e?.name || "ERROR").slice(0, 40));
    return false;
  }
}


/** 픽스폴리오(플랫폼) 수수료율은 모든 주문에 5% 고정이다. 운영 설정으로 바꾸지 않는다. */
export const PLATFORM_RATE = 5;

/** 주문 시점에 고정할 플랫폼 수수료율(%). 항상 PLATFORM_RATE(5%). */
export async function platformRate(_db?: any): Promise<number> {
  return PLATFORM_RATE;
}

/** 운영자가 바꿀 수 있는 수수료율 설정 키. */
export const FEE_SETTING_KEYS = {
  platform: "affiliate_platform_rate",
  pgCard: "affiliate_pg_rate_card",
  pgKakaopay: "affiliate_pg_rate_kakaopay",
} as const;
/** PG 수수료 기본값(카드 · 카카오페이 모두). 운영 설정이 없거나 읽지 못하면 이 값을 쓴다. */
const DEFAULT_PG_RATE = 4;

async function readRate(db: any, key: string, fallback: number): Promise<number> {
  try {
    const rows = (await db.sql`SELECT value FROM platform_settings WHERE key = ${key}`) as any[];
    const n = Number(rows[0]?.value);
    return rows[0] && Number.isFinite(n) && n >= 0 && n < 50 ? n : fallback;
  } catch {
    return fallback;
  }
}

/** 결제 수단별 PG 수수료율(%). 주문 생성 시점 값을 주문에 고정해 둔다. */
export async function pgRateFor(db: any, payMethod: string): Promise<number> {
  return readRate(db, payMethod === "KAKAOPAY" ? FEE_SETTING_KEYS.pgKakaopay : FEE_SETTING_KEYS.pgCard, DEFAULT_PG_RATE);
}

/** 지금 설정된 수수료율 세 가지(상품 등록 화면의 예상 정산액 · 운영 콘솔 표시용). */
export async function currentFeeRates(db: any) {
  const [pgCard, pgKakaopay] = await Promise.all([
    readRate(db, FEE_SETTING_KEYS.pgCard, DEFAULT_PG_RATE),
    readRate(db, FEE_SETTING_KEYS.pgKakaopay, DEFAULT_PG_RATE),
  ]);
  return { platform: PLATFORM_RATE, pgCard, pgKakaopay };
}

/**
 * 브랜드 정산 예정액(표시만 · 지급 없음). 주문에 고정된 수수료율로 계산하므로 설정을 바꿔도
 * 이미 생긴 주문의 값은 그대로다.
 *
 *   정산액 = 결제 금액(상품 + 배송비) − 인플루언서 수수료 − 이용료(상품 금액 × platform_rate) − PG 수수료(결제 금액 × pg_rate)
 *   인플루언서 수수료 · 이용료: 상품 금액(판매가 × 수량)에만 붙는다(배송비 제외).
 *   PG 수수료: 결제 금액(상품 + 배송비) 기준.
 *
 * 전액 취소 · 환불된 주문은 모든 공제가 0 이고 정산 대상이 아니다(included: false).
 * 반품 환불(상품 금액만 환불)된 주문은 남은 배송비에서 PG 수수료(남은 배송비 × pg_rate)만 떼고 정산한다
 * (인플루언서 수수료 · 이용료 0).
 */
export function brandSettlement(o: {
  unit_price: number; quantity: number; shipping_fee: number; total_amount?: number;
  commission_amount: number; platform_rate: number | string; pg_rate?: number | string; status?: string;
  refund_amount?: number; commission_status?: string;
}) {
  const product = Number(o.unit_price) * Number(o.quantity);
  const shipping = Number(o.shipping_fee) || 0;
  const payment = Number(o.total_amount) || product + shipping;
  if (o.status === "cancelled") {
    const refund = Number(o.refund_amount) || 0;
    const kept = payment - refund;
    if (refund <= 0 || kept <= 0) {
      return { payment, product, shipping, commission: 0, pgFee: 0, platformFee: 0, amount: 0, included: false };
    }
    const productKept = Math.max(0, product - refund);
    const commission = o.commission_status === "cancelled" ? 0 : Number(o.commission_amount) || 0;
    const platformFee = Math.floor((productKept * (Number(o.platform_rate) || 0)) / 100);
    const pgFee = Math.floor((kept * (Number(o.pg_rate) || 0)) / 100);
    return {
      payment: kept, product: productKept, shipping: kept - productKept, commission, pgFee, platformFee,
      amount: kept - commission - pgFee - platformFee, included: true, partialRefund: refund,
    };
  }
  const commission = Number(o.commission_amount) || 0;
  const platformFee = Math.floor((product * (Number(o.platform_rate) || 0)) / 100);
  const pgFee = Math.floor((payment * (Number(o.pg_rate) || 0)) / 100);
  return { payment, product, shipping, commission, pgFee, platformFee, amount: payment - commission - pgFee - platformFee, included: true };
}

// ─────────────────────────── 결제 확인(공용) ───────────────────────────

export type FinalizeOutcome =
  | { ok: true; order: any; justPaid: boolean }
  | { ok: false; status: number; error: string; code?: string };

/**
 * 결제 확인 → 결제완료 처리. 구매자 화면(complete) · 포트원 웹훅 · 시간별 점검이 모두 이 함수를 쓴다.
 *
 *   1) 포트원에서 결제 건을 직접 조회해 금액 · 주문자(customer.id = 구매자 user id)가 주문과 같은지 확인
 *   2) 재고를 조건부 UPDATE 로 원자적으로 줄이고(남은 재고보다 많이 팔리지 않게) 주문을 결제완료 · 수수료 예정으로
 *   3) 재고가 모자라면 결제를 바로 전액 취소
 *
 * 이미 처리된 주문(결제완료 이후 상태)이면 아무것도 하지 않는다(멱등). 같은 주문을 여러 곳에서 동시에
 * 불러도 행 잠금으로 한 번만 처리된다. 결제 대기 시간이 지나 expired 로 정리된 주문도 실제로 결제됐다면
 * 여기서 결제완료로 살린다.
 */
export async function finalizePaidOrder(
  db: any,
  orderId: string,
  opt: { buyerUserId?: string; source: "buyer" | "webhook" | "reconcile" },
): Promise<FinalizeOutcome> {
  const buyer = opt.buyerUserId || "";
  const rows = (await db.sql`
    SELECT * FROM affiliate_store_orders WHERE id = ${orderId} AND (${buyer} = '' OR buyer_user_id = ${buyer})
  `) as any[];
  const order = rows[0];
  if (!order) return { ok: false, status: 404, error: "주문을 찾을 수 없습니다." };
  if (!PAYABLE_STATUSES.includes(order.status)) return { ok: true, order, justPaid: false };

  const verified = await verifyPortOnePayment({
    paymentId: orderId,
    expectedKrw: Number(order.total_amount),
    payMethod: order.pay_method,
    expectedOwner: String(order.buyer_user_id || ""),
  });
  if (verified.ok === false) return { ok: false, status: verified.status, error: verified.error };

  let soldOut = false;
  let justPaid = false;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const locked = (await client.query(`SELECT status FROM affiliate_store_orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (locked && PAYABLE_STATUSES.includes(locked.status)) {
      let ok = false;
      if (order.option_name) {
        // 옵션 재고: 해당 옵션의 stock 이 수량 이상일 때만 그 옵션과 합계를 함께 줄인다.
        const r = await client.query(
          `UPDATE affiliate_store_products p SET
             options = (SELECT jsonb_agg(CASE WHEN e->>'name' = $2
                          THEN jsonb_set(e, '{stock}', to_jsonb((e->>'stock')::int - $3)) ELSE e END ORDER BY ord)
                        FROM jsonb_array_elements(p.options) WITH ORDINALITY AS t(e, ord)),
             stock = p.stock - $3, updated_at = NOW()
           WHERE p.id = $1 AND p.stock >= $3
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.options) e WHERE e->>'name' = $2 AND (e->>'stock')::int >= $3)
           RETURNING p.id`,
          [order.product_id, order.option_name, order.quantity],
        );
        ok = r.rowCount === 1;
      } else {
        const r = await client.query(
          `UPDATE affiliate_store_products SET stock = stock - $2, updated_at = NOW() WHERE id = $1 AND stock >= $2 RETURNING id`,
          [order.product_id, order.quantity],
        );
        ok = r.rowCount === 1;
      }
      if (ok) {
        await client.query(
          `UPDATE affiliate_store_orders SET status = 'paid', pg_tx_id = $2, paid_at = NOW(), commission_status = 'pending', updated_at = NOW() WHERE id = $1`,
          [orderId, String(verified.payment.pgTxId || "")],
        );
        justPaid = true;
      } else {
        soldOut = true;
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  if (soldOut) {
    // 재고를 줄이지 않았으므로 되돌릴 재고도 없다(restoreStock: false).
    const r = await cancelOrderFully(db, orderId, {
      actorType: "system", actor: "", reason: "품절", allowed: PAYABLE_STATUSES, restoreStock: false,
      buyerSms: `${order.product_name} 주문이 품절로 결제가 취소되었습니다. 결제 금액은 전액 환불됩니다.`,
    });
    if (r.ok === false) {
      console.error("[affiliate-store] sold-out cancel failed", orderId);
      return { ok: false, status: 409, error: "품절로 결제를 취소하지 못했습니다. 고객센터로 문의해 주세요." };
    }
    return { ok: false, status: 409, error: "품절로 결제가 취소되었습니다.", code: "SOLD_OUT" };
  }

  const fresh = ((await db.sql`SELECT * FROM affiliate_store_orders WHERE id = ${orderId}`) as any[])[0];
  if (justPaid && fresh) {
    const via = opt.source === "buyer" ? "" : opt.source === "webhook" ? " · 결제 알림(웹훅)으로 확인" : " · 결제 누락 점검으로 확인";
    await logEvent(db, orderId, opt.source === "buyer" ? "buyer" : "system", "", "paid",
      `결제 완료 ${Number(fresh.total_amount).toLocaleString("ko-KR")}원${via}`).catch(() => {});
    await notify(db, {
      recipientType: "brand", recipient: fresh.business_username, kind: "new_order",
      title: "새 주문이 들어왔어요",
      body: `${fresh.product_name}${fresh.option_name ? ` · ${fresh.option_name}` : ""} ${fresh.quantity}개 (@${fresh.influencer_username} 링크)`,
      link: "/business-admin?tab=affiliate",
    });
    await sendBuyerSms(fresh, `${fresh.product_name} 결제가 완료되었습니다(${Number(fresh.total_amount).toLocaleString("ko-KR")}원). 주문 상세에서 배송 상황을 확인할 수 있어요.`, orderLink(orderId));
  }
  return { ok: true, order: fresh || order, justPaid };
}
