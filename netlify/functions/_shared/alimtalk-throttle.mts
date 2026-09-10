import { BlobWriteConflictError, mutateBlobJSON } from "./blob-write.mts";

/**
 * "이 알림은 조금 전에 이미 보냈다" 를 기억하는 자리.
 *
 * 협업방 대화는 한 번에 여러 줄이 연달아 온다("안녕하세요" / "기획안 봤어요" /
 * "여기만 고쳐 주세요"). 줄마다 알림톡이 나가면 받는 사람에게는 같은 알림이 5초
 * 간격으로 세 번 오고, 보내는 쪽에는 그만큼 요금이 붙는다. 그래서 첫 줄에만 보내고
 * 그 뒤 일정 시간은 보내지 않는다 — 대화가 계속되는 동안에도 알림은 그 간격마다
 * 한 번씩만 나간다.
 *
 * 막는 것은 알림톡뿐이다. 앱 푸시는 줄마다 그대로 나간다. 푸시는 요금이 없고, 대화
 * 중인 사람에게는 매 줄이 실제로 필요한 정보다.
 *
 * 판정을 블롭에 두는 이유: 함수 인스턴스는 요청마다 새로 뜨므로 메모리에 둔 시각은
 * 다음 메시지에서 남아 있지 않다. 조건부 쓰기(mutateBlobJSON)로 넣어서, 두 메시지가
 * 같은 순간에 도착해도 한쪽만 발송 권한을 얻는다.
 */

const STORE = "alimtalk-throttle";

/** 협업 타임라인 메시지 알림 간격. 첫 메시지 후 이 시간 동안은 알림톡을 보내지 않는다. */
export const TIMELINE_ALIMTALK_COOLDOWN_MS = 5 * 60 * 1000;

type Slot = { notifiedAt: string };

/**
 * 이번 알림을 보낼 차례인지 묻고, 보낼 차례면 그 자리를 잡는다(claim).
 *
 * @returns true 면 지금 보내야 한다. false 면 최근에 이미 보냈으므로 건너뛴다.
 */
export async function claimAlimtalkSlot(key: string, cooldownMs: number): Promise<boolean> {
  const now = Date.now();
  let claimed = false;

  try {
    await mutateBlobJSON<Slot>(STORE, key, (current) => {
      const last = Date.parse(String(current?.notifiedAt || ""));
      if (Number.isFinite(last) && now - last < cooldownMs) {
        claimed = false;
        return null;
      }
      claimed = true;
      return { notifiedAt: new Date(now).toISOString() };
    });
  } catch (err) {
    // 같은 순간에 들어온 다른 메시지가 자리를 잡았다는 뜻이다. 보내지 않는다 —
    // 알림이 한 번 늦는 것보다 같은 알림이 두 번 가는 쪽이 나쁘다.
    if (err instanceof BlobWriteConflictError) return false;
    // 그 밖의 저장소 오류로 알림을 통째로 잃지는 않는다.
    console.error(`[alimtalk-throttle] 발송 간격 확인 실패 (${key}):`, err);
    return true;
  }

  return claimed;
}
