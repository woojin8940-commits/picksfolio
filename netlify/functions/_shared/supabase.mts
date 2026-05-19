import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabaseServer(): SupabaseClient {
  if (_client) return _client

  const url = process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!url || !serviceKey) {
    throw new Error('Supabase 환경변수 미설정 (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  }

  _client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return _client
}
