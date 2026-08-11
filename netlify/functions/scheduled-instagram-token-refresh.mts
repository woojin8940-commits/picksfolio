import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

/**
 * 인스타그램 장기 액세스 토큰 자동 갱신.
 *
 * "Instagram API with Instagram Login" 의 장기 토큰은 발급 후 60일이면 만료된다.
 * 만료되면 댓글 웹훅은 계속 도착하지만 DM 발송·피드 조회가 전부 실패하고, 화면에는
 * 여전히 "연결됨"으로 보여서 사용자는 원인을 알 수 없다. 지금까지는 갱신하는 곳이
 * 없어 연동 후 두 달이면 프로 플랜 기능이 조용히 멈췄다.
 *
 * 그래서 하루 한 번 돌면서 만료가 가까운 토큰을 `ig_refresh_token` 으로 다시 60일
 * 짜리로 바꿔 끼운다. 갱신 조건은 Meta 쪽 제약을 그대로 따른다.
 *   - 발급 후 24시간이 지난 토큰만 갱신할 수 있다.
 *   - 이미 만료된 토큰은 갱신할 수 없다 → 사용자가 재연동해야 한다.
 *
 * 구 페이지 토큰(tokenSource ≠ instagram_login)은 만료가 없어 대상에서 제외한다.
 */

/** 만료까지 이 일수 이하로 남으면 갱신한다(하루 한 번 실행이므로 넉넉히 잡는다). */
const REFRESH_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

interface DmSettings {
  accessToken?: string;
  tokenSource?: string;
  tokenExpiresAt?: string;
  igUsername?: string;
  [k: string]: unknown;
}

export default async () => {
  const store = getStore({ name: "dm-automation", consistency: "strong" });
  const now = Date.now();

  const { blobs } = await store.list({ prefix: "dm_" });
  if (blobs.length === 0) {
    console.log("[ig-token] No DM automation records");
    return;
  }

  let refreshed = 0;
  let expired = 0;
  let failed = 0;
  let skipped = 0;

  for (const blob of blobs) {
    try {
      const settings = (await store.get(blob.key, { type: "json" })) as DmSettings | null;
      const token = settings?.accessToken;

      // 연동돼 있고, 만료가 있는 Instagram Login 토큰만 대상.
      if (!settings || !token || settings.tokenSource !== "instagram_login") {
        skipped++;
        continue;
      }

      const expiresAt = settings.tokenExpiresAt ? new Date(settings.tokenExpiresAt).getTime() : NaN;
      // 만료 시각을 모르는(구 데이터) 토큰도 한 번 갱신해 만료 시각을 채워준다.
      if (Number.isFinite(expiresAt)) {
        if (expiresAt <= now) {
          // 만료된 토큰은 갱신 자체가 불가능하다. 재연동 안내를 위해 남겨만 둔다.
          expired++;
          console.warn(`[ig-token] ${blob.key} token already expired — reconnect required`);
          continue;
        }
        if (expiresAt - now > REFRESH_WINDOW_DAYS * DAY_MS) {
          skipped++;
          continue;
        }
      }

      const res = await fetch(
        "https://graph.instagram.com/refresh_access_token" +
          `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
      );
      const data = (await res.json().catch(() => ({}))) as any;

      if (!res.ok || !data?.access_token) {
        failed++;
        console.error(
          `[ig-token] refresh failed for ${blob.key}: ${data?.error?.message || `HTTP ${res.status}`}`,
        );
        continue;
      }

      const expiresIn = Number(data.expires_in || 0);
      // 갱신 중에 사용자가 설정을 바꿨을 수 있으므로 최신 레코드를 다시 읽어 토큰만 덮어쓴다.
      const latest = ((await store.get(blob.key, { type: "json" })) as DmSettings) || settings;
      await store.setJSON(blob.key, {
        ...latest,
        accessToken: data.access_token,
        tokenExpiresAt: expiresIn
          ? new Date(now + expiresIn * 1000).toISOString()
          : latest.tokenExpiresAt,
        updatedAt: new Date().toISOString(),
      });
      refreshed++;
      console.log(`[ig-token] refreshed ${blob.key} (+${Math.round(expiresIn / 86400)}d)`);
    } catch (e) {
      failed++;
      console.error(`[ig-token] error processing ${blob.key}:`, e);
    }
  }

  console.log(
    `[ig-token] Done — refreshed ${refreshed}, expired ${expired}, failed ${failed}, skipped ${skipped} of ${blobs.length}`,
  );
};

export const config: Config = {
  // 하루 한 번. 만료 14일 전부터 매일 시도하므로 하루 실패해도 여유가 있다.
  schedule: "40 18 * * *",
};
