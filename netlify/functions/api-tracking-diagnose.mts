import type { Config } from '@netlify/functions'
import { requireAdmin } from './_shared/admin-auth.mts'
import { loadCompanyCodes, lookupTracking, resolveCompanyCode, trackingApiKey } from './_shared/delivery-tracking.mts'

/**
 * 송장 배송 조회(스위트트래커) 진단 엔드포인트 — **운영자 전용**
 * GET /api/tracking-diagnose[?company=CJ대한통운&invoice=송장번호]
 *
 * 비밀 환경변수는 배포된 함수 안에서만 실제 값이 보이므로(CLI · 대시보드에서는 마스킹),
 * 키가 정말 동작하는지는 여기서만 확인할 수 있다. 키 값 자체는 돌려주지 않는다.
 * - 키 설정 여부 · 회사 목록 API 응답(키 유효성)
 * - 주요 택배사 코드 매핑
 * - (선택) 실제 송장 하나 조회 결과
 */
const COMPANIES = ['CJ대한통운', '우체국택배', '한진택배', '롯데택배', '로젠택배', 'GS25 편의점택배', 'CU 편의점택배', '농협택배']

export default async (req: Request) => {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const key = trackingApiKey()
  const out: Record<string, any> = { timestamp: new Date().toISOString(), keySet: !!key }
  if (!key) return Response.json({ ...out, status: '❌ SWEETTRACKER_API_KEY 미설정' })

  const list = await loadCompanyCodes(key)
  out.keyInvalid = !!list.keyInvalid
  out.companyListSize = list.size
  out.codes = Object.fromEntries(COMPANIES.map((c) => [c, resolveCompanyCode(c, list) || null]))

  // 송장을 안 주면 형식상 존재하지 않는 송장으로 조회해서 "키는 통과하고 송장만 없다"는 응답이 오는지 본다.
  const company = url.searchParams.get('company') || 'CJ대한통운'
  const invoice = url.searchParams.get('invoice') || '000000000000'
  const code = resolveCompanyCode(company, list)
  out.lookup = { company, code: code || null, sample: !url.searchParams.get('invoice'),
    result: code ? await lookupTracking(key, code, invoice) : { ok: false, error: 'NO_COMPANY_CODE' } }

  const lookupErr = out.lookup.result.ok ? '' : String(out.lookup.result.error)
  out.status = list.keyInvalid || lookupErr === '101'
    ? '❌ 키가 거부됨 (101 · 종료됐거나 유효하지 않은 키)'
    : list.size === 0
      ? '⚠️ 회사 목록을 받지 못함 (기본 코드로만 조회)'
      : '✅ 키 정상 · 회사 목록 수신'
  return Response.json(out)
}

export const config: Config = {
  path: '/api/tracking-diagnose',
  method: ['GET'],
}
