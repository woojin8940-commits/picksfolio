import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { buildDmMessages, describeDmError, sendDmMessages } from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard, DmErrorKind } from "./_shared/instagram-dm.mts";
import {
  DM_AUTOMATION_REQUIRED_MESSAGE,
  dmAutomationAllowed,
} from "./_shared/dm-automation-access.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";
import {
  claimIfNew,
  contentHashOf,
  dmContentKey,
  privateReplyKey,
  release,
} from "./_shared/dm-send-registry.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 인스타그램 DM 발송.
 * - 특정 수신자 IGSID 지정 발송 및 게시물(미디어) 댓글 작성자 일괄 DM 발송 지원.
 * - 게시물 지정 또는 자동화 규칙 지정 시, 해당 게시물들의 댓글을 수집하고
 *   작성자 중복 및 본인 계정 댓글을 제외한 모든 댓글 작성자에게 DM을 전송한다.
 *
 * 일괄 발송에서 지키는 세 가지.
 *
 * 1) 시간 예산 — 동기 함수는 실행 시간 한도가 있다. 댓글 작성자가 많으면 한도를
 *    넘겨 502/504 로 끊기는데, 그때 브라우저는 응답을 못 받아 "발송 실패"를
 *    띄우면서도 실제로는 수십 명에게 DM 이 이미 나가 있다. 그래서 예산 안에서
 *    처리할 만큼만 보내고, 남은 대상 수를 응답에 담아 이어서 보낼 수 있게 한다.
 *
 * 2) 중복 방지 — 누구에게 무엇을 보냈는지 발송 대장(dm-send-registry)에 기록한다.
 *    버튼을 다시 눌러도 이미 같은 내용을 받은 사람에게는 다시 보내지 않는다.
 *
 * 3) 실패 구분 — 인스타그램은 댓글 1건당 비공개 답장 1회, 그리고 마지막 상호작용
 *    이후 24시간까지만 DM 을 허용한다. 이 제한에 걸린 대상은 "이미 발송됨"으로
 *    세고 실패로 표시하지 않는다.
 */

const GRAPH_VERSION = "v21.0";

/**
 * 발송에 쓸 시간 예산. 동기 함수 한도(60초)보다 넉넉히 앞서 끝내야 응답·로그를
 * 남길 여유가 있다.
 */
const SEND_BUDGET_MS = 38_000;
/** 댓글 수집 단계에 쓸 시간 예산. */
const COLLECT_BUDGET_MS = 12_000;
/** 한 번에 댓글을 훑을 게시물 최대 개수. */
const MAX_MEDIA = 20;
/**
 * 발송 대상으로 삼을 댓글의 나이 한도.
 *
 * 인스타그램은 마지막 상호작용 이후 24시간까지만 DM 을 허용한다. 그보다 오래된
 * 댓글은 어차피 거부되므로, 시도해서 실패로 세는 대신 대상에서 아예 제외한다.
 * 그러면 시간 예산이 실제로 보낼 수 있는 사람에게만 쓰인다.
 */
const COMMENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 동시 발송 수. 인스타그램 발송 한도를 자극하지 않는 선에서 시간을 벌어준다. */
const SEND_CONCURRENCY = 4;

interface DmSettings {
  enabled: boolean;
  igAccountId: string;
  igUserId?: string;
  igUsername?: string;
  accessToken?: string;
  tokenSource?: string;
  automations?: any[];
}

interface SendBody {
  username: string;
  recipientId?: string;
  mediaId?: string;
  mediaIds?: string[];
  message: string;
  buttons?: DmButton[];
  messageType?: "text" | "carousel";
  cards?: DmCard[];
  ruleId?: string;
  test?: boolean;
}

interface CommenterItem {
  commentId: string;
  fromId?: string;
  username?: string;
  /** 대상으로 고른 댓글이 달린 시각(ms). */
  commentedAt: number;
}

/**
 * 인스타그램 댓글 타임스탬프를 ms 로 바꾼다.
 *
 * 인스타그램은 "2026-08-10T12:00:00+0000" 처럼 콜론 없는 오프셋을 주므로 표준
 * 형태로 고쳐서 넘긴다. 해석할 수 없으면 null — 나이를 확인할 수 없는 댓글은
 * 24시간 창 안이라고 단정하지 않는다.
 */
function parseCommentTime(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(ms) ? null : ms;
}

/** 대상 한 명에 대한 처리 결과. */
type Outcome =
  | { kind: "sent"; partial: boolean }
  | { kind: "already"; reason: string }
  | { kind: "failed"; error: string; errorKind: DmErrorKind };

async function appendLog(username: string, entry: Record<string, unknown>) {
  await appendDmLog(username, entry, "send-instagram-dm");
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username = (body.username || "").toLowerCase();
  const recipientId = (body.recipientId || "").trim();
  const message = (body.message || "").trim();

  if (!username || !message) {
    return Response.json({ error: "username 과 message 는 필수입니다." }, { status: 400 });
  }

  // 본문의 username 을 그대로 믿으면 남의 계정으로 DM 을 쏠 수 있다. 토큰으로 확인한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore({ name: "dm-automation", consistency: "strong" });
  const settings = (await store.get(`dm_${username}`, { type: "json" })) as DmSettings | null;

  // 디엠 자동화(수동 발송 포함)는 프로 플랜 전용이다.
  if (!(await dmAutomationAllowed(username))) {
    await appendLog(username, {
      status: "skipped",
      reason: "plan_required",
      recipientId,
      ruleId: body.ruleId,
    });
    return Response.json(
      {
        success: false,
        error: DM_AUTOMATION_REQUIRED_MESSAGE,
        code: "DM_AUTOMATION_PLAN_REQUIRED",
      },
      { status: 403 },
    );
  }

  const igId = settings?.igUserId || settings?.igAccountId;
  if (!settings || !igId || !settings.accessToken) {
    await appendLog(username, {
      status: "skipped",
      reason: "not_connected",
      recipientId,
      ruleId: body.ruleId,
    });
    return Response.json(
      {
        success: false,
        connected: false,
        message:
          "인스타그램 계정이 아직 연동되지 않았습니다. DM 자동화 화면에서 계정을 연동한 뒤 다시 시도하세요.",
      },
      { status: 200 },
    );
  }

  const accessToken = settings.accessToken;
  // 아래 발송 루프는 중첩 함수 안에서 돌기 때문에, 위 가드로 확정된 값을 명시적인
  // 문자열 상수로 다시 잡아둔다.
  const senderIgId: string = igId;

  // Graph API Host 선택
  const graphHost =
    settings.tokenSource === "instagram_login"
      ? "graph.instagram.com"
      : "graph.facebook.com";

  // 메시지 구조화 (텍스트 / 링크버튼 카드 / 캐러셀)
  const messages = buildDmMessages({
    messageType: body.messageType,
    message,
    buttons: body.buttons,
    cards: body.cards,
  });

  if (messages.length === 0) {
    return Response.json(
      { success: false, connected: true, message: "보낼 DM 내용이 없습니다." },
      { status: 200 },
    );
  }

  /** 같은 내용의 중복 발송을 구분하기 위한 내용 지문. */
  const contentHash = contentHashOf(messages);

  // 1) 특정 수신자 ID(recipientId)가 직접 전달된 경우 (단일 발송 레거시 지원)
  if (recipientId) {
    try {
      const result = await sendDmMessages({
        graphHost,
        graphVersion: GRAPH_VERSION,
        igId,
        accessToken,
        recipient: { id: recipientId },
        messages,
      });

      if (!result.ok && !result.partial) {
        const reason = describeDmError(result.errorKind || "other", result.error);
        await appendLog(username, {
          status: "failed",
          recipientId,
          ruleId: body.ruleId,
          error: result.error,
          errorKind: result.errorKind,
        });
        return Response.json(
          { success: false, connected: true, message: reason, errorKind: result.errorKind },
          { status: 200 },
        );
      }

      await appendLog(username, {
        status: "sent",
        partial: result.partial,
        recipientId,
        ruleId: body.ruleId,
        messageId: result.messageId,
        error: result.partial ? result.error : undefined,
        test: Boolean(body.test),
      });

      return Response.json({
        success: true,
        connected: true,
        count: 1,
        messageId: result.messageId,
        partial: result.partial,
        message: result.partial
          ? `DM 본문은 발송됐지만 링크 버튼 카드가 전송되지 않았습니다. (${result.error})`
          : undefined,
      });
    } catch (e: any) {
      const errMsg = e?.message || "발송 중 알 수 없는 오류가 발생했습니다.";
      await appendLog(username, { status: "failed", recipientId, ruleId: body.ruleId, error: errMsg });
      return Response.json({ success: false, connected: true, message: errMsg }, { status: 200 });
    }
  }

  // 2) 수신자 ID가 없는 경우: 댓글 단 사람 모두에게 발송
  let targetMediaIds: string[] = [];

  if (Array.isArray(body.mediaIds) && body.mediaIds.length > 0) {
    targetMediaIds = body.mediaIds.map((id) => String(id).trim()).filter(Boolean);
  } else if (body.mediaId && body.mediaId.trim()) {
    targetMediaIds = [body.mediaId.trim()];
  } else if (body.ruleId) {
    const rules = Array.isArray(settings.automations) ? settings.automations : [];
    const rule = rules.find((r: any) => r.id === body.ruleId);
    if (rule && rule.mediaScope === "selected" && Array.isArray(rule.mediaIds) && rule.mediaIds.length > 0) {
      targetMediaIds = rule.mediaIds;
    }
  }

  // 지정된 미디어가 없으면 최근 게시물목록 조회
  if (targetMediaIds.length === 0) {
    try {
      const mediaRes = await fetch(
        `https://${graphHost}/${GRAPH_VERSION}/${encodeURIComponent(igId)}/media?fields=id&limit=10`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const mediaData = (await mediaRes.json().catch(() => ({}))) as any;
      if (Array.isArray(mediaData?.data)) {
        targetMediaIds = mediaData.data.map((m: any) => String(m.id)).filter(Boolean);
      }
    } catch (e: any) {
      console.warn("[send-instagram-dm] 최근 게시물 조회 실패:", e?.message);
    }
  }

  targetMediaIds = targetMediaIds.slice(0, MAX_MEDIA);

  if (targetMediaIds.length === 0) {
    return Response.json({
      success: false,
      connected: true,
      message: "댓글을 불러올 인스타그램 게시물을 찾을 수 없습니다.",
    });
  }

  // 댓글 수집은 게시물마다 독립적이므로 병렬로 훑는다. 순차로 훑으면 게시물 수가
  // 늘어날 때마다 그만큼 발송에 쓸 시간이 사라진다.
  const collectDeadline = Date.now() + COLLECT_BUDGET_MS;
  const commentLists = await Promise.all(
    targetMediaIds.map(async (mId) => {
      if (Date.now() > collectDeadline) return [] as any[];
      try {
        const commentsUrl = `https://${graphHost}/${GRAPH_VERSION}/${encodeURIComponent(mId)}/comments?fields=id,text,from,username,timestamp&limit=100`;
        const cRes = await fetch(commentsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const cData = (await cRes.json().catch(() => ({}))) as any;
        return Array.isArray(cData?.data) ? cData.data : [];
      } catch (e: any) {
        console.warn(`[send-instagram-dm] 게시물(${mId}) 댓글 조회 실패:`, e?.message);
        return [] as any[];
      }
    }),
  );

  const commentersMap = new Map<string, CommenterItem>();
  const windowStart = Date.now() - COMMENT_WINDOW_MS;
  /** 24시간 창을 벗어나 대상에서 빠진 댓글 수. */
  let staleCount = 0;

  for (const commentsList of commentLists) {
    for (const c of commentsList) {
      const commentId = String(c?.id || "");
      const fromId = String(c?.from?.id || "");
      const commenterUsername = String(c?.from?.username || c?.username || "");

      // 본인 계정의 댓글 및 빈 ID 제외
      if (!commentId) continue;
      if (
        fromId === igId ||
        (commenterUsername && settings.igUsername && commenterUsername.toLowerCase() === settings.igUsername.toLowerCase())
      ) {
        continue;
      }

      // 24시간 이내에 달린 댓글만 발송 대상이다.
      const commentedAt = parseCommentTime(c?.timestamp);
      if (commentedAt === null || commentedAt < windowStart) {
        staleCount += 1;
        continue;
      }

      const key = fromId || commenterUsername || commentId;
      const prev = commentersMap.get(key);
      // 같은 사람이 여러 번 달았으면 가장 최근 댓글을 쓴다. 비공개 답장 창이
      // 마지막 상호작용 기준이라 최신 댓글일수록 발송 가능성이 높다.
      if (!prev || commentedAt > prev.commentedAt) {
        commentersMap.set(key, {
          commentId,
          fromId: fromId || undefined,
          username: commenterUsername || undefined,
          commentedAt,
        });
      }
    }
  }

  const targetCommenters = Array.from(commentersMap.values());

  if (targetCommenters.length === 0) {
    await appendLog(username, {
      status: "skipped",
      reason: "no_recent_commenters",
      staleCount,
      targetMediaIds,
      ruleId: body.ruleId,
    });
    return Response.json({
      success: true,
      connected: true,
      count: 0,
      total: 0,
      message: "최근 24시간 안에 댓글을 남긴 사용자가 없습니다.",
    });
  }

  /**
   * 대상 한 명에게 보낸다.
   *
   * 순서가 중요하다. 먼저 "이 내용을 이 댓글에 이미 보냈는지"를 선점 방식으로
   * 확인해 중복을 막고, 비공개 답장 → IGSID 직접 발송 순으로 시도한다. 끝까지
   * 아무것도 못 보냈으면 선점을 되돌려 다음 시도를 막지 않는다.
   */
  async function sendToCommenter(c: CommenterItem): Promise<Outcome> {
    const contentKey = dmContentKey(c.commentId, contentHash);
    const replyKey = privateReplyKey(c.commentId);

    try {
      // 같은 내용을 이미 보낸 대상은 건너뛴다.
      if (!(await claimIfNew(username, contentKey))) {
        return { kind: "already", reason: "이미 같은 내용의 DM을 받은 대상입니다." };
      }

      // 비공개 답장은 댓글 1건당 1회. 우리가 이미 썼다면 시도 자체를 하지 않는다.
      const replyAvailable = await claimIfNew(username, replyKey);
      let lastError = "";
      let lastKind: DmErrorKind = "other";

      if (replyAvailable) {
        const result = await sendDmMessages({
          graphHost,
          graphVersion: GRAPH_VERSION,
          igId: senderIgId,
          accessToken,
          recipient: { comment_id: c.commentId },
          // 메시지가 2건(본문 + 버튼 카드)인 설정은 두 번째부터 IGSID 로 보낸다.
          // 비공개 답장은 댓글당 1통만 허용되기 때문이다.
          followUpRecipient: c.fromId ? { id: c.fromId } : undefined,
          messages,
        });

        if (result.ok || result.partial) {
          // partial 은 본문이 이미 도착한 상태다. 실패로 다루면 재시도로 같은
          // 본문이 두 번 도착한다.
          return { kind: "sent", partial: result.partial };
        }

        lastError = result.error || "";
        lastKind = result.errorKind || "other";
        // 인스타그램이 "이미 답장했다"고 하면 기록은 유지한다(사실이므로).
        if (lastKind !== "already_sent") await release(username, replyKey);
      }

      // IGSID 기반 직접 발송. 비공개 답장을 못 쓰거나 실패한 경우의 유일한 경로다.
      if (c.fromId) {
        const direct = await sendDmMessages({
          graphHost,
          graphVersion: GRAPH_VERSION,
          igId: senderIgId,
          accessToken,
          recipient: { id: c.fromId },
          messages,
        });
        if (direct.ok || direct.partial) {
          return { kind: "sent", partial: direct.partial };
        }
        lastError = direct.error || lastError;
        lastKind = direct.errorKind || lastKind;
      }

      // 아무것도 못 보냈으므로 내용 기록을 지운다 — 나중에 다시 시도할 수 있어야 한다.
      await release(username, contentKey);

      // 우리가 이미 DM 을 보낸 댓글이고, 지금 막힌 이유가 인스타그램의 1회
      // 제한·24시간 창이라면 이건 새로운 실패가 아니다.
      if (lastKind === "already_sent" || (!replyAvailable && lastKind === "outside_window")) {
        return { kind: "already", reason: describeDmError(lastKind) };
      }

      return {
        kind: "failed",
        error: lastError || "인스타그램이 발송을 거부했습니다.",
        errorKind: lastKind,
      };
    } catch (e: any) {
      // 한 명에게서 난 예외로 나머지 발송이 통째로 중단되면 안 된다.
      await release(username, contentKey).catch(() => {});
      return {
        kind: "failed",
        error: e?.message || "발송 중 알 수 없는 오류가 발생했습니다.",
        errorKind: "other",
      };
    }
  }

  const sendDeadline = Date.now() + SEND_BUDGET_MS;
  const outcomes: Outcome[] = [];
  let cursor = 0;
  let stoppedForTime = false;

  async function worker() {
    while (true) {
      if (Date.now() >= sendDeadline) {
        stoppedForTime = true;
        return;
      }
      const index = cursor;
      if (index >= targetCommenters.length) return;
      cursor += 1;
      const outcome = await sendToCommenter(targetCommenters[index]);
      outcomes.push(outcome);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SEND_CONCURRENCY, targetCommenters.length) }, worker),
  );

  const successCount = outcomes.filter((o) => o.kind === "sent").length;
  const partialCount = outcomes.filter((o) => o.kind === "sent" && o.partial).length;
  const alreadyCount = outcomes.filter((o) => o.kind === "already").length;
  const failures = outcomes.filter((o) => o.kind === "failed") as Extract<Outcome, { kind: "failed" }>[];
  const failCount = failures.length;
  const remaining = Math.max(0, targetCommenters.length - outcomes.length);
  const failureReason = failCount > 0 ? describeDmError(failures[0].errorKind, failures[0].error) : undefined;

  // 보낸 게 하나라도 있거나, 못 보낸 이유가 "이미 받은 사람들"·"다음 차례"뿐이면
  // 실패가 아니다. 이걸 실패로 표시하면 도착한 DM 을 보면서 실패 안내를 읽는다.
  const success = successCount > 0 || (failCount === 0 && (alreadyCount > 0 || remaining > 0));

  await appendLog(username, {
    status: success ? "sent" : "failed",
    ruleId: body.ruleId,
    targetMediaIds,
    sentCount: successCount,
    partialCount,
    alreadyCount,
    failCount,
    remaining,
    totalCommenters: targetCommenters.length,
    staleCount,
    error: failureReason,
    timedOut: stoppedForTime,
    test: Boolean(body.test),
  });

  const parts: string[] = [];
  if (successCount > 0) {
    parts.push(`댓글 작성자 ${targetCommenters.length}명 중 ${successCount}명에게 DM을 발송했습니다.`);
  }
  if (partialCount > 0) {
    parts.push(`${partialCount}명은 본문만 도착하고 링크 버튼 카드는 전송되지 않았습니다.`);
  }
  if (alreadyCount > 0) {
    parts.push(`이미 같은 DM을 받은 ${alreadyCount}명은 중복 발송을 막기 위해 건너뛰었습니다.`);
  }
  if (failCount > 0) {
    parts.push(`${failCount}명은 발송하지 못했습니다. (${failureReason})`);
  }
  if (remaining > 0) {
    parts.push(
      `남은 ${remaining}명은 시간 제한으로 아직 보내지 못했습니다. 발송 버튼을 다시 누르면 이어서 발송합니다.`,
    );
  }
  if (parts.length === 0) {
    parts.push("발송할 새로운 대상이 없습니다.");
  }

  return Response.json({
    success,
    connected: true,
    count: successCount,
    partialCount,
    alreadyCount,
    failCount,
    remaining,
    total: targetCommenters.length,
    message: parts.join(" "),
  });
};

export const config: Config = {
  path: "/api/send-instagram-dm",
};
