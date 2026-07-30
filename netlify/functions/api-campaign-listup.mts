import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAccountOwner, requireSignedInUser } from "./_shared/user-auth.mts";
import { requireManager } from "./_shared/manager-auth.mts";
import { newId, norm } from "./_shared/collab-workflow.mts";
import {
  acceptListup,
  buildSnapshot,
  normalizeOffer,
  offerFromCampaign,
  shapeChannel,
  shapeListup,
} from "./_shared/campaign-listup.mts";

/**
 * 캠페인 리스트업 — 후보 명단과 제안 조율.
 *
 * 브랜드는 캠페인만 열고, 담당자가 어울리는 인플루언서를 찾아 명단을 만든다.
 * 브랜드는 명단을 보고 고르기만 하고(구속력 없는 선택이 아니라 "이 사람으로
 * 진행해 주세요"라는 요청이다), 제안을 들고 가는 사람은 담당자다. 인플루언서가
 * 수락하면 그 자리에서 협업이 만들어진다.
 *
 *   GET  ?campaign_id=..            브랜드/담당자 — 후보 명단
 *   GET  ?campaign_id=..&pool=1     담당자 — 명단에 올릴 후보 풀 검색
 *   GET  ?influencer=..             인플루언서 — 내가 받은 제안
 *   POST                            담당자 — 후보를 명단에 올림
 *   PATCH                           결정·제안·응답·메모·삭제
 *
 * 권한을 한 줄로 요약하면 이렇다. 명단을 만드는 것은 담당자, 고르는 것은 브랜드,
 * 답하는 것은 인플루언서. 세 가지를 한 사람이 다 할 수 있으면 중개가 아니다.
 */

/**
 * 캠페인 한 건. 브리프 컬럼까지 함께 읽는다 — 제안 초안이 브리프에서 출발해야
 * 담당자가 같은 값을 두 번 적지 않는다.
 */
async function loadCampaign(db: any, campaignId: string) {
  const rows = await db.sql`
    SELECT id, title, brand_name, business_username, manager_username, type,
           description, reward_type, reward_amount, start_date, end_date, status,
           product_name, product_url, upload_channel, content_format, video_concept,
           guideline_url, guideline_note, second_use_fee, second_use_note,
           upload_from, upload_to
    FROM campaigns WHERE id = ${campaignId}
  `;
  return (rows as any[])?.[0] || null;
}

const shapeCampaign = (c: any) => ({
  id: c.id,
  title: c.title || "",
  brandName: c.brand_name || "",
  businessUsername: c.business_username || "",
  managerUsername: c.manager_username || "",
  type: c.type || "",
  rewardType: c.reward_type || "",
  rewardAmount: c.reward_amount || "",
  startDate: c.start_date || "",
  endDate: c.end_date || "",
  productName: c.product_name || "",
  uploadChannel: c.upload_channel || "",
  contentFormat: c.content_format || "",
  uploadFrom: c.upload_from || "",
  uploadTo: c.upload_to || "",
  guidelineUrl: c.guideline_url || "",
  guidelineNote: c.guideline_note || "",
  secondUseFee: Number(c.second_use_fee || 0),
});

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  // -------------------------------------------------------------------------
  // GET
  // -------------------------------------------------------------------------
  if (req.method === "GET") {
    try {
      const influencer = norm(url.searchParams.get("influencer") || "");
      if (influencer) {
        // 인플루언서 본인(또는 담당자)이 받은 제안 목록.
        const manager = await requireManager(req);
        if (!manager.ok) {
          const auth = await requireAccountOwner(req, influencer);
          if (!auth.ok) return auth.response;
        }

        const rows = await db.sql`
          SELECT l.*, c.title AS campaign_title, c.brand_name, c.type AS campaign_type,
                 c.description, c.product_name, c.manager_username
          FROM campaign_listups l
          JOIN campaigns c ON c.id = l.campaign_id
          WHERE l.influencer_username = ${influencer}
            AND l.outreach_status IN ('sent', 'accepted', 'declined', 'expired')
          ORDER BY
            CASE l.outreach_status WHEN 'sent' THEN 0 ELSE 1 END,
            l.offer_sent_at DESC NULLS LAST
          LIMIT 50
        `;
        return Response.json({
          offers: (rows as any[]).map((r) => shapeListup(r, "influencer")),
        });
      }

      const campaignId = url.searchParams.get("campaign_id") || "";
      if (!campaignId) {
        return Response.json({ error: "캠페인 ID가 필요합니다." }, { status: 400 });
      }
      const campaign = await loadCampaign(db, campaignId);
      if (!campaign) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      const manager = await requireManager(req);
      let viewerRole: "manager" | "brand" = "manager";
      if (!manager.ok) {
        const auth = await requireAccountOwner(req, String(campaign.business_username || ""));
        if (!auth.ok) return auth.response;
        viewerRole = "brand";
      }

      const listRows = await db.sql`
        SELECT * FROM campaign_listups
        WHERE campaign_id = ${campaignId}
        ORDER BY
          CASE brand_decision WHEN 'pick' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          created_at DESC
      `;
      const candidates = (listRows as any[]).map((r) => shapeListup(r, viewerRole));
      const listed = new Set((listRows as any[]).map((r) => norm(r.influencer_username)));

      const payload: Record<string, unknown> = {
        candidates,
        viewerRole,
        campaign: shapeCampaign(campaign),
        // 담당자 폼의 초기값. 브리프를 그대로 옮겨 두고 담당자가 고쳐서 보낸다.
        offerDraft: offerFromCampaign(campaign),
      };

      // 후보 풀은 담당자만 본다. 연락처와 다른 브랜드 관련 정보가 섞여 있고,
      // 브랜드가 직접 인플루언서를 찾아 접촉하면 중개 구조가 무너진다.
      if (viewerRole === "manager" && url.searchParams.get("pool") === "1") {
        const q = String(url.searchParams.get("q") || "").trim();
        const like = `%${q}%`;

        const [dirRows, channelRows, applicantRows] = await Promise.all([
          db.sql`
            SELECT id, applicant_username, name, instagram_url, category,
                   ad_price, post_price, short_price, note,
                   COALESCE(NULLIF(instagram_followers, 0), follower_count) AS followers,
                   created_at
            FROM collab_directory_applications
            WHERE role = 'influencer'
              AND COALESCE(applicant_username, '') <> ''
              AND (
                ${q} = ''
                OR applicant_username ILIKE ${like}
                OR name ILIKE ${like}
                OR category ILIKE ${like}
              )
            ORDER BY followers DESC NULLS LAST
            LIMIT 60
          ` as Promise<any[]>,

          db.sql`
            SELECT * FROM creator_channels
            WHERE (
              ${q} = ''
              OR username ILIKE ${like}
              OR instagram_handle ILIKE ${like}
              OR categories ILIKE ${like}
            )
            ORDER BY followers DESC
            LIMIT 60
          ` as Promise<any[]>,

          db.sql`
            SELECT applicant_username, instagram_url, message, contact, status
            FROM campaign_applications
            WHERE campaign_id = ${campaignId}
              AND COALESCE(source, 'apply') = 'apply'
            ORDER BY created_at DESC
            LIMIT 100
          ` as Promise<any[]>,
        ]);

        const pool = new Map<string, any>();
        const touch = (username: string) => {
          const key = norm(username);
          if (!key) return null;
          if (!pool.has(key)) {
            pool.set(key, {
              username: key,
              name: "",
              source: "manager",
              isApplicant: false,
              adPrice: "",
              postPrice: "",
              shortPrice: "",
              categories: "",
              intro: "",
              note: "",
              instagramUrl: "",
              instagramHandle: "",
              followers: 0,
              avgViews: 0,
              avgLikes: 0,
              avgComments: 0,
              reelsCount: 0,
              metricsSource: "",
              connected: false,
              recentReels: [],
              syncedAt: "",
              directoryId: "",
            });
          }
          return pool.get(key);
        };

        for (const d of dirRows as any[]) {
          const item = touch(d.applicant_username);
          if (!item) continue;
          item.source = "directory";
          item.directoryId = d.id;
          item.name = d.name || item.name;
          item.instagramUrl = item.instagramUrl || d.instagram_url || "";
          item.categories = item.categories || d.category || "";
          item.adPrice = d.ad_price || "";
          item.postPrice = d.post_price || "";
          item.shortPrice = d.short_price || "";
          item.note = d.note || "";
          if (!item.followers) item.followers = Number(d.followers || 0);
        }

        for (const ch of channelRows as any[]) {
          const item = touch(ch.username);
          if (!item) continue;
          const shaped = shapeChannel(ch);
          // 본인이 등록한 지표가 지원서의 수기 입력보다 우선한다.
          item.instagramHandle = shaped.instagramHandle;
          item.instagramUrl = shaped.instagramUrl || item.instagramUrl;
          item.followers = shaped.followers || item.followers;
          item.avgViews = shaped.avgViews;
          item.avgLikes = shaped.avgLikes;
          item.avgComments = shaped.avgComments;
          item.reelsCount = shaped.reelsCount;
          item.metricsSource = shaped.metricsSource;
          item.connected = shaped.connected;
          item.recentReels = shaped.recentReels.slice(0, 3);
          item.syncedAt = shaped.syncedAt;
          item.intro = shaped.intro;
          item.categories = item.categories || shaped.categories;
        }

        for (const a of applicantRows as any[]) {
          const item = touch(a.applicant_username);
          if (!item) continue;
          // 이미 지원한 사람은 명단 맨 위로 올라와야 한다. 우리를 먼저 찾아온
          // 사람에게 제안하는 것이 언제나 성공률이 높다.
          item.isApplicant = true;
          item.source = "application";
          item.instagramUrl = item.instagramUrl || a.instagram_url || "";
          item.applicationStatus = a.status || "";
        }

        payload.pool = Array.from(pool.values())
          .filter((p) => !listed.has(p.username))
          .sort((a, b) => {
            if (a.isApplicant !== b.isApplicant) return a.isApplicant ? -1 : 1;
            return (b.followers || 0) - (a.followers || 0);
          })
          .slice(0, 60);
      }

      return Response.json(payload);
    } catch (err: any) {
      return Response.json({ error: err?.message || "리스트업을 불러오지 못했습니다." }, { status: 500 });
    }
  }

  // -------------------------------------------------------------------------
  // POST — 명단에 올리기 (담당자)
  // -------------------------------------------------------------------------
  if (req.method === "POST") {
    try {
      const manager = await requireManager(req);
      if (!manager.ok) return manager.response;

      const body = (await req.json()) as any;
      const campaignId = String(body.campaignId || body.campaign_id || "");
      const rawList = Array.isArray(body.usernames)
        ? body.usernames
        : body.username
          ? [body.username]
          : [];
      const usernames = Array.from(new Set(rawList.map((u: unknown) => norm(u)).filter(Boolean)));
      const note = String(body.note || "");

      if (!campaignId || usernames.length === 0) {
        return Response.json({ error: "캠페인과 인플루언서를 지정해 주세요." }, { status: 400 });
      }
      const campaign = await loadCampaign(db, campaignId);
      if (!campaign) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      const applicants = await db.sql`
        SELECT applicant_username FROM campaign_applications
        WHERE campaign_id = ${campaignId} AND COALESCE(source, 'apply') = 'apply'
      `;
      const applicantSet = new Set((applicants as any[]).map((a) => norm(a.applicant_username)));

      let added = 0;
      for (const username of usernames) {
        const snapshot = await buildSnapshot(db, username);
        const source = applicantSet.has(username)
          ? "application"
          : snapshot.syncedFrom === "directory"
            ? "directory"
            : "manager";
        const res = await db.sql`
          INSERT INTO campaign_listups (
            id, campaign_id, influencer_username, source, snapshot, snapshot_at,
            manager_note, listed_by
          ) VALUES (
            ${newId("lst")}, ${campaignId}, ${username}, ${source},
            ${JSON.stringify(snapshot)}, NOW(), ${note}, ${manager.managerUsername}
          )
          ON CONFLICT (campaign_id, influencer_username) DO NOTHING
          RETURNING id
        `;
        if ((res as any[])?.length) added += 1;
      }

      const rows = await db.sql`
        SELECT * FROM campaign_listups
        WHERE campaign_id = ${campaignId}
        ORDER BY
          CASE brand_decision WHEN 'pick' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          created_at DESC
      `;

      return Response.json({
        success: true,
        added,
        skipped: usernames.length - added,
        candidates: (rows as any[]).map((r) => shapeListup(r, "manager")),
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "명단에 올리지 못했습니다." }, { status: 500 });
    }
  }

  // -------------------------------------------------------------------------
  // PATCH — 결정 / 제안 / 응답
  // -------------------------------------------------------------------------
  if (req.method === "PATCH") {
    try {
      const body = (await req.json()) as any;
      const id = String(body.id || "");
      const action = String(body.action || "");
      if (!id || !action) {
        return Response.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
      }

      const listupRows = await db.sql`SELECT * FROM campaign_listups WHERE id = ${id}`;
      const listup = (listupRows as any[])?.[0];
      if (!listup) {
        return Response.json({ error: "후보를 찾을 수 없습니다." }, { status: 404 });
      }
      const campaign = await loadCampaign(db, listup.campaign_id);
      if (!campaign) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      const manager = await requireManager(req);
      const isManager = manager.ok;
      const managerUsername = manager.ok ? manager.managerUsername : "";
      // 담당자 전용 동작의 거절 응답. !isManager 인 자리에서만 부르지만, 타입상
      // 두 갈래를 모두 채워 둔다.
      const managerRequired = () =>
        manager.ok
          ? Response.json(
              { error: "픽스폴리오 담당자만 처리할 수 있습니다.", code: "MANAGER_REQUIRED" },
              { status: 403 },
            )
          : manager.response;

      const reload = async (viewer: "manager" | "brand" | "influencer") => {
        const next = await db.sql`SELECT * FROM campaign_listups WHERE id = ${id}`;
        return shapeListup((next as any[])[0], viewer);
      };

      // --- 브랜드 선택 -----------------------------------------------------
      if (action === "brand_decision") {
        const decision = String(body.decision || "");
        if (!["pending", "pick", "pass"].includes(decision)) {
          return Response.json({ error: "잘못된 선택 값입니다." }, { status: 400 });
        }
        let viewer: "manager" | "brand" = "manager";
        if (!isManager) {
          const auth = await requireAccountOwner(req, String(campaign.business_username || ""));
          if (!auth.ok) return auth.response;
          viewer = "brand";
        }
        // 이미 제안이 나갔거나 수락된 후보의 선택을 되돌리면 인플루언서가 받은
        // 제안과 브랜드 화면이 서로 다른 말을 하게 된다.
        if (listup.outreach_status === "accepted" && decision !== "pick") {
          return Response.json(
            { error: "이미 수락된 후보입니다. 진행을 멈추려면 담당자에게 알려 주세요." },
            { status: 409 },
          );
        }
        await db.sql`
          UPDATE campaign_listups
          SET brand_decision = ${decision},
              brand_decision_note = ${String(body.note || "")},
              brand_decided_at = NOW(),
              updated_at = NOW()
          WHERE id = ${id}
        `;
        return Response.json({ success: true, listup: await reload(viewer) });
      }

      // --- 담당자 메모 -----------------------------------------------------
      if (action === "note") {
        if (!isManager) return managerRequired();
        await db.sql`
          UPDATE campaign_listups
          SET manager_note = ${String(body.managerNote ?? body.note ?? "")}, updated_at = NOW()
          WHERE id = ${id}
        `;
        return Response.json({ success: true, listup: await reload("manager") });
      }

      // --- 제안 발송 -------------------------------------------------------
      if (action === "send_offer") {
        if (!isManager) return managerRequired();
        if (listup.outreach_status === "accepted") {
          return Response.json({ error: "이미 수락된 제안입니다." }, { status: 409 });
        }
        if (listup.brand_decision !== "pick") {
          return Response.json(
            { error: "브랜드가 선택한 후보에게만 제안을 보낼 수 있습니다." },
            { status: 409 },
          );
        }
        const offer = normalizeOffer(body.offer);
        if (!offer.fee) {
          return Response.json({ error: "단가를 입력해 주세요." }, { status: 400 });
        }
        if (!offer.uploadFrom && !offer.startDate) {
          return Response.json({ error: "일정(시작일 또는 희망 게시일)을 입력해 주세요." }, { status: 400 });
        }
        await db.sql`
          UPDATE campaign_listups
          SET offer = ${JSON.stringify(offer)},
              outreach_status = 'sent',
              offer_sent_at = NOW(),
              offer_sent_by = ${managerUsername},
              responded_at = NULL,
              response_note = '',
              updated_at = NOW()
          WHERE id = ${id}
        `;
        return Response.json({ success: true, listup: await reload("manager") });
      }

      // --- 제안 회수 -------------------------------------------------------
      if (action === "withdraw_offer") {
        if (!isManager) return managerRequired();
        if (listup.outreach_status === "accepted") {
          return Response.json({ error: "이미 수락된 제안은 회수할 수 없습니다." }, { status: 409 });
        }
        await db.sql`
          UPDATE campaign_listups
          SET outreach_status = 'not_sent',
              offer_sent_at = NULL,
              responded_at = NULL,
              response_note = ${String(body.note || "")},
              updated_at = NOW()
          WHERE id = ${id}
        `;
        return Response.json({ success: true, listup: await reload("manager") });
      }

      // --- 인플루언서 응답 -------------------------------------------------
      if (action === "respond") {
        const creator = norm(listup.influencer_username);
        let viewer: "manager" | "influencer" = "manager";
        if (!isManager) {
          const auth = await requireAccountOwner(req, creator);
          if (!auth.ok) return auth.response;
          viewer = "influencer";
        }
        const accept = body.accept === true || String(body.decision || "") === "accept";
        const note = String(body.note || "");

        if (listup.outreach_status === "accepted") {
          // 두 번 눌렀거나 새로고침이 늦었을 때. 이미 만들어진 협업을 알려준다.
          return Response.json({
            success: true,
            alreadyAccepted: true,
            collabId: listup.collab_id || "",
            listup: await reload(viewer),
          });
        }
        if (listup.outreach_status !== "sent") {
          return Response.json({ error: "응답할 제안이 없습니다." }, { status: 409 });
        }

        if (!accept) {
          await db.sql`
            UPDATE campaign_listups
            SET outreach_status = 'declined',
                responded_at = NOW(),
                response_note = ${note},
                updated_at = NOW()
            WHERE id = ${id}
          `;
          return Response.json({ success: true, listup: await reload(viewer) });
        }

        const signedIn = await requireSignedInUser(req);
        const actorUsername = isManager
          ? managerUsername
          : signedIn.ok
            ? signedIn.username
            : creator;

        const result = await acceptListup({
          db,
          listup,
          campaign,
          actorRole: viewer === "influencer" ? "influencer" : "manager",
          actorUsername,
        });

        await db.sql`
          UPDATE campaign_listups
          SET outreach_status = 'accepted',
              responded_at = NOW(),
              response_note = ${note},
              collab_id = ${result.collabId},
              updated_at = NOW()
          WHERE id = ${id}
        `;

        return Response.json({
          success: true,
          collabId: result.collabId,
          created: result.created,
          threads: {
            influencerSupport: result.influencerThreadId,
            brandSupport: result.brandThreadId,
          },
          listup: await reload(viewer),
        });
      }

      // --- 명단에서 빼기 ---------------------------------------------------
      if (action === "remove") {
        if (!isManager) return managerRequired();
        if (listup.collab_id || listup.outreach_status === "accepted") {
          return Response.json(
            { error: "이미 협업이 시작된 후보는 명단에서 뺄 수 없습니다." },
            { status: 409 },
          );
        }
        await db.sql`DELETE FROM campaign_listups WHERE id = ${id}`;
        return Response.json({ success: true, removed: id });
      }

      return Response.json({ error: "알 수 없는 동작입니다." }, { status: 400 });
    } catch (err: any) {
      return Response.json({ error: err?.message || "처리에 실패했습니다." }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/campaign-listup",
};
