import type { Config } from "@netlify/functions";

/**
 * Returns the ICE server list (STUN + TURN) used by the WebRTC live broadcast.
 *
 * Why this matters: the browser viewer (`src/services/webrtcSignaling.ts`)
 * forces `iceTransportPolicy: 'relay'` for every mobile viewer, because mobile
 * carriers sit behind carrier-grade NAT that blocks direct peer-to-peer WebRTC.
 * In relay-only mode the connection can ONLY succeed through a TURN server — so
 * if this endpoint returns no TURN servers, PC viewers still connect over
 * direct P2P/STUN but mobile viewers never receive a single frame.
 *
 * Credentials are resolved here (server-side) rather than baked into the JS
 * bundle so they can be rotated without a redeploy. Two sources are supported,
 * merged in this order:
 *   1. Metered.ca ephemeral credentials — fetched per request when
 *      METERED_API_KEY (+ METERED_APP_NAME) are set. Ephemeral credentials
 *      avoid the shared-quota "Allocate Error 400" failure mode of static keys.
 *   2. Static TURN servers from TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL
 *      (and the matching TURN_BACKUP_* trio), if configured.
 *
 * Response shape (kept in sync with the client's refreshIceServers()):
 *   { iceServers: RTCIceServer[], diagnostics: {...} }
 * `diagnostics` reports — without ever leaking secret values — whether each
 * source was configured and how Metered responded, so a missing/expired key
 * shows up in the browser console instead of failing silently.
 */

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const present = (v: unknown): "present" | "missing" =>
  typeof v === "string" && v.length > 0 ? "present" : "missing";

function splitUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Expand a bare TURN hostname (e.g. `turn:relay.example.com`) into the five
 * canonical port/transport variants so restrictive firewalls have a path that
 * gets through (80/443, UDP/TCP, plus TLS on 443). URLs that already carry a
 * port or `?transport=` are used verbatim.
 */
function expandTurnUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (!/^turns?:/i.test(u)) continue;
    if (/:[0-9]+|\?transport=/.test(u)) {
      out.push(u);
    } else {
      const stripped = u.replace(/\/$/, "");
      out.push(`${stripped}:80`);
      out.push(`${stripped}:443`);
      out.push(`${stripped}:80?transport=tcp`);
      out.push(`${stripped}:443?transport=tcp`);
      out.push(stripped.replace(/^turn:/i, "turns:") + ":443?transport=tcp");
    }
  }
  return out;
}

function buildStaticTurnGroup(
  rawUrls: string | undefined,
  user: string | undefined,
  cred: string | undefined,
): RTCIceServer[] {
  const urls = expandTurnUrls(splitUrls(rawUrls));
  if (urls.length === 0 || !user || !cred) return [];
  return urls.map((u) => ({ urls: u, username: user, credential: cred }));
}

/**
 * Fetch ephemeral ICE servers from the Metered.ca REST API. Returns the raw
 * server list (already including their own STUN entries) plus a short status
 * string for diagnostics. Never throws — on any error it returns an empty list
 * so the caller can still serve STUN + any static TURN.
 */
async function fetchMeteredIceServers(
  appName: string,
  apiKey: string,
): Promise<{ servers: RTCIceServer[]; status: string }> {
  const endpoint = `https://${encodeURIComponent(appName)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      // Don't let a slow TURN provider hang the viewer's connection setup.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return { servers: [], status: `metered_http_${res.status}` };
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      return { servers: [], status: "metered_unexpected_payload" };
    }
    const servers = data.filter(
      (s: any) => s && (typeof s.urls === "string" || Array.isArray(s.urls)),
    ) as RTCIceServer[];
    return { servers, status: `metered_ok_${servers.length}` };
  } catch (err: any) {
    const reason = err?.name === "TimeoutError" ? "metered_timeout" : "metered_fetch_error";
    return { servers: [], status: reason };
  }
}

export default async (_req: Request) => {
  const env = process.env;

  const meteredApiKey = env.METERED_API_KEY;
  const meteredAppName = env.METERED_APP_NAME;

  let meteredStatus = "not_configured";
  let meteredServers: RTCIceServer[] = [];
  if (meteredApiKey && meteredAppName) {
    const result = await fetchMeteredIceServers(meteredAppName, meteredApiKey);
    meteredServers = result.servers;
    meteredStatus = result.status;
  }

  const staticPrimary = buildStaticTurnGroup(
    env.TURN_URLS,
    env.TURN_USERNAME,
    env.TURN_CREDENTIAL,
  );
  const staticBackup = buildStaticTurnGroup(
    env.TURN_BACKUP_URLS,
    env.TURN_BACKUP_USERNAME,
    env.TURN_BACKUP_CREDENTIAL,
  );

  const iceServers: RTCIceServer[] = [
    ...STUN_SERVERS,
    ...meteredServers,
    ...staticPrimary,
    ...staticBackup,
  ];

  const diagnostics = {
    meteredApiKey: present(meteredApiKey),
    meteredAppName: present(meteredAppName),
    meteredStatus,
    turnUrls: present(env.TURN_URLS),
    turnUsername: present(env.TURN_USERNAME),
    turnCredential: present(env.TURN_CREDENTIAL),
  };

  return Response.json(
    { iceServers, diagnostics },
    {
      headers: {
        // Ephemeral Metered credentials are short-lived; never let a CDN or the
        // browser cache a stale credential set.
        "Cache-Control": "no-store",
      },
    },
  );
};

export const config: Config = {
  path: "/api/ice-servers",
};
