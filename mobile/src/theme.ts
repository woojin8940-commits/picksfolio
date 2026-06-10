/**
 * PICKS Folio design tokens. These mirror the web product's palette exactly
 * (see `src/index.css` @theme): a near-black canvas, pure-white type and the
 * blue brand accent. The native screens (loading shell + broadcast) use these
 * so the app looks identical to the web app the WebView renders.
 */
export const colors = {
  background: '#050507',
  surface: '#0F1117',
  surfaceElevated: '#1E1E2E',
  border: 'rgba(255, 255, 255, 0.1)',
  text: '#FFFFFF',
  textMuted: '#94A3B8',
  textFaint: '#64748B',
  accent: '#2563EB', // blue-primary — matches the web brand color
  accentSoft: 'rgba(37, 99, 235, 0.14)',
  success: '#10B981',
  danger: '#DC2626',
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
