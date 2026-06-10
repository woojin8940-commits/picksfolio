/**
 * PICKS Folio design tokens — mirror the web product 1:1: a near-black canvas,
 * pure-white type and the blue brand accent (#2563EB). These values are lifted
 * straight from the web app's CSS theme (src/index.css) so the native shell and
 * the website are visually identical; there is no separate native palette.
 */
export const colors = {
  background: '#050507', // --color-background / --color-midnight
  surface: '#0f1117', // --color-surface
  surfaceElevated: '#1e1e2e', // --color-surface-light
  border: 'rgba(255,255,255,0.10)', // web uses border-white/10 throughout
  text: '#ffffff',
  textMuted: '#94A3B8', // slate-400
  textFaint: '#64748B', // slate-500
  accent: '#2563EB', // --color-blue-primary (web brand blue)
  accentSecondary: '#3B82F6', // --color-blue-secondary
  accentSoft: 'rgba(37, 99, 235, 0.14)',
  success: '#22C55E', // green-500
  danger: '#EF4444', // red-500 (live / stop)
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
