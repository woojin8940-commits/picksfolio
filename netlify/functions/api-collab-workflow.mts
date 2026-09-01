import { getDatabase } from "@picks/netlify-database";
import type { Config, Context } from "@netlify/functions";
import { resolveIdentities } from "./_shared/manager-auth.mts";
import {
  addSettlementForProposal,
  upsertCollabScheduleRecord,
  upsertSettlementForProposal,
} from "./_shared/collab-records.mts";
import { seoulDayOf, todayInSeoul } from "./_shared/campaign-recruit.mts";
import { refreshStaleProfileImages } from "./_shared/instagram-metrics.mts";
import { isUploadedFileUrl } from "./_shared/upload-media.mts";
import {
  canTransitionStage,
  daysUntil,
  ensureSupportThread,
  isProcessV1,
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
  /**
   * 자원을 찾을 때 쓰는 아이디. **서비스 계정이 있으면 항상 그 아이디**이고,
   * 담당자 자격만으로 들어온 경우(운영 콘솔)에만 담당자 아이디가 들어온다.
   */
  username: string;
  isManager: boolean;
  managerUsername: string;
};

/**
 * 호출자를 확인한다. 담당자 자격과 서비스 계정을 **겹쳐서** 들고 있는 사람이
 * 있으므로 (운영 콘솔에 로그인한 브라우저에서 자기 브랜드 계정으로 서비스 화면을
 * 쓰는 경우 — Netlify Identity 는 `nf_jwt` 쿠키만으로도 인증이 성립한다) 둘 중
 * 하나를 골라 덮어쓰지 않는다. 예전에는 담당자 판정이 먼저여서 호출자 아이디가
 * 담당자 아이디로 바뀌었고, "내 협업" 조회가 존재하지 않는 이름으로 나가
 * 인플루언서 캠페인 이력과 브랜드 진행사항이 동시에 비어 보였다.
 */
async function resolveCaller(req: Request): Promise<CallerContext | { error: Response }> {
  const { account, manager, accountError } = await resolveIdentities(req);
  if (!account && !manager) {
    return { error: accountError || jsonError("로그인이 필요합니다.", 401) };
  }
  return {
    username: account?.username || manager?.username || "",
    isManager: !!manager,
    managerUsername: manager?.username || "",
  };
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
 * 다섯 단계 화면의 단계 키 → 실제 collab_stages 의 단계 키.
 *
 * 진행 중인 협업은 예전 아홉 단계 묶음으로 시작한 것들이 섞여 있다. 템플릿은 협업이
 * 생길 때 행으로 복사되므로 그 협업들의 단계 이름은 영원히 예전 것이다. 화면을 새
 * 다섯 단계로 바꾸면서 예전 협업을 버릴 수는 없으니, 새 이름으로 들어온 요청을 그
 * 협업이 실제로 들고 있는 단계로 떨어뜨린다 — 기획안은 예전의 구성안(script),
 * 영상은 예전의 콘텐츠(content) 자리다.
 */
const STEP_STAGE_KEYS: Record<string, string[]> = {
  guide: ["guide"],
  shipping: ["shipping"],
  plan: ["plan", "script"],
  video: ["video", "content"],
  upload: ["upload"],
};

/**
 * 진행사항 화면의 다섯 칸 → 그 칸에 들어가는 단계 키(예전 이름까지).
 *
 * 위의 STEP_STAGE_KEYS 는 "요청이 들어왔을 때 어느 단계 행을 건드릴 것인가"를 정하는
 * 표라서 검수 단계(script_review 등)를 넣지 않는다. 여기는 읽기용이다 — 예전 아홉
 * 단계로 시작한 협업의 검수 단계도 같은 칸에 묶여야 화면에서 사라지지 않는다.
 */
const STEP_STAGE_GROUP: Record<string, string[]> = {
  guide: ["guide"],
  shipping: ["shipping", "terms"],
  plan: ["plan", "script", "script_review"],
  video: ["video", "content", "content_review"],
  upload: ["upload", "confirm", "settlement"],
};

async function resolveStepStage(db: any, collabId: string, stepKey: string) {
  const keys = STEP_STAGE_KEYS[stepKey] || [];
  if (keys.length === 0) return null;
  const stages = await loadStages(db, collabId);
  for (const key of keys) {
    const found = stages.find((s) => s.stage_key === key);
    if (found) return found;
  }
  return null;
}

/**
 * 아직 열리지 않은 단계를 막는 근거를 찾는다 — 앞에서 끝나지 않은 단계 하나.
 *
 * 단계는 순서가 있다. 협업이 생길 때 첫 단계만 active 로 두고 나머지는 pending 이며,
 * 앞 단계의 검토가 끝날 때(confirm_step → advanceProcessStage → openNextStage)만 다음
 * 칸이 열린다. 그런데 제출 요청(save_step_work)은 그 상태를 보지 않았다. 즉 화면을
 * 지나쳐 요청을 직접 보내거나, 화면이 잠금을 그리지 못한 자리에서는 기획안 검토가
 * 끝나지 않았는데도 영상 초안이 먼저 올라갈 수 있었다. 그러면 브랜드는 확정되지 않은
 * 기획안으로 찍은 영상을 받고, 기획안 피드백은 이미 찍은 영상을 되돌리라는 말이 된다.
 *
 * 막을 때는 "지금 무엇이 끝나야 하는지"를 함께 돌려준다. "지금 진행할 수 있는 단계가
 * 아닙니다" 만으로는 인플루언서가 다음에 무엇을 해야 할지 알 수 없다.
 *
 * 단계 행이 없는 요청(예전 아홉 단계 묶음 등)은 막지 않는다 — 그 묶음은 담당자
 * 승인으로 움직이고, 여기서 걸면 진행 중인 협업이 멈춘다.
 */
async function earlierUnfinishedStage(db: any, collabId: string, stage: any) {
  if (!stage || String(stage.status) !== "pending") return null;
  const rows = (await db.sql`
    SELECT * FROM collab_stages
    WHERE collab_id = ${collabId} AND seq < ${stage.seq} AND status NOT IN ('done', 'skipped')
    ORDER BY seq ASC LIMIT 1
  `) as any[];
  return rows?.[0] || null;
}

/**
 * 단계 하나를 닫고 다음을 연다 — 다섯 단계 묶음에서만.
 *
 * 예전 묶음은 담당자 승인(approve_stage)으로만 움직인다. 그 묶음에는 "구성안 검수",
 * "콘텐츠 검수" 처럼 담당자가 주인인 단계가 사이사이 들어 있어서, 브랜드가 확인을
 * 누른다고 다음 단계가 열리면 담당자가 하기로 한 일이 통째로 건너뛰어진다.
 */
async function advanceProcessStage(db: any, collab: any, stage: any, actorUsername: string) {
  if (!stage || !isProcessV1(collab.template_key)) return null;
  if (stage.status === "done" || stage.status === "skipped") return null;
  await db.sql`
    UPDATE collab_stages SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = ${stage.id}
  `;
  await db.sql`
    UPDATE collab_deliverables
    SET status = 'approved', reviewed_by = ${actorUsername}, reviewed_at = NOW()
    WHERE collab_id = ${collab.id} AND stage_key = ${stage.stage_key} AND status = 'submitted'
  `;
  return openNextStage(db, collab.id, stage.seq);
}

/**
 * 이 협업의 정산 항목을 가리키는 키.
 *
 * 비즈니스 제안에서 성사된 협업은 제안 id 를, 캠페인 협업은 캠페인과 인플루언서를
 * 엮은 합성 id 를 쓴다. 정산 항목을 만들 때와 나중에 고칠 때 같은 규칙으로 계산해야
 * 같은 줄을 찾는다 — 규칙이 두 곳에서 어긋나면 지급일을 적었는데도 인플루언서
 * 화면의 예정일이 그대로인 일이 생긴다.
 */
/**
 * 정산 항목을 찾는 키. 정산 목록 API 는 캠페인 협업을 `campaign_<캠페인>_<아이디>`
 * 로 파생하면서 아이디를 소문자로 낮춘다. 여기서 대문자가 섞인 채로 쓰면 같은 협업이
 * 파생 행과 명시 행 두 줄로 보이고, 담당자가 정한 지급일 대신 파생된 종료일이 그대로
 * 남는다 — 그래서 같은 규칙으로 소문자로 맞춘다.
 */
const settlementProposalId = (collab: any) =>
  collab.proposal_id ||
  `campaign_${collab.campaign_id}_${String(collab.creator_username || "").toLowerCase()}`;

/**
 * 정산 단계 한 덩어리. 역할에 따라 담는 내용이 다르다.
 *
 * 신분증 사본 URL 과 계좌번호는 개인정보다. 본인(인플루언서)과 실제로 돈을 보내는
 * 담당자만 본다. 브랜드에게는 아무것도 내려보내지 않는다 — 브랜드는 인플루언서에게
 * 개별 송금을 하지 않고(픽스폴리오에 회차마다 한 번 보낸다) 서류를 받고 지급일을 잡고
 * 입금하는 것은 담당자의 일이다. 한동안 "제출했는가"와 지급일까지는 담아 보냈지만,
 * 그것은 브랜드가 손댈 수 없는 남의 일정을 사람 수만큼 확인하게 만들었다. 볼 이유가
 * 없는 값을 응답에 담아 두면, 화면에서 가리는 것과 무관하게 개발자 도구로 열린다.
 */
function shapeSettlementInfo(row: any, role: CollabRole, fee: number) {
  // 브랜드 응답에는 정산 덩어리가 아예 없다. 화면도 이 값이 비면 정산 칸을 그리지
  // 않는다(CampaignProcessBoard 의 shownStates).
  if (role === "brand") return null;
  const sensitive = role === "influencer" || role === "manager";
  const submitted = Boolean(row?.submitted_at);
  return {
    /** 인플루언서가 신분증·계좌를 냈는가. 세 역할 모두 본다. */
    submitted,
    submittedAt: row?.submitted_at || null,
    /** 담당자가 제출물을 열어 보고 지급 가능으로 확인한 시각. */
    reviewedAt: row?.reviewed_at || null,
    reviewedBy: role === "influencer" ? "" : String(row?.reviewed_by || ""),
    /** 담당자가 적은 실제 지급일 (YYYY-MM-DD). 비면 아직 미정이다. */
    payoutDate: row?.payout_date ? String(row.payout_date).split("T")[0] : "",
    payoutMemo: String(row?.payout_memo || ""),
    scheduledAt: row?.scheduled_at || null,
    scheduledBy: role === "influencer" ? "" : String(row?.scheduled_by || ""),
    paidAt: row?.paid_at || null,
    fee,
    netFee: netAfterWithholding(fee),
    /** 개인정보. 본인과 담당자에게만 담는다. */
    idCardUrl: sensitive ? String(row?.id_card_url || "") : "",
    idCardName: sensitive ? String(row?.id_card_name || "") : "",
    bankName: sensitive ? String(row?.bank_name || "") : "",
    accountHolder: sensitive ? String(row?.account_holder || "") : "",
    accountNumber: sensitive ? String(row?.account_number || "") : "",
  };
}

/**
 * 콘텐츠가 실제로 올라간 날(한국 날짜).
 *
 * 정산 회차는 게시물이 올라간 달을 기준으로 잡힌다. 게시물 링크가 등록된 시각이
 * 업로드일이고, 담당자가 확인을 누른 시각은 아니다 — 확인이 며칠 늦어 달을 넘기면
 * 인플루언서가 그만큼 한 달을 더 기다리게 된다.
 *
 * 여러 판이 있으면 첫 판을 본다. 수정 요청을 받아 다시 올렸더라도 게시물이 세상에
 * 나온 날은 첫 등록일이다. 링크 기록이 없는 옛 협업은 업로드 확인 시각 → 오늘로
 * 되돌아간다.
 */
async function uploadDayOf(db: any, collab: any): Promise<string> {
  try {
    const rows = (await db.sql`
      SELECT created_at FROM collab_deliverables
      WHERE collab_id = ${collab.id} AND kind = 'upload'
      ORDER BY version ASC, created_at ASC
      LIMIT 1
    `) as any[];
    const day = seoulDayOf(rows?.[0]?.created_at);
    if (day) return day;
  } catch (err) {
    console.error("[collab-workflow] 업로드일 조회 실패:", err);
  }
  return seoulDayOf(collab?.upload_confirmed_at) || todayInSeoul();
}

/**
 * 정산 예약. 업로드가 확인된 시점에만 부른다.
 *
 * 광고비가 0원인 협업(제품 협찬형)은 예약하지 않는다. 그대로 두면 받을 것이 없는
 * 0원짜리 줄이 인플루언서 정산 목록에 남는다.
 */
async function scheduleSettlementFor(db: any, collab: any) {
  const termsRows = (await db.sql`SELECT fee FROM collab_terms WHERE collab_id = ${collab.id}`) as any[];
  const fee = Number(termsRows?.[0]?.fee || 0);
  if (fee <= 0) return null;
  const uploadDay = await uploadDayOf(db, collab);
  const scheduledDate = settlementDateFrom(uploadDay);
  try {
    const stlNow = new Date().toISOString();
    await addSettlementForProposal({
      id: newId("stl"),
      proposal_id: settlementProposalId(collab),
      influencer_username: collab.creator_username,
      business_username: collab.business_username,
      company_name: collab.company_name || "",
      title: collab.campaign_title || "",
      amount: fee,
      scheduled_date: scheduledDate,
      status: "scheduled",
      memo: `업로드(${uploadDay}) 확인 완료 · 원천징수 3.3% 차감 후 ${netAfterWithholding(fee).toLocaleString("ko-KR")}원 지급 예정`,
      created_at: stlNow,
      updated_at: stlNow,
    });
    return { scheduledDate, amount: fee, net: netAfterWithholding(fee) };
  } catch (stlErr) {
    console.error("[collab-workflow] 정산 예약 실패:", stlErr);
    return null;
  }
}

/**
 * 인플루언서를 화면에 그리는 데 필요한 최소한의 신원 — 인스타 연동 정보에서 온다.
 *
 * 아이디는 한 곳(creator_channels)에서만 읽는다. 두 곳에서 섞어 가져오면 브랜드는
 * 리스트업에서 보고 고른 계정과 진행사항에 뜬 계정이 같은 사람인지 확신할 수 없다.
 *
 * 얼굴만은 되돌아갈 곳을 둔다. 인스타 사진은 연동한 뒤 한 번이라도 동기화가 돌아야
 * 채널 행에 들어오는데(profile_image 는 나중에 생긴 칸이라 예전 연동에는 비어 있다),
 * 그동안 진행사항의 줄은 전부 회색 동그라미가 된다. 같은 사람이 리스트업 카드에서는
 * 사진과 함께 보이던 터라 "인스타 연동이 안 된다"로 읽혔다. 리스트업과 같은 규칙으로
 * (채널 사진 → 픽스폴리오 아바타) 되돌아간다.
 */
function shapeCreatorChannel(row: any, username: string, fallbackImage = "") {
  const handle = String(row?.instagram_handle || "");
  return {
    username,
    instagramHandle: handle,
    instagramUrl:
      String(row?.instagram_url || "") || (handle ? `https://www.instagram.com/${handle}/` : ""),
    profileImage: String(row?.profile_image || "") || String(fallbackImage || ""),
    connected: Boolean(row?.connected),
    followers: Number(row?.followers || 0),
  };
}

/** site_data 한 줄에서 프로필 사진만. 채널에 사진이 없을 때의 되돌아갈 자리다. */
function avatarFromSite(row: any): string {
  return String(row?.data?.profile?.avatar_url || "");
}

/** 배송 정보 한 줄. 아직 아무도 입력하지 않았으면 빈 껍데기를 돌려준다. */
function shapeShipping(row: any) {
  return {
    recipient: String(row?.recipient || ""),
    phone: String(row?.phone || ""),
    postcode: String(row?.postcode || ""),
    address1: String(row?.address1 || ""),
    address2: String(row?.address2 || ""),
    memo: String(row?.memo || ""),
    status: String(row?.status || "pending"),
    courier: String(row?.courier || ""),
    trackingNumber: String(row?.tracking_number || ""),
    shippedAt: row?.shipped_at || null,
    savedAt: row?.updated_at || null,
    /** 주소가 채워졌는가 = 브랜드가 발송할 수 있는가. */
    filled: Boolean(String(row?.recipient || "").trim() && String(row?.address1 || "").trim()),
  };
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

      /**
       * 단계별 제출물의 최신 한 건.
       *
       * 목록이 "지금 이 협업이 몇 번째 단계인가"(current_stage_key)만 들고 있으면,
       * 인플루언서가 앞 단계를 건너뛰고 기획안을 먼저 올린 경우 브랜드 화면에는 아무
       * 일도 일어나지 않는다 — 현재 단계는 여전히 가이드에 걸려 있기 때문이다. 실제로
       * 무엇이 올라왔는지는 제출물 행이 알고 있으므로, 단계마다 최신 한 건씩만 싣는다.
       */
      const workRows = (await db.sql`
        SELECT DISTINCT ON (collab_id, stage_key)
               collab_id, stage_key, kind, version, status, created_at
        FROM collab_deliverables
        WHERE collab_id = ANY(${ids})
        ORDER BY collab_id, stage_key, version DESC
      `) as any[];

      /**
       * 게시물이 처음 등록된 시각 = 콘텐츠가 올라간 날.
       *
       * 최신 제출물만 보는 위의 목록(DISTINCT ON ... version DESC)으로는 알 수 없다.
       * 수정 요청을 받아 다시 올리면 그 날짜가 뒤로 밀리는데, 게시물이 세상에 나온
       * 날은 첫 등록일이고 정산 회차도 그 날을 기준으로 잡힌다(업로드한 달의 익월
       * 말일). 달력이 업로드 점을 이 날에 찍어야 정산 점과 한 줄로 읽힌다.
       */
      const uploadedRows = (await db.sql`
        SELECT collab_id, MIN(created_at) AS uploaded_at
        FROM collab_deliverables
        WHERE collab_id = ANY(${ids}) AND kind = 'upload'
        GROUP BY collab_id
      `) as any[];
      const uploadedMap = new Map(uploadedRows.map((r) => [r.collab_id, r.uploaded_at]));

      /**
       * 배송 정보 요약.
       *
       * 목록에 실어 보내는 이유는 하나다 — 브랜드는 인플루언서 줄을 하나씩 열어 보기
       * 전에는 주소가 들어왔는지 알 수 없었다. 협업의 "현재 단계"는 가이드 확인처럼
       * 앞 단계에 걸려 있을 수 있어서, 주소가 이미 저장돼 있어도 배송 줄에는 아무도
       * 나타나지 않았다. 주소가 채워졌는지를 목록이 알면 그 줄이 바로 뜬다.
       *
       * 주소 원문은 브랜드·담당자에게만 싣는다. 인플루언서에게는 자기 주소지만,
       * 목록 화면에는 쓸 데가 없다.
       */
      const shipRows = (await db.sql`
        SELECT * FROM collab_shipping WHERE collab_id = ANY(${ids})
      `) as any[];
      const shipMap = new Map(shipRows.map((r) => [r.collab_id, r]));
      const showAddress = role === "brand" || role === "manager";

      /**
       * 확정된 보수. 브랜드·담당자에게만 싣는다.
       *
       * 브랜드 진행사항 맨 위의 "총 진행 예산"이 이 값의 합이다. 캠페인에 적어 둔
       * 집행 예산이 아니라 실제로 확정된 협업들의 보수를 더한 값이어야 한다 —
       * 예산은 등록할 때 적은 계획이고, 브랜드가 진행 중에 알고 싶은 것은 "지금
       * 확정된 사람들에게 나갈 돈이 얼마인가"다. 조건이 아직 잠기지 않은(담당자가
       * 정리 중인) 협업은 0원으로 들어오므로, 화면은 잠긴 건수를 함께 센다.
       */
      const termRows = (await db.sql`
        SELECT collab_id, fee, locked_at, upload_due FROM collab_terms WHERE collab_id = ANY(${ids})
      `) as any[];
      const termMap = new Map(termRows.map((r) => [r.collab_id, r]));

      /**
       * 정산 단계의 사실만. 목록 카드도 "지금 누가 무엇을 해야 하는가"를 이 값으로
       * 판정하므로(collabNextAction), 상세를 열지 않아도 "정산 서류 제출 필요"가
       * 카드에 뜬다. 개인정보(신분증 URL · 계좌번호)는 목록에 절대 담지 않는다 —
       * 목록 응답은 화면이 어디서든 캐시하고, 여기 필요한 것은 제출 여부뿐이다.
       *
       * 브랜드 행에는 이 덩어리를 싣지 않는다(showSettlement). 사람별 지급 상태와
       * 지급일은 브랜드가 손댈 수 없는 담당자의 일이고, 브랜드는 회차로 묶인 일괄
       * 정산만 확인한다.
       */
      const settlementRows = (await db.sql`
        SELECT collab_id, submitted_at, reviewed_at, payout_date, paid_at
        FROM collab_settlement_info WHERE collab_id = ANY(${ids})
      `) as any[];
      const settlementMap = new Map(settlementRows.map((r) => [r.collab_id, r]));
      const showSettlement = role !== "brand";

      /**
       * 캠페인 표지. 협업 행에는 제목과 브랜드 이름만 들어 있어서, 목록을 카드로
       * 그리면 사진 자리가 비고 마감일도 알 수 없다. 브랜드가 보는 캠페인 리스트와
       * 같은 모양으로 그리려면 캠페인 쪽 값이 필요하다.
       *
       * 집행 예산처럼 브랜드만 볼 값은 담지 않는다 — 이 응답은 인플루언서도 받는다.
       */
      /**
       * 인플루언서의 인스타 연동 정보.
       *
       * 브랜드 진행사항의 한 줄에 붙는 얼굴과 계정은 인스타에서 온 것이어야 한다.
       * 픽스폴리오 안에서 따로 꾸민 프로필(site_data.profile)을 쓰면, 인스타 연동만
       * 하고 페이지를 안 만든 사람은 회색 동그라미로 남고, 브랜드가 리스트업에서
       * 보고 고른 그 계정과도 다른 사진·다른 이름이 뜬다. 연동 때 함께 받아 둔
       * creator_channels 의 사진·아이디를 그대로 싣는다.
       */
      const creatorNames = [...new Set(rows.map((r) => norm(r.creator_username)).filter(Boolean))];
      /**
       * 얼굴을 읽기 전에, 오래된 사진만 인스타에 다시 물어본다.
       *
       * 채널 행의 사진은 연동하는 순간과 인플루언서가 '갱신'을 누르는 순간에만 채워져
       * 왔다. 둘 다 인플루언서의 손이 필요한 일이라, 연동해 둔 사람이 인스타에서 프로필
       * 사진을 바꿔도 브랜드 화면에는 연동한 날의 얼굴이 남았다 — 브랜드는 자기가 고른
       * 계정과 다른 사진을 보고 같은 사람인지 의심하게 된다.
       *
       * 계정마다 마지막으로 물어본 시각을 남겨 두므로 대부분의 열기에서는 한 건도
       * 부르지 않고, 부를 때도 한 번에 몇 개까지만 부른다. 브랜드·담당자 화면에서만
       * 한다 — 인플루언서는 자기 화면에서 언제든 직접 갱신할 수 있다.
       */
      if (role === "brand" || role === "manager") {
        await refreshStaleProfileImages(db, creatorNames);
      }
      const [channelRows, siteRows] = await Promise.all([
        creatorNames.length
          ? (db.sql`
              SELECT username, instagram_handle, instagram_url, profile_image, connected, followers
              FROM creator_channels WHERE username = ANY(${creatorNames})
            ` as Promise<any[]>)
          : Promise.resolve([] as any[]),
        // 채널에 사진이 없는 사람의 되돌아갈 자리. 리스트업이 쓰는 규칙과 같다.
        creatorNames.length
          ? (db.sql`SELECT username, data FROM site_data WHERE username = ANY(${creatorNames})` as Promise<any[]>)
          : Promise.resolve([] as any[]),
      ]);
      const channelMap = new Map(channelRows.map((c) => [norm(c.username), c]));
      const avatarMap = new Map(siteRows.map((s) => [norm(s.username), avatarFromSite(s)]));

      const campaignIds = [...new Set(rows.map((r) => r.campaign_id).filter(Boolean))];
      const campaignRows = campaignIds.length
        ? ((await db.sql`
            SELECT id, title, brand_name, thumbnail_url, category, type,
                   reward_mode, reward_type, reward_amount, end_date, status,
                   guideline_note, guideline_url, guideline_files
            FROM campaigns WHERE id = ANY(${campaignIds})
          `) as any[])
        : [];
      const campaignMap = new Map(campaignRows.map((c) => [c.id, c]));

      /**
       * 열어 볼 가이드가 있는 협업.
       *
       * 목록도 "지금 이 사람 차례인가"를 판정한다(화면이 카드에 '진행 요청'을 띄운다).
       * 가이드 단계만은 상태 칸으로 판정할 수 없다 — 브랜드가 아직 아무것도 올리지
       * 않았으면 기다리는 쪽은 브랜드이고, 올려 두었으면 확인할 쪽은 인플루언서인데,
       * 두 경우의 단계 상태가 똑같이 'active' 다. 그래서 가이드가 실제로 있는지를 함께
       * 싣는다. 캠페인에 적어 둔 가이드(메모 · 링크 · 파일)와 협업 자료함에 올린 파일을
       * 상세 화면과 같은 규칙으로 본다.
       */
      const guideAssetRows = (await db.sql`
        SELECT DISTINCT collab_id FROM collab_assets
        WHERE collab_id = ANY(${ids}) AND kind = 'guide' AND COALESCE(file_url, '') <> ''
      `) as any[];
      const guideAssetSet = new Set(guideAssetRows.map((r) => r.collab_id));
      const campaignGuideReady = (campaign: any) =>
        Boolean(
          String(campaign?.guideline_note || "").trim() ||
            String(campaign?.guideline_url || "").trim() ||
            guidelineFiles(campaign?.guideline_files).length > 0,
        );

      const today = todayInSeoul();
      /**
       * 다섯 칸의 상태를 협업 한 건에서 뽑아낸다.
       *
       * 화면이 current_stage_key 하나로 다섯 칸을 추측하면, 순서를 벗어난 진행(가이드
       * 확인 전에 올라온 기획안, 이미 저장된 배송지)이 전부 보이지 않게 된다. 칸마다
       * 그 칸의 단계 상태와 최신 제출물 유무를 함께 보내면 화면은 추측할 것이 없다.
       */
      const stepSummary = (own: any[], works: any[]) => {
        const out: Record<string, any> = {};
        for (const [step, keys] of Object.entries(STEP_STAGE_GROUP)) {
          const stage = own.find((s) => keys.includes(String(s.stage_key)));
          const work = works
            .filter((w) => keys.includes(String(w.stage_key)))
            .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
          out[step] = {
            status: String(stage?.status || ""),
            title: String(stage?.title || ""),
            dueDate: stage?.due_date || "",
            submitted: Boolean(work),
            submittedAt: work?.created_at || null,
            version: Number(work?.version || 0),
            workStatus: String(work?.status || ""),
          };
        }
        return out;
      };

      const collabs = rows.map((row) => {
        const own = stages.filter((s) => s.collab_id === row.id);
        const works = workRows.filter((w) => w.collab_id === row.id);
        const current = own.find((s) => s.stage_key === row.current_stage_key) || own.find((s) => s.status !== "done");
        const campaign = campaignMap.get(row.campaign_id) || null;
        const ship = shapeShipping(shipMap.get(row.id));
        return {
          id: row.id,
          campaignId: row.campaign_id,
          campaignTitle: row.campaign_title || campaign?.title || "",
          companyName: row.company_name || campaign?.brand_name || "",
          campaignThumbnail: campaign?.thumbnail_url || "",
          campaignCategory: campaign?.category || "",
          campaignType: row.campaign_type || campaign?.type || "",
          campaignRewardMode: campaign?.reward_mode || "",
          campaignRewardAmount: campaign?.reward_amount || "",
          campaignEndDate: campaign?.end_date || "",
          campaignStatus: campaign?.status || "",
          businessUsername: row.business_username,
          creatorUsername: row.creator_username,
          creator: shapeCreatorChannel(
            channelMap.get(norm(row.creator_username)),
            row.creator_username,
            avatarMap.get(norm(row.creator_username)) || "",
          ),
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
          /** 다섯 칸 각각의 상태. 화면은 이것만 보고 그린다. */
          steps: stepSummary(own, works),
          /** 인플루언서가 열어 볼 가이드가 올라와 있는가. 첫 칸의 차례를 가른다. */
          guideReady: guideAssetSet.has(row.id) || campaignGuideReady(campaign),
          openFeedbackCount: openMap.get(row.id) || 0,
          shipping: {
            filled: ship.filled,
            status: ship.status,
            savedAt: ship.savedAt,
            courier: ship.courier,
            trackingNumber: ship.trackingNumber,
            shippedAt: ship.shippedAt,
            ...(showAddress
              ? {
                  recipient: ship.recipient,
                  phone: ship.phone,
                  postcode: ship.postcode,
                  address1: ship.address1,
                  address2: ship.address2,
                  memo: ship.memo,
                }
              : {}),
          },
          uploadUrl: row.upload_url || "",
          adCode: row.ad_code || "",
          /**
           * 확정 보수. 배송 주소와 같은 칸에 묶여 브랜드·담당자에게만 실려 나갔는데,
           * 이 값은 인플루언서에게 남의 정보가 아니라 자기 보수다. 목록에만 빠져 있어서
           * 인플루언서 협업 현황에 캠페인 협업이 0원으로 들어가고, 완료된 협업의 수익
           * 합계에서 그만큼 비었다. 인플루언서 조회는 위에서 creator_username = 본인으로
           * 좁혀져 있고 상세 화면은 이미 같은 값을 보여 준다.
           */
          fee: Number(termMap.get(row.id)?.fee || 0),
          feeLocked: Boolean(termMap.get(row.id)?.locked_at),
          /**
           * 확정된 업로드 마감일. 협업 현황 달력이 이 날짜 하나만 찍는다.
           *
           * 예전에는 목록에 없어서 달력이 협업 기간(schedule_start~schedule_end)을
           * 막대로 그렸는데, 일정이 확정되지 않은 협업은 그 기간이 "만든 날 ~ 캠페인
           * 종료일"로 벌어져 한 달 내내 칸을 덮었다. 정작 인플루언서가 알아야 하는
           * "언제 올려야 하나"는 그 막대 어디에도 없었다.
           */
          uploadDue: String(termMap.get(row.id)?.upload_due || "").split("T")[0],
          uploadConfirmedAt: row.upload_confirmed_at || null,
          /** 게시물이 처음 등록된 시각. 정산 예정일이 이 날에서 계산된다. */
          uploadedAt: uploadedMap.get(row.id) || null,
          ...(showSettlement
            ? {
                settlement: (() => {
                  const info = settlementMap.get(row.id);
                  return {
                    submitted: Boolean(info?.submitted_at),
                    reviewedAt: info?.reviewed_at || null,
                    payoutDate: info?.payout_date ? String(info.payout_date).split("T")[0] : "",
                    paidAt: info?.paid_at || null,
                  };
                })(),
              }
            : {}),
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
  //
  // 화면이 어떤 역할로 왔는지도 함께 넘긴다. 담당자 자격과 당사자 계정을 겹쳐 가진
  // 사람이 있어서, 요청한 역할을 알려주지 않으면 담당자 콘솔에서 자기 캠페인을
  // 열었을 때 브랜드 화면이 나오거나 그 반대가 된다.
  const requestedRole = ((): CollabRole | null => {
    const raw = (url.searchParams.get("role") || "").toLowerCase();
    return raw === "manager" || raw === "brand" || raw === "influencer" ? raw : null;
  })();
  const roleWith = (business: string) =>
    roleInCollab({ ...collab, business_username: business }, caller.username, caller.isManager, requestedRole);
  const role =
    roleWith(collab.business_username || collab.campaign_owner_username) ||
    roleWith(collab.campaign_owner_username);
  if (!role) return jsonError("이 협업에 접근할 수 없습니다.", 403);

  // ------------------------------------------------------------------ 상세
  if (req.method === "GET") {
    try {
      // 목록과 같은 규칙으로 얼굴을 맞춘다. 목록에서 누른 사람과 열린 화면의 사람이
      // 다른 사진으로 보이면 브랜드는 잘못 눌렀다고 읽는다.
      if (role === "brand" || role === "manager") {
        await refreshStaleProfileImages(db, [norm(collab.creator_username)]);
      }
      const [stages, deliverables, feedbacks, events, termsRows, scheduleChanges, assets, shippingRows, settlementRows, channelRows, siteRows] = await Promise.all([
        loadStages(db, collabId),
        db.sql`SELECT * FROM collab_deliverables WHERE collab_id = ${collabId} ORDER BY created_at ASC` as Promise<any[]>,
        db.sql`SELECT * FROM collab_feedbacks WHERE collab_id = ${collabId} ORDER BY created_at ASC` as Promise<any[]>,
        db.sql`SELECT * FROM collab_events WHERE collab_id = ${collabId} ORDER BY created_at DESC LIMIT 50` as Promise<any[]>,
        db.sql`SELECT * FROM collab_terms WHERE collab_id = ${collabId}` as Promise<any[]>,
        db.sql`SELECT * FROM collab_schedule_changes WHERE collab_id = ${collabId} ORDER BY created_at DESC` as Promise<any[]>,
        db.sql`SELECT * FROM collab_assets WHERE collab_id = ${collabId} ORDER BY created_at DESC` as Promise<any[]>,
        db.sql`SELECT * FROM collab_shipping WHERE collab_id = ${collabId}` as Promise<any[]>,
        db.sql`SELECT * FROM collab_settlement_info WHERE collab_id = ${collabId}` as Promise<any[]>,
        // 얼굴과 인스타 아이디. 목록과 같은 곳에서 읽어야 목록에서 누른 사람과 열린
        // 화면의 사람이 같아 보인다.
        db.sql`
          SELECT username, instagram_handle, instagram_url, profile_image, connected, followers
          FROM creator_channels WHERE username = ${norm(collab.creator_username)}
        ` as Promise<any[]>,
        db.sql`
          SELECT username, data FROM site_data WHERE username = ${norm(collab.creator_username)}
        ` as Promise<any[]>,
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
          uploadConfirmedAt: collab.upload_confirmed_at || null,
          uploadConfirmedBy: role === "influencer" ? "" : collab.upload_confirmed_by || "",
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
        creator: shapeCreatorChannel(
          (channelRows as any[])?.[0],
          collab.creator_username,
          avatarFromSite((siteRows as any[])?.[0]),
        ),
        shipping: shapeShipping((shippingRows as any[])?.[0]),
        settlement: shapeSettlementInfo(
          (settlementRows as any[])?.[0],
          role,
          Number(terms?.fee || 0),
        ),
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
        if (!isUploadedFileUrl(fileUrl)) return jsonError("업로드한 파일을 선택해 주세요.");
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

        // 가이드 파일이 올라왔으면 콘텐츠 가이드 단계는 브랜드 손을 떠난 것이다.
        // 다음은 인플루언서가 "확인했다"를 누를 차례라 여기서 완료로 닫지는 않는다.
        if (kind === "guide") {
          const guideStage = await resolveStepStage(db, collabId, "guide");
          if (guideStage && ["pending", "active"].includes(guideStage.status)) {
            await db.sql`
              UPDATE collab_stages
              SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
              WHERE id = ${guideStage.id}
            `;
          }
        }
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

      // ── 다섯 단계 프로세스 ────────────────────────────────────────────
      // 콘텐츠 가이드 · 제품 배송 · 기획안 피드백 · 영상 피드백 · 업로드.
      // 아래 다섯 동작이 그 프로세스를 그대로 움직인다. 담당자 승인(approve_stage)은
      // 남겨 두되, 이 흐름에서는 브랜드와 인플루언서가 서로에게 직접 넘긴다 —
      // 주소를 받고 제품을 보내는 일까지 사람을 한 명 더 기다리게 할 이유가 없다.

      // 인플루언서: 제품 받을 주소 ---------------------------------------
      case "save_shipping": {
        if (role !== "influencer" && role !== "manager") {
          return jsonError("배송 정보는 인플루언서가 입력합니다.", 403);
        }
        const recipient = String((body as any).recipient || "").trim().slice(0, 60);
        const phone = String((body as any).phone || "").trim().slice(0, 40);
        const postcode = String((body as any).postcode || "").trim().slice(0, 20);
        const address1 = String((body as any).address1 || "").trim().slice(0, 300);
        const address2 = String((body as any).address2 || "").trim().slice(0, 300);
        const memo = String((body as any).memo || "").trim().slice(0, 500);
        if (!recipient) return jsonError("받는 분 이름을 입력해 주세요.");
        if (!phone) return jsonError("연락처를 입력해 주세요.");
        if (!address1) return jsonError("주소를 입력해 주세요.");

        await db.sql`
          INSERT INTO collab_shipping (
            collab_id, recipient, phone, postcode, address1, address2, memo, saved_by
          ) VALUES (
            ${collabId}, ${recipient}, ${phone}, ${postcode}, ${address1}, ${address2}, ${memo}, ${caller.username}
          )
          ON CONFLICT (collab_id) DO UPDATE SET
            recipient = EXCLUDED.recipient,
            phone = EXCLUDED.phone,
            postcode = EXCLUDED.postcode,
            address1 = EXCLUDED.address1,
            address2 = EXCLUDED.address2,
            memo = EXCLUDED.memo,
            saved_by = EXCLUDED.saved_by,
            updated_at = NOW()
        `;

        // 주소가 들어왔으면 배송 단계는 인플루언서 손을 떠난 것이다.
        const stage = await resolveStepStage(db, collabId, "shipping");
        if (stage && !["done", "skipped"].includes(stage.status)) {
          await db.sql`
            UPDATE collab_stages SET status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = ${stage.id}
          `;
        }

        await logCollabEvent(db, {
          collabId,
          type: "shipping_saved",
          ...actor,
          stageKey: stage?.stage_key || "shipping",
          summary: "배송 정보 입력",
        });
        return Response.json({ success: true });
      }

      // 인플루언서: 정산 서류(신분증 사본 · 입금 계좌) ---------------------
      //
      // 원천징수 신고와 실제 이체에 필요한 값이다. 지금까지는 카카오톡·메일로
      // 오갔고, 어느 협업의 것인지 짝이 맞지 않아 계좌를 잘못 옮겨 적는 일이
      // 있었다. 협업 한 줄에 붙여 두면 담당자가 그 자리에서 보고 보낸다.
      case "save_settlement_info": {
        if (role !== "influencer" && role !== "manager") {
          return jsonError("정산 서류는 인플루언서가 입력합니다.", 403);
        }
        const idCardUrl = String((body as any).idCardUrl || "").trim();
        const idCardName = String((body as any).idCardName || "").trim().slice(0, 240);
        const bankName = String((body as any).bankName || "").trim().slice(0, 40);
        const accountHolder = String((body as any).accountHolder || "").trim().slice(0, 60);
        // 계좌번호는 숫자와 하이픈만. 은행 앱에서 복사하면 공백과 문자가 섞여 들어온다.
        const accountNumber = String((body as any).accountNumber || "").replace(/[^0-9-]/g, "").slice(0, 40);

        if (!isUploadedFileUrl(idCardUrl)) {
          return jsonError("신분증 사본 파일을 올려 주세요.");
        }
        if (!bankName) return jsonError("은행명을 입력해 주세요.");
        if (!accountHolder) return jsonError("예금주명을 입력해 주세요.");
        if (accountNumber.replace(/-/g, "").length < 6) {
          return jsonError("계좌번호를 확인해 주세요.");
        }

        await db.sql`
          INSERT INTO collab_settlement_info (
            collab_id, id_card_url, id_card_name, bank_name, account_holder, account_number,
            submitted_at, submitted_by
          ) VALUES (
            ${collabId}, ${idCardUrl}, ${idCardName}, ${bankName}, ${accountHolder}, ${accountNumber},
            NOW(), ${caller.username}
          )
          ON CONFLICT (collab_id) DO UPDATE SET
            id_card_url = EXCLUDED.id_card_url,
            id_card_name = EXCLUDED.id_card_name,
            bank_name = EXCLUDED.bank_name,
            account_holder = EXCLUDED.account_holder,
            account_number = EXCLUDED.account_number,
            submitted_at = NOW(),
            submitted_by = EXCLUDED.submitted_by,
            -- 서류를 다시 냈으면 담당자 확인은 무효다. 바뀐 계좌를 확인 없이
            -- 지급하면 예전 계좌로 보내거나 반송된다.
            reviewed_at = NULL,
            reviewed_by = '',
            updated_at = NOW()
        `;

        await logCollabEvent(db, {
          collabId,
          type: "settlement_info_saved",
          ...actor,
          stageKey: "settlement",
          summary: "정산 서류 제출 (신분증 사본 · 입금 계좌)",
        });
        return Response.json({ success: true });
      }

      // 담당자: 정산 일정 입력 ---------------------------------------------
      //
      // 자동으로 잡히는 "다음 달 말일"은 예정일이고, 정산 회차에 따라 앞뒤로
      // 움직인다. 담당자가 실제 지급일을 적으면 그 값이 정산 항목의 예정일이 되어
      // 인플루언서 정산금 화면과 협업 현황 캘린더에 그대로 올라간다.
      case "schedule_settlement": {
        if (role !== "manager") return jsonError("정산 일정은 담당자가 입력합니다.", 403);

        const payoutDate = (() => {
          const v = String((body as any).payoutDate || "").trim().split("T")[0];
          return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
        })();
        if (!payoutDate) return jsonError("지급일을 선택해 주세요.");
        const payoutMemo = String((body as any).payoutMemo || "").trim().slice(0, 500);
        // 서류를 확인했다고 함께 체크할 수 있다. 확인 없이 날짜만 잡는 것도 막지
        // 않는다 — 서류가 늦게 와도 지급 회차는 미리 정해지는 경우가 있다.
        const markReviewed = (body as any).markReviewed !== false;

        const infoRows = (await db.sql`
          SELECT * FROM collab_settlement_info WHERE collab_id = ${collabId}
        `) as any[];
        const info = infoRows?.[0] || null;

        await db.sql`
          INSERT INTO collab_settlement_info (
            collab_id, payout_date, payout_memo, scheduled_at, scheduled_by
          ) VALUES (
            ${collabId}, ${payoutDate}, ${payoutMemo}, NOW(), ${caller.username}
          )
          ON CONFLICT (collab_id) DO UPDATE SET
            payout_date = EXCLUDED.payout_date,
            payout_memo = EXCLUDED.payout_memo,
            scheduled_at = NOW(),
            scheduled_by = EXCLUDED.scheduled_by,
            updated_at = NOW()
        `;

        if (markReviewed && info?.submitted_at) {
          await db.sql`
            UPDATE collab_settlement_info
            SET reviewed_at = COALESCE(reviewed_at, NOW()), reviewed_by = ${caller.username}, updated_at = NOW()
            WHERE collab_id = ${collabId}
          `;
        }

        // 정산 항목의 예정일을 담당자가 적은 날짜로 맞춘다. 항목이 아직 없으면
        // (업로드 확인 전에 회차를 먼저 잡은 경우) 여기서 만든다.
        const termsRows = (await db.sql`SELECT fee FROM collab_terms WHERE collab_id = ${collabId}`) as any[];
        const fee = Number(termsRows?.[0]?.fee || 0);
        try {
          await upsertSettlementForProposal(
            settlementProposalId(collab),
            collab.business_username,
            collab.creator_username,
            {
              scheduled_date: payoutDate,
              status: "scheduled",
              ...(payoutMemo ? { memo: payoutMemo } : {}),
              ...(fee > 0 ? { amount: fee } : {}),
            },
            {
              company_name: collab.company_name || "",
              title: collab.campaign_title || "",
              amount: fee,
              amount_pending: fee <= 0,
              memo: payoutMemo || "담당자 지정 지급일",
            },
          );
        } catch (stlErr: any) {
          console.error("[collab-workflow] 정산 일정 반영 실패:", stlErr);
          return jsonError(
            stlErr?.name === "RecordWriteConflictError"
              ? "정산 내역이 방금 변경되었습니다. 다시 시도해 주세요."
              : "정산 일정을 반영하지 못했습니다.",
            stlErr?.name === "RecordWriteConflictError" ? 409 : 500,
          );
        }

        await logCollabEvent(db, {
          collabId,
          type: "settlement_scheduled",
          ...actor,
          stageKey: "settlement",
          summary: `정산 지급일 ${payoutDate} 지정`,
        });
        return Response.json({ success: true, payoutDate });
      }

      // 담당자: 지급 완료 ---------------------------------------------------
      case "complete_settlement": {
        if (role !== "manager") return jsonError("지급 처리는 담당자가 합니다.", 403);

        const infoRows = (await db.sql`
          SELECT * FROM collab_settlement_info WHERE collab_id = ${collabId}
        `) as any[];
        const info = infoRows?.[0] || null;
        if (!info?.submitted_at) {
          return jsonError("아직 인플루언서가 정산 서류를 제출하지 않았습니다.", 409);
        }

        const paidDate = (() => {
          const v = String((body as any).paidDate || "").trim().split("T")[0];
          return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayInSeoul();
        })();

        await db.sql`
          UPDATE collab_settlement_info
          SET paid_at = COALESCE(paid_at, NOW()),
              paid_by = ${caller.username},
              payout_date = COALESCE(payout_date, ${paidDate}::date),
              reviewed_at = COALESCE(reviewed_at, NOW()),
              reviewed_by = CASE WHEN reviewed_by = '' THEN ${caller.username} ELSE reviewed_by END,
              updated_at = NOW()
          WHERE collab_id = ${collabId}
        `;

        try {
          await upsertSettlementForProposal(
            settlementProposalId(collab),
            collab.business_username,
            collab.creator_username,
            {
              status: "completed",
              completed_at: new Date().toISOString(),
              scheduled_date: info.payout_date ? String(info.payout_date).split("T")[0] : paidDate,
            },
          );
        } catch (stlErr: any) {
          console.error("[collab-workflow] 지급 완료 반영 실패:", stlErr);
          return jsonError(
            stlErr?.name === "RecordWriteConflictError"
              ? "정산 내역이 방금 변경되었습니다. 다시 시도해 주세요."
              : "지급 완료를 반영하지 못했습니다.",
            stlErr?.name === "RecordWriteConflictError" ? 409 : 500,
          );
        }

        await logCollabEvent(db, {
          collabId,
          type: "settlement_completed",
          ...actor,
          stageKey: "settlement",
          summary: "정산 지급 완료",
        });
        return Response.json({ success: true });
      }

      // 브랜드: 제품 발송 -------------------------------------------------
      case "mark_shipped": {
        if (role !== "brand" && role !== "manager") {
          return jsonError("발송 처리는 브랜드가 합니다.", 403);
        }
        const rows = (await db.sql`SELECT * FROM collab_shipping WHERE collab_id = ${collabId}`) as any[];
        if (!rows?.[0] || !String(rows[0].address1 || "").trim()) {
          return jsonError("아직 인플루언서가 배송 정보를 입력하지 않았습니다.", 409);
        }
        const courier = String((body as any).courier || "").trim().slice(0, 60);
        const trackingNumber = String((body as any).trackingNumber || "").trim().slice(0, 80);
        await db.sql`
          UPDATE collab_shipping
          SET status = 'shipped', courier = ${courier}, tracking_number = ${trackingNumber},
              shipped_at = COALESCE(shipped_at, NOW()), updated_at = NOW()
          WHERE collab_id = ${collabId}
        `;

        const stage = await resolveStepStage(db, collabId, "shipping");
        const next = await advanceProcessStage(db, collab, stage, caller.username);

        await logCollabEvent(db, {
          collabId,
          type: "product_shipped",
          ...actor,
          stageKey: stage?.stage_key || "shipping",
          summary: trackingNumber ? `제품 발송 · ${courier || "택배"} ${trackingNumber}` : "제품 발송",
        });
        return Response.json({ success: true, nextStageKey: next?.stage_key || "" });
      }

      // 인플루언서: 기획안 · 영상 초안 · 업로드 결과 ----------------------
      case "save_step_work": {
        if (role !== "influencer" && role !== "manager") {
          return jsonError("이 칸은 인플루언서가 채웁니다.", 403);
        }
        const stepKey = String((body as any).stepKey || "");
        if (!["plan", "video", "upload"].includes(stepKey)) return jsonError("잘못된 단계입니다.");

        const text = String((body as any).body || "").trim().slice(0, 8000);
        const link = String((body as any).link || "").trim().slice(0, 1000);
        const fileUrl = String((body as any).fileUrl || "").trim();
        const fileName = String((body as any).fileName || "").trim().slice(0, 240);
        if (fileUrl && !isUploadedFileUrl(fileUrl)) {
          return jsonError("업로드한 파일을 선택해 주세요.");
        }
        // 기획안은 장면 단위로 온다 — 장면마다 설명과 자막. 브랜드 피드백이 장면
        // 번호에 붙기 때문에 그 번호가 제출물 안에 함께 남아 있어야 한다.
        /**
         * 영상과 함께 올라오는 인스타 본문 캡션.
         *
         * 영상만 검토받고 본문은 업로드 당일에 처음 쓰이면, 브랜드가 못 본 문장이
         * 광고 게시물의 본문이 된다(필수 문구 · 해시태그 · 파트너십 표기가 여기에
         * 들어간다). 그래서 초안 단계의 제출물에 함께 담아 같이 검토받는다.
         *
         * 2,200자는 인스타그램 본문 한도다. 화면에서도 같은 숫자를 세어 준다.
         */
        const caption = String((body as any).caption || "").trim().slice(0, 2200);
        const scenes = Array.isArray((body as any).scenes)
          ? ((body as any).scenes as any[])
              .slice(0, 40)
              .map((s) => ({
                visual: String(s?.visual || "").slice(0, 2000),
                subtitle: String(s?.subtitle || "").slice(0, 1000),
                narration: String(s?.narration || "").slice(0, 2000),
              }))
              .filter((s) => s.visual.trim() || s.subtitle.trim() || s.narration.trim())
          : [];
        if (stepKey === "plan" && !text && !fileUrl && scenes.length === 0) {
          return jsonError("기획안 내용을 입력하거나 파일을 올려 주세요.");
        }
        const stage = await resolveStepStage(db, collabId, stepKey);
        // 앞 단계의 검토가 끝나기 전에는 이 칸을 낼 수 없다.
        const blocking = await earlierUnfinishedStage(db, collabId, stage);
        if (blocking) {
          return jsonError(
            `${blocking.title || "앞 단계"}가 아직 끝나지 않았습니다. ${blocking.title || "앞 단계"} 검토가 완료되면 이 단계를 진행할 수 있습니다.`,
            409,
          );
        }
        const stageKey = stage?.stage_key || stepKey;

        /**
         * 초안 영상은 파일로만 받는다. 링크(유튜브·드라이브)로 받던 시절의 제출물이
         * 아직 남아 있어 읽기는 계속 되지만, 새로 낼 때는 파일이어야 한다 — 링크는
         * 권한이 닫히거나 나중에 지워져서, 검수할 때 열리지 않는 일이 잦았다.
         *
         * 단, 두 번째 저장부터는 이미 올라간 영상을 그대로 이어받는다. 본문 캡션만
         * 고쳐 다시 내는 일이 자주 생기는데(브랜드가 문구 하나를 지적했을 때), 그때마다
         * 수백 MB 영상을 다시 올리게 하면 한 줄 고치는 데 몇 분이 들고 모바일
         * 데이터로는 아예 포기하게 된다.
         */
        let carriedFileUrl = fileUrl;
        let carriedFileName = fileName;
        if (stepKey === "video" && !carriedFileUrl) {
          const prevRows = (await db.sql`
            SELECT payload FROM collab_deliverables
            WHERE collab_id = ${collabId} AND stage_key = ${stageKey}
            ORDER BY version DESC LIMIT 1
          `) as any[];
          const rawPrev = prevRows?.[0]?.payload;
          const prev = (typeof rawPrev === "string" ? JSON.parse(rawPrev || "{}") : rawPrev) || {};
          if (String(prev.fileUrl || "")) {
            carriedFileUrl = String(prev.fileUrl);
            carriedFileName = String(prev.fileName || "");
          }
        }
        if (stepKey === "video" && !carriedFileUrl) return jsonError("초안 영상 파일을 올려 주세요.");
        if (stepKey === "upload" && !link) return jsonError("게시물 링크를 입력해 주세요.");

        const adCode = String((body as any).adCode || "").trim().slice(0, 500);
        const payload = { body: text, link, fileUrl: carriedFileUrl, fileName: carriedFileName, adCode, caption, step: stepKey, scenes };

        // 덮어쓰지 않고 버전을 쌓는다. 피드백이 "몇 번째 안"에 붙은 말인지가
        // 남지 않으면 수정 왕복이 기억 싸움이 된다.
        const versionRows = (await db.sql`
          SELECT COALESCE(MAX(version), 0)::int AS v FROM collab_deliverables
          WHERE collab_id = ${collabId} AND stage_key = ${stageKey}
        `) as any[];
        const version = Number(versionRows?.[0]?.v || 0) + 1;
        const deliverableId = newId("cd");
        await db.sql`
          INSERT INTO collab_deliverables (id, collab_id, stage_key, kind, version, status, payload, submitted_by)
          VALUES (${deliverableId}, ${collabId}, ${stageKey}, ${stepKey}, ${version}, 'submitted', ${JSON.stringify(payload)}, ${caller.username})
        `;
        if (stage && !["done", "skipped"].includes(stage.status)) {
          await db.sql`
            UPDATE collab_stages SET status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = ${stage.id}
          `;
        }

        /**
         * 이 단계에 열려 있던 피드백을 반영 완료로 닫는다.
         *
         * 예전에는 인플루언서 화면의 피드백마다 "반영했어요" / "어려워요" 버튼이
         * 있었고, 그것을 눌러야 이 상태가 바뀌었다. 그런데 인플루언서가 실제로 하는
         * 일은 하나다 — 피드백을 읽고 기획안을 고쳐 다시 저장한다. 저장 뒤에 버튼을
         * 한 번 더 누르는 것은 그 작업과 별개의 숙제여서 대부분 눌리지 않았고, 브랜드
         * 화면에는 "반영 표시가 되지 않은 피드백 N개"가 영원히 남았다. 다시 제출하는
         * 행위 자체를 반영으로 읽으면 그 어긋남이 없어진다.
         *
         * 새 버전을 낸 것이므로 닫는 대상은 이 단계에 남아 있던 것 전부다. 미반영
         * (wont_apply)으로 이미 사유를 남긴 것은 건드리지 않는다 — 그것은 "고치지
         * 않기로 했다"는 별개의 결론이고, 덮어쓰면 브랜드가 읽은 사유가 사라진다.
         */
        await db.sql`
          UPDATE collab_feedbacks
             SET status = 'applied', resolved_by = ${caller.username}, resolved_at = NOW()
           WHERE collab_id = ${collabId}
             AND stage_key = ${stageKey}
             AND status IN ('open', 'relayed')
        `;

        if (stepKey === "upload") {
          await db.sql`
            UPDATE campaign_collabs
            SET upload_url = ${link},
                deliverable_url = ${link},
                ad_code = ${adCode || collab.ad_code || ""},
                updated_at = NOW()
            WHERE id = ${collabId}
          `;
        }

        await logCollabEvent(db, {
          collabId,
          type: "deliverable_submitted",
          ...actor,
          stageKey,
          summary: `${stepKey === "plan" ? "기획안" : stepKey === "video" ? "초안 영상" : "업로드 결과"} 등록 (v${version})`,
          payload: { deliverableId, kind: stepKey, version },
        });
        return Response.json({ success: true, deliverableId, version });
      }

      // 브랜드: 기획안 · 영상 바로 아래에 남기는 피드백 -------------------
      //
      // 한 칸씩 보내는 경로(step_feedback)와 여러 칸을 모아 한 번에 저장하는 경로
      // (step_feedback_batch)를 같은 자리에서 처리한다. 저장되는 모양은 완전히 같아야
      // 한다 — 장면 하나하나가 자기 anchor 를 가진 별개의 행이다. 여러 칸을 한 덩어리
      // 글로 합쳐 저장하면 인플루언서 화면에서 그 말이 어느 장면 아래에 붙을지 알 수
      // 없어지고, 장면으로 나눠 받는 의미가 사라진다.
      case "step_feedback":
      case "step_feedback_batch": {
        if (role !== "brand" && role !== "manager") {
          return jsonError("피드백은 브랜드가 남깁니다.", 403);
        }
        const stepKey = String((body as any).stepKey || "");
        if (!["guide", "shipping", "plan", "video", "upload"].includes(stepKey)) {
          return jsonError("잘못된 단계입니다.");
        }

        /**
         * 피드백이 붙는 자리.
         *
         * 기획안은 장면으로 나뉘어 있어서 "몇 번 장면에 대한 말인지"가 피드백 자체에
         * 남아야 한다. 자리를 비워 보내면 예전처럼 단계 전체에 대한 말이 된다.
         * 받는 형식은 `scene:3` 과 `caption` 둘뿐이다 — 화면이 읽을 수 있는 것이
         * 그것뿐이고, 읽지 못하는 위치로 저장되면 그 피드백은 어느 칸에도 뜨지 않는다.
         *
         * `caption` 은 영상 단계의 본문 캡션 칸이다. 영상 자체에 대한 의견과 섞이면
         * 인플루언서가 영상을 다시 편집해야 하는지 글만 고치면 되는지 알 수 없다.
         */
        const readAnchor = (raw: unknown): { anchor: string; scene: string | null } | null => {
          const rawAnchor = String(raw || "").trim();
          if (!rawAnchor) return { anchor: stepKey, scene: null };
          if (rawAnchor === "caption") {
            if (stepKey !== "video") return null;
            return { anchor: "caption", scene: null };
          }
          const m = /^scene:(\d{1,3})$/.exec(rawAnchor);
          if (!m) return null;
          return { anchor: rawAnchor, scene: m[1] };
        };

        // 한 칸이든 여러 칸이든 이 배열 하나로 모은다.
        const rawItems = Array.isArray((body as any).items)
          ? ((body as any).items as any[]).slice(0, 60)
          : [{ anchor: (body as any).anchor, body: (body as any).body }];

        const entries: { anchor: string; scene: string | null; body: string }[] = [];
        for (const raw of rawItems) {
          const text = String(raw?.body || "").trim().slice(0, 4000);
          if (!text) continue;
          const at = readAnchor(raw?.anchor);
          if (!at) return jsonError("잘못된 피드백 위치입니다.");
          entries.push({ ...at, body: text });
        }
        if (entries.length === 0) return jsonError("피드백 내용을 입력해 주세요.");

        // 이 피드백은 인플루언서에게 바로 보인다.
        //
        // 다른 경로(add_feedback)에서 브랜드 의견을 담당자만 보게 막아 둔 것은,
        // 그것이 담당자가 정리해 전달할 원문이기 때문이다. 여기는 다르다. 기획안
        // 입력칸 바로 밑에 달린 칸에 쓴 말은 그 기획안에 대한 답이고, 답이 한 사람을
        // 더 거치면 그 자리에 있을 이유가 없다.
        const stage = await resolveStepStage(db, collabId, stepKey);
        const stageKey = stage?.stage_key || stepKey;
        const deliverableRows = (await db.sql`
          SELECT id FROM collab_deliverables
          WHERE collab_id = ${collabId} AND stage_key = ${stageKey}
          ORDER BY version DESC LIMIT 1
        `) as any[];
        const deliverableId = deliverableRows?.[0]?.id || null;

        const ids: string[] = [];
        for (const entry of entries) {
          const id = newId("cf");
          await db.sql`
            INSERT INTO collab_feedbacks (
              id, collab_id, deliverable_id, stage_key, anchor, body,
              author_type, author_username, visible_to_influencer
            ) VALUES (
              ${id}, ${collabId}, ${deliverableId},
              ${stageKey}, ${entry.anchor}, ${entry.body},
              ${role}, ${caller.username}, TRUE
            )
          `;
          ids.push(id);
        }

        // 피드백이 왔다는 것은 다시 인플루언서 차례라는 뜻이다.
        if (stage && stage.status === "submitted" && isProcessV1(collab.template_key)) {
          await db.sql`UPDATE collab_stages SET status = 'revision', updated_at = NOW() WHERE id = ${stage.id}`;
        }

        // 원장에는 한 줄만 남긴다. 장면마다 한 줄씩 쌓으면 이력이 같은 시각의 같은
        // 문장 다섯 줄로 채워져, 정작 "언제 무슨 일이 있었나"를 읽을 수 없게 된다.
        const stepName = stepKey === "plan" ? "기획안" : stepKey === "video" ? "영상" : "진행";
        const scenes = entries.map((e) => e.scene).filter(Boolean) as string[];
        await logCollabEvent(db, {
          collabId,
          type: "feedback_sent",
          ...actor,
          stageKey,
          summary:
            entries.length === 1
              ? `${stepName}${scenes.length === 1 ? ` 장면 ${scenes[0]}` : ""} 피드백 전달`
              : `${stepName} 피드백 ${entries.length}건 전달${
                  scenes.length > 0 ? ` (장면 ${scenes.join(", ")})` : ""
                }`,
          payload: { feedbackIds: ids, feedbackId: ids[0], step: stepKey, count: entries.length },
        });
        return Response.json({ success: true, feedbackId: ids[0], feedbackIds: ids, count: ids.length });
      }

      // 단계 확인 완료 ----------------------------------------------------
      case "confirm_step": {
        const stepKey = String((body as any).stepKey || "");
        if (!["guide", "plan", "video", "upload"].includes(stepKey)) {
          return jsonError("잘못된 단계입니다.");
        }
        // 가이드는 "읽었다"를 인플루언서가 표시한다. 나머지는 브랜드가 확인한다.
        if (stepKey === "guide") {
          if (role !== "influencer" && role !== "manager") {
            return jsonError("가이드 확인은 인플루언서가 표시합니다.", 403);
          }
        } else if (role !== "brand" && role !== "manager") {
          return jsonError("확인은 브랜드가 합니다.", 403);
        }

        const stage = await resolveStepStage(db, collabId, stepKey);
        // 열리지도 않은 단계를 확인 처리하면 그 앞 단계가 통째로 건너뛰어진다
        // (advanceProcessStage 가 이 단계를 done 으로 닫고 다음 칸을 연다).
        const blockingConfirm = await earlierUnfinishedStage(db, collabId, stage);
        if (blockingConfirm) {
          return jsonError(
            `${blockingConfirm.title || "앞 단계"}가 아직 끝나지 않았습니다. 순서대로 진행해 주세요.`,
            409,
          );
        }
        let settlement: any = null;

        if (stepKey === "upload") {
          if (!String(collab.upload_url || "").trim()) {
            return jsonError("아직 게시물 링크가 등록되지 않았습니다.", 409);
          }
          // 이미 확인된 협업이면 정산을 다시 예약하지 않는다 — 두 번 누르면
          // 같은 금액이 두 줄로 잡힌다.
          const confirmed = (await db.sql`
            UPDATE campaign_collabs
            SET upload_confirmed_at = NOW(), upload_confirmed_by = ${caller.username},
                confirmed_at = COALESCE(confirmed_at, NOW()), updated_at = NOW()
            WHERE id = ${collabId} AND upload_confirmed_at IS NULL
            RETURNING id
          `) as any[];
          if (confirmed?.[0]) settlement = await scheduleSettlementFor(db, collab);
        }

        const next = await advanceProcessStage(db, collab, stage, caller.username);

        await logCollabEvent(db, {
          collabId,
          type: stepKey === "upload" ? "upload_confirmed" : "stage_completed",
          ...actor,
          stageKey: stage?.stage_key || stepKey,
          summary:
            stepKey === "guide"
              ? "가이드 확인"
              : stepKey === "upload"
                ? "업로드 확인 완료"
                : `${stepKey === "plan" ? "기획안" : "영상"} 확인 완료`,
          payload: { settlement },
        });
        return Response.json({ success: true, nextStageKey: next?.stage_key || "", settlement });
      }

      // 인플루언서: 산출물 제출 (예전 아홉 단계 묶음) ---------------------
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
          settlement = await scheduleSettlementFor(db, collab);
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
