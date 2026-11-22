import { getStore } from "@netlify/blobs";
import { getDatabase } from "@picks/netlify-database";
import { sendDmMessages } from "./instagram-dm.mts";
import { claimIfNew, noteSentText, release, wasSentByUs } from "./dm-send-registry.mts";
import { appendDmLog } from "./dm-automation-log.mts";
import { dateOnly, kstToday, saleStateOf } from "./affiliate-sale-period.mts";
import { siteUrl } from "./affiliate-store-orders.mts";
import { loadCompanyCodes, lookupTracking, resolveCompanyCode, trackingApiKey } from "./delivery-tracking.mts";
import { AI_CONSULT_START_PAYLOAD } from "./instagram-persistent-menu.mts";
import { noteDmContact } from "./dm-contacts.mts";
import { createScheduledJob } from "./dm-schedule-store.mts";

/**
 * AI 공구 상담원 엔진.
 *
 * 원칙
 *  - 고객이 [🛍️ 공구 상품 문의] 버튼으로 시작한 대화만 다룬다. 그 밖의 DM 은 읽지 않는다.
 *  - 답은 브랜드가 등록한 상품 정보로만 한다. 모르면 인플루언서에게 넘긴다.
 *  - 재고 수량은 말하지 않는다(구매 가능 / 품절만). 사이즈 추천 · 효능 판단은 하지 않는다.
 *  - 인플루언서가 그 대화에 직접 답장하면 AI 는 바로 멈춘다(③ 인플루언서 처리).
 *  - 72시간 조용하면 상태를 지운다. 고객이 버튼을 다시 누르면 새로 시작한다.
 *
 * 대화 상태(블롭 `ai-consult`, 키 t_<계정>_<IGSID>)
 *  select       ① 상품 선택 대기
 *  consult      ② 상담 중(상품 하나)
 *  verify_name  ② 배송 조회 — 주문자 이름 받는 중
 *  verify_phone ② 배송 조회 — 휴대폰 뒤 4자리 받는 중
 *  human        ③ 인플루언서 처리(AI 침묵)
 *
 * 로그에는 고객 메시지 · 이름 · 전화번호 · 주문 내용을 남기지 않는다.
 */

const STORE = "ai-consult";
const THREAD_TTL_MS = 72 * 3600_000;
const HISTORY_MAX = 10;
const DAILY_AI_CAP = 1000;
const QUICK_REPLY_MAX = 13;
const QUICK_REPLY_TITLE_MAX = 20;
const VERIFY_TRIES = 3;
const MODEL = "gemini-2.5-flash-lite";

export const AI_PRODUCT_PAYLOAD_PREFIX = "aic_p_";
const PAYLOAD_HUMAN = "aic_human";
const PAYLOAD_ORDER = "aic_order";

const HANDOFF_TEXT = "문의 감사해요! 이 내용은 제가 직접 확인하고 답변드릴게요 🙂";
const NO_PRODUCT_TEXT = "지금 진행 중인 공구가 없어요 🙏";
const DISCLOSURE = "🤖 AI 상담원이 브랜드가 등록한 정보로 답해 드려요.";

export type ConsultStage = "select" | "consult" | "verify_name" | "verify_phone" | "human";

export interface ConsultThread {
  igsid: string;
  stage: ConsultStage;
  productId?: string;
  productName?: string;
  history: { role: "user" | "model"; text: string }[];
  verifyName?: string;
  verifyTries?: number;
  handoffReason?: string;
  handedOffAt?: string;
  /** 인플루언서 화면에 보여 줄 마지막 고객 질문(넘겨받은 대화만). */
  lastQuestion?: string;
  startedAt: string;
  updatedAt: string;
}

export interface ConsultStats {
  started: number;
  answered: number;
  handoffs: number;
  /** 하루 AI 호출 수(KST 날짜별). */
  day?: string;
  dayCalls?: number;
}

export interface ConsultSettingsLike {
  enabled?: boolean;
  aiConsult?: { enabled?: boolean; tone?: "friendly" | "polite"; intro?: string };
}

export interface ConsultCtx {
  username: string;
  settings: ConsultSettingsLike;
  graphHost: string;
  graphVersion: string;
  igId: string;
  accessToken: string;
  ownIds: Set<string>;
  /** 발송이 막힌 이유(스위치 · 플랜 · 연동). null 이면 보낼 수 있다. */
  blocked: () => Promise<string | null>;
}

const store = () => getStore({ name: STORE, consistency: "strong" });
const threadKey = (username: string, igsid: string) => `t_${username}_${igsid}`;
/** 인스타그램 IGSID 는 숫자뿐이다. 다른 값이면 다른 계정의 키와 겹칠 수 있으니 거부한다. */
export const validIgsid = (v: string) => /^\d{5,30}$/.test(v);
const lookupKey = (username: string, igsid: string) => `lookup_${username}_${igsid}_${kstToday()}`;
/** 고객 한 명이 하루에 시도할 수 있는 배송 조회 횟수(이름 + 뒤 4자리 대입 방지). */
const LOOKUP_DAILY_MAX = 3;
const statsKey = (username: string) => `stats_${username}`;

export const aiConsultAvailable = () => process.env.AI_CONSULT_ENABLED === "1";

/* ────────────────────────── 상태 저장 ────────────────────────── */

export async function readThread(username: string, igsid: string): Promise<ConsultThread | null> {
  const t = (await store().get(threadKey(username, igsid), { type: "json" }).catch(() => null)) as ConsultThread | null;
  if (!t) return null;
  if (Date.now() - Date.parse(t.updatedAt || "") > THREAD_TTL_MS) {
    await store().delete(threadKey(username, igsid)).catch(() => undefined);
    return null;
  }
  return t;
}

async function writeThread(username: string, t: ConsultThread): Promise<void> {
  t.updatedAt = new Date().toISOString();
  t.history = (t.history || []).slice(-HISTORY_MAX);
  await store().setJSON(threadKey(username, t.igsid), t);
}

export async function deleteThread(username: string, igsid: string): Promise<void> {
  await store().delete(threadKey(username, igsid)).catch(() => undefined);
}

/** 인플루언서가 넘겨받은 대화 목록(최근 것부터). */
export async function listHandedOff(username: string, limit = 30): Promise<ConsultThread[]> {
  const out: ConsultThread[] = [];
  const { blobs } = await store().list({ prefix: `t_${username}_` });
  for (const b of blobs) {
    // 접두사가 같은 다른 계정(예: abc 와 abc_shop)의 대화가 섞이지 않게 키 모양을 정확히 본다.
    if (!validIgsid(b.key.slice(`t_${username}_`.length))) continue;
    const t = (await store().get(b.key, { type: "json" }).catch(() => null)) as ConsultThread | null;
    if (!t || t.stage !== "human") continue;
    if (Date.now() - Date.parse(t.updatedAt || "") > THREAD_TTL_MS) continue;
    out.push(t);
  }
  return out.sort((a, b) => (b.handedOffAt || b.updatedAt).localeCompare(a.handedOffAt || a.updatedAt)).slice(0, limit);
}

export async function readStats(username: string): Promise<ConsultStats> {
  const s = (await store().get(statsKey(username), { type: "json" }).catch(() => null)) as ConsultStats | null;
  return { started: 0, answered: 0, handoffs: 0, ...(s || {}) };
}

async function bumpStats(username: string, patch: Partial<Record<"started" | "answered" | "handoffs" | "dayCalls", number>>) {
  try {
    const s = await readStats(username);
    const today = kstToday();
    if (s.day !== today) { s.day = today; s.dayCalls = 0; }
    s.started += patch.started || 0;
    s.answered += patch.answered || 0;
    s.handoffs += patch.handoffs || 0;
    s.dayCalls = (s.dayCalls || 0) + (patch.dayCalls || 0);
    await store().setJSON(statsKey(username), s);
  } catch (e) {
    console.warn("[ai-consult] stats save failed:", (e as Error)?.message);
  }
}

/* ────────────────────────── 상품 정보 ────────────────────────── */

export interface ConsultProduct {
  id: string;
  name: string;
  brandUsername: string;
  brandName: string;
  category: string;
  subcategory: string;
  summary: string;
  description: string;
  retailPrice: number;
  salePrice: number;
  shippingFee: number;
  saleStartDate: string;
  saleEndDate: string;
  shipStartDate: string;
  soldOut: boolean;
  options: { name: string; soldOut: boolean }[];
  sizeGuide: string;
  hasSizeImages: boolean;
  deliveryGuide: string;
  keyIngredients: string;
  volume: string;
  shelfLife: string;
  caution: string;
  faq: { q: string; a: string }[];
  buyUrl: string;
  csPhone: string;
  inquiryUrl: string;
}

const arr = (v: unknown): any[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};

/** 이 인플루언서가 지금 진행 중인 픽스폴리오 공구(선정 · 판매중 · 판매기간 안). */
export async function loadActiveProducts(username: string): Promise<ConsultProduct[]> {
  const db = getDatabase();
  const rows = (await db.sql`
    SELECT p.*, r.link_code, a.brand_name, a.cs_phone, a.inquiry_url
    FROM affiliate_store_requests r
    JOIN affiliate_store_products p ON p.id = r.product_id
    LEFT JOIN affiliate_store_applications a ON a.business_username = p.business_username
    WHERE r.influencer_username = ${username}
      AND r.status = 'approved'
      AND r.creator_hidden_at IS NULL
      AND r.link_code IS NOT NULL
      AND p.deleted_at IS NULL
      AND p.status = 'on_sale'
    ORDER BY p.sale_end_date ASC NULLS LAST, r.updated_at DESC
    LIMIT 40
  `) as any[];
  const today = kstToday();
  const out: ConsultProduct[] = [];
  for (const r of rows) {
    const state = saleStateOf(r, today);
    // 판매 예정 · 기간 종료 · 중지는 버튼에서 뺀다. 품절은 남겨 두고 "품절"로 안내한다.
    if (state !== "on_sale" && state !== "sold_out") continue;
    const options = arr(r.options).map((o: any) => ({
      name: String(o?.name || ""),
      soldOut: Boolean(o?.soldOut) || !(Number(o?.stock) > 0),
    })).filter((o) => o.name);
    out.push({
      id: String(r.id),
      name: String(r.name || ""),
      brandUsername: String(r.business_username || ""),
      brandName: String(r.brand_name || ""),
      category: String(r.category || ""),
      subcategory: String(r.subcategory || ""),
      summary: String(r.summary || ""),
      description: String(r.description || ""),
      retailPrice: Number(r.retail_price) || 0,
      salePrice: Number(r.sale_price) || 0,
      shippingFee: Number(r.shipping_fee) || 0,
      saleStartDate: dateOnly(r.sale_start_date),
      saleEndDate: dateOnly(r.sale_end_date),
      shipStartDate: dateOnly(r.ship_start_date),
      soldOut: state === "sold_out",
      options,
      sizeGuide: String(r.size_guide || ""),
      hasSizeImages: arr(r.size_guide_image_urls).length > 0,
      deliveryGuide: String(r.delivery_guide || ""),
      keyIngredients: String(r.key_ingredients || ""),
      volume: String(r.volume || ""),
      shelfLife: String(r.shelf_life || ""),
      caution: String(r.caution || ""),
      faq: arr(r.faq).map((f: any) => ({ q: String(f?.q || ""), a: String(f?.a || "") })).filter((f) => f.q && f.a),
      buyUrl: `${siteUrl()}/shop/${encodeURIComponent(String(r.link_code))}`,
      csPhone: String(r.cs_phone || ""),
      inquiryUrl: String(r.inquiry_url || ""),
    });
  }
  return out;
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const BEAUTY = ["뷰티", "스킨케어"];

/** AI 에게 넘길 상품 자료. 여기 없는 내용은 답하지 않게 한다. */
function productFacts(p: ConsultProduct): string {
  const lines: string[] = [];
  lines.push(`상품명: ${p.name}`);
  if (p.brandName) lines.push(`브랜드: ${p.brandName}`);
  lines.push(`카테고리: ${p.category}${p.subcategory ? ` > ${p.subcategory}` : ""}`);
  if (p.summary) lines.push(`한 줄 소개: ${p.summary}`);
  if (p.retailPrice > p.salePrice && p.salePrice > 0) {
    const rate = Math.round((1 - p.salePrice / p.retailPrice) * 100);
    lines.push(`가격: 정가 ${won(p.retailPrice)} → 공구가 ${won(p.salePrice)} (${rate}% 할인)`);
  } else {
    lines.push(`가격: ${won(p.salePrice)}`);
  }
  lines.push(`배송비: ${p.shippingFee > 0 ? won(p.shippingFee) : "무료"}`);
  lines.push(`공구 기간: ${p.saleStartDate || "진행 중"} ~ ${p.saleEndDate || "별도 공지 전까지"}`);
  lines.push(`구매 가능 여부: ${p.soldOut ? "품절" : "구매 가능"}`);
  if (p.options.length > 0) {
    lines.push(`옵션: ${p.options.map((o) => `${o.name}(${o.soldOut ? "품절" : "구매 가능"})`).join(", ")}`);
  }
  lines.push(`출고: ${p.shipStartDate ? `${p.shipStartDate}부터 순차 출고` : "결제 후 순차 출고"}`);
  if (p.deliveryGuide) lines.push(`배송 · 교환 · 반품 안내:\n${p.deliveryGuide.slice(0, 1500)}`);
  if (BEAUTY.includes(p.category)) {
    if (p.keyIngredients) lines.push(`주요 성분: ${p.keyIngredients}`);
    if (p.volume) lines.push(`용량: ${p.volume}`);
    if (p.shelfLife) lines.push(`사용 기한: ${p.shelfLife}`);
    if (p.caution) lines.push(`주의사항: ${p.caution}`);
  } else {
    if (p.description) lines.push(`상품 설명:\n${p.description.slice(0, 1500)}`);
  }
  if (p.category === "패션") {
    if (p.sizeGuide) lines.push(`사이즈표:\n${p.sizeGuide.slice(0, 1500)}`);
    else if (p.hasSizeImages) lines.push("사이즈표: 구매 페이지의 이미지로만 제공(구매 링크로 안내)");
  }
  if (p.faq.length > 0) {
    lines.push("브랜드 FAQ:");
    for (const f of p.faq) lines.push(`Q. ${f.q}\nA. ${f.a}`);
  }
  lines.push(`구매 링크: ${p.buyUrl}`);
  return lines.join("\n");
}

const PICKSFOLIO_CS_EMAIL = "business@picks-folio.com";

/**
 * 교환 · 반품 · 불량 안내. AI 가 정책을 요약하지 않고, 브랜드가 판매자 정보에 등록한
 * 문의 창구(문의 링크 · 고객센터 전화)로 바로 보낸다. 둘 다 없으면 픽스폴리오 고객센터.
 */
function exchangeGuide(p: ConsultProduct): string {
  const url = /^https:\/\/\S+$/i.test(p.inquiryUrl) ? p.inquiryUrl : "";
  const lines = ["교환 · 반품 · 불량 문의는 브랜드 고객센터에서 바로 도와드려요 🙏"];
  if (url) lines.push(`문의 남기기: ${url}`);
  if (p.csPhone) lines.push(`전화: ${p.csPhone}`);
  if (!url && !p.csPhone) lines.push(`문의: ${PICKSFOLIO_CS_EMAIL}`);
  lines.push(`문의하실 때 주문번호를 같이 남겨 주세요. 주문번호는 ${siteUrl()}/my/orders 에서 확인할 수 있어요.`);
  return lines.join("\n");
}

/* ────────────────────────── Gemini ────────────────────────── */

type AiAction = "answer" | "handoff" | "external" | "order_lookup" | "exchange";

function systemPrompt(p: ConsultProduct, tone: "friendly" | "polite"): string {
  const toneRule = tone === "polite"
    ? "정중한 합니다체로 답한다."
    : "친근한 해요체로 답한다. 이모지는 한 답변에 하나까지만 쓴다.";
  return [
    "너는 인스타그램 인플루언서 계정의 공동구매(공구) DM 상담원이다. 고객은 아래 상품 하나에 대해 묻고 있다.",
    "",
    "규칙",
    "1. 아래 [상품 자료]에 적힌 내용으로만 답한다. 자료에 없는 내용은 추측하지 말고 action 을 handoff 로 한다.",
    "2. 재고 수량은 절대 말하지 않는다. '구매 가능' 또는 '품절'로만 말한다.",
    "3. 사이즈를 추천하지 않는다. 사이즈표가 있으면 그대로 보여 주고, 고르는 것은 고객에게 맡긴다. 모델 착용 정보는 말하지 않는다.",
    "4. 효능 · 효과를 보장하거나 피부 질환 · 건강 상태에 맞는지 판단하지 않는다. 주의사항만 그대로 안내한다.",
    "5. 다른 상품이나 픽스폴리오 밖에서 진행하는 공구를 물으면 action 을 external 로 한다.",
    "6. 고객이 자기 주문의 배송 상황 · 송장을 물으면 action 을 order_lookup 으로 하고 reply 는 비운다.",
    "7. 교환 · 반품 · 불량 · 파손 · 환불을 말하면 action 을 exchange 로 하고 reply 는 비운다(브랜드 고객센터 안내는 따로 나간다).",
    "8. 사람과 이야기하고 싶다, 화가 났다, 가격 협상 · 개인 할인 요청, 자료로 답할 수 없는 질문은 action 을 handoff 로 한다.",
    "9. 구매하고 싶다고 하면 구매 링크를 알려 준다.",
    `10. ${toneRule} 답은 3~5문장 이내로 짧게, DM 에 맞게 쓴다. 마크다운(별표 · 샵)을 쓰지 않는다.`,
    "11. 자기가 AI 라는 사실을 숨기지 않는다. 인플루언서 본인인 척하지 않는다.",
    "",
    '출력은 JSON 하나만: {"reply": "고객에게 보낼 문장", "action": "answer|handoff|external|order_lookup|exchange"}',
    "",
    "[상품 자료]",
    productFacts(p),
  ].join("\n");
}

async function askGemini(
  p: ConsultProduct,
  tone: "friendly" | "polite",
  history: ConsultThread["history"],
  question: string,
): Promise<{ reply: string; action: AiAction } | null> {
  const key = process.env.GEMINI_API_KEY;
  const base = process.env.GOOGLE_GEMINI_BASE_URL;
  if (!key || !base) return null;
  try {
    const contents = [
      ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: "user", parts: [{ text: question.slice(0, 1000) }] },
    ];
    const res = await fetch(`${base}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(p, tone) }] },
        contents,
        generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn("[ai-consult] gemini http", res.status);
      return null;
    }
    const data: any = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((x: any) => x?.text || "").join("");
    const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim());
    const actions: AiAction[] = ["answer", "handoff", "external", "order_lookup", "exchange"];
    const action: AiAction = actions.includes(parsed?.action) ? parsed.action : "answer";
    const reply = String(parsed?.reply || "").replace(/\*\*/g, "").trim().slice(0, 900);
    if (!reply && action === "answer") return null;
    return { reply, action };
  } catch (e) {
    console.warn("[ai-consult] gemini failed:", (e as Error)?.name || "error");
    return null;
  }
}

/* ────────────────────────── 발송 ────────────────────────── */

interface QuickReply { title: string; payload: string }

const qr = (items: QuickReply[]) =>
  items.slice(0, QUICK_REPLY_MAX).map((q) => ({
    content_type: "text",
    title: q.title.length > QUICK_REPLY_TITLE_MAX ? `${q.title.slice(0, QUICK_REPLY_TITLE_MAX - 1)}…` : q.title,
    payload: q.payload,
  }));

const CONSULT_QUICK: QuickReply[] = [
  { title: "다른 상품 문의", payload: AI_CONSULT_START_PAYLOAD },
  { title: "직접 문의하기", payload: PAYLOAD_HUMAN },
];

async function send(ctx: ConsultCtx, recipientId: string, claimKey: string, text: string, quick?: QuickReply[]): Promise<boolean> {
  const body = text.trim().slice(0, 1000);
  if (!body) return false;
  if (!(await claimIfNew(ctx.username, claimKey, true))) return false;
  const message: Record<string, unknown> = { text: body };
  if (quick && quick.length > 0) message.quick_replies = qr(quick);
  // 에코가 먼저 도착해도 "인플루언서가 직접 답장했다"로 잘못 보지 않도록 먼저 남긴다.
  await noteSentText(ctx.username, body);
  const result = await sendDmMessages({
    account: ctx.username,
    graphHost: ctx.graphHost,
    graphVersion: ctx.graphVersion,
    igId: ctx.igId,
    accessToken: ctx.accessToken,
    recipient: { id: recipientId },
    messages: [message],
  });
  // 시간당 발송 한도에 걸렸으면 버리지 않고 발송 대기열에 넣는다(기존 자동 답장과 같은 방식).
  if (!result.ok && (result.errorKind === "rate_limit" || result.errorKind === "throttled")) {
    try {
      await createScheduledJob({
        id: `aic_${claimKey}`,
        username: ctx.username,
        recipientId,
        sendAt: new Date(Date.now() + (result.retryAfterMs || 60_000)).toISOString(),
        message: "",
        buttons: [],
        payloads: [message],
        source: "trigger",
        createdAt: new Date().toISOString(),
        status: "pending",
        ruleName: "AI 공구 상담원",
        igAccountId: ctx.igId,
      });
      await appendDmLog(ctx.username, { kind: "dm", status: "scheduled", trigger: "ai_consult", recipientId }).catch(() => undefined);
      return true;
    } catch (e) {
      await release(ctx.username, claimKey, true);
      throw e;
    }
  }
  if (!result.ok && result.errorKind !== "uncertain") await release(ctx.username, claimKey, true);
  await appendDmLog(ctx.username, {
    kind: "dm",
    status: result.ok ? "sent" : "failed",
    trigger: "ai_consult",
    recipientId,
    error: result.ok ? undefined : result.error,
    errorKind: result.ok ? undefined : result.errorKind,
  }).catch(() => undefined);
  return result.ok;
}

/* ────────────────────────── 흐름 ────────────────────────── */

function introText(ctx: ConsultCtx): string {
  const intro = (ctx.settings.aiConsult?.intro || "").trim();
  return intro || "공구 문의 주셔서 감사해요! 궁금한 상품을 골라 주세요 😊";
}

async function startConsult(ctx: ConsultCtx, igsid: string, eventId: string) {
  const products = await loadActiveProducts(ctx.username);
  if (products.length === 0) {
    await deleteThread(ctx.username, igsid);
    await send(ctx, igsid, `aic_none_${eventId}`, NO_PRODUCT_TEXT);
    return;
  }
  await bumpStats(ctx.username, { started: 1 });
  const now = new Date().toISOString();
  if (products.length === 1) {
    await selectProduct(ctx, igsid, products[0], eventId, true);
    return;
  }
  await writeThread(ctx.username, { igsid, stage: "select", history: [], startedAt: now, updatedAt: now });
  await send(
    ctx,
    igsid,
    `aic_list_${eventId}`,
    `${introText(ctx)}\n\n${DISCLOSURE}`,
    products.map((p) => ({ title: p.name, payload: `${AI_PRODUCT_PAYLOAD_PREFIX}${p.id}` })),
  );
}

async function selectProduct(ctx: ConsultCtx, igsid: string, p: ConsultProduct, eventId: string, withIntro: boolean) {
  const now = new Date().toISOString();
  await writeThread(ctx.username, {
    igsid, stage: "consult", productId: p.id, productName: p.name, history: [], startedAt: now, updatedAt: now,
  });
  const head = withIntro ? `${introText(ctx)}\n\n${DISCLOSURE}\n\n` : "";
  const status = p.soldOut ? " (지금은 품절이에요)" : "";
  await send(
    ctx,
    igsid,
    `aic_sel_${eventId}`,
    `${head}'${p.name}'${status} 문의 도와드릴게요! 가격, 옵션, 배송, 교환 같은 궁금한 점을 편하게 보내 주세요.`,
    CONSULT_QUICK,
  );
}

async function handOff(ctx: ConsultCtx, t: ConsultThread, eventId: string, reason: string, text = HANDOFF_TEXT, question = "") {
  t.stage = "human";
  t.handoffReason = reason;
  t.handedOffAt = new Date().toISOString();
  t.verifyName = undefined;
  if (question) t.lastQuestion = question.slice(0, 300);
  await writeThread(ctx.username, t);
  await bumpStats(ctx.username, { handoffs: 1 });
  if (text) await send(ctx, t.igsid, `aic_ho_${eventId}`, text);
}

const STATUS_LABEL: Record<string, string> = {
  paid: "결제 완료(출고 준비 중)",
  preparing: "상품 준비 중",
  shipped: "배송 중",
  delivered: "배송 완료",
  confirmed: "구매 확정",
  cancelled: "취소됨",
};

async function lookupOrders(ctx: ConsultCtx, t: ConsultThread, last4: string, eventId: string) {
  const db = getDatabase();
  const lk = lookupKey(ctx.username, t.igsid);
  const tried = Number((await store().get(lk).catch(() => null)) || 0);
  await store().set(lk, String(tried + 1)).catch(() => undefined);
  const name = (t.verifyName || "").replace(/\s/g, "");
  const rows = (await db.sql`
    SELECT product_name, option_name, quantity, status, tracking_company, tracking_number
    FROM affiliate_store_orders
    WHERE influencer_username = ${ctx.username}
      AND status <> 'pending_payment'
      AND regexp_replace(buyer_name, '\\s', '', 'g') = ${name}
      AND right(regexp_replace(buyer_phone, '\\D', '', 'g'), 4) = ${last4}
      AND created_at > NOW() - INTERVAL '120 days'
    ORDER BY created_at DESC
    LIMIT 5
  `) as any[];
  t.verifyName = undefined;
  t.verifyTries = 0;
  if (rows.length === 0) {
    await handOff(ctx, t, eventId, "order_not_found", "입력해 주신 정보로 주문을 찾지 못했어요. 확인 후 제가 직접 답변드릴게요 🙂");
    return;
  }
  const key = trackingApiKey();
  const codes = key ? await loadCompanyCodes(key) : null;
  const parts: string[] = [];
  for (const r of rows) {
    const line = [`· ${r.product_name}${r.option_name ? ` / ${r.option_name}` : ""} ${r.quantity}개`, `  상태: ${STATUS_LABEL[r.status] || r.status}`];
    if (r.tracking_number) {
      line.push(`  ${r.tracking_company} ${r.tracking_number}`);
      if (key && codes && !codes.keyInvalid) {
        const code = resolveCompanyCode(String(r.tracking_company || ""), codes);
        if (code) {
          const tr = await lookupTracking(key, code, String(r.tracking_number));
          if (tr.ok && tr.lastStatus) line.push(`  최근 배송 상황: ${tr.delivered ? "배송 완료" : tr.lastStatus}`);
        }
      }
    }
    parts.push(line.join("\n"));
  }
  t.stage = "consult";
  await writeThread(ctx.username, t);
  await send(ctx, t.igsid, `aic_ord_${eventId}`, `주문 확인했어요!\n\n${parts.join("\n\n")}`, CONSULT_QUICK);
}

async function answer(ctx: ConsultCtx, t: ConsultThread, text: string, eventId: string) {
  const products = await loadActiveProducts(ctx.username);
  const p = products.find((x) => x.id === t.productId);
  if (!p) {
    // 공구가 끝났거나 내려갔다. 남은 공구로 다시 고르게 한다.
    await deleteThread(ctx.username, t.igsid);
    await send(ctx, t.igsid, `aic_gone_${eventId}`, "이 공구는 지금 진행하고 있지 않아요. 다른 상품을 보시려면 아래 버튼을 눌러 주세요.", [
      { title: "공구 상품 보기", payload: AI_CONSULT_START_PAYLOAD },
    ]);
    return;
  }

  const stats = await readStats(ctx.username);
  if (stats.day === kstToday() && (stats.dayCalls || 0) >= DAILY_AI_CAP) {
    await handOff(ctx, t, eventId, "daily_cap", HANDOFF_TEXT, text);
    return;
  }
  await bumpStats(ctx.username, { dayCalls: 1 });

  const tone = ctx.settings.aiConsult?.tone === "polite" ? "polite" : "friendly";
  const ai = await askGemini(p, tone, t.history, text);
  if (!ai) {
    await handOff(ctx, t, eventId, "ai_error", HANDOFF_TEXT, text);
    return;
  }
  t.history.push({ role: "user", text: text.slice(0, 500) });

  if (ai.action === "handoff" || ai.action === "external") {
    await handOff(ctx, t, eventId, ai.action, HANDOFF_TEXT, text);
    return;
  }
  if (ai.action === "order_lookup") {
    const tried = Number((await store().get(lookupKey(ctx.username, t.igsid)).catch(() => null)) || 0);
    if (tried >= LOOKUP_DAILY_MAX) {
      await handOff(ctx, t, eventId, "lookup_limit", "오늘은 배송 조회를 더 할 수 없어요. 제가 직접 확인하고 답변드릴게요 🙂", text);
      return;
    }
    t.stage = "verify_name";
    t.verifyTries = 0;
    await writeThread(ctx.username, t);
    await send(ctx, t.igsid, `aic_vn_${eventId}`, "배송 조회 도와드릴게요! 주문하실 때 입력한 주문자 성함을 알려 주세요.");
    return;
  }
  const reply = ai.action === "exchange" ? exchangeGuide(p) : ai.reply;
  t.history.push({ role: "model", text: reply.slice(0, 500) });
  await writeThread(ctx.username, t);
  await bumpStats(ctx.username, { answered: 1 });
  await send(ctx, t.igsid, `aic_ans_${eventId}`, reply, CONSULT_QUICK);
}

/* ────────────────────────── 웹훅 진입점 ────────────────────────── */

/**
 * 메시지 이벤트 하나를 상담원 관점에서 처리한다.
 *
 * 돌려주는 값
 *  "handled"  — 상담원이 처리했다(기존 인사말 · 키워드 답장은 보내지 않는다).
 *  "suppress" — 상담원이 맡은 대화(③ 포함)라 기존 자동 답장도 보내지 않는다.
 *  null       — 상담원과 무관한 이벤트. 기존 처리기로 넘긴다.
 */
export async function handleAiConsultEvent(ctx: ConsultCtx, event: any): Promise<"handled" | "suppress" | null> {
  if (!aiConsultAvailable()) return null;
  const message = event?.message;

  // 계정이 보낸 메시지(에코). 우리가 보낸 문구가 아니면 인플루언서가 직접 답장한 것이다.
  if (message?.is_echo === true) {
    const recipientId = String(event?.recipient?.id || "");
    if (!recipientId || ctx.ownIds.has(recipientId)) return null;
    const t = await readThread(ctx.username, recipientId);
    if (!t || t.stage === "human") return null;
    const text = String(message?.text || "").trim();
    if (text && (await wasSentByUs(ctx.username, text))) return null;
    // 첨부(사진 등)만 보낸 에코도 사람이 보낸 것으로 본다 — 상담원은 텍스트만 보낸다.
    t.stage = "human";
    t.handoffReason = "influencer_replied";
    t.handedOffAt = new Date().toISOString();
    await writeThread(ctx.username, t);
    return "handled";
  }

  const senderId = String(event?.sender?.id || "");
  if (!senderId || ctx.ownIds.has(senderId)) return null;
  const payload = String(event?.postback?.payload || message?.quick_reply?.payload || "");
  const eventId = String(event?.postback?.mid || message?.mid || `${senderId}_${event?.timestamp || ""}`);
  const isOurPayload = payload === AI_CONSULT_START_PAYLOAD || payload.startsWith(AI_PRODUCT_PAYLOAD_PREFIX)
    || payload === PAYLOAD_HUMAN || payload === PAYLOAD_ORDER;

  // 다른 버튼(자주 묻는 질문 · 미끼 카드)은 원래 처리기가 답한다.
  if (event?.postback && !isOurPayload) return null;
  const thread = await readThread(ctx.username, senderId);
  if (!isOurPayload && !thread) return null;

  // 버튼 클릭도 고객이 말을 건 것이다 — 24시간 창 · 예약 발송 명단에 남긴다.
  await noteDmContact({
    username: ctx.username,
    igsid: senderId,
    text: isOurPayload ? String(event?.postback?.title || message?.text || "") : String(message?.text || ""),
    kind: isOurPayload ? "postback" : "message",
  }).catch(() => undefined);

  // 상담원을 꺼 뒀거나 발송이 막혀 있으면 아무것도 보내지 않는다. 상담 중이던 대화에는
  // 기존 자동 답장도 보내지 않는다(고객 입장에서는 갑자기 다른 답이 오는 셈이라).
  if (!ctx.settings.aiConsult?.enabled) return thread ? "suppress" : null;
  const blocked = await ctx.blocked();
  if (blocked) {
    await appendDmLog(ctx.username, { kind: "dm", status: "skipped", trigger: "ai_consult", reason: blocked, recipientId: senderId }).catch(() => undefined);
    return isOurPayload || thread ? "suppress" : null;
  }

  if (payload === AI_CONSULT_START_PAYLOAD) {
    await startConsult(ctx, senderId, eventId);
    return "handled";
  }
  if (payload.startsWith(AI_PRODUCT_PAYLOAD_PREFIX)) {
    const id = payload.slice(AI_PRODUCT_PAYLOAD_PREFIX.length);
    const p = (await loadActiveProducts(ctx.username)).find((x) => x.id === id);
    if (!p) {
      await send(ctx, senderId, `aic_gone_${eventId}`, "이 공구는 마감됐어요. 진행 중인 다른 공구를 확인해 보세요.", [
        { title: "공구 상품 보기", payload: AI_CONSULT_START_PAYLOAD },
      ]);
      return "handled";
    }
    await selectProduct(ctx, senderId, p, eventId, false);
    return "handled";
  }
  if (payload === PAYLOAD_HUMAN) {
    const now = new Date().toISOString();
    const t = thread || { igsid: senderId, stage: "consult" as ConsultStage, history: [], startedAt: now, updatedAt: now };
    await handOff(ctx, t, eventId, "customer_request", "네, 제가 직접 확인하고 답변드릴게요 🙂 궁금한 내용을 남겨 주세요.");
    return "handled";
  }

  // 여기부터는 진행 중인 상담 대화의 일반 메시지.
  const t = thread!;
  if (t.stage === "human") return "suppress";
  const text = String(message?.text || "").trim();
  if (!text) {
    if (message?.attachments) {
      await send(ctx, senderId, `aic_att_${eventId}`, "사진이나 파일은 제가 확인하기 어려워요. 궁금한 점을 글로 보내 주시면 바로 답해 드릴게요!", CONSULT_QUICK);
      return "handled";
    }
    return "suppress";
  }

  if (t.stage === "select") {
    await send(ctx, senderId, `aic_pick_${eventId}`, "아래 버튼에서 궁금한 상품을 먼저 골라 주세요 🙂", [
      { title: "공구 상품 보기", payload: AI_CONSULT_START_PAYLOAD },
    ]);
    return "handled";
  }
  if (t.stage === "verify_name") {
    // 이름이 아니라 질문을 보낸 경우(길거나 물음표) 다시 이름을 묻는다.
    if (text.replace(/\s/g, "").length > 15 || /[?？]/.test(text)) {
      t.verifyTries = (t.verifyTries || 0) + 1;
      if (t.verifyTries >= VERIFY_TRIES) {
        await handOff(ctx, t, eventId, "verify_failed");
        return "handled";
      }
      await writeThread(ctx.username, t);
      await send(ctx, senderId, `aic_vn_${eventId}`, "배송 조회를 위해 주문자 성함만 보내 주세요. (예: 홍길동)");
      return "handled";
    }
    t.verifyName = text.slice(0, 30);
    t.stage = "verify_phone";
    await writeThread(ctx.username, t);
    await send(ctx, senderId, `aic_vp_${eventId}`, "주문하실 때 입력한 휴대폰 번호 뒤 4자리를 알려 주세요.");
    return "handled";
  }
  if (t.stage === "verify_phone") {
    const digits = text.replace(/\D/g, "");
    if (digits.length !== 4) {
      t.verifyTries = (t.verifyTries || 0) + 1;
      if (t.verifyTries >= VERIFY_TRIES) {
        await handOff(ctx, t, eventId, "verify_failed");
        return "handled";
      }
      await writeThread(ctx.username, t);
      await send(ctx, senderId, `aic_vp_${eventId}`, "휴대폰 번호 뒤 4자리 숫자만 보내 주세요. (예: 1234)");
      return "handled";
    }
    await lookupOrders(ctx, t, digits, eventId);
    return "handled";
  }

  await answer(ctx, t, text, eventId);
  return "handled";
}

/** 인플루언서가 [AI에게 다시 맡기기]를 눌렀을 때. 다음 고객 메시지부터 AI 가 답한다. */
export async function resumeThread(username: string, igsid: string): Promise<boolean> {
  if (!validIgsid(igsid)) return false;
  const t = await readThread(username, igsid);
  if (!t) return false;
  t.stage = t.productId ? "consult" : "select";
  t.handoffReason = undefined;
  t.handedOffAt = undefined;
  t.lastQuestion = undefined;
  await writeThread(username, t);
  return true;
}
