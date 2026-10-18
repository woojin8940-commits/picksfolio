/**
 * 판매 연동형(어필리에이트) 캠페인의 규칙이 모이는 곳.
 *
 * 주문 수신(api-affiliate-collect) · 매일 동기화(scheduled-affiliate-sync) · 운영자
 * 재검증(api-affiliate-orders) · 월 마감(scheduled-affiliate-close, 운영자 수동 마감)이
 * 모두 같은 함수를 쓴다. 규칙이 한 곳에 있어야 "수신할 때 계산한 수수료"와 "마감할 때
 * 계산한 수수료"가 어긋나지 않는다.
 *
 * 돈 계산은 전부 정수(원)로 한다. 비율은 % 를 100배 한 정수(bps)로 바꿔 곱한다 —
 * 12.5% × 33,000원 같은 계산이 부동소수점 때문에 1원씩 흔들리지 않게.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import {
  type Cafe24Connection,
  type Cafe24Order,
  connectionForMall,
  connectionHealth,
  fetchOrder,
} from "./cafe24-api.mts";

export const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");
export const jsonError = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  Response.json({ error: message, ...extra }, { status });

/** 클릭 후 이 일수 안의 구매만 인정한다(마지막 클릭 기준). */
export const ATTRIBUTION_DAYS = 7;
/** 이 횟수만큼 확인하지 못한 주문은 "검증 실패"로 닫는다(하루 1회 재시도이므로 약 2주). */
export const MAX_VERIFY_ATTEMPTS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** 인플루언서가 게시물에 넣어야 하는 광고 표기 안내. 캠페인마다 자동으로 붙는다. */
export const DISCLOSURE_TEXT =
  "이 캠페인은 판매 수수료를 받는 광고입니다. 게시물·스토리·DM 등 상품을 소개하는 모든 곳에 " +
  "'광고' 또는 '#광고'를 잘 보이게 표기해 주세요. (표시광고법·추천보증 심사지침)";

/** 추적 한계 안내. 브랜드 연동 화면과 캠페인 등록 화면에 그대로 보인다. */
export const TRACKING_NOTICE =
  "네이버페이·카카오페이 등 외부 간편결제로 주문이 끝나 주문완료 페이지를 거치지 않거나, " +
  "광고 차단 기능을 쓰는 브라우저에서는 주문이 집계되지 않을 수 있습니다. " +
  "집계되지 않은 주문에는 수수료가 청구되지 않으며, 보완 방법을 준비하고 있습니다.";

// ── 설정 ──────────────────────────────────────────────────────────────────

export type AffiliateSettings = { platformRate: number; autoConfirmDays: number; attributionDays: number };

export const SETTING_KEYS = {
  platformRate: "affiliate_platform_rate",
  autoConfirmDays: "affiliate_auto_confirm_days",
} as const;

const DEFAULT_SETTINGS: AffiliateSettings = { platformRate: 5, autoConfirmDays: 14, attributionDays: ATTRIBUTION_DAYS };

export async function loadSettings(db: any): Promise<AffiliateSettings & { updatedAt: string | null; updatedBy: string }> {
  try {
    const rows = (await db.sql`
      SELECT key, value, updated_by, updated_at FROM platform_settings
      WHERE key IN (${SETTING_KEYS.platformRate}, ${SETTING_KEYS.autoConfirmDays})
    `) as any[];
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const rate = Number(byKey.get(SETTING_KEYS.platformRate)?.value);
    const days = Number(byKey.get(SETTING_KEYS.autoConfirmDays)?.value);
    const latest = rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    return {
      platformRate: Number.isFinite(rate) ? rate : DEFAULT_SETTINGS.platformRate,
      autoConfirmDays: Number.isFinite(days) ? days : DEFAULT_SETTINGS.autoConfirmDays,
      attributionDays: ATTRIBUTION_DAYS,
      updatedAt: latest?.updated_at ? new Date(latest.updated_at).toISOString() : null,
      updatedBy: String(latest?.updated_by || ""),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: "" };
  }
}

// ── 돈 ─────────────────────────────────────────────────────────────────────

export const toBps = (rate: unknown) => Math.round(Number(rate || 0) * 100);

export function feesFor(base: number, commissionRate: unknown, platformRate: unknown) {
  const b = Math.max(0, Math.trunc(base));
  const brandFee = Math.floor((b * toBps(commissionRate)) / 10000);
  const platformFee = Math.min(brandFee, Math.floor((b * toBps(platformRate)) / 10000));
  return { brandFee, platformFee, influencerFee: brandFee - platformFee };
}

/**
 * 사업소득 원천징수 3.3% = 소득세 3% + 지방소득세(소득세의 10%).
 * 국세·지방세 모두 10원 미만은 버린다. 0원 이하(마감 후 반품 차감으로 음수가 된 달)는 0.
 */
export function withholdingFor(gross: number) {
  if (gross <= 0) return { incomeTax: 0, localTax: 0, withholding: 0, net: gross };
  const incomeTax = Math.floor((gross * 3) / 100 / 10) * 10;
  const localTax = Math.floor(incomeTax / 10 / 10) * 10;
  return { incomeTax, localTax, withholding: incomeTax + localTax, net: gross - incomeTax - localTax };
}

/** 인플루언서 몫(%). 소수 둘째 자리까지. */
export const creatorRateOf = (commission: unknown, platform: unknown) =>
  Math.max(0, (toBps(commission) - toBps(platform)) / 100);

// ── 식별자 · 해시 ───────────────────────────────────────────────────────────

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 추적 코드. 추측하기 어렵게 10자(약 49비트). */
export function newCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;

/** IP·UA 해시. 원본은 어디에도 남기지 않는다. 서버 비밀값을 섞어 되돌려 찾을 수 없게 한다. */
export function hashValue(value: string): string {
  const secret = process.env.AFFILIATE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "picksfolio-affiliate";
  return createHmac("sha256", secret).update(String(value || "")).digest("hex").slice(0, 32);
}

/** 로그용 주문번호: 뒤 4자리만 남긴다. */
export const maskOrderNo = (orderNo: string) => {
  const s = String(orderNo || "");
  return s.length <= 4 ? "****" : `${"*".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
};

// ── 주민등록번호 ─────────────────────────────────────────────────────────────

/**
 * 주민등록번호 암호화 키. AFFILIATE_PII_KEY 를 따로 두는 것이 원칙이다. 없으면 서버
 * 비밀값에서 용도를 붙여 키를 만든다 — 그 비밀값을 바꾸면 저장된 번호를 읽을 수 없게
 * 되므로, 운영 전에는 AFFILIATE_PII_KEY 를 설정해 두어야 한다.
 */
function piiKey(): Buffer | null {
  const raw = process.env.AFFILIATE_PII_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!raw) return null;
  return createHash("sha256").update(`picksfolio-affiliate-pii-v1:${raw}`).digest();
}

export const piiReady = () => piiKey() !== null;

/** 'v1.<iv>.<tag>.<암호문>' (base64url) */
export function encryptPii(plain: string): string {
  const key = piiKey();
  if (!key) throw new Error("pii key missing");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptPii(stored: string): string {
  const key = piiKey();
  const [v, iv, tag, enc] = String(stored || "").split(".");
  if (!key || v !== "v1" || !iv || !tag || !enc) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(enc, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * 주민등록번호 형식 확인. 13자리 숫자, 앞 6자리가 실제 날짜, 7번째 자리가 성별·세기 코드.
 * 2020년 10월 이후 발급 번호는 검증 숫자 규칙을 따르지 않으므로 검증 숫자는 보지 않는다.
 * 맞으면 '######-#######' 꼴로 돌려준다.
 */
export function normalizeRrn(raw: unknown): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length !== 13) return null;
  const g = Number(digits[6]);
  if (g < 1 || g > 8) return null;
  const century = g <= 2 || g === 5 || g === 6 ? 1900 : 2000;
  const y = century + Number(digits.slice(0, 2));
  const m = Number(digits.slice(2, 4));
  const d = Number(digits.slice(4, 6));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

/** '900101-1******' — 생년월일과 성별 자리만 남긴다. */
export const maskRrn = (rrn: string) => (rrn.length >= 8 ? `${rrn.slice(0, 8)}******` : "");

// ── 트랜잭션 ────────────────────────────────────────────────────────────────

export type Tx = (text: string, params?: unknown[]) => Promise<any[]>;

/** 여러 쓰기를 한 트랜잭션으로 묶는다. 하나라도 실패하면 전부 되돌린다. */
export async function withTransaction<T>(db: any, fn: (q: Tx) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async (text, params = []) => (await client.query(text, params)).rows);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── 주문 판정 ───────────────────────────────────────────────────────────────

export type OrderEvaluation = {
  verification: "unverified" | "verified";
  status: "pending" | "confirmed" | "excluded";
  reason: string;
  orderedAt: string | null;
  grossBase: number;
  refunded: number;
  base: number;
  deliveredAt: string | null;
  shopStatus: string;
  items: {
    itemCode: string;
    productNo: string;
    campaignProductId: string;
    quantity: number;
    paidAmount: number;
    refundedQuantity: number;
    refundedAmount: number;
    status: string;
  }[];
};

const isRefundStatus = (statusCode: string, orderStatus: string) =>
  /^C[123]$/.test(statusCode) || statusCode === "C3" || /^[CR]\d/.test(orderStatus);

/**
 * 카페24 주문을 우리 규칙으로 판정한다.
 *
 *   · 결제 전(무통장 입금 대기)은 아직 미검증 — 입금되면 다음 동기화에서 확인된다.
 *   · 캠페인 상품 품목만 수수료 대상. 같은 주문의 다른 상품은 빠진다.
 *   · 품목 실결제액(할인 후, 배송비 제외)이 기준. 취소·반품된 수량만큼 비례해서 뺀다.
 *   · 모든 남은 품목이 구매확정(N50 또는 구매확정일)이면 확정. 배송완료 후
 *     autoConfirmDays 가 지나도 구매확정이 오지 않으면 확정으로 본다.
 *   · 남은 금액이 0 이면 제외(전체 취소·반품).
 */
export function evaluateOrder(
  order: Cafe24Order,
  productMap: Map<string, string>,
  autoConfirmDays: number,
  now = Date.now(),
): OrderEvaluation {
  const base: OrderEvaluation = {
    verification: "verified",
    status: "pending",
    reason: "",
    orderedAt: order.orderedAt,
    grossBase: 0,
    refunded: 0,
    base: 0,
    deliveredAt: null,
    shopStatus: "",
    items: [],
  };

  if (!order.paid && !order.canceled) {
    return { ...base, verification: "unverified", reason: "awaiting_payment" };
  }

  const items = order.items
    .filter((it) => productMap.has(it.productNo))
    .map((it) => {
      const refundedQuantity = isRefundStatus(it.statusCode, it.orderStatus)
        ? Math.min(it.quantity, it.claimQuantity > 0 ? it.claimQuantity : it.quantity)
        : 0;
      const refundedAmount =
        it.quantity > 0 ? Math.floor((it.paidAmount * refundedQuantity) / it.quantity) : refundedQuantity > 0 ? it.paidAmount : 0;
      return { ...it, refundedQuantity, refundedAmount, campaignProductId: productMap.get(it.productNo) || "" };
    });

  if (items.length === 0) return { ...base, status: "excluded", reason: "no_campaign_product" };

  const grossBase = items.reduce((s, it) => s + it.paidAmount, 0);
  const refunded = items.reduce((s, it) => s + it.refundedAmount, 0);
  const net = Math.max(0, grossBase - refunded);
  const live = items.filter((it) => it.refundedQuantity < it.quantity);
  const shopStatus = Array.from(new Set(items.map((it) => it.orderStatus).filter(Boolean))).join(",");
  const delivered = live
    .map((it) => it.deliveredAt)
    .filter((d): d is string => !!d)
    .sort()
    .pop() || null;

  const evaluation: OrderEvaluation = {
    ...base,
    grossBase,
    refunded,
    base: net,
    deliveredAt: delivered,
    shopStatus,
    items: items.map((it) => ({
      itemCode: it.itemCode,
      productNo: it.productNo,
      campaignProductId: it.campaignProductId,
      quantity: it.quantity,
      paidAmount: it.paidAmount,
      refundedQuantity: it.refundedQuantity,
      refundedAmount: it.refundedAmount,
      status: it.orderStatus || it.statusCode,
    })),
  };

  if (net <= 0 || live.length === 0 || order.canceled && net <= 0) {
    return { ...evaluation, status: "excluded", reason: "cancelled_or_returned" };
  }

  const allConfirmed = live.every((it) => it.purchaseConfirmedAt || it.orderStatus === "N50");
  if (allConfirmed) return { ...evaluation, status: "confirmed", reason: "purchase_confirmed" };

  const allDelivered = live.every((it) => it.orderStatus === "N40" || it.orderStatus === "N50" || it.deliveredAt);
  const deliveredMs = delivered ? Date.parse(delivered) : NaN;
  if (allDelivered && Number.isFinite(deliveredMs) && now - deliveredMs >= autoConfirmDays * DAY_MS) {
    return { ...evaluation, status: "confirmed", reason: "auto_confirm" };
  }
  return { ...evaluation, status: "pending", reason: delivered ? "delivered" : "in_progress" };
}

// ── 주문 검증 · 갱신 ─────────────────────────────────────────────────────────

/**
 * 장부의 주문 한 건을 카페24 에서 다시 조회해 갱신한다. 수신 직후 · 매일 동기화 ·
 * 운영자 재검증이 모두 이 함수를 쓴다.
 *
 * 확인되지 않은 주문은 금액을 0 으로 둔 채 "미검증"으로 남는다 — 정산은 verified 만 본다.
 * 이미 확정된 주문은 확정 상태를 유지하되(반품이 나면 금액이 줄거나 제외로 바뀐다),
 * 확정 시각은 처음 확정된 때로 둔다.
 */
export async function syncOrder(
  db: any,
  orderId: string,
  opts: { settings?: AffiliateSettings; conn?: Cafe24Connection | null } = {},
): Promise<{ ok: boolean; status: string; verification: string; reason: string }> {
  const rows = (await db.sql`
    SELECT o.*, c.commission_rate AS c_rate, c.platform_rate AS c_platform
    FROM affiliate_orders o JOIN affiliate_campaigns c ON c.id = o.campaign_id
    WHERE o.id = ${orderId}
  `) as any[];
  const row = rows[0];
  if (!row) return { ok: false, status: "", verification: "", reason: "not_found" };

  const settings = opts.settings || (await loadSettings(db));
  const conn = opts.conn !== undefined ? opts.conn : await connectionForMall(db, row.mall_id);
  const health = connectionHealth(conn);

  const markAttempt = async (reason: string) => {
    // 무통장 입금 대기는 실패가 아니다 — 입금되거나(확인) 입금 기한이 지나 카페24 가 취소하면
    // (제외) 저절로 끝난다. 매시간 재확인하므로 시도 횟수에 넣으면 하루 만에 포기하게 된다.
    const attempts = Number(row.verify_attempts || 0) + (reason === "awaiting_payment" ? 0 : 1);
    const giveUp = row.verification === "unverified" && attempts >= MAX_VERIFY_ATTEMPTS;
    await db.sql`
      UPDATE affiliate_orders
      SET verify_attempts = ${attempts},
          verification = CASE WHEN ${giveUp} THEN 'failed' ELSE verification END,
          status_reason = ${reason},
          last_synced_at = NOW(), updated_at = NOW()
      WHERE id = ${orderId}
    `;
    return { ok: false, status: row.status, verification: giveUp ? "failed" : row.verification, reason };
  };

  if (!health.usable || !conn) return markAttempt(`shop_${health.reason || "unavailable"}`);

  let order: Cafe24Order | null;
  try {
    order = await fetchOrder(conn, row.shop_order_id);
  } catch {
    return markAttempt("shop_api_error");
  }
  if (!order) return markAttempt("order_not_found");

  const products = (await db.sql`
    SELECT id, shop_product_id FROM affiliate_campaign_products WHERE campaign_id = ${row.campaign_id}
  `) as any[];
  const productMap = new Map(products.map((p) => [String(p.shop_product_id), String(p.id)]));
  const ev = evaluateOrder(order, productMap, settings.autoConfirmDays);

  if (ev.verification === "unverified") return markAttempt(ev.reason);

  // 처음 확인될 때 귀속을 서버에서 다시 본다: 주문 시각 기준 7일 안에 이 코드의 클릭이
  // 있어야 한다. 스크립트가 보낸 코드만으로는 인정하지 않는다.
  let status = ev.status;
  let reason = ev.reason;
  if (row.verification !== "verified") {
    const orderedMs = ev.orderedAt ? Date.parse(ev.orderedAt) : NaN;
    const at = Number.isFinite(orderedMs) ? new Date(orderedMs) : new Date(row.received_at);
    const since = new Date(at.getTime() - ATTRIBUTION_DAYS * DAY_MS);
    // 카페24 주문 시각은 초 단위이고 두 서버 시계가 조금씩 다르다. 주문 직전 클릭이
    // "주문 뒤 클릭"으로 잘못 읽히지 않도록 몇 분의 여유를 둔다.
    const until = new Date(at.getTime() + CLOCK_SKEW_MS);
    const click = (await db.sql`
      SELECT 1 FROM affiliate_clicks
      WHERE code = ${row.code} AND clicked_at <= ${until.toISOString()} AND clicked_at >= ${since.toISOString()}
      LIMIT 1
    `) as any[];
    if (click.length === 0) {
      status = "excluded";
      reason = "no_click_in_window";
    }
  }
  // 확정은 되돌리지 않는다. 확정 뒤 반품이 나면 금액이 줄거나 제외로 바뀐다.
  if (row.status === "confirmed" && status === "pending") status = "confirmed";
  if (row.status === "excluded" && row.status_reason === "no_click_in_window") {
    status = "excluded";
    reason = "no_click_in_window";
  }

  const fees = status === "excluded" ? { brandFee: 0, platformFee: 0, influencerFee: 0 } : feesFor(ev.base, row.c_rate, row.c_platform);

  await withTransaction(db, async (q) => {
    await q(
      `UPDATE affiliate_orders SET
         verification = 'verified',
         verified_at = COALESCE(verified_at, NOW()),
         ordered_at = COALESCE($2::timestamptz, ordered_at),
         gross_base = $3, refunded_amount = $4, commission_base = $5,
         commission_rate = $6, platform_rate = $7,
         brand_fee = $8, platform_fee = $9, influencer_fee = $10,
         status = $11, status_reason = $12, shop_status = $13,
         delivered_at = $14::timestamptz,
         confirmed_at = CASE WHEN $11 = 'confirmed' THEN COALESCE(confirmed_at, NOW()) ELSE confirmed_at END,
         last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [
        orderId,
        ev.orderedAt,
        ev.grossBase,
        ev.refunded,
        status === "excluded" ? 0 : ev.base,
        row.c_rate,
        row.c_platform,
        fees.brandFee,
        fees.platformFee,
        fees.influencerFee,
        status,
        reason,
        ev.shopStatus.slice(0, 120),
        ev.deliveredAt,
      ],
    );
    await q(`DELETE FROM affiliate_order_items WHERE order_id = $1`, [orderId]);
    for (const it of ev.items) {
      await q(
        `INSERT INTO affiliate_order_items
           (order_id, shop_item_code, shop_product_id, campaign_product_id, quantity, paid_amount,
            refunded_quantity, refunded_amount, item_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (order_id, shop_item_code) DO NOTHING`,
        [orderId, it.itemCode || `${it.productNo}`, it.productNo, it.campaignProductId, it.quantity, it.paidAmount, it.refundedQuantity, it.refundedAmount, it.status.slice(0, 40)],
      );
    }
  });

  return { ok: true, status, verification: "verified", reason };
}

// ── 월 마감 ─────────────────────────────────────────────────────────────────

/** 'YYYY-MM' 의 다음 달 1일 00:00(한국 시간)을 UTC 로. 이 시각 전에 확정된 주문이 대상이다. */
export function periodCutoff(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  // KST = UTC+9 → 다음 달 1일 00:00 KST = 전날 15:00 UTC
  return new Date(Date.UTC(y, m, 1, -9, 0, 0));
}

/** 한국 시간 기준 전월('YYYY-MM'). */
export function previousPeriod(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth(); // 0-based → 이번 달 index = 전월 번호
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}

export const isPeriod = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/**
 * 월 마감. period 이전(다음 달 1일 0시 전)까지 확정된 주문 중 아직 정산에 들어가지 않은
 * 금액을 브랜드별 청구서 · 인플루언서별 지급 내역으로 묶는다.
 *
 *   · 대상 금액 = (확정이면 지금 수수료, 제외면 0) − 이미 정산된 합계(entries).
 *     마감 뒤 반품은 음수 차감으로 다음 마감에 들어간다. 지난 정산은 고치지 않는다.
 *   · 미검증·검증 실패 주문은 들어가지 않는다. 예정(미확정) 주문도 들어가지 않는다.
 *   · 같은 달 청구서가 이미 브랜드 승인 이후 단계면 손대지 않는다 — 그 금액은 다음 달로 넘어간다.
 *   · 브랜드 하나를 한 트랜잭션으로 처리하고, 마감 전체는 advisory lock 으로 한 번에 하나만 돈다.
 */
export async function closePeriod(db: any, period: string): Promise<{ batches: number; entries: number }> {
  if (!isPeriod(period)) throw new Error("invalid period");
  const cutoff = periodCutoff(period).toISOString();

  const businesses = (await db.sql`
    SELECT DISTINCT o.business_username
    FROM affiliate_orders o
    WHERE o.verification = 'verified'
      AND (
        (o.status = 'confirmed' AND o.confirmed_at < ${cutoff})
        OR EXISTS (SELECT 1 FROM affiliate_settlement_entries e WHERE e.order_id = o.id)
      )
  `) as any[];

  let batchCount = 0;
  let entryCount = 0;
  for (const b of businesses) {
    const business = String(b.business_username);
    const result = await withTransaction(db, async (q) => {
      await q(`SELECT pg_advisory_xact_lock(hashtext('affiliate_close'))`);

      const existing = await q(
        `SELECT id, status FROM affiliate_settlement_batches WHERE period = $1 AND business_username = $2 FOR UPDATE`,
        [period, business],
      );
      if (existing[0] && existing[0].status !== "draft") return { created: false, entries: 0 };

      // 주문별 차액. 확정(마감 시각 전) 또는 이미 정산된 적 있는 주문만.
      const deltas = await q(
        `SELECT o.id, o.influencer_username,
                (CASE WHEN o.status = 'confirmed' AND o.confirmed_at < $2 THEN o.commission_base ELSE 0 END) - COALESCE(s.base, 0) AS d_base,
                (CASE WHEN o.status = 'confirmed' AND o.confirmed_at < $2 THEN o.brand_fee ELSE 0 END) - COALESCE(s.brand, 0) AS d_brand,
                (CASE WHEN o.status = 'confirmed' AND o.confirmed_at < $2 THEN o.platform_fee ELSE 0 END) - COALESCE(s.platform, 0) AS d_platform,
                (CASE WHEN o.status = 'confirmed' AND o.confirmed_at < $2 THEN o.influencer_fee ELSE 0 END) - COALESCE(s.influencer, 0) AS d_influencer,
                COALESCE(s.n, 0) AS settled_n
         FROM affiliate_orders o
         LEFT JOIN (
           SELECT order_id, SUM(base_amount) AS base, SUM(brand_fee) AS brand, SUM(platform_fee) AS platform,
                  SUM(influencer_fee) AS influencer, COUNT(*) AS n
           FROM affiliate_settlement_entries GROUP BY order_id
         ) s ON s.order_id = o.id
         WHERE o.business_username = $1 AND o.verification = 'verified'
           AND ((o.status = 'confirmed' AND o.confirmed_at < $2) OR s.order_id IS NOT NULL)
         FOR UPDATE OF o`,
        [business, cutoff],
      );
      const changed = deltas.filter(
        (d: any) => Number(d.d_base) !== 0 || Number(d.d_brand) !== 0 || Number(d.d_influencer) !== 0 || Number(d.d_platform) !== 0,
      );
      if (changed.length === 0) return { created: false, entries: 0 };

      const companyRows = await q(
        `SELECT company_name FROM affiliate_campaigns WHERE business_username = $1 AND company_name <> '' ORDER BY created_at DESC LIMIT 1`,
        [business],
      );
      const batchId = existing[0]?.id || newId("afb");
      if (!existing[0]) {
        await q(
          `INSERT INTO affiliate_settlement_batches (id, period, business_username, company_name) VALUES ($1,$2,$3,$4)`,
          [batchId, period, business, String(companyRows[0]?.company_name || "")],
        );
      }

      const lineIds = new Map<string, string>();
      for (const d of changed) {
        const inf = String(d.influencer_username);
        let lineId = lineIds.get(inf);
        if (!lineId) {
          const found = await q(
            `SELECT id FROM affiliate_settlement_lines WHERE batch_id = $1 AND influencer_username = $2`,
            [batchId, inf],
          );
          lineId = found[0]?.id || newId("afl");
          if (!found[0]) {
            await q(
              `INSERT INTO affiliate_settlement_lines (id, batch_id, period, business_username, influencer_username)
               VALUES ($1,$2,$3,$4,$5)`,
              [lineId, batchId, period, business, inf],
            );
          }
          lineIds.set(inf, lineId!);
        }
        await q(
          `INSERT INTO affiliate_settlement_entries (line_id, order_id, kind, base_amount, brand_fee, platform_fee, influencer_fee)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [lineId, d.id, Number(d.settled_n) > 0 ? "adjustment" : "sale", d.d_base, d.d_brand, d.d_platform, d.d_influencer],
        );
      }

      await recomputeBatch(q, batchId);
      return { created: !existing[0], entries: changed.length };
    });
    if (result.created) batchCount += 1;
    entryCount += result.entries;
  }
  return { batches: batchCount, entries: entryCount };
}

/** 지급 내역·청구서 합계를 entries 에서 다시 계산한다(같은 트랜잭션 안에서). */
export async function recomputeBatch(q: Tx, batchId: string) {
  const lines = await q(
    `SELECT l.id, COALESCE(SUM(e.base_amount),0) AS base, COALESCE(SUM(e.brand_fee),0) AS brand,
            COALESCE(SUM(e.platform_fee),0) AS platform, COALESCE(SUM(e.influencer_fee),0) AS influencer
     FROM affiliate_settlement_lines l
     LEFT JOIN affiliate_settlement_entries e ON e.line_id = l.id
     WHERE l.batch_id = $1 GROUP BY l.id`,
    [batchId],
  );
  for (const l of lines) {
    const gross = Number(l.influencer);
    const tax = withholdingFor(gross);
    await q(
      `UPDATE affiliate_settlement_lines SET sales_amount=$2, brand_fee=$3, platform_fee=$4, influencer_gross=$5,
         income_tax=$6, local_tax=$7, withholding=$8, influencer_net=$9, updated_at=NOW() WHERE id=$1`,
      [l.id, Number(l.base), Number(l.brand), Number(l.platform), gross, tax.incomeTax, tax.localTax, tax.withholding, tax.net],
    );
  }
  const totals = await q(
    `SELECT COALESCE(SUM(sales_amount),0) AS sales, COALESCE(SUM(brand_fee),0) AS brand,
            COALESCE(SUM(platform_fee),0) AS platform, COALESCE(SUM(influencer_gross),0) AS influencer
     FROM affiliate_settlement_lines WHERE batch_id = $1`,
    [batchId],
  );
  const orders = await q(
    `SELECT COUNT(DISTINCT e.order_id) AS n FROM affiliate_settlement_entries e
     JOIN affiliate_settlement_lines l ON l.id = e.line_id WHERE l.batch_id = $1 AND e.kind = 'sale'`,
    [batchId],
  );
  const brandFee = Number(totals[0]?.brand || 0);
  const vat = brandFee > 0 ? Math.floor(brandFee / 10) : 0;
  await q(
    `UPDATE affiliate_settlement_batches SET total_sales=$2, brand_fee=$3, vat=$4, billed_total=$5,
       platform_fee=$6, influencer_gross=$7, order_count=$8, updated_at=NOW() WHERE id=$1`,
    [batchId, Number(totals[0]?.sales || 0), brandFee, vat, brandFee + vat, Number(totals[0]?.platform || 0), Number(totals[0]?.influencer || 0), Number(orders[0]?.n || 0)],
  );
}

// ── 응답 모양 ───────────────────────────────────────────────────────────────

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);
const dateStr = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : "");

export function shapeProduct(p: any) {
  return {
    id: String(p.id),
    shopProductId: String(p.shop_product_id),
    name: String(p.name || ""),
    price: Number(p.price || 0),
    imageUrl: String(p.image_url || ""),
    productUrl: String(p.product_url || ""),
    active: Boolean(p.active),
  };
}

/** viewer: brand/admin 은 총 수수료율·플랫폼율까지, creator/public 은 인플루언서 몫만. */
export function shapeCampaign(c: any, products: any[], viewer: "brand" | "admin" | "creator") {
  const full = viewer !== "creator";
  return {
    id: String(c.id),
    businessUsername: String(c.business_username),
    companyName: String(c.company_name || ""),
    shopType: String(c.shop_type || "cafe24"),
    mallId: full ? String(c.mall_id) : "",
    title: String(c.title || ""),
    description: String(c.description || ""),
    category: String(c.category || ""),
    ...(full ? { commissionRate: Number(c.commission_rate), platformRate: Number(c.platform_rate) } : {}),
    creatorRate: creatorRateOf(c.commission_rate, c.platform_rate),
    startDate: dateStr(c.start_date),
    endDate: dateStr(c.end_date),
    joinMode: String(c.join_mode),
    sampleOffered: Boolean(c.sample_offered),
    sampleNote: String(c.sample_note || ""),
    followerDiscount: String(c.follower_discount || ""),
    contentGuide: String(c.content_guide || ""),
    bannedPhrases: String(c.banned_phrases || ""),
    disclosureText: String(c.disclosure_text || DISCLOSURE_TEXT),
    status: String(c.status),
    rejectReason: full ? String(c.reject_reason || "") : "",
    products: products.map(shapeProduct),
    createdAt: iso(c.created_at) || "",
  };
}

export const publicOrigin = () =>
  String(process.env.URL || process.env.DEPLOY_PRIME_URL || "https://picks-folio.com").replace(/\/+$/, "");

/** 오늘(한국 시간) 'YYYY-MM-DD'. */
export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
