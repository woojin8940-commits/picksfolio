import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/**
 * 인스타그램 DM 자동화 설정 저장/조회 (사용자별).
 * - Netlify Blobs 에 사용자별 JSON 설정을 보관한다.
 * - 액세스 토큰은 민감정보라 GET 응답에서는 원문을 내려주지 않고
 *   `hasAccessToken` / `connected` 플래그로만 노출한다.
 * - 계정 연동은 OAuth 콜백(instagram-oauth-callback)이 담당하며, 이 함수는
 *   자동화(automations) 목록과 연동 해제(disconnect)만 처리한다.
 *
 * automations: 인포크 링크식 "댓글 → DM" 자동화 목록.
 *   - commentMatch: 'all' | 'keyword'  (모든 댓글 / 특정 키워드)
 *   - replyEnabled + replies: 댓글에 공개 답글도 남길지 (랜덤)
 *   - followFilter: 'all' | 'followers' | 'non_followers'
 *   - message + buttons: 실제로 보낼 DM (텍스트 + 링크 버튼)
 *
 * rules: 구버전 트리거 규칙(welcome/new_follower 등) — 하위호환 위해 보존한다.
 */

interface DmMessageButton {
  id: string;
  label: string;
  url: string;
}

interface DmCarouselCard {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  buttonLabel: string;
  buttonUrl: string;
}

interface DmAutomationItem {
  id: string;
  name: string;
  enabled: boolean;
  commentMatch: "all" | "keyword";
  keywords: string[];
  replyEnabled: boolean;
  replies: string[];
  followFilter: "all" | "followers" | "non_followers";
  mediaScope: "all" | "selected";
  mediaIds: string[];
  messageType: "text" | "carousel";
  message: string;
  buttons: DmMessageButton[];
  cards: DmCarouselCard[];
  createdAt: string;
}

interface DmSettings {
  enabled: boolean;
  connected: boolean;
  igUserId: string;
  igAccountId: string;
  igUsername: string;
  accessToken?: string;
  tokenSource?: string;
  tokenExpiresAt?: string;
  automations: DmAutomationItem[];
  rules: unknown[];
  updatedAt?: string;
}

const DEFAULT_SETTINGS: DmSettings = {
  enabled: false,
  connected: false,
  igUserId: "",
  igAccountId: "",
  igUsername: "",
  automations: [],
  rules: [],
};

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function sanitizeAutomation(a: any): DmAutomationItem {
  const buttons: DmMessageButton[] = Array.isArray(a?.buttons)
    ? a.buttons
        .slice(0, 3)
        .map((b: any) => ({
          id: String(b?.id || genId("btn")),
          label: String(b?.label || "").slice(0, 30),
          url: String(b?.url || "").slice(0, 500),
        }))
        .filter((b: DmMessageButton) => b.label || b.url)
    : [];

  const keywords: string[] = Array.isArray(a?.keywords)
    ? a.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 20)
    : [];

  const replies: string[] = Array.isArray(a?.replies)
    ? a.replies.map((r: any) => String(r).slice(0, 300)).filter(Boolean).slice(0, 10)
    : [];

  const mediaIds: string[] = Array.isArray(a?.mediaIds)
    ? a.mediaIds.map((m: any) => String(m).trim()).filter(Boolean).slice(0, 50)
    : [];

  const cards: DmCarouselCard[] = Array.isArray(a?.cards)
    ? a.cards
        .slice(0, 10)
        .map((c: any) => ({
          id: String(c?.id || genId("card")),
          title: String(c?.title || "").slice(0, 80),
          subtitle: String(c?.subtitle || "").slice(0, 80),
          imageUrl: String(c?.imageUrl || "").slice(0, 1000),
          buttonLabel: String(c?.buttonLabel || "").slice(0, 20),
          buttonUrl: String(c?.buttonUrl || "").slice(0, 1000),
        }))
        .filter((c: DmCarouselCard) => c.title || c.imageUrl || c.buttonUrl)
    : [];

  const mediaScope = a?.mediaScope === "selected" && mediaIds.length > 0 ? "selected" : "all";
  const messageType = a?.messageType === "carousel" ? "carousel" : "text";

  return {
    id: String(a?.id || genId("auto")),
    name: String(a?.name || "새 자동화").slice(0, 60),
    enabled: a?.enabled !== false,
    commentMatch: a?.commentMatch === "keyword" ? "keyword" : "all",
    keywords,
    replyEnabled: Boolean(a?.replyEnabled),
    replies,
    followFilter:
      a?.followFilter === "followers" || a?.followFilter === "non_followers"
        ? a.followFilter
        : "all",
    mediaScope,
    mediaIds,
    messageType,
    message: String(a?.message || "").slice(0, 1000),
    buttons,
    cards,
    createdAt: String(a?.createdAt || new Date().toISOString()),
  };
}

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
      automations: Array.isArray(data.automations) ? data.automations : [],
      connected: Boolean(accessToken) && Boolean(data.igUserId || data.igAccountId),
      hasAccessToken: Boolean(accessToken),
      logs: logs.slice(0, 20),
    });
  }

  if (req.method === "POST") {
    const body = (await req.json()) as any;
    const existing = ((await store.get(key, { type: "json" })) as DmSettings) || DEFAULT_SETTINGS;

    // 연동 해제
    if (body?.action === "disconnect") {
      const next: DmSettings = {
        ...DEFAULT_SETTINGS,
        ...existing,
        enabled: false,
        connected: false,
        igUserId: "",
        igAccountId: "",
        igUsername: "",
        accessToken: "",
        tokenSource: undefined,
        tokenExpiresAt: undefined,
        automations: Array.isArray(existing.automations) ? existing.automations : [],
        rules: Array.isArray(existing.rules) ? existing.rules : [],
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(key, next);
      return Response.json({ success: true, connected: false });
    }

    const next: DmSettings = {
      ...DEFAULT_SETTINGS,
      ...existing,
      enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
      automations: Array.isArray(body.automations)
        ? body.automations.map(sanitizeAutomation)
        : Array.isArray(existing.automations)
        ? existing.automations
        : [],
      // 구버전 rules 는 전달되면 갱신, 아니면 유지
      rules: Array.isArray(body.rules) ? body.rules : existing.rules || [],
      updatedAt: new Date().toISOString(),
    };

    await store.setJSON(key, next);
    return Response.json({
      success: true,
      connected: Boolean(next.accessToken) && Boolean(next.igUserId || next.igAccountId),
    });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/dm-automation/:username",
};
