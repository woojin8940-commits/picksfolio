/**
 * WebRTC signaling via HTTP polling (Netlify Functions + Blobs).
 * No dependency on Supabase Realtime — works on any deployment.
 */

/**
 * Mobile detection for bitrate / resolution adaptation.
 * Mobile uplinks (LTE/5G) and mobile hardware encoders can't reliably sustain
 * 1080p @ 6 Mbps, so the broadcaster sends a gentler bitrate from mobile UAs.
 * Desktop behavior is preserved.
 */
const isMobileSender = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile|KAKAOTALK|NAVER|Line|FB_IAB|Instagram/i.test(navigator.userAgent);
};

/**
 * Mobile networks (cellular + mobile carrier Wi-Fi behind CGNAT) frequently
 * block the symmetric-NAT-punching paths that direct P2P WebRTC relies on, so
 * the first connection attempt hangs at ICE state `checking` and eventually
 * fails. The canonical recovery is to retry with `iceTransportPolicy: 'relay'`,
 * which skips host/srflx candidates and forces all media through a TURN relay.
 * Kept as a utility so both viewer and broadcaster paths can share it.
 *
 * When the BROADCASTER is on mobile, viewers of any kind can't reach it over
 * direct P2P — the broadcaster's own candidates are filtered by CGNAT. In that
 * case the broadcaster must pre-emptively force its own peer connections to
 * relay-only so every viewer (PC included) hits a TURN path that works.
 */
const isMobileViewer = isMobileSender;

function buildIceConfig(forceRelay: boolean): RTCConfiguration {
  const base = getActiveIceConfig();
  if (!forceRelay) return base;
  return { ...base, iceTransportPolicy: 'relay' };
}

/**
 * Subscribers notified when every configured TURN server has reported a hard
 * allocate/auth failure. The UI uses this to show a "check your network /
 * TURN unavailable" hint instead of spinning silently.
 */
type TurnFailureListener = (info: { failedUrls: string[]; totalTurnUrls: number }) => void;
const turnFailureListeners = new Set<TurnFailureListener>();
export function onTurnAllocationFailure(listener: TurnFailureListener): () => void {
  turnFailureListeners.add(listener);
  return () => turnFailureListeners.delete(listener);
}
function notifyTurnFailure(info: { failedUrls: string[]; totalTurnUrls: number }) {
  for (const listener of turnFailureListeners) {
    try {
      listener(info);
    } catch (e) {
      console.warn('[ICE] TURN failure listener threw:', e);
    }
  }
}

// Mobile-web optimized broadcaster bitrate cap. Applied uniformly to all
// senders so mobile-web broadcasters don't melt the encoder and viewers stop
// seeing frame drops / lag. 4500 kbps is near-transparent for 720p30 H.264
// on detail-heavy commerce subjects while staying within typical mobile uplink.
const MAX_VIDEO_BITRATE_BPS = 4_500_000;
const MAX_VIDEO_BITRATE_KBPS = Math.round(MAX_VIDEO_BITRATE_BPS / 1000);

/**
 * Reorder the video transceiver's codec list so H.264 comes first when available.
 * This is the single most impactful fix for iOS Safari viewers (which use the
 * hardware H.264 decoder) and for Android Chrome on low-end devices. Kept as a
 * preference — other codecs remain in the list as a fallback — so negotiation
 * never fails just because one side is missing H.264.
 *
 * IMPORTANT: we do NOT rewrite `profile-level-id` in the SDP (see note at
 * `preferH264HighProfile` below). `setCodecPreferences` only reorders; it does
 * not change codec parameters, so it is safe on mobile hardware encoders.
 */
function preferH264OnVideoTransceivers(pc: RTCPeerConnection) {
  try {
    if (typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return;
    const caps = RTCRtpSender.getCapabilities('video');
    if (!caps || !caps.codecs || caps.codecs.length === 0) return;

    // Keep rtx/red/ulpfec at the end, H.264 first, then other real codecs.
    const isAux = (mime: string) => /rtx|red|ulpfec|flexfec/i.test(mime);
    const isH264 = (mime: string) => /h264/i.test(mime);
    const sorted = [...caps.codecs].sort((a, b) => {
      const am = a.mimeType, bm = b.mimeType;
      if (isAux(am) && !isAux(bm)) return 1;
      if (!isAux(am) && isAux(bm)) return -1;
      if (isH264(am) && !isH264(bm)) return -1;
      if (!isH264(am) && isH264(bm)) return 1;
      return 0;
    });

    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.sender?.track?.kind || transceiver.receiver?.track?.kind;
      if (kind !== 'video') continue;
      if (typeof (transceiver as any).setCodecPreferences !== 'function') continue;
      try {
        (transceiver as any).setCodecPreferences(sorted);
      } catch (e) {
        // Some browsers throw if the codec list doesn't include a required codec.
        // Falling back to default ordering is fine — negotiation still works.
        console.warn('[Codec] setCodecPreferences failed, using default order:', e);
      }
    }
  } catch (e) {
    console.warn('[Codec] preferH264OnVideoTransceivers error (non-fatal):', e);
  }
}

/**
 * STUN-only baseline. Always safe to include: no auth, no quota. STUN is not
 * enough for CGNAT/mobile viewers — it only helps with public-IP discovery —
 * but it lets direct-P2P viewers connect instantly without any TURN round trip.
 */
const STUN_SERVERS: RTCIceServer[] = [
  // Port 3478 is the canonical STUN/TURN port and tends to be permissively
  // allowed by carrier firewalls; 19302 is Google's own legacy port.
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.l.google.com:3478' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function splitEnvUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function expandTurnUrls(urls: string[]): string[] {
  // If the operator provides a single hostname like `turn:relay.example.com`,
  // expand it to the five canonical ports/transports. Otherwise use as-is.
  const out: string[] = [];
  for (const u of urls) {
    if (!/^turn(s)?:/i.test(u)) continue;
    if (/:[0-9]+|\?transport=/.test(u)) {
      out.push(u);
    } else {
      const stripped = u.replace(/\/$/, '');
      out.push(`${stripped}:80`);
      out.push(`${stripped}:443`);
      out.push(`${stripped}:80?transport=tcp`);
      out.push(`${stripped}:443?transport=tcp`);
      out.push(stripped.replace(/^turn:/i, 'turns:') + ':443?transport=tcp');
    }
  }
  return out;
}

function buildTurnGroup(
  rawUrls: string | undefined,
  user: string | undefined,
  cred: string | undefined,
): RTCIceServer[] {
  const urls = expandTurnUrls(splitEnvUrls(rawUrls));
  if (urls.length === 0 || !user || !cred) return [];
  return urls.map((u) => ({ urls: u, username: user, credential: cred }));
}

/**
 * Build the ICE server list from Vite env vars. Empty / missing entries are
 * filtered out so a TURN server without credentials is never silently sent to
 * the browser (the cause of the `code=400 TURN allocate error` we saw in the
 * wild — Metered returns 400 when credentials are shared/exhausted, and the
 * browser treats an empty credential the same way).
 *
 * Expected env (set in Netlify UI, not committed):
 *   VITE_TURN_URLS, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL
 *   VITE_TURN_BACKUP_URLS, VITE_TURN_BACKUP_USERNAME, VITE_TURN_BACKUP_CREDENTIAL
 */
function buildEnvIceServers(): RTCIceServer[] {
  const env: any = typeof import.meta !== 'undefined' ? (import.meta as any).env || {} : {};
  const primary = buildTurnGroup(env.VITE_TURN_URLS, env.VITE_TURN_USERNAME, env.VITE_TURN_CREDENTIAL);
  const backup = buildTurnGroup(env.VITE_TURN_BACKUP_URLS, env.VITE_TURN_BACKUP_USERNAME, env.VITE_TURN_BACKUP_CREDENTIAL);

  // Build-time diagnostics: surface whether each VITE_TURN_* var reached the
  // bundle without ever printing the values. "missing" here = the variable was
  // not defined in Netlify's build environment when `vite build` ran, so the
  // constant got replaced with `undefined` in the shipped JS.
  if (typeof window !== 'undefined') {
    const present = (v: unknown) => (typeof v === 'string' && v.length > 0 ? 'present' : 'missing');
    console.log(
      '[ICE][env] VITE_TURN_URLS=' + present(env.VITE_TURN_URLS) +
      ', VITE_TURN_USERNAME=' + present(env.VITE_TURN_USERNAME) +
      ', VITE_TURN_CREDENTIAL=' + present(env.VITE_TURN_CREDENTIAL) +
      ', VITE_TURN_BACKUP_URLS=' + present(env.VITE_TURN_BACKUP_URLS) +
      ', VITE_TURN_BACKUP_USERNAME=' + present(env.VITE_TURN_BACKUP_USERNAME) +
      ', VITE_TURN_BACKUP_CREDENTIAL=' + present(env.VITE_TURN_BACKUP_CREDENTIAL) +
      ` → primaryEntries=${primary.length}, backupEntries=${backup.length}`,
    );
    if (primary.length === 0 && backup.length === 0) {
      console.warn(
        '[ICE][env] No VITE_TURN_* values were bundled. Either the env vars are unset in Netlify, ' +
        'or they were added AFTER the last deploy — Vite inlines them at build time, so a redeploy is required.',
      );
    }
  }

  return [...STUN_SERVERS, ...primary, ...backup];
}

const DEFAULT_ICE_SERVERS: RTCConfiguration = {
  iceServers: buildEnvIceServers(),
  // Pre-gather ICE candidates so the first offer/answer already carries a
  // usable path — critical on mobile where HTTP-poll signaling latency
  // compounds with on-demand ICE gathering and stretches time-to-first-frame.
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  iceTransportPolicy: 'all',
};

// Mutable active config; swapped in after the /api/ice-servers refresh lands.
let ACTIVE_ICE_SERVERS: RTCConfiguration = DEFAULT_ICE_SERVERS;

function getActiveIceConfig(): RTCConfiguration {
  return ACTIVE_ICE_SERVERS;
}

function collectTurnUrls(config: RTCConfiguration): string[] {
  const servers = Array.isArray(config.iceServers) ? config.iceServers : [];
  const urls: string[] = [];
  for (const s of servers) {
    const list = Array.isArray(s.urls) ? s.urls : [s.urls];
    for (const u of list) {
      if (typeof u === 'string' && /^turns?:/i.test(u)) urls.push(u);
    }
  }
  return urls;
}

function dedupeByUrl(servers: RTCIceServer[]): RTCIceServer[] {
  const seen = new Set<string>();
  const out: RTCIceServer[] = [];
  for (const s of servers) {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    for (const url of urls) {
      if (seen.has(String(url))) continue;
      seen.add(String(url));
      out.push({ ...s, urls: url });
    }
  }
  return out;
}

/**
 * Fetch fresh ICE servers from the Netlify Function. Credentials live only in
 * Netlify env vars (not in the JS bundle) so they can be rotated without a
 * redeploy; when METERED_API_KEY is set they are ephemeral per-session
 * credentials which avoids the free-tier "Allocate Error 400" shared-quota
 * failure mode.
 *
 * Idempotent and lazy: called once at module load; silently no-ops if the
 * endpoint is missing or returns empty.
 */
let iceRefreshPromise: Promise<void> | null = null;
export function refreshIceServers(): Promise<void> {
  if (iceRefreshPromise) return iceRefreshPromise;
  iceRefreshPromise = (async () => {
    try {
      const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const res = await fetch('/api/ice-servers', { cache: 'no-store' });
      const elapsed = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0));
      console.log(`[ICE][endpoint] /api/ice-servers responded status=${res.status} in ${elapsed}ms`);
      if (!res.ok) {
        console.warn(`[ICE][endpoint] non-OK status (${res.status}) — keeping bundled defaults`);
        return;
      }
      const data = await res.json();
      const incoming: RTCIceServer[] = Array.isArray(data?.iceServers) ? data.iceServers : [];
      const diagnostics = (data && typeof data === 'object' ? data.diagnostics : null) as
        | { meteredStatus?: string; meteredApiKey?: string; turnUrls?: string; turnUsername?: string; turnCredential?: string }
        | null;
      // Count what the server actually returned so we can tell "endpoint never
      // ran" from "endpoint ran but TURN env vars are unset on the server".
      let endpointStun = 0;
      let endpointTurn = 0;
      let endpointTurnWithAuth = 0;
      for (const entry of incoming) {
        const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
        let sawTurn = false;
        for (const u of urls) {
          const url = String(u || '').toLowerCase();
          if (url.startsWith('stun:')) endpointStun++;
          if (url.startsWith('turn:') || url.startsWith('turns:')) {
            endpointTurn++;
            sawTurn = true;
          }
        }
        if (sawTurn && entry.username && entry.credential) endpointTurnWithAuth++;
      }
      console.log(
        `[ICE][endpoint] payload stun=${endpointStun}, turn=${endpointTurn}, turnEntriesWithAuth=${endpointTurnWithAuth}`,
      );
      if (endpointTurn === 0) {
        const diag = diagnostics
          ? ` [server diagnostics: meteredApiKey=${diagnostics.meteredApiKey ?? '?'}, meteredStatus=${diagnostics.meteredStatus ?? '?'}, TURN_URLS=${diagnostics.turnUrls ?? '?'}, TURN_USERNAME=${diagnostics.turnUsername ?? '?'}, TURN_CREDENTIAL=${diagnostics.turnCredential ?? '?'}]`
          : '';
        console.warn(
          '[ICE][endpoint] /api/ice-servers returned 0 TURN servers — ' +
          'set TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL (and/or METERED_API_KEY) in Netlify → Site configuration → Environment variables.' +
          diag,
        );
        if (diagnostics?.meteredStatus && /metered_http_401/.test(diagnostics.meteredStatus)) {
          console.warn(
            '[ICE][endpoint] Metered.ca rejected the API key (HTTP 401 Invalid API Key). ' +
            'Verify METERED_API_KEY and METERED_APP_NAME in Netlify → Site configuration → Environment variables ' +
            'match the values shown in the Metered.ca dashboard, then redeploy.',
          );
        }
      }
      if (incoming.length === 0) return;
      // Filter TURN entries that don't have both username + credential so the
      // browser never tries (and fails) to allocate with empty auth.
      const validated = incoming.filter((s) => {
        const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
        const isTurn = urls.some((u) => /^turns?:/i.test(String(u)));
        if (!isTurn) return true;
        return Boolean(s.username) && Boolean(s.credential);
      });
      const merged = dedupeByUrl([
        ...STUN_SERVERS,
        ...validated,
        ...((DEFAULT_ICE_SERVERS.iceServers || []) as RTCIceServer[]).filter(
          (s) => !STUN_SERVERS.includes(s),
        ),
      ]);
      ACTIVE_ICE_SERVERS = {
        ...DEFAULT_ICE_SERVERS,
        iceServers: merged,
      };
      iceServerHealthLogged = false; // re-log summary after refresh
      logIceServerHealthOnce();
    } catch (err) {
      console.warn('[ICE] refreshIceServers failed (using bundled defaults):', err);
    }
  })();
  return iceRefreshPromise;
}

// Kick off the refresh eagerly so the first offer/answer already uses ephemeral
// credentials when the function is configured.
if (typeof window !== 'undefined') {
  void refreshIceServers();
}

let iceServerHealthLogged = false;
function logIceServerHealthOnce() {
  if (iceServerHealthLogged) return;
  iceServerHealthLogged = true;
  const active = getActiveIceConfig();
  const servers = Array.isArray(active.iceServers) ? active.iceServers : [];
  let stunCount = 0;
  let turnCount = 0;
  let turnWithAuthCount = 0;
  for (const entry of servers) {
    const urls = Array.isArray((entry as RTCIceServer).urls) ? (entry as RTCIceServer).urls : [(entry as RTCIceServer).urls];
    for (const rawUrl of urls) {
      const url = String(rawUrl || '').toLowerCase();
      if (url.startsWith('stun:')) stunCount++;
      if (url.startsWith('turn:') || url.startsWith('turns:')) turnCount++;
    }
    const hasUser = Boolean((entry as RTCIceServer).username);
    const hasCredential = Boolean((entry as RTCIceServer).credential);
    if (hasUser && hasCredential) turnWithAuthCount++;
  }
  console.log(`[ICE] Config summary: stun=${stunCount}, turn=${turnCount}, turnEntriesWithAuth=${turnWithAuthCount}`);
  if (turnCount === 0) {
    console.warn('[ICE] No TURN server configured. Restrictive networks may stay at pc=connecting. Set VITE_TURN_URLS/USERNAME/CREDENTIAL or TURN_URLS/USERNAME/CREDENTIAL (server) env vars.');
  } else if (turnWithAuthCount === 0) {
    console.warn('[ICE] TURN servers are present but credentials are missing. Check TURN username/password configuration.');
  } else {
    console.log(
      `[ICE] ✅ TURN ready: turn=${turnCount} (>0), turnEntriesWithAuth=${turnWithAuthCount}. ` +
      'Restrictive-NAT viewers will fall back to relay candidates.',
    );
  }
}

type SignalMessage = {
  id: string; // Unique ID to prevent processing duplicates
  type: 'viewer-join' | 'offer' | 'answer' | 'ice-candidates' | 'chat';
  senderId: string;
  targetId?: string;
  payload?: any;
};

type IceCandidateKind = 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown';
type IceCounter = Record<IceCandidateKind, number>;

function createIceCounter(): IceCounter {
  return { host: 0, srflx: 0, relay: 0, prflx: 0, unknown: 0 };
}

function parseCandidateLine(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): string {
  if (!candidate) return '';
  if ('candidate' in candidate && typeof candidate.candidate === 'string') return candidate.candidate;
  return '';
}

function getIceCandidateType(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): IceCandidateKind {
  if (!candidate) return 'unknown';
  const directType = (candidate as RTCIceCandidate).type;
  if (directType === 'host' || directType === 'srflx' || directType === 'relay' || directType === 'prflx') {
    return directType;
  }
  const line = parseCandidateLine(candidate);
  const match = /\btyp\s(host|srflx|relay|prflx)\b/i.exec(line);
  if (!match) return 'unknown';
  return match[1].toLowerCase() as IceCandidateKind;
}

function getIceCandidateProtocol(candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): 'udp' | 'tcp' | 'unknown' {
  const line = parseCandidateLine(candidate);
  if (!line) return 'unknown';
  if (/\budp\b/i.test(line)) return 'udp';
  if (/\btcp\b/i.test(line)) return 'tcp';
  return 'unknown';
}

function bumpIceCounter(counter: IceCounter, candidate: RTCIceCandidate | RTCIceCandidateInit | null | undefined): IceCandidateKind {
  const kind = getIceCandidateType(candidate);
  counter[kind] += 1;
  return kind;
}

function formatIceCounter(counter: IceCounter): string {
  return `host=${counter.host}, srflx=${counter.srflx}, relay=${counter.relay}, prflx=${counter.prflx}, unknown=${counter.unknown}`;
}

async function logSelectedCandidatePair(pc: RTCPeerConnection, label: string): Promise<void> {
  try {
    const stats = await pc.getStats();
    let selectedPair: any = null;

    stats.forEach((report: any) => {
      if (selectedPair) return;
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        selectedPair = stats.get(report.selectedCandidatePairId);
      }
    });

    if (!selectedPair) {
      stats.forEach((report: any) => {
        if (selectedPair) return;
        if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
          selectedPair = report;
        }
      });
    }

    if (!selectedPair) {
      console.log(`[ICE][${label}] Selected candidate pair not available yet`);
      return;
    }

    const local = selectedPair.localCandidateId ? stats.get(selectedPair.localCandidateId) as any : null;
    const remote = selectedPair.remoteCandidateId ? stats.get(selectedPair.remoteCandidateId) as any : null;
    const localType = local?.candidateType || 'unknown';
    const remoteType = remote?.candidateType || 'unknown';
    const protocol = local?.protocol || remote?.protocol || 'unknown';
    console.log(
      `[ICE][${label}] selected pair local=${localType}/${protocol} remote=${remoteType}/${remote?.protocol || 'unknown'} ` +
      `rtt=${selectedPair.currentRoundTripTime ?? 'n/a'} bytesSent=${selectedPair.bytesSent ?? 'n/a'} bytesReceived=${selectedPair.bytesReceived ?? 'n/a'}`
    );
  } catch (e) {
    console.warn(`[ICE][${label}] Failed to read selected candidate pair stats:`, e);
  }
}

export type ChatMessage = {
  id: string;
  user: string;
  text: string;
  profileImage?: string;
  timestamp: number;
};

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Increase video bitrate hints in SDP by modifying b=AS and adding b=TIAS lines.
 */
function boostSdpBitrate(sdp: string, maxBitrateKbps: number): string {
  const lines = sdp.split('\r\n');
  const result: string[] = [];
  let inVideoSection = false;
  let hasAddedBitrate = false;

  for (const line of lines) {
    if (line.startsWith('m=video')) {
      inVideoSection = true;
      hasAddedBitrate = false;
      result.push(line);
    } else if (line.startsWith('m=')) {
      inVideoSection = false;
      result.push(line);
    } else if (inVideoSection && line.startsWith('b=AS:')) {
      // Replace existing bandwidth line
      result.push(`b=AS:${maxBitrateKbps}`);
      hasAddedBitrate = true;
    } else if (inVideoSection && line.startsWith('c=') && !hasAddedBitrate) {
      // Add bandwidth line after connection line if not already present
      result.push(line);
      result.push(`b=AS:${maxBitrateKbps}`);
      hasAddedBitrate = true;
    } else {
      result.push(line);
    }
  }

  return result.join('\r\n');
}

/**
 * Wait for ICE gathering to complete (or timeout) before sending signaling messages.
 * Resolves early if a relay (TURN) candidate is collected, since relay candidates
 * ensure connectivity on restrictive networks and waiting further only adds latency.
 *
 * Mobile networks (esp. cellular) have higher RTT to STUN/TURN servers, so the
 * timeout on mobile is extended — cutting gathering too early on mobile leaves
 * the peer with no usable candidate and the viewer gets a stuck black screen.
 */
function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs?: number): Promise<void> {
  const effectiveTimeout = timeoutMs ?? (isMobileSender() ? 5000 : 3000);
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    let resolved = false;
    const done = (reason: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      pc.removeEventListener('icecandidate', onCandidate);
      console.log(`[ICE] ${reason}`);
      resolve();
    };

    const timeout = setTimeout(() => {
      done('Gathering timed out, proceeding with collected candidates');
    }, effectiveTimeout);

    function onStateChange() {
      if (pc.iceGatheringState === 'complete') {
        done('Gathering complete');
      }
    }

    function onCandidate(event: RTCPeerConnectionIceEvent) {
      if (event.candidate && event.candidate.type === 'relay') {
        // A TURN relay candidate was found — we have a guaranteed connectivity path.
        // Resolve immediately instead of waiting for the full timeout.
        done('Relay (TURN) candidate found, sending SDP early');
      }
    }

    pc.addEventListener('icegatheringstatechange', onStateChange);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

async function postSignal(username: string, msg: SignalMessage) {
  try {
    const res = await fetch(`/api/signal/${encodeURIComponent(username.toLowerCase())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!res.ok) {
      console.error(`[Signal] POST failed with status ${res.status} for type=${msg.type}`);
    }
  } catch (err) {
    console.error('[Signal] Failed to post signal:', err);
  }
}

async function pollSignals(
  username: string,
  participantId: string,
  since: number
): Promise<{ signals: (SignalMessage & { timestamp: number })[]; latestTimestamp: number }> {
  try {
    const res = await fetch(
      `/api/signal/${encodeURIComponent(username.toLowerCase())}?participantId=${participantId}&since=${since}`
    );
    if (!res.ok) return { signals: [], latestTimestamp: since };
    const data = await res.json();
    const signals = data.signals || [];
    let latest = since;
    for (const s of signals) {
      if (s.timestamp > latest) latest = s.timestamp;
    }
    return { signals, latestTimestamp: latest };
  } catch (err) {
    console.error('[Signal] Failed to poll signals:', err);
    return { signals: [], latestTimestamp: since };
  }
}

/**
 * Broadcaster: manages peer connections to multiple viewers via HTTP-based signaling.
 */
export class BroadcasterSignaling {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private iceCandidateBuffers: Map<string, RTCIceCandidateInit[]> = new Map();
  private iceDiagnostics: Map<string, { local: IceCounter; remote: IceCounter }> = new Map();
  private connectionCreateTimes: Map<string, number> = new Map();
  private pendingOfferIds: Map<string, string> = new Map(); // viewerId -> offerId for matching answers
  private viewerJoinDebounce: Map<string, number> = new Map(); // viewerId -> last join timestamp
  private localStream: MediaStream | null = null;
  private channelName: string;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTimestamp = 0;
  private running = false;
  private processedIds = new Set<string>();
  private onChatCallback: ((msg: ChatMessage) => void) | null = null;
  readonly broadcasterId = generateId();

  constructor(username: string) {
    this.channelName = username.toLowerCase();
    logIceServerHealthOnce();
  }

  onChat(callback: (msg: ChatMessage) => void) {
    this.onChatCallback = callback;
  }

  sendChat(msg: ChatMessage) {
    postSignal(this.channelName, {
      id: generateId(),
      type: 'chat',
      senderId: this.broadcasterId,
      payload: msg,
    });
  }

  start(stream: MediaStream) {
    this.localStream = stream;
    this.running = true;
    this.lastTimestamp = Date.now() - 5000;

    // Clear old signals from previous broadcast to avoid stale viewer-joins
    fetch(`/api/signal/${encodeURIComponent(this.channelName)}`, { method: 'DELETE' }).catch(() => {});

    // Start adaptive polling - fast initially, slower once stable
    this.schedulePoll();
  }

  private schedulePoll() {
    if (!this.running) return;
    // Use faster polling (250ms) when there are pending connections, slower (900ms) when stable
    const hasUnconnected = Array.from(this.peerConnections.values()).some(
      pc => pc.connectionState !== 'connected'
    );
    const interval = hasUnconnected || this.peerConnections.size === 0 ? 250 : 900;
    this.pollTimer = setTimeout(() => {
      this.poll().then(() => this.schedulePoll());
    }, interval);
  }

  private async poll() {
    if (!this.running) return;
    
    // We pass (lastTimestamp - 2000) to create an overlap window, ensuring no messages 
    // are lost if they get the exact same millisecond timestamp on the server but are saved late.
    const pollSince = Math.max(0, this.lastTimestamp - 2000);
    const { signals, latestTimestamp } = await pollSignals(
      this.channelName,
      this.broadcasterId,
      pollSince
    );
    
    if (latestTimestamp > this.lastTimestamp) {
      this.lastTimestamp = latestTimestamp;
    }

    for (const msg of signals) {
      // Skip own messages or already processed messages
      if (msg.senderId === this.broadcasterId || this.processedIds.has(msg.id)) continue;
      this.processedIds.add(msg.id);

      // Keep the processedIds set from growing indefinitely
      if (this.processedIds.size > 500) {
        const iterator = this.processedIds.values();
        for (let i = 0; i < 100; i++) this.processedIds.delete(iterator.next().value!);
      }

      await this.handleSignal(msg);
    }
  }

  private async handleSignal(msg: SignalMessage) {
    switch (msg.type) {
      case 'viewer-join':
        await this.handleViewerJoin(msg.senderId, msg.payload as { recover?: boolean } | undefined);
        break;
      case 'answer':
        if (msg.targetId === this.broadcasterId) {
          await this.handleAnswer(msg.senderId, msg.payload);
        }
        break;
      case 'ice-candidates':
        if (msg.targetId === this.broadcasterId) {
          await this.handleIceCandidates(msg.senderId, msg.payload);
        }
        break;
      case 'chat':
        if (this.onChatCallback && msg.payload) {
          this.onChatCallback(msg.payload as ChatMessage);
        }
        break;
    }
  }

  private async handleViewerJoin(viewerId: string, payload?: { recover?: boolean }) {
    console.log('[Broadcaster] Viewer joined:', viewerId, payload?.recover ? '(recovery)' : '');

    const now = Date.now();
    const existing = this.peerConnections.get(viewerId);

    if (existing) {
      const state = existing.connectionState;
      // Already connected: silently ignore the join
      if (state === 'connected') {
        console.log(`[Broadcaster] Ignoring viewer-join from ${viewerId} — already connected`);
        return;
      }

      // Still setting up: give a short grace period to finish the first handshake.
      // Mobile viewers on carrier-grade NAT typically fail direct P2P within a few
      // seconds and escalate to iceTransportPolicy='relay' at ~7s. A 15s blanket
      // grace period silently dropped those recovery joins and left mobile viewers
      // waiting for the 20s rejoin timer before the broadcaster would rebuild the
      // peer connection. 5s (or immediately on explicit recovery) preserves the
      // anti-thrash intent while letting mobile relay-retry actually reach us.
      const createTime = this.connectionCreateTimes.get(viewerId) || 0;
      const age = now - createTime;
      if ((state === 'connecting' || state === 'new') && age < 5000 && !payload?.recover) {
        console.log(`[Broadcaster] Ignoring viewer-join from ${viewerId} — "${state}" for ${age}ms (< 5s grace)`);
        return;
      }

      console.log(`[Broadcaster] Rebuilding connection for ${viewerId} — existing PC in "${state}" for ${age}ms${payload?.recover ? ' (viewer-driven recovery)' : ''}`);
      existing.close();
      this.peerConnections.delete(viewerId);
      this.iceCandidateBuffers.delete(viewerId);
      this.connectionCreateTimes.delete(viewerId);
      this.pendingOfferIds.delete(viewerId);
    } else {
      // No existing PC: coalesce duplicate viewer-join messages that can arrive
      // from the signaling poll overlap window (we poll since = lastTimestamp - 2s).
      const lastJoin = this.viewerJoinDebounce.get(viewerId) || 0;
      if (now - lastJoin < 2000) {
        console.log(`[Broadcaster] Coalescing duplicate viewer-join from ${viewerId} (${now - lastJoin}ms since last)`);
        return;
      }
    }
    this.viewerJoinDebounce.set(viewerId, now);

    // Guard: do not create a peer connection if there is no stream to send
    if (!this.localStream) {
      console.warn('[Broadcaster] No local stream available when viewer joined — skipping offer');
      return;
    }

    this.connectionCreateTimes.set(viewerId, Date.now());
    // Mobile broadcasters sit behind CGNAT on most carriers, so their own host
    // and srflx candidates are unreachable from viewers. Forcing relay-only on
    // the broadcaster side guarantees every viewer — PC included — gets a TURN
    // path that actually works, instead of hanging on direct P2P until the ICE
    // timeout.
    const pc = new RTCPeerConnection(buildIceConfig(isMobileSender()));
    if (isMobileSender()) {
      console.log('[Broadcaster] Mobile sender detected — using iceTransportPolicy="relay" so viewers reach us through TURN');
    }
    this.peerConnections.set(viewerId, pc);
    this.iceCandidateBuffers.set(viewerId, []); // initialize ICE buffer
    this.iceDiagnostics.set(viewerId, { local: createIceCounter(), remote: createIceCounter() });

    // Add all local tracks to the connection — with liveness verification
    if (this.localStream) {
      const allTracks = this.localStream.getTracks();
      console.log(`[Broadcaster] Adding ${allTracks.length} tracks to peer connection for viewer ${viewerId}`);
      allTracks.forEach((track, i) => {
        const isLive = track.readyState === 'live';
        console.log(`[Broadcaster] Track ${i}: kind=${track.kind}, readyState=${track.readyState}, enabled=${track.enabled}, muted=${track.muted}, live=${isLive}`);
        if (!isLive) {
          console.warn(`[Broadcaster] WARNING: Track ${i} (${track.kind}) is NOT live — viewer may not receive this track`);
        }
        if (!track.enabled) {
          console.warn(`[Broadcaster] Track ${i} (${track.kind}) was disabled, forcing enabled`);
          track.enabled = true;
        }
        pc.addTrack(track, this.localStream!);
      });

      // Reorder transceiver codec list so H.264 is negotiated first when available.
      // Critical for iOS Safari viewers (hardware H.264 decoder) and helps Android
      // Chrome pick its hardware path too. Safe no-op on browsers that don't
      // implement setCodecPreferences.
      preferH264OnVideoTransceivers(pc);

      // Verify all tracks were added as senders
      const senders = pc.getSenders();
      console.log(`[Broadcaster] Peer connection has ${senders.length} senders after addTrack (expected ${allTracks.length})`);
      senders.forEach((sender, i) => {
        console.log(`[Broadcaster] Sender ${i}: kind=${sender.track?.kind}, readyState=${sender.track?.readyState}, enabled=${sender.track?.enabled}`);
      });
      // Set max bitrate and quality parameters for highest quality streaming
      pc.getSenders().forEach((sender) => {
        if (sender.track?.kind === 'video') {
          // Set content hint to optimize for motion smoothness — live-commerce
          // sellers move their hands / flip products constantly, and "detail"
          // mode deprioritizes motion blur handling which shows up on viewers
          // as visible stutter. "motion" also helps the encoder allocate
          // bitrate toward temporal (inter-frame) coding, which is what
          // matters for the perceived broadcaster↔viewer delay.
          if ('contentHint' in sender.track) {
            sender.track.contentHint = 'motion';
          }
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings.forEach((enc) => {
            enc.maxBitrate = MAX_VIDEO_BITRATE_BPS; // 4.5 Mbps cap — mobile-web optimized
            enc.maxFramerate = 30;
            enc.scaleResolutionDownBy = 1.0;
            // When bandwidth is tight, let the encoder drop resolution before
            // framerate. For live commerce the viewer notices choppy motion
            // immediately while a small resolution dip goes unnoticed — this
            // directly addresses viewer-reported "버벅거림".
            (enc as any).degradationPreference = 'maintain-framerate';
          });
          (params as any).degradationPreference = 'maintain-framerate';
          sender.setParameters(params).catch(() => {});
        } else if (sender.track?.kind === 'audio') {
          const params = sender.getParameters();
          if (!params.encodings) params.encodings = [{}];
          params.encodings.forEach((enc) => {
            enc.maxBitrate = 128_000; // 128 kbps for crisp audio
          });
          sender.setParameters(params).catch(() => {});
        }
      });
    }

    // Batch ICE candidates to reduce HTTP requests
    let iceBatch: RTCIceCandidateInit[] = [];
    let iceFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushIce = () => {
      if (iceBatch.length === 0) return;
      const batch = [...iceBatch];
      iceBatch = [];
      
      // Send batched candidates as a single array
      postSignal(this.channelName, {
        id: generateId(),
        type: 'ice-candidates',
        senderId: this.broadcasterId,
        targetId: viewerId,
        payload: batch,
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const diag = this.iceDiagnostics.get(viewerId);
        const kind = diag ? bumpIceCounter(diag.local, event.candidate) : getIceCandidateType(event.candidate);
        const proto = getIceCandidateProtocol(event.candidate);
        console.log(`[Broadcaster][ICE][local->${viewerId}] type=${kind} protocol=${proto}`);
        iceBatch.push(event.candidate.toJSON());
        if (iceFlushTimer) clearTimeout(iceFlushTimer);
        iceFlushTimer = setTimeout(flushIce, 80); // 80ms window for faster connection
      } else {
        // ICE gathering complete
        const diag = this.iceDiagnostics.get(viewerId);
        if (diag) {
          console.log(`[Broadcaster][ICE][local->${viewerId}] gathering complete (${formatIceCounter(diag.local)})`);
        }
        flushIce();
      }
    };

    pc.onicecandidateerror = (event: any) => {
      console.warn(
        `[Broadcaster][ICE][${viewerId}] candidate error url=${event.url || 'n/a'} code=${event.errorCode} text=${event.errorText || 'n/a'}`
      );
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Broadcaster][ICE][${viewerId}] state=${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        void logSelectedCandidatePair(pc, `Broadcaster:${viewerId}`);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[Broadcaster] Connection to ${viewerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        const diag = this.iceDiagnostics.get(viewerId);
        if (diag) {
          console.log(
            `[Broadcaster][ICE][${viewerId}] connected local(${formatIceCounter(diag.local)}) remote(${formatIceCounter(diag.remote)})`
          );
        }
      }
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        this.removeViewer(viewerId);
      }
    };

    // Verify all tracks are attached before creating offer
    const preOfferSenders = pc.getSenders().filter(s => s.track);
    console.log(`[Broadcaster] Pre-offer verification: ${preOfferSenders.length} active senders — ` +
      preOfferSenders.map(s => `${s.track!.kind}:${s.track!.readyState}`).join(', '));

    // Create and send offer with enhanced SDP
    const offer = await pc.createOffer();
    // Enhance SDP for maximum quality
    // NOTE: Do NOT apply preferH264HighProfile to the offer.
    // Overriding the profile-level-id can cause codec negotiation mismatch
    // where the decoder never produces frames (readyState stays 0) — especially
    // on mobile devices where hardware encoders may not support High profile.
    if (offer.sdp) {
      offer.sdp = boostSdpBitrate(offer.sdp, MAX_VIDEO_BITRATE_KBPS); // Mobile: 4500 kbps; desktop: 6000 kbps
    }
    await pc.setLocalDescription(offer);

    // Wait for ICE candidates to be gathered before sending the offer
    await waitForIceGatheringComplete(pc);

    // Use pc.localDescription which includes gathered ICE candidates (not the original offer)
    const finalOffer = pc.localDescription!;
    const offerId = generateId();
    this.pendingOfferIds.set(viewerId, offerId);
    await postSignal(this.channelName, {
      id: generateId(),
      type: 'offer',
      senderId: this.broadcasterId,
      targetId: viewerId,
      payload: { sdp: finalOffer.sdp, type: finalOffer.type, offerId },
    });
  }

  private async handleAnswer(viewerId: string, answer: RTCSessionDescriptionInit & { offerId?: string }) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) return;

    // Verify this answer matches our latest offer to avoid stale answer race conditions
    const expectedOfferId = this.pendingOfferIds.get(viewerId);
    if (answer.offerId && expectedOfferId && answer.offerId !== expectedOfferId) {
      console.log(`[Broadcaster] Ignoring stale answer from ${viewerId} — offerId mismatch (got ${answer.offerId}, expected ${expectedOfferId})`);
      return;
    }

    // Guard: only set answer when we're expecting one (have-local-offer state)
    if (pc.signalingState !== 'have-local-offer') {
      console.log(`[Broadcaster] Ignoring answer from ${viewerId} — signalingState is "${pc.signalingState}" (expected "have-local-offer")`);
      return;
    }
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      this.pendingOfferIds.delete(viewerId); // Answer accepted, clear pending offer
      
      // Flush buffered ICE candidates now that remote description is set
      const buffer = this.iceCandidateBuffers.get(viewerId);
      if (buffer && buffer.length > 0) {
        for (const candidate of buffer) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('[Broadcaster] Error adding buffered ICE candidate:', e);
          }
        }
        this.iceCandidateBuffers.set(viewerId, []); // Clear buffer
      }
    } catch (err) {
      console.error('[Broadcaster] Error setting answer:', err);
    }
  }

  private async handleIceCandidates(viewerId: string, candidates: RTCIceCandidateInit[]) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) return;
    const diag = this.iceDiagnostics.get(viewerId);
    
    // If remote description isn't set yet (answer not processed), buffer candidates to avoid InvalidStateError
    if (!pc.remoteDescription) {
      const buffer = this.iceCandidateBuffers.get(viewerId);
      if (buffer) {
        buffer.push(...candidates);
      }
      if (diag) {
        for (const candidate of candidates) {
          bumpIceCounter(diag.remote, candidate);
        }
      }
      return;
    }

    for (const candidate of candidates) {
      const kind = diag ? bumpIceCounter(diag.remote, candidate) : getIceCandidateType(candidate);
      const proto = getIceCandidateProtocol(candidate);
      console.log(`[Broadcaster][ICE][remote<-${viewerId}] type=${kind} protocol=${proto}`);
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[Broadcaster] Error adding ICE candidate:', err);
      }
    }
  }

  private removeViewer(viewerId: string) {
    const pc = this.peerConnections.get(viewerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(viewerId);
      this.iceCandidateBuffers.delete(viewerId);
      this.iceDiagnostics.delete(viewerId);
      this.connectionCreateTimes.delete(viewerId);
      this.pendingOfferIds.delete(viewerId);
      this.viewerJoinDebounce.delete(viewerId);
    }
  }

  /** Update the stream (e.g. when camera is toggled) */
  updateStream(stream: MediaStream) {
    this.localStream = stream;
    for (const [, pc] of this.peerConnections) {
      const senders = pc.getSenders();
      stream.getTracks().forEach((track) => {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, stream);
        }
      });
    }
  }

  getViewerCount() {
    return this.peerConnections.size;
  }

  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    for (const [, pc] of this.peerConnections) {
      pc.close();
    }
    this.peerConnections.clear();
    this.iceCandidateBuffers.clear();
    this.iceDiagnostics.clear();
    this.connectionCreateTimes.clear();
    this.pendingOfferIds.clear();
    this.viewerJoinDebounce.clear();
    this.processedIds.clear();
    this.localStream = null;

    // Clean up signals on the server
    fetch(`/api/signal/${encodeURIComponent(this.channelName)}`, { method: 'DELETE' }).catch(() => {});
  }
}

/**
 * Viewer: connects to a broadcaster and receives the stream via HTTP-based signaling.
 */
export class ViewerSignaling {
  private pc: RTCPeerConnection | null = null;
  private channelName: string;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private rejoinTimer: ReturnType<typeof setInterval> | null = null;
  private connectingWatchdog: ReturnType<typeof setTimeout> | null = null;
  private lastTimestamp = 0;
  private running = false;
  private processedIds = new Set<string>();
  private iceCandidateBuffer: RTCIceCandidateInit[] = [];
  private handlingOffer = false;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private isConnecting = false; // Lock to prevent rapid re-joins during connection
  private connectingLockTime = 0; // Timestamp when isConnecting was set
  private readonly CONNECTING_LOCK_DURATION = 15000; // 15s minimum before re-sending join
  // Upper bound for how long pc.connectionState is allowed to stay in
  // `new`/`connecting` before we tear it down. Mobile CGNAT frequently hangs
  // the peer connection here without ever transitioning to `failed`, so a
  // fixed watchdog is the only reliable way to break out of the loop.
  private readonly CONNECTING_STALL_MS = 12000;
  // Relay-only retry: when a mobile viewer's first P2P attempt fails (common on
  // carrier-grade NAT), escalate next reconnect to iceTransportPolicy='relay'
  // so all traffic is forced through a TURN server. This directly addresses the
  // NAT-traversal failure mode discussed in the WebRTC ICE/STUN/TURN theory.
  //
  // Mobile viewers start in relay-only mode because carrier-grade NAT / mobile
  // Wi-Fi behind CGNAT and in-app WebViews (KakaoTalk, Instagram, etc.) block
  // direct P2P almost universally. Waiting for the first P2P attempt to fail
  // adds 5–20s of black screen before the TURN fallback kicks in, which reads
  // as "broken" to the user. Jumping straight to relay is the pragmatic default.
  private forceRelay = isMobileViewer();
  private failedAttemptsSinceRelay = 0;
  private localIceCounter: IceCounter = createIceCounter();
  private remoteIceCounter: IceCounter = createIceCounter();
  private lastOfferAt: number | null = null;
  readonly viewerId = generateId();
  private onStreamCallback: ((stream: MediaStream) => void) | null = null;
  private onConnectionStateCallback: ((state: RTCPeerConnectionState) => void) | null = null;
  private onChatCallback: ((msg: ChatMessage) => void) | null = null;
  private hasReceivedOffer = false;
  // Buffer stream/state that arrives before callbacks are registered (pre-connection mode)
  private bufferedStream: MediaStream | null = null;
  private bufferedConnectionState: RTCPeerConnectionState | null = null;
  private bufferedChatMessages: ChatMessage[] = [];

  constructor(username: string) {
    this.channelName = username.toLowerCase();
    logIceServerHealthOnce();
  }

  onStream(callback: (stream: MediaStream) => void) {
    this.onStreamCallback = callback;
    // Flush buffered stream from pre-connection
    if (this.bufferedStream) {
      callback(this.bufferedStream);
      this.bufferedStream = null;
    }
  }

  onConnectionState(callback: (state: RTCPeerConnectionState) => void) {
    this.onConnectionStateCallback = callback;
    // Flush buffered connection state from pre-connection
    if (this.bufferedConnectionState) {
      callback(this.bufferedConnectionState);
      this.bufferedConnectionState = null;
    }
  }

  onChat(callback: (msg: ChatMessage) => void) {
    this.onChatCallback = callback;
    // Flush buffered chat messages from pre-connection
    for (const msg of this.bufferedChatMessages) {
      callback(msg);
    }
    this.bufferedChatMessages = [];
  }

  sendChat(msg: ChatMessage) {
    postSignal(this.channelName, {
      id: generateId(),
      type: 'chat',
      senderId: this.viewerId,
      payload: msg,
    });
  }

  connect(recover = false) {
    this.running = true;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.lastTimestamp = Date.now() - 5000;
    this.processedIds.clear();
    this.iceCandidateBuffer = [];
    this.hasReceivedOffer = false;
    this.handlingOffer = false;
    this.isConnecting = false;
    this.connectingLockTime = 0;
    this.localIceCounter = createIceCounter();
    this.remoteIceCounter = createIceCounter();
    this.lastOfferAt = null;

    this.sendJoin(recover);

    // Start adaptive polling
    this.schedulePoll();

    // Periodically re-send viewer-join if not connected yet (every 20s to give enough
    // time for the full signaling roundtrip: broadcaster poll + ICE gathering +
    // offer delivery + viewer ICE gathering + answer delivery)
    this.rejoinTimer = setInterval(() => {
      if (!this.running) return;
      if (this.connected || this.hasReceivedOffer) {
        if (this.rejoinTimer) clearInterval(this.rejoinTimer);
        this.rejoinTimer = null;
        return;
      }
      // Respect the isConnecting lock — don't re-send join while connection is in progress
      if (this.isConnecting && (Date.now() - this.connectingLockTime < this.CONNECTING_LOCK_DURATION)) {
        console.log(`[Viewer] Skipping viewer-join — connection in progress (${Math.round((Date.now() - this.connectingLockTime) / 1000)}s elapsed)`);
        return;
      }
      this.reconnectAttempts++;
      if (this.reconnectAttempts > this.maxReconnectAttempts) {
        if (this.rejoinTimer) clearInterval(this.rejoinTimer);
        this.rejoinTimer = null;
        this.onConnectionStateCallback?.('failed');
        return;
      }
      console.log(`[Viewer] Re-sending viewer-join (attempt ${this.reconnectAttempts})`);
      this.isConnecting = false; // Clear stale lock before re-sending
      // Rejoins after the first attempt are always recovery attempts — the broadcaster
      // should rebuild the peer connection rather than debounce the join.
      this.sendJoin(true);
    }, 20000);
  }

  /** Force reconnect - resets attempt counter and restarts the connection process */
  reconnect() {
    // Clean up existing connection
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rejoinTimer) {
      clearInterval(this.rejoinTimer);
      this.rejoinTimer = null;
    }
    if (this.connectingWatchdog) {
      clearTimeout(this.connectingWatchdog);
      this.connectingWatchdog = null;
    }
    this.pc?.close();
    this.pc = null;
    this.connected = false;
    this.hasReceivedOffer = false;
    this.handlingOffer = false;
    this.isConnecting = false;
    this.connectingLockTime = 0;
    this.processedIds.clear();
    this.iceCandidateBuffer = [];
    this.localIceCounter = createIceCounter();
    this.remoteIceCounter = createIceCounter();
    this.lastOfferAt = null;

    // Restart connection — flag as recovery so the broadcaster skips its grace
    // period and rebuilds the peer connection immediately with a fresh offer.
    this.connect(true);
  }

  /**
   * Exponential backoff delay for reconnect attempts. Starts at 1s, doubles
   * on each attempt, capped at 15s. Keeps recovery responsive on transient
   * glitches while preventing a tight loop of offer/answer churn when the
   * network is genuinely unreachable.
   */
  private backoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 15000);
  }

  /**
   * Schedule a rejoin after `backoffDelay(this.reconnectAttempts)` unless the
   * retry budget is exhausted. Caller is responsible for incrementing
   * `reconnectAttempts` before invoking this.
   */
  private scheduleBackoffRejoin() {
    if (!this.running) return;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.onConnectionStateCallback?.('failed');
      return;
    }
    const delay = this.backoffDelay(this.reconnectAttempts);
    console.log(`[Viewer] Backoff rejoin in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.running) this.sendJoin(true);
    }, delay);
  }

  /**
   * Proactively escalate to TURN-relay-only mode and reconnect. Called by the
   * viewer UI when the WebRTC stream hasn't produced a frame within the mobile
   * timeout — on carrier-grade NAT this is almost always because direct P2P is
   * being blocked, so forcing TURN is the fastest recovery path.
   */
  forceRelayReconnect() {
    if (!this.forceRelay) {
      console.log('[Viewer] Escalating to TURN-relay-only mode by request');
      this.forceRelay = true;
      this.failedAttemptsSinceRelay = 0;
    }
    this.reconnect();
  }

  /** Whether the next peer connection will be built in relay-only mode. */
  isRelayOnly() {
    return this.forceRelay;
  }

  getDiagnostics() {
    const pc = this.pc;
    return {
      viewerId: this.viewerId,
      running: this.running,
      connected: this.connected,
      forceRelay: this.forceRelay,
      reconnectAttempts: this.reconnectAttempts,
      hasReceivedOffer: this.hasReceivedOffer,
      handlingOffer: this.handlingOffer,
      pcConnectionState: pc?.connectionState || 'none',
      pcIceConnectionState: pc?.iceConnectionState || 'none',
      pcIceGatheringState: pc?.iceGatheringState || 'none',
      signalingState: pc?.signalingState || 'none',
      localIce: { ...this.localIceCounter },
      remoteIce: { ...this.remoteIceCounter },
      bufferedRemoteCandidates: this.iceCandidateBuffer.length,
      lastOfferAt: this.lastOfferAt,
    };
  }

  private schedulePoll() {
    if (!this.running) return;
    // Use aggressive polling (150ms) for the first 5s during connection to catch the offer ASAP,
    // then 300ms during ongoing connection, and 800ms once connected
    const elapsed = Date.now() - this.connectingLockTime;
    const interval = this.connected ? 800 : (elapsed < 5000 ? 150 : 300);
    this.pollTimer = setTimeout(() => {
      this.poll().then(() => this.schedulePoll());
    }, interval);
  }

  private sendJoin(recover = false) {
    // Set connecting lock to prevent rapid re-joins
    this.isConnecting = true;
    this.connectingLockTime = Date.now();

    postSignal(this.channelName, {
      id: generateId(),
      type: 'viewer-join',
      senderId: this.viewerId,
      payload: recover ? { recover: true } : undefined,
    });
  }

  private async poll() {
    if (!this.running) return;
    
    // Polling with overlap window to handle timestamp collisions
    const pollSince = Math.max(0, this.lastTimestamp - 2000);
    const { signals, latestTimestamp } = await pollSignals(
      this.channelName,
      this.viewerId,
      pollSince
    );
    
    if (latestTimestamp > this.lastTimestamp) {
      this.lastTimestamp = latestTimestamp;
    }

    for (const msg of signals) {
      if (msg.senderId === this.viewerId || this.processedIds.has(msg.id)) continue;
      this.processedIds.add(msg.id);
      
      if (this.processedIds.size > 500) {
        const iterator = this.processedIds.values();
        for (let i = 0; i < 100; i++) this.processedIds.delete(iterator.next().value!);
      }

      await this.handleSignal(msg);
    }
  }

  private async handleSignal(msg: SignalMessage) {
    switch (msg.type) {
      case 'offer':
        if (msg.targetId === this.viewerId) {
          await this.handleOffer(msg.senderId, msg.payload);
        }
        break;
      case 'ice-candidates':
        if (msg.targetId === this.viewerId) {
          await this.handleIceCandidates(msg.payload);
        }
        break;
      case 'chat':
        if (msg.payload) {
          if (this.onChatCallback) {
            this.onChatCallback(msg.payload as ChatMessage);
          } else {
            this.bufferedChatMessages.push(msg.payload as ChatMessage);
          }
        }
        break;
    }
  }

  private async handleOffer(broadcasterId: string, offer: RTCSessionDescriptionInit & { offerId?: string }) {
    // Guard against concurrent offer processing
    if (this.handlingOffer) {
      console.log('[Viewer] Already handling an offer, ignoring duplicate');
      return;
    }
    this.handlingOffer = true;
    console.log('[Viewer] Received offer from broadcaster');
    this.lastOfferAt = Date.now();

    // Store offerId to include in answer for matching
    const currentOfferId = offer.offerId;

    // Mark that we received an offer - stop sending viewer-joins
    this.hasReceivedOffer = true;
    if (this.rejoinTimer) {
      clearInterval(this.rejoinTimer);
      this.rejoinTimer = null;
    }

    // Close existing connection
    this.pc?.close();

    // Build ICE config — force TURN relay if a prior attempt failed on mobile
    // (carrier-grade NAT routinely blocks direct P2P on cellular networks).
    const pc = new RTCPeerConnection(buildIceConfig(this.forceRelay));
    if (this.forceRelay) {
      console.log('[Viewer] Using iceTransportPolicy="relay" — all media will flow through TURN');
    }
    this.pc = pc;
    this.iceCandidateBuffer = []; // reset buffer
    this.localIceCounter = createIceCounter();
    this.remoteIceCounter = createIceCounter();

    // Handle incoming tracks — deliver stream immediately and re-deliver on track changes
    pc.ontrack = (event) => {
      console.log('[Viewer] Received remote track:', event.track.kind, 'readyState:', event.track.readyState);

      // Minimize the decoder playout buffer so viewer frames are presented as
      // soon as they arrive, instead of waiting the default ~150ms for jitter
      // smoothing. This is the biggest single lever against broadcaster/viewer
      // delay on WebRTC and is a no-op in browsers that don't support the hint.
      try {
        if (event.receiver && 'playoutDelayHint' in event.receiver) {
          (event.receiver as any).playoutDelayHint = 0;
        }
        // Also hint jitterBufferTarget (newer Chrome) to aim for a minimal buffer.
        if (event.receiver && 'jitterBufferTarget' in event.receiver) {
          (event.receiver as any).jitterBufferTarget = 0;
        }
      } catch {}

      if (event.streams[0]) {
        if (this.onStreamCallback) {
          this.onStreamCallback(event.streams[0]);
        } else {
          // Buffer stream for when callback is registered (pre-connection mode)
          this.bufferedStream = event.streams[0];
        }

        // Also re-deliver on unmute in case the track was initially muted
        event.track.addEventListener('unmute', () => {
          if (event.streams[0]) {
            if (this.onStreamCallback) {
              this.onStreamCallback(event.streams[0]);
            } else {
              this.bufferedStream = event.streams[0];
            }
          }
        }, { once: true });
      }
    };

    // Batch ICE candidates
    let iceBatch: RTCIceCandidateInit[] = [];
    let iceFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushIce = () => {
      if (iceBatch.length === 0) return;
      const batch = [...iceBatch];
      iceBatch = [];

      postSignal(this.channelName, {
        id: generateId(),
        type: 'ice-candidates',
        senderId: this.viewerId,
        targetId: broadcasterId,
        payload: batch,
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const kind = bumpIceCounter(this.localIceCounter, event.candidate);
        const proto = getIceCandidateProtocol(event.candidate);
        console.log(`[Viewer][ICE][local->${broadcasterId}] type=${kind} protocol=${proto}`);
        iceBatch.push(event.candidate.toJSON());
        if (iceFlushTimer) clearTimeout(iceFlushTimer);
        iceFlushTimer = setTimeout(flushIce, 80); // 80ms window
      } else {
        console.log(`[Viewer][ICE][local->${broadcasterId}] gathering complete (${formatIceCounter(this.localIceCounter)})`);
        flushIce();
      }
    };

    // Per-PC TURN failure tracker. If every TURN URL in our active config
    // reports a hard allocate/auth failure (400/401/403/701 and friends), fire
    // the global TURN-failure callback so the UI can surface a "check network"
    // hint instead of spinning silently.
    const failedTurnUrls = new Set<string>();
    let turnFailureReported = false;
    pc.onicecandidateerror = (event: any) => {
      const url: string = event.url || '';
      const code: number = Number(event.errorCode);
      const text: string = event.errorText || '';
      console.warn(
        `[Viewer][ICE] candidate error url=${url || 'n/a'} code=${code} text=${text || 'n/a'}`
      );
      const isTurnUrl = /^turns?:/i.test(url);
      // 400 = allocate error (bad/expired credentials or quota exceeded)
      // 401/403 = auth failure
      // 701 = TURN server unreachable / connection failed
      const isHardFailure = isTurnUrl && (code === 400 || code === 401 || code === 403 || code === 701);
      if (!isHardFailure) return;
      failedTurnUrls.add(url);

      if (turnFailureReported) return;
      const turnUrls = collectTurnUrls(getActiveIceConfig());
      if (turnUrls.length > 0 && failedTurnUrls.size >= turnUrls.length) {
        turnFailureReported = true;
        console.error(
          `[Viewer][ICE] All ${turnUrls.length} TURN URLs reported hard failure — notifying UI`,
        );
        notifyTurnFailure({ failedUrls: Array.from(failedTurnUrls), totalTurnUrls: turnUrls.length });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Viewer][ICE] state=${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        void logSelectedCandidatePair(pc, `Viewer:${this.viewerId}`);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[Viewer] Connection state:', pc.connectionState);
      if (this.onConnectionStateCallback) {
        this.onConnectionStateCallback(pc.connectionState);
      } else {
        this.bufferedConnectionState = pc.connectionState;
      }

      if (pc.connectionState === 'connected') {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.isConnecting = false; // Connection succeeded, release lock
        this.failedAttemptsSinceRelay = 0;
        console.log(
          `[Viewer][ICE] connected local(${formatIceCounter(this.localIceCounter)}) remote(${formatIceCounter(this.remoteIceCounter)})`
        );
        if (this.connectingWatchdog) {
          clearTimeout(this.connectingWatchdog);
          this.connectingWatchdog = null;
        }
      } else if (pc.connectionState === 'failed') {
        this.connected = false;
        this.hasReceivedOffer = false; // Allow re-sending viewer-join on failure
        this.handlingOffer = false; // Allow processing new offers on reconnect
        this.isConnecting = false; // Connection failed, release lock
        if (this.connectingWatchdog) {
          clearTimeout(this.connectingWatchdog);
          this.connectingWatchdog = null;
        }
        // Escalate to TURN-relay-only mode after the first failure on mobile.
        // Direct P2P on cellular / carrier Wi-Fi often fails due to symmetric
        // CGNAT; forcing relay guarantees a usable media path on retry.
        this.failedAttemptsSinceRelay++;
        if (!this.forceRelay && isMobileViewer() && this.failedAttemptsSinceRelay >= 1) {
          console.log('[Viewer] First P2P attempt failed on mobile — escalating to TURN-relay-only mode');
          this.forceRelay = true;
          this.failedAttemptsSinceRelay = 0;
        }
        // Attempt reconnection via centralized exponential backoff
        if (this.running && this.reconnectAttempts < this.maxReconnectAttempts) {
          console.log('[Viewer] Connection failed, scheduling backoff reconnect...');
          this.reconnectAttempts++;
          this.scheduleBackoffRejoin();
        } else if (this.running && this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.onConnectionStateCallback?.('failed');
        }
      } else if (pc.connectionState === 'disconnected') {
        // Disconnected is often transient — wait 5s before treating as lost
        this.connected = false;
        // Attempt an in-place ICE restart first: it's cheaper than tearing
        // down the PC and often recovers a transient NAT rebind without a
        // full offer/answer roundtrip. If it doesn't promote us back to
        // `connected` within the grace window, the fallback path below runs.
        try {
          if (typeof (pc as any).restartIce === 'function') {
            (pc as any).restartIce();
            console.log('[Viewer] restartIce() invoked on disconnected PC');
          }
        } catch (e) {
          console.warn('[Viewer] restartIce failed (non-fatal):', e);
        }
        setTimeout(() => {
          if (!this.running) return;
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            console.log('[Viewer] Connection still disconnected after grace period, reconnecting...');
            this.hasReceivedOffer = false;
            this.handlingOffer = false;
            this.isConnecting = false;
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
              this.reconnectAttempts++;
              this.scheduleBackoffRejoin();
            } else {
              this.onConnectionStateCallback?.('failed');
            }
          } else {
            console.log('[Viewer] Connection recovered from disconnected to', pc.connectionState);
          }
        }, 5000);
      }
    };

    // ICE-state watchdog: pc.connectionState transitions from `new` →
    // `connecting` → `connected`, but on CGNAT/mobile it can hang in
    // `connecting` forever without ever firing `failed`. Force a recovery
    // after CONNECTING_STALL_MS.
    if (this.connectingWatchdog) clearTimeout(this.connectingWatchdog);
    this.connectingWatchdog = setTimeout(() => {
      if (!this.running || !this.pc || this.pc !== pc) return;
      const state = pc.connectionState;
      if (state === 'connected' || state === 'closed') return;
      console.warn(`[Viewer] pc stuck in "${state}" for ${this.CONNECTING_STALL_MS}ms — escalating and reconnecting`);
      console.warn(
        `[Viewer][ICE] stall snapshot local(${formatIceCounter(this.localIceCounter)}) remote(${formatIceCounter(this.remoteIceCounter)})`
      );
      void logSelectedCandidatePair(pc, `Viewer:${this.viewerId}:stall`);
      // Escalate to relay-only on stall; mobile CGNAT is the usual culprit.
      if (!this.forceRelay) {
        this.forceRelay = true;
        this.failedAttemptsSinceRelay = 0;
        console.log('[Viewer] Stall watchdog: forcing TURN-relay-only mode');
      }
      // Tear down and reconnect with exponential backoff via centralized path.
      this.reconnectAttempts++;
      this.pc?.close();
      this.pc = null;
      this.connected = false;
      this.hasReceivedOffer = false;
      this.handlingOffer = false;
      this.isConnecting = false;
      this.scheduleBackoffRejoin();
    }, this.CONNECTING_STALL_MS);

    try {
      // Set offer and create answer
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Reorder the viewer's receive-transceiver codec list so that H.264 is the
      // first negotiated codec. On iOS Safari this keeps the video on the
      // hardware H.264 decoder path even if the broadcaster's offer happened to
      // list VP8/VP9 first. Safe no-op on browsers missing setCodecPreferences.
      preferH264OnVideoTransceivers(pc);

      // Flush buffered ICE candidates (in case they arrived out of order before offer)
      if (this.iceCandidateBuffer.length > 0) {
        for (const candidate of this.iceCandidateBuffer) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error('[Viewer] Error adding buffered ICE candidate:', e);
          }
        }
        this.iceCandidateBuffer = []; // Clear buffer
      }

      const answer = await pc.createAnswer();
      // NOTE: Do NOT apply preferH264HighProfile to the viewer answer.
      // The answer must reflect the viewer's actual decoding capabilities.
      // Overriding the profile-level-id can cause codec negotiation mismatch
      // where the decoder never produces frames (readyState stays 0).
      await pc.setLocalDescription(answer);

      // Wait for ICE candidates to be gathered before sending the answer
      await waitForIceGatheringComplete(pc);

      // Use pc.localDescription which includes gathered ICE candidates (not the original answer)
      const finalAnswer = pc.localDescription!;
      await postSignal(this.channelName, {
        id: generateId(),
        type: 'answer',
        senderId: this.viewerId,
        targetId: broadcasterId,
        payload: { sdp: finalAnswer.sdp, type: finalAnswer.type, offerId: currentOfferId },
      });
    } catch (err) {
      console.error('[Viewer] Error handling offer:', err);
      // Reset state so viewer can accept a new offer and retry
      this.hasReceivedOffer = false;
      this.isConnecting = false;
      // Attempt reconnection via exponential backoff
      if (this.running && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        this.scheduleBackoffRejoin();
      }
    } finally {
      this.handlingOffer = false;
    }
  }

  private async handleIceCandidates(candidates: RTCIceCandidateInit[]) {
    if (!this.pc) return;
    
    // If offer is not yet processed, remoteDescription is null. Buffer the candidates.
    if (!this.pc.remoteDescription) {
      for (const candidate of candidates) {
        bumpIceCounter(this.remoteIceCounter, candidate);
      }
      this.iceCandidateBuffer.push(...candidates);
      return;
    }

    for (const candidate of candidates) {
      const kind = bumpIceCounter(this.remoteIceCounter, candidate);
      const proto = getIceCandidateProtocol(candidate);
      console.log(`[Viewer][ICE][remote<-broadcaster] type=${kind} protocol=${proto}`);
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[Viewer] Error adding ICE candidate:', err);
      }
    }
  }

  disconnect() {
    this.running = false;
    this.connected = false;
    this.hasReceivedOffer = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rejoinTimer) {
      clearInterval(this.rejoinTimer);
      this.rejoinTimer = null;
    }
    if (this.connectingWatchdog) {
      clearTimeout(this.connectingWatchdog);
      this.connectingWatchdog = null;
    }
    this.pc?.close();
    this.pc = null;
    this.processedIds.clear();
    this.iceCandidateBuffer = [];
    this.localIceCounter = createIceCounter();
    this.remoteIceCounter = createIceCounter();
    this.lastOfferAt = null;
  }
}
