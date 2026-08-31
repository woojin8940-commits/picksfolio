import { getStore } from "@netlify/blobs";

/**
 * 로그인을 요구할 수 없는 공개 엔드포인트용 호출 횟수 제한.
 *
 * 업로드(`/api/upload-image` 등)와 제안 타임라인 댓글은 비로그인 업체가 쓰는 공개
 * 폼이 같은 경로를 쓰기 때문에 인증으로 막을 수 없다. 그런데 막지 않으면 한 사람이
 * 저장소를 채우거나(업로드) 알림톡 · SMS 를 무한히 발송시킬 수 있다(댓글 → 알림 큐).
 * 실제 비용이 나가는 쪽이므로 최소한 속도는 묶어 둔다.
 *
 * 정확도에 대해 — Blobs 에는 원자적 증가가 없다. 같은 순간에 들어온 요청 몇 개는
 * 같은 값을 읽어 한도를 조금 넘길 수 있다. 이 장치의 목적은 정확한 과금이 아니라
 * 남용을 막는 것이므로 그 오차를 받아들인다.
 *
 * 저장소가 실패하면 통과시킨다(fail-open). 카운터를 읽지 못했다는 이유로 정상적인
 * 제안서 업로드를 막으면, 막으려던 남용보다 더 큰 문제가 된다.
 */

/** 호출자 IP. Netlify 가 넣어 주는 헤더를 먼저 보고, 없으면 프록시 헤더를 본다. */
export function clientIp(req: Request): string {
  const direct = req.headers.get("x-nf-client-connection-ip");
  if (direct) return direct.trim();
  const forwarded = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || "unknown";
}

export type RateLimitResult = { ok: true } | { ok: false; response: Response };

export async function checkRateLimit(opts: {
  /** 용도별로 카운터를 나누는 이름. 예: "upload", "timeline-comment" */
  bucket: string;
  /** 보통 clientIp(req). 계정 단위로 재려면 username 을 넣는다. */
  key: string;
  /** 창 안에서 허용할 횟수 */
  limit: number;
  /** 창 길이(초) */
  windowSeconds: number;
  /** 한도를 넘겼을 때 사용자에게 보일 문구 */
  message?: string;
}): Promise<RateLimitResult> {
  const { bucket, key, limit, windowSeconds } = opts;
  const safeKey = String(key || "unknown").replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 128);
  const storeKey = `${bucket}/${safeKey}`;

  try {
    const store = getStore("rate-limits");
    const now = Date.now();
    const current = (await store.get(storeKey, { type: "json" })) as
      | { count?: number; resetAt?: number }
      | null;

    // 창이 지났거나 기록이 없으면 새 창을 시작한다.
    if (!current || typeof current.resetAt !== "number" || current.resetAt <= now) {
      await store.setJSON(storeKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { ok: true };
    }

    const count = Number(current.count || 0);
    if (count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      return {
        ok: false,
        response: Response.json(
          {
            error:
              opts.message ||
              `요청이 너무 많습니다. ${retryAfter}초 후에 다시 시도해 주세요.`,
            code: "RATE_LIMITED",
          },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        ),
      };
    }

    await store.setJSON(storeKey, { count: count + 1, resetAt: current.resetAt });
    return { ok: true };
  } catch (err) {
    console.error(`[rate-limit] ${storeKey} 확인 실패 — 통과시킨다`, err);
    return { ok: true };
  }
}
