/**
 * Talks to the PICKS Folio web backend for everything the native broadcast
 * screen needs that isn't on the device:
 *
 *  - `fetchStreamKey` loads the seller's Amazon IVS ingest server + stream key
 *    from `/api/stream-key/:username` (the same endpoint the web live console
 *    uses; it reads the seller's stored channel config and enforces the monthly
 *    time cap). This is the "Supabase에서 불러오기" path — the broadcaster never
 *    has to copy/paste credentials.
 *  - `setLiveState` mirrors what the web broadcaster writes to
 *    `/api/live/:username` so that web viewers discover the native broadcast as
 *    "라이브 중" and start playing the IVS HLS stream, exactly as they would for a
 *    web-originated broadcast.
 *
 * All calls are best-effort and time-bounded: a backend hiccup must never wedge
 * the broadcast UI.
 */
import { config } from '@/constants/config';

const REQUEST_TIMEOUT_MS = 8000;

export interface StreamKey {
  ingestServer: string;
  streamKey: string;
  playbackUrl?: string;
  rtmpUrl?: string;
}

export type StreamKeyResult =
  | { ok: true; data: StreamKey }
  /** Server returned no channel config yet (seller must enter it manually). */
  | { ok: false; reason: 'not-found' }
  /** Monthly/daily live-time allowance is spent — broadcasting is blocked. */
  | { ok: false; reason: 'cap'; message: string }
  | { ok: false; reason: 'error'; message: string };

function endpoint(path: string): string {
  return `${config.webUrl.replace(/\/$/, '')}${path}`;
}

async function withTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the seller's IVS ingest server + stream key from the web backend.
 * Surfaces the time-cap block (HTTP 403) so the UI can refuse to go live.
 */
export async function fetchStreamKey(username: string): Promise<StreamKeyResult> {
  const user = username.trim().toLowerCase();
  if (!user) return { ok: false, reason: 'not-found' };

  try {
    const res = await withTimeout(
      endpoint(`/api/stream-key/${encodeURIComponent(user)}`),
    );

    if (res.status === 403) {
      let message = '이번 달 라이브 잔여시간을 모두 사용했습니다.';
      try {
        const body = await res.json();
        if (body?.error) message = body.error;
      } catch {
        /* keep default */
      }
      return { ok: false, reason: 'cap', message };
    }

    if (res.status === 404) return { ok: false, reason: 'not-found' };
    if (!res.ok) {
      return { ok: false, reason: 'error', message: `서버 오류 (${res.status})` };
    }

    const data = (await res.json()) as Partial<StreamKey> | null;
    if (!data || !data.ingestServer || !data.streamKey) {
      return { ok: false, reason: 'not-found' };
    }
    return {
      ok: true,
      data: {
        ingestServer: data.ingestServer,
        streamKey: data.streamKey,
        playbackUrl: data.playbackUrl,
        rtmpUrl: data.rtmpUrl,
      },
    };
  } catch {
    return { ok: false, reason: 'error', message: '네트워크 연결을 확인해 주세요.' };
  }
}

/**
 * Mark the channel live / offline so web viewers discover the broadcast. Mirrors
 * the payload the web live console writes to the shared live-state store. Fire
 * and forget — failures are swallowed so they can't block start/stop.
 */
export async function setLiveState(
  username: string,
  isLive: boolean,
  extra?: { startedAt?: string },
): Promise<void> {
  const user = username.trim().toLowerCase();
  if (!user) return;
  try {
    await withTimeout(endpoint(`/api/live/${encodeURIComponent(user)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isLive,
        viewerCount: 0,
        currentProduct: null,
        activeMaterial: null,
        ...(isLive && extra?.startedAt ? { startedAt: extra.startedAt } : {}),
      }),
    });
  } catch {
    /* best-effort */
  }
}
