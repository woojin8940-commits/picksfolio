/**
 * 캠페인 AI 어시스턴트의 지시문과 "초안 규약".
 *
 * 협업 타임라인 AI 는 협업 전체를 아는 비서지만, 캠페인 화면의 AI 는 하는 일이 하나다 —
 * 열어 둔 캠페인의 기획안과 인스타 본문을 쓰고, 브랜드 피드백에 맞춰 고치는 것. 그래서
 * 지시문도 따로 둔다. 타임라인 쪽 지시문에 캠페인용 규칙을 덧붙이는 방식으로는, 한쪽을
 * 고칠 때 다른 화면의 답이 같이 흔들린다.
 *
 * ── 초안 규약 ──────────────────────────────────────────────────────────
 * 이 AI 의 답은 읽히기만 해서는 쓸모가 없다. 사용자가 검토하고 "수정하기"를 누르면
 * 고친 그대로 기획안에 들어가야 한다. 그래서 모델에게 답 맨 끝에 딱 한 번, 아래 표식
 * 사이에 기계가 읽을 JSON 을 붙이게 한다.
 *
 *   <<<PICKS_DRAFT {"kind":"plan","scenes":[{"visual":"…","subtitle":"…","narration":"…"}]} PICKS_DRAFT>>>
 *   <<<PICKS_DRAFT {"kind":"caption","text":"…"} PICKS_DRAFT>>>
 *
 * 서버가 이 덩어리를 떼어내 draft 로 내려주고, 화면은 그 draft 를 검토 카드로 보여 준다.
 * 표식은 답에서 지워서 사용자에게는 보이지 않는다.
 *
 * 카드는 읽기 전용이 아니다 — 사용자가 카드 안에서 장면 글을 직접 고친 뒤 반영할 수
 * 있다(CampaignAiAssistant 의 초안 카드). 그래서 이 JSON 은 "최종안"이 아니라 "고칠
 * 수 있는 시작점"이다. 장면 칸 이름(visual·subtitle·narration)이 기획안 입력 폼과
 * 같아야 하는 이유도 여기 있다: 카드에서 고친 값이 그대로 save_step_work 로 간다.
 *
 * JSON 을 못 읽어도 답 자체는 살아 있어야 한다 — 파싱이 실패하면 표식만 지우고 글로만
 * 보여 준다. 초안 카드가 안 뜨는 것은 불편이지만, 답 대신 오류가 뜨는 것은 고장이다.
 */

/** 장면 필드는 기획안 입력 폼의 칸 이름과 정확히 같아야 한다 — 그대로 반영되기 때문이다. */
export interface DraftScene {
  visual: string;
  subtitle: string;
  narration: string;
}

export type CampaignDraft =
  | { kind: "plan"; scenes: DraftScene[] }
  | { kind: "caption"; text: string };

const SENTINEL_OPEN = "<<<PICKS_DRAFT";
const SENTINEL_CLOSE = "PICKS_DRAFT>>>";

/** 기획안 · 본문의 저장 한도. api-collab-workflow 의 save_step_work 와 같은 값이다. */
const MAX_SCENES = 40;
const MAX_VISUAL = 2000;
const MAX_SUBTITLE = 1000;
const MAX_NARRATION = 2000;
const MAX_CAPTION = 2200;

export const CAMPAIGN_AI_SYSTEM_INSTRUCTION = `당신은 픽스폴리오 캠페인 화면의 콘텐츠 기획 담당입니다. 인플루언서 한 명이 지금 진행 중인 캠페인 한 건의 화면에서 당신을 열었습니다.

## 당신이 하는 일
딱 네 가지입니다.
1. 이 캠페인의 기획안(장면별 콘티) 작성
2. 이 캠페인의 인스타그램 본문(캡션) 작성
3. 기획안 수정
4. 본문 수정

이 캠페인 말고 다른 캠페인, 담당자와의 대화, 정산·배송 같은 진행 문의는 당신 일이 아닙니다. 그런 질문을 받으면 "그건 협업 타임라인의 AI 어시스턴트나 담당자에게 물어보시는 게 정확합니다"라고 한 줄로 안내하고, 기획안·본문 쪽으로 돌아오세요. 아는 척해서 캠페인 조건을 지어내지 마세요.

## 기획의 근거는 첨부된 가이드 파일뿐입니다
브랜드가 진행 화면에 올린 가이드 파일이 이 요청에 이미지·PDF 로 함께 첨부되어 있습니다. **기획안이나 본문을 쓸 때는 첨부 파일을 먼저 끝까지 읽고, 거기 적힌 내용만을 기준으로 쓰세요.**

캠페인을 등록할 때 브랜드가 적어 둔 소개글·지원 요건·원하는 컨셉 메모는 이 요청에 들어 있지 않습니다. 일부러 뺐습니다 — 그 글은 지원자를 모으려고 쓴 홍보 문구이고, 실제로 지켜야 하는 촬영 규칙과 필수 표기는 가이드 파일에 있습니다. 아래 진행 기록의 캠페인 정보는 이름표(제목·브랜드·채널·형식·일정)일 뿐이니, 그것을 근거로 기획 내용을 추측해 채우지 마세요.

파일에서 특히 놓치지 말아야 할 것:
- 반드시 넣어야 하는 문구·해시태그·멘션·표기(예: 유료광고 표기, 브랜드 계정 태그)
- 반드시 보여 줘야 하는 장면(제품 클로즈업, 사용 전후, 패키지 노출 등)
- 하면 안 되는 것(금지 표현, 경쟁사 노출, 의학적 효능 단정 등)
- 영상 길이·비율·자막 규칙
- 제품명·성분·용법의 정확한 표기

가이드에서 확인한 필수 항목은 기획안 장면 안에 실제로 배치하세요. "가이드 참고"라고 적기만 하고 장면에 넣지 않으면 안 됩니다. 가이드에 없어서 확인이 필요한 것은 답 끝에 "담당자 확인 필요:" 로 짧게 모아 주세요.

가이드 파일이 첨부되지 않았다면(진행 기록에 "아직 가이드 파일이 없습니다"라고 적혀 있습니다) 기획안을 지어내지 마세요. 브랜드 가이드 파일이 올라오지 않아서 그 내용대로 쓸 수 없다고 먼저 알리고, 담당자에게 가이드 파일을 요청하거나 가지고 있는 파일을 이 대화에 첨부해 달라고 안내하세요. 사용자가 그래도 초안을 원하면 무엇을 가정했는지 밝히고 쓰세요.

## 수정 요청을 받으면
아래 진행 기록에 지금 제출돼 있는 기획안과 브랜드 피드백이 그대로 들어 있습니다.
- 피드백 목록을 하나도 빠뜨리지 말고 반영하세요. 3건이면 3건 다입니다.
- 피드백이 몇 번 장면에 붙은 말인지 지키세요. "2번 장면" 피드백은 2번 장면을 고치는 것입니다.
- 지적받지 않은 장면은 그대로 두세요. 이유 없이 전체를 다시 쓰면 사용자가 검토할 수 없습니다.
- 이미 반영한 피드백을 되돌리지 마세요.
- 무엇을 왜 고쳤는지 장면 번호와 함께 짧게 설명하세요.

## 기획안을 쓰는 방식
- 장면은 5개 안팎으로, 첫 장면은 3초 안에 붙잡는 장면으로 시작하세요.
- 각 장면은 세 칸으로 씁니다. 설명(무엇을 어떻게 찍는지), 자막(화면에 뜨는 글자), 나레이션(말하는 대사).
- 설명은 촬영하는 사람이 그대로 찍을 수 있게 구체적으로 — "제품을 보여 준다"가 아니라 "세면대 위에서 펌프를 두 번 눌러 손에 덜어내는 모습을 위에서".
- 필수 표기·해시태그는 마지막 장면 자막이나 본문에 확실히 넣으세요.

## 본문(캡션)을 쓰는 방식
- 첫 줄은 더보기 전에 보이는 줄이니 가장 중요한 말을 넣으세요.
- 실제로 써 본 사람의 말투로 쓰고, 가이드의 필수 문구·해시태그·계정 태그를 빠짐없이 넣으세요.
- 2200자를 넘기지 마세요.

## 답의 형식
먼저 사람에게 하는 말을 쓰세요. 기획안이면 장면별로 읽기 좋게, 수정이면 무엇을 고쳤는지. 길게 늘이지 말고 필요한 만큼만.

그리고 기획안이나 본문을 **새로 쓰거나 고쳤을 때만**, 답의 맨 끝에 아래 표식을 딱 한 번 붙이세요. 사용자가 이걸 검토하고 버튼을 누르면 기획안에 그대로 저장됩니다.

기획안일 때:
${SENTINEL_OPEN} {"kind":"plan","scenes":[{"visual":"장면 설명","subtitle":"자막","narration":"나레이션"}]} ${SENTINEL_CLOSE}

본문일 때:
${SENTINEL_OPEN} {"kind":"caption","text":"본문 전체"} ${SENTINEL_CLOSE}

표식 규칙:
- 표식 안은 오직 JSON 한 덩어리입니다. 설명이나 \`\`\` 를 넣지 마세요.
- 고친 장면만 넣지 말고 **기획안 전체 장면을 순서대로 다 넣으세요.** 이 JSON 이 기획안을 통째로 대체합니다. 안 고친 장면도 그대로 다시 넣어야 합니다.
- 자막이나 나레이션이 없는 장면은 빈 문자열("")로 두세요. 칸 이름은 visual, subtitle, narration 그대로 쓰세요.
- 질문에 답만 하거나 되묻는 답에는 표식을 붙이지 마세요.

한국어로, 존댓말로 답하세요.`;

const clampScene = (raw: any): DraftScene => ({
  visual: String(raw?.visual ?? raw?.text ?? "").slice(0, MAX_VISUAL),
  subtitle: String(raw?.subtitle ?? raw?.caption ?? "").slice(0, MAX_SUBTITLE),
  narration: String(raw?.narration ?? raw?.voice ?? "").slice(0, MAX_NARRATION),
});

const parseDraftJson = (raw: string): CampaignDraft | null => {
  // 표식 안에 ``` 를 넣지 말라고 했지만 넣는 모델도 있다. 답을 버리는 대신 벗겨 낸다.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!cleaned) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.kind === "plan") {
    if (!Array.isArray(parsed.scenes)) return null;
    const scenes = parsed.scenes
      .slice(0, MAX_SCENES)
      .map(clampScene)
      // 세 칸이 모두 빈 장면은 저장해도 사라지므로 미리 뺀다.
      .filter((s: DraftScene) => s.visual.trim() || s.subtitle.trim() || s.narration.trim());
    if (scenes.length === 0) return null;
    // 저장 규칙과 같다 — 설명이 빈 장면은 등록할 수 없다.
    if (scenes.some((s: DraftScene) => !s.visual.trim())) return null;
    return { kind: "plan", scenes };
  }

  if (parsed.kind === "caption") {
    const text = String(parsed.text ?? parsed.caption ?? "").slice(0, MAX_CAPTION);
    if (!text.trim()) return null;
    return { kind: "caption", text };
  }

  return null;
};

/**
 * 모델 답에서 초안 덩어리를 떼어낸다.
 *
 * @returns `reply` 는 표식을 지운 사람이 읽을 답, `draft` 는 반영 가능한 초안(없으면 null).
 */
export function extractCampaignDraft(reply: string): { reply: string; draft: CampaignDraft | null } {
  const raw = String(reply || "");
  if (!raw.includes(SENTINEL_OPEN)) {
    // 여는 표식이 없으면 초안도 없다. 닫는 표식만 흘러나온 경우가 있으므로 그것만
    // 지운다 — 사용자 화면에 표식 문자열이 그대로 보이면 안 된다.
    return { reply: raw.split(SENTINEL_CLOSE).join("").trim(), draft: null };
  }

  // 표식을 여러 번 붙였다면 마지막 것이 최종안이다.
  const pattern = new RegExp(
    `${SENTINEL_OPEN.replace(/[<]/g, "\\<")}([\\s\\S]*?)${SENTINEL_CLOSE.replace(/[>]/g, "\\>")}`,
    "g",
  );
  const blocks = [...raw.matchAll(pattern)];

  let draft: CampaignDraft | null = null;
  for (let i = blocks.length - 1; i >= 0 && !draft; i -= 1) {
    draft = parseDraftJson(blocks[i][1]);
  }

  let text = raw.replace(pattern, "");
  // 닫는 표식을 빼먹었거나 답이 잘려 끝난 경우. 열린 표식 뒤는 사람이 읽을 글이 아니므로
  // 통째로 버린다. 남겨 두면 사용자 화면에 JSON 조각이 그대로 보인다.
  const dangling = text.indexOf(SENTINEL_OPEN);
  if (dangling >= 0) {
    if (!draft) draft = parseDraftJson(text.slice(dangling + SENTINEL_OPEN.length));
    text = text.slice(0, dangling);
  }
  text = text.split(SENTINEL_CLOSE).join("");

  return { reply: text.trim(), draft };
}
