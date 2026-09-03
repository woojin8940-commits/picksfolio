/**
 * 라이브 커머스 송출 자격(서버 게이트).
 *
 * 지금까지 라이브 송출 자격은 `LiveCommerceManagement.tsx` 의 클라이언트 체크뿐이었다.
 * 즉 `/api/stream-key/:username` 을 직접 부르면 멤버십 없이도 송출 자격증명(Amazon IVS
 * ingest + stream key)을 받아갈 수 있었다. 이 모듈이 그 판정을 서버로 옮긴다.
 *
 * 송출하려면(둘 중 하나):
 *   1) 라이브 커머스 멤버십(별도 구독) 또는 기존 커머스 멤버십
 *   2) 다른 호스트의 "함께 방송하기" 초대를 수락한 게스트 (accepted / live 세션 보유)
 *
 * 예전에는 여기에 사업자 인증 + 정산 계좌 등록도 함께 요구했다. 두 절차는 라이브
 * 커머스 전용이었고 서비스에서 없앴으므로, 이제 판정에 쓰지 않는다.
 *
 * 2번은 클라이언트 게이트의 `&& !coBroadcastActive` 예외와 같은 규칙이다. 게스트는 자기
 * 멤버십 없이도 초대받은 합동방송에는 참여할 수 있어야 한다.
 */

import { getStore } from '@netlify/blobs'
import { getDatabase } from '@picks/netlify-database'
import { applyComplimentaryMembership } from './complimentary-memberships.mts'
import { applyOperatorMembershipGrant, getOperatorMembershipGrant } from './operator-membership-grants.mts'
import { hasLiveCommerceAccess } from './membership-billing.mts'
import { readSellerMembership } from './seller-membership-store.mts'

// 라이브 커머스 멤버십은 판매를 종료했다 — 새로 구독할 수 있는 경로가 없으므로
// 가격을 안내하지 않고 이용할 수 없다는 사실만 알린다(기존 구독자는 계속 통과).
export const LIVE_MEMBERSHIP_REQUIRED_MESSAGE =
  '라이브 커머스 기능은 현재 제공되지 않습니다.'

const cleanName = (username: string) => username.toLowerCase().trim().replace(/^biz\//, '')

/**
 * 초대를 수락했거나 이미 합동방송 중인 게스트/호스트인지.
 * 클라이언트의 coBroadcastActive 우회를 서버에서도 동일하게 허용한다.
 */
async function hasActiveCoBroadcast(username: string): Promise<boolean> {
  try {
    const db = getDatabase()
    const rows = (await db.sql`
      SELECT 1 FROM cobroadcast_sessions
      WHERE (host_username = ${username} OR guest_username = ${username})
        AND status IN ('accepted', 'live')
      LIMIT 1
    `) as unknown[]
    return rows.length > 0
  } catch (e) {
    // DB 조회 실패로 정상 게스트의 합동방송을 막지는 않되, 이 경로만으로 자격을
    // 열어 주지도 않는다(멤버십 판정은 별도로 이미 끝났다).
    console.warn('[live-access] cobroadcast lookup failed:', (e as Error)?.message)
    return false
  }
}

export interface LiveAccessResult {
  allowed: boolean
  /** 거부 사유 코드 — 클라이언트가 안내 문구를 고르는 데 쓴다. */
  reason?: 'membership'
  message?: string
}

/**
 * 이 사용자가 라이브를 송출할 수 있는지 판정한다.
 * 판정 실패(스토어 오류)는 fail-closed — 자격증명을 넘기지 않는다.
 */
export async function checkLiveBroadcastAccess(
  usernameRaw: string,
  authUserId?: string | null,
): Promise<LiveAccessResult> {
  const username = cleanName(usernameRaw)
  if (!username) return { allowed: false, reason: 'membership', message: LIVE_MEMBERSHIP_REQUIRED_MESSAGE }

  let record: Record<string, any> | null = null
  try {
    const store = getStore('seller-verification')
    const stored = (await readSellerMembership(store, username).catch(() => null)) as Record<string, any> | null
    const complimentary = applyComplimentaryMembership(username, stored) as Record<string, any> | null
    const grant = await getOperatorMembershipGrant({ authUserId, username })
    record = applyOperatorMembershipGrant(complimentary, grant) as Record<string, any> | null
  } catch (e) {
    console.warn('[live-access] verification lookup failed:', (e as Error)?.message)
    record = null
  }

  const membershipOk = hasLiveCommerceAccess(record)

  if (membershipOk) return { allowed: true }

  // 합동방송 게스트 예외 — 초대받은 방송에는 자기 멤버십 없이도 참여할 수 있다.
  if (await hasActiveCoBroadcast(username)) return { allowed: true }

  return { allowed: false, reason: 'membership', message: LIVE_MEMBERSHIP_REQUIRED_MESSAGE }
}
