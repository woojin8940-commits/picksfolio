import { getStore } from "@netlify/blobs";
import { mutateBlobJSON } from "./blob-write.mts";
import { todayInSeoul } from "./campaign-recruit.mts";

/**
 * 캠페인 협업 워크플로 — 단계 정의와 상태 전이.
 *
 * 협업이 "대화 잘 되고 있음" 이상의 상태를 가지려면, 단계가 코드가 아니라 데이터로
 * 존재해야 한다. 이 파일은 그 데이터를 만드는 곳이다.
 *
 * 설계상 지키는 두 가지:
 *
 *   1. 템플릿은 복사된다. 협업이 시작되면 단계 목록을 `collab_stages` 행으로
 *      복사해 넣는다. 나중에 템플릿을 고쳐도 진행 중인 협업의 약속(마감일, 단계
 *      구성)은 바뀌지 않는다.
 *   2. 상태를 바꾼 사람은 반드시 이벤트를 남긴다. 알림은 이벤트를 읽어서 나가므로,
 *      이벤트 없이 상태만 바꾸면 상대는 아무 통보도 받지 못한다.
 */

export type StageOwner = "influencer" | "brand" | "manager";
export type DeliverableKind = "script" | "content" | "upload";

export type StageTemplate = {
  key: string;
  title: string;
  owner: StageOwner;
  /** 협업 시작일 기준 며칠째가 기본 마감인지. 담당자가 조건 확정 때 조정한다. */
  dueOffsetDays: number;
  /** 이 단계에서 제출물이 나온다면 그 종류. 없으면 검수·확인 단계다. */
  deliverable?: DeliverableKind;
  /** 인플루언서 화면에 보여줄 한 줄 안내. */
  hint?: string;
};

export type StageTemplateSet = {
  key: string;
  label: string;
  stages: StageTemplate[];
};

/**
 * 광고 협업. 대본 검수를 거친다 — 브랜드가 촬영 전에 구성안을 보고 방향을 잡아야
 * 재촬영이 줄어든다.
 */
const AD_COLLAB: StageTemplateSet = {
  key: "ad_collab_v1",
  label: "광고 협업",
  stages: [
    { key: "terms", title: "조건 확정", owner: "manager", dueOffsetDays: 1, hint: "담당자가 금액·일정·산출물 규격을 확정합니다." },
    { key: "guide", title: "가이드 전달", owner: "manager", dueOffsetDays: 2, hint: "브랜드 가이드를 정리해 전달합니다." },
    { key: "script", title: "구성안 제출", owner: "influencer", dueOffsetDays: 5, deliverable: "script", hint: "장면별 구성안을 작성해 제출해 주세요." },
    { key: "script_review", title: "구성안 검수", owner: "manager", dueOffsetDays: 7, hint: "브랜드 의견을 모아 담당자가 정리해 전달합니다." },
    { key: "content", title: "콘텐츠 제출", owner: "influencer", dueOffsetDays: 12, deliverable: "content", hint: "확정된 구성안대로 촬영·편집한 결과물을 제출해 주세요." },
    { key: "content_review", title: "콘텐츠 검수", owner: "manager", dueOffsetDays: 14, hint: "수정 요청이 있으면 항목별로 전달합니다." },
    { key: "upload", title: "업로드", owner: "influencer", dueOffsetDays: 17, deliverable: "upload", hint: "업로드 후 게시물 링크를 등록해 주세요." },
    { key: "confirm", title: "업로드 확인", owner: "manager", dueOffsetDays: 18, hint: "담당자가 게시물을 확인하면 정산이 예약됩니다." },
    { key: "settlement", title: "정산", owner: "manager", dueOffsetDays: 19, hint: "확인 월의 익월 말일에 지급됩니다." },
  ],
};

/**
 * 알뜰 패키지. 구성안(대본) 단계를 빼고 바로 촬영으로 들어간다.
 *
 * 브랜드가 이 패키지를 고르는 이유는 일정이다. 구성안 제출과 검수에 최소 일주일이
 * 붙는데, 이미 만들 그림이 정해져 있는 광고형 콘텐츠에서는 그 왕복이 결과를 크게
 * 바꾸지 않는다. 대신 콘텐츠 검수는 그대로 둔다 — 촬영 결과를 한 번도 보지 않고
 * 업로드하게 하면 브랜드가 가장 걱정하는 지점이 열린 채로 남는다.
 */
const AD_COLLAB_LITE: StageTemplateSet = {
  key: "ad_collab_lite_v1",
  label: "알뜰 패키지",
  stages: [
    { key: "terms", title: "조건 확정", owner: "manager", dueOffsetDays: 1, hint: "담당자가 금액·일정·산출물 규격을 확정합니다." },
    { key: "guide", title: "가이드 전달", owner: "manager", dueOffsetDays: 2, hint: "브랜드 가이드를 정리해 전달합니다." },
    { key: "content", title: "콘텐츠 제출", owner: "influencer", dueOffsetDays: 8, deliverable: "content", hint: "가이드에 맞춰 촬영·편집한 결과물을 제출해 주세요." },
    { key: "content_review", title: "콘텐츠 검수", owner: "manager", dueOffsetDays: 10, hint: "수정 요청이 있으면 항목별로 전달합니다." },
    { key: "upload", title: "업로드", owner: "influencer", dueOffsetDays: 13, deliverable: "upload", hint: "업로드 후 게시물 링크를 등록해 주세요." },
    { key: "confirm", title: "업로드 확인", owner: "manager", dueOffsetDays: 14, hint: "담당자가 게시물을 확인하면 정산이 예약됩니다." },
    { key: "settlement", title: "정산", owner: "manager", dueOffsetDays: 15, hint: "확인 월의 익월 말일에 지급됩니다." },
  ],
};

/**
 * 유가 시딩. 검수 단계가 없다.
 *
 * 시딩은 한 사람의 콘텐츠 완성도를 올리는 일이 아니라 여러 사람이 같은 시기에
 * 올리게 하는 일이다. 수십 건을 한 건씩 검수하면 그 자체로 진행이 멈추고, 단가
 * (1건 10만원)로는 그 손이 감당되지 않는다. 그래서 가이드를 주고 업로드를 확인한다.
 */
const SEEDING: StageTemplateSet = {
  key: "seeding_v1",
  label: "유가 시딩",
  stages: [
    { key: "terms", title: "조건 확정", owner: "manager", dueOffsetDays: 1, hint: "담당자가 제품 발송과 업로드 기한을 확정합니다." },
    { key: "guide", title: "가이드 전달", owner: "manager", dueOffsetDays: 2, hint: "필수 표기와 촬영 가이드를 전달합니다." },
    { key: "upload", title: "업로드", owner: "influencer", dueOffsetDays: 10, deliverable: "upload", hint: "가이드에 맞춰 업로드하고 게시물 링크를 등록해 주세요." },
    { key: "confirm", title: "업로드 확인", owner: "manager", dueOffsetDays: 11, hint: "담당자가 게시물을 확인하면 정산이 예약됩니다." },
    { key: "settlement", title: "정산", owner: "manager", dueOffsetDays: 12, hint: "확인 월의 익월 말일에 지급됩니다." },
  ],
};

/**
 * 공동구매. 판매 콘텐츠는 구성안 단계를 따로 두지 않는다 — 상품과 혜택이 이미
 * 정해져 있어 구성안 검수가 실제로는 콘텐츠 검수와 겹친다.
 */
const GROUP_BUY: StageTemplateSet = {
  key: "group_buy_v1",
  label: "공동구매",
  stages: [
    { key: "terms", title: "조건 확정", owner: "manager", dueOffsetDays: 1, hint: "담당자가 수수료·판매 기간·상품 정보를 확정합니다." },
    { key: "guide", title: "상품 정보 전달", owner: "manager", dueOffsetDays: 2, hint: "상품 상세와 판매 조건을 전달합니다." },
    { key: "content", title: "콘텐츠 제출", owner: "influencer", dueOffsetDays: 8, deliverable: "content", hint: "판매 콘텐츠를 제출해 주세요." },
    { key: "content_review", title: "콘텐츠 검수", owner: "manager", dueOffsetDays: 10, hint: "표기 의무 사항까지 함께 확인합니다." },
    { key: "upload", title: "판매 시작", owner: "influencer", dueOffsetDays: 12, deliverable: "upload", hint: "업로드 후 게시물 링크를 등록해 주세요." },
    { key: "confirm", title: "게시 확인", owner: "manager", dueOffsetDays: 13, hint: "담당자가 게시물을 확인하면 정산이 예약됩니다." },
    { key: "settlement", title: "정산", owner: "manager", dueOffsetDays: 14, hint: "확인 월의 익월 말일에 지급됩니다." },
  ],
};

const TEMPLATES: StageTemplateSet[] = [AD_COLLAB, AD_COLLAB_LITE, SEEDING, GROUP_BUY];

/**
 * 캠페인 유형과 패키지에 맞는 단계 묶음.
 *
 * 유형이 먼저다. 공동구매는 어떤 패키지를 골랐든 판매 흐름을 따라야 한다(혜택
 * 표기 검수를 뺄 수 없다). 광고 협업일 때만 패키지가 단계를 정한다.
 *
 * 등록 화면이 "대본 피드백 제외"라고 보여준 패키지에서 실제로 대본 단계가 생기면
 * 브랜드는 자기가 고른 것과 다른 진행을 보게 된다. 그래서 표시와 단계를 한 곳에서
 * 맞춘다 — 화면 쪽 짝은 src/utils/campaignPackages.ts 의 PACKAGES.stages 다.
 */
export function templateForCampaignType(
  campaignType?: string | null,
  packageTier?: string | null,
): StageTemplateSet {
  const type = String(campaignType || "").trim().toLowerCase();
  if (type.includes("group_buy") || type.includes("공동구매") || type.includes("commerce")) {
    return GROUP_BUY;
  }
  const tier = String(packageTier || "").trim().toLowerCase();
  if (tier === "seeding") return SEEDING;
  if (tier === "lite") return AD_COLLAB_LITE;
  return AD_COLLAB;
}

/** 저장된 template_key 로 단계 묶음을 되찾는다(진행 중 협업 조회용). */
export function templateByKey(key?: string | null): StageTemplateSet {
  return TEMPLATES.find((t) => t.key === key) || AD_COLLAB;
}

// ---------------------------------------------------------------------------
// 날짜
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' 에 일수를 더한다. 기준 시간대는 서비스 기준인 한국 시간. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * 정산 지급일 = 업로드 확인 월의 익월 말일.
 * 지금까지는 수락 시점 +30일 고정이었다. 실제로 업로드가 늦어지면 아직 게시도
 * 되지 않은 협업의 정산이 예약돼 있는 상태가 됐다.
 */
export function settlementDateFrom(confirmedDateKey: string = todayInSeoul()): string {
  const [y, m] = confirmedDateKey.split("-").map(Number);
  // 다음 달의 0일 = 다음 달 말일. (m 은 1~12, Date.UTC 의 월은 0~11이므로 m+1 = 다음달)
  const lastDay = new Date(Date.UTC(y, m + 1, 0));
  return lastDay.toISOString().slice(0, 10);
}

/** 원천징수 3.3% 를 뗀 실지급액. */
export function netAfterWithholding(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.floor(amount * 0.967);
}

/** 마감까지 남은 일수. 음수면 지연. */
export function daysUntil(dueDate?: string | null, today: string = todayInSeoul()): number | null {
  if (!dueDate) return null;
  const key = String(dueDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

// ---------------------------------------------------------------------------
// 상태 전이
// ---------------------------------------------------------------------------

export type StageStatus = "pending" | "active" | "submitted" | "revision" | "done" | "skipped";

/**
 * 허용되는 단계 상태 전이. 표로 두는 이유는, 화면마다 조건문을 흩뿌리면 어느
 * 화면에서는 되고 어느 화면에서는 안 되는 상태가 생기기 때문이다.
 */
const STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  pending: ["active", "skipped"],
  active: ["submitted", "done", "skipped", "revision"],
  submitted: ["done", "revision"],
  revision: ["submitted", "done"],
  done: [],
  skipped: [],
};

export function canTransitionStage(from: string, to: string): boolean {
  const allowed = STAGE_TRANSITIONS[from as StageStatus];
  return Array.isArray(allowed) && allowed.includes(to as StageStatus);
}

/** 누가 그 전이를 요청할 수 있는지. 완료 판정은 담당자만 한다. */
export function roleMayTransition(role: StageOwner, to: string): boolean {
  if (role === "manager") return true;
  if (role === "influencer") return to === "submitted";
  return false; // 브랜드는 단계를 직접 움직이지 않는다 — 의견만 남긴다.
}

export type CollabRole = "manager" | "brand" | "influencer";

/** 이 사람이 이 협업에서 어떤 역할인지. 담당자 여부는 호출부가 먼저 판정해 넘긴다. */
export function roleInCollab(
  collab: { business_username?: string; creator_username?: string },
  username: string,
  isManager: boolean,
): CollabRole | null {
  if (isManager) return "manager";
  const me = norm(username);
  if (!me) return null;
  if (norm(collab.creator_username) === me) return "influencer";
  if (norm(collab.business_username) === me) return "brand";
  return null;
}

export const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

// ---------------------------------------------------------------------------
// 이벤트 원장
// ---------------------------------------------------------------------------

export type CollabEventInput = {
  collabId: string;
  type: string;
  actorRole?: string;
  actorUsername?: string;
  stageKey?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

export function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 상태 변화를 원장에 남긴다. 실패해도 본 작업을 되돌리지 않는다 — 기록이 빠지는
 * 것보다 상태 변경 자체가 막히는 쪽이 사용자에게 더 나쁘다. 대신 로그를 남겨
 * 누락을 나중에 찾을 수 있게 한다.
 */
export async function logCollabEvent(db: any, input: CollabEventInput): Promise<string | null> {
  const id = newId("ce");
  try {
    await db.sql`
      INSERT INTO collab_events (id, collab_id, type, actor_role, actor_username, stage_key, summary, payload)
      VALUES (
        ${id},
        ${input.collabId},
        ${input.type},
        ${input.actorRole || ""},
        ${norm(input.actorUsername)},
        ${input.stageKey || ""},
        ${input.summary || ""},
        ${JSON.stringify(input.payload || {})}
      )
    `;
    return id;
  } catch (err) {
    console.error("[collab-workflow] 이벤트 기록 실패:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 담당자 채널
// ---------------------------------------------------------------------------

const TIMELINE_STORE = "timelines";

export type SupportChannelKind = "influencer_support" | "brand_support";

/** 담당자 채널의 대화방 ID. 기존 브랜드↔인플루언서 방과 겹치지 않는 접두사를 쓴다. */
export function supportThreadId(kind: SupportChannelKind, collabId: string): string {
  return kind === "influencer_support" ? `support_inf_${collabId}` : `support_biz_${collabId}`;
}

export type EnsureThreadInput = {
  db: any;
  kind: SupportChannelKind;
  collabId: string;
  counterpartUsername: string;
  managerUsername: string;
  companyName: string;
  title: string;
  firstMessage?: string;
};

/**
 * 담당자 채널을 만든다. 저장은 기존 타임라인과 같은 자리(Blobs + SQL 미러)를 쓴다 —
 * 대화 UI 와 읽음 표시, 첨부, 알림을 그대로 재사용할 수 있기 때문이다.
 *
 * 브랜드 채널에는 influencer_username 을, 인플루언서 채널에는 business_username 을
 * 비워 둔다. 그래야 각 채널에서 상대편 당사자가 열 수 없다 — 담당자가 중간에
 * 있다는 구조가 권한으로도 표현돼야 의미가 있다.
 */
export async function ensureSupportThread(input: EnsureThreadInput): Promise<string> {
  const { db, kind, collabId, counterpartUsername, managerUsername, companyName, title } = input;
  const proposalId = supportThreadId(kind, collabId);
  const nowISO = new Date().toISOString();
  const influencerUsername = kind === "influencer_support" ? norm(counterpartUsername) : "";
  const businessUsername = kind === "brand_support" ? norm(counterpartUsername) : "";

  const firstComment = input.firstMessage
    ? {
        id: newId("tc"),
        proposalId,
        authorType: "manager",
        authorName: "픽스폴리오 담당자",
        authorUsername: norm(managerUsername) || "picksfolio",
        content: input.firstMessage,
        createdAt: nowISO,
        readBy: [norm(managerUsername) || "picksfolio"],
      }
    : null;

  await mutateBlobJSON<any>(TIMELINE_STORE, `detail_${proposalId}`, (current) => {
    if (current) return null; // 이미 있으면 건드리지 않는다.
    return {
      proposalId,
      kind,
      collabId,
      influencerUsername,
      businessUsername,
      managerUsername: norm(managerUsername),
      companyName,
      proposalTitle: title,
      comments: firstComment ? [firstComment] : [],
      createdAt: nowISO,
    };
  });

  const indexEntry = {
    proposalId,
    kind,
    collabId,
    influencerUsername,
    businessUsername,
    managerUsername: norm(managerUsername),
    companyName,
    proposalTitle: title,
    createdAt: nowISO,
  };

  const ensureIndex = async (type: string, username: string) => {
    if (!username) return;
    await mutateBlobJSON<any[]>(TIMELINE_STORE, `index_${type}_${username}`, (current) => {
      const list = Array.isArray(current) ? current : [];
      if (list.some((t: any) => t?.proposalId === proposalId)) return null;
      return [indexEntry, ...list];
    });
  };

  await ensureIndex(kind === "influencer_support" ? "influencer" : "business", norm(counterpartUsername));
  await ensureIndex("manager", norm(managerUsername));

  try {
    await db.sql`
      INSERT INTO timelines (proposal_id, influencer_username, business_username, company_name, proposal_title, created_at, kind, manager_username, collab_id)
      VALUES (${proposalId}, ${influencerUsername}, ${businessUsername}, ${companyName}, ${title}, ${nowISO}, ${kind}, ${norm(managerUsername)}, ${collabId})
      ON CONFLICT (proposal_id) DO UPDATE
        SET manager_username = EXCLUDED.manager_username,
            kind = EXCLUDED.kind,
            collab_id = EXCLUDED.collab_id
    `;
    if (firstComment) {
      await db.sql`
        INSERT INTO timeline_messages (id, proposal_id, author_type, author_name, author_username, content, read_by, created_at)
        VALUES (${firstComment.id}, ${proposalId}, ${firstComment.authorType}, ${firstComment.authorName}, ${firstComment.authorUsername}, ${firstComment.content}, ${firstComment.readBy}, ${nowISO})
        ON CONFLICT (id) DO NOTHING
      `;
    }
  } catch (err) {
    console.error("[collab-workflow] 담당자 채널 SQL 저장 실패:", err);
  }

  return proposalId;
}

/** 담당자가 바뀌면 채널의 담당자 표기도 따라가야 한다(대화 내용은 유지). */
export async function reassignSupportThreads(db: any, collabId: string, managerUsername: string) {
  const manager = norm(managerUsername);
  for (const kind of ["influencer_support", "brand_support"] as SupportChannelKind[]) {
    const proposalId = supportThreadId(kind, collabId);
    await mutateBlobJSON<any>(TIMELINE_STORE, `detail_${proposalId}`, (current) => {
      if (!current || current.managerUsername === manager) return null;
      return { ...current, managerUsername: manager };
    });
  }
  try {
    await db.sql`UPDATE timelines SET manager_username = ${manager} WHERE collab_id = ${collabId}`;
  } catch (err) {
    console.error("[collab-workflow] 담당자 채널 재배정 실패:", err);
  }
}

// ---------------------------------------------------------------------------
// 협업 생성
// ---------------------------------------------------------------------------

export type CreateCollabInput = {
  db: any;
  campaignId: string;
  applicationId: string;
  campaignType?: string | null;
  /**
   * 캠페인의 패키지 등급(full / lite / seeding). 어떤 검수를 거치는지가 여기서
   * 정해지므로 협업 단계를 만들 때 반드시 함께 넘겨야 한다. 넘기지 않으면
   * 풀패키지로 보고 대본 단계까지 생긴다 — 시딩 캠페인에는 없어야 하는 단계다.
   */
  packageTier?: string | null;
  campaignTitle: string;
  companyName: string;
  businessUsername: string;
  creatorUsername: string;
  managerUsername: string;
  rewardType?: string | null;
  fee?: number;
  startDate?: string | null;
  /**
   * 캠페인 등록 때 브랜드가 적어 둔 브리프. 조건 초안에 그대로 심어 둔다 —
   * 담당자가 선정 직후 "제품이 뭔가요, 어느 채널인가요"를 다시 묻지 않아도 되고,
   * 확정 전에 무엇이 브랜드의 원래 요청이었는지 대조할 수 있다.
   */
  brief?: {
    productName?: string | null;
    productUrl?: string | null;
    uploadChannel?: string | null;
    contentFormat?: string | null;
    videoConcept?: string | null;
    guideUrl?: string | null;
    guideNote?: string | null;
    secondUseFee?: number | null;
    secondUseNote?: string | null;
    uploadFrom?: string | null;
    uploadTo?: string | null;
  };
};

export type CreatedCollab = {
  id: string;
  templateKey: string;
  firstStageKey: string;
  influencerThreadId: string;
  brandThreadId: string;
  created: boolean;
};

/**
 * 지원이 선정되면 협업 1건을 실제 데이터로 만든다.
 *
 * 지금까지 `campaign_collabs` 표는 존재만 하고 아무도 쓰지 않았다(캠페인 삭제 시
 * 정리 대상으로만 등장했다). 그래서 "선정됐다" 이후의 상태를 담을 곳이 없었고,
 * 진행 상황은 대화 내용을 사람이 읽어야만 알 수 있었다. 여기서 협업 본체와 단계,
 * 조건 초안, 담당자 채널 두 개를 한꺼번에 만든다.
 *
 * 이미 있으면(재수락, 중복 호출) 그대로 두고 created=false 로 알린다.
 */
export async function createCollabForApplication(input: CreateCollabInput): Promise<CreatedCollab> {
  const { db } = input;
  const businessUsername = norm(input.businessUsername);
  const creatorUsername = norm(input.creatorUsername);
  const managerUsername = norm(input.managerUsername);
  const template = templateForCampaignType(input.campaignType, input.packageTier);
  const startKey = (input.startDate && /^\d{4}-\d{2}-\d{2}/.test(String(input.startDate)))
    ? String(input.startDate).slice(0, 10)
    : todayInSeoul();

  const existing = await db.sql`
    SELECT id, template_key, current_stage_key FROM campaign_collabs
    WHERE campaign_id = ${input.campaignId} AND creator_username = ${creatorUsername}
  `;
  const existingRow = (existing as any[])?.[0];

  const collabId = existingRow?.id || newId("clb");
  const proposalId = `campaign_${input.campaignId}_${creatorUsername}`;

  if (existingRow) {
    // 담당자만 갈아끼우고 나머지는 유지한다.
    await db.sql`
      UPDATE campaign_collabs
      SET manager_username = ${managerUsername}, updated_at = NOW()
      WHERE id = ${collabId}
    `;
    await reassignSupportThreads(db, collabId, managerUsername);
    return {
      id: collabId,
      templateKey: existingRow.template_key || template.key,
      firstStageKey: existingRow.current_stage_key || template.stages[0].key,
      influencerThreadId: supportThreadId("influencer_support", collabId),
      brandThreadId: supportThreadId("brand_support", collabId),
      created: false,
    };
  }

  await db.sql`
    INSERT INTO campaign_collabs (
      id, campaign_id, application_id, business_username, creator_username,
      status, manager_username, campaign_title, company_name, campaign_type,
      template_key, current_stage_key, proposal_id
    ) VALUES (
      ${collabId}, ${input.campaignId}, ${input.applicationId}, ${businessUsername}, ${creatorUsername},
      'in_progress', ${managerUsername}, ${input.campaignTitle}, ${input.companyName}, ${String(input.campaignType || "")},
      ${template.key}, ${template.stages[0].key}, ${proposalId}
    )
    ON CONFLICT (campaign_id, creator_username) DO NOTHING
  `;

  // 단계 복사. 첫 단계만 active, 나머지는 pending 으로 둔다 — 앞 단계가 끝나기 전에
  // 뒷 단계가 열려 있으면 순서가 있다는 사실이 화면에서 사라진다.
  for (let i = 0; i < template.stages.length; i += 1) {
    const stage = template.stages[i];
    await db.sql`
      INSERT INTO collab_stages (id, collab_id, stage_key, seq, title, owner_role, status, due_date, started_at, note)
      VALUES (
        ${newId("cs")}, ${collabId}, ${stage.key}, ${i + 1}, ${stage.title}, ${stage.owner},
        ${i === 0 ? "active" : "pending"},
        ${addDays(startKey, stage.dueOffsetDays)},
        ${i === 0 ? new Date().toISOString() : null},
        ${stage.hint || ""}
      )
      ON CONFLICT (collab_id, stage_key) DO NOTHING
    `;
  }

  const scriptStage = template.stages.find((s) => s.deliverable === "script");
  const contentStage = template.stages.find((s) => s.deliverable === "content");
  const uploadStage = template.stages.find((s) => s.deliverable === "upload");

  const brief = input.brief || {};
  const dateKey = (raw: unknown) => {
    const key = String(raw || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
  };
  // 브랜드가 희망 게시일을 적었으면 그 시작일이 업로드 마감이다. 템플릿의 기본
  // 오프셋(시작 +17일)이 희망일을 넘어서면 약속이 처음부터 깨진 상태로 시작한다.
  const uploadDue =
    dateKey(brief.uploadFrom)
    || (uploadStage ? addDays(startKey, uploadStage.dueOffsetDays) : "");
  const deliverableSpec = {
    productName: String(brief.productName || ""),
    productUrl: String(brief.productUrl || ""),
    uploadChannel: String(brief.uploadChannel || ""),
    contentFormat: String(brief.contentFormat || ""),
    videoConcept: String(brief.videoConcept || ""),
    secondUseFee: Math.max(0, Math.floor(Number(brief.secondUseFee || 0))),
    secondUseNote: String(brief.secondUseNote || ""),
    uploadFrom: dateKey(brief.uploadFrom),
    uploadTo: dateKey(brief.uploadTo),
  };

  await db.sql`
    INSERT INTO collab_terms (
      collab_id, fee, reward_type, script_due, content_due, upload_due,
      deliverable_spec, guide_url, guide_note
    )
    VALUES (
      ${collabId},
      ${Math.max(0, Math.floor(Number(input.fee || 0)))},
      ${String(input.rewardType || "")},
      ${scriptStage ? addDays(startKey, scriptStage.dueOffsetDays) : ""},
      ${contentStage ? addDays(startKey, contentStage.dueOffsetDays) : ""},
      ${uploadDue},
      ${JSON.stringify(deliverableSpec)},
      ${String(brief.guideUrl || "")},
      ${String(brief.guideNote || "")}
    )
    ON CONFLICT (collab_id) DO NOTHING
  `;

  // 업로드 단계 마감도 같은 날짜로 맞춘다 — 조건과 단계가 다른 날을 가리키면
  // 어느 쪽이 약속인지 알 수 없게 된다.
  if (uploadStage && uploadDue) {
    await db.sql`
      UPDATE collab_stages SET due_date = ${uploadDue}, updated_at = NOW()
      WHERE collab_id = ${collabId} AND stage_key = ${uploadStage.key}
    `;
  }

  const influencerThreadId = await ensureSupportThread({
    db,
    kind: "influencer_support",
    collabId,
    counterpartUsername: creatorUsername,
    managerUsername,
    companyName: input.companyName,
    title: input.campaignTitle,
    firstMessage:
      `"${input.campaignTitle}" 캠페인에 선정되셨습니다. 지금부터 진행은 픽스폴리오 담당자가 함께 챙깁니다.\n` +
      `단계별 할 일과 마감일은 협업 화면에서 확인하실 수 있고, 궁금한 점은 여기로 편하게 남겨 주세요.`,
  });

  const brandThreadId = await ensureSupportThread({
    db,
    kind: "brand_support",
    collabId,
    counterpartUsername: businessUsername,
    managerUsername,
    companyName: input.companyName,
    title: input.campaignTitle,
    firstMessage:
      `"${input.campaignTitle}" 캠페인에 ${creatorUsername} 크리에이터를 선정했습니다.\n` +
      `진행 상황은 협업 현황에서 단계별로 확인하실 수 있고, 수정 요청이나 의견은 여기로 남겨 주시면 담당자가 정리해 전달합니다.`,
  });

  await logCollabEvent(db, {
    collabId,
    type: "collab_created",
    actorRole: "manager",
    actorUsername: managerUsername,
    stageKey: template.stages[0].key,
    summary: `${input.campaignTitle} 협업 시작`,
    payload: { templateKey: template.key, creatorUsername, businessUsername },
  });

  return {
    id: collabId,
    templateKey: template.key,
    firstStageKey: template.stages[0].key,
    influencerThreadId,
    brandThreadId,
    created: true,
  };
}

/** 협업 진행률(완료 단계 / 전체 단계). 목록 화면에서 한 줄로 보여줄 값. */
export function progressOf(stages: { status: string }[]): number {
  if (!stages.length) return 0;
  const done = stages.filter((s) => s.status === "done" || s.status === "skipped").length;
  return Math.round((done / stages.length) * 100);
}

/** 첨부 저장 위치는 기존 타임라인과 같은 스토어를 쓴다. */
export const timelineStore = () => getStore(TIMELINE_STORE);
