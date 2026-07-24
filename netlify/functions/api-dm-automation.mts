import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/**
 * 인스타그램 DM 자동화 설정 저장/조회 (사용자별).
 * - Netlify Blobs 에 사용자별 JSON 설정을 보관한다.
 * - 액세스 토큰은 민감정보라 GET 응답에서는 원문을 내려주지 않고
 *   `hasAccessToken` 플래그로만 노출한다.
 * - 저장(POST) 시 토큰 필드가 비어 있으면 기존 토큰을 유지한다
 *   (마스킹된 값이 다시 저장되며 토큰이 지워지는 것을 방지).
 */

interface DmRule {
  id: string;
  trigger: "welcome" | "new_follower" | "comment_keyword" | "story_reply" | "new_order";
  keyword?: string;
  message: string;
  enabled: boolean;
}

interface DmSettings {
  enabled: boolean;
  igAccountId: string;
  igUsername: string;
  accessToken?: string;
  rules: DmRule[];
  updatedAt?: string;
}

const DEFAULT_SETTINGS: DmSettings = {
  enabled: false,
  igAccountId: "",
  igUsername: "",
  rules: [],
};

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("dm-automation");
  const key = `dm_${username}`;

  if (req.method === "GET") {
    const data = ((await store.get(key, { type: "json" })) as DmSettings) || DEFAULT_SETTINGS;
    const { accessToken, ...safe } = data;
    const logStore = getStore("dm-automation-log");
    const logs = ((await logStore.get(`log_${username}`, { type: "json" })) as any[]) || [];
    return Response.json({
      ...DEFAULT_SETTINGS,
      ...safe,
      hasAccessToken: Boolean(accessToken),
      logs: logs.slice(0, 20),
    });
  }

  if (req.method === "POST") {
    const body = (await req.json()) as Partial<DmSettings>;
    const existing = ((await store.get(key, { type: "json" })) as DmSettings) || DEFAULT_SETTINGS;

    // 토큰이 새로 전달되지 않으면(빈 값) 기존 토큰을 유지한다.
    const nextToken =
      typeof body.accessToken === "string" && body.accessToken.trim().length > 0
        ? body.accessToken.trim()
        : existing.accessToken || "";

    const next: DmSettings = {
      enabled: Boolean(body.enabled),
      igAccountId: (body.igAccountId ?? existing.igAccountId ?? "").trim(),
      igUsername: (body.igUsername ?? existing.igUsername ?? "").replace(/^@/, "").trim(),
      accessToken: nextToken,
      rules: Array.isArray(body.rules)
        ? body.rules.map((r) => ({
            id: String(r.id || `rule_${Math.random().toString(36).slice(2, 9)}`),
            trigger: r.trigger || "welcome",
            keyword: r.keyword ? String(r.keyword).trim() : undefined,
            message: String(r.message || "").slice(0, 1000),
            enabled: r.enabled !== false,
          }))
        : existing.rules || [],
      updatedAt: new Date().toISOString(),
    };

    await store.setJSON(key, next);
    return Response.json({ success: true, hasAccessToken: Boolean(next.accessToken) });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/dm-automation/:username",
};
