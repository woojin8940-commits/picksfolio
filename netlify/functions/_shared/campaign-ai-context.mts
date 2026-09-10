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
 * ── 기획의 근거는 진행 화면의 가이드 파일이다 ─────────────────────────
 * 예전에는 캠페인 등록 때 브랜드가 적어 둔 글(캠페인 설명, 지원 요건, 원하는 영상
 * 컨셉, 가이드라인 메모)을 그대로 프롬프트에 실었다. 그래서 기획안이 그 글의 말투와
 * 표현을 되풀이하는 일이 잦았다 — 등록 칸은 지원자를 모으려고 쓴 홍보 문구이고,
 * 실제로 지켜야 하는 촬영 규칙·필수 표기·금지 표현은 브랜드가 진행 화면(가이드
 * 단계·자료함)에 올리는 가이드 파일에 들어 있다. 두 개가 어긋나면 기획안은 파일이
 * 아니라 등록 문구를 따라갔다.
 *
 * 그래서 이제 등록 때 적은 글은 아예 싣지 않는다. 기획 내용의 근거는 브랜드가 진행
 * 화면에 올린 가이드 파일 하나뿐이고, 그 파일은 요청에 첨부되어 모델이 직접 읽는다.
 * 파일이 없으면 지어내지 않고 "가이드 파일이 필요하다"고 말하게 한다.
 *
 * 담는 것은 다섯 덩어리다.
 *   1. 이 캠페인이 무엇인지 — 캠페인·브랜드 이름, 채널·형식, 지금 단계와 마감
 *   2. 가이드 파일 — 브랜드가 진행 화면에 올린 파일의 목록(내용은 첨부로 간다)
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
  groupbuy: "커머스",
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
  /** 브랜드가 진행 화면(가이드 단계·자료함)에 올린 파일인가. 아니면 캠페인 등록 첨부. */
  fromProgress: boolean;
}

export interface CampaignFocusContext {
  /** 프롬프트에 그대로 붙일 문자열. */
  text: string;
  /**
   * 기획의 근거가 되는 가이드 파일.
   *
   * 브랜드가 진행 화면에 올린 파일이 먼저다. 한 번에 첨부할 수 있는 파일 수에 한도가
   * 있어서(api-collab-ai 의 GUIDE_MAX_FILES), 순서가 곧 "무엇이 잘려 나가는가"다 —
   * 진행 화면의 가이드가 등록 첨부에 밀려 잘리면 이 기능이 무의미해진다.
   */
  guideRefs: GuideFileRef[];
  /** 진행 화면에 올라온 가이드 파일이 하나라도 있는가(없으면 화면과 모델에 알린다). */
  hasProgressGuide: boolean;
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
      fromProgress: false,
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
  // 캠페인 등록 때 브랜드가 적은 글(description·requirements·video_concept·
  // guideline_note)은 일부러 읽지 않는다 — 기획안은 진행 화면의 가이드 파일을 근거로
  // 써야 한다. 등록분에서 가져오는 것은 이름표(제목·브랜드·채널·형식)와, 진행 화면에
  // 가이드 파일이 아예 없을 때만 쓰는 예비 첨부(guideline_files)뿐이다.
  const rows = (await db.sql`
    SELECT cc.id, cc.campaign_id, cc.campaign_title, cc.company_name, cc.status,
           cc.current_stage_key,
           c.title, c.brand_name, c.category, c.reward_mode,
           c.upload_channel, c.content_format, c.guideline_files,
           c.upload_from, c.upload_to
    FROM campaign_collabs cc
    LEFT JOIN campaigns c ON c.id = cc.campaign_id
    WHERE cc.id = ${collabId} AND cc.creator_username = ${username}
  `) as any[];

  const collab = rows?.[0];
  if (!collab) return null;

  const [termRows, stageRows, deliverableRows, feedbackRows, assetRows] = (await Promise.all([
    // 일정만 읽는다. 담당자가 적어 둔 guide_note/guide_url 도 글이라서 기획의 근거로는
    // 쓰지 않는다 — 근거는 가이드 파일 하나로 모아 둔다.
    db.sql`
      SELECT fee, script_due, content_due, upload_due, locked_at
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

  // 가이드 파일. 진행 화면(가이드 단계·자료함)에 올라온 것이 먼저다.
  //
  // 캠페인 등록 때 올린 첨부는 진행 화면에 아무 파일도 없을 때만 쓴다. 첨부 한도가
  // 있어서 둘을 그냥 합치면, 등록 때 올린 오래된 파일이 앞자리를 차지하고 정작 브랜드가
  // 진행 화면에 올린 최신 가이드가 잘려 나갈 수 있다. 지금 지켜야 하는 규칙이 적힌
  // 파일은 진행 화면 쪽이다.
  const progressRefs: GuideFileRef[] = (assetRows || [])
    .map((a) => ({
      url: String(a.file_url),
      fileName: String(a.title || a.file_name || "가이드 파일"),
      fileType: String(a.mime_type || ""),
      from: `${brand || "브랜드"}(진행 화면에 올린 가이드 파일)`,
      fromProgress: true,
    }))
    .filter((f) => f.url);
  const hasProgressGuide = progressRefs.length > 0;
  const guideRefs: GuideFileRef[] = (
    hasProgressGuide
      ? progressRefs
      : guidelineFileRefs(collab.guideline_files, `${brand || "브랜드"}(캠페인 등록 첨부)`)
  ).filter((f, i, all) => f.url && all.findIndex((x) => x.url === f.url) === i);

  const currentStage =
    (stageRows || []).find((s) => s.stage_key === collab.current_stage_key) ||
    (stageRows || []).find((s) => !["done", "skipped", "completed"].includes(String(s.status))) ||
    null;

  // ── 프롬프트 조립 ──────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`[이 캠페인]`);
  lines.push(
    "아래는 이름표입니다. 기획 내용(장면, 대사, 필수 표기)의 근거는 첨부된 가이드 " +
      "파일이고, 캠페인 등록 때 브랜드가 적어 둔 소개글·요건·컨셉 메모는 일부러 " +
      "여기에 싣지 않았습니다. 없는 사실을 이름표에서 추측해 채우지 마세요. " +
      "가이드 파일과 이 이름표가 어긋나면 가이드 파일이 기준입니다 — 특히 카테고리는 " +
      "행정 분류일 뿐이니, 그것으로 가이드에 적힌 제품·품목·컨셉을 덮어쓰지 마세요.",
  );
  lines.push(`- 캠페인: ${campaignTitle}`);
  if (brand) lines.push(`- 브랜드: ${brand}`);
  lines.push(`- 진행 방식: ${REWARD_MODE_LABEL[mode] || mode}`);
  if (collab.category) lines.push(`- 카테고리: ${collab.category}`);
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

  lines.push("");
  lines.push("[브랜드 가이드 파일 — 기획의 유일한 근거]");
  if (guideRefs.length) {
    lines.push(
      `- ${hasProgressGuide ? "브랜드가 진행 화면에 올린" : "캠페인 등록 때 첨부된"} 가이드 파일 ` +
        `${guideRefs.length}개: ${guideRefs.map((f) => f.fileName).join(", ")}`,
    );
    lines.push(
      "- 위 목록은 진행 기록에 등록된 파일 이름입니다. 그중 실제로 이 요청에 실려 당신이 " +
        "읽을 수 있는 파일은 지시문 맨 끝의 '[이번 요청에 실제로 …]' 항목이 최종입니다. " +
        "거기 없는 파일은 내용을 받지 못한 것이니 아는 척하지 마세요.",
    );
    lines.push(
      "- 실려 온 파일은 기획안이나 본문을 쓰기 전에 먼저 끝까지 읽고, 거기 적힌 필수 " +
        "표기·필수 장면·금지 사항을 실제 장면 안에 배치하세요.",
    );
    lines.push(
      "- 파일 내용이 위 [이 캠페인] 이름표(제목·카테고리·형식)와 어긋나면 파일을 따르세요. " +
        "제목이 로션인데 가이드가 패션 촬영 가이드라면, 기획안은 패션 가이드대로 씁니다. " +
        "어긋난 사실은 답 끝에 '담당자 확인 필요:' 로 한 줄 남기세요.",
    );
    if (!hasProgressGuide) {
      lines.push(
        "- 진행 화면(가이드 단계)에는 아직 파일이 없어서 캠페인 등록 때 첨부된 파일을 " +
          "읽고 있습니다. 이 파일이 최신 가이드가 아닐 수 있으니, 답 끝에 '진행 화면에 " +
          "올라온 최신 가이드 파일이 있으면 알려 달라'고 한 줄 남기세요.",
      );
    }
    lines.push(
      "- 파일에 없는 것은 지어내지 말고 답 끝에 '담당자 확인 필요:' 로 모아 주세요.",
    );
  } else {
    lines.push(
      "- 아직 가이드 파일이 없습니다. 브랜드가 진행 화면의 가이드 단계에 파일을 올리지 " +
        "않았습니다.",
    );
    lines.push(
      "- 이 상태에서는 기획안을 지어내지 마세요. '브랜드 가이드 파일이 아직 올라오지 " +
        "않아서 그 내용대로 쓸 수 없다'고 먼저 알리고, 담당자에게 가이드 파일을 요청하거나 " +
        "가지고 있는 가이드를 이 대화에 첨부해 달라고 안내하세요.",
    );
    lines.push(
      "- 사용자가 그래도 초안을 원하면, 무엇을 가정하고 썼는지 장면마다 밝히고 확인이 " +
        "필요한 항목을 '담당자 확인 필요:' 로 남기세요.",
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
    hasProgressGuide,
    plan: planWork
      ? { scenes: planScenes, body: planBody, version: Number(planWork.version || 1) }
      : null,
    caption,
    campaignTitle,
  };
}
