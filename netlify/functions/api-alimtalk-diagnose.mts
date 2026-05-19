import type { Config, Context } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

/**
 * 알림톡 발송 파이프라인 진단 엔드포인트
 * GET /api/alimtalk-diagnose?username=xxx
 * - 환경변수 설정 상태 확인
 * - Supabase profiles 테이블에서 전화번호 조회 확인
 * - Solapi API 키 유효성 확인
 * - 실제 메시지는 발송하지 않음 (dry-run)
 */
export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const url = new URL(req.url)
  const username = url.searchParams.get('username')?.toLowerCase()

  const diagnostics: Record<string, any> = {
    timestamp: new Date().toISOString(),
    username: username || '(미지정)',
    steps: [],
  }

  // Step 1: 환경변수 확인
  const envCheck = {
    step: '1. 환경변수 확인',
    SOLAPI_API_KEY: !!Netlify.env.get('SOLAPI_API_KEY'),
    SOLAPI_API_SECRET: !!Netlify.env.get('SOLAPI_API_SECRET'),
    SOLAPI_FROM_NUMBER: !!Netlify.env.get('SOLAPI_FROM_NUMBER'),
    SOLAPI_KAKAO_PFID: !!Netlify.env.get('SOLAPI_KAKAO_PFID'),
    SOLAPI_KAKAO_PROPOSAL_TEMPLATE_ID: !!Netlify.env.get('SOLAPI_KAKAO_PROPOSAL_TEMPLATE_ID'),
    SOLAPI_KAKAO_TIMELINE_TEMPLATE_ID: !!Netlify.env.get('SOLAPI_KAKAO_TIMELINE_TEMPLATE_ID'),
    SOLAPI_KAKAO_LIVE_NOTIFY_TEMPLATE_ID: !!Netlify.env.get('SOLAPI_KAKAO_LIVE_NOTIFY_TEMPLATE_ID'),
    SOLAPI_KAKAO_LIVE_SUBSCRIBE_TEMPLATE_ID: !!Netlify.env.get('SOLAPI_KAKAO_LIVE_SUBSCRIBE_TEMPLATE_ID'),
    VITE_SUPABASE_URL: !!Netlify.env.get('VITE_SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: !!Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    status: 'checking',
    issues: [] as string[],
  }

  if (!envCheck.SOLAPI_API_KEY) envCheck.issues.push('SOLAPI_API_KEY 미설정')
  if (!envCheck.SOLAPI_API_SECRET) envCheck.issues.push('SOLAPI_API_SECRET 미설정')
  if (!envCheck.SOLAPI_FROM_NUMBER) envCheck.issues.push('SOLAPI_FROM_NUMBER 미설정 (SMS 대체 발송 불가)')
  if (!envCheck.SOLAPI_KAKAO_PFID) envCheck.issues.push('SOLAPI_KAKAO_PFID 미설정 (알림톡 발송 불가)')
  if (!envCheck.SOLAPI_KAKAO_PROPOSAL_TEMPLATE_ID) envCheck.issues.push('SOLAPI_KAKAO_PROPOSAL_TEMPLATE_ID 미설정 (제안서 알림톡 발송 불가)')
  if (!envCheck.SOLAPI_KAKAO_TIMELINE_TEMPLATE_ID) envCheck.issues.push('SOLAPI_KAKAO_TIMELINE_TEMPLATE_ID 미설정 (비즈니스 수신 알림 발송 불가)')
  if (!envCheck.SOLAPI_KAKAO_LIVE_NOTIFY_TEMPLATE_ID) envCheck.issues.push('SOLAPI_KAKAO_LIVE_NOTIFY_TEMPLATE_ID 미설정 (라이브 시작 알림 발송 불가)')
  if (!envCheck.SOLAPI_KAKAO_LIVE_SUBSCRIBE_TEMPLATE_ID) envCheck.issues.push('SOLAPI_KAKAO_LIVE_SUBSCRIBE_TEMPLATE_ID 미설정 (라이브 알림 신청완료 알림 발송 불가)')
  if (!envCheck.VITE_SUPABASE_URL) envCheck.issues.push('VITE_SUPABASE_URL 미설정 (전화번호 조회 불가)')
  if (!envCheck.SUPABASE_SERVICE_ROLE_KEY) envCheck.issues.push('SUPABASE_SERVICE_ROLE_KEY 미설정 (전화번호 조회 불가)')

  envCheck.status = envCheck.issues.length === 0 ? '✅ 모든 환경변수 설정됨' : `❌ ${envCheck.issues.length}개 문제 발견`
  diagnostics.steps.push(envCheck)

  // Step 2: Supabase 프로필 전화번호 조회
  if (username && envCheck.VITE_SUPABASE_URL && envCheck.SUPABASE_SERVICE_ROLE_KEY) {
    const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL') || ''
    const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const phoneCheck: Record<string, any> = {
      step: '2. 전화번호 조회 (profiles 테이블)',
      query: `SELECT phone, username, id FROM profiles WHERE username = '${username}'`,
      status: 'checking',
      issues: [] as string[],
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('phone, username, id, full_name')
        .eq('username', username)
        .maybeSingle()

      if (error) {
        phoneCheck.status = '❌ Supabase 조회 에러'
        phoneCheck.error = error.message
        phoneCheck.issues.push(`DB 조회 에러: ${error.message}`)
      } else if (!data) {
        phoneCheck.status = '❌ 프로필 없음'
        phoneCheck.issues.push(`username="${username}"인 프로필이 profiles 테이블에 없습니다.`)
        phoneCheck.issues.push('카카오 로그인 후 SetupLink에서 username이 제대로 설정되었는지 확인하세요.')

        // 추가 진단: profiles 테이블에 행이 있는지 확인
        const { count } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
        phoneCheck.totalProfilesCount = count

        // username이 비어있는 프로필 수 확인
        const { count: emptyUsernameCount } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .or('username.is.null,username.eq.')
        phoneCheck.emptyUsernameProfiles = emptyUsernameCount
      } else if (!data.phone) {
        phoneCheck.status = '❌ 전화번호 없음'
        phoneCheck.profileFound = { id: data.id, username: data.username, full_name: data.full_name || '(없음)', phone: '(비어있음)' }
        phoneCheck.issues.push('프로필은 있지만 전화번호(phone)가 비어있습니다.')
        phoneCheck.issues.push('카카오 로그인 시 전화번호 동의를 하지 않았거나, kakao-profile-setup에서 전화번호 저장에 실패했을 수 있습니다.')
        phoneCheck.issues.push('마이페이지에서 전화번호를 직접 입력하거나, 카카오 재로그인을 시도해 보세요.')
      } else {
        phoneCheck.status = '✅ 전화번호 확인됨'
        phoneCheck.profileFound = { id: data.id, username: data.username, full_name: data.full_name || '(없음)', hasPhone: true }
      }
    } catch (err: any) {
      phoneCheck.status = '❌ 예외 발생'
      phoneCheck.error = err.message
    }

    diagnostics.steps.push(phoneCheck)
  } else if (username) {
    diagnostics.steps.push({
      step: '2. 전화번호 조회',
      status: '⏭️ 건너뜀 (Supabase 환경변수 미설정)',
    })
  }

  // Step 3: Solapi API 연결 확인 (실제 발송 없이 메시지 목록 조회로 확인)
  if (envCheck.SOLAPI_API_KEY && envCheck.SOLAPI_API_SECRET) {
    const solapiCheck: Record<string, any> = {
      step: '3. Solapi API 연결 확인',
      status: 'checking',
    }

    try {
      const { SolapiMessageService } = await import('solapi')
      const messageService = new SolapiMessageService(
        Netlify.env.get('SOLAPI_API_KEY') || '',
        Netlify.env.get('SOLAPI_API_SECRET') || '',
      )

      // 최근 메시지 1건 조회로 API 키 유효성 확인
      const messages = await messageService.getMessages({ limit: 1 })
      solapiCheck.status = '✅ Solapi API 연결 성공'
      solapiCheck.recentMessageCount = messages.messageList?.length ?? 0
    } catch (err: any) {
      solapiCheck.status = '❌ Solapi API 연결 실패'
      solapiCheck.error = err.message || JSON.stringify(err)
      solapiCheck.issues = ['Solapi API 키가 유효하지 않거나 네트워크 문제가 있습니다.']
    }

    diagnostics.steps.push(solapiCheck)
  }

  // Step 4: 라이브 알림 템플릿 등록 정보 확인
  // 카카오 알림톡 버튼 URL은 템플릿에 등록된 패턴과 정확히 일치해야 치환됩니다.
  // 등록된 버튼 URL이 정적 링크(예: https://picks-folio.com)이면 라이브 보러가기는
  // 항상 메인 홈으로 이동하고, 변수가 포함되어 있으면 그 변수명을 그대로 발송 시
  // variables에 넣어야 합니다.
  if (envCheck.SOLAPI_API_KEY && envCheck.SOLAPI_API_SECRET && envCheck.SOLAPI_KAKAO_LIVE_NOTIFY_TEMPLATE_ID) {
    const templateCheck: Record<string, any> = {
      step: '4. 라이브 알림 템플릿(LIVE_NOTIFY) 버튼/변수 검사',
      status: 'checking',
      issues: [] as string[],
    }

    try {
      const { KakaoTemplateService } = await import('solapi')
      const templateService = new KakaoTemplateService(
        Netlify.env.get('SOLAPI_API_KEY') || '',
        Netlify.env.get('SOLAPI_API_SECRET') || '',
      )
      const liveNotifyTemplateId = Netlify.env.get('SOLAPI_KAKAO_LIVE_NOTIFY_TEMPLATE_ID') || ''
      const template = await templateService.getKakaoAlimtalkTemplate(liveNotifyTemplateId)

      templateCheck.templateId = liveNotifyTemplateId
      templateCheck.name = template.name
      templateCheck.status_field = template.status
      templateCheck.content = template.content
      templateCheck.buttons = (template.buttons || []).map((b: any) => ({
        buttonName: b.buttonName,
        buttonType: b.buttonType,
        linkMo: b.linkMo ?? null,
        linkPc: b.linkPc ?? null,
      }))

      // 본문/버튼에서 사용된 #{변수명} 추출
      const variablePattern = /#\{[^}]+\}/g
      const contentVars = Array.from(new Set((template.content || '').match(variablePattern) || []))
      const buttonVars = Array.from(new Set((template.buttons || []).flatMap((b: any) =>
        [b.linkMo, b.linkPc].filter(Boolean).flatMap((u: string) => u.match(variablePattern) || []),
      )))
      templateCheck.contentVariables = contentVars
      templateCheck.buttonUrlVariables = buttonVars

      // 라이브 보러가기 버튼 진단
      const liveButton = (template.buttons || []).find((b: any) =>
        (b.buttonName || '').includes('라이브') || (b.buttonName || '').includes('보러') || b.buttonType === 'WL',
      )
      if (!liveButton) {
        templateCheck.issues.push('템플릿에 WL(웹링크) 버튼이 등록되어 있지 않습니다. 카카오 비즈니스에서 템플릿을 다시 등록하세요.')
      } else {
        const linkMo = liveButton.linkMo || ''
        const linkPc = liveButton.linkPc || ''
        templateCheck.liveButton = liveButton
        if (!linkMo.includes('#{')) {
          templateCheck.issues.push(
            `라이브 보러가기 버튼의 등록된 URL("${linkMo}")에 변수가 없습니다. ` +
            `카카오 알림톡은 발송 시 linkMo/linkPc로 URL을 덮어쓰더라도 등록된 패턴과 다르면 무시되고 ` +
            `등록된 정적 URL이 사용됩니다. 결과적으로 "라이브 보러가기"는 항상 ${linkMo} 로 이동합니다.`,
          )
          templateCheck.fixSuggestion =
            '템플릿의 버튼 URL을 https://picks-folio.com/#{username} 처럼 변수가 포함된 형태로 수정/재등록하고, ' +
            'api-live-notify-send.mts 의 variables에 동일한 변수명({username})을 보내야 합니다.'
        } else {
          templateCheck.issues.push(
            `라이브 보러가기 버튼의 등록된 URL이 "${linkMo}" 입니다. ` +
            `발송 코드의 variables 맵에 위 URL에 사용된 변수(${buttonVars.join(', ') || '없음'})를 정확히 같은 키로 넣어야 합니다.`,
          )
          templateCheck.fixSuggestion =
            `api-live-notify-send.mts 에서 variables에 ${buttonVars.join(', ')} 항목을 추가하고 값으로 ` +
            `${process.env.URL || 'https://picks-folio.com'}/<username> (또는 username만)을 넣으세요.`
        }
      }
      templateCheck.status = templateCheck.issues.length === 0
        ? '✅ 템플릿 버튼 정상'
        : `⚠️ ${templateCheck.issues.length}개 항목 확인 필요`
    } catch (err: any) {
      templateCheck.status = '❌ 템플릿 조회 실패'
      templateCheck.error = err.message || JSON.stringify(err)
    }

    diagnostics.steps.push(templateCheck)
  }

  // 종합 판단
  const allIssues = diagnostics.steps.flatMap((s: any) => s.issues || [])
  diagnostics.overallStatus = allIssues.length === 0
    ? '✅ 알림톡 파이프라인 정상 — 실제 발송 시 문제가 발생하면 Netlify Functions 로그에서 [알림톡 진단] 태그를 검색하세요.'
    : `❌ ${allIssues.length}개 문제 발견`
  diagnostics.allIssues = allIssues

  return Response.json(diagnostics, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}

export const config: Config = {
  path: '/api/alimtalk-diagnose',
  method: ['GET', 'OPTIONS'],
}
