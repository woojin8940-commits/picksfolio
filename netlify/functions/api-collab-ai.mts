import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import {
  buildCampaignFocusContext,
  type CampaignFocusContext,
} from "./_shared/campaign-ai-context.mts";
import {
  CAMPAIGN_AI_SYSTEM_INSTRUCTION,
  DRAFT_REPAIR_INSTRUCTION,
  extractCampaignDraft,
  parseDraftReply,
  type CampaignDraft,
} from "./_shared/campaign-ai-prompt.mts";
import {
  buildVariationDirective,
  resolveCampaignVariation,
} from "./_shared/campaign-ai-variation.mts";
import { getSupabaseServer } from "./_shared/supabase.mts";
import {
  DIRECT_UPLOAD_BUCKET,
  resolveContentType,
  storagePathOf,
} from "./_shared/upload-media.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";

// Collaboration AI assistant.
//
// Backed by Gemini 2.5 Flash-Lite through Netlify AI Gateway.
//
// 인플루언서 캠페인 진행 화면의 AI 탭만 이 함수를 쓴다. 열어 둔 캠페인 한 건의
// 사실과 브랜드 가이드 파일(이미지·PDF)을 근거로 기획안과 인스타그램 본문 초안을
// 쓰고 고친다. 협업 타임라인 화면의 업무 비서와 클로드(Claude) 선택은 타임라인과
// 함께 없어졌다.
//
// 모든 계정에 무료로 열려 있고, Blobs 에 두는 하루 사용량 한도만 있다.
const MODEL = "gemini-2.5-flash-lite";
const DAILY_LIMIT = 100;
const MAX_TURNS = 12;

// ── Brand guide files (images / PDFs) ────────────────────────────────────────
//
// 브랜드가 주는 "기본 가이드"는 거의 항상 이미지나 PDF 파일로 올라온다. 그 파일을
// 파일명만 보고 넘기면 기획안을 쓸 수 없으므로, 저장된 실제 파일을 꺼내 base64 로
// 모델에 함께 보낸다(제미나이: inlineData).
//
// 파일이 있는 곳은 두 군데다. 업로드 경로가 한 번 바뀌었기 때문이다.
//   · Netlify Blobs      `/api/images/<key>` — 함수가 파일을 받아 저장하던 예전 경로.
//                        지금도 AI 대화창의 첨부(`/api/upload-image`)가 이쪽으로 간다.
//   · 스토리지(Supabase) 공개 주소 — 지금 경로. 브라우저가 서명된 링크로 곧장 올린다.
//                        브랜드가 진행 화면·자료함·캠페인 등록에 올리는 가이드 파일,
//                        협업 대화의 첨부가 전부 이쪽이다.
//
// 두 번째를 빼놓은 것이 실제 고장이었다. 읽는 쪽이 Blobs 만 알고 있어서, 브랜드가
// 진행 화면에 올린 가이드는 목록에 이름만 뜨고 내용은 한 번도 모델에 실리지 않았다.
// 그런데 프롬프트에는 "가이드 파일이 첨부되어 있다"고 적혀 있으니, 모델은 읽지도 못한
// 가이드를 읽은 것처럼 캠페인 이름표(제목·카테고리)만 보고 기획안을 지어냈다 —
// 로션 캠페인에 패션 가이드가 붙어 있으면 가이드와 무관한 로션 기획안이 나왔다.
//
// 비용과 응답 시간이 파일 크기에 그대로 비례하므로 개수·용량에 상한을 둔다.
// 파일 한 개 상한은 업로드 상한(10MB)과 맞춰, 올릴 수 있었던 파일이 여기서 조용히
// 빠지는 일이 없게 한다.
const GUIDE_MAX_FILES = 3;
/**
 * 캠페인 화면은 몇 장 더 읽는다.
 *
 * 타임라인 대화에서 가이드 파일은 배경 자료 중 하나지만, 캠페인 화면에서는 기획의
 * 유일한 근거다. 그런데 브랜드 가이드는 PDF 한 장으로 오지 않는 일이 흔하다 —
 * 촬영 가이드, 필수 표기, 금지 사항이 이미지 여러 장으로 쪼개져 올라온다. 3장에서
 * 자르면 뒤쪽에 있던 필수 표기가 기획안에서 통째로 빠지고, 사용자는 그것을 답만
 * 보고는 알 수 없다. 전체 용량 상한(GUIDE_MAX_TOTAL_BYTES)은 그대로이므로 비용이
 * 무제한으로 늘지는 않는다.
 */
const GUIDE_MAX_FILES_CAMPAIGN = 5;
const GUIDE_MAX_FILE_BYTES = 10 * 1024 * 1024;
const GUIDE_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
// 모델이 실제로 읽을 수 있는 형식만 보낸다(svg·avif·heic·영상은 제외).
const GUIDE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const GUIDE_PDF_TYPE = "application/pdf";

/**
 * "본문(캡션)만 써 달라"는 요청을 알아보는 자리.
 *
 * 캠페인 화면에서 이 어시스턴트가 내놓는 결과물은 기획안과 본문 두 가지인데, 지시문의
 * 분량은 기획안 쪽이 압도적이다(가이드 되짚기, 장면 구성, 나레이션 규칙). 그래서
 * "본문 캡션 작성해줘"라고만 말해도 모델은 기획안을 쓰는 절차로 끌려가 장면부터
 * 늘어놓거나, 톤이 다른 본문 후보를 세 개 나열하고 표식을 아예 붙이지 않았다. 표식이
 * 없으면 반영 버튼이 뜨지 않아, 사용자는 완성된 본문을 눈으로 읽고 손으로 옮겨
 * 적어야 했다 — 기획안·피드백 수정에서는 버튼 한 번으로 끝나는 일이다.
 *
 * 그래서 요청이 본문 하나만 가리킬 때는 이 사실을 지시문 끝에 못 박는다. 기획안을
 * 함께 가리키는 말(기획안·장면·콘티·대본·스토리보드)이 섞여 있으면 적용하지 않는다 —
 * 그때는 지금까지처럼 기획안 절차를 따르는 것이 맞다.
 */
const CAPTION_ONLY_INTENT_RE = /(본문|캡션|caption)/i;
const PLAN_ALSO_INTENT_RE = /(기획안|기획서|장면|씬|콘티|대본|스토리보드|자막|나레이션|릴스|숏폼|쇼츠)/i;

/**
 * "방금 준 그거, 이렇게 고쳐 줘" 를 알아보는 자리.
 *
 * 위 두 규칙은 요청에 대상이 적혀 있을 때만 맞는다. 그런데 실제 대화는 이렇게 흐른다 —
 * "본문 써 줘" → (본문 카드) → "좀 더 짧게 해 줘". 뒤엣말에는 '본문'도 '기획안'도 없다.
 * 그래서 두 규칙이 모두 안 걸리고, 표식을 붙이라는 못도 안 박히고, 글에서 건져 내는
 * 쪽도 "본문:" 머리글이 없으니 빈손이 된다. 결과는 사용자가 본 그 화면이다: 짧아진
 * 본문은 글로만 오고 반영 버튼이 없어서, 방금 고친 본문을 손으로 옮겨 적어야 한다.
 *
 * 고쳐 달라는 말투가 보이면 직전 초안의 종류를 이어받아 같은 대상으로 본다. 대상을
 * 억지로 이어받으면 엉뚱한 답에 표식이 붙을 수 있으므로, "고쳐 달라"는 뜻이 실제로
 * 읽히는 말일 때만 이어받는다 — "가이드 필수사항 정리해 줘" 같은 질문은 그대로 질문이다.
 */
const REVISION_FOLLOWUP_RE =
  /(짧게|짧은|줄여|줄이|간결|길게|늘려|늘리|추가|넣어|빼고|빼 ?줘|빼줘|삭제|지워|바꿔|바꾸|고쳐|고쳐 ?줘|수정|다시\s*(써|작성|만들|해)|말투|톤|느낌|해시\s*태그|해시태그|이모지|첫\s*줄|강조|부드럽|자연스럽|친근|전문적|캐주얼|반영|그대로|이걸로|이대로)/;

/** 이번 요청이 무엇을 만들어 내는 요청인지. null 이면 초안을 만드는 요청이 아니다. */
type DraftTarget = "plan" | "caption" | null;

const asDraftTarget = (raw: unknown): DraftTarget =>
  raw === "plan" || raw === "caption" ? raw : null;

/**
 * 대화를 거꾸로 훑어 마지막으로 가리킨 대상을 찾는다.
 *
 * 화면이 보내 준 `lastDraftKind`(마지막으로 카드가 떴던 초안의 종류)가 가장 정확하지만,
 * 대화를 이어받은 다른 기기나 옛 화면에서는 그 값이 없다. 그때는 사용자가 앞서 적은
 * 말에서 대상을 찾는다. 모델 답은 보지 않는다 — 답에서 표식은 이미 지워져 있다.
 */
const inferDraftTargetFromHistory = (
  messages: { role: string; content: string }[],
): DraftTarget => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") continue;
    const text = String(messages[i]?.content || "");
    if (PLAN_ALSO_INTENT_RE.test(text)) return "plan";
    if (CAPTION_ONLY_INTENT_RE.test(text)) return "caption";
  }
  return null;
};

/**
 * 이번 요청의 초안 대상을 정한다.
 *
 * @returns `target` 이 대상, `followUp` 은 그 대상을 직전 대화에서 이어받았는지
 *   (이어받았으면 "고친 초안 전체를 다시 내놓아라"는 지시를 더 붙인다).
 */
const resolveDraftTarget = (
  lastUserText: string,
  clientLastDraftKind: unknown,
  messages: { role: string; content: string }[],
): { target: DraftTarget; followUp: boolean } => {
  const text = String(lastUserText || "");
  // 말에 대상이 적혀 있으면 그것이 이긴다.
  if (PLAN_ALSO_INTENT_RE.test(text)) return { target: "plan", followUp: false };
  if (CAPTION_ONLY_INTENT_RE.test(text)) return { target: "caption", followUp: false };
  if (!REVISION_FOLLOWUP_RE.test(text)) return { target: null, followUp: false };

  const carried = asDraftTarget(clientLastDraftKind) || inferDraftTargetFromHistory(messages);
  return carried ? { target: carried, followUp: true } : { target: null, followUp: false };
};

interface GuideRef {
  url?: string;
  fileName?: string;
  fileType?: string;
  /** 누가 올린 파일인지 — 브랜드가 준 가이드인지 구분하는 데 쓴다. */
  from?: string;
}

interface GuideFile {
  fileName: string;
  mediaType: string;
  /** base64, 줄바꿈 없음. */
  data: string;
  from?: string;
}

/** `/api/images/<key>` 주소에서 Blobs 키만 뽑는다. 그 형태가 아니면 읽지 않는다. */
const blobKeyOf = (url?: string): string | null => {
  const raw = String(url || "");
  const marker = "/api/images/";
  const at = raw.indexOf(marker);
  if (at < 0) return null;
  const key = raw.slice(at + marker.length).split(/[?#]/)[0];
  if (!key || key.includes("..")) return null;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
};

/** 저장된 파일의 바이트와 서버가 정해 둔 형식. 어느 저장소에서 왔는지는 감춘다. */
interface StoredBytes {
  bytes: ArrayBuffer;
  /** 저장할 때 서버가 정한 형식. 모르면 빈 문자열(호출하는 쪽이 확장자로 판단한다). */
  contentType: string;
}

/**
 * 파일 주소 하나를 실제 바이트로 바꾼다. 우리 저장소의 주소가 아니면 null.
 *
 * 두 저장소를 여기서 함께 다룬다 — 부르는 쪽이 "이 파일은 어디에 있지"를 알아야 할
 * 이유가 없고, 한쪽만 아는 코드가 조용히 파일을 빠뜨리는 것이 바로 이 기능의 고장
 * 원인이었다.
 */
async function readStoredFile(url?: string): Promise<StoredBytes | null> {
  const blobKey = blobKeyOf(url);
  if (blobKey) {
    const stored = await getStore("images").getWithMetadata(blobKey, { type: "arrayBuffer" });
    if (!stored?.data) return null;
    return {
      bytes: stored.data as ArrayBuffer,
      contentType: String((stored.metadata as any)?.contentType || ""),
    };
  }

  const path = storagePathOf(url);
  if (path) {
    // 공개 버킷이라 주소를 그대로 받아 올 수도 있지만, 경로만 뽑아 스토리지에서 읽는다.
    // 그러면 임의의 주소를 서버가 대신 받아 오는 길을 만들지 않는다.
    const { data, error } = await getSupabaseServer()
      .storage.from(DIRECT_UPLOAD_BUCKET)
      .download(path);
    if (error || !data) return null;
    return { bytes: await data.arrayBuffer(), contentType: String((data as Blob).type || "") };
  }

  return null;
}

/**
 * 첨부 파일을 저장소에서 읽어 모델에 실을 수 있는 형태로 만든다.
 * 형식은 요청 본문 값이 아니라 저장할 때 서버가 정해 둔 값(또는 확장자)으로 판단한다.
 * 읽지 못한 파일은 조용히 버리지 않고 이유와 함께 돌려준다 — 모델이 "이 파일은 못 읽었다"고
 * 사용자에게 알려 줄 수 있어야 하고, 무엇보다 못 읽은 가이드를 읽은 것처럼 답해서는
 * 안 되기 때문이다.
 */
async function loadGuideFiles(
  refs: GuideRef[],
  maxFiles: number = GUIDE_MAX_FILES,
): Promise<{ files: GuideFile[]; skipped: string[] }> {
  const files: GuideFile[] = [];
  const skipped: string[] = [];
  if (refs.length === 0) return { files, skipped };

  const seen = new Set<string>();
  let total = 0;

  for (const ref of refs) {
    const url = String(ref?.url || "");
    const fileName = String(
      ref?.fileName || url.split(/[?#]/)[0].split("/").pop() || "첨부 파일",
    ).slice(0, 120);

    // 같은 파일이 두 곳(자료함·대화 첨부)에 걸쳐 있을 수 있다. 주소로 한 번만 읽는다.
    if (!url || seen.has(url)) continue;
    seen.add(url);

    if (files.length >= maxFiles) {
      skipped.push(`${fileName}(한 번에 ${maxFiles}개까지만 읽을 수 있음)`);
      continue;
    }

    // 우리 저장소의 주소가 아니면 읽어 볼 자리조차 없다. 이유를 나눠 두는 것은
    // 사용자가 할 수 있는 일이 다르기 때문이다 — 자리가 없으면 파일을 다시 올려야
    // 하고, 자리에 없으면 파일이 지워진 것이다.
    if (!blobKeyOf(url) && !storagePathOf(url)) {
      skipped.push(`${fileName}(저장소 주소가 아니라 열어 볼 수 없음 — 다시 올려 주세요)`);
      continue;
    }

    let mediaType = resolveContentType(fileName, String(ref?.fileType || "")) || "";

    try {
      const stored = await readStoredFile(url);
      if (!stored) {
        skipped.push(`${fileName}(파일을 찾지 못함)`);
        continue;
      }
      if (stored.contentType) mediaType = stored.contentType;
      if (mediaType !== GUIDE_PDF_TYPE && !GUIDE_IMAGE_TYPES.has(mediaType)) {
        skipped.push(`${fileName}(이미지·PDF 가 아니라 열어 볼 수 없음)`);
        continue;
      }

      const bytes = stored.bytes;
      if (bytes.byteLength === 0) {
        skipped.push(`${fileName}(빈 파일)`);
        continue;
      }
      if (
        bytes.byteLength > GUIDE_MAX_FILE_BYTES ||
        total + bytes.byteLength > GUIDE_MAX_TOTAL_BYTES
      ) {
        skipped.push(`${fileName}(용량이 커서 열어 볼 수 없음)`);
        continue;
      }
      total += bytes.byteLength;

      files.push({
        fileName,
        mediaType,
        data: Buffer.from(bytes).toString("base64"),
        from: ref.from,
      });
    } catch (e) {
      console.error("[collab-ai] guide file read failed", e);
      skipped.push(`${fileName}(읽는 중 오류)`);
    }
  }

  return { files, skipped };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 초안 되묻기(repair)
 *
 * 초안을 만들어 내는 요청인데 표식이 없고 글에서도 건져 내지 못한 경우, 모델에게 그
 * 답변을 다시 보여 주며 JSON 만 달라고 한 번 더 묻는다. 한 번만 묻고, 실패하면 조용히
 * 넘어간다 — 초안 카드가 안 뜨는 것은 불편이지만 답 대신 오류가 뜨는 것은 고장이다.
 *
 * 모델 호출이 한 번 더 붙는 값이지만, 이 호출이 붙는 경우는 "초안을 만들었는데 표식이
 * 빠진 답"뿐이다. 그 답의 대안은 사용자가 완성된 본문을 손으로 옮겨 적는 것이다.
 * ────────────────────────────────────────────────────────────────────────── */

/** 되묻기에 싣는 답변 길이. 초안은 답의 뒤쪽에 있으므로 넘치면 앞쪽을 자른다. */
const REPAIR_MAX_CHARS = 12000;

const repairPrompt = (target: DraftTarget, reply: string): string => {
  const what = target === "plan" ? "기획안(장면 구성)" : "인스타그램 본문(캡션)";
  const body = reply.length > REPAIR_MAX_CHARS ? reply.slice(-REPAIR_MAX_CHARS) : reply;
  return (
    `이 답변에서 뽑아야 하는 것: ${what}\n\n` +
    `[AI 답변 시작]\n${body}\n[AI 답변 끝]\n\n` +
    "위 답변에 담긴 내용을 JSON 한 덩어리로만 옮겨 적으세요."
  );
};

/** Gemini 로 되묻기. 하루 사용량은 더 차감하지 않는다(같은 질문의 뒤처리이므로). */
const repairDraftWithGemini = async (
  target: DraftTarget,
  reply: string,
  maxOutputTokens: number,
): Promise<CampaignDraft | null> => {
  try {
    const res = await fetch(
      `${process.env.GOOGLE_GEMINI_BASE_URL}/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY as string,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: DRAFT_REPAIR_INSTRUCTION }] },
          contents: [{ role: "user", parts: [{ text: repairPrompt(target, reply) }] }],
          // 옮겨 적는 일이므로 창작 여지를 두지 않는다.
          generationConfig: { temperature: 0, maxOutputTokens },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part: any) => part?.text || "")
      .join("");
    return parseDraftReply(text);
  } catch (e) {
    console.error("[collab-ai] draft repair (gemini) failed", e);
    return null;
  }
};

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const username = String(body?.username || "")
    .toLowerCase()
    .replace(/^biz\//, "");
  const messages: { role: string; content: string }[] = Array.isArray(body?.messages)
    ? body.messages
    : [];
  // 어느 화면에서 부른 대화인지.
  //
  // 'timeline'은 협업 타임라인 화면이었다. 타임라인이 없어져서 더 받지 않는다.
  // 'campaign'은 인플루언서 캠페인 진행 화면의 AI 탭이다. 이쪽은 일부러 좁다. 열어 둔
  // 캠페인 한 건의 기획안과 인스타 본문을 쓰고 고치는 것만 한다. 그래서 협업 대화도,
  // 다른 캠페인도 읽지 않는다 — 다른 캠페인의 제품과 가이드가 같은 프롬프트에 섞이면
  // 기획안에 엉뚱한 브랜드의 필수 문구가 들어간다. 두 화면이 공유하는 것은 역할이
  // 아니라 배관이다: 멤버십 게이트, 하루 사용량, 가이드 파일 읽기, 모델 호출.
  if (body?.scope !== "campaign") {
    return Response.json({ error: "더 이상 제공하지 않는 기능입니다." }, { status: 410 });
  }
  // 캠페인 진행 화면에서 지금 열어 둔 협업. 캠페인 화면에서는 필수다.
  const campaignFocusId = String(body?.campaignFocusId || "");
  // 이 대화에서 마지막으로 초안 카드가 떴던 초안의 종류('plan' | 'caption').
  //
  // "좀 더 짧게 해 줘" 처럼 대상을 적지 않은 수정 요청이 무엇을 고치라는 말인지는 화면이
  // 알고 있다 — 방금 카드가 뜬 그 초안이다. 대화 기록만으로 되짚으면 사용자가 앞서
  // '본문'이라는 말을 쓴 적이 있는지에 기대게 되므로, 화면이 아는 값을 그대로 받는다.
  const clientLastDraftKind = body?.lastDraftKind;
  // 사용자가 AI 대화창에서 직접 올린 파일(브랜드 가이드 등). 실제 파일은 업로드 시
  // Blobs 에 저장되므로 여기서는 주소만 받는다.
  // 한 번에 읽을 파일 수. 가이드가 기획의 유일한 근거라서 넉넉하게 둔다.
  const guideMaxFiles = GUIDE_MAX_FILES_CAMPAIGN;
  const clientAttachments: GuideRef[] = Array.isArray(body?.attachments)
    ? (body.attachments as GuideRef[]).slice(0, guideMaxFiles)
    : [];

  if (!username) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  // 지금까지는 본문의 username 을 그대로 믿었다. 그래서 남의 아이디를 적으면
  // 그 사람의 협업 내용이 프롬프트에 실려 답변으로 돌아왔다. 실제 그 계정으로 로그인한 사람인지 확인한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;
  if (messages.length === 0) {
    return Response.json({ error: "메시지가 비어 있습니다." }, { status: 400 });
  }

  // 캠페인 AI(Gemini)는 모든 계정에 무료로 열려 있다. 멤버십 게이트는 없앴고,
  // 아래 하루 사용량 한도만 남는다.
  const usageStore = getStore("ai-usage");
  const usageKey = `collab_${username}_${new Date().toISOString().slice(0, 10)}`;
  const used =
    ((await usageStore.get(usageKey, { type: "json" })) as { count?: number } | null)?.count || 0;
  if (used >= DAILY_LIMIT) {
    return Response.json(
      {
        error: "오늘 사용할 수 있는 AI 질문 횟수를 모두 사용했어요. 내일 다시 이용해 주세요.",
        code: "RATE_LIMITED",
      },
      { status: 429 },
    );
  }

  if (!process.env.GEMINI_API_KEY || !process.env.GOOGLE_GEMINI_BASE_URL) {
    return Response.json(
      { error: "AI 기능이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
  let discoveredGuideRefs: GuideRef[] = [];

  // 캠페인 화면이면 그 캠페인 한 건의 사실을 읽는다.
  //
  // 화면이 보낸 요약을 쓰지 않고 DB 에서 직접 읽는다. 본문은 사람이 고칠 수 있어서 남의
  // 협업 아이디를 끼워 넣을 수 있고(그래서 조회 조건에 본인 아이디를 함께 건다), 화면이
  // 들고 있는 요약에는 정작 필요한 가이드라인·브랜드 피드백·지금 기획안이 없다.
  //
  // 여기서 실패하면 답을 만들지 않고 멈춘다. 기획안을 고치라는 요청에 지금 기획안을
  // 모른 채로 답하면, 사용자는 그 답이 자기 기획안을 고친 것이라고 믿고 반영 버튼을
  // 누르게 된다 — 사실 없이 지어낸 답이 저장되는 것보다 오류가 낫다.
  let campaignContext: CampaignFocusContext | null = null;
  if (!campaignFocusId) {
    return Response.json({ error: "캠페인 정보가 없습니다." }, { status: 400 });
  }
  try {
    campaignContext = await buildCampaignFocusContext(username, campaignFocusId);
  } catch (e) {
    console.error("[collab-ai] failed to build campaign context", e);
    return Response.json(
      { error: "캠페인 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
  if (!campaignContext) {
    return Response.json(
      { error: "캠페인을 찾을 수 없습니다. 화면을 새로 고친 뒤 다시 시도해 주세요." },
      { status: 404 },
    );
  }
  discoveredGuideRefs = campaignContext.guideRefs;

  // 이 인플루언서에게 배정된 창작 방향.
  //
  // 같은 캠페인의 인플루언서들이 같은 가이드 파일 하나를 근거로 기획안을 받으므로,
  // 방향을 나눠 주지 않으면 결과가 서로 닮는다(campaign-ai-variation 참고). 저장소를
  // 못 읽어도 답은 만들어야 하므로 그 안에서 해시로 떨어진다.
  const campaignVariation = campaignContext
    ? await resolveCampaignVariation(campaignContext.campaignId, campaignFocusId, username)
    : null;

  // 브랜드 기본 가이드 읽기. 사용자가 직접 올린 파일이 있으면 그것을 쓰고, 없으면
  // 지금 보고 있는 협업에 올라온 이미지·PDF 를 가져온다(가이드를 봐야 하는 요청일 때만).
  const lastUserText = [...messages].reverse().find((m) => m.role !== "assistant")?.content || "";
  // 캠페인 화면에서는 브랜드 가이드 파일을 조건 없이 항상 읽는다.
  //
  // 타임라인 쪽은 "가이드 봐 줘" 같은 말이 나올 때만 파일을 읽는다 — 대화 대부분이
  // 파일과 상관없고, 매번 PDF 를 실으면 느려지고 비싸진다. 캠페인 화면은 반대다.
  // 여기서 하는 일이 기획안과 본문을 쓰는 것뿐이고, 캠페인 등록 때 적어 둔 글은 아예
  // 프롬프트에 싣지 않으므로(campaign-ai-context 참고), 브랜드가 진행 화면에 올린
  // 가이드 파일은 배경 자료가 아니라 기획의 유일한 근거다. 사용자가 "이거 참고해서
  // 써 줘"라고 말하는지 여부로 필수 표기가 빠지고 말고 해서는 안 된다.
  //
  // 사용자가 직접 올린 파일이 있으면 그것을 앞에 두고 브랜드 가이드를 뒤에 붙인다
  // (타임라인은 지금까지처럼 사용자 첨부가 있으면 그것만 읽는다).
  const campaignGuideCandidates = [...clientAttachments, ...discoveredGuideRefs].filter(
    (f, i, all) => all.findIndex((x) => x.url === f.url) === i,
  );
  const guideCandidates = campaignGuideCandidates.slice(0, guideMaxFiles);
  let guideFiles: GuideFile[] = [];
  let skippedGuideFiles: string[] = [];
  try {
    const loaded = await loadGuideFiles(guideCandidates, guideMaxFiles);
    guideFiles = loaded.files;
    skippedGuideFiles = loaded.skipped;
  } catch (e) {
    console.error("[collab-ai] failed to load guide files", e);
  }
  // 한 번에 읽을 수 있는 파일 수를 넘긴 것은 모델에게 이름을 알려 준다.
  //
  // 캠페인 화면의 프롬프트에는 가이드라인 파일 목록이 이름까지 다 들어 있다. 그중
  // 일부만 실제로 첨부되면, 모델은 이름만 본 파일도 읽은 것처럼 답할 수 있다 —
  // 기획안에서 그것은 "가이드에 있었다"고 지어낸 필수 표기가 된다.
  if (campaignGuideCandidates.length > guideCandidates.length) {
    skippedGuideFiles = [
      ...skippedGuideFiles,
      ...campaignGuideCandidates
        .slice(guideCandidates.length)
        .map((f) => String(f.fileName || f.url || "파일")),
    ];
  }

  // 첨부한 파일이 무엇인지 모델에게 한 줄로 알려 준다(이미지·PDF 블록만으로는
  // 파일명과 출처를 알 수 없다). 못 읽은 파일도 함께 알려 사용자에게 전달되게 한다.
  const guideNoteBody =
    (guideFiles.length
      ? `[함께 첨부된 파일 ${guideFiles.length}개] ` +
        guideFiles.map((f) => `${f.fileName}${f.from ? ` (올린 사람: ${f.from})` : ""}`).join(", ") +
        "\n위 파일이 이 메시지와 함께 첨부되어 있습니다. 브랜드 가이드라면 내용을 끝까지 읽고 " +
        "필수 준수사항을 그대로 반영해 답하세요.\n"
      : "") +
    (skippedGuideFiles.length
      ? `[열어 보지 못한 파일] ${skippedGuideFiles.join(", ")}\n` +
        "이 파일들은 내용을 볼 수 없으니 아는 척하지 말고, 답변 끝에 한 줄로 알려 주세요.\n"
      : "");
  const guideNote = guideNoteBody ? guideNoteBody + "\n" : "";

  // 캠페인 화면은 지시문을 물려받지 않고 갈아 끼운다.
  //
  // 위 지시문은 협업 전체를 아는 비서의 것이다. 거기에 캠페인용 규칙을 덧붙이면 두
  // 지시가 부딪힌다 — "협업 현황을 업체별로 정리하라"와 "이 캠페인만 다뤄라"가 같은
  // 프롬프트에 있으면 모델은 묻지 않은 다른 캠페인 이야기를 꺼낸다. 하는 일이 다르면
  // 지시문도 다른 것이 맞다.
  //
  // 이번 요청에 가이드 파일이 "실제로" 실렸는지를 지시문 끝에 못 박는다.
  //
  // 캠페인 프롬프트의 가이드 목록은 DB 에 적힌 파일 이름이고, 그 파일이 실제로 모델에
  // 실렸는지는 여기서(저장소에서 읽어 본 뒤에야) 정해진다. 두 값이 어긋난 채로 보내면
  // 모델은 이름만 본 파일을 읽은 것처럼 답한다 — 기획안에서 그것은 "가이드에 있었다"고
  // 지어낸 필수 표기이고, 읽지 못한 가이드 대신 캠페인 이름표(제목·카테고리)를 근거로
  // 삼은 기획안이다. 그래서 실린 파일과 못 읽은 파일을 마지막에 다시 한 번 적는다.
  //
  // 사용자가 방금 대화에 직접 올린 가이드도 이 항목으로 함께 해결된다(담당자가 카톡으로
  // 준 PDF 를 올리는 일이 흔하다). 진행 화면에 파일이 없다는 이유로 "가이드를 올려
  // 달라"고 답하면, 사용자는 방금 올린 파일을 앞에 두고 다시 올리라는 말을 듣는다.
  const campaignGuideStatus = (() => {
    if (!campaignContext) return "";

    if (guideFiles.length > 0) {
      return (
        `\n\n[이번 요청에 실제로 첨부되어 읽을 수 있는 가이드 파일 ${guideFiles.length}개] ` +
        guideFiles.map((f) => f.fileName).join(", ") +
        "\n이 파일들은 이 요청에 이미지·PDF 로 함께 실려 있습니다. 위 목록에 파일이 없다고 " +
        "적혀 있어도 이 항목이 최종입니다 — 가이드 파일을 다시 올려 달라고 하지 마세요.\n" +
        "기획안·본문을 쓰기 전에 이 파일을 끝까지 읽고, 파일에 적힌 내용만을 근거로 쓰세요. " +
        "파일 내용이 위 캠페인 이름표(제목·카테고리·형식)와 달라 보여도 **파일을 따르세요.** " +
        (skippedGuideFiles.length
          ? `\n다만 다음 파일은 열어 보지 못했습니다: ${skippedGuideFiles.join(", ")}. ` +
            "이 파일 내용은 아는 척하지 말고, 답 끝에 한 줄로 알려 주세요."
          : "")
      );
    }

    // 읽을 파일이 하나도 없다. 목록에는 이름이 있는데 못 읽은 경우가 가장 위험하다 —
    // 모델이 목록만 보고 "가이드대로 썼다"는 기획안을 내놓기 때문이다.
    if (campaignGuideCandidates.length > 0) {
      return (
        "\n\n[중요 · 이번 요청에 실제로 첨부된 가이드 파일: 0개]\n" +
        "위 목록에 가이드 파일 이름이 적혀 있지만, 그 파일을 열지 못해 내용이 이 요청에 " +
        "실리지 않았습니다" +
        (skippedGuideFiles.length ? `(${skippedGuideFiles.join(", ")})` : "") +
        ".\n" +
        "그러므로 가이드 내용을 아는 척하지 마세요. 기획안이나 본문을 요청받았다면, " +
        "**가이드 파일을 열지 못해 그 내용대로 쓸 수 없다는 사실을 먼저 알리고** 파일을 " +
        "이 대화에 다시 첨부해 달라고 안내하세요. 캠페인 제목·카테고리만 보고 제품 기획안을 " +
        "지어내지 마세요. 사용자가 그래도 초안을 원하면 무엇을 가정했는지 밝히고 쓰세요."
      );
    }

    return "";
  })();

  // 이번 요청이 무엇을 만들어 내는 요청인지 — 위 resolveDraftTarget 주석에 이유가 있다.
  // 말에 대상이 없어도 "좀 더 짧게 해 줘" 같은 수정 요청이면 직전 초안의 종류를 이어받는다.
  const { target: draftTarget, followUp: draftFollowUp } =
    resolveDraftTarget(String(lastUserText), clientLastDraftKind, messages);

  const captionOnlyRequest = draftTarget === "caption";
  const captionOnlyDirective = captionOnlyRequest
    ? "\n\n[이번 요청은 인스타그램 본문(캡션)만 써 달라는 요청입니다]\n" +
      "- 답에는 본문 하나만 쓰세요. 장면 설명·자막·나레이션 같은 기획안 내용을 쓰지 마세요.\n" +
      "- 맨 앞의 **가이드에서 확인한 것** 항목은 생략하세요. 가이드 파일은 그대로 끝까지 읽고 " +
      "필수 문구·해시태그·계정 태그를 본문에 넣되, 확인 목록은 적지 않습니다.\n" +
      "- 톤이 다른 후보를 여러 개 나열하지 말고 **바로 올릴 수 있는 완성된 본문 하나**만 내세요. " +
      "사용자는 이 본문을 카드에서 고친 뒤 버튼으로 저장합니다.\n" +
      "- 답의 맨 끝에 {\"kind\":\"caption\"} 표식을 반드시 딱 한 번 붙이고, 그 안의 text 에는 " +
      "사람에게 보여 준 본문과 **똑같은 글**을 줄바꿈·해시태그까지 그대로 넣으세요. 표식이 없으면 " +
      "반영 버튼이 뜨지 않아 사용자가 본문을 손으로 옮겨 적어야 합니다.\n" +
      "- 기획안 표식(kind:\"plan\")은 붙이지 마세요.\n" +
      "- 가이드 파일을 읽지 못했다면 본문을 지어내지 말고 그 사실을 먼저 알리세요(표식도 붙이지 않습니다)."
    : "";

  // 기획안을 달라는 요청에도 같은 못을 박는다.
  //
  // 표식 규칙은 CAMPAIGN_AI_SYSTEM_INSTRUCTION 맨 위에 이미 적혀 있지만, 캠페인 사실과
  // 가이드 본문이 그 뒤로 길게 붙으면 모델이 앞쪽 규칙을 흘리고 글만 예쁘게 써 놓는 일이
  // 있었다(실제로 기획안이 글로만 나오고 반영 버튼이 안 떴다). 지시문 맨 끝, 사용자
  // 요청 바로 앞에 한 번 더 놓아 두면 잊힐 자리가 없다. 표식이 그래도 빠지면
  // extractCampaignDraft 가 글에서 건져 내지만, 건져 낸 값은 글을 다시 쪼갠 것이라
  // 모델이 직접 준 JSON 보다 부정확하다 — 이쪽을 먼저 지킨다.
  const planRequest = draftTarget === "plan";
  const planDirective = planRequest
    ? "\n\n[이번 요청은 기획안(장면 구성)을 써 달라는 요청입니다]\n" +
      "- 답의 맨 끝에 {\"kind\":\"plan\"} 표식을 반드시 딱 한 번 붙이세요. 표식이 없으면 화면에 " +
      "수정·반영 카드가 뜨지 않아 사용자가 장면을 손으로 옮겨 적어야 합니다.\n" +
      "- 표식 안 scenes 에는 사람에게 보여 준 장면을 **하나도 빼지 말고 같은 순서로** 넣고, 각 장면의 " +
      "visual·subtitle·narration 에 보여 준 문장과 똑같은 글을 넣으세요.\n" +
      "- 장면 하나만 고쳐 달라는 요청이었어도 표식에는 **고친 기획안 전체(모든 장면)**를 넣으세요. " +
      "반영 버튼은 기획안을 통째로 바꿉니다.\n" +
      "- 나레이션 없이 써 달라고 했다면 narration 은 빈 문자열로 두세요(\"음원만 사용\" 같은 말을 " +
      "넣지 마세요).\n" +
      "- 가이드 파일을 읽지 못했다면 기획안을 지어내지 말고 그 사실을 먼저 알리세요(표식도 붙이지 않습니다)."
    : "";

  // 대상을 적지 않은 수정 요청("좀 더 짧게", "말투 바꿔 줘")에 못을 박는다.
  //
  // 이런 요청에서 모델은 고친 결과를 글로만 써 놓고 표식을 잊는다 — 앞 차례에서 이미
  // 붙였으니 됐다고 보는 것처럼. 그런데 반영 버튼은 표식이 있을 때만 뜨고, 저장은
  // 초안을 통째로 덮어쓰므로 고친 부분만 적어 보내도 쓸 수 없다.
  const followUpDirective =
    draftFollowUp && draftTarget
      ? "\n\n[이번 요청은 방금 준 " +
        (draftTarget === "plan" ? "기획안" : "본문") +
        "을 고쳐 달라는 요청입니다]\n" +
        "- 무엇을 어떻게 고쳤는지 한 줄로 알리고, **고친 " +
        (draftTarget === "plan" ? "기획안 전체(모든 장면)" : "본문 전체") +
        "를 다시 내놓으세요.** 고친 조각만 알려 주면 안 됩니다.\n" +
        "- 답의 맨 끝에 " +
        (draftTarget === "plan" ? '{"kind":"plan"}' : '{"kind":"caption"}') +
        " 표식을 반드시 딱 한 번 붙이고, 그 안에 사람에게 보여 준 것과 **똑같은 글**을 넣으세요. " +
        "앞 차례에 표식을 붙였더라도 이번 답에 다시 붙여야 합니다 — 표식이 없으면 반영 버튼이 " +
        "뜨지 않아 사용자가 고친 글을 손으로 옮겨 적어야 합니다.\n" +
        "- 사용자가 고치라고 한 것만 고치고, 나머지는 방금 준 것을 그대로 유지하세요. " +
        "가이드의 필수 표기·해시태그·멘션은 짧게 줄일 때에도 빼지 마세요.\n" +
        "- 요청이 무엇을 가리키는지 모호하면 되묻되, 그때는 표식을 붙이지 마세요."
      : "";

  const systemInstruction =
    CAMPAIGN_AI_SYSTEM_INSTRUCTION +
    `\n\n아래는 지금 열어 둔 캠페인의 사실입니다. 캠페인에 관한 것은 모두 이 데이터와 ` +
    `첨부 파일을 근거로만 답하고, 없는 값은 지어내지 마세요.\n${campaignContext.text}` +
    campaignGuideStatus +
    (campaignVariation ? buildVariationDirective(campaignVariation) : "") +
    captionOnlyDirective +
    planDirective +
    followUpDirective;

  // 캠페인 화면은 기획안 전체를 다시 내놓는다(장면 5개에 설명·자막·나레이션, 거기에
  // 기계가 읽을 JSON 까지). 3072 로는 JSON 중간에 잘려 반영 버튼이 안 뜬다.
  const maxOutputTokens = 4096;

  // 무엇을 근거로 쓴 기획안인지 화면에도 알려 준다.
  //
  // 답만 보면 가이드를 읽고 쓴 것인지 알 수 없다. 실제로 읽은 파일 이름이 답 위에
  // 보이면, 사용자는 엉뚱한 기획안을 받았을 때 "가이드를 못 읽었구나"를 바로 알고
  // 파일을 다시 올릴 수 있다.
  const guideStatus = { read: guideFiles.map((f) => f.fileName), unread: skippedGuideFiles };

  // 초안 떼어내기.
  //
  // 표식이 빠진 답에서는 사람이 읽는 글에서 초안을 건져 낸다(extractCampaignDraft
  // 안쪽). 그때 본문인지 기획안인지 가리는 기준이 이번 요청의 뜻이라, 위에서 이미
  // 판정해 둔 대상을 그대로 넘긴다.
  //
  // 다만 대상을 이어받은 수정 요청("좀 더 짧게 해 줘")에는 넘기지 않는다. 그 층의
  // 마지막 수단은 "답 전체를 본문으로 본다"인데, 이런 답은 인사말("네, 짧게 줄여
  // 봤습니다")과 무엇을 고쳤는지 설명이 본문 앞에 붙어 있다. 그것까지 본문으로 저장하면
  // 사용자는 인사말이 들어간 캡션을 인스타에 올리게 된다 — 카드가 안 뜨는 것보다 나쁘다.
  // 이 경우는 아래 되묻기(repair)가 모델에게 본문만 다시 받아 온다.
  const captionSalvageAllowed = draftTarget === "caption" && !draftFollowUp;
  const campaignDraftOf = (raw: string): { reply: string; draft: CampaignDraft | null } =>
    extractCampaignDraft(raw, captionSalvageAllowed);

  // 초안을 만들어 내는 요청이었는데 표식도 없고 글에서도 못 건진 경우에만 되묻는다.
  //
  // 가이드 파일 이름만 있고 내용을 못 읽어서 모델이 "가이드를 다시 올려 달라"고 답한
  // 경우는 제외한다 — 그 답에는 옮겨 적을 초안이 없고, 되묻기는 호출만 한 번 늘린다.
  const guideUnreadable = campaignGuideCandidates.length > 0 && guideFiles.length === 0;
  const needsDraftRepair = (draft: CampaignDraft | null, reply: string): boolean =>
    !draft &&
    draftTarget !== null &&
    !guideUnreadable &&
    reply.trim().length >= 60;

  // ── Gemini ───────────────────────────────────
  const contents: { role: string; parts: any[] }[] = messages.slice(-MAX_TURNS).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }],
  }));

  // 가이드 파일은 마지막 사용자 차례에 inlineData 로 함께 보낸다.
  if (guideNote) {
    let lastUser = -1;
    for (let i = contents.length - 1; i >= 0; i--) {
      if (contents[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser >= 0) {
      const text = String(contents[lastUser].parts[0]?.text || "");
      contents[lastUser] = {
        role: "user",
        parts: [
          ...guideFiles.map((f) => ({ inlineData: { mimeType: f.mediaType, data: f.data } })),
          { text: guideNote + text },
        ],
      };
    }
  }

  let claimedUsageCount = 0;
  try {
    let claimed = false;
    const claimedState = await mutateBlobJSON<{ count?: number }>("ai-usage", usageKey, (current) => {
      const count = Math.max(0, Math.floor(Number(current?.count) || 0));
      if (count >= DAILY_LIMIT) return null;
      claimed = true;
      return { count: count + 1 };
    });
    if (!claimed) {
      return Response.json(
        {
          error: "오늘 사용할 수 있는 AI 질문 횟수를 모두 사용했어요. 내일 다시 이용해 주세요.",
          code: "RATE_LIMITED",
        },
        { status: 429 },
      );
    }
    claimedUsageCount = Math.max(1, Math.floor(Number(claimedState?.count) || 1));
  } catch (e) {
    console.error("[collab-ai] usage reservation failed", e);
    return Response.json(
      { error: "AI 사용량을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  const releaseUsage = async () => {
    await mutateBlobJSON<{ count?: number }>("ai-usage", usageKey, (current) => {
      const count = Math.max(0, Math.floor(Number(current?.count) || 0));
      return { count: Math.max(0, count - 1) };
    }).catch(() => null);
  };

  try {
    const res = await fetch(
      `${process.env.GOOGLE_GEMINI_BASE_URL}/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY as string,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          // 캡션·숏폼 대본·기획안 초안이 문장 중간에 끊기지 않도록 여유를 둔다.
          generationConfig: { temperature: 0.6, maxOutputTokens },
        }),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[collab-ai] Gemini error", res.status, detail);
      await releaseUsage();
      return Response.json(
        { error: "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }

    const data = await res.json();
    const rawReply: string =
      (data?.candidates?.[0]?.content?.parts || [])
        .map((p: any) => p?.text || "")
        .join("")
        .trim() || "죄송해요, 답변을 만들지 못했어요. 질문을 조금 더 구체적으로 적어 주세요.";
    const extracted = campaignDraftOf(rawReply);
    const reply = extracted.reply;
    let draft = extracted.draft;
    // 표식이 빠졌으면 한 번 더 묻는다(하루 사용량은 더 차감하지 않는다 — 같은 질문의 뒤처리다).
    if (needsDraftRepair(draft, reply)) {
      draft = await repairDraftWithGemini(draftTarget, reply, maxOutputTokens);
    }

    return Response.json({
      reply,
      draft,
      guide: guideStatus,
      model: "gemini",
      remaining: Math.max(0, DAILY_LIMIT - claimedUsageCount),
    });
  } catch (e) {
    console.error("[collab-ai] request failed", e);
    await releaseUsage();
    return Response.json(
      { error: "AI 응답 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/collab-ai",
};
