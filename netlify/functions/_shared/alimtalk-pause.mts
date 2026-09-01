/**
 * 알림톡 발송 일시 중지 스위치.
 *
 * 솔라피에 알림톡 템플릿을 새로 올려 심사를 받는 동안, 운영 중인 알림톡을 그대로
 * 두면 두 가지가 동시에 일어난다. 심사 중인 템플릿으로 나간 발송은 거절되고,
 * 거절된 발송은 아래의 SMS 대체 발송으로 떨어져 알림톡 문구가 그대로 문자로
 * 나간다 — 즉 "알림톡을 껐는데 문자 요금이 더 나오는" 모양이 된다. 그래서 이
 * 스위치는 채널 하나가 아니라 발송 자체를 막는다(알림톡 + 그 대체 문자).
 *
 * 막지 않는 것:
 *   · 인증번호 문자(send-sms) — 로그인·회원가입이 여기에 걸려 있다. 알림톡
 *     템플릿과 무관한 별개 경로이므로 그대로 둔다.
 *   · 앱 푸시 · 화면 안 알림 — 솔라피를 거치지 않는다. 중지 기간에도 사용자는
 *     푸시와 앱 안에서 소식을 받는다.
 *
 * 되돌리는 방법: 환경변수 `ALIMTALK_PAUSED` 를 `false` 로 두면 즉시 다시 나간다
 * (코드 배포가 필요 없다). 값이 없으면 "중지"가 기본값이다 — 심사 기간에 환경변수
 * 하나를 깜빡한 것이 곧 발송 재개가 되면 안 된다.
 */

const RESUME_VALUES = new Set(["false", "0", "off", "no", "n", "resume", "active", "live"]);

const readEnv = (name: string): string => {
  try {
    const fromNetlify = (globalThis as any)?.Netlify?.env?.get?.(name);
    if (typeof fromNetlify === "string") return fromNetlify;
  } catch {
    // Netlify 전역이 없는 실행 환경(로컬 스크립트 등)에서는 process.env 로 떨어진다.
  }
  return (globalThis as any)?.process?.env?.[name] ?? "";
};

/** 지금 알림톡·대체 문자 발송이 중지 상태인가. */
export const alimtalkPaused = (): boolean =>
  !RESUME_VALUES.has(String(readEnv("ALIMTALK_PAUSED") || "").trim().toLowerCase());

/** 화면과 로그에 같은 문장을 쓴다. 사용자가 "알림이 안 온다"로 읽지 않게 이유를 적는다. */
export const ALIMTALK_PAUSE_NOTICE =
  "카카오 알림톡 템플릿 재심사가 진행 중이라 알림톡·대체 문자 발송을 일시 중지했습니다. 알림은 앱 푸시와 화면 안 알림으로만 전달됩니다.";

/**
 * 발송을 건너뛴 응답.
 *
 * 실패(4xx/5xx)가 아니라 성공으로 답한다. 부르는 쪽 대부분은 실패를 재시도 대상으로
 * 보거나(알림 대기열은 응답이 실패면 항목을 그대로 남긴다) 사용자에게 오류를 띄우는데,
 * 중지는 오류가 아니고 재시도할 일도 아니다. 대기열에 쌓아 두었다가 재개 시점에
 * 한꺼번에 내보내면 며칠 지난 "새 메시지가 도착했습니다"가 그때 도착한다.
 */
export const alimtalkPausedResponse = (channel: string) =>
  Response.json({
    success: true,
    skipped: true,
    paused: true,
    channel,
    message: ALIMTALK_PAUSE_NOTICE,
  });
