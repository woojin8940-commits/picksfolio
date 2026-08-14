import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireManager } from "./_shared/manager-auth.mts";
import { addSettlementForProposal, upsertCollabScheduleRecord } from "./_shared/collab-records.mts";
import { todayInSeoul } from "./_shared/campaign-recruit.mts";
import {
  canTransitionStage,
  daysUntil,
  ensureSupportThread,
  logCollabEvent,
  netAfterWithholding,
  newId,
  norm,
  progressOf,
  reassignSupportThreads,
  roleInCollab,
  roleMayTransition,
  settlementDateFrom,
  supportThreadId,
  templateByKey,
  type CollabRole,
} from "./_shared/collab-workflow.mts";

/**
 * 캠페인 협업 워크플로 API — 역할별 조회와 상태 변경.
 *
 *   GET   /api/collab-workflow?role=influencer|brand|manager[&username=]  목록
 *   GET   /api/collab-workflow/:collabId                                  상세
 *   PATCH /api/collab-workflow/:collabId                                  { action, ... }
 *
 * 세 역할이 같은 협업을 보지만 보이는 것과 할 수 있는 것이 다르다.
 *
 *   * 인플루언서 : 내 단계와 마감일, 전달된 피드백, 산출물 제출
 *   * 브랜드     : 진행 현황(읽기)과 의견 등록. 단계를 움직이거나 승인하지 않는다.
 *   * 담당자     : 전부. 승인·수정요청·일정변경·업로드확인·취소는 담당자만 한다.
 *
 * 브랜드에게서 승인 권한을 뺀 이유는 권한을 아끼려는 게 아니다. 승인이 곧 정산
 * 예약과 마감 정지로 이어지는데, 브랜드가 답을 미루면 인플루언서는 이미 일을 끝낸
 * 상태로 무기한 대기하게 된다. 그 압박을 사람(담당자)이 받아야 시스템이 멈추지 않는다.
 */

type CallerContext = {
  username: string;
  isManager: boolean;
  managerUsername: string;
};

async function resolveCaller(req: Request): Promise<CallerContext | { error: Response }> {
  const manager = await requireManager(req);
  if (manager.ok) {
    return { username: manager.managerUsername, isManager: true, managerUsername: manager.managerUsername };
  }
  const user = await requireSignedInUser(req);
  if (!user.ok) return { error: user.response };
  return { username: user.username, isManager: false, managerUsername: "" };
}

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

/**
 * 협업 한 건 + 그 캠페인의 가이드라인.
 *
 * 캠페인을 함께 읽는 이유는 둘이다. 첫째, 가이드라인 파일은 캠페인 단위로 올린다
 * (인플루언서마다 다르지 않다). 둘째, 협업 행의 business_username 이 비었거나
 * `biz/` 표기 차이로 어긋난 예전 건이 있어서, 접근 권한을 판정할 때 캠페인 소유자를
 * 함께 봐야 브랜드가 자기 협업에서 튕기지 않는다.
 */
async function loadCollab(db: any, collabId: string) {
  const rows = await db.sql`
    SELECT cc.*,
           c.business_username AS campaign_owner_username,
           c.guideline_note    AS campaign_guideline_note,
           c.guideline_url     AS campaign_guideline_url,
           c.guideline_files   AS campaign_guideline_files
    FROM campaign_collabs cc
    LEFT JOIN campaigns c ON c.id = cc.campaign_id
    WHERE cc.id = ${collabId}
  `;
  return (rows as any[])?.[0] || null;
}

/** 가이드라인 파일 목록은 JSONB 로 저장되지만 예전 행은 문자열이거나 비어 있다. */
function guidelineFiles(raw: unknown): any[] {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((f) => f && typeof f === "object" && String((f as any).url || ""))
    .map((f: any) => ({
      url: String(f.url || ""),
      name: String(f.name || "가이드라인"),
      mimeType: String(f.mimeType || ""),
      uploadedAt: String(f.uploadedAt || ""),
      uploadedBy: String(f.uploadedBy || ""),
    }));
}

async function loadStages(db: any, collabId: string) {
  return (await db.sql`
    SELECT * FROM collab_stages WHERE collab_id = ${collabId} ORDER BY seq ASC
  `) as any[];
}

/** 다음 단계를 열어 준다. 마지막 단계였다면 협업 자체를 완료로 넘긴다. */
async function openNextStage(db: any, collabId: string, currentSeq: number) {
  const next = (await db.sql`
    SELECT * FROM collab_stages
    WHERE collab_id = ${collabId} AND seq > ${currentSeq} AND status = 'pending'
    ORDER BY seq ASC LIMIT 1
  `) as any[];
  const stage = next?.[0];
  if (!stage) {
    await db.sql`
      UPDATE campaign_collabs
      SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), current_stage_key = '', updated_at = NOW()
      WHERE id = ${collabId}
    `;
    return null;
  }
  await db.sql`
    UPDATE collab_stages
    SET status = 'active', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
    WHERE id = ${stage.id}
  `;
  await db.sql`
    UPDATE campaign_collabs SET current_stage_key = ${stage.stage_key}, updated_at = NOW() WHERE id = ${collabId}
  `;
  return stage;
}

/**
 * 역할에 맞게 협업 한 건을 조립한다. 브랜드에게만 감춰야 하는 것은 없지만,
 * 인플루언서에게는 담당자가 아직 다듬지 않은 브랜드 원문(visible_to_influencer=false)을
 * 보여주지 않는다. 그 원문이 그대로 전달되면 담당자가 중간에 있는 의미가 없다.
 */
function shapeFeedbacks(rows: any[], role: CollabRole) {
  return rows
    .filter((f) => (role === "influencer" ? f.visible_to_influencer : true))
    .map((f) => ({
      id: f.id,
      deliverableId: f.deliverable_id,
      stageKey: f.stage_key,
      anchor: f.anchor,
      body: f.body,
      authorType: role === "influencer" && f.author_type === "brand" ? "manager" : f.author_type,
      authorUsername: role === "influencer" ? "" : f.author_username,
      visibleToInfluencer: f.visible_to_influencer,
      status: f.status,
      resolutionNote: f.resolution_note,
      resolvedAt: f.resolved_at,
      createdAt: f.created_at,
    }));
}

export default async (req: Request, context: Context) => {
  const db = getDatabase();
  const collabId = context.params?.collabId || "";
  const url = new URL(req.url);

  const caller = await resolveCaller(req);
  if ("error" in caller) return caller.error;

  // ------------------------------------------------------------------ 목록
  if (req.method === "GET" && !collabId) {
    const role = (url.searchParams.get("role") || "").toLowerCase();
    const requested = norm(url.searchParams.get("username"));

    try {
      let rows: any[] = [];
      if (role === "manager") {
        if (!caller.isManager) return jsonError("담당자만 조회할 수 있습니다.", 403);
        const mine = url.searchParams.get("mine") === "1";
        rows = mine
          ? ((await db.sql`
              SELECT * FROM campaign_collabs
              WHERE manager_username = ${caller.managerUsername}
              ORDER BY updated_at DESC NULLS LAST, created_at DESC
            `) as any[])
          : ((await db.sql`
              SELECT * FROM campaign_collabs
              ORDER BY updated_at DESC NULLS LAST, created_at DESC
            `) as any[]);
      } else if (role === "brand") {
        const target = caller.isManager && requested ? requested : caller.username;
        if (!caller.isManager && requested && requested !== caller.username) {
          return jsonError("다른 계정의 협업은 조회할 수 없습니다.", 403);
        }
        // 이름을 정규화해서 맞춘다. 비즈니스 계정은 자리에 따라 `biz/acme` 로도
        // `acme` 로도 저장돼 있고 대소문자도 섞여 있다. 예전처럼 문자열을 그대로
        // 비교하면 담당자가 진행을 시작한 협업이 브랜드 화면에서 통째로 사라진다
        // (행은 있는데 이름 표기가 달라 안 잡힌다).
        //
        // 캠페인 소유자로도 한 번 더 찾는다. 협업 행의 business_username 이 비어
        // 있거나 다른 표기로 들어간 건이 있어도, 그 캠페인을 등록한 브랜드라면
        // 자기 진행사항에서 봐야 한다.
        rows = (await db.sql`
          SELECT cc.* FROM campaign_collabs cc
          LEFT JOIN campaigns c ON c.id = cc.campaign_id
          WHERE LOWER(REPLACE(COALESCE(cc.business_username, ''), 'biz/', '')) = ${target}
             OR LOWER(REPLACE(COALESCE(c.business_username, ''), 'biz/', '')) = ${target}
          ORDER BY cc.created_at DESC
        `) as any[];
      } else {
        const target = caller.isManager && requested ? requested : caller.username;
        if (!caller.isManager && requested && requested !== caller.username) {
          return jsonError("다른 계정의 협업은 조회할 수 없습니다.", 403);
        }
        rows = (await db.sql`
          SELECT * FROM campaign_collabs WHERE creator_username = ${target}
          ORDER BY created_at DESC
        `) as any[];
      }

      if (rows.length === 0) return Response.json({ collabs: [] });

      const ids = rows.map((r) => r.id);
      const stages = (await db.sql`
        SELECT collab_id, stage_key, title, status, due_date, owner_role, seq
        FROM collab_stages WHERE collab_id = ANY(${ids}) ORDER BY seq ASC
      `) as any[];
      const openFeedback = (await db.sql`
        SELECT collab_id, COUNT(*)::int AS open_count
        FROM collab_feedbacks
        WHERE collab_id = ANY(${ids}) AND status = 'open'
        GROUP BY collab_id
      `) as any[];
      const openMap = new Map(openFeedback.map((r) => [r.collab_id, r.open_count]));

      const today = todayInSeoul();
      const collabs = rows.map((row) => {
        const own = stages.filter((s) => s.collab_id === row.id);
        const current = own.find((s) => s.stage_key === row.current_stage_key) || own.find((s) => s.status !== "done");
        return {
          id: row.id,
          campaignId: row.campaign_id,
          campaignTitle: row.campaign_title,
          companyName: row.company_name,
          businessUsername: row.business_username,
          creatorUsername: row.creator_username,
          managerUsername: row.manager_username,
          status: row.status,
          currentStageKey: row.current_stage_key,
          currentStageTitle: current?.title || "",
          currentStageOwner: current?.owner_role || "",
          currentStageStatus: current?.status || "",
          dueDate: current?.due_date || "",
          daysLeft: daysUntil(current?.due_date, today),
          progress: progressOf(own),
          stageCount: own.length,
          openFeedbackCount: openMap.get(row.id) || 0,
          uploadUrl: row.upload_url || "",
          confirmedAt: row.confirmed_at,
          scheduleStart: row.schedule_start || "",
          scheduleEnd: row.schedule_end || "",
          scheduleConfirmedAt: row.schedule_confirmed_at,
          scheduleConfirmedBy: row.schedule_confirmed_by || "",
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      return Response.json({ collabs });
    } catch (err: any) {
      return jsonError(err?.message || "협업 목록을 불러오지 못했습니다.", 500);
    }
  }

  if (!collabId) return jsonError("협업 ID가 필요합니다.");

  const collab = await loadCollab(db, collabId);
  if (!collab) return jsonError("협업을 찾을 수 없습니다.", 404);

  // 브랜드 판정에는 캠페인 소유자도 넣는다. 협업 행의 business_username 이 비어
  // 있거나 `biz/` 표기가 섞인 예전 건에서, 캠페인을 등록한 당사자가 자기 협업을
  // 열지 못하고 403 을 받는 일이 있었다.
  const role = roleInCollab(
    { ...collab, business_username: collab.business_username || collab.campaign_owner_username },
    caller.username,
    caller.isManager,
  ) || roleInCollab(
    { ...collab, business_username: collab.campaign_owner_username },
    caller.username,
    caller.isManager,
  );
  if (!role) return jsonError("이 협업에 접근할 수 없습니다.", 403);

  // ------------------------------------------------------------------ 상세
  if (req.method === "GET") {
    try {
      const [stages, deliverables, feedbacks, events, termsRows, scheduleChanges, assets] = await Promise.all([
        loadStages(db, collabId),
        db.sql`SELECT * FROM collab_deliverables WHERE collab_id = ${collabId} ORDER BY created_at ASC` as Promise<any[]>,
        db.sql`SELECT * FROM collab_feedbacks WHERE collab_id = ${collabId} ORDER BY created_at ASC` as Promise<any[]>,
        db.sql`SELECT * FROM collab_events WHERE collab_id = ${collabId} ORDER BY created_at DESC LIMIT 50` as Promise<any[]>,
        db.sql`SELECT * FROM collab_terms WHERE collab_id = ${collabId}` as Promise<any[]>,
        db.sql`SELECT * FROM collab_schedule_changes WHERE collab_id = ${collabId} ORDER BY created_at DESC` as Promise<any[]>,
        db.sql`SELECT * FROM collab_assets WHERE collab_id = ${collabId} ORDER BY created_at DESC` as Promise<any[]>,
      ]);

      const template = templateByKey(collab.template_key);
      const today = todayInSeoul();
      const terms = (termsRows as any[])?.[0] || null;

      // 가이드라인 한 덩어리.
      //
      // 지금까지는 collab_terms 의 guide_note/guide_url 만 봤다. 그 두 칸은 담당자가
      // 조건을 확정할 때 채우는 것이라, 브랜드가 캠페인 화면에서 올려 둔 가이드라인은
      // 인플루언서 진행 화면까지 도달하지 못했다. 여기서 세 곳(캠페인 · 협업 조건 ·
      // 협업 자료함의 guide 파일)을 합쳐 한 번에 내려보낸다 — 화면이 어디를 봐야
      // 할지 고르게 두면 결국 어느 한 곳은 빠뜨린다.
      const guideFiles = [
        ...guidelineFiles(collab.campaign_guideline_files),
        ...(assets as any[])
          .filter((a) => a.kind === "guide" && a.file_url)
          .map((a) => ({
            url: String(a.file_url),
            name: String(a.title || a.file_name || "가이드 파일"),
            mimeType: String(a.mime_type || ""),
            uploadedAt: a.created_at ? String(a.created_at) : "",
            uploadedBy: String(a.uploaded_by || ""),
          })),
      ];
      const seenGuideUrls = new Set<string>();
      const guideline = {
        note: String(terms?.guide_note || collab.campaign_guideline_note || ""),
        url: String(terms?.guide_url || collab.campaign_guideline_url || ""),
        files: guideFiles.filter((f) => {
          if (seenGuideUrls.has(f.url)) return false;
          seenGuideUrls.add(f.url);
          return true;
        }),
      };

      return Response.json({
        role,
        collab: {
          id: collab.id,
          campaignId: collab.campaign_id,
          applicationId: collab.application_id,
          campaignTitle: collab.campaign_title,
          companyName: collab.company_name,
          campaignType: collab.campaign_type,
          businessUsername: collab.business_username,
          creatorUsername: collab.creator_username,
          managerUsername: collab.manager_username,
          status: collab.status,
          currentStageKey: collab.current_stage_key,
          templateKey: collab.template_key || template.key,
          templateLabel: template.label,
          proposalId: collab.proposal_id,
          uploadUrl: collab.upload_url || "",
          adCode: collab.ad_code || "",
          confirmedAt: collab.confirmed_at,
          scheduleStart: collab.schedule_start || "",
          scheduleEnd: collab.schedule_end || "",
          scheduleConfirmedAt: collab.schedule_confirmed_at,
          scheduleConfirmedBy: collab.schedule_confirmed_by || "",
          cancelledAt: collab.cancelled_at,
          cancelReason: collab.cancel_reason || "",
          progress: progressOf(stages),
          createdAt: collab.created_at,
        },
        guideline,
        threads: {
          influencerSupport: role === "brand" ? null : supportThreadId("influencer_support", collabId),
          // 브랜드↔담당자 방은 만들지 않는다. 브랜드의 의견은 단계별 피드백으로
          // 받고 담당자가 정리해 인플루언서에게 옮긴다. 예전에 만들어진 방은
          // 담당자 대화 목록에 그대로 남아 있다.
          brandSupport: null,
          legacy: collab.proposal_id || "",
        },
        stages: stages.map((s) => ({
          id: s.id,
          stageKey: s.stage_key,
          seq: s.seq,
          title: s.title,
          ownerRole: s.owner_role,
          status: s.status,
          dueDate: s.due_date || "",
          daysLeft: daysUntil(s.due_date, today),
          startedAt: s.started_at,
          submittedAt: s.submitted_at,
          completedAt: s.completed_at,
          hint: s.note || "",
          isMine: s.owner_role === role,
          // 제출물 종류는 템플릿에만 있다. 화면이 stage_key 로 추측하지 않도록 함께 보낸다.
          deliverableKind: template.stages.find((t) => t.key === s.stage_key)?.deliverable || "",
        })),
        deliverables: (deliverables as any[]).map((d) => ({
          id: d.id,
          stageKey: d.stage_key,
          kind: d.kind,
          version: d.version,
          status: d.status,
          payload: d.payload || {},
          submittedBy: d.submitted_by,
          reviewedBy: role === "influencer" ? "" : d.reviewed_by,
          reviewNote: d.review_note || "",
          createdAt: d.created_at,
        })),
        assets: (assets as any[]).map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          title: asset.title || "",
          fileUrl: asset.file_url,
          fileName: asset.file_name || "",
          mimeType: asset.mime_type || "",
          uploadedByRole: asset.uploaded_by_role,
          uploadedBy: asset.uploaded_by,
          status: asset.status,
          reviewedBy: asset.reviewed_by || "",
          reviewNote: asset.review_note || "",
          reviewedAt: asset.reviewed_at,
          createdAt: asset.created_at,
        })),
        feedbacks: shapeFeedbacks(feedbacks as any[], role),
        terms: terms
          ? {
              fee: Number(terms.fee || 0),
              netFee: netAfterWithholding(Number(terms.fee || 0)),
              rewardType: terms.reward_type || "",
              rewardNote: terms.reward_note || "",
              scriptDue: terms.script_due || "",
              contentDue: terms.content_due || "",
              uploadDue: terms.upload_due || "",
              deliverableSpec: terms.deliverable_spec || {},
              guideUrl: terms.guide_url || "",
              guideNote: terms.guide_note || "",
              lockedAt: terms.locked_at,
            }
          : null,
        scheduleChanges: (scheduleChanges as any[]).map((c) => ({
          id: c.id,
          stageKey: c.stage_key,
          previousDue: c.previous_due,
          nextDue: c.next_due,
          reason: c.reason,
          requestedByRole: c.requested_by_role,
          createdAt: c.created_at,
        })),
        // 일정 변경은 협업당 1회까지. 무제한이면 마감일이 사실상 없는 것과 같다.
        scheduleChangeRemaining: Math.max(0, 1 - (scheduleChanges as any[]).length),
        events: (events as any[]).map((e) => ({
          id: e.id,
          type: e.type,
          actorRole: e.actor_role,
          stageKey: e.stage_key,
          summary: e.summary,
          createdAt: e.created_at,
        })),
      });
    } catch (err: any) {
      return jsonError(err?.message || "협업을 불러오지 못했습니다.", 500);
    }
  }

  // ------------------------------------------------------------------ 동작
  if (req.method !== "PATCH") {
    return jsonError("Method not allowed", 405);
  }

  if (collab.status === "cancelled" ) {
    return jsonError("취소된 협업입니다.", 409);
  }

  const body = await req.json().catch(() => ({}));
  const action = String((body as any)?.action || "");
  const actor = { actorRole: role, actorUsername: caller.username };

  const stageByKey = async (key: string) => {
    const rows = await db.sql`
      SELECT * FROM collab_stages WHERE collab_id = ${collabId} AND stage_key = ${key}
    `;
    return (rows as any[])?.[0] || null;
  };

  try {
    switch (action) {
      case "add_asset": {
        const kind = String((body as any).kind || "other");
        const allowed = role === "brand" ? ["guide", "other"] : role === "influencer" ? ["plan", "video", "other"] : ["guide", "plan", "video", "other"];
        if (!allowed.includes(kind)) return jsonError("이 역할로 올릴 수 없는 자료입니다.", 403);
        const fileUrl = String((body as any).fileUrl || "").trim();
        if (!fileUrl.startsWith("/api/images/")) return jsonError("업로드한 파일을 선택해 주세요.");
        const assetId = newId("asset");
        const title = String((body as any).title || "").trim().slice(0, 120);
        const fileName = String((body as any).fileName || "").trim().slice(0, 240);
        const mimeType = String((body as any).mimeType || "").trim().slice(0, 120);
        await db.sql`
          INSERT INTO collab_assets (
            id, collab_id, kind, title, file_url, file_name, mime_type,
            uploaded_by_role, uploaded_by
          ) VALUES (
            ${assetId}, ${collabId}, ${kind}, ${title}, ${fileUrl}, ${fileName}, ${mimeType},
            ${role}, ${caller.username}
          )
        `;
        await logCollabEvent(db, {
          collabId,
          type: "asset_shared",
          ...actor,
          summary: `${kind === "guide" ? "가이드" : kind === "plan" ? "기획안" : kind === "video" ? "영상 초안" : "자료"} 공유`,
          payload: { assetId, kind },
        });
        return Response.json({ success: true, assetId });
      }

      case "review_asset": {
        if (role !== "brand" && role !== "manager") return jsonError("브랜드 또는 담당자만 확인할 수 있습니다.", 403);
        const assetId = String((body as any).assetId || "");
        const status = String((body as any).status || "confirmed");
        if (!["confirmed", "revision"].includes(status)) return jsonError("잘못된 확인 상태입니다.");
        const note = String((body as any).note || "").trim().slice(0, 2000);
        if (status === "revision" && !note) return jsonError("수정 요청 내용을 입력해 주세요.");
        const updated = await db.sql`
          UPDATE collab_assets
          SET status = ${status}, reviewed_by = ${caller.username}, review_note = ${note}, reviewed_at = NOW()
          WHERE id = ${assetId} AND collab_id = ${collabId}
          RETURNING id, kind
        `;
        if (!(updated as any[])?.[0]) return jsonError("자료를 찾을 수 없습니다.", 404);
        await logCollabEvent(db, {
          collabId,
          type: "asset_reviewed",
          ...actor,
          summary: status === "confirmed" ? "공유 자료 확인 완료" : "공유 자료 수정 요청",
          payload: { assetId, status },
        });
        return Response.json({ success: true });
      }

      case "update_ad_code": {
        if (role !== "influencer" && role !== "manager") return jsonError("광고코드는 인플루언서가 공유합니다.", 403);
        const adCode = String((body as any).adCode || "").trim().slice(0, 500);
        await db.sql`UPDATE campaign_collabs SET ad_code = ${adCode}, updated_at = NOW() WHERE id = ${collabId}`;
        await logCollabEvent(db, {
          collabId,
          type: "ad_code_shared",
          ...actor,
          summary: adCode ? "광고코드 공유" : "광고코드 삭제",
        });
        return Response.json({ success: true });
      }

      // 인플루언서: 산출물 제출 -------------------------------------------
      case "submit_deliverable": {
        const stageKey = String((body as any).stageKey || "");
        const stage = await stageByKey(stageKey);
        if (!stage) return jsonError("단계를 찾을 수 없습니다.", 404);
        if (role !== "influencer" && role !== "manager") {
          return jsonError("제출은 인플루언서가 합니다.", 403);
        }
        if (stage.owner_role !== "influencer") {
          return jsonError("이 단계는 제출 단계가 아닙니다.");
        }
        if (!["active", "revision"].includes(stage.status)) {
          return jsonError("지금 제출할 수 있는 단계가 아닙니다.", 409);
        }

        const kind = String((body as any).kind || "content");
        const payload = (body as any).payload || {};

        // 업로드 단계는 링크가 반드시 있어야 한다 — 정산의 근거이기 때문이다.
        if (kind === "upload" && !String(payload.uploadUrl || "").trim()) {
          return jsonError("게시물 링크를 입력해 주세요.");
        }
        if (kind === "script" && !Array.isArray(payload.scenes)) {
          return jsonError("장면 구성을 하나 이상 작성해 주세요.");
        }
        // 장면은 {visual, subtitle, narration} 형태로 온다(예전 제출물은 문자열).
        // 배열이기만 하면 통과시키면 빈 장면 5개가 제출물로 남고, 검수 화면은
        // 붙일 곳 없는 피드백만 받게 된다.
        if (kind === "script") {
          const filled = (payload.scenes as any[]).filter((s) =>
            typeof s === "string"
              ? s.trim()
              : String(s?.visual || s?.text || s?.subtitle || s?.narration || "").trim(),
          );
          if (filled.length === 0) {
            return jsonError("장면 내용을 입력해 주세요.");
          }
        }

        const versionRows = await db.sql`
          SELECT COALESCE(MAX(version), 0)::int AS v FROM collab_deliverables
          WHERE collab_id = ${collabId} AND stage_key = ${stageKey}
        `;
        const version = Number((versionRows as any[])?.[0]?.v || 0) + 1;
        const deliverableId = newId("cd");

        await db.sql`
          INSERT INTO collab_deliverables (id, collab_id, stage_key, kind, version, status, payload, submitted_by)
          VALUES (${deliverableId}, ${collabId}, ${stageKey}, ${kind}, ${version}, 'submitted', ${JSON.stringify(payload)}, ${caller.username})
        `;
        await db.sql`
          UPDATE collab_stages
          SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
          WHERE id = ${stage.id}
        `;

        if (kind === "upload") {
          await db.sql`
            UPDATE campaign_collabs
            SET upload_url = ${String(payload.uploadUrl || "")},
                ad_code = ${String(payload.adCode || "")},
                deliverable_url = ${String(payload.uploadUrl || "")},
                updated_at = NOW()
            WHERE id = ${collabId}
          `;
        }

        await logCollabEvent(db, {
          collabId,
          type: "deliverable_submitted",
          ...actor,
          stageKey,
          summary: `${stage.title} 제출 (v${version})`,
          payload: { deliverableId, kind, version },
        });

        return Response.json({ success: true, deliverableId, version });
      }

      // 담당자: 수정 요청 -------------------------------------------------
      case "request_revision": {
        if (role !== "manager") return jsonError("수정 요청은 담당자가 보냅니다.", 403);
        const stageKey = String((body as any).stageKey || "");
        const stage = await stageByKey(stageKey);
        if (!stage) return jsonError("단계를 찾을 수 없습니다.", 404);
        if (!canTransitionStage(stage.status, "revision")) {
          return jsonError("이 단계는 지금 수정 요청할 수 없습니다.", 409);
        }

        const note = String((body as any).note || "");
        await db.sql`
          UPDATE collab_stages SET status = 'revision', updated_at = NOW() WHERE id = ${stage.id}
        `;
        const deliverableId = String((body as any).deliverableId || "");
        if (deliverableId) {
          await db.sql`
            UPDATE collab_deliverables
            SET status = 'revision_requested', reviewed_by = ${caller.username}, reviewed_at = NOW(), review_note = ${note}
            WHERE id = ${deliverableId} AND collab_id = ${collabId}
          `;
        }

        await logCollabEvent(db, {
          collabId,
          type: "revision_requested",
          ...actor,
          stageKey,
          summary: `${stage.title} 수정 요청`,
          payload: { note, deliverableId },
        });

        return Response.json({ success: true });
      }

      // 담당자: 단계 승인 -------------------------------------------------
      case "approve_stage": {
        if (!roleMayTransition(role, "done")) {
          return jsonError("단계 완료는 담당자만 처리합니다.", 403);
        }
        const stageKey = String((body as any).stageKey || "");
        const stage = await stageByKey(stageKey);
        if (!stage) return jsonError("단계를 찾을 수 없습니다.", 404);
        if (!canTransitionStage(stage.status, "done")) {
          return jsonError("아직 완료할 수 없는 단계입니다.", 409);
        }

        // 앞 단계가 남아 있으면 뒷 단계를 완료 처리하지 않는다.
        const earlier = (await db.sql`
          SELECT COUNT(*)::int AS c FROM collab_stages
          WHERE collab_id = ${collabId} AND seq < ${stage.seq} AND status NOT IN ('done', 'skipped')
        `) as any[];
        if (Number(earlier?.[0]?.c || 0) > 0) {
          return jsonError("이전 단계가 아직 끝나지 않았습니다.", 409);
        }

        const note = String((body as any).note || "");
        await db.sql`
          UPDATE collab_stages
          SET status = 'done', completed_at = NOW(), updated_at = NOW()
          WHERE id = ${stage.id}
        `;
        await db.sql`
          UPDATE collab_deliverables
          SET status = 'approved', reviewed_by = ${caller.username}, reviewed_at = NOW(), review_note = ${note}
          WHERE collab_id = ${collabId} AND stage_key = ${stageKey} AND status = 'submitted'
        `;

        let settlement: any = null;

        // 업로드 확인 = 정산의 시작점. 수락 시점이 아니라 여기서 예약해야
        // "게시도 안 된 협업의 정산이 잡혀 있는" 상태가 생기지 않는다.
        if (stageKey === "confirm") {
          await db.sql`
            UPDATE campaign_collabs
            SET confirmed_at = COALESCE(confirmed_at, NOW()), updated_at = NOW()
            WHERE id = ${collabId}
          `;
          const termsRows = (await db.sql`SELECT fee FROM collab_terms WHERE collab_id = ${collabId}`) as any[];
          const fee = Number(termsRows?.[0]?.fee || 0);
          const scheduledDate = settlementDateFrom(todayInSeoul());
          // 제품 협찬형 협업은 지급할 광고비가 없다. 그대로 두면 0원 정산이
          // 예약되고, 인플루언서 정산 목록에 받을 것 없는 줄이 하나 남는다.
          if (fee > 0) {
            try {
              const stlNow = new Date().toISOString();
              await addSettlementForProposal({
                id: newId("stl"),
                proposal_id: collab.proposal_id || `campaign_${collab.campaign_id}_${collab.creator_username}`,
                influencer_username: collab.creator_username,
                business_username: collab.business_username,
                company_name: collab.company_name || "",
                title: collab.campaign_title || "",
                amount: fee,
                scheduled_date: scheduledDate,
                status: "scheduled",
                memo: `업로드 확인 완료 · 원천징수 3.3% 차감 후 ${netAfterWithholding(fee).toLocaleString("ko-KR")}원 지급 예정`,
                created_at: stlNow,
                updated_at: stlNow,
              });
              settlement = { scheduledDate, amount: fee, net: netAfterWithholding(fee) };
            } catch (stlErr) {
              console.error("[collab-workflow] 정산 예약 실패:", stlErr);
            }
          }
        }

        const next = await openNextStage(db, collabId, stage.seq);

        await logCollabEvent(db, {
          collabId,
          type: next ? "stage_completed" : "collab_completed",
          ...actor,
          stageKey,
          summary: next ? `${stage.title} 완료 → ${next.title} 시작` : `${stage.title} 완료 · 협업 종료`,
          payload: { note, nextStageKey: next?.stage_key || "", settlement },
        });

        return Response.json({ success: true, nextStageKey: next?.stage_key || "", settlement });
      }

      // 브랜드·담당자: 피드백 등록 ---------------------------------------
      case "add_feedback": {
        if (role === "influencer") return jsonError("피드백은 브랜드와 담당자가 남깁니다.", 403);
        const bodyText = String((body as any).body || "").trim();
        if (!bodyText) return jsonError("피드백 내용을 입력해 주세요.");

        // 브랜드 의견은 기본적으로 담당자만 본다. 담당자가 정리해서 다시 전달한다.
        const visible = role === "manager" ? (body as any).visibleToInfluencer !== false : false;
        const id = newId("cf");
        await db.sql`
          INSERT INTO collab_feedbacks (
            id, collab_id, deliverable_id, stage_key, anchor, body,
            author_type, author_username, visible_to_influencer
          ) VALUES (
            ${id}, ${collabId},
            ${String((body as any).deliverableId || "") || null},
            ${String((body as any).stageKey || "")},
            ${String((body as any).anchor || "")},
            ${bodyText},
            ${role}, ${caller.username}, ${visible}
          )
        `;

        await logCollabEvent(db, {
          collabId,
          type: visible ? "feedback_sent" : "feedback_received",
          ...actor,
          stageKey: String((body as any).stageKey || ""),
          summary: visible ? "수정 요청 항목 전달" : "브랜드 의견 접수",
          payload: { feedbackId: id, anchor: String((body as any).anchor || "") },
        });

        return Response.json({ success: true, feedbackId: id, visibleToInfluencer: visible });
      }

      // 담당자: 브랜드 의견을 다듬어 전달 --------------------------------
      case "relay_feedback": {
        if (role !== "manager") return jsonError("담당자만 전달할 수 있습니다.", 403);
        const sourceId = String((body as any).feedbackId || "");
        const rows = (await db.sql`
          SELECT * FROM collab_feedbacks WHERE id = ${sourceId} AND collab_id = ${collabId}
        `) as any[];
        const source = rows?.[0];
        if (!source) return jsonError("원본 피드백을 찾을 수 없습니다.", 404);

        const text = String((body as any).body || source.body || "").trim();
        const id = newId("cf");
        await db.sql`
          INSERT INTO collab_feedbacks (
            id, collab_id, deliverable_id, stage_key, anchor, body,
            author_type, author_username, visible_to_influencer
          ) VALUES (
            ${id}, ${collabId}, ${source.deliverable_id}, ${source.stage_key},
            ${String((body as any).anchor || source.anchor || "")}, ${text},
            'manager', ${caller.username}, TRUE
          )
        `;
        await db.sql`
          UPDATE collab_feedbacks
          SET status = 'relayed', resolved_by = ${caller.username}, resolved_at = NOW(),
              resolution_note = ${`전달됨 (${id})`}
          WHERE id = ${sourceId}
        `;

        await logCollabEvent(db, {
          collabId,
          type: "feedback_sent",
          ...actor,
          stageKey: source.stage_key || "",
          summary: "브랜드 의견을 정리해 전달",
          payload: { feedbackId: id, sourceId },
        });

        return Response.json({ success: true, feedbackId: id });
      }

      // 인플루언서·담당자: 피드백 처리 결과 -----------------------------
      case "resolve_feedback": {
        const feedbackId = String((body as any).feedbackId || "");
        const status = String((body as any).status || "");
        if (!["applied", "wont_apply"].includes(status)) {
          return jsonError("반영 또는 미반영 중 하나여야 합니다.");
        }
        const rows = (await db.sql`
          SELECT * FROM collab_feedbacks WHERE id = ${feedbackId} AND collab_id = ${collabId}
        `) as any[];
        const feedback = rows?.[0];
        if (!feedback) return jsonError("피드백을 찾을 수 없습니다.", 404);
        if (role === "influencer" && !feedback.visible_to_influencer) {
          return jsonError("처리할 수 없는 항목입니다.", 403);
        }
        if (role === "brand") return jsonError("반영 여부는 인플루언서가 표시합니다.", 403);

        const note = String((body as any).note || "");
        if (status === "wont_apply" && !note.trim()) {
          // 미반영은 이유가 남아야 담당자가 브랜드에 설명할 수 있다.
          return jsonError("미반영 사유를 남겨 주세요.");
        }

        await db.sql`
          UPDATE collab_feedbacks
          SET status = ${status}, resolution_note = ${note}, resolved_by = ${caller.username}, resolved_at = NOW()
          WHERE id = ${feedbackId}
        `;

        await logCollabEvent(db, {
          collabId,
          type: "feedback_resolved",
          ...actor,
          stageKey: feedback.stage_key || "",
          summary: status === "applied" ? "피드백 반영 완료" : "피드백 미반영",
          payload: { feedbackId, status, note },
        });

        return Response.json({ success: true });
      }

      // 담당자: 조건 확정 ------------------------------------------------
      case "update_terms": {
        if (role !== "manager") return jsonError("조건은 담당자가 확정합니다.", 403);
        const termsRows = (await db.sql`SELECT * FROM collab_terms WHERE collab_id = ${collabId}`) as any[];
        const current = termsRows?.[0];
        if (current?.locked_at && !(body as any).force) {
          return jsonError("이미 확정된 조건입니다. 일정 변경 절차를 사용해 주세요.", 409);
        }

        const patch = (body as any).terms || {};
        const fee = patch.fee === undefined ? Number(current?.fee || 0) : Math.max(0, Math.floor(Number(patch.fee) || 0));

        await db.sql`
          INSERT INTO collab_terms (
            collab_id, fee, reward_type, reward_note, script_due, content_due, upload_due,
            deliverable_spec, guide_url, guide_note, updated_at
          ) VALUES (
            ${collabId}, ${fee},
            ${String(patch.rewardType ?? current?.reward_type ?? "")},
            ${String(patch.rewardNote ?? current?.reward_note ?? "")},
            ${String(patch.scriptDue ?? current?.script_due ?? "")},
            ${String(patch.contentDue ?? current?.content_due ?? "")},
            ${String(patch.uploadDue ?? current?.upload_due ?? "")},
            ${JSON.stringify(patch.deliverableSpec ?? current?.deliverable_spec ?? {})},
            ${String(patch.guideUrl ?? current?.guide_url ?? "")},
            ${String(patch.guideNote ?? current?.guide_note ?? "")},
            NOW()
          )
          ON CONFLICT (collab_id) DO UPDATE SET
            fee = EXCLUDED.fee,
            reward_type = EXCLUDED.reward_type,
            reward_note = EXCLUDED.reward_note,
            script_due = EXCLUDED.script_due,
            content_due = EXCLUDED.content_due,
            upload_due = EXCLUDED.upload_due,
            deliverable_spec = EXCLUDED.deliverable_spec,
            guide_url = EXCLUDED.guide_url,
            guide_note = EXCLUDED.guide_note,
            updated_at = NOW()
        `;

        // 확정한 마감일은 단계 마감일로도 내려보낸다 — 두 곳이 다르면 어느 쪽이
        // 약속인지 알 수 없게 된다.
        const dueMap: [string, string][] = [
          ["script", String(patch.scriptDue ?? current?.script_due ?? "")],
          ["content", String(patch.contentDue ?? current?.content_due ?? "")],
          ["upload", String(patch.uploadDue ?? current?.upload_due ?? "")],
        ];
        for (const [stageKey, due] of dueMap) {
          if (!due) continue;
          await db.sql`
            UPDATE collab_stages SET due_date = ${due}, updated_at = NOW()
            WHERE collab_id = ${collabId} AND stage_key = ${stageKey}
          `;
        }

        if ((body as any).lock) {
          await db.sql`
            UPDATE collab_terms SET locked_at = NOW(), locked_by = ${caller.username} WHERE collab_id = ${collabId}
          `;
        }

        await logCollabEvent(db, {
          collabId,
          type: (body as any).lock ? "terms_locked" : "terms_updated",
          ...actor,
          stageKey: "terms",
          summary: (body as any).lock ? "협업 조건 확정" : "협업 조건 수정",
          payload: { fee },
        });

        return Response.json({ success: true });
      }

      // 일정 변경 (협업당 1회) -------------------------------------------
      case "change_schedule": {
        if (role !== "manager") {
          return jsonError("일정 변경은 담당자가 확정합니다. 담당자 채널로 요청해 주세요.", 403);
        }
        const stageKey = String((body as any).stageKey || "");
        const nextDue = String((body as any).nextDue || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) return jsonError("변경할 마감일을 선택해 주세요.");
        const stage = await stageByKey(stageKey);
        if (!stage) return jsonError("단계를 찾을 수 없습니다.", 404);

        const used = (await db.sql`
          SELECT COUNT(*)::int AS c FROM collab_schedule_changes WHERE collab_id = ${collabId}
        `) as any[];
        if (Number(used?.[0]?.c || 0) >= 1 && !(body as any).force) {
          return jsonError("일정 변경은 협업당 1회까지 가능합니다.", 409);
        }

        await db.sql`
          INSERT INTO collab_schedule_changes (
            id, collab_id, stage_key, previous_due, next_due, reason,
            requested_by_role, requested_by, approved_by
          ) VALUES (
            ${newId("csc")}, ${collabId}, ${stageKey}, ${stage.due_date || ""}, ${nextDue},
            ${String((body as any).reason || "")}, ${String((body as any).requestedByRole || "manager")},
            ${String((body as any).requestedBy || caller.username)}, ${caller.username}
          )
        `;
        await db.sql`
          UPDATE collab_stages SET due_date = ${nextDue}, updated_at = NOW() WHERE id = ${stage.id}
        `;

        await logCollabEvent(db, {
          collabId,
          type: "schedule_changed",
          ...actor,
          stageKey,
          summary: `${stage.title} 마감 ${stage.due_date || "미정"} → ${nextDue}`,
          payload: { reason: String((body as any).reason || "") },
        });

        return Response.json({ success: true });
      }

      // 담당자: 협업 내역 일정 체크 --------------------------------------
      //
      // 성사된 캠페인 협업이 당사자 화면(협업 현황 → 협업 내역 · 캘린더)에
      // 나타나는 것은 업로드 확인 뒤 정산 항목이 생긴 다음이었다. 확정부터
      // 업로드까지 몇 주 동안 인플루언서 캘린더에는 그 협업이 없어서, 촬영
      // 일정이 다른 협업과 겹치는지 볼 수도 없었다.
      //
      // 담당자가 기간을 확인해 체크하면 그 즉시 협업 내역에 일정으로 올린다.
      // 조건 확정(update_terms)에서 자동으로 하지 않는 이유는, 마감일이 곧
      // 협업 기간은 아니어서(촬영 기간·게시 유지 기간은 담당자가 조율한다)
      // 사람이 한 번 확인한 값만 당사자 캘린더에 들어가야 하기 때문이다.
      case "confirm_schedule": {
        if (role !== "manager") return jsonError("일정 체크는 담당자가 처리합니다.", 403);

        const termsRows = (await db.sql`SELECT * FROM collab_terms WHERE collab_id = ${collabId}`) as any[];
        const terms = termsRows?.[0] || null;

        const ymd = (value: unknown) => {
          const s = String(value || "").trim().split("T")[0];
          return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
        };

        // 시작일은 담당자가 넘긴 값 → 이미 체크된 값 → 오늘. 종료일은 담당자가
        // 넘긴 값 → 이미 체크된 값 → 확정된 업로드 마감일 순으로 본다.
        const startDate =
          ymd((body as any).startDate) || ymd(collab.schedule_start) || todayInSeoul();
        const endDate =
          ymd((body as any).endDate) ||
          ymd(collab.schedule_end) ||
          ymd(terms?.upload_due) ||
          ymd(terms?.content_due) ||
          "";

        if (endDate && endDate < startDate) {
          return jsonError("종료일이 시작일보다 앞설 수 없습니다.");
        }

        const fee =
          (body as any).fee === undefined
            ? Number(terms?.fee || 0)
            : Math.max(0, Math.floor(Number((body as any).fee) || 0));

        // 캠페인 유형을 협업 내역의 분류로 옮긴다(광고 협업 / 공동구매 / 기타).
        const category =
          collab.campaign_type === "ad_collab"
            ? "광고"
            : collab.campaign_type === "group_buy"
              ? "커머스"
              : "기타";

        // 상태는 날짜로 정한다. 협업 자체가 끝났거나 취소됐으면 그 상태를 따른다.
        const today = todayInSeoul();
        const recordStatus: "scheduled" | "in_progress" | "completed" | "cancelled" =
          collab.status === "completed"
            ? "completed"
            : collab.status === "cancelled"
              ? "cancelled"
              : endDate && endDate < today
                ? "completed"
                : startDate <= today
                  ? "in_progress"
                  : "scheduled";

        const memo = String((body as any).memo || "").trim();
        let record: any = null;
        try {
          const result = await upsertCollabScheduleRecord({
            collabId,
            influencerUsername: collab.creator_username,
            title: collab.campaign_title || "캠페인 협업",
            companyName: collab.company_name || "",
            category,
            date: startDate,
            endDate,
            fee,
            status: recordStatus,
            memo: memo || "캠페인 협업 · 담당자 일정 확인",
            confirmedBy: caller.username,
          });
          record = result?.record || null;
        } catch (recErr: any) {
          console.error("[collab-workflow] 협업 내역 일정 기록 실패:", recErr);
          return jsonError(
            recErr?.name === "RecordWriteConflictError"
              ? "협업 내역이 방금 변경되었습니다. 다시 시도해 주세요."
              : "협업 내역에 일정을 올리지 못했습니다.",
            recErr?.name === "RecordWriteConflictError" ? 409 : 500,
          );
        }

        await db.sql`
          UPDATE campaign_collabs
          SET schedule_start = ${startDate},
              schedule_end = ${endDate},
              schedule_confirmed_at = NOW(),
              schedule_confirmed_by = ${caller.username},
              schedule_record_id = ${record?.id || ""},
              updated_at = NOW()
          WHERE id = ${collabId}
        `;

        await logCollabEvent(db, {
          collabId,
          type: collab.schedule_confirmed_at ? "schedule_rechecked" : "schedule_confirmed",
          ...actor,
          stageKey: "terms",
          summary: `협업 내역 일정 ${startDate}${endDate ? ` ~ ${endDate}` : ""} 확인`,
          payload: { startDate, endDate, fee, category, recordId: record?.id || "" },
        });

        return Response.json({
          success: true,
          schedule: { startDate, endDate, fee, category, status: recordStatus },
          record,
        });
      }

      // 담당자: 배정 변경 ------------------------------------------------
      case "assign_manager": {
        if (role !== "manager") return jsonError("담당자만 배정할 수 있습니다.", 403);
        const target = norm((body as any).managerUsername) || caller.username;
        await db.sql`
          UPDATE campaign_collabs SET manager_username = ${target}, updated_at = NOW() WHERE id = ${collabId}
        `;
        await reassignSupportThreads(db, collabId, target);
        await logCollabEvent(db, {
          collabId,
          type: "manager_assigned",
          ...actor,
          summary: `담당자 ${target} 배정`,
          payload: { managerUsername: target },
        });
        return Response.json({ success: true, managerUsername: target });
      }

      // 담당자: 협업 취소 ------------------------------------------------
      case "cancel": {
        if (role !== "manager") return jsonError("취소는 담당자가 처리합니다.", 403);
        const reason = String((body as any).reason || "").trim();
        if (!reason) return jsonError("취소 사유를 입력해 주세요.");
        await db.sql`
          UPDATE campaign_collabs
          SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ${reason},
              cancelled_by = ${caller.username}, updated_at = NOW()
          WHERE id = ${collabId}
        `;
        await logCollabEvent(db, {
          collabId,
          type: "collab_cancelled",
          ...actor,
          summary: "협업 취소",
          payload: { reason },
        });
        return Response.json({ success: true });
      }

      // 담당자 채널 복구 (예전 협업에 채널이 없을 때) ---------------------
      case "ensure_threads": {
        if (role !== "manager") return jsonError("담당자만 처리할 수 있습니다.", 403);
        const manager = collab.manager_username || caller.username;
        // 인플루언서 채널만 복구한다. 브랜드↔담당자 방은 더 이상 만들지 않는다 —
        // 브랜드의 요청은 진행사항의 단계별 피드백으로 받는다.
        await ensureSupportThread({
          db,
          kind: "influencer_support",
          collabId,
          counterpartUsername: collab.creator_username,
          managerUsername: manager,
          companyName: collab.company_name || "",
          title: collab.campaign_title || "",
        });
        return Response.json({ success: true });
      }

      default:
        return jsonError("알 수 없는 동작입니다.");
    }
  } catch (err: any) {
    console.error("[collab-workflow] 동작 처리 실패:", err);
    return jsonError(err?.message || "처리에 실패했습니다.", 500);
  }
};

export const config: Config = {
  path: ["/api/collab-workflow", "/api/collab-workflow/:collabId"],
};
