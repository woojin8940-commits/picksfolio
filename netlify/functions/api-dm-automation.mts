import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import {
  DM_AUTOMATION_REQUIRED_MESSAGE,
  DM_AUTOMATION_TIER,
  dmAutomationAllowed,
} from "./_shared/dm-automation-access.mts";
import { normalizeLinkUrl } from "./_shared/instagram-dm.mts";
import { subscribeInstagramWebhooks } from "./_shared/instagram-webhook-subscribe.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

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
  /** 계정별 웹훅(`subscribed_apps`) 구독을 마친 시각. */
  webhookSubscribedAt?: string;
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

/** 저장을 거절해야 하는 잘못된 링크를 모아 두는 예외. */
class InvalidLinkError extends Error {}

/** 링크를 정규화하고, 못 살리면 저장 자체를 실패시킨다. */
function requireLink(raw: string, where: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const normalized = normalizeLinkUrl(value);
  if (!normalized) {
    throw new InvalidLinkError(
      `${where}의 링크 주소가 올바르지 않습니다: "${value.slice(0, 80)}" — https:// 로 시작하는 주소를 입력해 주세요.`,
    );
  }
  return normalized.slice(0, 1000);
}

function sanitizeAutomation(a: any): DmAutomationItem {
  const name = String(a?.name || "새 자동화").slice(0, 60);

  const buttons: DmMessageButton[] = Array.isArray(a?.buttons)
    ? a.buttons
        .slice(0, 3)
        .map((b: any) => ({
          id: String(b?.id || genId("btn")),
          label: String(b?.label || "").slice(0, 30),
          url: requireLink(b?.url, `'${name}' 버튼`).slice(0, 500),
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
          buttonUrl: requireLink(c?.buttonUrl, `'${name}' 카드 버튼`),
        }))
        .filter((c: DmCarouselCard) => c.title || c.imageUrl || c.buttonUrl)
    : [];

  const mediaScope = a?.mediaScope === "selected" && mediaIds.length > 0 ? "selected" : "all";
  const messageType = a?.messageType === "carousel" ? "carousel" : "text";

  return {
    id: String(a?.id || genId("auto")),
    name,
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

  // 본인(또는 관리자)만 자기 자동화를 보고 고칠 수 있다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  // 자동화 편집 직후 댓글이 달려도 웹훅이 이전 문구를 읽지 않도록 최신 설정을 보장한다.
  const store = getStore({ name: "dm-automation", consistency: "strong" });
  const key = `dm_${username}`;

  if (req.method === "GET") {
    const data = ((await store.get(key, { type: "json" })) as DmSettings) || DEFAULT_SETTINGS;
    const { accessToken, ...safe } = data;
    // 발송 로그(dm-automation-log)는 화면에서 더 이상 보여주지 않으므로 응답에 싣지
    // 않는다. 장애 조사용으로 블롭에는 계속 최근 50건이 쌓인다.
    return Response.json({
      ...DEFAULT_SETTINGS,
      ...safe,
      automations: Array.isArray(data.automations) ? data.automations : [],
      connected: Boolean(accessToken) && Boolean(data.igUserId || data.igAccountId),
      hasAccessToken: Boolean(accessToken),
      // 디엠 자동화는 프로 플랜 전용이다. 화면에서 업그레이드 안내를 띄울 수 있게 함께 내려준다.
      entitled: await dmAutomationAllowed(username),
      requiredTier: DM_AUTOMATION_TIER,
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
        // 재연동 시 웹훅 구독을 다시 걸도록 플래그도 비운다.
        webhookSubscribedAt: undefined,
        automations: Array.isArray(existing.automations) ? existing.automations : [],
        rules: Array.isArray(existing.rules) ? existing.rules : [],
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(key, next);
      // 웹훅 역인덱스(ig_<계정ID> → 사용자명)도 함께 비운다. 남겨두면 연동을 끊은 뒤에도
      // 이벤트가 들어올 때마다 설정을 읽어보는 헛일이 계속된다.
      const staleIgId = existing.igUserId || existing.igAccountId;
      if (staleIgId) {
        try {
          await getStore({ name: "dm-automation-index", consistency: "strong" }).delete(`ig_${staleIgId}`);
        } catch (e) {
          console.warn("[dm-automation] index cleanup failed:", (e as Error)?.message);
        }
      }
      return Response.json({ success: true, connected: false });
    }

    // 자동화 저장/켜기는 프로 플랜에서만 가능하다. (연동 해제는 위에서 이미 처리 — 플랜과
    // 무관하게 언제든 계정을 끊을 수 있어야 한다.)
    if (!(await dmAutomationAllowed(username))) {
      return Response.json(
        {
          error: DM_AUTOMATION_REQUIRED_MESSAGE,
          code: "DM_AUTOMATION_PLAN_REQUIRED",
          requiredTier: DM_AUTOMATION_TIER,
        },
        { status: 403 },
      );
    }

    let automations: DmAutomationItem[];
    try {
      automations = Array.isArray(body.automations)
        ? body.automations.map(sanitizeAutomation)
        : Array.isArray(existing.automations)
        ? existing.automations
        : [];
    } catch (e) {
      if (e instanceof InvalidLinkError) {
        // 잘못된 링크는 발송 때 조용히 빠지므로, 저장 단계에서 되돌려준다.
        return Response.json(
          { error: e.message, code: "INVALID_BUTTON_URL" },
          { status: 400 },
        );
      }
      throw e;
    }

    const next: DmSettings = {
      ...DEFAULT_SETTINGS,
      ...existing,
      enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
      automations,
      // 구버전 rules 는 전달되면 갱신, 아니면 유지
      rules: Array.isArray(body.rules) ? body.rules : existing.rules || [],
      updatedAt: new Date().toISOString(),
    };

    await store.setJSON(key, next);

    // 이미 연동돼 있던 계정은 OAuth 콜백을 다시 거치지 않으므로, 자동화를 저장하는
    // 시점에 한 번 계정별 웹훅 구독을 채워준다. 구독이 없으면 댓글 이벤트가 도착하지
    // 않아 자동 DM·자동 답글이 트리거되지 않는다. 성공하면 시각을 기록해 매번
    // 호출하지 않는다.
    if (next.accessToken && !next.webhookSubscribedAt) {
      const sub = await subscribeInstagramWebhooks({
        accessToken: next.accessToken,
        tokenSource: next.tokenSource,
        igId: next.igUserId || next.igAccountId,
      });
      if (sub.ok) {
        next.webhookSubscribedAt = new Date().toISOString();
        await store.setJSON(key, next);
      } else {
        console.warn("[dm-automation] webhook subscribe failed:", sub.error);
      }
    }

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
