import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { createHmac, timingSafeEqual } from "node:crypto";
import { finalizePaidOrder } from "./_shared/affiliate-store-orders.mts";

/**
 * 포트원 V2 웹훅(결제 알림). 어필리에이트 스토어 주문의 결제 누락을 막는다.
 *
 * 구매자가 결제 후 창을 닫거나 네트워크가 끊겨 화면의 결제 확인(complete)이 오지 않아도,
 * 포트원이 보내는 "결제 완료(Transaction.Paid)" 알림으로 같은 결제 확인 함수(finalizePaidOrder:
 * 검증 → 재고 차감 → 수수료 예정)를 실행한다. 이미 처리된 주문이면 아무것도 하지 않는다(멱등).
 *
 * 서명 검증(필수): 포트원 V2 웹훅은 Standard Webhooks 규격이다.
 *   서명 대상 = `${webhook-id}.${webhook-timestamp}.${원문 본문}`
 *   키       = PORTONE_WEBHOOK_SECRET(포트원 콘솔의 웹훅 시크릿, "whsec_" 뒤 base64)
 *   서명     = HMAC-SHA256 → base64, webhook-signature 헤더에 "v1,<서명>" 으로 (여러 개면 공백 구분)
 * 서명이 없거나 틀리면 401, 5분 넘게 차이 나는 시각이면 401(재전송 공격 방지).
 *
 * 포트원 콘솔 > 결제연동 > 웹훅 에 이 주소를 등록한다: https://picks-folio.com/api/portone-webhook
 *
 * 로그 규칙: 웹훅 본문 · 서명 · 시크릿 · 포트원 응답 원문은 남기지 않는다. 주문번호와 처리 결과만 남긴다.
 */

const TOLERANCE_SECONDS = 5 * 60;

function secretKey(): Buffer | null {
  const raw = String(process.env.PORTONE_WEBHOOK_SECRET || "").trim();
  if (!raw) return null;
  const b64 = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  try {
    const key = Buffer.from(b64, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function verifySignature(key: Buffer, id: string, timestamp: string, body: string, header: string): boolean {
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  for (const part of header.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let given: Buffer;
    try { given = Buffer.from(sig, "base64"); } catch { continue; }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const key = secretKey();
  if (!key) {
    // 시크릿이 없으면 검증할 수 없으므로 처리하지 않는다. 5xx 로 답해 포트원이 나중에 다시 보내게 한다.
    console.error("[portone-webhook] PORTONE_WEBHOOK_SECRET not configured");
    return new Response("Webhook not configured", { status: 503 });
  }

  const id = req.headers.get("webhook-id") || "";
  const timestamp = req.headers.get("webhook-timestamp") || "";
  const signature = req.headers.get("webhook-signature") || "";
  const body = await req.text();
  if (!id || !timestamp || !signature) return new Response("Invalid signature", { status: 401 });

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
    return new Response("Invalid timestamp", { status: 401 });
  }
  if (!verifySignature(key, id, timestamp, body, signature)) {
    console.warn("[portone-webhook] signature mismatch");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: any = null;
  try { event = JSON.parse(body); } catch { return new Response("Bad request", { status: 400 }); }
  const type = String(event?.type || "");
  const paymentId = String(event?.data?.paymentId || "").slice(0, 120);

  // 어필리에이트 주문(aff-...)의 결제 완료만 처리한다. 그 밖의 알림은 받았다고만 답한다.
  if (type !== "Transaction.Paid" || !paymentId.startsWith("aff-")) {
    return Response.json({ ok: true, ignored: true });
  }

  try {
    const db = getDatabase();
    const r = await finalizePaidOrder(db, paymentId, { source: "webhook" });
    if (r.ok) {
      console.log("[portone-webhook] processed", paymentId, r.justPaid ? "paid" : "already");
      return Response.json({ ok: true });
    }
    if (r.status === 404 || r.code === "SOLD_OUT") {
      // 우리 주문이 아니거나(다른 환경의 결제) 품절로 이미 취소 처리됨 — 다시 보내도 결과가 같다.
      console.log("[portone-webhook] not processed", paymentId, r.status, r.code || "");
      return Response.json({ ok: true });
    }
    // 검증 실패(금액 · 주문자 불일치 등)는 다시 보내도 같다 → 200 으로 받고 시간별 점검 · 운영자 확인에 맡긴다.
    // 포트원 조회 실패 · 설정 누락(5xx)은 재시도를 받도록 그대로 실패로 답한다.
    console.warn("[portone-webhook] verification failed", paymentId, r.status);
    return r.status >= 500
      ? new Response("Temporary failure", { status: 503 })
      : Response.json({ ok: false });
  } catch (e: any) {
    console.error("[portone-webhook] failed", paymentId, e?.code || e?.name || "");
    return new Response("Temporary failure", { status: 500 });
  }
};

export const config: Config = {
  path: "/api/portone-webhook",
  method: ["POST"],
};
