import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { buildDmMessages, sendDmMessages } from "./_shared/instagram-dm.mts";
import type { DmButton, DmCard } from "./_shared/instagram-dm.mts";
import {
  DM_AUTOMATION_REQUIRED_MESSAGE,
  dmAutomationAllowed,
} from "./_shared/dm-automation-access.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 인스타그램 DM 발송.
 * - 특정 수신자 IGSID 지정 발송 및 게시물(미디어) 댓글 작성자 일괄 DM 발송 지원.
 * - 게시물 지정 또는 자동화 규칙 지정 시, 해당 게시물들의 댓글을 수집하고
 *   작성자 중복 및 본인 계정 댓글을 제외한 모든 댓글 작성자에게 DM을 전송한다.
 */

const GRAPH_VERSION = "v21.0";

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

  const store = getStore("dm-automation");
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

  // 1) 특정 수신자 ID(recipientId)가 직접 전달된 경우 (단일 발송 레거시 지원)
  if (recipientId) {
    try {
      const result = await sendDmMessages({
        graphHost,
        graphVersion: GRAPH_VERSION,
        igId,
        accessToken: settings.accessToken,
        recipient: { id: recipientId },
        messages,
      });

      if (!result.ok) {
        await appendLog(username, {
          status: "failed",
          recipientId,
          ruleId: body.ruleId,
          error: result.error,
        });
        return Response.json(
          { success: false, connected: true, message: result.error },
          { status: 200 },
        );
      }

      await appendLog(username, {
        status: "sent",
        recipientId,
        ruleId: body.ruleId,
        messageId: result.messageId,
        test: Boolean(body.test),
      });

      return Response.json({ success: true, connected: true, count: 1, messageId: result.messageId });
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
        { headers: { Authorization: `Bearer ${settings.accessToken}` } }
      );
      const mediaData = (await mediaRes.json().catch(() => ({}))) as any;
      if (Array.isArray(mediaData?.data)) {
        targetMediaIds = mediaData.data.map((m: any) => String(m.id)).filter(Boolean);
      }
    } catch (e: any) {
      console.warn("[send-instagram-dm] 최근 게시물 조회 실패:", e?.message);
    }
  }

  if (targetMediaIds.length === 0) {
    return Response.json({
      success: false,
      connected: true,
      message: "댓글을 불러올 인스타그램 게시물을 찾을 수 없습니다.",
    });
  }

  interface CommenterItem {
    commentId: string;
    fromId?: string;
    username?: string;
  }

  const commentersMap = new Map<string, CommenterItem>();

  for (const mId of targetMediaIds) {
    try {
      const commentsUrl = `https://${graphHost}/${GRAPH_VERSION}/${encodeURIComponent(mId)}/comments?fields=id,text,from,username,timestamp&limit=100`;
      const cRes = await fetch(commentsUrl, {
        headers: { Authorization: `Bearer ${settings.accessToken}` },
      });
      const cData = (await cRes.json().catch(() => ({}))) as any;
      const commentsList = Array.isArray(cData?.data) ? cData.data : [];

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

        const key = fromId || commenterUsername || commentId;
        if (!commentersMap.has(key)) {
          commentersMap.set(key, {
            commentId,
            fromId: fromId || undefined,
            username: commenterUsername || undefined,
          });
        }
      }
    } catch (e: any) {
      console.warn(`[send-instagram-dm] 게시물(${mId}) 댓글 조회 실패:`, e?.message);
    }
  }

  const targetCommenters = Array.from(commentersMap.values());

  if (targetCommenters.length === 0) {
    await appendLog(username, {
      status: "skipped",
      reason: "no_commenters",
      targetMediaIds,
      ruleId: body.ruleId,
    });
    return Response.json({
      success: true,
      connected: true,
      count: 0,
      total: 0,
      message: "선택한 게시물에 댓글을 남긴 사용자가 없습니다.",
    });
  }

  let successCount = 0;
  let failCount = 0;

  for (const commenter of targetCommenters) {
    // 1차 시도: 댓글 ID 기반 비공개 답장
    let result = await sendDmMessages({
      graphHost,
      graphVersion: GRAPH_VERSION,
      igId,
      accessToken: settings.accessToken,
      recipient: { comment_id: commenter.commentId },
      messages,
    });

    // 2차 시도: IGSID 기반 직접 메시지
    if (!result.ok && commenter.fromId) {
      result = await sendDmMessages({
        graphHost,
        graphVersion: GRAPH_VERSION,
        igId,
        accessToken: settings.accessToken,
        recipient: { id: commenter.fromId },
        messages,
      });
    }

    if (result.ok) {
      successCount++;
    } else {
      failCount++;
      console.warn(
        `[send-instagram-dm] 댓글 작성자(${commenter.username || commenter.commentId}) 발송 실패:`,
        result.error
      );
    }
  }

  await appendLog(username, {
    status: successCount > 0 ? "sent" : "failed",
    ruleId: body.ruleId,
    targetMediaIds,
    sentCount: successCount,
    failCount,
    totalCommenters: targetCommenters.length,
    test: Boolean(body.test),
  });

  return Response.json({
    success: successCount > 0,
    connected: true,
    count: successCount,
    total: targetCommenters.length,
    message:
      successCount > 0
        ? `댓글 작성자 ${targetCommenters.length}명 중 ${successCount}명에게 DM이 성공적으로 발송되었습니다!`
        : "댓글 작성자에게 DM 발송을 실패했습니다.",
  });
};

export const config: Config = {
  path: "/api/send-instagram-dm",
};
