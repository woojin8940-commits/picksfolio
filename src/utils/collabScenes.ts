/**
 * 협업 제출물의 "위치"를 다루는 공통 규칙.
 *
 * 피드백이 협업 전체에 붙으면 "두 번째 장면 자막이 어색하다"는 말이 어디에 대한
 * 것인지 알 수 없다. 그래서 피드백에는 위치(anchor)를 함께 저장한다. 위치는 세
 * 종류뿐이다 — 대본의 장면 번호(`scene:2`), 영상의 시점(`t:00:12`), 그리고 영상과
 * 함께 올리는 인스타 본문 캡션(`caption`). 이 파일은 그
 * 문자열을 만들고 읽고 사람이 읽는 말로 바꾸는 곳이다. 각 화면이 제 나름대로
 * 문자열을 조립하면 브랜드가 남긴 위치를 인플루언서 화면이 못 읽는 일이 생긴다.
 */

/** 대본 한 장면. 무엇을 찍고(visual), 어떤 자막이 뜨고(subtitle), 뭐라고 말하는지(narration). */
export interface StoryboardScene {
  visual: string;
  subtitle: string;
  narration: string;
}

export const emptyScene = (): StoryboardScene => ({ visual: '', subtitle: '', narration: '' });

/**
 * 저장된 장면을 화면이 쓰는 형태로 맞춘다.
 *
 * 예전 제출물은 한 줄에 한 장면인 문자열 배열이었다. 그 제출물도 계속 열려야 하므로
 * 문자열이면 화면 설명(visual)으로 옮긴다 — 이미 제출된 대본을 못 읽게 만드는 것은
 * 데이터를 지우는 것과 같다.
 */
export const normalizeScenes = (raw: unknown): StoryboardScene[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (typeof item === 'string') return { visual: item, subtitle: '', narration: '' };
    const s = (item || {}) as Record<string, unknown>;
    return {
      visual: String(s.visual ?? s.text ?? ''),
      subtitle: String(s.subtitle ?? s.caption ?? ''),
      narration: String(s.narration ?? s.voice ?? ''),
    };
  });
};

export const sceneIsEmpty = (scene: StoryboardScene) =>
  !scene.visual.trim() && !scene.subtitle.trim() && !scene.narration.trim();

/** 뮤즈바이가 권장하는 최소 장면 수. 못 지켜도 제출은 되지만 화면이 알려 준다. */
export const RECOMMENDED_SCENE_COUNT = 5;

// ---------------------------------------------------------------------------
// 위치 문자열
// ---------------------------------------------------------------------------

export const sceneAnchor = (index: number) => `scene:${index + 1}`;

/** `MM:SS` 또는 `HH:MM:SS` 를 그대로 담는다. 초 단위 정규화는 하지 않는다. */
export const timeAnchor = (timecode: string) => `t:${timecode}`;

/**
 * 인스타 본문 캡션에 붙는 위치.
 *
 * 영상 단계에는 검토받는 것이 두 개다 — 영상과 그 아래 들어갈 본문이다. 캡션에 대한
 * 의견("첫 줄에 브랜드명을 넣어 주세요")이 영상 전체 피드백과 같은 자리에 쌓이면,
 * 인플루언서는 그 말이 영상 편집에 대한 것인지 글에 대한 것인지 다시 물어야 한다.
 */
export const CAPTION_ANCHOR = 'caption';

/** 인스타그램 본문 길이 한도. 넘으면 붙여넣을 때 뒤가 잘린다. */
export const CAPTION_MAX_LENGTH = 2200;

export type ParsedAnchor =
  | { kind: 'scene'; sceneIndex: number; label: string }
  | { kind: 'time'; seconds: number; label: string }
  | { kind: 'caption'; label: string }
  | { kind: 'whole'; label: string };

export const parseAnchor = (anchor?: string | null): ParsedAnchor => {
  const raw = String(anchor || '').trim();
  if (raw === CAPTION_ANCHOR) return { kind: 'caption', label: '본문 캡션' };
  const scene = /^scene:(\d+)$/.exec(raw);
  if (scene) {
    const n = Number(scene[1]);
    return { kind: 'scene', sceneIndex: n - 1, label: `${n}번 장면` };
  }
  const time = /^t:(.+)$/.exec(raw);
  if (time) {
    return { kind: 'time', seconds: timecodeToSeconds(time[1]), label: time[1] };
  }
  return { kind: 'whole', label: '전체' };
};

/** `01:23` → 83. 형식이 아니면 0 — 정렬 기준으로만 쓰이므로 실패해도 화면은 살아 있다. */
export const timecodeToSeconds = (timecode: string): number => {
  const parts = String(timecode || '')
    .split(':')
    .map(p => Number(p.trim()));
  if (parts.some(p => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

export const secondsToTimecode = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** 입력한 타임코드가 쓸 수 있는 형태인지. 빈 값은 "전체"로 보므로 유효하다. */
export const isValidTimecode = (timecode: string) =>
  !timecode.trim() || /^\d{1,2}:\d{2}(:\d{2})?$/.test(timecode.trim());

/**
 * 피드백 정렬. 위치가 있는 것을 먼저, 같은 위치면 작성 순서대로.
 * 장면 2에 대한 의견이 장면 5 아래에 붙어 있으면 대본을 따라 읽을 수 없다.
 */
export const compareByAnchor = (a: { anchor?: string; createdAt?: string }, b: { anchor?: string; createdAt?: string }) => {
  const pa = parseAnchor(a.anchor);
  const pb = parseAnchor(b.anchor);
  // 캡션은 영상 다음에 읽는 것이므로 시점 피드백 뒤, 전체 피드백 앞에 둔다.
  const rank = (p: ParsedAnchor) =>
    p.kind === 'whole' ? 3 : p.kind === 'scene' ? 0 : p.kind === 'time' ? 1 : 2;
  if (rank(pa) !== rank(pb)) return rank(pa) - rank(pb);
  if (pa.kind === 'scene' && pb.kind === 'scene') {
    if (pa.sceneIndex !== pb.sceneIndex) return pa.sceneIndex - pb.sceneIndex;
  }
  if (pa.kind === 'time' && pb.kind === 'time') {
    if (pa.seconds !== pb.seconds) return pa.seconds - pb.seconds;
  }
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
};

/** 링크가 브라우저에서 바로 재생 가능한 파일인지. 아니면 새 창으로 여는 링크만 준다. */
export const isPlayableVideo = (url?: string | null) =>
  /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(String(url || ''));
