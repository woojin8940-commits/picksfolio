import type { Config, Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'
import { SolapiMessageService } from 'solapi'

/**
 * 솔라피(Solapi)를 통한 카카오 알림톡 / SMS 발송
 * - 카카오 알림톡 우선 발송 (PFID + 템플릿 설정 시)
 * - 알림톡 실패 또는 미설정 시 SMS 대체 발송
 * - 전화번호 기반 발송
 */

interface NotificationRequest {
  phone?: string              // 수신자 전화번호 (직접 전달)
  username?: string           // 인플루언서 username (DB에서 phone 조회)
  message: string             // 발송할 메시지 (SMS 대체 텍스트)
  templateId?: string         // 카카오 알림톡 템플릿 ID (선택)
  variables?: Record<string, string> // 알림톡 템플릿 변수 (선택)
}

async function getPhoneByUsername(username: string): Promise<string | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!supabaseUrl || !serviceRoleKey) return null

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase
    .from('profiles')
    .select('phone')
    .eq('username', username)
    .maybeSingle()

  if (error || !data?.phone) return null
  return data.phone
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
  const kakaoPfId = process.env.SOLAPI_KAKAO_PFID || ''

  if (!apiKey || !apiSecret) {
    return Response.json({ error: '솔라피 API 키가 설정되지 않았습니다. (SOLAPI_API_KEY, SOLAPI_API_SECRET)' }, { status: 500 })
  }

  try {
    const body = (await req.json()) as NotificationRequest
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
    const toNumber = phone.replace(/[^0-9]/g, '')
    const templateId = body.templateId || ''

    console.log('[send-kakao-alimtalk] 발송 요청:', {
      to: toNumber,
      from: fromNumber || '(미설정)',
      kakaoPfId: kakaoPfId ? '설정됨' : '미설정',
      templateId: templateId || '(미설정)',
      variables: body.variables || {},
      messageLength: message.length,
    })

    // 카카오 알림톡 발송 시도 (PFID + 템플릿 설정 시)
    if (kakaoPfId && templateId) {
      try {
        const result = await messageService.sendOne({
          to: toNumber,
          from: fromNumber,
          text: message,
          kakaoOptions: {
            pfId: kakaoPfId,
            templateId,
            variables: body.variables || {},
          },
        })

        console.log('[send-kakao-alimtalk] ✅ 알림톡 발송 성공:', JSON.stringify(result))
        return Response.json({
          success: true,
          type: 'alimtalk',
          message: '카카오 알림톡이 발송되었습니다.',
          result,
        })
      } catch (kakaoError: any) {
        const errorDetail = {
          message: kakaoError?.message || '(메시지 없음)',
          errorCode: kakaoError?.errorCode || kakaoError?.code || '(코드 없음)',
          errorMessage: kakaoError?.errorMessage || '(상세 없음)',
          statusCode: kakaoError?.statusCode || kakaoError?.httpStatus || '(상태코드 없음)',
          failedMessageList: kakaoError?.failedMessageList || '(실패목록 없음)',
          fullError: JSON.stringify(kakaoError, Object.getOwnPropertyNames(kakaoError || {})),
        }
        console.error('[send-kakao-alimtalk] ❌ 알림톡 발송 실패:', JSON.stringify(errorDetail))
        console.error('[send-kakao-alimtalk] SMS 대체 발송 시도...')
      }
    }

    // 알림톡 실패 또는 미설정 시 SMS 대체 발송
    if (!fromNumber) {
      return Response.json({ error: 'SOLAPI_FROM_NUMBER 미설정 - SMS 대체 발송 불가' }, { status: 500 })
    }

    const result = await messageService.sendOne({
      to: toNumber,
      from: fromNumber,
      text: message,
    })

    return Response.json({
      success: true,
      type: 'sms',
      message: 'SMS로 알림이 발송되었습니다.',
      result,
    })
  } catch (error: any) {
    console.error('솔라피 알림 발송 오류:', error)
    return Response.json(
      {
        error: '알림 발송 실패',
        message: error.message || '알 수 없는 에러가 발생했습니다.',
      },
      { status: 500 },
    )
  }
}

export const config: Config = {
  path: '/api/send-kakao-alimtalk',
  method: ['POST', 'OPTIONS'],
}
