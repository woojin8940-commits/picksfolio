import { BlobWriteConflictError, mutateBlobJSON } from "./blob-write.mts";

/**
 * 같은 가이드로 여러 명이 기획안을 받을 때, 서로 다른 방향을 잡게 하는 자리.
 *
 * 브랜드는 인플루언서 50명에게 같은 가이드 파일 하나를 올린다. 그 파일이 기획의 유일한
 * 근거이고(campaign-ai-context 참고), 모델도 지시문도 같으니 결과는 서로 닮는다 —
 * 실제로 "세면대 앞 클로즈업 → 사용 장면 → 전후 비교 → 해시태그"가 거의 같은 순서로
 * 나온다. 브랜드 검수 화면에는 그 50건이 나란히 놓이고, 업로드된 릴스도 서로 닮는다.
 * 인플루언서에게는 "AI 가 찍어 준 남의 기획안"이 되고, 브랜드에게는 50명에게 돈을 주고
 * 같은 콘텐츠를 한 번 만든 결과가 된다.
 *
 * 그래서 사람마다 **창작 방향 하나**를 배정해 지시문에 싣는다. 방향은 훅·구성·톤·첫
 * 줄·강조점 다섯 축의 조합이고, 가이드 준수(필수 표기·해시태그·제품명·금지 사항)보다
 * 아래에 있다 — 방향은 "같은 규칙 안에서 어떻게 다르게 풀지"만 정한다.
 *
 * ── 배정은 캠페인 안에서 자리를 나눠 갖는 방식이다 ─────────────────────
 * 아이디를 해시해서 축을 고르면 구현은 간단하지만, 같은 캠페인의 두 사람이 같은 조합을
 * 뽑는 일을 막을 수 없다. 그래서 캠페인마다 "다음 번호"를 블롭에 두고 협업 한 건에
 * 번호 하나를 배정한다(선착순, 한 번 배정하면 고정). 축마다 길이와 서로소인 보폭으로
 * 번호를 돌리므로, 번호가 1 만 달라도 다섯 축이 모두 다른 값이 된다.
 *
 * 번호를 고정해 두는 이유: 같은 사람이 "좀 더 짧게 해 줘"로 다시 물을 때마다 방향이
 * 바뀌면, 수정이 수정이 아니라 매번 새 기획안이 된다.
 *
 * 저장소를 못 읽으면 아이디 해시로 떨어진다 — 방향이 겹칠 수는 있어도 답을 못 만드는
 * 일은 없어야 한다.
 *
 * 남의 기획안 내용은 절대 싣지 않는다. 배정받은 축의 이름만 프롬프트에 들어간다.
 */

const STORE = "campaign-ai-variation";

/** 한 캠페인 문서가 무한히 자라지 않게 — 오래된 배정부터 버린다(번호는 계속 늘어난다). */
const MAX_SEATS = 600;
const TRIM_TO = 500;

type SeatDoc = {
  /** 다음에 배정할 번호. 배정을 버려도 되돌리지 않는다. */
  next: number;
  /** 협업 아이디 → 배정된 번호. */
  seats: Record<string, number>;
};

export interface CampaignVariation {
  /** 배정된 방향 번호. 같은 캠페인 안에서는 서로 다르다. */
  index: number;
  hook: string;
  structure: string;
  tone: string;
  opening: string;
  emphasis: string;
}

/* 축의 길이는 서로 다른 소수 쪽이 좋다 — 번호가 늘어도 조합이 빨리 반복되지 않는다. */
const HOOKS = [
  "궁금증으로 여는 훅 — 결과나 반전을 먼저 보여 주고 이유를 뒤에 두기",
  "문제 장면으로 여는 훅 — 겪고 있던 불편을 첫 컷에 그대로 보여 주기",
  "전후 대비로 여는 훅 — 바뀐 상태를 먼저 붙이고 과정을 되짚기",
  "말 걸기로 여는 훅 — 보는 사람에게 바로 묻는 한마디로 시작하기",
  "일상 브이로그로 여는 훅 — 하루 흐름 안에 제품이 자연스럽게 끼어드는 방식",
  "솔직한 후기 톤의 훅 — 처음엔 반신반의했다는 고백으로 시작하기",
  "개수·시간 같은 숫자로 여는 훅 — '3주 쓰고 남은 것' 처럼 구체적인 수로 시작하기",
];
const STRUCTURES = [
  "시간 순서 구성 — 아침에서 밤까지, 또는 첫날에서 마지막 날까지",
  "문제 → 시도 → 결과 구성",
  "비교 구성 — 전에 쓰던 방식과 지금 방식을 번갈아 보여 주기",
  "체크리스트 구성 — 짚어 볼 것을 하나씩 확인해 나가기",
  "한 장면 집중 구성 — 한 상황을 길게 보여 주고 디테일로 채우기",
];
const TONES = [
  "차분하고 담백한 말투 — 감탄사 없이 사실만",
  "친구에게 말하듯 편한 반말 느낌의 구어체(본문은 존댓말 유지)",
  "꼼꼼한 리뷰어 말투 — 조건과 기준을 짚어 주는 투",
  "밝고 가벼운 말투 — 짧은 문장을 빠르게",
  "감성적인 말투 — 장면과 기분을 묘사하는 문장 위주",
  "정보 전달 중심의 말투 — 군더더기 없이 요점부터",
  "무심한 듯 담담한 말투 — 과장 없이 툭 던지는 문장",
];
const OPENINGS = [
  "첫 줄은 질문으로",
  "첫 줄은 상황 묘사 한 문장으로",
  "첫 줄은 결론(가장 좋았던 점)부터",
  "첫 줄은 숫자나 기간을 넣어서",
  "첫 줄은 짧은 감탄 한마디 뒤에 바로 본론으로",
];
const EMPHASES = [
  "사용하는 순간의 감각(질감·향·온도·소리)을 강조",
  "쓰기 전과 후의 차이를 강조",
  "누구에게 맞는지(상황·체형·피부·생활 패턴)를 강조",
  "쓰는 방법과 순서를 강조",
  "가격·용량 대비 실제로 쓴 기간을 강조",
  "제품이 끼어드는 일상의 맥락(장소·시간대)을 강조",
];

/** 문자열 → 32비트 해시. 저장소를 못 읽을 때 번호를 정하는 데만 쓴다. */
const hash32 = (raw: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/**
 * 방향 번호 → 다섯 축.
 *
 * 축 길이와 서로소인 보폭으로 각 축을 돌린다. 번호가 이어지는 두 사람은 다섯 축이
 * 모두 다른 값을 받는다.
 */
export function variationOfIndex(index: number): CampaignVariation {
  const i = Math.max(0, Math.floor(index));
  return {
    index: i,
    hook: HOOKS[i % HOOKS.length],
    structure: STRUCTURES[(i * 2) % STRUCTURES.length],
    tone: TONES[(i * 3) % TONES.length],
    opening: OPENINGS[(i * 3) % OPENINGS.length],
    emphasis: EMPHASES[(i * 5) % EMPHASES.length],
  };
}

/**
 * 이 협업에 배정된 창작 방향을 가져온다(없으면 그 자리에서 배정한다).
 *
 * @param campaignId 같은 캠페인 안에서 번호를 나눠 갖는 단위. 없으면 협업 아이디로 대체한다.
 * @param collabId   협업 한 건 = 인플루언서 한 명.
 */
export async function resolveCampaignVariation(
  campaignId: string,
  collabId: string,
  username: string,
): Promise<CampaignVariation> {
  const key = `campaign/${String(campaignId || collabId || "unknown").replace(/[^\w.-]/g, "_")}`;
  const seatId = String(collabId || username || "unknown");
  // 다섯 축의 보폭이 만드는 조합의 주기 = lcm(7,5,7,5,6) = 210.
  const fallback = () => variationOfIndex(hash32(`${key}|${seatId}`) % 210);

  if (!seatId) return fallback();

  // 콜백 안에서 정한 값을 밖으로 들고 나온다.
  const picked: { seat: number | null } = { seat: null };
  try {
    await mutateBlobJSON<SeatDoc>(STORE, key, (current) => {
      const seats = { ...(current?.seats || {}) };
      const existing = seats[seatId];
      if (Number.isInteger(existing)) {
        picked.seat = Number(existing);
        return null; // 이미 배정돼 있다 — 쓰지 않는다.
      }
      const next = Math.max(0, Math.floor(Number(current?.next) || 0));
      picked.seat = next;
      seats[seatId] = next;

      const ids = Object.keys(seats);
      if (ids.length > MAX_SEATS) {
        // 오래 전에 배정한 것부터 버린다. 그 협업이 다시 물어보면 새 번호를 받는데,
        // 캠페인이 이미 끝난 뒤일 가능성이 높아 방향이 바뀌어도 잃을 것이 없다.
        for (const id of ids.slice(0, ids.length - TRIM_TO)) delete seats[id];
      }
      return { next: next + 1, seats };
    });
  } catch (err) {
    if (!(err instanceof BlobWriteConflictError)) {
      console.error(`[campaign-ai-variation] 방향 배정 실패 (${key})`, err);
    }
    return fallback();
  }

  return picked.seat === null ? fallback() : variationOfIndex(picked.seat);
}

/** 배정받은 방향을 지시문에 붙일 문장으로. */
export function buildVariationDirective(v: CampaignVariation): string {
  return (
    "\n\n[이 인플루언서에게 배정된 창작 방향 — 같은 가이드를 받은 다른 인플루언서와 겹치지 않게]\n" +
    "같은 브랜드 가이드가 다른 인플루언서 여러 명에게도 올라가 있습니다. 가이드가 요구하는 것은 " +
    "모두 그대로 지키되, **구성과 말투는 아래 방향으로 풀어 주세요.** 그래야 브랜드가 받는 기획안이 " +
    "서로 다른 콘텐츠가 됩니다.\n" +
    `- 훅(첫 장면): ${v.hook}\n` +
    `- 구성: ${v.structure}\n` +
    `- 말투: ${v.tone}\n` +
    `- 본문 첫 줄: ${v.opening}\n` +
    `- 강조점: ${v.emphasis}\n` +
    "규칙:\n" +
    "- 이 방향은 가이드보다 아래입니다. 필수 표기·해시태그·멘션·제품명·필수 장면·금지 사항·영상 " +
    "규격은 가이드에 적힌 그대로 지키세요. 방향과 부딪히면 가이드를 따릅니다.\n" +
    "- 방향 이름을 답에 적지 마세요(사용자에게 보여 주는 설정값이 아닙니다). 결과물에만 드러나게 하세요.\n" +
    "- 장면 설명·자막·나레이션·본문 문장은 이 방향에 맞춰 직접 쓰세요. 흔한 템플릿 문장" +
    "(\"오늘은 ○○를 소개합니다\", \"함께 알아볼까요?\")은 쓰지 마세요.\n" +
    "- 이어지는 수정 요청에서도 같은 방향을 유지하세요. 사용자가 다른 방향을 요구할 때만 바꿉니다."
  );
}
