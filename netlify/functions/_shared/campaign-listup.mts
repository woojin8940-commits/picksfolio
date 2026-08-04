import { getStore } from "@netlify/blobs";
import {
  addDays,
  createCollabForApplication,
  logCollabEvent,
  newId,
  norm,
  templateForCampaignType,
} from "./collab-workflow.mts";
import { todayInSeoul } from "./campaign-recruit.mts";

/**
 * 리스트업(후보 제안) 공용 로직.
 *
 * 흐름은 한 방향이다.
 *
 *   담당자가 명단에 올림 → 브랜드가 고름(pick) → 담당자가 조건을 담아 제안 발송
 *   → 인플루언서가 수락/거절 → 수락이면 협업 생성
 *
 * 화면 세 개(브랜드·담당자·인플루언서)가 같은 행을 다른 각도로 본다. 그래서
 * 행을 화면용으로 바꾸는 일과 수락 처리를 여기 한 곳에 둔다 — 세 API 가 각자
 * 매핑을 들고 있으면 상태 이름이 조금씩 어긋나기 시작한다.
 */

export const BRAND_DECISIONS = ["pending", "pick", "pass"] as const;
export const OUTREACH_STATUSES = ["not_sent", "sent", "accepted", "declined", "expired"] as const;

export type ListupOffer = {
  fee: number;
  secondUseFee: number;
  startDate: string;
  scriptDue: string;
  contentDue: string;
  uploadFrom: string;
  uploadTo: string;
  uploadChannel: string;
  contentFormat: string;
  videoConcept: string;
  guideUrl: string;
  guideNote: string;
  note: string;
  respondBy: string;
};

const dateKey = (raw: unknown) => {
  const key = String(raw ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
};

const money = (raw: unknown) => {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  const n = digits ? Number(digits) : Number(raw ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/**
 * 제안 조건을 정규화한다.
 *
 * 담당자가 폼에서 보내는 값은 문자열("1,500,000")과 숫자가 섞이고, 날짜는 비어
 * 있을 수 있다. 여기서 한 번 정리해 두면 수락 시점에 조건을 그대로 협업 조건으로
 * 옮겨 담을 수 있다 — 수락 후에 다시 사람이 옮겨 적으면 그때 값이 틀어진다.
 */
export function normalizeOffer(raw: any): ListupOffer {
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    fee: money(o.fee),
    secondUseFee: money(o.secondUseFee),
    startDate: dateKey(o.startDate),
    scriptDue: dateKey(o.scriptDue),
    contentDue: dateKey(o.contentDue),
    uploadFrom: dateKey(o.uploadFrom),
    uploadTo: dateKey(o.uploadTo),
    uploadChannel: String(o.uploadChannel || ""),
    contentFormat: String(o.contentFormat || ""),
    videoConcept: String(o.videoConcept || ""),
    guideUrl: String(o.guideUrl || ""),
    guideNote: String(o.guideNote || ""),
    note: String(o.note || ""),
    respondBy: dateKey(o.respondBy),
  };
}

export type ListupQuote = {
  fee: number;
  secondUseFee: number;
  guaranteedViews: number;
  badge: string;
  profileLine: string;
};

export type ListupPayout = { fee: number; secondUseFee: number };

/**
 * 인플루언서에게 지급할 금액. 견적(브랜드에게 제시할 금액)과 쌍으로 적는다.
 *
 * 우리 수익은 이 둘의 차액이다 — 단가 100만원인 사람을 110만원으로 넘기면 10만원이
 * 우리 몫이다. 그래서 지급액을 제안을 보내는 시점까지 미뤄 두면, 명단을 만든 담당자도
 * 운영자도 그 명단이 남기는 수익을 모른 채 브랜드에게 금액을 제시하게 된다.
 *
 * 저장 위치를 새로 만들지 않고 offer.fee 를 그대로 쓴다. 제안을 보낼 때 인플루언서가
 * 받는 금액이 바로 이 값이므로, 따로 칸을 만들면 두 값이 어긋날 자리가 생긴다.
 */
export function normalizePayout(raw: any): ListupPayout {
  const p = raw && typeof raw === "object" ? raw : {};
  return { fee: money(p.fee), secondUseFee: money(p.secondUseFee) };
}

/**
 * 지급액을 제안 초안에 합친다. 일정·가이드처럼 이미 적어 둔 값은 건드리지 않는다.
 * 아직 보내지 않은 제안에만 쓴다 — 보낸 뒤에 금액이 바뀌면 인플루언서가 본 조건과
 * 우리 기록이 달라진다.
 */
export function mergePayoutIntoOffer(existing: any, payout: ListupPayout): ListupOffer {
  return normalizeOffer({
    ...normalizeOffer(existing),
    fee: payout.fee,
    secondUseFee: payout.secondUseFee,
  });
}

/**
 * 브랜드에게 보여 줄 견적을 정규화한다.
 *
 * 제안 조건(offer)과 나눠 둔 이유는 시점이다. offer 는 브랜드가 고른 뒤 담당자가
 * 인플루언서에게 보내는 최종 조건이고, 여기 견적은 브랜드가 고르기 *전에* 카드에
 * 찍히는 숫자다. 브랜드가 광고비와 보장 조회수를 보고 고르는데 그 값이 고른 뒤에야
 * 생기면 순서가 뒤집힌다.
 *
 * CPV 는 담지 않는다. 광고비와 보장 조회수에서 나오는 값이라 따로 저장하면 둘 중
 * 하나만 고쳤을 때 조용히 어긋난다.
 */
export function normalizeQuote(raw: any): ListupQuote {
  const q = raw && typeof raw === "object" ? raw : {};
  return {
    fee: money(q.fee),
    secondUseFee: money(q.secondUseFee),
    guaranteedViews: money(q.guaranteedViews),
    badge: String(q.badge || "").trim().slice(0, 20),
    profileLine: String(q.profileLine || "").trim().slice(0, 60),
  };
}

/** 캠페인 브리프를 제안 초안으로 옮긴다. 담당자는 이 초안을 고쳐서 보낸다. */
export function offerFromCampaign(campaign: any): ListupOffer {
  return normalizeOffer({
    fee: campaign?.reward_amount,
    secondUseFee: campaign?.second_use_fee,
    startDate: campaign?.start_date,
    uploadFrom: campaign?.upload_from,
    uploadTo: campaign?.upload_to,
    uploadChannel: campaign?.upload_channel,
    contentFormat: campaign?.content_format,
    videoConcept: campaign?.video_concept,
    guideUrl: campaign?.guideline_url,
    guideNote: campaign?.guideline_note,
  });
}

export type ChannelSnapshot = {
  instagramHandle: string;
  instagramUrl: string;
  followers: number;
  following: number;
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  reelsCount: number;
  /** 'self' = 인플루언서 자기 입력, 'meta_api' = 메타 API 응답, '' = 등록 없음 */
  metricsSource: string;
  connected: boolean;
  recentReels: any[];
  syncedAt: string;
  intro: string;
  categories: string;
  /** 협업 매칭 등록서에 적어 둔 단가 표기 */
  adPrice: string;
  postPrice: string;
  shortPrice: string;
  name: string;
  syncedFrom: string;
};

const emptySnapshot = (): ChannelSnapshot => ({
  instagramHandle: "",
  instagramUrl: "",
  followers: 0,
  following: 0,
  avgViews: 0,
  avgLikes: 0,
  avgComments: 0,
  reelsCount: 0,
  metricsSource: "",
  connected: false,
  recentReels: [],
  syncedAt: "",
  intro: "",
  categories: "",
  adPrice: "",
  postPrice: "",
  shortPrice: "",
  name: "",
  syncedFrom: "",
});

/** creator_channels 행을 화면·스냅샷 공용 모양으로. */
export function shapeChannel(row: any): ChannelSnapshot {
  const base = emptySnapshot();
  if (!row) return base;
  return {
    ...base,
    instagramHandle: row.instagram_handle || "",
    instagramUrl: row.instagram_url || "",
    followers: Number(row.followers || 0),
    following: Number(row.following || 0),
    avgViews: Number(row.avg_views || 0),
    avgLikes: Number(row.avg_likes || 0),
    avgComments: Number(row.avg_comments || 0),
    reelsCount: Number(row.reels_count || 0),
    metricsSource: row.metrics_source || "self",
    connected: !!row.connected,
    recentReels: Array.isArray(row.recent_reels) ? row.recent_reels : [],
    syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : "",
    intro: row.intro || "",
    categories: row.categories || "",
  };
}

/**
 * 명단에 올릴 순간의 인플루언서 채널 지표를 모은다.
 *
 * 두 곳을 본다. 인플루언서가 직접 등록한 채널 정보(creator_channels)가 우선이고,
 * 없으면 협업 매칭 등록서(collab_directory_applications)에 적어 둔 값으로 채운다.
 * 어느 쪽에서 온 값인지 syncedFrom 에 남겨 두는 이유는, 브랜드 화면이 "본인 등록"과
 * "우리가 받아 둔 지원서"를 다르게 표시해야 하기 때문이다.
 */
export async function buildSnapshot(
  db: any,
  username: string,
): Promise<ChannelSnapshot> {
  const uname = norm(username);
  const map = await buildSnapshots(db, [uname]);
  return map.get(uname) || emptySnapshot();
}

/** 채널 행 + 등록서 행을 하나의 스냅샷으로 겹친다. 합치는 규칙은 여기 한 군데만 둔다. */
function mergeSnapshot(channel: any, dir: any): ChannelSnapshot {
  const snap = shapeChannel(channel);

  if (dir) {
    snap.name = dir.name || "";
    snap.adPrice = dir.ad_price || "";
    snap.postPrice = dir.post_price || "";
    snap.shortPrice = dir.short_price || "";
    if (!snap.instagramUrl) snap.instagramUrl = dir.instagram_url || "";
    if (!snap.categories) snap.categories = dir.category || "";
    if (!snap.followers) {
      snap.followers = Number(dir.instagram_followers || dir.follower_count || 0);
    }
  }

  snap.syncedFrom = channel ? "creator" : dir ? "directory" : "";
  return snap;
}

/**
 * 여러 사람의 스냅샷을 한 번에 모은다.
 *
 * 지원자 목록처럼 사람이 수십 명 나오는 화면이 buildSnapshot 을 사람마다 부르면
 * 쿼리가 인원수의 두 배로 늘어난다. 목록에서 보는 숫자와 명단에 올릴 때 굳는 숫자가
 * 어긋나면 안 되므로, 겹치는 규칙(mergeSnapshot)은 그대로 쓰고 조회만 한 번에 한다.
 */
export async function buildSnapshots(
  db: any,
  usernames: string[],
): Promise<Map<string, ChannelSnapshot>> {
  const names = Array.from(new Set((usernames || []).map((u) => norm(u)).filter(Boolean)));
  const out = new Map<string, ChannelSnapshot>();
  if (!names.length) return out;

  const [channelRows, dirRows] = await Promise.all([
    db.sql`SELECT * FROM creator_channels WHERE username = ANY(${names})` as Promise<any[]>,
    // 등록서는 사람마다 여러 장일 수 있다. 가장 최근 것만 본다(단건 조회의 LIMIT 1 과 같은 규칙).
    db.sql`
      SELECT DISTINCT ON (applicant_username) *
      FROM collab_directory_applications
      WHERE role = 'influencer' AND applicant_username = ANY(${names})
      ORDER BY applicant_username, created_at DESC
    ` as Promise<any[]>,
  ]);

  const channelBy = new Map<string, any>();
  for (const row of (channelRows as any[]) || []) channelBy.set(norm(row.username), row);
  const dirBy = new Map<string, any>();
  for (const row of (dirRows as any[]) || []) dirBy.set(norm(row.applicant_username), row);

  for (const name of names) {
    out.set(name, mergeSnapshot(channelBy.get(name), dirBy.get(name)));
  }
  return out;
}

/** campaign_listups 행 → 화면용. 인플루언서에게는 다른 후보 이야기가 가지 않는다. */
export function shapeListup(row: any, viewer: "manager" | "brand" | "influencer") {
  const snapshot = (row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {}) as any;
  const offer = normalizeOffer(row.offer);
  const quotedFee = Number(row.quoted_fee || 0);
  const guaranteedViews = Number(row.guaranteed_views || 0);
  const base = {
    id: row.id,
    campaignId: row.campaign_id,
    influencerUsername: row.influencer_username,
    source: row.source || "manager",
    snapshot,
    snapshotAt: row.snapshot_at || null,
    managerNote: row.manager_note || "",
    brandDecision: row.brand_decision || "pending",
    brandDecisionNote: row.brand_decision_note || "",
    brandDecidedAt: row.brand_decided_at || null,
    brandFavorite: !!row.brand_favorite,
    outreachStatus: row.outreach_status || "not_sent",
    offer,
    // 브랜드가 고르기 전에 보는 제시 조건. offer 와 다른 값이며 다른 시점에 적힌다.
    quotedFee,
    quotedSecondUseFee: Number(row.quoted_second_use_fee || 0),
    guaranteedViews,
    // 조회수당 단가. 나눗셈을 화면마다 다시 하면 반올림이 어긋나므로 여기서 한 번만 한다.
    cpv: guaranteedViews > 0 && quotedFee > 0 ? Math.round(quotedFee / guaranteedViews) : 0,
    badge: row.badge || "",
    // 카드 이름 아래 한 줄. 비어 있으면 화면이 스냅샷의 카테고리로 되돌아간다.
    profileLine: row.profile_line || "",
    offerSentAt: row.offer_sent_at || null,
    respondedAt: row.responded_at || null,
    responseNote: row.response_note || "",
    collabId: row.collab_id || "",
    createdAt: row.created_at,
  };

  if (viewer === "influencer") {
    // 제안을 받은 사람에게는 "누가 왜 나를 골랐는지"의 내부 기록이 아니라
    // 결정에 필요한 것만 보낸다. 브랜드 메모와 다른 후보 정보는 내부 자료다.
    return {
      id: base.id,
      campaignId: base.campaignId,
      offer: base.offer,
      outreachStatus: base.outreachStatus,
      offerSentAt: base.offerSentAt,
      respondedAt: base.respondedAt,
      responseNote: base.responseNote,
      collabId: base.collabId,
      createdAt: base.createdAt,
      campaignTitle: row.campaign_title || "",
      brandName: row.brand_name || "",
      campaignType: row.campaign_type || "",
      description: row.description || "",
      productName: row.product_name || "",
      managerUsername: row.manager_username || "",
    };
  }

  const payoutFee = Number(offer.fee || 0);
  const payoutSecondUseFee = Number(offer.secondUseFee || 0);
  const brandAmount = quotedFee + Number(row.quoted_second_use_fee || 0);
  const payoutAmount = payoutFee + payoutSecondUseFee;

  return {
    ...base,
    listedBy: row.listed_by || "",
    offerSentBy: row.offer_sent_by || "",
    ...(viewer === "brand"
      ? {
          // 계정 이름도 신원이다. 이름만 가리고 아이디를 남기면 가린 뜻이 없다.
          influencerUsername: base.outreachStatus === "accepted" ? base.influencerUsername : "",
          snapshot: maskSnapshot(snapshot, base.outreachStatus),
          // 지급액은 브랜드에게 나가지 않는다. 브랜드가 제시가와 지급액을 나란히 보면
          // 우리 마진이 그대로 드러나고, 그 자리에서 값을 깎는 협상이 시작된다.
          offer: { ...offer, fee: 0, secondUseFee: 0 },
        }
      : {}),
    ...(viewer === "manager"
      ? {
          campaignTitle: row.campaign_title || "",
          brandName: row.brand_name || "",
          businessUsername: row.business_username || "",
          managerUsername: row.manager_username || "",
          // 인플루언서에게 줄 금액과 그 차액. 화면마다 다시 빼면 "제시가만 있고
          // 지급액이 빈 후보"를 마진 0원이 아니라 손해로 잘못 그리게 된다.
          payoutFee,
          payoutSecondUseFee,
          // 두 값이 모두 있을 때만 숫자를 준다. null 은 "아직 모름"이고 0 과 다르다.
          margin: brandAmount > 0 && payoutFee > 0 ? brandAmount - payoutAmount : null,
        }
      : {}),
  };
}

/**
 * 브랜드 화면에 나가는 후보의 신원을 가린다.
 *
 * 수락 전까지 브랜드는 계정 이름·인스타 주소·릴스 링크를 받지 않는다. 지표와
 * 영상 미리보기는 그대로 나가므로 고르는 데 필요한 판단 재료는 줄지 않는다.
 * 가리는 이유는 순서다. 브랜드가 명단만 받고 직접 연락하면 조건을 조율하는
 * 사람이 사라지고, 인플루언서는 담당자가 합의한 단가를 보장받지 못한다.
 *
 * 화면에서만 별표로 덮는 방식은 쓰지 않는다. 응답에 값이 실려 있으면 가린 것이
 * 아니다. 수락된 뒤에는 이미 협업이 시작된 사이이므로 그대로 내보낸다.
 */
function maskSnapshot(snapshot: any, outreachStatus: string) {
  if (outreachStatus === "accepted") return snapshot;
  const name = String(snapshot?.name || "");
  const reels = Array.isArray(snapshot?.recentReels) ? snapshot.recentReels : [];
  return {
    ...snapshot,
    name: maskName(name),
    username: "",
    instagramHandle: "",
    instagramUrl: "",
    recentReels: reels.map((r: any) => ({
      id: r?.id || "",
      thumbnailUrl: r?.thumbnailUrl || "",
      views: Number(r?.views || 0),
    })),
  };
}

/** "김하실" → "**실". 마지막 글자만 남긴다 — 부르는 이름은 있어야 대화가 된다. */
function maskName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (trimmed.length === 1) return "*";
  return "*".repeat(trimmed.length - 1) + trimmed.slice(-1);
}

/**
 * 인플루언서의 제안 목록과 브랜드 수신함에 협업을 노출한다.
 *
 * 대화는 담당자 채널로 가지만, 양쪽의 기존 목록 화면은 Blobs 의 제안 배열을
 * 읽는다. 협업이 생겼는데 목록에 없으면 "선정됐다는데 아무것도 없다"가 된다.
 */
export async function mirrorCollabProposal(input: {
  collabId: string;
  campaignId: string;
  campaignType?: string | null;
  campaignTitle: string;
  description?: string | null;
  companyName: string;
  businessUsername: string;
  creatorUsername: string;
  managerUsername: string;
  startDate?: string | null;
  endDate?: string | null;
  fee: number;
}): Promise<string> {
  const creatorUsername = norm(input.creatorUsername);
  const businessUsername = norm(input.businessUsername);
  const nowISO = new Date().toISOString();
  const proposalId = `campaign_${input.campaignId}_${creatorUsername}`;
  const entry = {
    id: proposalId,
    collab_id: input.collabId,
    influencer_username: creatorUsername,
    category: input.campaignType === "group_buy" ? "커머스" : "광고",
    company_name: input.companyName || "",
    contact_person: "픽스폴리오 담당자",
    contact_email: "",
    contact_phone: "",
    title: input.campaignTitle || "",
    content: input.description || "",
    start_date: input.startDate || "",
    end_date: input.endDate || "",
    fee: input.fee,
    revenue_share: 0,
    reference_links: [],
    attachments: [],
    business_username: businessUsername,
    manager_username: norm(input.managerUsername),
    status: "accepted",
    created_at: nowISO,
    updated_at: nowISO,
    createdAt: nowISO,
    updatedAt: nowISO,
  };

  try {
    const store = getStore("proposals");
    const key = `proposals_${creatorUsername}`;
    const existing = ((await store.get(key, { type: "json" })) as any[]) || [];
    if (!existing.some((p: any) => p.id === proposalId)) {
      existing.push(entry);
      await store.setJSON(key, existing);
    }
  } catch (e) {
    console.error("[listup] 인플루언서 제안 목록 반영 실패:", e);
  }

  try {
    const store = getStore("business-proposals");
    const key = `biz_proposals_${businessUsername}`;
    const existing = ((await store.get(key, { type: "json" })) as any[]) || [];
    if (!existing.some((p: any) => p.id === proposalId)) {
      existing.push(entry);
      await store.setJSON(key, existing);
    }
  } catch (e) {
    console.error("[listup] 브랜드 수신함 반영 실패:", e);
  }

  return proposalId;
}

/**
 * 제안 조건을 확정 조건과 단계 마감일에 옮겨 적는다.
 *
 * 협업은 캠페인 브리프 기준으로 만들어지므로, 담당자가 제안에서 조정한 금액과
 * 날짜(예: 단가를 올려서 합의한 경우)를 여기서 다시 덮어야 한다. 인플루언서가
 * 수락한 조건과 협업 화면에 적힌 조건이 다르면 그 협업은 첫날부터 신뢰를 잃는다.
 */
async function applyOfferToCollab(
  db: any,
  collabId: string,
  campaignType: string | null | undefined,
  packageTier: string | null | undefined,
  rewardMode: string | null | undefined,
  offer: ListupOffer,
) {
  const template = templateForCampaignType(campaignType, packageTier, rewardMode);
  const startKey = offer.startDate || todayInSeoul();
  const stageDue = (deliverable: string) => {
    const stage = template.stages.find((s) => s.deliverable === deliverable);
    return stage ? { key: stage.key, due: addDays(startKey, stage.dueOffsetDays) } : null;
  };

  const script = stageDue("script");
  const content = stageDue("content");
  const upload = stageDue("upload");

  const scriptDue = offer.scriptDue || script?.due || "";
  const contentDue = offer.contentDue || content?.due || "";
  const uploadDue = offer.uploadFrom || upload?.due || "";

  const termRows = await db.sql`
    SELECT deliverable_spec FROM collab_terms WHERE collab_id = ${collabId}
  `;
  const prevSpec = ((termRows as any[])?.[0]?.deliverable_spec || {}) as any;
  const spec = {
    ...(prevSpec && typeof prevSpec === "object" ? prevSpec : {}),
    uploadChannel: offer.uploadChannel || prevSpec?.uploadChannel || "",
    contentFormat: offer.contentFormat || prevSpec?.contentFormat || "",
    videoConcept: offer.videoConcept || prevSpec?.videoConcept || "",
    secondUseFee: offer.secondUseFee || Number(prevSpec?.secondUseFee || 0),
    uploadFrom: offer.uploadFrom || prevSpec?.uploadFrom || "",
    uploadTo: offer.uploadTo || prevSpec?.uploadTo || "",
    // 리스트업으로 합의한 조건임을 남긴다 — 나중에 "이 금액이 어디서 나왔나"를
    // 되짚을 때 근거가 된다.
    agreedVia: "listup",
  };

  await db.sql`
    UPDATE collab_terms
    SET fee = ${offer.fee || 0},
        script_due = ${scriptDue},
        content_due = ${contentDue},
        upload_due = ${uploadDue},
        deliverable_spec = ${JSON.stringify(spec)},
        guide_url = ${offer.guideUrl},
        guide_note = ${offer.guideNote},
        updated_at = NOW()
    WHERE collab_id = ${collabId}
  `;

  const pairs = [
    script && scriptDue ? { key: script.key, due: scriptDue } : null,
    content && contentDue ? { key: content.key, due: contentDue } : null,
    upload && uploadDue ? { key: upload.key, due: uploadDue } : null,
  ].filter(Boolean) as { key: string; due: string }[];

  for (const p of pairs) {
    await db.sql`
      UPDATE collab_stages SET due_date = ${p.due}, updated_at = NOW()
      WHERE collab_id = ${collabId} AND stage_key = ${p.key}
    `;
  }
}

export type AcceptResult = {
  collabId: string;
  applicationId: string;
  created: boolean;
  influencerThreadId: string;
  brandThreadId: string;
};

/**
 * 제안 수락 → 실제 계약(협업) 생성.
 *
 * campaign_collabs.application_id 는 NOT NULL 외래키다. 리스트업은 지원과 다른
 * 경로지만, 협업 한 건은 반드시 지원 행 하나에 매달려야 한다. 그래서 지원 행을
 * source='listup' 로 하나 만들어 두고 그 위에 협업을 세운다 — 외래키를 느슨하게
 * 바꾸는 대신 경로를 표시하는 쪽을 골랐다. 지원자 목록·통계·조인이 모두 그
 * 테이블을 보고 있어서, 여기에 행이 없으면 협업만 떠 있는 상태가 된다.
 */
export async function acceptListup(input: {
  db: any;
  listup: any;
  campaign: any;
  actorRole: "influencer" | "manager";
  actorUsername: string;
}): Promise<AcceptResult> {
  const { db, listup, campaign } = input;
  const creatorUsername = norm(listup.influencer_username);
  const businessUsername = norm(campaign.business_username);
  const managerUsername = norm(campaign.manager_username) || norm(listup.offer_sent_by);
  const offer = normalizeOffer(listup.offer);

  // 1) 지원 행 확보 (있으면 수락으로 승격)
  const existingApp = await db.sql`
    SELECT id FROM campaign_applications
    WHERE campaign_id = ${listup.campaign_id} AND applicant_username = ${creatorUsername}
  `;
  let applicationId = (existingApp as any[])?.[0]?.id as string | undefined;

  if (applicationId) {
    await db.sql`
      UPDATE campaign_applications
      SET status = 'accepted',
          decided_by = ${norm(input.actorUsername)},
          decided_at = NOW(),
          updated_at = NOW()
      WHERE id = ${applicationId}
    `;
  } else {
    applicationId = newId("app");
    const snapshot = (listup.snapshot && typeof listup.snapshot === "object" ? listup.snapshot : {}) as any;
    await db.sql`
      INSERT INTO campaign_applications (
        id, campaign_id, applicant_username, message, contact, portfolio_url,
        status, source, instagram_url, manager_note, decided_by, decided_at
      ) VALUES (
        ${applicationId}, ${listup.campaign_id}, ${creatorUsername},
        ${"리스트업 제안 수락"}, ${""}, ${""},
        'accepted', 'listup', ${String(snapshot.instagramUrl || "")},
        ${String(listup.manager_note || "")}, ${norm(input.actorUsername)}, NOW()
      )
      ON CONFLICT (campaign_id, applicant_username) DO UPDATE
        SET status = 'accepted', updated_at = NOW()
    `;
    const back = await db.sql`
      SELECT id FROM campaign_applications
      WHERE campaign_id = ${listup.campaign_id} AND applicant_username = ${creatorUsername}
    `;
    applicationId = ((back as any[])?.[0]?.id as string) || applicationId;
  }

  // 2) 협업 본체 + 단계 + 조건 초안 + 담당자 채널
  const collab = await createCollabForApplication({
    db,
    campaignId: listup.campaign_id,
    applicationId,
    campaignType: campaign.type,
    packageTier: campaign.package_tier,
    rewardMode: campaign.reward_mode,
    campaignTitle: campaign.title || "",
    companyName: campaign.brand_name || "",
    businessUsername,
    creatorUsername,
    managerUsername,
    rewardType: campaign.reward_type,
    fee: offer.fee,
    startDate: offer.startDate || campaign.start_date,
    brief: {
      productName: campaign.product_name,
      productUrl: campaign.product_url,
      uploadChannel: offer.uploadChannel || campaign.upload_channel,
      contentFormat: offer.contentFormat || campaign.content_format,
      videoConcept: offer.videoConcept || campaign.video_concept,
      guideUrl: offer.guideUrl || campaign.guideline_url,
      guideNote: offer.guideNote || campaign.guideline_note,
      secondUseFee: offer.secondUseFee || Number(campaign.second_use_fee || 0),
      secondUseNote: campaign.second_use_note,
      uploadFrom: offer.uploadFrom || campaign.upload_from,
      uploadTo: offer.uploadTo || campaign.upload_to,
    },
  });

  // 3) 합의한 조건으로 덮어쓰기 (금액·마감일)
  await applyOfferToCollab(db, collab.id, campaign.type, campaign.package_tier, campaign.reward_mode, offer);

  // 4) 양쪽 목록에 노출
  await mirrorCollabProposal({
    collabId: collab.id,
    campaignId: listup.campaign_id,
    campaignType: campaign.type,
    campaignTitle: campaign.title || "",
    description: campaign.description || "",
    companyName: campaign.brand_name || "",
    businessUsername,
    creatorUsername,
    managerUsername,
    startDate: offer.startDate || campaign.start_date || "",
    endDate: campaign.end_date || "",
    fee: offer.fee,
  });

  await logCollabEvent(db, {
    collabId: collab.id,
    type: "listup_accepted",
    actorRole: input.actorRole,
    actorUsername: norm(input.actorUsername),
    summary: `${creatorUsername} 리스트업 제안 수락`,
    payload: { listupId: listup.id, applicationId, fee: offer.fee },
  });

  return {
    collabId: collab.id,
    applicationId,
    created: collab.created,
    influencerThreadId: collab.influencerThreadId,
    brandThreadId: collab.brandThreadId,
  };
}
