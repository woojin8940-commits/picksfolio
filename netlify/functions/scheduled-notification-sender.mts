import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { sendKakaoAlimtalk } from './_shared/kakao-message.mts'
import { timelineMessageAlimtalk } from './_shared/alimtalk-templates.mts'

/**
 * 협업 타임라인 새 메시지 알림 대기열의 한 줄.
 *
 * 대기열에 오르는 것 자체가 "이번 메시지는 알림톡을 보낸다"는 판정이 끝난 것이다 —
 * 첫 메시지에만 올리고 그 뒤 5분은 올리지 않는 판정은 api-timeline-comment 쪽의
 * claimAlimtalkSlot 이 한다. 여기서는 올라온 것을 보내기만 한다.
 *
 * messageCount · 미리보기 항목은 예전(30초 묶음 발송) 대기열이 쓰던 것으로, 승인된
 * 템플릿에는 메시지 본문이 들어가지 않아 더 이상 쓰지 않는다. 배포 직전에 쌓인
 * 줄에는 아직 값이 들어 있으므로 형태만 남겨 둔다.
 */
interface PendingNotification {
  recipientUsername: string
  recipientType?: string
  proposalId: string
  companyName: string
  proposalTitle: string
  senderName?: string
  messageCount?: number
  firstMessagePreview?: string
  lastMessagePreview?: string
  magicLink: string
  siteOrigin: string
  sendAfter: string
}

export default async () => {
  const notifQueue = getStore({ name: 'notification-queue', consistency: 'strong' })
  const now = new Date()

  const { blobs } = await notifQueue.list({ prefix: 'pending:' })

  if (blobs.length === 0) {
    console.log('[scheduled-notif] No pending notifications')
    return
  }

  console.log(`[scheduled-notif] Found ${blobs.length} pending notification(s)`)

  for (const blob of blobs) {
    try {
      const pending = await notifQueue.get(blob.key, { type: 'json' }) as PendingNotification | null
      if (!pending) continue

      if (new Date(pending.sendAfter) > now) {
        continue
      }

      const template = timelineMessageAlimtalk({
        recipient: pending.recipientUsername,
        senderName: pending.senderName || pending.companyName,
        projectName: pending.proposalTitle,
      })

      const result = await sendKakaoAlimtalk({
        username: pending.recipientUsername,
        ...template,
      })

      if (result.success) {
        console.log(`[scheduled-notif] Sent notification for ${pending.recipientUsername}:${pending.proposalId}`)
      } else {
        console.error(`[scheduled-notif] Failed to send: ${result.error}`)
      }

      await notifQueue.delete(blob.key)
    } catch (e) {
      console.error(`[scheduled-notif] Error processing ${blob.key}:`, e)
    }
  }
}

export const config: Config = {
  schedule: '* * * * *',
}
