/**
 * PICKS Folio design tokens — a refined, high-end link-in-bio palette
 * (near-black canvas, warm off-white type, a single confident accent).
 * Mirrors the visual language of the PICKS Folio web product.
 */
export const colors = {
  background: '#0B0B0F',
  surface: '#15151C',
  surfaceElevated: '#1E1E27',
  border: '#2A2A35',
  text: '#F5F3EE',
  textMuted: '#9A98A6',
  textFaint: '#6A6877',
  accent: '#C8A86B', // muted gold
  accentSoft: 'rgba(200, 168, 107, 0.14)',
  success: '#5BBE8B',
  danger: '#E0655F',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
} as const;
