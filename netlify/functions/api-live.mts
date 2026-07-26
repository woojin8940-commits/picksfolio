import { getStore } from "@netlify/blobs";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import type { Config, Context } from "@netlify/functions";

/**
 * 라이브 방송 상태(broadcast state) 읽기/쓰기.
 *
 * 이 경로는 두 종류의 쓰기를 함께 받는다:
 *   • 방송자 — isLive / currentProduct / heartbeatAt 등 방송 상태. **본인만** 쓸 수 있어야
 *     한다. 무인증이면 아무나 남의 채널을 "방송 종료" 시키거나, 있지도 않은 방송을
 *     "방송중"으로 띄우고 임의의 상품을 노출시킬 수 있다.
 *   • 시청자 — 익명 시청자의 접속/이탈(heartbeat / leave). 로그인하지 않은 시청자도
 *     보내므로 인증을 요구할 수 없다.
 *
 * 그래서 본문 모양으로 경로를 가른다. 덧붙여 예전에는 시청자 heartbeat 가 방송 상태 블롭
 * 전체를 setJSON 으로 덮어써서 isLive 가 통째로 날아갔다(방송자의 다음 ~8초 heartbeat 가
 * 올 때까지 시청자에게 방송이 꺼진 것처럼 보였다). 시청자 접속은 별도 블롭에 모으고,
 * 방송 상태는 방송자만 쓰도록 분리한다.
 */

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // Strong consistency so a viewer's "is this broadcast live?" poll reflects the
  // broadcaster's go-live/end-broadcast write immediately. With the default
  // eventual store this read could lag up to 60s, so viewers would keep seeing
  // isLive=false (never connecting) or stale isLive=true after a broadcast ended.
  // Matches api-admin-live.mts, which already opens this same store as 'strong'.
  const store = getStore({ name: "live-state", consistency: "strong" });
  const key = `picks_live_${username}`;

  // 시청자 접속 집계는 방송 상태와 다른 블롭에 둔다(위 주석 참고).
  const viewerStore = getStore({ name: "live-viewers", consistency: "strong" });
  const viewerKey = `viewers_${username}`;

  // A broadcast that crashes, force-quits, or whose end-broadcast write never
  // lands would otherwise leave isLive=true in the store forever — so the host's
  // own page (and every viewer) keeps showing "방송중" when nobody is live. The
  // broadcaster heartbeats `heartbeatAt` every ~8s while live, so any isLive=true
  // record whose heartbeat is older than this window is a dead session: report it
  // as offline. (Records written before heartbeats existed have no heartbeatAt and
  // are left untouched to avoid hiding a genuinely live legacy broadcast.)
  const LIVE_HEARTBEAT_STALE_MS = 40_000;
  // 시청자는 15초마다 heartbeat 를 보낸다. 두 번 놓치면 나간 것으로 본다.
  const VIEWER_STALE_MS = 45_000;

  /** 아직 살아 있는 시청자 수. 만료된 항목은 걷어낸다. */
  const readViewers = async (): Promise<Record<string, number>> => {
    const raw = (await viewerStore.get(viewerKey, { type: "json" }).catch(() => null)) as
      | Record<string, number>
      | null;
    if (!raw) return {};
    const now = Date.now();
    const alive: Record<string, number> = {};
    for (const [id, seen] of Object.entries(raw)) {
      if (typeof seen === "number" && now - seen <= VIEWER_STALE_MS) alive[id] = seen;
    }
    return alive;
  };

  if (req.method === "GET") {
    const data = (await store.get(key, { type: "json" })) as any;
    if (!data) return Response.json({ isLive: false, viewerCount: 0 });
    if (
      data.isLive &&
      typeof data.heartbeatAt === "number" &&
      Date.now() - data.heartbeatAt > LIVE_HEARTBEAT_STALE_MS
    ) {
      return Response.json({ ...data, isLive: false, viewerCount: 0 });
    }
    // 방송 중일 때만 실제 접속자 수를 얹는다(종료된 방송은 0).
    const viewerCount = data.isLive ? Object.keys(await readViewers()).length : 0;
    return Response.json({ ...data, viewerCount });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));

    // ── 익명 시청자 접속/이탈 ── 인증 없이 받되, 시청자 블롭만 건드린다.
    if (body?.heartbeat === true || body?.leave === true) {
      const viewerId = String(body?.viewerId || "").slice(0, 64);
      if (!viewerId) return Response.json({ success: true, viewerCount: 0 });

      const alive = await readViewers();
      if (body.leave === true) delete alive[viewerId];
      else alive[viewerId] = Date.now();

      // 폭주 방지 — 비정상적으로 많은 항목은 최근 것만 남긴다.
      const entries = Object.entries(alive).sort((a, b) => b[1] - a[1]).slice(0, 5000);
      await viewerStore.setJSON(viewerKey, Object.fromEntries(entries));
      return Response.json({ success: true, viewerCount: entries.length });
    }

    // ── 방송 상태 쓰기 ── 본인(또는 관리자)만.
    const auth = await requireAccountOwner(req, username);
    if (!auth.ok) return auth.response;

    // 방송자가 보내온 viewerCount 는 신뢰하지 않는다(집계는 서버가 한다).
    const { viewerCount: _ignored, ...state } = body || {};
    const viewerCount = state.isLive ? Object.keys(await readViewers()).length : 0;
    await store.setJSON(key, { ...state, viewerCount });
    return Response.json({ success: true, viewerCount });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/live/:username",
};
