/**
 * 출시 혜택 코드(프로모션 코드) — 등록하면 일정 기간 멤버십이 무료가 된다.
 *
 * 무료 기간을 별도 상태로 들고 있지 않는 게 이 설계의 핵심이다. 코드를 등록하면
 * 카드 빌링키는 그대로 발급해 두고(정상 결제가 이어지도록), 첫 청구일만
 * `next_billing_date = 오늘 + free_months` 로 밀어 둔다. 그러면
 *   • 무료 기간 동안은 청구가 나가지 않고(결제일이 아직 오지 않았다),
 *   • 기간이 끝나는 날 정기결제 스케줄러가 평소처럼 청구하고 한 달씩 갱신한다.
 * 만료를 감시하는 별도 작업이나 "무료 구독" 분기가 필요 없다.
 *
 * 코드 형식은 9자리 숫자다. 사용자가 공백·하이픈을 섞어 넣거나 붙여넣기로
 * 앞뒤 공백이 들어오는 경우가 많아 비교 전에 숫자만 남긴다.
 */

import { getDatabase } from '@picks/netlify-database'
import type { MembershipTier } from './membership-billing.mts'

export const PROMO_CODE_LENGTH = 9

export interface PromoCodeInfo {
  code: string
  plan: MembershipTier
  freeMonths: number
  maxRedemptions: number | null
  redemptions: number
  active: boolean
  expiresAt: string | null
  note: string
}

export interface PromoRedemption {
  username: string
  code: string
  plan: MembershipTier
  freeMonths: number
  redeemedAt: string
  /** 무료 기간이 끝나고 첫 정상 결제가 나가는 시각. */
  freeUntil: string
}

/** 입력값에서 숫자만 남긴다(공백·하이픈·붙여넣기 공백 허용). */
export const normalizePromoCode = (input: unknown): string =>
  String(input ?? '').replace(/[^0-9]/g, '')

export const isPromoCodeShaped = (code: string): boolean =>
  new RegExp(`^[0-9]{${PROMO_CODE_LENGTH}}$`).test(code)

const toInfo = (row: any): PromoCodeInfo => ({
  code: String(row.code || ''),
  plan: row.plan as MembershipTier,
  freeMonths: Number(row.free_months || 0),
  maxRedemptions: row.max_redemptions === null ? null : Number(row.max_redemptions),
  redemptions: Number(row.redemptions || 0),
  active: row.active === true,
  expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
  note: String(row.note || ''),
})

const toRedemption = (row: any): PromoRedemption => ({
  username: String(row.username || ''),
  code: String(row.code || ''),
  plan: row.plan as MembershipTier,
  freeMonths: Number(row.free_months || 0),
  redeemedAt: new Date(row.redeemed_at).toISOString(),
  freeUntil: new Date(row.free_until).toISOString(),
})

export async function getPromoCode(code: string): Promise<PromoCodeInfo | null> {
  const clean = normalizePromoCode(code)
  if (!isPromoCodeShaped(clean)) return null
  const db = getDatabase()
  const rows = await db.sql`
    SELECT code, plan, free_months, max_redemptions, redemptions, active, expires_at, note
    FROM membership_promo_codes
    WHERE code = ${clean}
    LIMIT 1
  `
  return rows.length > 0 ? toInfo(rows[0]) : null
}

export async function getPromoRedemption(username: string): Promise<PromoRedemption | null> {
  const clean = String(username || '').trim().toLowerCase().replace(/^biz\//, '')
  if (!clean) return null
  const db = getDatabase()
  const rows = await db.sql`
    SELECT username, code, plan, free_months, redeemed_at, free_until
    FROM membership_promo_redemptions
    WHERE username = ${clean}
    LIMIT 1
  `
  return rows.length > 0 ? toRedemption(rows[0]) : null
}

export type PromoCheck =
  | { ok: true; info: PromoCodeInfo }
  | { ok: false; error: string }

/**
 * 등록하지 않고 코드만 확인한다(결제창에서 "이 코드는 무엇을 주는지" 안내용).
 * 실제 등록 시점에 다시 원자적으로 검사하므로, 여기 통과가 등록 성공을 보장하지는 않는다.
 */
export async function checkPromoCode(
  code: string,
  username?: string | null,
): Promise<PromoCheck> {
  const clean = normalizePromoCode(code)
  if (!isPromoCodeShaped(clean)) {
    return { ok: false, error: `코드는 ${PROMO_CODE_LENGTH}자리 숫자입니다.` }
  }

  const info = await getPromoCode(clean)
  // 없는 코드와 닫힌 코드를 같은 문구로 돌려준다 — 어떤 번호가 "존재하긴 한다"는
  // 신호를 주면 9자리를 훑는 쪽에 힌트가 된다.
  if (!info || !info.active) return { ok: false, error: '사용할 수 없는 코드입니다.' }
  if (info.expiresAt && new Date(info.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: '사용 기간이 지난 코드입니다.' }
  }
  if (info.maxRedemptions !== null && info.redemptions >= info.maxRedemptions) {
    return { ok: false, error: '이미 모두 사용된 코드입니다.' }
  }

  if (username) {
    const already = await getPromoRedemption(username)
    if (already) {
      return { ok: false, error: '이미 출시 혜택 코드를 등록한 계정입니다.' }
    }
  }

  return { ok: true, info }
}

export type PromoRedeemResult =
  | { ok: true; redemption: PromoRedemption }
  | { ok: false; error: string }

/**
 * 코드를 등록한다.
 *
 * 한 문장으로 처리해 동시에 들어온 요청이 한도를 넘기지 못하게 한다: 코드의 사용 횟수를
 * 조건부로 늘리고(WHERE 로 활성·기한·한도를 함께 확인), 그 결과가 있을 때만 등록 기록을
 * 넣는다. 등록 기록의 기본키가 username 이므로 같은 계정이 두 번 등록되는 일은 없다.
 * (완전히 같은 순간에 같은 계정으로 두 번 들어오면 사용 횟수만 1 더 올라갈 수 있다 —
 * 공용 코드는 한도가 없어 집계용 숫자이고, 무료 기간이 두 번 붙지는 않는다.)
 */
export async function redeemPromoCode(input: {
  code: string
  username: string
  authUserId?: string | null
}): Promise<PromoRedeemResult> {
  const code = normalizePromoCode(input.code)
  const username = String(input.username || '').trim().toLowerCase().replace(/^biz\//, '')
  const authUserId = String(input.authUserId || '')

  if (!isPromoCodeShaped(code)) {
    return { ok: false, error: `코드는 ${PROMO_CODE_LENGTH}자리 숫자입니다.` }
  }
  if (!username) return { ok: false, error: '계정을 확인할 수 없습니다.' }

  const db = getDatabase()
  const rows = await db.sql`
    WITH claim AS (
      UPDATE membership_promo_codes
      SET redemptions = redemptions + 1, updated_at = NOW()
      WHERE code = ${code}
        AND active
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_redemptions IS NULL OR redemptions < max_redemptions)
        AND NOT EXISTS (
          SELECT 1 FROM membership_promo_redemptions WHERE username = ${username}
        )
      RETURNING code, plan, free_months
    )
    INSERT INTO membership_promo_redemptions (
      username, code, auth_user_id, plan, free_months, free_until
    )
    SELECT
      ${username}::text, claim.code, ${authUserId}::text, claim.plan, claim.free_months,
      -- 무료 종료일 = 등록 시각 + free_months 개월. 달 길이가 짧으면 말일로 당겨진다
      -- (8/31 등록 → 2/28). 이후 매월 청구도 같은 규칙으로 이어진다.
      NOW() + make_interval(months => claim.free_months)
    FROM claim
    ON CONFLICT (username) DO NOTHING
    RETURNING username, code, plan, free_months, redeemed_at, free_until
  `

  if (rows.length > 0) return { ok: true, redemption: toRedemption(rows[0]) }

  // 등록되지 않았다 — 어떤 조건에 걸렸는지 확인해 사용자에게 이유를 알려준다.
  const why = await checkPromoCode(code, username)
  return { ok: false, error: why.ok ? '코드를 등록하지 못했습니다. 다시 시도해 주세요.' : why.error }
}

/**
 * 등록을 되돌린다 — 코드는 받아들였지만 그 뒤 구독 활성화가 실패한 경우에만 쓴다.
 * 되돌리지 않으면 계정당 한 번인 혜택이 아무 것도 받지 못한 채 소진된다.
 */
export async function releasePromoRedemption(username: string): Promise<void> {
  const clean = String(username || '').trim().toLowerCase().replace(/^biz\//, '')
  if (!clean) return
  const db = getDatabase()
  await db.sql`
    WITH removed AS (
      DELETE FROM membership_promo_redemptions
      WHERE username = ${clean}
      RETURNING code
    )
    UPDATE membership_promo_codes c
    SET redemptions = GREATEST(0, c.redemptions - 1), updated_at = NOW()
    FROM removed
    WHERE c.code = removed.code
  `
}
