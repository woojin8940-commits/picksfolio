import { getDatabase } from "@picks/netlify-database";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";
import { mapConcurrent } from "./_shared/concurrency.mts";
import {
  reopenDmAccess,
  saveDmAccessNote,
  suspendDmAccess,
} from "./_shared/dm-access-control.mts";

/**
 * 담당자 "자동 디엠 이용자 관리".
 *
 * 인플루언서의 자동 디엠은 브랜드 매칭받기 등록으로 열리고, 시간이 지났다고 자동으로
 * 막히지 않는다. 제안을 못 받은 것은 리스트업을 못 해 준 운영 쪽 사정일 수 있어서다.
 * 대신 "등록만 하고 디엠만 쓰는" 사람을 걸러 낼 근거를 담당자에게 보여 주고, 중단은
 * 담당자가 직접 한다.
 *
 * 근거는 리스트업 기록(campaign_listups)이다. 제안을 보냈는지(offer_sent_at), 어떻게
 * 답했는지(outreach_status), 언제 답했는지가 남아 있어 "제안을 받고도 계속 거절한
 * 사람"과 "아직 제안을 못 받은 사람"을 나눌 수 있다. 응답 기한(offer.respondBy)이
 * 지났는데 답이 없는 제안은 무응답으로 센다.
 *
 *   GET  /api/manager-dm-access?filter=all|watch|idle|suspended&q=&minOffers=3
 *   POST /api/manager-dm-access  { action: 'suspend'|'reopen'|'note', username, reason?, note? }
 *   GET  /api/manager-dm-access?history=<username>   중단 · 재개 이력
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "").replace(/^@+/, "");

/** 주의 대상 기본 기준: 최근 3개월 동안 받은 제안이 이 수 이상인데 수락이 0건. */
const DEFAULT_MIN_OFFERS = 3;
const WINDOW_DAYS = 90;
const MAX_ROWS = 500;

type Row = {
  username: string;
  name: string;
  instagram: string;
  followers: number;
  registeredAt: string | null;
  suspended: boolean;
  reason: string;
  note: string;
  suspendedAt: string | null;
  suspendedBy: string;
  reopenedAt: string | null;
  reopenedBy: string;
  recent: { offers: number; accepted: number; declined: number; noResponse: number };
  total: { offers: number; accepted: number; declined: number; noResponse: number };
  lastOfferAt: string | null;
  lastAcceptedAt: string | null;
  lastDeclineNote: string;
  lastDeclineCampaign: string;
  dm: { enabled: boolean; automations: number } | null;
  watch: boolean;
  idle: boolean;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

async function readDmUsage(username: string): Promise<Row["dm"]> {
  try {
    const store = getStore("dm-automation");
    const settings = (await store.get(`dm_${username}`, { type: "json" })) as any;
    if (!settings) return { enabled: false, automations: 0 };
    const automations = Array.isArray(settings.automations) ? settings.automations : [];
    return {
      enabled: Boolean(settings.enabled) && Boolean(settings.accessToken),
      automations: automations.filter((a: any) => a?.enabled !== false).length,
    };
  } catch {
    return null;
  }
}

export default async (req: Request) => {
  const manager = await requireManager(req);
  if (!manager.ok) return manager.response;

  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    const username = norm(body?.username);
    const action = String(body?.action || "");
    const actor = manager.managerUsername || "manager";
    if (!username) return Response.json({ error: "username 이 필요합니다." }, { status: 400 });

    try {
      if (action === "suspend") {
        const reason = String(body?.reason || "").trim().slice(0, 300);
        // 사유는 인플루언서 화면에 그대로 보인다. 왜 막혔는지 모르면 다시 열 방법도 모른다.
        if (!reason) {
          return Response.json({ error: "중단 사유를 입력해 주세요. 인플루언서에게 그대로 안내됩니다." }, { status: 400 });
        }
        await suspendDmAccess(username, reason, actor);
        return Response.json({ success: true });
      }
      if (action === "reopen") {
        await reopenDmAccess(username, actor, String(body?.reason || "").trim().slice(0, 300));
        return Response.json({ success: true });
      }
      if (action === "note") {
        await saveDmAccessNote(username, String(body?.note || "").trim().slice(0, 1000), actor);
        return Response.json({ success: true });
      }
      return Response.json({ error: "알 수 없는 작업입니다." }, { status: 400 });
    } catch (e: any) {
      console.error("[manager-dm-access] action failed:", e?.message);
      return Response.json({ error: "처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
  }

  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const history = norm(url.searchParams.get("history"));
  if (history) {
    const events = await db.sql`
      SELECT action, reason, actor, created_at FROM dm_access_events
      WHERE username = ${history} ORDER BY created_at DESC LIMIT 50
    `;
    return Response.json({
      events: (events as any[]).map((e) => ({
        action: e.action,
        reason: e.reason || "",
        actor: e.actor || "",
        at: iso(e.created_at),
      })),
    });
  }

  const filter = String(url.searchParams.get("filter") || "all");
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const minOffers = Math.max(1, Math.min(20, Number(url.searchParams.get("minOffers")) || DEFAULT_MIN_OFFERS));

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  try {
    // 등록서(사람당 가장 이른 접수) + 담당자 조치 + 리스트업 제안 집계를 한 번에 읽는다.
    const rows = (await db.sql`
      WITH reg AS (
        SELECT DISTINCT ON (LOWER(applicant_username))
          LOWER(applicant_username) AS username, name, instagram_url, follower_count, created_at
        FROM collab_directory_applications
        WHERE role = 'influencer' AND COALESCE(applicant_username, '') <> ''
        ORDER BY LOWER(applicant_username), created_at ASC
      ),
      offers AS (
        SELECT
          LOWER(l.influencer_username) AS username,
          l.offer_sent_at,
          l.responded_at,
          l.response_note,
          c.title AS campaign_title,
          CASE
            WHEN l.outreach_status = 'accepted' THEN 'accepted'
            WHEN l.outreach_status = 'declined' THEN 'declined'
            WHEN l.outreach_status = 'expired' THEN 'no_response'
            WHEN l.outreach_status = 'sent'
              AND COALESCE(l.offer->>'respondBy', '') <> ''
              AND (l.offer->>'respondBy') < TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')
              THEN 'no_response'
            ELSE 'pending'
          END AS outcome
        FROM campaign_listups l
        LEFT JOIN campaigns c ON c.id = l.campaign_id
        WHERE l.offer_sent_at IS NOT NULL
      ),
      agg AS (
        SELECT
          username,
          COUNT(*) AS total_offers,
          COUNT(*) FILTER (WHERE outcome = 'accepted') AS total_accepted,
          COUNT(*) FILTER (WHERE outcome = 'declined') AS total_declined,
          COUNT(*) FILTER (WHERE outcome = 'no_response') AS total_no_response,
          COUNT(*) FILTER (WHERE offer_sent_at >= ${cutoff}::timestamptz) AS recent_offers,
          COUNT(*) FILTER (WHERE outcome = 'accepted' AND offer_sent_at >= ${cutoff}::timestamptz) AS recent_accepted,
          COUNT(*) FILTER (WHERE outcome = 'declined' AND offer_sent_at >= ${cutoff}::timestamptz) AS recent_declined,
          COUNT(*) FILTER (WHERE outcome = 'no_response' AND offer_sent_at >= ${cutoff}::timestamptz) AS recent_no_response,
          MAX(offer_sent_at) AS last_offer_at,
          MAX(responded_at) FILTER (WHERE outcome = 'accepted') AS last_accepted_at
        FROM offers GROUP BY username
      ),
      last_decline AS (
        SELECT DISTINCT ON (username) username, response_note, campaign_title
        FROM offers WHERE outcome = 'declined'
        ORDER BY username, responded_at DESC NULLS LAST
      )
      SELECT
        reg.username, reg.name, reg.instagram_url, reg.follower_count, reg.created_at AS registered_at,
        COALESCE(ctl.suspended, FALSE) AS suspended, COALESCE(ctl.reason, '') AS reason,
        COALESCE(ctl.note, '') AS note, ctl.suspended_at, COALESCE(ctl.suspended_by, '') AS suspended_by,
        ctl.reopened_at, COALESCE(ctl.reopened_by, '') AS reopened_by,
        COALESCE(agg.total_offers, 0) AS total_offers,
        COALESCE(agg.total_accepted, 0) AS total_accepted,
        COALESCE(agg.total_declined, 0) AS total_declined,
        COALESCE(agg.total_no_response, 0) AS total_no_response,
        COALESCE(agg.recent_offers, 0) AS recent_offers,
        COALESCE(agg.recent_accepted, 0) AS recent_accepted,
        COALESCE(agg.recent_declined, 0) AS recent_declined,
        COALESCE(agg.recent_no_response, 0) AS recent_no_response,
        agg.last_offer_at, agg.last_accepted_at,
        COALESCE(ld.response_note, '') AS last_decline_note,
        COALESCE(ld.campaign_title, '') AS last_decline_campaign
      FROM reg
      LEFT JOIN dm_access_controls ctl ON ctl.username = reg.username
      LEFT JOIN agg ON agg.username = reg.username
      LEFT JOIN last_decline ld ON ld.username = reg.username
      ORDER BY reg.created_at DESC
      LIMIT ${MAX_ROWS}
    `) as any[];

    const now = Date.now();
    const windowMs = WINDOW_DAYS * 86_400_000;
    let shaped: Row[] = rows.map((r) => {
      const recent = {
        offers: Number(r.recent_offers || 0),
        accepted: Number(r.recent_accepted || 0),
        declined: Number(r.recent_declined || 0),
        noResponse: Number(r.recent_no_response || 0),
      };
      const registeredAt = iso(r.registered_at);
      const lastOfferAt = iso(r.last_offer_at);
      // 3개월 넘게 제안을 못 받은 사람 — 리스트업이 밀린 쪽이다. 계속 이용하게 두고,
      // 담당자가 후보를 찾을 때 참고하도록 따로 묶는다.
      const sinceOffer = lastOfferAt || registeredAt;
      const idle = !!sinceOffer && now - Date.parse(sinceOffer) >= windowMs;
      return {
        username: r.username,
        name: r.name || "",
        instagram: r.instagram_url || "",
        followers: Number(r.follower_count || 0),
        registeredAt,
        suspended: !!r.suspended,
        reason: r.reason || "",
        note: r.note || "",
        suspendedAt: iso(r.suspended_at),
        suspendedBy: r.suspended_by || "",
        reopenedAt: iso(r.reopened_at),
        reopenedBy: r.reopened_by || "",
        recent,
        total: {
          offers: Number(r.total_offers || 0),
          accepted: Number(r.total_accepted || 0),
          declined: Number(r.total_declined || 0),
          noResponse: Number(r.total_no_response || 0),
        },
        lastOfferAt,
        lastAcceptedAt: iso(r.last_accepted_at),
        lastDeclineNote: r.last_decline_note || "",
        lastDeclineCampaign: r.last_decline_campaign || "",
        dm: null,
        watch: recent.offers >= minOffers && recent.accepted === 0,
        idle,
      };
    });

    const summary = {
      total: shaped.length,
      watch: shaped.filter((r) => r.watch && !r.suspended).length,
      idle: shaped.filter((r) => r.idle && !r.suspended).length,
      suspended: shaped.filter((r) => r.suspended).length,
    };

    if (filter === "watch") shaped = shaped.filter((r) => r.watch && !r.suspended);
    else if (filter === "idle") shaped = shaped.filter((r) => r.idle && !r.suspended);
    else if (filter === "suspended") shaped = shaped.filter((r) => r.suspended);
    if (q) {
      shaped = shaped.filter(
        (r) => r.username.includes(q) || r.name.toLowerCase().includes(q) || r.instagram.toLowerCase().includes(q),
      );
    }

    // 자동 디엠을 실제로 켜 두었는지는 블롭에 있다. 화면에 보이는 줄만 읽는다.
    const visible = shaped.slice(0, 200);
    const usage = await mapConcurrent(visible, 8, (r) => readDmUsage(r.username));
    visible.forEach((r, i) => { r.dm = usage[i]; });

    return Response.json({
      rows: visible,
      truncated: shaped.length > visible.length,
      summary,
      criteria: { minOffers, windowDays: WINDOW_DAYS },
    });
  } catch (e: any) {
    console.error("[manager-dm-access] list failed:", e?.message);
    return Response.json({ error: "목록을 불러오지 못했습니다." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/manager-dm-access",
};
