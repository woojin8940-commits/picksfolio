import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import {
  forbiddenResponse,
  requireAccountOwner,
  requireSignedInUser,
} from "./_shared/user-auth.mts";
import { requireManager, resolveIdentities } from "./_shared/manager-auth.mts";
import { newId, norm } from "./_shared/collab-workflow.mts";
import { isManagerListupMode } from "./_shared/reward-mode.mts";
import {
  acceptListup,
  buildSnapshot,
  mergePayoutIntoOffer,
  normalizeOffer,
  normalizePayout,
  normalizeQuote,
  offerFromCampaign,
  loadManagerContacts,
  refreshListupSnapshots,
  registeredPayoutFee,
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
           upload_from, upload_to,
           -- 진행 방식이 협업 단계를 정한다(제품 협찬형에는 검수·정산 단계가 없다).
           -- package_tier 는 진행 방식이 없던 시절 캠페인의 대체값으로만 쓴다.
           -- 희망 인플루언서 조건은 담당자가 후보를 고를 때 읽는 값이다.
           reward_mode, tier_counts, package_tier,
           ad_objective, influencer_gender, influencer_ages,
           sns_category, follower_tiers, min_views, influencer_styles,
           exclude_keywords, target_audience,
           -- 명단 확정 기한. 브랜드 화면의 남은 시간 표시가 이 값을 읽는다.
           listup_confirm_due, listup_published_at
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
  // 담당자 리스트업 화면이 후보를 고를 때 쓰는 조건.
  rewardMode: c.reward_mode || "paid",
  // 이 캠페인에 담당자 리스트업이 붙는지. 담당자 화면이 이 값으로 후보 등록 자리를
  // 감춘다 — 서버가 어차피 막으므로, 눌러 본 뒤에 거절당하는 일이 없게 한다.
  managerListup: isManagerListupMode(c.reward_mode),
  // 규모별 모집 인원. 'nano:10,micro:3' 형태 그대로 넘겨 화면에서 풀어 읽는다.
  tierCounts: c.tier_counts || "",
  packageTier: c.package_tier || "full",
  adObjective: c.ad_objective || "",
  influencerGender: c.influencer_gender || "",
  influencerAges: c.influencer_ages || "",
  snsCategory: c.sns_category || "",
  followerTiers: c.follower_tiers || "",
  minViews: Number(c.min_views || 0),
  influencerStyles: c.influencer_styles || "",
  excludeKeywords: c.exclude_keywords || "",
  targetAudience: c.target_audience || "",
  listupConfirmDue: c.listup_confirm_due || null,
  listupPublishedAt: c.listup_published_at || null,
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

      // 캠페인 소유자면 기본은 브랜드 화면이다.
      //
      // 예전에는 담당자 판정을 먼저 했다. 그런데 Netlify Identity 는 `nf_jwt`
      // **쿠키**만으로도 인증이 성립하므로, 운영 콘솔에 로그인한 브라우저에서 자기
      // 브랜드 계정으로 명단을 열면 담당자 화면이 나왔다 — 브랜드에게 절대 보이면
      // 안 되는 인플루언서 지급 단가와 마진이 그대로 실려 나간다. 담당자 화면은
      // 담당자 도구로 들어올 때만(후보 풀 검색 · viewer=manager) 준다.
      const wantsManagerView =
        url.searchParams.get("pool") === "1" || url.searchParams.get("viewer") === "manager";
      const { account, manager, accountError } = await resolveIdentities(req);
      const isOwner = !!account && account.username === norm(campaign.business_username || "");
      let viewerRole: "manager" | "brand";
      if (manager && (wantsManagerView || !isOwner)) {
        viewerRole = "manager";
      } else if (isOwner) {
        viewerRole = "brand";
      } else {
        return accountError || forbiddenResponse();
      }

      const listRows = await db.sql`
        SELECT * FROM campaign_listups
        WHERE campaign_id = ${campaignId}
        ORDER BY
          CASE brand_decision WHEN 'pick' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          created_at DESC
      `;
      // 굳은 스냅샷 위에 지금 채널 값을 덧입힌다. 연동을 나중에 마친 후보의 카드가
      // 계속 '—' 로 남지 않게 하기 위한 것으로, 규칙은 refreshListupSnapshots 주석에 있다.
      const freshRows = await refreshListupSnapshots(db, listRows as any[]);
      const candidates = freshRows.map((r) => shapeListup(r, viewerRole));
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
              recentFeed: [],
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
          // 동향(최근 절반 대 이전 절반)을 화면에서 계산하므로 릴스는 줄이지 않고
          // 저장된 만큼 그대로 보낸다(최대 6개). 3개만 보내면 추이가 나오지 않는다.
          item.recentReels = shaped.recentReels;
          // 피드 9칸은 그림만 필요하다. 캡션·좋아요까지 실으면 후보 60명 분량이
          // 목록 응답을 몇 배로 불린다 — 카드가 쓰지 않는 값은 보내지 않는다.
          item.recentFeed = (shaped.recentFeed || []).slice(0, 9).map((f: any) => ({
            id: f?.id || "",
            permalink: f?.permalink || "",
            thumbnailUrl: f?.thumbnailUrl || "",
            mediaType: f?.mediaType || "",
          }));
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

      // 담당자 카드에는 성함과 연락처를 함께 내려보낸다. 명단을 보다가 마음에 드는
      // 사람이 나오면 그 자리에서 전화를 거는 것이 담당자 일의 다음 한 걸음이고,
      // 지금은 그 번호를 찾으러 등록서 화면을 따로 열어야 한다.
      //
      // 브랜드 화면에는 절대 실리지 않는다 — viewerRole 이 manager 일 때만 붙이고,
      // 이유는 loadManagerContacts 주석에 있다.
      if (viewerRole === "manager") {
        const poolItems = (payload.pool as any[]) || [];
        const contacts = await loadManagerContacts(
          db,
          [
            ...(candidates as any[]).map((c) => c.influencerUsername),
            ...poolItems.map((p) => p.username),
          ],
          campaignId,
        );
        for (const c of candidates as any[]) {
          c.contact = contacts.get(norm(c.influencerUsername)) || null;
        }
        for (const p of poolItems) p.contact = contacts.get(norm(p.username)) || null;
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
      // 제시 조건. 한 번에 여러 명을 올릴 때 같은 값을 적용하되, 사람마다 다르게
      // 매기고 싶으면 quotes 로 계정별 값을 덮어쓴다. 담당자가 명단을 만들 때
      // 금액을 비워 두면 브랜드 화면에는 "협의"로 나가고, 나중에 채울 수 있다.
      const quoteDefaults = normalizeQuote(body.quote);
      const quoteByUser: Record<string, ReturnType<typeof normalizeQuote>> = {};
      if (body.quotes && typeof body.quotes === "object") {
        for (const [key, value] of Object.entries(body.quotes)) {
          quoteByUser[norm(key)] = normalizeQuote(value);
        }
      }
      // 인플루언서에게 줄 금액. 제시가와 함께 적어 두면 명단을 만든 그 자리에서
      // 차액(우리 수익)이 계산된다. 비워 두면 제안을 보낼 때 채운다.
      const payoutDefaults = normalizePayout(body.payout);
      const payoutByUser: Record<string, ReturnType<typeof normalizePayout>> = {};
      if (body.payouts && typeof body.payouts === "object") {
        for (const [key, value] of Object.entries(body.payouts)) {
          payoutByUser[norm(key)] = normalizePayout(value);
        }
      }

      if (!campaignId || usernames.length === 0) {
        return Response.json({ error: "캠페인과 인플루언서를 지정해 주세요." }, { status: 400 });
      }
      const campaign = await loadCampaign(db, campaignId);
      if (!campaign) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }
      // 제품 협찬형은 지원자만 받는다. 브랜드 화면에 리스트업 자리가 없으므로 여기서
      // 후보가 올라가면 아무도 보지 못하는 명단이 쌓인다.
      if (!isManagerListupMode(campaign.reward_mode)) {
        return Response.json(
          {
            error: "제품 협찬형 캠페인은 지원자만 받습니다. 리스트업 없이 지원자 명단에서 골라 주세요.",
            code: "LISTUP_NOT_ALLOWED",
          },
          { status: 409 },
        );
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
        const quote = quoteByUser[username] || quoteDefaults;
        // 보장 조회수를 담당자가 비워 두면 최근 릴스 평균으로 채운다. 브랜드가
        // 고를 때 CPV 칸이 비어 있으면 금액만 보고 고르게 되는데, 그 판단은
        // 팔로워가 많은 쪽으로만 쏠린다.
        const guaranteedViews = quote.guaranteedViews || Number(snapshot.avgViews || 0);
        // 지급액은 아직 보내지 않은 제안 초안(offer)에 담는다. 제안 폼이 이 초안을
        // 그대로 불러오므로 담당자가 같은 금액을 두 번 적지 않는다.
        //
        // 담당자가 지급 단가를 비워 두면 인플루언서가 "브랜드 매칭 받기"에 적어 둔
        // 단가를 그대로 쓴다. 여러 후보를 한 번에 올릴 때는 폼이 하나뿐이라 사람마다
        // 다른 단가를 넣을 자리가 없는데, 그 값은 이미 각자의 등록서에 있다 —
        // 담당자가 브랜드에게 제시할 금액만 적으면 되도록 여기서 채운다.
        const draftOffer = offerFromCampaign(campaign);
        const requested = payoutByUser[username] || payoutDefaults;
        const payout =
          requested.fee > 0
            ? requested
            : { ...requested, fee: registeredPayoutFee(snapshot, draftOffer.contentFormat) };
        const offerDraft = mergePayoutIntoOffer(draftOffer, payout);
        const res = await db.sql`
          INSERT INTO campaign_listups (
            id, campaign_id, influencer_username, source, snapshot, snapshot_at,
            manager_note, listed_by,
            quoted_fee, quoted_second_use_fee, guaranteed_views,
            offer
          ) VALUES (
            ${newId("lst")}, ${campaignId}, ${username}, ${source},
            ${JSON.stringify(snapshot)}, NOW(), ${note}, ${manager.managerUsername},
            ${quote.fee}, ${quote.secondUseFee}, ${guaranteedViews},
            ${JSON.stringify(offerDraft)}
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

      // --- 브랜드 일괄 확정 -------------------------------------------------
      // "인플루언서 모두 선택 완료" 버튼. 한 건씩 보내면 중간에 실패했을 때
      // 절반만 확정된 상태가 남는데, 브랜드 화면에는 그 절반이 보이지 않는다.
      // 그래서 캠페인 단위로 한 번에 처리한다.
      if (action === "brand_decision_bulk") {
        const campaignId = String(body.campaignId || "");
        const ids = Array.isArray(body.ids) ? body.ids.map((v: any) => String(v)) : [];
        if (!campaignId || !ids.length) {
          return Response.json({ error: "선택한 인플루언서가 없습니다." }, { status: 400 });
        }
        const campaign = await loadCampaign(db, campaignId);
        if (!campaign) {
          return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
        }
        const bulkManager = await requireManager(req);
        let viewer: "manager" | "brand" = "manager";
        if (!bulkManager.ok) {
          const auth = await requireAccountOwner(req, String(campaign.business_username || ""));
          if (!auth.ok) return auth.response;
          viewer = "brand";
        }
        // 고른 사람은 pick, 나머지는 pass. 이미 수락된 후보는 건드리지 않는다 —
        // 인플루언서가 수락한 뒤에 브랜드 화면에서 조용히 취소되면 안 된다.
        await db.sql`
          UPDATE campaign_listups
          SET brand_decision = CASE WHEN id = ANY(${ids}) THEN 'pick' ELSE 'pass' END,
              brand_decided_at = NOW(),
              updated_at = NOW()
          WHERE campaign_id = ${campaignId}
            AND outreach_status <> 'accepted'
        `;
        const rows = (await db.sql`
          SELECT * FROM campaign_listups WHERE campaign_id = ${campaignId}
          ORDER BY created_at ASC
        `) as any[];
        return Response.json({
          success: true,
          listups: rows.map((r) => shapeListup(r, viewer)),
        });
      }

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

      // --- 브랜드에게 보여 줄 견적 -----------------------------------------
      // 광고비 · 2차 활용비 · 보장 조회수 · 배지. 명단에 올린 뒤에도 고칠 수 있어야
      // 한다 — 협의는 명단을 만든 다음에 끝나는 경우가 더 많다.
      if (action === "quote") {
        if (!isManager) return managerRequired();
        const quote = normalizeQuote(body.quote ?? body);
        const snapshot =
          listup.snapshot && typeof listup.snapshot === "object" ? (listup.snapshot as any) : {};
        const guaranteedViews = quote.guaranteedViews || Number(snapshot.avgViews || 0);
        await db.sql`
          UPDATE campaign_listups
          SET quoted_fee = ${quote.fee},
              quoted_second_use_fee = ${quote.secondUseFee},
              guaranteed_views = ${guaranteedViews},
              updated_at = NOW()
          WHERE id = ${id}
        `;
        // 지급액을 함께 보냈으면 제안 초안도 고친다. 이미 보낸 제안은 손대지 않는다 —
        // 인플루언서가 읽은 금액과 우리 기록이 달라지면 어느 쪽이 약속인지 알 수 없다.
        if (body.payout !== undefined) {
          if (listup.outreach_status === "not_sent") {
            const requested = normalizePayout(body.payout);
            // 명단에 올릴 때와 같은 규칙 — 비워 두면 등록 단가로 되돌아간다.
            const payout =
              requested.fee > 0
                ? requested
                : {
                    ...requested,
                    fee: registeredPayoutFee(snapshot, normalizeOffer(listup.offer).contentFormat),
                  };
            const nextOffer = mergePayoutIntoOffer(listup.offer, payout);
            await db.sql`
              UPDATE campaign_listups
              SET offer = ${JSON.stringify(nextOffer)}, updated_at = NOW()
              WHERE id = ${id}
            `;
          } else {
            return Response.json(
              {
                success: true,
                warning: "제시가는 저장했습니다. 이미 보낸 제안의 지급 단가는 제안을 회수한 뒤 고칠 수 있습니다.",
                listup: await reload("manager"),
              },
            );
          }
        }
        return Response.json({ success: true, listup: await reload("manager") });
      }

      // --- 찜하기 -----------------------------------------------------------
      // brand_decision 과 따로 두는 이유. 찜은 "나중에 다시 볼게요"이고 pick 은
      // "이 사람으로 진행해 주세요"다. 한 칸에 담으면 담당자가 브랜드의 어느
      // 쪽 뜻인지 구분할 수 없다.
      if (action === "favorite") {
        let viewer: "manager" | "brand" = "manager";
        if (!isManager) {
          const auth = await requireAccountOwner(req, String(campaign.business_username || ""));
          if (!auth.ok) return auth.response;
          viewer = "brand";
        }
        await db.sql`
          UPDATE campaign_listups
          SET brand_favorite = ${body.favorite !== false}, updated_at = NOW()
          WHERE id = ${id}
        `;
        return Response.json({ success: true, listup: await reload(viewer) });
      }

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

      // --- 담당자 진행하기 -------------------------------------------------
      // 브랜드가 고른 후보를 담당자가 바로 협업으로 넘긴다.
      //
      // 원래 흐름은 제안 발송 → 인플루언서 수락이다. 그런데 실제 운영에서는 담당자가
      // 이미 전화나 DM으로 합의를 끝내고 오는 경우가 대부분이고, 그때 인플루언서에게
      // "앱에 들어가서 수락을 눌러 달라"고 다시 부탁해야 협업이 시작됐다. 그 한 단계가
      // 브랜드·인플루언서 양쪽 진행사항을 며칠씩 비워 놓는다. 그래서 담당자가 직접
      // 진행을 시작할 수 있게 두되, 브랜드가 고르지 않은 후보는 막는다 — 선택은
      // 여전히 브랜드의 몫이다.
      if (action === "start_collab") {
        if (!isManager) return managerRequired();
        if (listup.outreach_status === "accepted") {
          // 두 번 눌렀을 때. 이미 만들어진 협업을 그대로 알려준다.
          return Response.json({
            success: true,
            alreadyAccepted: true,
            collabId: listup.collab_id || "",
            listup: await reload("manager"),
          });
        }
        if (listup.brand_decision !== "pick") {
          return Response.json(
            { error: "브랜드가 선택한 후보만 진행할 수 있습니다." },
            { status: 409 },
          );
        }

        // 제안을 아직 보내지 않았다면 캠페인 조건을 기본값으로 쓴다. 담당자가 적어 둔
        // 지급 단가·일정이 있으면 그쪽이 이긴다.
        const base = offerFromCampaign(campaign);
        const saved = normalizeOffer(listup.offer);
        const effective = normalizeOffer({
          ...base,
          ...Object.fromEntries(
            Object.entries(saved).filter(([, value]) => value !== "" && value !== 0),
          ),
        });

        const result = await acceptListup({
          db,
          listup: { ...listup, offer: effective },
          campaign,
          actorRole: "manager",
          actorUsername: managerUsername,
        });

        await db.sql`
          UPDATE campaign_listups
          SET offer = ${JSON.stringify(effective)},
              outreach_status = 'accepted',
              offer_sent_at = COALESCE(offer_sent_at, NOW()),
              offer_sent_by = CASE WHEN offer_sent_by = '' OR offer_sent_by IS NULL
                                   THEN ${managerUsername} ELSE offer_sent_by END,
              responded_at = NOW(),
              response_note = ${String(body.note || "담당자 진행 처리")},
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
          listup: await reload("manager"),
        });
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
