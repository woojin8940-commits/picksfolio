/**
 * 테마 배경색 한 곳.
 *
 * 테마는 원래 '미드나잇 블랙 / 퓨어 화이트' 두 프리셋뿐이었고, 화면마다
 * `theme === 'white'` 로 밝은지 어두운지를 판단했다. 배경색을 팔레트에서 자유롭게
 * 고를 수 있게 되면 그 판단이 더는 성립하지 않는다 — 크림색을 골랐는데 흰 글씨가
 * 얹히면 아무것도 읽을 수 없다.
 *
 * 그래서 "고른 배경색이 밝은가"를 색 자체에서 계산하고, 편집기 · 미리보기 · 공개
 * 페이지가 모두 이 파일의 같은 답을 쓴다.
 */

/** 프리셋 두 개 + 팔레트로 직접 고르는 자유 배경. */
export type ThemePreset = 'midnight' | 'white' | 'custom';

/** 프리셋의 고정 배경색. */
export const PRESET_BACKGROUND: Record<'midnight' | 'white', string> = {
  midnight: '#1E1E2E',
  white: '#FFFFFF',
};

/** 자유 배경을 처음 골랐을 때의 기본색. */
export const DEFAULT_CUSTOM_BACKGROUND = '#101828';

/**
 * 배경색 팔레트. 어두운 톤 여덟 개 · 밝은 톤 여덟 개를 나란히 둔다. 어느 쪽을 골라도
 * 글자 색은 자동으로 뒤집히므로 사람이 명암을 신경 쓸 필요가 없다.
 */
export const THEME_BG_PRESETS: Array<{ value: string; label: string }> = [
  { value: '#101828', label: '차콜' },
  { value: '#0F172A', label: '네이비' },
  { value: '#1E1B4B', label: '인디고' },
  { value: '#2E1065', label: '바이올렛' },
  { value: '#0C4A6E', label: '오션' },
  { value: '#064E3B', label: '포레스트' },
  { value: '#7F1D1D', label: '버건디' },
  { value: '#3F2A1D', label: '에스프레소' },
  { value: '#FFFFFF', label: '화이트' },
  { value: '#F8FAFC', label: '스노우' },
  { value: '#F5F5F4', label: '샌드' },
  { value: '#FEF3C7', label: '크림' },
  { value: '#FCE7F3', label: '블러시' },
  { value: '#E0F2FE', label: '스카이' },
  { value: '#DCFCE7', label: '민트' },
  { value: '#E9E5FF', label: '라벤더' },
];

/** '#abc' · 'abcdef' 같은 입력을 '#AABBCC' 로. 색이 아니면 null. */
export function normalizeHexColor(input?: string | null): string | null {
  if (!input) return null;
  let hex = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map(c => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** WCAG 상대 휘도. 0(검정) ~ 1(흰색). */
function relativeLuminance(hex: string): number {
  const h = hex.slice(1);
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(h.slice(0, 2), 16));
  const g = channel(parseInt(h.slice(2, 4), 16));
  const b = channel(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 이 배경 위에 어두운 글씨를 얹어야 하는가.
 *
 * 색으로 읽히지 않는 값(예전 계정의 `linear-gradient(...)` 커스텀 배경)은 어두운
 * 배경으로 본다 — 그때의 화면과 같게 나온다.
 */
export function isLightBackground(color?: string | null): boolean {
  const hex = normalizeHexColor(color);
  if (!hex) return false;
  return relativeLuminance(hex) > 0.45;
}

/** 자유 배경으로 저장된 값. 새 필드 → 예전 필드(customGradient) → 기본색 순. */
export function customBackgroundOf(design?: { customBackground?: string; customGradient?: string } | null): string {
  return design?.customBackground || design?.customGradient || DEFAULT_CUSTOM_BACKGROUND;
}

/** 테마가 실제로 그리는 배경. `background` 값으로 그대로 쓸 수 있다. */
export function themeBackgroundOf(
  design?: { theme?: string; customBackground?: string; customGradient?: string } | null,
): string {
  const theme = design?.theme;
  if (theme === 'custom') return customBackgroundOf(design);
  if (theme === 'midnight') return '#050a15';
  if (theme === 'white') return '#ffffff';
  return '#f3f0ff';
}

/** 이 테마가 어두운 배경인가. 글자 · 카드 · 테두리 색이 모두 이걸 본다. */
export function themeIsDark(
  design?: { theme?: string; customBackground?: string; customGradient?: string } | null,
): boolean {
  if (design?.theme === 'custom') return !isLightBackground(customBackgroundOf(design));
  return design?.theme === 'midnight';
}
