import { getDatabase } from "@netlify/database";

/**
 * Native push notifications for the PICKS Folio mobile app.
 *
 * The app is a WebView shell, so push is the one channel that reaches a user
 * when the app is closed. Device tokens are Expo push tokens registered by the
 * native shell (see `mobile/src/services/push.ts`) and stored in `push_tokens`,
 * keyed by the logged-in username. Delivery goes through Expo's push service,
 * which fans out to APNs/FCM — no APNs/FCM credentials are needed here.
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface PushPayload {
  title: string;
  body: string;
  /** Arbitrary data delivered to the app; `path` is used for deep-linking. */
  data?: Record<string, unknown>;
}

/** True for a syntactically valid Expo push token. */
function isExpoToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["))
  );
}

/**
 * Send a push notification to every device registered for `username`.
 *
 * Best-effort: failures are logged and swallowed so the caller (a message
 * write) never fails because of push. Tokens Expo reports as unregistered are
 * pruned so the table does not accumulate dead devices.
 */
export async function sendPushToUser(username: string, payload: PushPayload): Promise<void> {
  const uname = (username || "").trim().toLowerCase();
  if (!uname) return;

  const db = getDatabase();

  let rows: { token: string }[];
  try {
    rows = (await db.sql`SELECT token FROM push_tokens WHERE username = ${uname}`) as { token: string }[];
  } catch (e) {
    console.error("[push] failed to read tokens:", e);
    return;
  }

  const tokens = rows.map((r) => r.token).filter(isExpoToken);
  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    priority: "high",
    channelId: "messages",
    title: payload.title,
    body: payload.body,
    ...(payload.data ? { data: payload.data } : {}),
  }));

  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!resp.ok) {
      console.error(`[push] Expo responded ${resp.status}: ${await resp.text()}`);
      return;
    }

    // Prune tokens Expo reports as no longer registered (app uninstalled, etc.).
    const json = (await resp.json()) as { data?: { status?: string; details?: { error?: string } }[] };
    const tickets = json?.data;
    if (Array.isArray(tickets)) {
      const dead = tickets
        .map((t, i) => (t?.status === "error" && t?.details?.error === "DeviceNotRegistered" ? tokens[i] : null))
        .filter((t): t is string => !!t);
      for (const token of dead) {
        try {
          await db.sql`DELETE FROM push_tokens WHERE token = ${token}`;
        } catch (e) {
          console.error("[push] failed to prune dead token:", e);
        }
      }
    }
  } catch (e) {
    console.error("[push] send failed:", e);
  }
}
