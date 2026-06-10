import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";

/**
 * Register (or refresh) a native device's Expo push token against the
 * logged-in user. Called by the mobile WebView shell once a user is signed in
 * (`mobile/app/index.tsx` → `PicksFolioNative.registerPush`). One row per
 * device: re-registering the same token just updates its owner, so a shared
 * device that switches accounts always points at the current user.
 */
export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { token?: string; username?: string; userType?: string; platform?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = (body.token || "").trim();
  const username = (body.username || "").trim().toLowerCase().replace(/^biz\//, "");
  const userType = body.userType === "business" ? "business" : "influencer";
  const platform = (body.platform || "").slice(0, 20);

  const validToken =
    token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
  if (!validToken || !username) {
    return Response.json({ error: "Missing or invalid token/username" }, { status: 400 });
  }

  try {
    const db = getDatabase();
    await db.sql`
      INSERT INTO push_tokens (token, username, user_type, platform, created_at, updated_at)
      VALUES (${token}, ${username}, ${userType}, ${platform}, now(), now())
      ON CONFLICT (token) DO UPDATE
        SET username = ${username}, user_type = ${userType}, platform = ${platform}, updated_at = now()
    `;
    return Response.json({ success: true });
  } catch (e) {
    console.error("[push-register] failed:", e);
    return Response.json({ error: "Failed to register token" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/push/register",
};
