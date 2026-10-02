/**
 * 디엠(DM) 자동화 이용 권한.
 *
 * 멤버십으로 잠겨 있던 기능은 모두 무료로 열렸고, 자동 디엠만 조건이 남는다. 조건은
 * 계정 종류에 따라 다르다.
 *
 *   · 인플루언서(일반 유저): **브랜드 매칭받기 등록**. 결제는 없다. 등록서를 내면 바로
 *     열리고, 담당자가 관리 화면에서 중단하면 멈춘다(dm-access-control).
 *   · 브랜드(기업 · profiles.role = 'operator'): **자동 디엠 플랜(월 5,900원)** 구독.
 *     브랜드는 매칭 등록을 하지 않으므로 결제로 연다. 예전 프로 플랜을 남은 기간 동안
 *     쓰고 있는 브랜드도 통과한다.
 *   · 운영자(role = 'admin'): 브랜드 워크스페이스로도 쓰이므로 두 조건 중 하나만
 *     맞으면 통과한다.
 *
 * 게이트가 막는 것은 **자동화 저장과 DM 발송뿐**이다. 인스타그램 계정 연동과 브랜드의
 * 콘텐츠 성과(태그된 콘텐츠 · api-business-tagged-media)는 이 판정을 보지 않는다.
 *
 * 설정 저장(api-dm-automation), 실제 발송(instagram-webhook) 등 모든 경로가 같은 판정을
 * 쓴다. 조회가 실패하면 막는다(fail-closed).
 */

import { hasMembershipPlan } from './membership-access.mts'
import { readInfluencerDmAccess } from './dm-access-control.mts'
import { findProfileByUsername } from './user-auth.mts'
import type { MembershipTier } from './membership-billing.mts'

/** 브랜드가 구독하는 자동 디엠 플랜. 화면이 결제 안내를 띄울 때 쓴다. */
export const DM_AUTOMATION_TIER: MembershipTier = 'brand_dm'

/** 브랜드 자동 디엠을 여는 플랜. 프로는 예전 구독자가 남은 기간 동안 쓰도록 둔다. */
export const BRAND_DM_PLANS: readonly MembershipTier[] = ['brand_dm', 'pro']

export const DM_AUTOMATION_REQUIRED_MESSAGE =
  '자동 디엠은 브랜드 매칭받기를 등록하면 무료로 사용할 수 있어요. 브랜드 계정은 자동 디엠 플랜(월 5,900원)을 구독하면 바로 사용할 수 있습니다.'

export type DmAutomationStatus = {
  allowed: boolean
  /** 'influencer' | 'brand' — 화면이 어떤 안내(매칭 등록 / 플랜 구독)를 띄울지 정한다. */
  accountType: 'influencer' | 'brand'
  /** 인플루언서: 매칭 등록 여부. */
  registered?: boolean
  /** 인플루언서: 담당자가 중단했는지와 그 사유. */
  suspended?: boolean
  suspendedReason?: string
}

const isBrandRole = (role: string) => role.trim().toLowerCase() === 'operator'
const isAdminRole = (role: string) => role.trim().toLowerCase() === 'admin'

/**
 * 판정을 이 인스턴스에 잠깐 기억해 둔다. 웹훅은 댓글 하나마다 판정을 부르는데, 매번
 * 프로필 · 등록서 · 멤버십을 다시 읽으면 댓글이 몰릴 때 그만큼 조회가 쌓인다. 담당자가
 * 중단해도 길어야 이 시간 안에 반영된다.
 */
const STATUS_TTL_MS = 60_000
const statusCache = new Map<string, { at: number; status: DmAutomationStatus }>()

/** 자동 디엠을 쓸 수 있는지와, 막혔다면 왜인지. */
export const dmAutomationStatus = async (
  username: string | null | undefined,
  authUserId?: string | null,
  options: { fresh?: boolean } = {},
): Promise<DmAutomationStatus> => {
  const clean = String(username || '').toLowerCase().replace(/^biz\//, '')
  if (!clean) return { allowed: false, accountType: 'influencer' }

  const cacheKey = `${clean}|${authUserId || ''}`
  const cached = statusCache.get(cacheKey)
  if (!options.fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status

  const status = await computeStatus(clean, authUserId)
  if (statusCache.size > 500) statusCache.clear()
  statusCache.set(cacheKey, { at: Date.now(), status })
  return status
}

const computeStatus = async (
  clean: string,
  authUserId?: string | null,
): Promise<DmAutomationStatus> => {
  const profile = await findProfileByUsername(clean).catch(() => null)
  if (!profile) return { allowed: false, accountType: 'influencer' }

  if (isBrandRole(profile.role)) {
    return {
      allowed: await hasMembershipPlan(clean, authUserId, BRAND_DM_PLANS),
      accountType: 'brand',
    }
  }

  const access = await readInfluencerDmAccess(clean)
  if (isAdminRole(profile.role)) {
    const paid = await hasMembershipPlan(clean, authUserId, BRAND_DM_PLANS)
    return { allowed: paid || !!access?.allowed, accountType: 'brand' }
  }

  return {
    allowed: !!access?.allowed,
    accountType: 'influencer',
    registered: !!access?.registered,
    suspended: !!access?.suspended,
    suspendedReason: access?.reason || '',
  }
}

/** 이 사용자가 디엠 자동화를 이용할 수 있는지. */
export const dmAutomationAllowed = async (
  username: string | null | undefined,
  authUserId?: string | null,
): Promise<boolean> => (await dmAutomationStatus(username, authUserId)).allowed
