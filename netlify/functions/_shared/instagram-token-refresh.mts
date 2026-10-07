import { getStore } from "@netlify/blobs";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mutateBlobJSON } from "./blob-write.mts";
import { mapConcurrent } from "./concurrency.mts";
import { indexDmAccount } from "./dm-webhook-index.mts";
import { linkFeatureOff, type MetaLink } from "./instagram-metrics.mts";
import {
  readSubscribedFields,
  subscribeInstagramWebhooks,
  webhookFieldsSufficient,
} from "./instagram-webhook-subscribe.mts";

/**
 * 인스타그램 장기 액세스 토큰 자동 갱신 — 계정이 수백 · 수천 개로 늘어도 끝까지 도는 구조.
 *
 * "Instagram API with Instagram Login" 의 장기 토큰은 발급 후 60일이면 만료된다.
 * 만료되면 댓글 웹훅은 계속 도착하지만 DM 발송·피드 조회가 전부 실패하고, 화면에는
 * 여전히 "연결됨"으로 보여서 사용자는 원인을 알 수 없다. 만료가 가까운 토큰을
 * `ig_refresh_token` 으로 다시 60일짜리로 바꿔 끼운다. 갱신 조건은 Meta 쪽 제약을 따른다.
 *   - 발급 후 24시간이 지난 토큰만 갱신할 수 있다.
 *   - 이미 만료된 토큰은 갱신할 수 없다 → 사용자가 재연동해야 한다.
 *
 * 예전에는 예약 함수 하나가 모든 계정을 한 줄로 돌았다. 예약 함수는 약 30초면 강제로
 * 끝나고 fetch 에 시간 제한도 없어서, 계정이 수백 개가 되면 매일 같은 자리에서 끊겼다 —
 * 알파벳 뒤쪽 계정과 두 번째 보관함(collab-instagram)은 영영 갱신되지 않고 60일 뒤
 * 멈춘다. 그래서 일을 이렇게 나눈다.
 *
 *   1. 예약 함수(scheduled-instagram-token-refresh)는 매시간 돌며 "오늘 실행이 끝났는가"만
 *      본다. 끝나지 않았으면 백그라운드 작업자를 깨운다. 30초 제한과 무관하게 짧다.
 *   2. 백그라운드 작업자(instagram-token-refresh-background, 최대 15분)가 계정을 여러 개씩
 *      동시에 처리한다. 요청마다 시간 제한을 둬서 한 계정이 멈춰도 나머지가 막히지 않는다.
 *   3. 12분 안에 다 못 끝내면 어디까지 했는지(cursor)를 남기고 다음 작업자를 깨워 이어
 *      간다. 계정 수가 얼마든 여러 번에 나눠 끝까지 간다.
 *   4. 진행 상황은 블롭에 남는다. 작업자가 도중에 죽어도(배포 · 장애) 다음 시간의 예약
 *      함수가 멈춘 실행을 알아보고 남은 자리부터 다시 깨운다.
 *
 * 구 페이지 토큰(tokenSource ≠ instagram_login)은 만료가 없어 대상에서 제외한다.
 *
 * 보관함이 두 곳이다. 디엠 자동화(dm-automation)와 캠페인 등록(collab-instagram)은
 * 각자 따로 연동하므로 토큰도 따로 들고 있고, 갱신 규칙은 같다.
 *
 * 기능을 끊어 둔 연동(`featuresOff`)도 대상에서 빼지 않는다. 브랜드가 자동 디엠을
 * 해제해도 콘텐츠 성과(태그된 콘텐츠)는 같은 토큰으로 계속 조회되므로
 * (_shared/tagged-media 의 loadBrandLink), 여기서 걸러 내면 60일 뒤 브랜드의 캠페인
 * 성과 화면이 "다시 연동해 주세요"로 바뀐다.
 */

/** 갱신 대상 보관함. 이름과 키 접두사만 다르고 처리 방법은 같다. */
export const TOKEN_SOURCES = [
  { store: "dm-automation", prefix: "dm_" },
  { store: "collab-instagram", prefix: "ig_" },
] as const;

/** 만료까지 이 일수 이하로 남으면 갱신한다. 매일 시도하므로 며칠 실패해도 여유가 있다. */
const REFRESH_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 동시에 처리할 계정 수. Meta 쪽 호출 한도와 블롭 쓰기 충돌을 생각해 작게 둔다. */
const CONCURRENCY = 8;
/** 한 묶음. 묶음이 끝날 때마다 진행 위치를 저장한다. */
const BATCH_SIZE = 40;
/** 작업자 한 번의 일할 시간. 백그라운드 한도(15분)보다 넉넉히 짧게 끊고 다음에 넘긴다. */
export const WORKER_BUDGET_MS = 12 * 60 * 1000;
/** Meta 갱신 요청 하나의 시간 제한. */
const REFRESH_TIMEOUT_MS = 10_000;
/** 이 시간 동안 진행 소식이 없으면 작업자가 죽은 것으로 보고 다시 깨운다. */
export const STALE_RUN_MS = 20 * 60 * 1000;
/** 하루 한 번 완주하면 충분하다. 끝난 지 이만큼 지나면 새 실행을 연다. */
export const RUN_INTERVAL_MS = 20 * 60 * 60 * 1000;

const STATE_STORE = "ig-token-refresh";
const STATE_KEY = "state";

interface TokenRecord {
  accessToken?: string;
  tokenSource?: string;
  tokenExpiresAt?: string;
  needsReauth?: boolean;
  igUserId?: string;
  igAccountId?: string;
  webhookFields?: string;
  webhookVerifiedAt?: string;
  [k: string]: unknown;
}

export interface RefreshCursor {
  /** TOKEN_SOURCES 의 몇 번째 보관함까지 왔는가. */
  source: number;
  /** 그 보관함에서 마지막으로 끝낸 키. 빈 문자열이면 처음부터. */
  after: string;
}

export interface RefreshCounts {
  refreshed: number;
  expired: number;
  failed: number;
  skipped: number;
}

export interface RefreshRunState {
  runId: string;
  startedAt: string;
  /** 작업자가 마지막으로 진행을 알린 시각. 멈춘 실행을 알아보는 근거다. */
  heartbeatAt: string;
  finishedAt: string | null;
  cursor: RefreshCursor;
  counts: RefreshCounts;
  /** 이 실행을 이어 받은 작업자 수. 계정이 늘면 커진다. */
  workers: number;
}

const emptyCounts = (): RefreshCounts => ({ refreshed: 0, expired: 0, failed: 0, skipped: 0 });

const stateStore = () => getStore({ name: STATE_STORE, consistency: "strong" });

export async function readRunState(): Promise<RefreshRunState | null> {
  try {
    return ((await stateStore().get(STATE_KEY, { type: "json" })) as RefreshRunState | null) || null;
  } catch (e) {
    console.warn("[ig-token] 진행 상태를 읽지 못했습니다:", (e as Error)?.message);
    return null;
  }
}

async function writeRunState(state: RefreshRunState): Promise<void> {
  await stateStore().setJSON(STATE_KEY, state);
}

export function newRunState(): RefreshRunState {
  const now = new Date().toISOString();
  return {
    runId: randomUUID(),
    startedAt: now,
    heartbeatAt: now,
    finishedAt: null,
    cursor: { source: 0, after: "" },
    counts: emptyCounts(),
    workers: 0,
  };
}

export async function saveNewRun(state: RefreshRunState): Promise<void> {
  await writeRunState(state);
}

// --- 작업자 호출 서명 --------------------------------------------------------
//
// 백그라운드 작업자는 공개 주소로 열려 있다. 아무나 부르면 Meta 호출이 반복되므로
// 서버끼리만 아는 비밀로 서명한 요청만 받는다(디엠 작업자와 같은 방식, 접두사만 다르다).

function workerSecret(): string {
  const secret = process.env.DM_WORKER_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!secret) throw new Error("Token refresh worker secret is not configured");
  return secret;
}

function signature(body: string): string {
  return createHmac("sha256", workerSecret()).update(`ig-token-refresh-v1:${body}`).digest("hex");
}

export function verifyRefreshWorkerRequest(body: string, supplied: string | null): boolean {
  if (!supplied || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  try {
    return timingSafeEqual(Buffer.from(signature(body), "hex"), Buffer.from(supplied, "hex"));
  } catch {
    return false;
  }
}

/** 백그라운드 작업자를 깨운다. 작업자는 202 를 바로 돌려주고 뒤에서 일한다. */
export async function dispatchRefreshWorker(runId: string): Promise<boolean> {
  const origin = new URL(process.env.URL || "https://picks-folio.com");
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new Error("Invalid worker origin");
  }
  const body = JSON.stringify({ runId });
  try {
    const response = await fetch(new URL("/.netlify/functions/instagram-token-refresh-background", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Token-Refresh-Signature": signature(body) },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status !== 202) throw new Error(`Worker response ${response.status}`);
    return true;
  } catch (e) {
    console.error("[ig-token] 작업자 호출 실패:", (e as Error)?.message);
    return false;
  }
}

// --- 계정 하나 처리 ----------------------------------------------------------

type Outcome = keyof RefreshCounts;

/**
 * 되살릴 수 없는 토큰에 재연동 표시를 남긴다.
 *
 * 표시가 없으면 화면은 계속 "연동됨"으로 보이고, 사람은 갱신 버튼을 눌러서야
 * 영문 오류로 사실을 알게 된다. 밤사이에 미리 표시해 두면 다음에 화면을 여는
 * 순간부터 "다시 연동해 주세요"가 보인다.
 */
async function markNeedsReauth(storeName: string, key: string, expectedToken: string): Promise<void> {
  try {
    await mutateBlobJSON<TokenRecord>(storeName, key, (latest) => {
      if (!latest || latest.accessToken !== expectedToken || latest.needsReauth) return null;
      return {
        ...latest,
        needsReauth: true,
        tokenInvalidAt: new Date().toISOString(),
      };
    });
  } catch (e) {
    console.warn(`[ig-token] ${key} 재연동 표시 실패:`, (e as Error)?.message);
  }
}

async function refreshRecord(storeName: string, key: string): Promise<Outcome> {
  const store = getStore({ name: storeName, consistency: "strong" });
  try {
    const settings = (await store.get(key, { type: "json" })) as TokenRecord | null;
    const token = settings?.accessToken;

    // 연동돼 있고, 만료가 있는 Instagram Login 토큰만 대상.
    if (!settings || !token || settings.tokenSource !== "instagram_login") return "skipped";

    const now = Date.now();
    const expiresAt = settings.tokenExpiresAt ? new Date(settings.tokenExpiresAt).getTime() : NaN;
    // 만료 시각을 모르는(구 데이터) 토큰도 한 번 갱신해 만료 시각을 채워준다.
    if (Number.isFinite(expiresAt)) {
      if (expiresAt <= now) {
        // 만료된 토큰은 갱신 자체가 불가능하다. 재연동만이 길이므로 표시를 남긴다.
        console.warn(`[ig-token] ${key} token already expired — reconnect required`);
        await markNeedsReauth(storeName, key, token);
        return "expired";
      }
      if (expiresAt - now > REFRESH_WINDOW_DAYS * DAY_MS) return "skipped";
    }

    let res: Response;
    let data: any;
    try {
      res = await fetch(
        "https://graph.instagram.com/refresh_access_token" +
          `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) },
      );
      data = await res.json().catch(() => ({}));
    } catch (e) {
      // 시간 초과 · 네트워크 오류는 내일 다시 시도한다. 연동을 끊지 않는다.
      console.error(`[ig-token] refresh request failed for ${key}:`, (e as Error)?.message);
      return "failed";
    }

    if (!res.ok || !data?.access_token) {
      console.error(`[ig-token] refresh failed for ${key}: ${data?.error?.message || `HTTP ${res.status}`}`);
      // 권한이 해제됐거나 토큰이 무효면 내일 다시 시도해도 같은 실패다. 그런
      // 경우에만 표시를 남긴다 — 일시적인 오류로 멀쩡한 연동을 끊으면 사람은 필요
      // 없는 재연동을 하게 된다.
      const err = data?.error;
      const msg = String(err?.message || "").toLowerCase();
      const tokenDead =
        Number(err?.code) === 190 ||
        String(err?.type || "") === "OAuthException" ||
        msg.includes("has not authorized application") ||
        msg.includes("error validating access token") ||
        msg.includes("session has expired");
      if (tokenDead) await markNeedsReauth(storeName, key, token);
      return "failed";
    }

    const expiresIn = Number(data.expires_in || 0);
    let updated = false;
    await mutateBlobJSON<TokenRecord>(storeName, key, (latest) => {
      // 그 사이 재연동으로 토큰이 바뀌었으면 새 토큰을 덮지 않는다.
      if (!latest || latest.accessToken !== token) return null;
      const { needsReauth: _needsReauth, tokenInvalidAt: _tokenInvalidAt, ...rest } = latest;
      updated = true;
      return {
        ...rest,
        accessToken: data.access_token,
        tokenExpiresAt: expiresIn
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : latest.tokenExpiresAt,
        updatedAt: new Date().toISOString(),
      };
    });
    if (!updated) return "skipped";
    console.log(`[ig-token] refreshed ${key} (+${Math.round(expiresIn / 86400)}d)`);
    return "refreshed";
  } catch (e) {
    console.error(`[ig-token] error processing ${key}:`, (e as Error)?.message);
    return "failed";
  }
}

/** 설정 화면이 이 시간 안에 구독을 확인했으면 밤 작업은 다시 읽지 않는다. */
const WEBHOOK_RECHECK_MS = 12 * 60 * 60 * 1000;

/**
 * 자동 디엠 계정의 웹훅 구독을 하루 한 번 실제로 확인하고, 빠졌으면 다시 건다.
 *
 * 설정 화면(api-dm-automation)도 화면을 열 때 같은 일을 하지만, 그건 사람이 화면을
 * 열어야만 돈다. 규칙을 한 번 만들어 두고 화면을 다시 열지 않는 계정은 메타 쪽에서
 * 구독이 풀리면(토큰 재발급·권한 변경, 전달 실패가 이어져 메타가 해제한 경우) 댓글
 * 이벤트가 아예 오지 않아 자동 디엠이 조용히 멈추고, 그 상태를 알아챌 길이 없다.
 *
 * 사람이 자동 디엠을 끊어 둔 계정과 재연동이 필요한 계정은 건드리지 않는다 — 앞은
 * 끊은 것을 되돌리는 일이고, 뒤는 어차피 토큰이 거절된다. 실패는 로그로만 남긴다.
 */
async function verifyDmWebhook(key: string): Promise<void> {
  const storeName = "dm-automation";
  try {
    const settings = (await getStore({ name: storeName, consistency: "strong" }).get(key, {
      type: "json",
    })) as TokenRecord | null;
    const accessToken = settings?.accessToken;
    if (!settings || !accessToken || settings.needsReauth) return;
    if (linkFeatureOff(settings as MetaLink, "dm")) return;
    const lastVerified = Date.parse(String(settings.webhookVerifiedAt || "")) || 0;
    if (Date.now() - lastVerified < WEBHOOK_RECHECK_MS) return;

    const igId = settings.igUserId || settings.igAccountId;
    const actual = await readSubscribedFields({ accessToken, tokenSource: settings.tokenSource, igId });
    // 읽지 못하면 오늘은 넘긴다. 읽기 권한만 없는 계정도 있어 실패로 단정하지 않는다.
    if (actual === null) return;
    const now = new Date().toISOString();
    if (webhookFieldsSufficient(actual)) {
      await mutateBlobJSON<TokenRecord>(storeName, key, (latest) =>
        latest && latest.accessToken === accessToken ? { ...latest, webhookVerifiedAt: now } : null,
      );
      return;
    }

    console.warn(`[ig-token] ${key} webhook subscription missing fields — re-subscribing:`, actual || "(none)");
    const sub = await subscribeInstagramWebhooks({ accessToken, tokenSource: settings.tokenSource, igId });
    if (igId) await indexDmAccount(key.slice("dm_".length), [settings.igUserId, settings.igAccountId]);
    await mutateBlobJSON<TokenRecord>(storeName, key, (latest) => {
      if (!latest || latest.accessToken !== accessToken) return null;
      return sub.ok
        ? {
            ...latest,
            webhookFields: sub.fields || actual,
            webhookSubscribedAt: now,
            webhookVerifiedAt: now,
            webhookHealedAt: now,
          }
        : { ...latest, webhookFields: actual, webhookHealedAt: now };
    });
    if (!sub.ok) console.warn(`[ig-token] ${key} webhook re-subscribe failed:`, sub.error);
  } catch (e) {
    console.warn(`[ig-token] ${key} webhook check failed:`, (e as Error)?.message);
  }
}

// --- 작업자 한 번 ------------------------------------------------------------

async function listKeys(storeName: string, prefix: string): Promise<string[]> {
  const { blobs } = await getStore({ name: storeName, consistency: "strong" }).list({ prefix });
  // 이어 달리기의 기준이므로 순서가 매번 같아야 한다.
  return blobs.map((b) => b.key).sort();
}

/**
 * 작업자 한 번. 주어진 실행을 진행 위치부터 시간이 허락하는 만큼 이어 간다.
 *
 * @returns "done" — 모든 계정을 끝냈다. "continue" — 시간이 다 돼 다음 작업자가 필요하다.
 *          "stale" — 이미 다른 실행으로 바뀌었다(아무것도 하지 않았다).
 */
export async function runRefreshWorker(runId: string): Promise<"done" | "continue" | "stale"> {
  const state = await readRunState();
  if (!state || state.runId !== runId || state.finishedAt) return "stale";

  const deadline = Date.now() + WORKER_BUDGET_MS;
  state.workers += 1;
  state.heartbeatAt = new Date().toISOString();
  await writeRunState(state);

  for (let s = state.cursor.source; s < TOKEN_SOURCES.length; s++) {
    const source = TOKEN_SOURCES[s];
    const after = s === state.cursor.source ? state.cursor.after : "";
    const keys = (await listKeys(source.store, source.prefix)).filter((k) => k > after);

    for (let offset = 0; offset < keys.length; offset += BATCH_SIZE) {
      if (Date.now() >= deadline) return "continue";

      // 다른 실행이 시작됐으면(예: 운영자가 수동으로 새로 열었으면) 여기서 멈춘다.
      const latest = await readRunState();
      if (!latest || latest.runId !== runId) return "stale";

      const batch = keys.slice(offset, offset + BATCH_SIZE);
      const outcomes = await mapConcurrent(batch, CONCURRENCY, async (key) => {
        const outcome = await refreshRecord(source.store, key);
        if (source.store === "dm-automation") await verifyDmWebhook(key);
        return outcome;
      });
      for (const outcome of outcomes) state.counts[outcome] += 1;

      // 묶음마다 위치를 남긴다. 작업자가 여기서 죽어도 이 묶음은 다시 하지 않는다.
      state.cursor = { source: s, after: batch[batch.length - 1] };
      state.heartbeatAt = new Date().toISOString();
      await writeRunState(state);
    }

    // 다음 보관함으로 넘어간다.
    state.cursor = { source: s + 1, after: "" };
    state.heartbeatAt = new Date().toISOString();
    await writeRunState(state);
  }

  state.finishedAt = new Date().toISOString();
  state.heartbeatAt = state.finishedAt;
  await writeRunState(state);
  const c = state.counts;
  console.log(
    `[ig-token] run ${runId} done — refreshed ${c.refreshed}, expired ${c.expired}, ` +
      `failed ${c.failed}, skipped ${c.skipped} (workers ${state.workers})`,
  );
  return "done";
}
