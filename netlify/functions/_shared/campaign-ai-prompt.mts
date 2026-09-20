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
 *   <<<PICKS_DRAFT {"kind":"plan","scenes":[{"visual":"…","subtitle":"…","narration":"…"}],"changes":["…"]} PICKS_DRAFT>>>
 *   <<<PICKS_DRAFT {"kind":"caption","text":"…","changes":["…"]} PICKS_DRAFT>>>
 *
 * `changes` 는 "이번에 무엇을 고쳤는가"를 한 줄씩 적은 목록이다(새로 쓴 답에는 없다).
 * 고친 내용을 글로도 설명하게 하지만, 그 설명은 답 본문 안에 문단으로 섞여 있어서
 * 초안 카드를 보며 짚어 볼 수가 없었다 — 사용자는 브랜드 피드백 세 줄이 전부 반영됐는지
 * 확인하려고 답을 위로 다시 굴려 읽어야 했다. 카드 안에 목록으로 세워 두면, 반영 버튼을
 * 누르기 전에 그 자리에서 대조할 수 있다.
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

/** 이번 수정에서 무엇을 고쳤는지 한 줄씩. 새로 쓴 초안에는 비어 있다. */
export type DraftChanges = string[];

export type CampaignDraft =
  | { kind: "plan"; scenes: DraftScene[]; changes?: DraftChanges }
  | { kind: "caption"; text: string; changes?: DraftChanges };

const SENTINEL_OPEN = "<<<PICKS_DRAFT";
const SENTINEL_CLOSE = "PICKS_DRAFT>>>";

/** 기획안 · 본문의 저장 한도. api-collab-workflow 의 save_step_work 와 같은 값이다. */
const MAX_SCENES = 40;
const MAX_VISUAL = 2000;
const MAX_SUBTITLE = 1000;
const MAX_NARRATION = 2000;
const MAX_CAPTION = 2200;
/** 고친 것 목록. 카드 안에서 읽는 목록이므로 길면 목록이 아니라 또 하나의 글이 된다. */
const MAX_CHANGES = 12;
const MAX_CHANGE_LINE = 300;

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

캠페인을 등록할 때 브랜드가 적어 둔 소개글·지원 요건·원하는 컨셉 메모는 이 요청에 들어 있지 않습니다. 일부러 뺐습니다 — 그 글은 지원자를 모으려고 쓴 홍보 문구이고, 실제로 지켜야 하는 촬영 규칙과 필수 표기는 가이드 파일에 있습니다. 아래 진행 기록의 캠페인 정보는 이름표(제목·브랜드·카테고리·채널·형식·일정)일 뿐이니, 그것을 근거로 기획 내용을 추측해 채우지 마세요.

### 어긋나면 가이드 파일이 이깁니다
이름표와 가이드 파일이 다른 이야기를 하는 경우가 실제로 있습니다. 캠페인 제목·카테고리에는 "로션"이라고 적혀 있는데 첨부된 가이드는 패션 화보 촬영 가이드인 경우처럼요. 그때는 **가이드 파일을 따라 쓰세요.** 제목이 로션이라는 이유로 로션 기획안을 쓰면, 사용자는 브랜드가 준 가이드와 아무 상관 없는 기획안을 제출하게 됩니다.

- 제품·품목·촬영 대상·컨셉·톤은 전부 가이드 파일에 적힌 것을 씁니다. 이름표의 카테고리로 덮어쓰지 마세요.
- 가이드에 나오는 제품명·품목명을 그대로 쓰세요. 이름표의 제품과 다르면 가이드 쪽을 쓰고, 답 끝의 "담당자 확인 필요:" 에 "캠페인 제목은 OO인데 가이드는 XX 기준입니다 — 어느 쪽이 맞는지 확인 부탁드립니다"를 한 줄 남기세요.
- 채널·형식·일정처럼 진행에 필요한 값도 가이드에 다르게 적혀 있으면 가이드를 따르고, 같은 방식으로 한 줄 남기세요.
- 가이드에 없는 항목만 이름표를 참고합니다.

파일에서 특히 놓치지 말아야 할 것:
- 무엇을 찍는 캠페인인지(제품·품목·촬영 대상)와 브랜드가 원하는 컨셉·톤
- 반드시 넣어야 하는 문구·해시태그·멘션·표기(예: 유료광고 표기, 브랜드 계정 태그)
- 반드시 보여 줘야 하는 장면(제품 클로즈업, 사용 전후, 패키지 노출, 착용 컷 등)
- 하면 안 되는 것(금지 표현, 경쟁사 노출, 의학적 효능 단정 등)
- 영상 길이·비율·자막 규칙
- 제품명·성분·소재·용법의 정확한 표기

### 기획안을 쓰기 전에 가이드를 먼저 되짚습니다
기획안이나 본문을 새로 쓸 때는, 장면을 쓰기 **전에** 답의 맨 앞에 아래 항목을 짧게 적으세요. 가이드를 실제로 읽고 쓴다는 것을 사용자가 확인할 수 있어야 하고, 잘못 읽었다면 장면까지 다 읽기 전에 바로잡을 수 있어야 합니다.

**가이드에서 확인한 것**
- 촬영 대상·제품: (가이드에 적힌 표현 그대로)
- 컨셉·톤: (가이드에 적힌 표현 그대로)
- 필수 표기·해시태그·멘션: (없으면 "가이드에 없음")
- 필수 장면: (없으면 "가이드에 없음")
- 금지 사항: (없으면 "가이드에 없음")
- 영상 규격(길이·비율·자막): (없으면 "가이드에 없음")

각 줄은 가이드에 적힌 말을 그대로 옮겨 씁니다. 가이드에 없는 것은 반드시 "가이드에 없음"이라고 쓰고, 그럴듯한 값을 채워 넣지 마세요. 이 항목을 채울 수 없다면 가이드를 읽지 못한 것이니, 기획안을 쓰는 대신 그 사실을 알리세요.

여기서 확인한 필수 항목은 기획안 장면 안에 실제로 배치하세요. "가이드 참고"라고 적기만 하고 장면에 넣지 않으면 안 됩니다. 가이드에 없어서 확인이 필요한 것은 답 끝에 "담당자 확인 필요:" 로 짧게 모아 주세요.

가이드 파일이 첨부되지 않았다면(진행 기록에 "아직 가이드 파일이 없습니다"라고 적혀 있습니다) 기획안을 지어내지 마세요. 브랜드 가이드 파일이 올라오지 않아서 그 내용대로 쓸 수 없다고 먼저 알리고, 담당자에게 가이드 파일을 요청하거나 가지고 있는 파일을 이 대화에 첨부해 달라고 안내하세요. 사용자가 그래도 초안을 원하면 무엇을 가정했는지 밝히고 쓰세요.

## 수정 요청을 받으면
아래 진행 기록에 지금 제출돼 있는 기획안과 브랜드 피드백이 그대로 들어 있습니다.
- 피드백 목록을 하나도 빠뜨리지 말고 반영하세요. 3건이면 3건 다입니다.
- 피드백이 몇 번 장면에 붙은 말인지 지키세요. "2번 장면" 피드백은 2번 장면을 고치는 것입니다.
- 지적받지 않은 장면은 그대로 두세요. 이유 없이 전체를 다시 쓰면 사용자가 검토할 수 없습니다.
- 이미 반영한 피드백을 되돌리지 마세요.
- 무엇을 왜 고쳤는지 장면 번호와 함께 짧게 설명하세요.
- 그리고 **고친 것을 표식 안의 \`changes\` 목록에도 한 줄씩 적으세요.** 사용자가 반영 버튼을 누르기 전에 초안 카드에서 바로 대조하는 목록입니다. 아래 '표식 규칙'에 쓰는 방식이 있습니다.

## 기획안을 쓰는 방식
- 장면은 5개 안팎으로, 첫 장면은 3초 안에 붙잡는 장면으로 시작하세요.
- 각 장면은 세 칸으로 씁니다. 설명(무엇을 어떻게 찍는지), 자막(화면에 뜨는 글자), 나레이션(말하는 대사).
- 설명은 촬영하는 사람이 그대로 찍을 수 있게 구체적으로 — "제품을 보여 준다"가 아니라 "세면대 위에서 펌프를 두 번 눌러 손에 덜어내는 모습을 위에서".
- 필수 표기·해시태그는 마지막 장면 자막이나 본문에 확실히 넣으세요.

### 나레이션을 원하지 않으면 넣지 마세요
사용자가 "나레이션 없이", "나레이션 빼고", "자막만으로", "대사 없이", "말 없이", "무성으로", "브이로그 자막형으로" 처럼 나레이션을 원하지 않는다고 하면 **그대로 따르세요.** 나레이션 없는 영상은 실제로 많고(자막형 릴스, 배경음악만 쓰는 컷 편집), 그때 대사를 채워 넣으면 사용자는 장면마다 나레이션을 손으로 지워야 합니다.

나레이션 없이 쓸 때:
- 모든 장면의 \`narration\` 을 빈 문자열("")로 두세요. "없음", "-", "(나레이션 없음)" 같은 글자를 넣지 마세요 — 그 글자가 그대로 기획안에 저장됩니다.
- 사람에게 보여 주는 답에서도 나레이션 줄을 아예 쓰지 마세요.
- 대사로 전하려던 정보는 자막과 설명으로 옮기세요. 나레이션을 빼는 것이 정보를 빼는 것이 되면 안 됩니다.
- 가이드 파일에 필수 멘트나 구두 표기가 적혀 있으면, 그것은 자막으로 넣고 답 끝의 "담당자 확인 필요:" 에 "가이드의 필수 멘트를 나레이션 없이 자막으로 넣었습니다 — 괜찮은지 확인 부탁드립니다"를 한 줄 남기세요.
- 한 번 나레이션 없이 쓴 뒤 이어지는 수정 요청에서도 계속 나레이션 없이 유지하세요. 사용자가 다시 넣어 달라고 할 때만 넣습니다.

반대로 "자막 없이"처럼 자막을 원하지 않는다고 하면 같은 방식으로 \`subtitle\` 을 빈 문자열로 두세요.

## 본문(캡션)을 쓰는 방식
- 첫 줄은 더보기 전에 보이는 줄이니 가장 중요한 말을 넣으세요.
- 실제로 써 본 사람의 말투로 쓰고, 가이드의 필수 문구·해시태그·계정 태그를 빠짐없이 넣으세요.
- 2200자를 넘기지 마세요.

## 답의 형식
먼저 사람에게 하는 말을 쓰세요. 기획안을 새로 쓰는 답이면 위의 **가이드에서 확인한 것**을 맨 앞에 놓고 그다음에 장면별로 읽기 좋게, 수정이면 무엇을 고쳤는지. 길게 늘이지 말고 필요한 만큼만.

그리고 기획안이나 본문을 **새로 쓰거나 고쳤을 때만**, 답의 맨 끝에 아래 표식을 딱 한 번 붙이세요. 사용자가 이걸 검토하고 버튼을 누르면 기획안에 그대로 저장됩니다.

기획안일 때:
${SENTINEL_OPEN} {"kind":"plan","scenes":[{"visual":"장면 설명","subtitle":"자막","narration":"나레이션"}],"changes":["2번 장면 자막: 브랜드 피드백대로 제품명을 앞으로 옮겼습니다"]} ${SENTINEL_CLOSE}

본문일 때:
${SENTINEL_OPEN} {"kind":"caption","text":"본문 전체","changes":["첫 줄에 제품명을 넣었습니다 (본문 캡션 피드백)"]} ${SENTINEL_CLOSE}

표식 규칙:
- 표식 안은 오직 JSON 한 덩어리입니다. 설명이나 \`\`\` 를 넣지 마세요.
- 고친 장면만 넣지 말고 **기획안 전체 장면을 순서대로 다 넣으세요.** 이 JSON 이 기획안을 통째로 대체합니다. 안 고친 장면도 그대로 다시 넣어야 합니다.
- 자막이나 나레이션이 없는 장면은 빈 문자열("")로 두세요. 칸 이름은 visual, subtitle, narration 그대로 쓰세요.
- 질문에 답만 하거나 되묻는 답에는 표식을 붙이지 마세요.

\`changes\` 쓰는 방식(고쳤을 때만):
- **고친 것 하나에 한 줄.** 브랜드 피드백을 반영한 답이면 피드백 건수와 줄 수가 같아야 합니다 — 3건을 반영했으면 3줄입니다.
- 어디를 어떻게 고쳤는지를 한 줄에 다 담으세요: "무엇을(2번 장면 자막 · 본문 첫 줄) · 어떻게 고쳤는지 · 왜(어느 피드백 때문인지)".
- 사용자가 시킨 수정(예: "나레이션 빼 줘")도 같은 방식으로 한 줄 적으세요.
- 반영하지 못한 피드백이 있으면 그 줄에 "반영하지 못했습니다: ~ 이유" 로 적으세요. 빠뜨린 채 적지 않으면 사용자는 다 반영된 줄로 믿습니다.
- 처음 쓰는 초안처럼 고친 것이 없으면 \`changes\` 를 아예 넣지 마세요. 빈 배열도 넣지 마세요.
- 12줄을 넘기지 말고, 한 줄은 한 문장으로 짧게 쓰세요.

한국어로, 존댓말로 답하세요.`;

/**
 * 빈 칸을 빈 칸으로 적어 주는 모델이 있다 — 나레이션 없이 써 달라고 했을 때
 * `narration` 을 "" 로 두는 대신 "없음"·"-"·"N/A" 를 넣는다. 그 글자는 그대로
 * 기획안에 저장되고, 브랜드 검수 화면에는 "나레이션 · 없음"으로 뜬다. 칸 전체가
 * 이 표현 하나뿐일 때만 빈 칸으로 본다 — 문장 안에 든 "없음"은 건드리지 않는다.
 */
const PLACEHOLDER_FIELD = /^(없음|없습니다|해당\s*없음|무|-{1,3}|—|n\/?a|none|null)$/i;

/**
 * "나레이션 없이" 를 말로 적어 놓은 경우.
 *
 * 나레이션 없는 기획안을 달라고 하면 모델이 칸을 비우는 대신 "(음원만 사용)",
 * "BGM만", "무음" 처럼 상태를 적어 넣는다. 그대로 저장하면 브랜드 화면의 나레이션
 * 칸에 그 말이 대사처럼 찍혀 나가므로, 칸 전체가 이 말뿐일 때는 빈 칸으로 본다.
 * 문장 안에 섞여 있으면(예: "음원만 사용하고 자막으로 …") 건드리지 않는다.
 */
const NO_NARRATION_FIELD =
  /^(?:음원|bgm|배경\s*음악|음악|사운드|소리)\s*(?:만)?\s*(?:사용|삽입|재생)?$|^무음$|^(?:나레이션|내레이션|대사|멘트)\s*(?:없이|생략|제외)$/i;

const emptyish = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const bare = trimmed.replace(/^[([{]\s*/, "").replace(/\s*[)\]}]$/, "");
  // "(나레이션 없음)" 처럼 칸 이름을 함께 적은 경우까지 같은 것으로 본다.
  const withoutLabel = bare.replace(/^(나레이션|자막|대사|내레이션)\s*[:·]?\s*/, "").trim();
  if (PLACEHOLDER_FIELD.test(bare) || PLACEHOLDER_FIELD.test(withoutLabel)) return "";
  if (NO_NARRATION_FIELD.test(bare) || NO_NARRATION_FIELD.test(withoutLabel)) return "";
  return trimmed;
};

/**
 * "이번에 고친 것" 목록을 다듬는다.
 *
 * 모델이 문자열 하나로 보내거나(줄바꿈으로 나열), 객체 배열로 보내는 경우가 있다.
 * 목록이 없다고 답을 버릴 이유는 없으므로 읽을 수 있는 모양은 최대한 받아 준다 —
 * 끝내 못 읽으면 undefined 로 두고, 화면은 목록 없이 초안만 보여 준다.
 */
const clampChanges = (raw: any): DraftChanges | undefined => {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/\r?\n/)
      : [];
  const lines = items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        // {"where":"2번 장면","what":"…"} 처럼 쪼개 보내는 모델도 있다.
        return [item.where, item.what ?? item.change ?? item.text ?? item.summary]
          .filter((v) => typeof v === "string" && v.trim())
          .join(" · ");
      }
      return "";
    })
    // 목록 기호를 앞에 붙여 오는 경우가 많다. 화면에서 기호를 다시 그리므로 벗겨 낸다.
    .map((line) => String(line).trim().replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, MAX_CHANGES)
    .map((line) => line.slice(0, MAX_CHANGE_LINE));
  return lines.length > 0 ? lines : undefined;
};

const clampScene = (raw: any): DraftScene => ({
  visual: String(raw?.visual ?? raw?.text ?? "").slice(0, MAX_VISUAL),
  subtitle: emptyish(String(raw?.subtitle ?? raw?.caption ?? "")).slice(0, MAX_SUBTITLE),
  narration: emptyish(String(raw?.narration ?? raw?.voice ?? "")).slice(0, MAX_NARRATION),
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
    const changes = clampChanges(parsed.changes);
    return { kind: "plan", scenes, ...(changes ? { changes } : {}) };
  }

  if (parsed.kind === "caption") {
    const text = String(parsed.text ?? parsed.caption ?? "").slice(0, MAX_CAPTION);
    if (!text.trim()) return null;
    const changes = clampChanges(parsed.changes);
    return { kind: "caption", text, ...(changes ? { changes } : {}) };
  }

  return null;
};

/**
 * 모델 답에서 초안 덩어리를 떼어낸다.
 *
 * 표식을 못 찾거나 JSON 이 깨져 있으면 사람이 읽는 글에서 같은 값을 건져 낸다
 * (아래 '표식이 없을 때' 단락). 표식이 있으면 항상 그쪽이 이긴다.
 *
 * @param captionRequested 이번 요청이 본문(캡션) 하나만 가리켰는지. 글에서 본문을
 *   건져 낼 때 경계를 어디까지 넓혀도 되는지가 이 값으로 갈린다.
 * @returns `reply` 는 표식을 지운 사람이 읽을 답, `draft` 는 반영 가능한 초안(없으면 null).
 */
export function extractCampaignDraft(
  reply: string,
  captionRequested = false,
): { reply: string; draft: CampaignDraft | null } {
  const raw = String(reply || "");
  if (!raw.includes(SENTINEL_OPEN)) {
    // 여는 표식이 없다. 닫는 표식만 흘러나온 경우가 있으므로 그것만 지운다 —
    // 사용자 화면에 표식 문자열이 그대로 보이면 안 된다. 그리고 글에서 초안을
    // 건져 낸다: 표식을 잊었을 뿐 기획안은 답 안에 다 쓰여 있는 경우다.
    const text = raw.split(SENTINEL_CLOSE).join("").trim();
    return { reply: text, draft: salvageDraft(text, captionRequested) };
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
  const readable = text.trim();

  // 표식은 있었지만 JSON 이 깨졌거나(설명이 섞임, 답이 잘림) 저장 규칙에 걸려 버려진
  // 경우. 글에는 기획안이 그대로 있으므로 거기서 건져 낸다.
  return { reply: readable, draft: draft || salvageDraft(readable, captionRequested) };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 표식이 없을 때 — 글에서 초안을 건져 낸다
 *
 * 위 규약은 모델이 답 끝에 JSON 표식을 붙여 준다는 전제에 서 있다. 그런데 표식은
 * 실제로 빠진다. 답이 길어져 마지막 토큰에서 잘리거나, 모델이 장면을 사람이 읽는
 * 글로만 예쁘게 써 놓고 표식을 잊거나, 표식 안에 설명을 섞어 JSON 이 깨진다.
 *
 * 표식이 없으면 초안 카드가 안 뜨고, 그러면 사용자는 완성된 기획안을 눈으로 읽고
 * 손으로 옮겨 적어야 한다 — 버튼 한 번이면 끝나는 일이다. "가끔 안 뜬다"는 것이
 * 실제로는 "믿을 수 없다"와 같아서, 사용자는 AI 가 쓴 기획안을 매번 복사할 준비를
 * 하고 읽게 된다.
 *
 * 그래서 표식이 없거나 못 읽었으면 사람이 읽는 글에서 같은 값을 건져 낸다. 모델이
 * 장면을 쓰는 모양은 지시문이 정해 두었으므로(장면 번호 → 설명 · 자막 · 나레이션)
 * 그 모양을 그대로 읽는다. 건져 낸 초안도 카드에서 고칠 수 있으니, 조금 어긋나게
 * 읽어도 사용자가 그 자리에서 바로잡을 수 있다 — 카드가 아예 안 뜨는 것보다 낫다.
 *
 * 건져 내기는 표식을 대신하지 않는다. 표식이 있으면 그것이 항상 이긴다(모델이 직접
 * 고른 값이고 `changes` 까지 들어 있다). 이 길은 마지막 그물이다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 마크다운 장식과 목록 기호를 벗긴다. 저장되는 것은 글이지 마크다운이 아니다. */
const plainLine = (line: string): string =>
  String(line || "")
    // 인용·목록 기호. 중첩 목록이라 여러 겹으로 붙어 온다("  - * 자막: …").
    .replace(/^\s*(?:[>\s]*)(?:[-*+•◦·]\s+)*/, "")
    // **굵게** · __굵게__ · *기울임* · `코드`
    .replace(/\*\*|__|`/g, "")
    .trim();

/**
 * 장면 머리줄인지 — "장면 3", "**장면 3: 마무리**", "컷 2)", "Scene 4".
 *
 * 번호를 요구하는 것이 핵심이다. 지시문은 답 맨 앞에 "필수 장면: …" 같은 가이드
 * 확인 목록을 쓰게 하는데, 번호 없이 '장면'이라는 낱말만 보면 그 줄까지 머리줄로
 * 읽어 가이드 요약이 1번 장면이 되어 버린다.
 */
const SCENE_HEAD_RE = /^(?:#{1,6}\s*)?(?:장면|씬|컷|scene|cut)\s*#?\s*(\d{1,2})\s*(?:[.):\-–~]|$)/i;

/**
 * 장면 나열이 끝나는 자리. 지시문이 장면 뒤에 쓰게 하는 꼬리 단락들이다
 * ("담당자 확인 필요:", 수평선, 본문 섹션). 여기서 끊지 않으면 마지막 장면의
 * 설명 칸에 이 단락이 통째로 들어간다.
 */
const SCENE_STOP_RE =
  /^(?:-{3,}|_{3,}|\*{3,}|(?:#{1,6}\s*)?(?:담당자\s*확인\s*필요|확인\s*필요|확인이?\s*필요한?\s*것|참고\s*사항|비고|다음\s*단계|추가\s*제안|본문|캡션|인스타그램\s*본문|해시태그)\s*[::]?\s*$)/i;

/** 장면 안의 칸 이름. 앞의 것이 먼저 걸린다("장면 설명"이 "장면"보다 앞). */
const SCENE_FIELD_LABELS: { key: keyof DraftScene; re: RegExp }[] = [
  { key: "visual", re: /^(?:장면\s*설명|영상\s*설명|화면\s*설명|설명|영상|화면|비주얼|촬영|visual)\s*[::]\s*/i },
  { key: "subtitle", re: /^(?:화면\s*자막|자막|텍스트|subtitle|caption)\s*[::]\s*/i },
  { key: "narration", re: /^(?:나레이션|내레이션|대사|멘트|보이스|음성|narration|voice\s*over|vo)\s*[::]\s*/i },
];

/**
 * 사람이 읽는 글에서 장면을 읽어 낸다.
 *
 * 칸 이름을 붙이지 않고 장면을 한 문단으로 쓴 답도 있다. 그때는 문단 전체를 설명으로
 * 둔다 — 설명은 기획안에서 유일한 필수 칸이고, 자막·나레이션을 비워 둔 초안은
 * 저장할 수 있다. 사용자가 카드에서 채우면 된다.
 */
const salvagePlan = (text: string): CampaignDraft | null => {
  const lines = String(text || "").split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const rawLine of lines) {
    const line = plainLine(rawLine);
    if (SCENE_HEAD_RE.test(line)) {
      current = [];
      blocks.push(current);
      // 머리줄에 제목을 같이 적는 경우("장면 1: 첫 3초")가 있는데, 그 제목은 촬영
      // 지시가 아니라 이름표다. 설명으로 옮기지 않는다.
      continue;
    }
    if (!current) continue;
    if (SCENE_STOP_RE.test(line)) {
      current = null;
      continue;
    }
    current.push(line);
  }

  const scenes: DraftScene[] = [];
  for (const block of blocks) {
    const found: DraftScene = { visual: "", subtitle: "", narration: "" };
    /** 지금 이어 붙이는 칸. 한 칸이 여러 줄로 이어지는 일이 흔하다. */
    let cursor: keyof DraftScene | null = null;
    const loose: string[] = [];

    for (const line of block) {
      if (!line) {
        cursor = null;
        continue;
      }
      const label = SCENE_FIELD_LABELS.find((f) => f.re.test(line));
      if (label) {
        cursor = label.key;
        const value = line.replace(label.re, "").trim();
        found[cursor] = found[cursor] ? `${found[cursor]}\n${value}` : value;
        continue;
      }
      if (cursor) {
        found[cursor] = found[cursor] ? `${found[cursor]}\n${line}` : line;
        continue;
      }
      loose.push(line);
    }

    // 칸 이름 없이 쓴 줄은 설명으로 본다. 이름 붙은 설명이 이미 있으면 그 뒤에 붙인다.
    if (loose.length > 0) {
      const extra = loose.join("\n").trim();
      found.visual = found.visual ? `${found.visual}\n${extra}` : extra;
    }

    const scene = clampScene(found);
    if (scene.visual.trim()) scenes.push(scene);
  }

  /*
   * 장면이 하나뿐이면 기획안으로 보지 않는다.
   *
   * "1번 장면은 이렇게 바꾸면 좋겠어요" 처럼 한 장면만 이야기하는 답이 실제로 있고,
   * 그것을 기획안으로 읽으면 반영 버튼이 나머지 장면을 지운다(초안 JSON 이 기획안을
   * 통째로 대체한다). 한 장면만 고치는 답에 표식이 빠졌다면, 카드가 안 뜨는 쪽이
   * 기획안을 잃는 쪽보다 낫다.
   */
  if (scenes.length < 2) return null;
  return { kind: "plan", scenes: scenes.slice(0, MAX_SCENES) };
};

/** 본문 섹션 머리줄 — "**본문:**", "## 인스타그램 본문", "캡션 초안". */
const CAPTION_HEAD_RE =
  /^(?:#{1,6}\s*)?(?:인스타그램\s*)?(?:본문|캡션|caption)\s*(?:초안|\(캡션\)|안)?\s*[::]?\s*$/i;

/** 본문 뒤에 붙는 꼬리 단락. 여기서부터는 본문이 아니다. */
const CAPTION_STOP_RE =
  /^(?:-{3,}|_{3,}|\*{3,}|(?:#{1,6}\s*)?(?:담당자\s*확인\s*필요|확인\s*필요|확인이?\s*필요한?\s*것|참고\s*사항|비고|다음\s*단계|추가\s*제안|가이드에서\s*확인한\s*것)\s*[::]?\s*$)/i;

/**
 * 사람이 읽는 글에서 본문(캡션)을 건져 낸다.
 *
 * 본문은 장면처럼 생긴 모양이 없어서 경계를 잡는 것이 전부다. 순서대로 본다.
 *   1. ``` 로 감싼 덩어리 — 모델이 "그대로 복사하세요"의 뜻으로 가장 자주 쓰는 모양.
 *   2. "본문:" 머리줄 뒤부터 꼬리 단락 전까지.
 *   3. (본문만 써 달라는 요청이었을 때) 인사말 한 줄을 떼어낸 나머지 전체.
 *
 * 3번은 요청이 본문 하나만 가리켰을 때만 쓴다. 질문에 답한 글을 본문으로 읽으면
 * 엉뚱한 글이 카드에 올라오는데, 무엇을 물어도 카드가 뜨는 화면은 카드를 믿을 수
 * 없게 만든다.
 */
const salvageCaption = (text: string, captionRequested: boolean): CampaignDraft | null => {
  const raw = String(text || "");

  // 1. 코드 블록. 가장 긴 것을 고른다 — 해시태그만 따로 감싸는 경우가 있다.
  const fenced = [...raw.matchAll(/```[a-z]*\s*\n([\s\S]*?)```/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  if (fenced) return { kind: "caption", text: fenced.slice(0, MAX_CAPTION) };

  const lines = raw.split(/\r?\n/);
  const headAt = lines.findIndex((line) => CAPTION_HEAD_RE.test(plainLine(line)));

  let body: string[];
  if (headAt >= 0) {
    body = [];
    for (const rawLine of lines.slice(headAt + 1)) {
      if (CAPTION_STOP_RE.test(plainLine(rawLine))) break;
      body.push(rawLine);
    }
  } else if (captionRequested) {
    // 첫 줄이 "아래와 같이 작성했습니다" 같은 인사말이면 떼어낸다. 본문에 들어가면
    // 인스타에 그 말이 그대로 올라간다. 짧고 다음 줄이 비어 있을 때만 인사말로 본다.
    const start =
      lines.length > 2 && plainLine(lines[0]).length > 0 && plainLine(lines[0]).length <= 80 &&
      !plainLine(lines[1]).trim()
        ? 2
        : 0;
    body = [];
    for (const rawLine of lines.slice(start)) {
      if (CAPTION_STOP_RE.test(plainLine(rawLine))) break;
      body.push(rawLine);
    }
  } else {
    return null;
  }

  // 마크다운 장식만 걷어낸다. 줄바꿈과 해시태그는 본문의 일부이므로 그대로 둔다.
  const cleaned = body
    .map((line) => line.replace(/\*\*|__|`/g, "").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length < 20) return null;
  return { kind: "caption", text: cleaned.slice(0, MAX_CAPTION) };
};

/**
 * 글에서 초안을 건져 낸다. 기획안을 먼저 본다.
 *
 * 순서가 중요하다. 기획안 답에도 마지막 장면 자막이나 꼬리에 본문·해시태그가 함께
 * 실려 오는 일이 흔한데, 본문을 먼저 보면 장면이 다섯 개 쓰여 있는 답에서 본문
 * 카드가 떠 버린다. 장면이 읽히면 그 답의 결과물은 기획안이다.
 *
 * 다만 요청이 본문 하나만 가리켰다면(captionRequested) 본문을 먼저 본다 — 그때
 * 글에 장면처럼 보이는 줄이 있어도 사용자가 받으려던 것은 본문이다.
 */
const salvageDraft = (text: string, captionRequested: boolean): CampaignDraft | null => {
  if (!text.trim()) return null;
  if (captionRequested) {
    return salvageCaption(text, true) || salvagePlan(text);
  }
  return salvagePlan(text) || salvageCaption(text, false);
};
