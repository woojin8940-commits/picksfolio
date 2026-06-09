/**
 * Runtime configuration, sourced from public Expo env vars.
 * `EXPO_PUBLIC_`-prefixed vars are inlined into the JS bundle at build time.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const config = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  /** True when a live backend is configured; otherwise the app uses sample data. */
  hasBackend: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
  brandName: 'PICKS Folio',
} as const;
