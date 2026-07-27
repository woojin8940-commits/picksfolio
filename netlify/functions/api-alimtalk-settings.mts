import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { readAlimtalkUsage } from "./_shared/alimtalk-usage.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 라이브 시작 알림톡 설정 (알림 대상 · 발송 한도 · 구독자 수).
 *
 *   GET  /api/alimtalk-settings?user=<username>     → { settings, usage, subscriberCount }
 *   POST /api/alimtalk-settings  { user, settings } → 저장
 *   (예전 형태인 /api/alimtalk-settings/:username 도 계속 받는다)
 *
 * 두 가지를 함께 고쳤다.
 *  1) 인증이 없어서 남의 아이디만 알면 알림톡 설정을 읽고 덮어쓸 수 있었다 → 본인만.
 *  2) 화면(NotifySettings · LiveCommerceManagement)은 `?user=` 로 부르고 응답에서
 *     settings / usage / subscriberCount 를 읽는데, 함수는 `/:username` 경로만 받고
 *     저장된 값을 그대로 돌려줬다. 즉 설정 화면이 저장도 조회도 되지 않았다 →
 *     화면이 쓰는 형태로 맞췄다.
 */

const SETTINGS_STORE = "alimtalk-settings";
const SUBSCRIBER_STORE = "live-notify-subscribers";

const settingsKey = (username: string) => `alimtalk_${username}`;

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : null;

  const username = (context.params.username || url.searchParams.get("user") || body?.user || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^biz\//, "");

  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 발송 대상·한도 설정이고 구독자 수까지 함께 내려준다. 본인(또는 관리자)만.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore(SETTINGS_STORE);
  const key = settingsKey(username);

  if (req.method === "GET") {
    const [stored, usage, subscriberCount] = await Promise.all([
      store.get(key, { type: "json" }),
      readAlimtalkUsage(username),
      (async () => {
        try {
          const subs = (await getStore(SUBSCRIBER_STORE).get(username, { type: "json" })) as
            | { subscribers?: unknown[] }
            | null;
          return Array.isArray(subs?.subscribers) ? subs!.subscribers!.length : 0;
        } catch {
          return 0;
        }
      })(),
    ]);

    return Response.json({
      settings: (stored as Record<string, unknown> | null) || null,
      usage,
      subscriberCount,
    });
  }

  if (req.method === "POST") {
    // 화면은 { user, settings } 로 보낸다. 설정 객체를 그대로 보내던 예전 호출도 받는다.
    const settings =
      body && typeof body.settings === "object" && body.settings !== null
        ? body.settings
        : (() => {
            const { user: _user, ...rest } = body || {};
            return rest;
          })();

    await store.setJSON(key, settings);
    return Response.json({ success: true, settings });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: ["/api/alimtalk-settings", "/api/alimtalk-settings/:username"],
};
