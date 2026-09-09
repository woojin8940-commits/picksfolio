import { getDatabase } from "@picks/netlify-database";
import { normalizeRewardMode } from "./reward-mode.mts";

/**
 * 캠페인 AI 어시스턴트가 읽는 "이 캠페인 한 건"의 사실.
 *
 * 이 AI 가 하는 일은 하나다 — 열어 둔 캠페인의 기획안과 인스타 본문을 쓰고 고치는
 * 것. 그래서 읽는 범위도 그 캠페인 한 건으로 잘라 둔다. 인플루언서가 진행 중인 다른
 * 캠페인이나 담당자와의 대화는 싣지 않는다. 다른 캠페인의 제품과 가이드가 같은
 * 프롬프트에 섞여 있으면 기획안에 엉뚱한 브랜드의 필수 문구가 들어가고, 협업 대화까지
 * 실으면 "이 캠페인 기준으로 고쳐 달라"는 요청이 대화 전체를 훑는 일이 된다. 협업
 * 전체를 아는 AI 는 협업 타임라인 쪽에 그대로 있다.
 *
 * 담는 것은 다섯 덩어리다.
 *   1. 캠페인 브리프 — 제품, 채널, 형식, 브랜드가 원하는 컨셉, 일정
 *   2. 가이드라인 — 브랜드가 올린 필수 표기·요건(글)과 파일 주소
 *   3. 지금 기획안 — 장면별 설명·자막·나레이션 (고치라는 요청의 대상)
 *   4. 지금 본문 캡션
 *   5. 브랜드 피드백 — 어느 장면에 붙은 말인지까지
 *
 * 3·4·5 가 이 모듈의 핵심이다. "피드백대로 고쳐 줘"는 지금 무엇이 적혀 있고 브랜드가
 * 어디를 지적했는지를 모르면 답할 수 없는 요청이다.
 *
 * 읽기 전용이고, 조회 조건에 `creator_username` 을 함께 걸어 본인 협업만 본다.
 */

const oneLine = (raw: unknown, max = 220): string => {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

const dateOnly = (raw: unknown): string => {
  const s = String(raw ?? "");
  if (!s) return "";
  return s.length >= 10 ? s.slice(0, 10) : s;
};

const REWARD_MODE_LABEL: Record<string, string> = {
  paid: "광고비 지급형",
  barter: "제품 협찬형",
  groupbuy: "공동구매",
};

const STAGE_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  in_progress: "진행 중",
  submitted: "제출 · 브랜드 확인 대기",
  revision: "수정 요청 받음",
  done: "완료",
  completed: "완료",
  skipped: "생략",
};

/** 기획안 · 영상 단계의 예전 이름까지 같은 칸으로 끌어온다(화면의 STAGE_KEYS 와 같은 표). */
const PLAN_STAGE_KEYS = ["plan", "script", "script_review"];
const VIDEO_STAGE_KEYS = ["video", "content", "content_review"];

export interface CampaignScene {
  visual: string;
  subtitle: string;
  narration: string;
}

export interface GuideFileRef {
  url: string;
  fileName: string;
  fileType: string;
  from: string;
}

export interface CampaignFocusContext {
  /** 프롬프트에 그대로 붙일 문자열. */
  text: string;
  /** 브랜드가 올린 가이드라인 파일. 캠페인 등록분과 협업 자료함의 guide 파일을 합친 것. */
  guideRefs: GuideFileRef[];
  /** 지금 제출돼 있는 기획안. 없으면 빈 배열. */
  plan: { scenes: CampaignScene[]; body: string; version: number } | null;
  /** 지금 제출돼 있는 인스타 본문 캡션. */
  caption: string;
  campaignTitle: string;
}

const parseJsonish = (raw: unknown): any => {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
};

const normalizeScenes = (raw: unknown): CampaignScene[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    // 예전 제출물은 한 줄에 한 장면인 문자열 배열이었다(화면의 normalizeScenes 와 같은 규칙).
    if (typeof item === "string") return { visual: item, subtitle: "", narration: "" };
    const s = (item || {}) as Record<string, unknown>;
    return {
      visual: String(s.visual ?? s.text ?? ""),
      subtitle: String(s.subtitle ?? s.caption ?? ""),
      narration: String(s.narration ?? s.voice ?? ""),
    };
  });
};

const guidelineFileRefs = (raw: unknown, from: string): GuideFileRef[] => {
  const value = parseJsonish(raw);
  if (!Array.isArray(value)) return [];
  return value
    .filter((f) => f && typeof f === "object" && String((f as any).url || ""))
    .map((f: any) => ({
      url: String(f.url || ""),
      fileName: String(f.name || f.fileName || "가이드라인"),
      fileType: String(f.mimeType || f.fileType || ""),
      from,
    }));
};

/**
 * 캠페인 한 건의 사실을 프롬프트용 문자열로 만든다.
 *
 * @param username 인플루언서 아이디(소문자). 호출하는 쪽에서 본인 확인을 끝낸 뒤 넘긴다.
 * @param collabId 지금 화면에서 열어 둔 협업.
 * @returns 협업이 없거나 본인 것이 아니면 null.
 */
export async function buildCampaignFocusContext(
  username: string,
  collabId: string,
): Promise<CampaignFocusContext | null> {
  if (!username || !collabId) return null;

  const db = getDatabase();

  // 소유 확인을 조회 조건에 함께 건다. 화면이 보낸 collabId 는 사람이 고칠 수 있어서,
  // 이 조건이 없으면 남의 협업 아이디를 적어 그 캠페인의 기획안과 브랜드 피드백을
  // 답변으로 받아 갈 수 있다.
  const rows = (await db.sql`
    SELECT cc.id, cc.campaign_id, cc.campaign_title, cc.company_name, cc.status,
           cc.current_stage_key,
           c.title, c.brand_name, c.category, c.reward_mode,
           c.description, c.requirements, c.product_name, c.product_url,
           c.upload_channel, c.content_format, c.video_concept,
           c.guideline_note, c.guideline_url, c.guideline_files,
           c.second_use_fee, c.second_use_note, c.upload_from, c.upload_to
    FROM campaign_collabs cc
    LEFT JOIN campaigns c ON c.id = cc.campaign_id
    WHERE cc.id = ${collabId} AND cc.creator_username = ${username}
  `) as any[];

  const collab = rows?.[0];
  if (!collab) return null;

  const [termRows, stageRows, deliverableRows, feedbackRows, assetRows] = (await Promise.all([
    db.sql`
      SELECT fee, script_due, content_due, upload_due, guide_note, guide_url, locked_at
      FROM collab_terms WHERE collab_id = ${collabId}
    `,
    db.sql`
      SELECT stage_key, seq, title, owner_role, status, due_date
      FROM collab_stages WHERE collab_id = ${collabId} ORDER BY seq ASC
    `,
    db.sql`
      SELECT stage_key, kind, version, status, payload, created_at
      FROM collab_deliverables WHERE collab_id = ${collabId} ORDER BY version ASC
    `,
    db.sql`
      SELECT stage_key, anchor, body, status, author_type, created_at
      FROM collab_feedbacks
      WHERE collab_id = ${collabId} AND visible_to_influencer = TRUE
      ORDER BY created_at ASC
    `,
    db.sql`
      SELECT kind, title, file_name, file_url, mime_type
      FROM collab_assets WHERE collab_id = ${collabId} AND kind = 'guide' AND file_url <> ''
      ORDER BY created_at DESC
    `,
  ])) as any[][];

  const term = termRows?.[0] || null;
  const campaignTitle = String(collab.campaign_title || collab.title || "(제목 없음)");
  const brand = String(collab.company_name || collab.brand_name || "");
  const mode = normalizeRewardMode(collab.reward_mode);

  // 기획안 · 영상 제출물은 버전을 쌓는다 — 항상 마지막 것이 지금의 기획안이다.
  const lastOf = (keys: string[], kind: string) => {
    const matched = (deliverableRows || []).filter(
      (d) => keys.includes(String(d.stage_key)) || String(d.kind) === kind,
    );
    return matched.length ? matched[matched.length - 1] : null;
  };
  const planWork = lastOf(PLAN_STAGE_KEYS, "plan");
  const videoWork = lastOf(VIDEO_STAGE_KEYS, "video");

  const planPayload = parseJsonish(planWork?.payload) || {};
  const videoPayload = parseJsonish(videoWork?.payload) || {};
  let planScenes = normalizeScenes(planPayload.scenes);
  const planBody = String(planPayload.body || "");
  // 장면 없이 글상자로 낸 예전 기획안은 그 글을 장면 1의 설명으로 이어받는다.
  if (planScenes.length === 0 && planBody.trim()) {
    planScenes = [{ visual: planBody, subtitle: "", narration: "" }];
  }
  const caption = String(videoPayload.caption || "");

  // 가이드라인 파일은 두 곳에서 온다 — 캠페인 등록 때 올린 것과 협업 자료함의 guide
  // 파일. 화면(api-collab-workflow 의 guideline)과 같은 방식으로 합치고 중복을 뺀다.
  const guideRefs: GuideFileRef[] = [
    ...guidelineFileRefs(collab.guideline_files, `${brand || "브랜드"}(캠페인 가이드라인)`),
    ...(assetRows || []).map((a) => ({
      url: String(a.file_url),
      fileName: String(a.title || a.file_name || "가이드 파일"),
      fileType: String(a.mime_type || ""),
      from: `${brand || "브랜드"}(협업 가이드 파일)`,
    })),
  ].filter((f, i, all) => f.url && all.findIndex((x) => x.url === f.url) === i);

  const currentStage =
    (stageRows || []).find((s) => s.stage_key === collab.current_stage_key) ||
    (stageRows || []).find((s) => !["done", "skipped", "completed"].includes(String(s.status))) ||
    null;

  // ── 프롬프트 조립 ──────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`[이 캠페인]`);
  lines.push(`- 캠페인: ${campaignTitle}`);
  if (brand) lines.push(`- 브랜드: ${brand}`);
  lines.push(`- 진행 방식: ${REWARD_MODE_LABEL[mode] || mode}`);
  if (collab.category) lines.push(`- 카테고리: ${collab.category}`);
  if (collab.product_name) lines.push(`- 제품: ${oneLine(collab.product_name, 120)}`);
  if (collab.product_url) lines.push(`- 제품 링크: ${oneLine(collab.product_url, 160)}`);
  if (collab.upload_channel) lines.push(`- 업로드 채널: ${oneLine(collab.upload_channel, 60)}`);
  if (collab.content_format) lines.push(`- 콘텐츠 형식: ${oneLine(collab.content_format, 60)}`);
  if (currentStage) {
    lines.push(
      `- 현재 단계: ${currentStage.title}(${STAGE_STATUS_LABEL[currentStage.status] || currentStage.status}${
        currentStage.due_date ? `, 마감 ${currentStage.due_date}` : ""
      })`,
    );
  }
  const dues = [
    term?.script_due ? `기획안 ${dateOnly(term.script_due)}` : "",
    term?.content_due ? `콘텐츠 ${dateOnly(term.content_due)}` : "",
    term?.upload_due ? `업로드 ${dateOnly(term.upload_due)}` : "",
    collab.upload_from || collab.upload_to
      ? `희망 게시일 ${dateOnly(collab.upload_from) || "?"}~${dateOnly(collab.upload_to) || "?"}`
      : "",
  ].filter(Boolean);
  if (dues.length) lines.push(`- 일정: ${dues.join(" · ")}`);
  if (Number(collab.second_use_fee || 0) > 0 || collab.second_use_note) {
    lines.push(`- 2차 활용: ${oneLine(collab.second_use_note, 120) || "브랜드가 2차 활용을 요청한 캠페인"}`);
  }
  if (collab.video_concept) {
    lines.push(`- 브랜드가 원하는 영상 컨셉: ${oneLine(collab.video_concept, 600)}`);
  }
  if (collab.description) lines.push(`- 캠페인 설명: ${oneLine(collab.description, 500)}`);
  if (collab.requirements) lines.push(`- 지원 요건: ${oneLine(collab.requirements, 300)}`);

  lines.push("");
  lines.push("[브랜드 가이드라인]");
  const guideNote = String(collab.guideline_note || "").trim();
  const termGuideNote = String(term?.guide_note || "").trim();
  if (guideNote) lines.push(`- 필수 표기·요건(캠페인 가이드라인): ${oneLine(guideNote, 1600)}`);
  if (termGuideNote) lines.push(`- 담당자가 정리한 가이드: ${oneLine(termGuideNote, 600)}`);
  const guideUrl = String(term?.guide_url || collab.guideline_url || "").trim();
  if (guideUrl) lines.push(`- 가이드 링크: ${oneLine(guideUrl, 160)}`);
  if (guideRefs.length) {
    lines.push(
      `- 가이드라인 파일 ${guideRefs.length}개: ${guideRefs.map((f) => f.fileName).join(", ")}` +
        " (이 파일들은 이 요청에 함께 첨부되어 있습니다. 끝까지 읽고 그대로 반영하세요.)",
    );
  }
  if (!guideNote && !termGuideNote && !guideUrl && guideRefs.length === 0) {
    lines.push(
      "- 아직 올라온 가이드라인이 없습니다. 지어내지 말고, 일반적으로 확인해야 할 항목을 " +
        "'담당자 확인 필요'로 남기세요.",
    );
  }

  lines.push("");
  if (planScenes.length > 0) {
    lines.push(
      `[지금 제출돼 있는 기획안 — ${planWork?.version || 1}번째 안 · 장면 ${planScenes.length}개]`,
    );
    lines.push(
      "수정 요청을 받으면 이 내용을 기준으로 고치세요. 장면 번호는 브랜드 피드백이 " +
        "가리키는 번호와 같습니다.",
    );
    planScenes.forEach((s, i) => {
      lines.push(`장면 ${i + 1}`);
      lines.push(`  설명: ${oneLine(s.visual, 600) || "(비어 있음)"}`);
      if (s.subtitle.trim()) lines.push(`  자막: ${oneLine(s.subtitle, 300)}`);
      if (s.narration.trim()) lines.push(`  나레이션: ${oneLine(s.narration, 600)}`);
    });
    if (planPayload.fileName) lines.push(`(기획안 첨부 파일: ${oneLine(planPayload.fileName, 120)})`);
  } else {
    lines.push("[지금 제출돼 있는 기획안] 아직 없습니다 — 처음 쓰는 기획안입니다.");
  }

  lines.push("");
  if (caption.trim()) {
    lines.push(`[지금 제출돼 있는 인스타 본문 캡션 — ${caption.length}자]`);
    lines.push(caption.slice(0, 2400));
  } else {
    lines.push("[지금 제출돼 있는 인스타 본문 캡션] 아직 없습니다.");
  }

  // ── 브랜드 피드백 ──────────────────────────────────────────────────────
  const parseAnchorLabel = (anchor: unknown): string => {
    const raw = String(anchor || "").trim();
    if (raw === "caption") return "본문 캡션";
    const scene = /^scene:(\d+)$/.exec(raw);
    if (scene) return `${scene[1]}번 장면`;
    const time = /^t:(.+)$/.exec(raw);
    if (time) return `영상 ${time[1]} 지점`;
    return "전체";
  };

  const relevant = (feedbackRows || []).filter(
    (f) =>
      PLAN_STAGE_KEYS.includes(String(f.stage_key)) || VIDEO_STAGE_KEYS.includes(String(f.stage_key)),
  );
  const openFeedback = relevant.filter((f) => ["open", "relayed"].includes(String(f.status)));
  const doneFeedback = relevant.filter((f) => !["open", "relayed"].includes(String(f.status)));

  lines.push("");
  if (openFeedback.length > 0) {
    lines.push(`[아직 반영하지 않은 브랜드 피드백 ${openFeedback.length}건]`);
    lines.push(
      "'수정해 줘' 요청은 이 목록을 하나도 빠뜨리지 않고 반영하라는 뜻입니다. 각 피드백이 " +
        "어느 장면에 붙은 말인지 그대로 지켜서 그 장면을 고치세요.",
    );
    openFeedback.slice(0, 30).forEach((f, i) => {
      const where = parseAnchorLabel(f.anchor);
      const target = PLAN_STAGE_KEYS.includes(String(f.stage_key)) ? "기획안" : "영상·본문";
      lines.push(`${i + 1}. [${target} · ${where}] ${oneLine(f.body, 500)}`);
    });
  } else {
    lines.push("[아직 반영하지 않은 브랜드 피드백] 없습니다.");
    lines.push(
      "수정 요청을 받았는데 반영할 피드백이 없으면, 무엇을 어떻게 고칠지 사용자에게 " +
        "한 줄로 물어보고 나서 고치세요.",
    );
  }

  if (doneFeedback.length > 0) {
    lines.push("");
    lines.push(`[이미 반영한 브랜드 피드백 ${doneFeedback.length}건 — 되돌리지 마세요]`);
    doneFeedback.slice(-10).forEach((f) => {
      lines.push(`- [${parseAnchorLabel(f.anchor)}] ${oneLine(f.body, 240)}`);
    });
  }

  return {
    text: lines.join("\n"),
    guideRefs,
    plan: planWork
      ? { scenes: planScenes, body: planBody, version: Number(planWork.version || 1) }
      : null,
    caption,
    campaignTitle,
  };
}
