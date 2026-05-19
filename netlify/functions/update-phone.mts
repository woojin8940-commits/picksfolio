import type { Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

/**
 * Update phone number for an authenticated user.
 * Requires a valid Supabase access_token in the Authorization header
 * and a phone number in the request body.
 */
export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return new Response(
      JSON.stringify({ error: '서버 환경 변수가 설정되지 않았습니다.' }),
      { status: 500, headers: corsHeaders }
    )
  }

  try {
    const { phone } = await req.json()

    if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: '전화번호를 입력해 주세요.' }),
        { status: 400, headers: corsHeaders }
      )
    }

    // Normalize phone: strip whitespace/hyphens, convert +82 to 0
    const normalized = phone
      .replace(/[\s\-.()/]/g, '')
      .replace(/^\+82(0?)/, '0')
      .replace(/[^0-9]/g, '')

    if (!/^01[016789]\d{7,8}$/.test(normalized)) {
      return new Response(
        JSON.stringify({ error: '올바른 전화번호 형식이 아닙니다. (예: 01012345678)' }),
        { status: 400, headers: corsHeaders }
      )
    }

    // Verify user identity from Authorization header
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')

    if (!token) {
      return new Response(
        JSON.stringify({ error: '인증 토큰이 필요합니다.' }),
        { status: 401, headers: corsHeaders }
      )
    }

    // Verify the token and get the user
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: { user }, error: userError } = await userClient.auth.getUser(token)

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: '인증에 실패했습니다. 다시 로그인해 주세요.' }),
        { status: 401, headers: corsHeaders }
      )
    }

    // Update phone in profiles using admin client (bypasses RLS)
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: updateError } = await adminClient
      .from('profiles')
      .update({ phone: normalized })
      .eq('id', user.id)

    if (updateError) {
      console.error('[update-phone] Profile update error:', updateError)
      return new Response(
        JSON.stringify({ error: '전화번호 업데이트 실패: ' + updateError.message }),
        { status: 500, headers: corsHeaders }
      )
    }

    // Also update user_metadata AND auth.users.phone so it's consistent
    // auth.users.phone은 E.164 형식 필요 (+821012345678)
    const e164Phone = '+82' + normalized.substring(1) // 01012345678 → +821012345678

    const { data: authUpdateData, error: authUpdateError } = await adminClient.auth.admin.updateUserById(user.id, {
      phone: e164Phone,
      phone_confirm: true, // phone_confirmed_at 설정 → Supabase에서 "확인됨"으로 표시
      user_metadata: { ...user.user_metadata, phone: normalized },
    })

    if (authUpdateError) {
      console.error('[update-phone] auth.admin.updateUserById error:', authUpdateError)
      // phone이 profiles에는 저장되었으므로 auth 업데이트 실패는 별도 처리
      // Supabase Phone Provider가 비활성화된 경우 phone 필드 업데이트 실패 가능
      // user_metadata만이라도 업데이트 시도
      const { error: metaError } = await adminClient.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, phone: normalized },
      })
      if (metaError) {
        console.error('[update-phone] user_metadata fallback update also failed:', metaError)
      } else {
        console.log('[update-phone] Phone saved in profiles + user_metadata (auth.users.phone update failed - Phone Provider 비활성화 가능)')
      }
    } else {
      console.log('[update-phone] Phone updated successfully for user:', user.id, '→', normalized, '/ auth.users.phone →', e164Phone)
      console.log('[update-phone] phone_confirmed_at:', authUpdateData?.user?.phone_confirmed_at)
    }

    return new Response(
      JSON.stringify({ success: true, phone: normalized }),
      { status: 200, headers: corsHeaders }
    )
  } catch (error: any) {
    console.error('[update-phone] Unhandled error:', error)
    return new Response(
      JSON.stringify({ error: '서버 오류: ' + (error.message || '알 수 없는 오류') }),
      { status: 500, headers: corsHeaders }
    )
  }
}
