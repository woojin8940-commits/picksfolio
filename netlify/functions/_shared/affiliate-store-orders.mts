import { SolapiMessageService } from "solapi";
import { sendPushToUser } from "./push.mts";

/**
 * 어필리에이트 스토어 주문 공통 로직.
 *
 *   - 결제 가드(affiliate_store_checkout_open)와 테스트 계정
 *   - 주문 전액 취소: 포트원 취소 → 재고 복구 → 인플루언서 수수료 취소 (멱등)
 *   - 주문 처리 내역(이벤트) · 화면 알림 + 푸시
 *
 * 로그 규칙: 구매자 개인정보, 결제 키 · 토큰, 포트원 응답 원문은 남기지 않는다.
 * 실패 로그에는 주문번호와 HTTP 상태 · 오류 코드만 남긴다.
 */

export const STORE_TESTERS = new Set(["dnwlsdnwls", "inplace"]);

/** 구매자에게 보이는 주문 상태(결제 대기는 목록에서 뺀다). */
export const LIVE_ORDER_STATUSES = ["paid", "preparing", "shipped", "delivered", "confirmed", "return_requested", "cancelled"];
/** 인플루언서 판매로 세는 상태. 취소된 주문은 수수료도 취소다. */
export const SALE_STATUSES = ["paid", "preparing", "shipped", "delivered", "confirmed", "return_requested"];
/** 구매자가 바로 취소할 수 있는 상태(송장 입력 전). */
export const BUYER_CANCELLABLE = ["paid", "preparing"];
/** 배송 완료 후 교환 · 반품 요청 가능 기간. 지나면 자동 구매확정된다. */
export const RETURN_WINDOW_DAYS = 7;

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

/** 포트원 결제 전액 취소. 이미 취소된 결제면 성공으로 본다(멱등). */
async function portoneCancel(paymentId: string, reason: string): Promise<CancelResult> {
  const secret = process.env.PORTONE_V2_API_SECRET;
  if (!secret) return { ok: false, status: 503, code: "NO_SECRET" };
  const headers = { Authorization: `PortOne ${secret}`, "Content-Type": "application/json" };
  try {
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: reason.slice(0, 200) || "주문 취소" }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.ok) {
      const st = String(json?.cancellation?.status || "");
      if (st === "SUCCEEDED" || st === "REQUESTED") return { ok: true };
      return { ok: false, status: 502, code: st || "UNKNOWN" };
    }
    const type = String(json?.type || "");
    if (type === "PAYMENT_ALREADY_CANCELLED") return { ok: true };
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

  const pc = await portoneCancel(orderId, opt.reason);
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
      order = (await client.query(
        `UPDATE affiliate_store_orders SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
           cancel_reason = $3, cancel_memo = $4, refund_amount = total_amount, commission_status = 'cancelled',
           cancel_lock_at = NULL, brand_seen_at = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [orderId, opt.actorType, opt.reason.slice(0, 100), (opt.memo || "").slice(0, 500)],
      )).rows[0];
      if (opt.inTransaction) await opt.inTransaction(client, order);
      didCancel = true;
      await logEvent(client, orderId, opt.actorType, opt.actor, "cancelled",
        `전액 환불 ${Number(order.total_amount).toLocaleString("ko-KR")}원 · ${opt.reason}${opt.memo ? ` · ${opt.memo}` : ""}`);
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
    || `${order.product_name} 주문이 취소되어 ${Number(order.total_amount).toLocaleString("ko-KR")}원이 전액 환불되었습니다.`,
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


/** 주문 시점에 고정할 플랫폼 수수료율(%). 운영 설정 affiliate_platform_rate, 없으면 0. */
export async function platformRate(db: any): Promise<number> {
  try {
    const rows = (await db.sql`SELECT value FROM platform_settings WHERE key = 'affiliate_platform_rate'`) as any[];
    const n = Number(rows[0]?.value);
    return Number.isFinite(n) && n >= 0 && n < 90 ? n : 0;
  } catch {
    return 0;
  }
}

/** 운영자가 바꿀 수 있는 수수료율 설정 키. */
export const FEE_SETTING_KEYS = {
  platform: "affiliate_platform_rate",
  pgCard: "affiliate_pg_rate_card",
  pgKakaopay: "affiliate_pg_rate_kakaopay",
} as const;
const DEFAULT_PG_RATE = 3.3;

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
  const [platform, pgCard, pgKakaopay] = await Promise.all([
    readRate(db, FEE_SETTING_KEYS.platform, 0),
    readRate(db, FEE_SETTING_KEYS.pgCard, DEFAULT_PG_RATE),
    readRate(db, FEE_SETTING_KEYS.pgKakaopay, DEFAULT_PG_RATE),
  ]);
  return { platform, pgCard, pgKakaopay };
}

/**
 * 브랜드 정산 예정액(표시만 · 지급 없음). 주문에 고정된 수수료율로 계산하므로 설정을 바꿔도
 * 이미 생긴 주문의 값은 그대로다.
 *
 *   정산액 = 결제 금액(상품 + 배송비) − 인플루언서 수수료 − PG 수수료 − 플랫폼 수수료
 *   인플루언서 · 플랫폼 수수료: 상품 금액(배송비 제외) 기준
 *   PG 수수료: 결제 금액 전체(배송비 포함) 기준
 *
 * 전액 취소 · 환불된 주문은 모든 공제가 0 이고 정산 대상이 아니다(included: false).
 */
export function brandSettlement(o: {
  unit_price: number; quantity: number; shipping_fee: number; total_amount?: number;
  commission_amount: number; platform_rate: number | string; pg_rate?: number | string; status?: string;
}) {
  const product = Number(o.unit_price) * Number(o.quantity);
  const shipping = Number(o.shipping_fee) || 0;
  const payment = Number(o.total_amount) || product + shipping;
  if (o.status === "cancelled") {
    return { payment, product, shipping, commission: 0, pgFee: 0, platformFee: 0, amount: 0, included: false };
  }
  const commission = Number(o.commission_amount) || 0;
  const platformFee = Math.floor((product * (Number(o.platform_rate) || 0)) / 100);
  const pgFee = Math.floor((payment * (Number(o.pg_rate) || 0)) / 100);
  return { payment, product, shipping, commission, pgFee, platformFee, amount: payment - commission - pgFee - platformFee, included: true };
}

