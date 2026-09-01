import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";
import { isManagerListupMode, normalizeRewardMode } from "./_shared/reward-mode.mts";
import { shapeListup } from "./_shared/campaign-listup.mts";

/**
 * 담당자가 보는 브랜드 캠페인 목록.
 *
 * 운영 콘솔의 캠페인 API(api-admin-campaigns)와 나눠 둔 이유는 권한이다. 저쪽은
 * Netlify Identity 관리자 토큰을 요구하고 승인·반려까지 다룬다. 담당자는 관리자가
 * 아니고, 승인은 담당자의 일이 아니다. 담당자에게 필요한 것은 승인이 끝난 캠페인과
 * "지금 이 캠페인이 어디서 막혀 있는지"뿐이다.
 *
 * 그래서 캠페인마다 진행 숫자를 함께 센다. 명단에 몇 명 올렸는지, 브랜드가 몇 명
 * 골랐는지, 제안이 몇 건 나갔는지, 협업이 몇 건 굴러가는지. 이 숫자가 없으면 담당자는
 * 캠페인을 하나씩 열어 봐야 다음에 할 일을 알 수 있다.
 *
 * PATCH 는 담당자가 자기를 캠페인에 배정하거나(claim) 명단 공개 · 확정 기한을
 * 정하는 데 쓴다.
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const shape = (row: any) => ({
  id: row.id,
  title: row.title,
  brandName: row.brand_name || "",
  businessUsername: norm(row.business_username),
  type: row.type || "",
  category: row.category || "",
  description: row.description || "",
  productName: row.product_name || "",
  thumbnailUrl: row.thumbnail_url || "",
  rewardAmount: row.reward_amount || "",
  rewardType: row.reward_type || "",
  secondUseFee: Number(row.second_use_fee || 0),
  uploadChannel: row.upload_channel || "",
  contentFormat: row.content_format || "",
  uploadFrom: row.upload_from || "",
  uploadTo: row.upload_to || "",
  startDate: row.start_date || "",
  endDate: row.end_date || "",
  status: row.status || "",
  managerUsername: norm(row.manager_username),
  // 진행 방식과, 여기에 담당자 리스트업이 붙는지. 제품 협찬형은 지원자만 받으므로
  // 담당자 화면이 이 값으로 명단 관련 자리를 감춘다.
  rewardMode: normalizeRewardMode(row.reward_mode),
  managerListup: isManagerListupMode(row.reward_mode),
  approvedAt: row.admin_approved_at || null,
  createdAt: row.created_at,
  listupConfirmDue: row.listup_confirm_due || null,
  listupPublishedAt: row.listup_published_at || null,
  counts: {
    listed: Number(row.listed_count || 0),
    picked: Number(row.picked_count || 0),
    sent: Number(row.sent_count || 0),
    accepted: Number(row.accepted_count || 0),
    applications: Number(row.application_count || 0),
    collabs: Number(row.collab_count || 0),
    review: Number(row.review_count || 0),
  },
});

/**
 * 브랜드가 고른 후보를 캠페인 경계 없이 한 줄로 편다.
 *
 * 브랜드의 선택은 캠페인 안쪽 명단에만 남는다. 그래서 담당자는 캠페인을 하나씩 열어
 * 봐야 "브랜드가 골랐는데 아직 아무것도 안 한 사람"을 찾을 수 있었다. 선택은 답을
 * 기다리는 요청이므로, 담당자 대시보드 첫 화면에 그대로 올라와야 한다.
 *
 * 이미 협업이 시작된(accepted) 후보는 뺀다 — 그쪽은 할 일이 아니라 기록이다.
 */
const loadBrandPicks = async (db: any, me: string, mineOnly: boolean) =>
  ((await db.sql`
    SELECT l.*, c.title AS campaign_title, c.brand_name, c.business_username,
           c.manager_username, c.type AS campaign_type, c.reward_mode,
           c.content_format, c.listup_confirm_due
    FROM campaign_listups l
    JOIN campaigns c ON c.id = l.campaign_id
    WHERE l.brand_decision = 'pick'
      AND l.outreach_status <> 'accepted'
      AND c.status = 'active'
      AND c.admin_approved_at IS NOT NULL
      AND (${mineOnly} = false OR LOWER(COALESCE(c.manager_username, '')) = ${me})
    ORDER BY l.brand_decided_at DESC NULLS LAST, l.created_at DESC
    LIMIT 200
  `) as any[]).map((row) => {
    const listup = shapeListup(row, "manager") as any;
    return {
      ...listup,
      campaignTitle: row.campaign_title || "",
      brandName: row.brand_name || "",
      businessUsername: norm(row.business_username),
      campaignType: row.campaign_type || "",
      // 캠페인 형식(숏폼 · 피드). 후보 카드가 이 캠페인에 해당하는 등록 단가를
      // 앞세워 보여 주는 데 쓴다 — 형식이 없으면 두 단가가 나란히 보인다.
      contentFormat: row.content_format || "",
      managerUsername: norm(row.manager_username),
      // 내가 맡지 않은 캠페인의 선택도 보여 준다. 담당자가 비어 있는 캠페인을
      // 브랜드가 먼저 고르는 일이 흔한데, 그 요청이 아무 화면에도 안 뜨면
      // 캠페인을 맡는 사람이 나올 때까지 그대로 묻힌다.
      mine: norm(row.manager_username) === me,
      unassigned: !norm(row.manager_username),
    };
  });

const loadCampaigns = async (db: any, me: string, mineOnly: boolean) =>
  ((await db.sql`
    SELECT c.*,
      (SELECT COUNT(*)::int FROM campaign_listups l WHERE l.campaign_id = c.id) AS listed_count,
      (SELECT COUNT(*)::int FROM campaign_listups l WHERE l.campaign_id = c.id AND l.brand_decision = 'pick') AS picked_count,
      (SELECT COUNT(*)::int FROM campaign_listups l WHERE l.campaign_id = c.id AND l.outreach_status = 'sent') AS sent_count,
      (SELECT COUNT(*)::int FROM campaign_listups l WHERE l.campaign_id = c.id AND l.outreach_status = 'accepted') AS accepted_count,
      (SELECT COUNT(*)::int FROM campaign_applications a WHERE a.campaign_id = c.id AND COALESCE(a.source, 'apply') = 'apply') AS application_count,
      (SELECT COUNT(*)::int FROM campaign_collabs cc WHERE cc.campaign_id = c.id AND cc.status = 'in_progress') AS collab_count,
      -- 지금 담당자가 봐야 할 제출물이 있는 협업 수. 캠페인이 많아지면 "협업 3건"
      -- 이라는 숫자만으로는 그 중 무엇이 나를 기다리는지 알 수 없어서, 담당자는
      -- 캠페인을 하나씩 열어 보고 있었다.
      (SELECT COUNT(DISTINCT cc.id)::int
         FROM campaign_collabs cc
         JOIN collab_stages s ON s.collab_id = cc.id
        WHERE cc.campaign_id = c.id AND cc.status = 'in_progress' AND s.status = 'submitted') AS review_count
    FROM campaigns c
    WHERE c.status = 'active'
      AND c.admin_approved_at IS NOT NULL
      AND (${mineOnly} = false OR LOWER(COALESCE(c.manager_username, '')) = ${me})
    ORDER BY
      CASE WHEN COALESCE(c.manager_username, '') = '' THEN 0 ELSE 1 END,
      COALESCE(c.admin_approved_at, c.created_at) DESC
    LIMIT 200
  `) as any[]).map(shape);

export default async (req: Request) => {
  const manager = await requireManager(req);
  if (!manager.ok) return manager.response;

  const db = getDatabase();
  const url = new URL(req.url);
  const me = manager.managerUsername;

  try {
    if (req.method === "GET") {
      const mineOnly = url.searchParams.get("mine") === "1";
      const [campaigns, brandPicks] = await Promise.all([
        loadCampaigns(db, me, mineOnly),
        loadBrandPicks(db, me, mineOnly),
      ]);
      return Response.json({
        campaigns,
        brandPicks,
        managerUsername: me,
      });
    }

    if (req.method === "PATCH") {
      const body = (await req.json()) as any;
      const campaignId = String(body.campaignId || body.id || "");
      const action = String(body.action || "");
      if (!campaignId || !action) {
        return Response.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
      }

      if (action === "claim") {
        // 이미 다른 담당자가 맡고 있으면 빼앗지 않는다. 배정을 옮기는 것은
        // 운영자의 일이고, 담당자끼리 서로 가져가면 누가 답할 차례인지 흐려진다.
        const rows = (await db.sql`
          UPDATE campaigns
          SET manager_username = ${me}, manager_assigned_at = NOW(), updated_at = NOW()
          WHERE id = ${campaignId}
            AND (COALESCE(manager_username, '') = '' OR LOWER(manager_username) = ${me})
          RETURNING id
        `) as any[];
        if (!rows.length) {
          return Response.json(
            { error: "이미 다른 담당자가 맡고 있는 캠페인입니다." },
            { status: 409 },
          );
        }
      } else if (action === "release") {
        await db.sql`
          UPDATE campaigns
          SET manager_username = '', manager_assigned_at = NULL, updated_at = NOW()
          WHERE id = ${campaignId} AND LOWER(COALESCE(manager_username, '')) = ${me}
        `;
      } else if (action === "publish_listup") {
        // 확정 기한은 담당자가 정한다. 비워 보내면 기한 없이 공개된다.
        //
        // 이 값이 명단을 가리지는 않는다. 브랜드는 명단에 사람이 올라오는 즉시
        // 본다 — 공개 여부로 가리면 컬럼이 없던 시절에 만들어진 캠페인의 명단이
        // 한꺼번에 사라진다. 여기서 정하는 것은 브랜드 화면의 남은 시간 표시뿐이다.
        const due = body.confirmDue ? new Date(body.confirmDue) : null;
        const dueIso = due && !Number.isNaN(due.getTime()) ? due.toISOString() : null;
        await db.sql`
          UPDATE campaigns
          SET listup_published_at = NOW(), listup_confirm_due = ${dueIso}, updated_at = NOW()
          WHERE id = ${campaignId}
        `;
      } else if (action === "clear_due") {
        // 기한만 없앤다. 공개 시점은 남긴다 — 언제 명단을 넘겼는지는 기록이다.
        await db.sql`
          UPDATE campaigns
          SET listup_confirm_due = NULL, updated_at = NOW()
          WHERE id = ${campaignId}
        `;
      } else {
        return Response.json({ error: "알 수 없는 동작입니다." }, { status: 400 });
      }

      return Response.json({
        success: true,
        campaigns: await loadCampaigns(db, me, url.searchParams.get("mine") === "1"),
        brandPicks: await loadBrandPicks(db, me, url.searchParams.get("mine") === "1"),
      });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "캠페인을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/manager-campaigns",
};
