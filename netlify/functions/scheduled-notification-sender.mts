import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'

interface PendingNotification {
  recipientUsername: string
  recipientType?: string
  proposalId: string
  companyName: string
  proposalTitle: string
  senderName?: string
  messageCount: number
  firstMessagePreview: string
  lastMessagePreview: string
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

      const projectName = pending.proposalTitle || '협업 프로젝트'
      const senderName = pending.senderName || pending.companyName || '발신자'
      const companyName = pending.companyName || senderName

      const messagePart = pending.messageCount === 1
        ? (pending.firstMessagePreview || '새 메시지가 도착했습니다.')
        : `${pending.messageCount}개의 새 메시지 (최근: "${pending.lastMessagePreview || '메시지'}")`

      const templateId = Netlify.env.get('SOLAPI_KAKAO_TIMELINE_TEMPLATE_ID') || ''

      const notifBody = {
        username: pending.recipientUsername,
        message: `[픽스폴리오] 협업 타임라인 새 메시지\n\n${senderName}님이 "${projectName}" 프로젝트에 메시지를 남겼습니다.\n\n${messagePart}\n\n아래 버튼을 눌러 바로 답장하세요.\n\n${pending.magicLink}`,
        templateId,
        variables: {
          '#{고객명}': pending.recipientUsername || '고객',
          '#{업체명}': companyName,
          '#{프로젝트명}': projectName,
          '#{메시지내용}': messagePart,
          '#{링크연결}': pending.magicLink,
        },
      }

      const sendUrl = `${pending.siteOrigin}/api/send-kakao-alimtalk`
      const resp = await fetch(sendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifBody),
      })

      if (resp.ok) {
        console.log(`[scheduled-notif] Sent notification for ${pending.recipientUsername}:${pending.proposalId} (${pending.messageCount} messages)`)
      } else {
        console.error(`[scheduled-notif] Failed to send: ${resp.status} ${await resp.text()}`)
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
