/**
 * 판매 연동 작업자 — 예약 함수가 백그라운드 함수를 깨우는 통로.
 *
 * 예약 함수는 30초 안에 끝나야 한다. 주문 동기화는 몰마다 호출 한도를 지키며 수백 건을
 * 차례로 조회해야 해서 그 안에 끝나지 않는다. 그래서 예약 함수는 서명한 요청 하나만
 * 보내고, 실제 일은 백그라운드 함수(최대 15분)가 한다. 서명이 없으면 백그라운드 함수는
 * 아무것도 하지 않는다 — 공개 주소라 누구나 부를 수 있기 때문이다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { connectionForMall } from "./cafe24-api.mts";
import { closePeriod, isPeriod, loadSettings, previousPeriod, syncOrder, todayKst } from "./affiliate.mts";

export type AffiliateTask = { task: "sync" } | { task: "close"; period: string };

const secret = () =>
  process.env.AFFILIATE_WORKER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PORTONE_V2_API_SECRET || "";
const sign = (body: string) => createHmac("sha256", secret()).update(`affiliate-worker-v1:${body}`).digest("hex");

export function verifyWorkerRequest(body: string, signature: string | null): boolean {
  if (!secret() || !signature) return false;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function dispatchAffiliateWorker(task: AffiliateTask): Promise<void> {
  if (!secret()) {
    console.error("[affiliate-worker] 서명 비밀값이 없어 작업을 보내지 못했습니다");
    return;
  }
  const body = JSON.stringify({ ...task, at: Date.now() });
  const origin = new URL(process.env.URL || "https://picks-folio.com");
  const res = await fetch(new URL("/.netlify/functions/affiliate-worker-background", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-affiliate-worker-signature": sign(body) },
    body,
  });
  if (res.status !== 202 && !res.ok) console.error(`[affiliate-worker] dispatch ${task.task} → ${res.status}`);
}

const BATCH = 800;
const TIME_BUDGET_MS = 13 * 60 * 1000;

/** 하루 한 번: 기간 끝난 캠페인 정리 + 열린 주문 재조회. */
export async function runSync(db: any): Promise<void> {
  const started = Date.now();
  const today = todayKst();

  try {
    const ended = (await db.sql`
      UPDATE affiliate_campaigns SET status = 'ended', ended_at = NOW(), updated_at = NOW()
      WHERE status = 'active' AND end_date < ${today} RETURNING id
    `) as any[];
    if (ended.length) {
      const ids = ended.map((r) => r.id);
      await db.sql`UPDATE affiliate_links SET status = 'paused', updated_at = NOW() WHERE campaign_id = ANY(${ids}::text[]) AND status = 'active'`;
      console.log(`[affiliate-sync] 판매 기간 종료 ${ended.length}건`);
    }
  } catch (e) {
    console.error("[affiliate-sync] campaign close failed", e instanceof Error ? e.message : "");
  }

  const settings = await loadSettings(db);
  // 미검증 · 예정 주문, 그리고 확정 뒤 30일 안의 주문(늦은 반품을 잡는다).
  const orders = (await db.sql`
    SELECT id, mall_id FROM affiliate_orders
    WHERE (verification = 'unverified'
       OR (verification = 'verified' AND status = 'pending')
       OR (verification = 'verified' AND status = 'confirmed' AND confirmed_at > NOW() - INTERVAL '30 days'))
      AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '20 hours')
    ORDER BY last_synced_at NULLS FIRST
    LIMIT ${BATCH}
  `) as any[];

  const byMall = new Map<string, string[]>();
  for (const o of orders) byMall.set(o.mall_id, [...(byMall.get(o.mall_id) || []), o.id]);

  const tally: Record<string, number> = {};
  for (const [mall, ids] of byMall) {
    const conn = await connectionForMall(db, mall);
    for (const id of ids) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      try {
        const r = await syncOrder(db, id, { settings, conn });
        const key = `${r.verification}/${r.status}`;
        tally[key] = (tally[key] || 0) + 1;
      } catch {
        tally.error = (tally.error || 0) + 1;
      }
      // 카페24 호출 한도: 몰마다 초당 2회 회복
      await new Promise((r) => setTimeout(r, 550));
    }
  }
  console.log(`[affiliate-sync] ${orders.length}건 조회`, JSON.stringify(tally));
}

export async function runClose(db: any, period: string): Promise<void> {
  const p = isPeriod(period) ? period : previousPeriod();
  const result = await closePeriod(db, p);
  console.log(`[affiliate-close] ${p} 마감: 새 청구서 ${result.batches}건, 반영 주문 ${result.entries}건`);
}
