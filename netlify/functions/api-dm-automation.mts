import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { BlobWriteConflictError, mutateBlobJSON } from "./_shared/blob-write.mts";
import {
  DM_AUTOMATION_REQUIRED_MESSAGE,
  DM_AUTOMATION_TIER,
  dmAutomationAllowed,
} from "./_shared/dm-automation-access.mts";
import { normalizeLinkUrl } from "./_shared/instagram-dm.mts";
import { clearForeignDm, readForeignDm } from "./_shared/dm-foreign-dm.mts";
import { readDmLog } from "./_shared/dm-automation-log.mts";
import { subscribeInstagramWebhooks, WEBHOOK_FIELDS } from "./_shared/instagram-webhook-subscribe.mts";
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
 *
 * 저장은 항상 "읽고 → 고치고 → 조건부로 쓰기"(mutateBlobJSON)로 한다. 예전처럼
 * 문서 전체를 그대로 덮어쓰면, 저장 요청 두 건이 겹치거나 응답 순서가 뒤바뀔 때
 * 늦게 도착한 옛 스냅샷이 방금 고친 메시지를 되돌려 놓는다. 화면에는 새 문구가
 * 남아 있으니 사용자는 "설정은 새 메시지인데 DM 은 예전 문구로 나간다"를 겪는다.
 * 그래서 편집 화면은 바뀐 자동화 한 건만(upsertAutomation) 보내고, 서버가 최신
 * 목록에 합친다.
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
  /**
   * 이 자동화의 내용이 마지막으로 바뀐 시각.
   *
   * 발송기(instagram-webhook)가 조건이 겹치는 자동화 중 하나를 골라야 할 때
   * "가장 최근에 설정한 것"을 우선하는 기준으로 쓴다.
   */
  updatedAt?: string;
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
  /** 마지막으로 구독을 건 필드 목록. 목록이 바뀌면 한 번 더 구독한다. */
  webhookFields?: string;
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

/** 설정 문서를 보관하는 블롭 스토어 이름. 발송기(instagram-webhook)와 같아야 한다. */
const STORE_NAME = "dm-automation";

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
    updatedAt: a?.updatedAt ? String(a.updatedAt) : undefined,
  };
}

/**
 * 내용 비교용 지문. 저장 시점에 붙는 시각 필드는 제외한다 — 같은 내용을 다시
 * 저장했다는 이유로 "최근에 설정한 자동화"가 뒤바뀌면 안 된다.
 */
function contentSignature(a: DmAutomationItem): string {
  const { updatedAt: _u, createdAt: _c, ...rest } = a;
  return JSON.stringify(rest);
}

/** 내용이 실제로 바뀐 자동화에만 변경 시각을 새로 찍는다. */
function stampUpdatedAt(
  next: DmAutomationItem,
  prev: DmAutomationItem | undefined,
  now: string,
): DmAutomationItem {
  if (prev && contentSignature(prev) === contentSignature(next)) {
    return { ...next, updatedAt: prev.updatedAt || prev.createdAt };
  }
  return { ...next, updatedAt: now };
}

/**
 * 요청이 들고 온 자동화 한 건.
 *
 * `enabled` 를 명시했는지 따로 기억한다. sanitizeAutomation 은 값이 없으면 켜짐으로
 * 보는데(새로 만드는 자동화의 기본값), 그 규칙을 수정 요청에도 그대로 적용하면
 * 필드를 싣지 않은 요청 한 번이 꺼 둔 자동화를 되살린다. 저장돼 있던 상태를 그대로
 * 두는 쪽이 안전하다 — 켜는 건 사용자가 스위치를 눌렀을 때만 일어나야 한다.
 */
interface IncomingAutomation {
  item: DmAutomationItem;
  enabledExplicit: boolean;
}

function readIncoming(a: any): IncomingAutomation {
  return { item: sanitizeAutomation(a), enabledExplicit: typeof a?.enabled === "boolean" };
}

/** 요청이 켜짐/꺼짐을 말하지 않았으면 저장본의 값을 유지한다. */
function resolveEnabled(
  incoming: IncomingAutomation,
  prev: DmAutomationItem | undefined,
): DmAutomationItem {
  if (incoming.enabledExplicit || !prev) return incoming.item;
  return { ...incoming.item, enabled: prev.enabled };
}

/** 저장된 목록에 자동화 한 건을 끼워 넣거나 갈아끼운다. */
function upsertOne(
  existing: DmAutomationItem[],
  incoming: IncomingAutomation,
  now: string,
): DmAutomationItem[] {
  const prev = existing.find((a) => a.id === incoming.item.id);
  const stamped = stampUpdatedAt(resolveEnabled(incoming, prev), prev, now);
  return prev
    ? existing.map((a) => (a.id === incoming.item.id ? stamped : a))
    : [...existing, stamped];
}

/** 목록 전체를 갈아끼운다(구버전 클라이언트 호환). 변경된 항목만 시각을 새로 찍는다. */
function replaceAll(
  existing: DmAutomationItem[],
  incoming: IncomingAutomation[],
  now: string,
): DmAutomationItem[] {
  const prevById = new Map(existing.map((a) => [a.id, a]));
  return incoming.map((entry) => {
    const prev = prevById.get(entry.item.id);
    return stampUpdatedAt(resolveEnabled(entry, prev), prev, now);
  });
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
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const key = `dm_${username}`;

  if (req.method === "GET") {
    const data = ((await store.get(key, { type: "json" })) as DmSettings) || DEFAULT_SETTINGS;
    const { accessToken, ...safe } = data;
    /**
     * 이 앱이 실제로 보낸 기록을 함께 내려준다.
     *
     * "설정한 문구가 아닌 예전 메시지가 도착한다"는 신고는 화면에 근거가 없으면
     * 끝없이 반복된다. 발송 기록은 블롭에 계속 쌓이고 있었지만 어디에서도 읽지
     * 않아, 이 앱이 무엇을 보냈는지 확인할 방법이 아예 없었다. 최근 기록을 함께
     * 내려주면 "우리가 보낸 것" 과 "밖에서 나간 것" 을 화면에서 구분할 수 있다.
     */
    const recentSends = await readDmLog(username, 20).catch((e) => {
      console.warn("[dm-automation] log read failed:", (e as Error)?.message);
      return [];
    });
    return Response.json({
      ...DEFAULT_SETTINGS,
      ...safe,
      automations: Array.isArray(data.automations) ? data.automations : [],
      connected: Boolean(accessToken) && Boolean(data.igUserId || data.igAccountId),
      hasAccessToken: Boolean(accessToken),
      recentSends,
      /**
       * 발신 에코(`message_echoes`) 구독 여부. 구독돼 있지 않으면 이 앱을 거치지
       * 않고 나간 자동 DM 을 감지할 수 없으므로, 화면에서 그 한계를 알려준다.
       */
      echoSubscribed: String(data.webhookFields || "").includes("message_echoes"),
      // 이 앱이 보내지 않은 자동 DM(인스타그램 자체 자동 메시지·다른 자동화 서비스)이
      // 감지됐다면 함께 내려준다. 화면에서 "왜 설정과 다른 문구가 오는지" 안내한다.
      externalDm: await readForeignDm(username),
      // 디엠 자동화는 프로 플랜 전용이다. 화면에서 업그레이드 안내를 띄울 수 있게 함께 내려준다.
      entitled: await dmAutomationAllowed(username),
      requiredTier: DM_AUTOMATION_TIER,
    });
  }

  if (req.method === "POST") {
    const body = (await req.json()) as any;
    const now = new Date().toISOString();

    // 연동 해제
    if (body?.action === "disconnect") {
      let staleIgId = "";
      await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) => {
        const existing = { ...DEFAULT_SETTINGS, ...(current || {}) };
        staleIgId = existing.igUserId || existing.igAccountId || "";
        return {
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
          updatedAt: now,
        };
      });
      // 웹훅 역인덱스(ig_<계정ID> → 사용자명)도 함께 비운다. 남겨두면 연동을 끊은 뒤에도
      // 이벤트가 들어올 때마다 설정을 읽어보는 헛일이 계속된다.
      if (staleIgId) {
        try {
          await getStore({ name: "dm-automation-index", consistency: "strong" }).delete(`ig_${staleIgId}`);
        } catch (e) {
          console.warn("[dm-automation] index cleanup failed:", (e as Error)?.message);
        }
      }
      return Response.json({ success: true, connected: false });
    }

    // 외부 자동 DM 안내 확인 — 사용자가 안내를 읽고 닫으면 기록을 지운다.
    // (연동 해제와 마찬가지로 플랜과 무관하게 처리한다.)
    if (body?.action === "dismissExternalDm") {
      await clearForeignDm(username);
      return Response.json({ success: true, externalDm: null });
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

    /**
     * 요청 종류를 먼저 해석한다.
     *
     * - upsertAutomation : 편집 화면이 방금 고친 자동화 한 건만 보낸다(권장 경로).
     *   목록 전체를 보내지 않으므로, 다른 자동화를 동시에 고쳐도 서로의 변경을
     *   되돌리지 않는다.
     * - deleteAutomation : 자동화 한 건 삭제.
     * - automations      : 목록 전체 교체(구버전 클라이언트 호환).
     * - 그 외            : enabled/rules 같은 설정만 갱신.
     *
     * 링크 정규화는 저장 전에 끝내야 한다. 잘못된 링크는 400 으로 되돌려주고
     * 문서는 손대지 않는다.
     */
    let op:
      | { kind: "upsert"; incoming: IncomingAutomation }
      | { kind: "delete"; id: string }
      | { kind: "replace"; incoming: IncomingAutomation[] }
      | { kind: "settings" };
    try {
      if (body?.action === "upsertAutomation" || body?.automation) {
        const raw = body?.automation ?? body?.item;
        if (!raw || typeof raw !== "object") {
          return Response.json({ error: "automation 이 필요합니다." }, { status: 400 });
        }
        op = { kind: "upsert", incoming: readIncoming(raw) };
      } else if (body?.action === "deleteAutomation") {
        const id = String(body?.id || body?.automationId || "").trim();
        if (!id) return Response.json({ error: "삭제할 자동화 id 가 필요합니다." }, { status: 400 });
        op = { kind: "delete", id };
      } else if (Array.isArray(body?.automations)) {
        op = { kind: "replace", incoming: body.automations.map(readIncoming) };
      } else {
        op = { kind: "settings" };
      }
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

    let saved: DmSettings | null;
    /**
     * 요청이 들고 온 자동화가 저장본보다 오래된 버전이면 쓰지 않고 되돌려준다.
     *
     * (다른 탭·다른 기기에서 먼저 고친 경우다. 그대로 쓰면 그쪽 수정이 사라지고,
     * 사용자는 "설정한 문구가 아닌 예전 문구가 나간다"를 다시 겪는다.)
     */
    let staleWrite = false;
    try {
      saved = await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) => {
        const existing = { ...DEFAULT_SETTINGS, ...(current || {}) };
        const stored: DmAutomationItem[] = Array.isArray(existing.automations)
          ? existing.automations
          : [];

        if (op.kind === "upsert") {
          const prev = stored.find((a) => a.id === op.incoming.item.id);
          const baseAt = Date.parse(op.incoming.item.updatedAt || "");
          const storedAt = Date.parse(prev?.updatedAt || "");
          if (prev && !Number.isNaN(baseAt) && !Number.isNaN(storedAt) && baseAt < storedAt) {
            staleWrite = true;
            return null;
          }
        }

        let automations = stored;
        if (op.kind === "upsert") automations = upsertOne(stored, op.incoming, now);
        else if (op.kind === "delete") automations = stored.filter((a) => a.id !== op.id);
        else if (op.kind === "replace") automations = replaceAll(stored, op.incoming, now);

        /**
         * 전체 스위치는 "자동 발송" 토글이 보낸 요청에서만 켠다.
         *
         * 예전 화면(그리고 브라우저에 캐시된 옛 번들)은 자동화를 저장하면서
         * `enabled: true` 를 함께 실어 보냈다. 그래서 자동 발송을 일부러 꺼 둔
         * 사람이 문구를 다듬거나 자동화 하나를 켜기만 해도 전체 스위치가 조용히
         * 다시 켜졌고, 다음 댓글에 예전에 설정해 둔 메시지가 나갔다. 끄는 요청은
         * 언제나 받아들이고, 켜는 요청은 자동화 저장에 곁들여 온 것이면 무시한다.
         */
        const wanted = typeof body.enabled === "boolean" ? body.enabled : null;
        const enabled =
          wanted === null || (wanted === true && op.kind !== "settings")
            ? existing.enabled
            : wanted;

        return {
          ...existing,
          enabled,
          automations,
          // 구버전 rules 는 전달되면 갱신, 아니면 유지
          rules: Array.isArray(body.rules) ? body.rules : existing.rules || [],
          updatedAt: now,
        };
      });
    } catch (e) {
      if (e instanceof BlobWriteConflictError) {
        // 같은 계정에서 저장이 계속 겹치는 아주 드문 경우. 아무것도 쓰지 않았으니
        // 화면에서 다시 시도하게 안내한다(조용히 성공으로 넘기면 예전 설정이 남는다).
        console.warn("[dm-automation] save conflict:", (e as Error)?.message);
        return Response.json(
          {
            error: "다른 저장이 동시에 진행돼 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            code: "SAVE_CONFLICT",
          },
          { status: 409 },
        );
      }
      throw e;
    }

    const next: DmSettings = { ...DEFAULT_SETTINGS, ...(saved || {}) };

    if (staleWrite) {
      // 저장본이 더 최신이다. 화면이 최신 목록으로 맞출 수 있게 함께 돌려준다.
      return Response.json(
        {
          error:
            "이 자동화가 다른 곳(다른 탭·기기)에서 먼저 수정됐습니다. 최신 설정을 불러왔으니 확인한 뒤 다시 저장해 주세요.",
          code: "STALE_AUTOMATION",
          automations: Array.isArray(next.automations) ? next.automations : [],
        },
        { status: 409 },
      );
    }

    // 이미 연동돼 있던 계정은 OAuth 콜백을 다시 거치지 않으므로, 자동화를 저장하는
    // 시점에 한 번 계정별 웹훅 구독을 채워준다. 구독이 없으면 댓글 이벤트가 도착하지
    // 않아 자동 DM·자동 답글이 트리거되지 않는다. 성공하면 시각을 기록해 매번
    // 호출하지 않는다.
    //
    // 구독 필드 목록이 바뀌었을 때도 한 번 더 건다. 예전에 연동한 계정은 발신 메시지
    // 에코를 구독하지 않은 상태라, 이 앱을 거치지 않고 나간 자동 DM 을 감지하지 못한다.
    if (next.accessToken && (!next.webhookSubscribedAt || next.webhookFields !== WEBHOOK_FIELDS)) {
      const sub = await subscribeInstagramWebhooks({
        accessToken: next.accessToken,
        tokenSource: next.tokenSource,
        igId: next.igUserId || next.igAccountId,
      });
      if (sub.ok) {
        const subscribedAt = new Date().toISOString();
        const achieved = sub.fields || WEBHOOK_FIELDS;
        next.webhookSubscribedAt = subscribedAt;
        /**
         * 실제로 구독에 성공한 목록을 기록한다.
         *
         * 예전에는 시도한 목록(WEBHOOK_FIELDS)을 그대로 찍었다. 그래서 에코 필드가
         * 거절돼 `comments,messages` 로 내려앉은 계정도 "최신 목록으로 구독 완료"로
         * 표시됐고, 다시 구독을 걸어보는 일이 영영 없었다. 발신 에코를 못 받으면
         * 이 앱을 거치지 않고 나간 자동 DM 을 감지할 수 없어, 사용자는 예전 문구가
         * 어디서 오는지 확인할 방법이 없다.
         */
        next.webhookFields = achieved;
        await mutateBlobJSON<DmSettings>(STORE_NAME, key, (current) =>
          current
            ? { ...current, webhookSubscribedAt: subscribedAt, webhookFields: achieved }
            : null,
        ).catch((e) => console.warn("[dm-automation] webhook flag save failed:", (e as Error)?.message));
      } else {
        console.warn("[dm-automation] webhook subscribe failed:", sub.error);
      }
    }

    // 저장된 목록을 그대로 돌려준다. 화면이 이 응답으로 상태를 맞추면, 실제로
    // 발송에 쓰일 내용과 화면에 보이는 내용이 어긋나지 않는다.
    return Response.json({
      success: true,
      connected: Boolean(next.accessToken) && Boolean(next.igUserId || next.igAccountId),
      enabled: next.enabled,
      automations: Array.isArray(next.automations) ? next.automations : [],
      updatedAt: next.updatedAt,
    });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/dm-automation/:username",
};
