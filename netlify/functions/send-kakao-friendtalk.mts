import type { Config, Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { SolapiMessageService } from 'solapi'

/**
 * 솔라피(Solapi) SMS를 통한 메시지 발송
 * - 카카오 친구톡 대신 솔라피 SMS 사용
 * - 전화번호 기반 발송
 */

interface MessageRequest {
  phone?: string              // 수신자 전화번호 (직접 전달)
  username?: string           // 인플루언서 username (DB에서 phone 조회)
  message: string             // 발송할 메시지 텍스트
}

async function getPhoneByUsername(username: string): Promise<string | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!supabaseUrl || !serviceRoleKey) {
    console.log('Supabase 환경변수 미설정 - phone 조회 불가')
    return null
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase
    .from('profiles')
    .select('phone')
    .eq('username', username)
    .maybeSingle()

  if (error) {
    console.error('유저 phone 조회 실패:', error)
    return null
  }

  return data?.phone || null
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const apiKey = process.env.SOLAPI_API_KEY || ''
  const apiSecret = process.env.SOLAPI_API_SECRET || ''
  const fromNumber = process.env.SOLAPI_FROM_NUMBER || ''

  if (!apiKey || !apiSecret) {
    return Response.json({ error: '솔라피 API 키가 설정되지 않았습니다. (SOLAPI_API_KEY, SOLAPI_API_SECRET)' }, { status: 500 })
  }

  if (!fromNumber) {
    return Response.json({ error: '발신번호(SOLAPI_FROM_NUMBER)가 설정되지 않았습니다.' }, { status: 500 })
  }

  try {
    const body = (await req.json()) as MessageRequest
    const { message } = body

    if (!message) {
      return Response.json({ error: '메시지 내용이 필요합니다.' }, { status: 400 })
    }

    // phone을 직접 전달받거나, username으로 DB 조회
    let phone = body.phone || ''
    if (!phone && body.username) {
      phone = (await getPhoneByUsername(body.username)) || ''
    }

    if (!phone) {
      return Response.json({
        error: '수신자 전화번호를 찾을 수 없습니다.',
      }, { status: 400 })
    }

    const messageService = new SolapiMessageService(apiKey, apiSecret)

    const result = await messageService.sendOne({
      to: phone.replace(/[^0-9]/g, ''),
      from: fromNumber,
      text: message,
    })

    return Response.json({
      success: true,
      message: 'SMS가 발송되었습니다.',
      result,
    })
  } catch (error: any) {
    console.error('솔라피 SMS 발송 오류:', error)
    return Response.json(
      {
        error: 'SMS 발송 실패',
        message: error.message || '알 수 없는 에러가 발생했습니다.',
      },
      { status: 500 },
    )
  }
}

export const config: Config = {
  path: '/api/send-kakao-friendtalk',
  method: ['POST', 'OPTIONS'],
}
