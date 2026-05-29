import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/**
 * WebRTC signaling relay over HTTP polling, backed by Netlify Blobs.
 *
 * The browser (`src/services/webrtcSignaling.ts`) implements signaling without
 * any realtime socket: the broadcaster and every viewer POST signal messages
 * to their shared room and GET-poll for messages addressed to them. This
 * function is the shared mailbox.
 *
 * Protocol (must stay in sync with the client):
 *   POST   /api/signal/:room   body = SignalMessage
 *          { id, type, senderId, targetId?, payload? }
 *          → stored with a server-assigned `timestamp`; returns { success }.
 *   GET    /api/signal/:room?participantId=<id>&since=<ms>
 *          → { signals: (SignalMessage & { timestamp })[], latestTimestamp }
 *          Returns messages newer than `since` that are addressed to the
 *          caller — i.e. broadcast messages (no targetId: viewer-join, chat)
 *          or messages targeted at `participantId`. The caller's own messages
 *          are excluded.
 *   DELETE /api/signal/:room
 *          → clears the room (broadcaster calls this on start and on stop).
 *
 * Each message is stored under its own blob key (`<ts>_<id>`) rather than in a
 * single shared array. A single JSON array would force a read-modify-write on
 * every POST, and concurrent posts (the broadcaster's offer/ICE racing every
 * viewer's answer/ICE, plus chat) would silently overwrite one another. Losing
 * a `viewer-join` or ICE batch is exactly what leaves a viewer on a black
 * screen, so per-key writes — which never collide — are worth the extra reads.
 */

const STORE_NAME = "signal-messages";
// Messages live for 60s. The broadcaster also clears the room on start/stop,
// so this only bounds growth during a single long-running broadcast (chat +
// ICE) and keeps the per-poll list() small.
const RETENTION_MS = 60_000;

type SignalMessage = {
  id: string;
  type: string;
  senderId: string;
  targetId?: string;
  payload?: unknown;
  timestamp: number;
};

function parseTimestampFromKey(key: string): number {
  // Key format: "<room>/<timestamp>_<id>" — pull the numeric timestamp segment.
  const tail = key.slice(key.lastIndexOf("/") + 1);
  const ts = parseInt(tail.split("_")[0], 10);
  return Number.isFinite(ts) ? ts : 0;
}

export default async (req: Request, context: Context) => {
  const room = context.params.room?.toLowerCase();
  if (!room) {
    return Response.json({ error: "room is required" }, { status: 400 });
  }

  // Strong consistency is REQUIRED here, not optional. WebRTC signaling needs
  // viewer-join → offer → answer → ICE candidates to all be read back within
  // ~1–2s of being written. The default "eventual" store can take up to 60s to
  // propagate a write, so the broadcaster's list()/get() polls would not see a
  // viewer's join (or the offer/answer/ICE that follow) until long after the
  // peer connection has already timed out — leaving every viewer on a black
  // screen. Strong consistency trades a little per-call latency for the
  // immediate read-after-write the signaling protocol depends on.
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const prefix = `${room}/`;

  try {
    if (req.method === "POST") {
      const body = (await req.json()) as Partial<SignalMessage>;
      if (!body || !body.type || !body.senderId) {
        return Response.json({ error: "invalid signal message" }, { status: 400 });
      }
      const timestamp = Date.now();
      const id = body.id || `${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
      const message: SignalMessage = {
        id,
        type: body.type,
        senderId: body.senderId,
        targetId: body.targetId,
        payload: body.payload,
        timestamp,
      };
      await store.setJSON(`${prefix}${timestamp}_${id}`, message);
      return Response.json({ success: true });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const participantId = url.searchParams.get("participantId") || "";
      const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
      const now = Date.now();
      const expiredBefore = now - RETENTION_MS;

      const listed = await store.list({ prefix });
      const blobs = listed.blobs || [];

      const expiredKeys: string[] = [];
      const freshKeys: string[] = [];
      for (const blob of blobs) {
        const ts = parseTimestampFromKey(blob.key);
        if (ts < expiredBefore) {
          expiredKeys.push(blob.key);
        } else if (ts > since) {
          freshKeys.push(blob.key);
        }
      }

      // Opportunistically reap expired messages so a long broadcast's room
      // stays small. Each poll only ever sees the handful that just aged out.
      if (expiredKeys.length > 0) {
        await Promise.all(expiredKeys.map((key) => store.delete(key).catch(() => {})));
      }

      const fetched = await Promise.all(
        freshKeys.map((key) => store.get(key, { type: "json" }).catch(() => null)),
      );

      const signals: SignalMessage[] = [];
      let latestTimestamp = since;
      for (const msg of fetched) {
        if (!msg || typeof msg !== "object") continue;
        const m = msg as SignalMessage;
        // Don't echo the caller's own messages back to them.
        if (participantId && m.senderId === participantId) continue;
        // Deliver broadcast messages (no targetId) and messages addressed to us.
        if (m.targetId && participantId && m.targetId !== participantId) continue;
        signals.push(m);
        if (m.timestamp > latestTimestamp) latestTimestamp = m.timestamp;
      }

      signals.sort((a, b) => a.timestamp - b.timestamp);
      return Response.json({ signals, latestTimestamp });
    }

    if (req.method === "DELETE") {
      const listed = await store.list({ prefix });
      const blobs = listed.blobs || [];
      await Promise.all(blobs.map((blob) => store.delete(blob.key).catch(() => {})));
      return Response.json({ success: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (error: any) {
    console.error("[api-signal] error:", error?.message || error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
};

export const config: Config = {
  path: ["/api/signal", "/api/signal/:room"],
};
