import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";
import { getDmContact, withinDmWindow } from "./_shared/dm-contacts.mts";
import { claimJob, finishJob, listDueJobs, releaseJobClaim } from "./_shared/dm-schedule-store.mts";
import type { DmScheduledJob } from "./_shared/dm-schedule-store.mts";
import {
  buildCommentDmPlan,
  buildDirectDmPlan,
  describeDmError,
  postCommentReply,
  sendDmMessages,
} from "./_shared/instagram-dm.mts";
import type { DmContent } from "./_shared/instagram-dm.mts";
import { claimIfNew, contentHashOf, dmContentKey, noteSentText, privateReplyKey, publicReplyKey, release } from "./_shared/dm-send-registry.mts";
import { claimDueJobs, completeDmJob, enqueueScheduledJob, pauseDmAccount, retryDmJob } from "./_shared/dm-jobs.mts";
import type { DmJob } from "./_shared/dm-jobs.mts";
import { processWebhookPayload } from "./instagram-webhook.mts";

/**
 * 예약 DM 발송기(1분 주기).
 *
 * 대기열(`_shared/dm-schedule-store.mts`)에서 시간이 된 예약을 꺼내 보낸다. 예약을
 * 만드는 쪽은 api-dm-schedule 이다.
 *
 * 발송 직전에 조건을 **다시** 확인한다. 예약을 걸어 둔 뒤 상황이 바뀌었을 수 있기
 * 때문이다.
 *   - 계정 연동이 풀렸거나 자동 발송 스위치를 껐다.
 *   - 플랜이 만료됐다.
 *   - 상대가 마지막으로 보낸 메시지가 24시간을 넘겼다(인스타그램이 자유 형식 DM 을
 *     허용하지 않는 구간이다).
 * 어느 경우든 조용히 넘기지 않고 이유를 적어 실패로 남긴다 — 기록이 없으면
 * 사용자는 예약이 나간 줄 알고 있게 된다.
 */

const GRAPH_VERSION = "v21.0";

/**
 * 댓글 비공개 답장이 허용되는 기간.
 *
 * 댓글에서 걸린 예약(게시물별 설정에서 "예약 발송"을 고른 경우)은 대화창이 열려
 * 있지 않아도 `recipient: { comment_id }` 로 나갈 수 있고, 이 창은 24시간이 아니라
 * **댓글이 달린 뒤 7일**이다. 그래서 이 예약에는 24시간 검사를 적용하면 안 된다 —
 * 적용하면 처음 말을 건 사람에게 걸린 예약이 전부 실패로 끝난다.
 */
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface DmSettings {
  enabled?: boolean;
  accessToken?: string;
  tokenSource?: string;
  igUserId?: string;
  igAccountId?: string;
  ownerAuthUserId?: string;
}

async function readSettings(username: string): Promise<DmSettings | null> {
  const store = getStore({ name: "dm-automation", consistency: "strong" });
  return ((await store.get(`dm_${username}`, { type: "json" })) as DmSettings) || null;
}

/** 발송을 막는 이유를 사람이 읽을 문장으로 돌려준다. 보낼 수 있으면 null. */
async function blockReason(job: DmScheduledJob, settings: DmSettings | null): Promise<string | null> {
  if (!settings?.accessToken) {
    return "인스타그램 계정 연동이 해제되어 발송하지 못했습니다.";
  }
  if (!settings.enabled) {
    return "자동 발송 스위치가 꺼져 있어 발송하지 못했습니다.";
  }
  if (!(await dmAutomationAllowed(job.username, settings.ownerAuthUserId))) {
    return "디엠 자동화 플랜이 활성 상태가 아니라 발송하지 못했습니다.";
  }
  if (job.commentId) {
    // 비공개 답장 — 24시간 창이 아니라 댓글 기준 7일 창을 본다.
    const commentMs = Date.parse(job.commentAt || job.createdAt || "");
    if (!Number.isNaN(commentMs) && Date.now() - commentMs > PRIVATE_REPLY_WINDOW_MS) {
      return (
        "댓글이 달린 뒤 7일이 지나 발송하지 못했습니다. " +
        "인스타그램은 그 이후의 댓글 비공개 답장을 허용하지 않습니다."
      );
    }
    return null;
  }
  const contact = await getDmContact(job.username, job.recipientId);
  if (!withinDmWindow(contact)) {
    return (
      "상대가 마지막으로 메시지를 보낸 뒤 24시간이 지나 발송하지 못했습니다. " +
      "인스타그램은 그 시점의 자유 형식 DM 을 허용하지 않습니다."
    );
  }
  return null;
}

const WORK_BUDGET_MS = 22_000;
const MAX_JOBS_PER_RUN = 20;
const SEND_SPACING_MS = 400;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelay(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));
}

async function finishScheduled(key: string, queued: DmJob | undefined, completed: DmScheduledJob) {
  if (queued) {
    await completeDmJob(queued, completed.status as "sent" | "failed" | "uncertain", completed.error, completed.errorKind);
  } else {
    await finishJob(key, completed);
  }
}

async function deferRateLimited(
  key: string,
  job: DmScheduledJob,
  queued: DmJob | undefined,
  delay: number,
  error: string,
) {
  if (queued) {
    await retryDmJob(queued, delay, error, "rate_limit");
  } else {
    const sendAt = new Date(Date.now() + delay).toISOString();
    await enqueueScheduledJob(job.username, job.id, job.igAccountId || "", sendAt, { ...job, sendAt, attempts: (job.attempts || 0) + 1 });
    await finishJob(key, { ...job, status: "canceled", sentAt: sendAt, error, errorKind: "rate_limit" });
  }
  await pauseDmAccount(job.igAccountId || "", delay);
}

async function processScheduled(key: string, job: DmScheduledJob, queued?: DmJob) {
    try {
      // 실행이 1분을 넘겨 다음 실행과 겹쳐도 같은 예약을 두 번 보내지 않는다.
      if (!queued && !(await claimJob(key))) return;

      const settings = await readSettings(job.username);
      const blocked = await blockReason(job, settings);
      if (blocked) {
        await finishScheduled(key, queued, {
          ...job,
          status: "failed",
          sentAt: new Date().toISOString(),
          error: blocked,
        });
        await appendDmLog(
          job.username,
          {
            kind: job.sendDm === false ? "reply" : "dm",
            status: "failed",
            trigger: "scheduled",
            recipientId: job.recipientId,
            ruleId: job.ruleId || job.id,
            ruleName: job.ruleName ? `${job.ruleName} (예약)` : "예약 발송",
            error: blocked,
          },
          "scheduled-dm",
        );
        return;
      }

      let replyFailure: { error: string; kind: string } | null = null;
      let repliedNow = false;
      if (job.publicReply?.message) {
        const replyKey = publicReplyKey(job.commentId || job.publicReply.commentId);
        if (await claimIfNew(job.username, replyKey, true)) {
          const replyResult = await postCommentReply({
            host: settings!.tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com",
            graphVersion: GRAPH_VERSION,
            commentId: job.publicReply.commentId,
            accessToken: settings!.accessToken!,
            message: job.publicReply.message,
          });
          repliedNow = true;
          if (replyResult.ok) {
            await appendDmLog(job.username, {
              kind: "reply",
              status: "sent",
              trigger: "scheduled",
              recipientId: job.recipientId,
              ruleId: job.ruleId || job.id,
              messageId: replyResult.replyId,
            }, "scheduled-dm");
          } else {
            const kind = replyResult.errorKind || "other";
            const error = describeDmError(kind, replyResult.error);
            await appendDmLog(job.username, {
              kind: "reply",
              status: "failed",
              trigger: "scheduled",
              recipientId: job.recipientId,
              ruleId: job.ruleId || job.id,
              error,
              errorKind: kind,
            }, "scheduled-dm");
            if (kind === "rate_limit" && (job.commentId || (queued?.attempts ?? job.attempts ?? 0) < 12)) {
              await release(job.username, replyKey, true);
              await deferRateLimited(key, job, queued, retryDelay(queued?.attempts || 1), error);
              return;
            }
            if (kind === "rate_limit") {
              await release(job.username, replyKey, true);
              await finishScheduled(key, queued, {
                ...job,
                status: "failed",
                sentAt: new Date().toISOString(),
                error,
                errorKind: kind,
              });
              return;
            }
            if (replyResult.uncertain) {
              await finishScheduled(key, queued, {
                ...job,
                status: "uncertain",
                sentAt: new Date().toISOString(),
                error,
                errorKind: kind,
              });
              return;
            }
            replyFailure = { error, kind };
          }
        }
      }

      if (job.sendDm === false) {
        await finishScheduled(key, queued, {
          ...job,
          status: replyFailure ? "failed" : "sent",
          sentAt: new Date().toISOString(),
          error: replyFailure?.error,
          errorKind: replyFailure?.kind,
        });
        return;
      }
      if (repliedNow) await wait(SEND_SPACING_MS);

      /**
       * 댓글에서 걸린 예약은 비공개 답장이라 "가장 중요한 내용이 첫 통"이어야
       * 한다(댓글 1건당 1통). 그래서 계획 자체를 댓글용으로 만든다.
       */
      const isPrivateReply = Boolean(job.commentId);
      const content: DmContent = {
        messageType: job.messageType === "carousel" ? "carousel" : "text",
        message: job.message,
        buttons: job.buttons,
        cards: job.cards,
      };
      const plan = isPrivateReply ? buildCommentDmPlan(content) : buildDirectDmPlan(content);
      if (plan.messages.length === 0) {
        await finishScheduled(key, queued, {
          ...job,
          status: "failed",
          sentAt: new Date().toISOString(),
          error: "보낼 내용이 비어 있습니다.",
        });
        return;
      }

      // 우리가 보낸 문구로 남긴다 — 발신 에코를 "외부 서비스가 보낸 DM"으로 잘못
      // 표시하지 않기 위해 발송 전에 남겨야 한다.
      for (const payload of plan.messages) {
        const text = typeof (payload as any)?.text === "string" ? (payload as any).text : "";
        if (text) await noteSentText(job.username, text);
      }

      const sendArgs = {
        graphHost: settings!.tokenSource === "instagram_login"
          ? "graph.instagram.com"
          : "graph.facebook.com",
        graphVersion: GRAPH_VERSION,
        igId: settings!.igUserId || settings!.igAccountId || "",
        accessToken: settings!.accessToken!,
      };

      const sendKey = isPrivateReply
        ? dmContentKey(job.commentId!, contentHashOf(plan.messages))
        : `schedule_${job.id}`;
      if (!(await claimIfNew(job.username, sendKey, true))) {
        await finishScheduled(key, queued, {
          ...job,
          status: "uncertain",
          sentAt: new Date().toISOString(),
          error: "이 예약의 이전 발송 결과를 확인해야 합니다.",
          errorKind: "uncertain",
        });
        return;
      }
      let privateClaimed = false;
      if (isPrivateReply) {
        try {
          privateClaimed = await claimIfNew(job.username, privateReplyKey(job.commentId!), true);
        } catch (e) {
          await release(job.username, sendKey, true);
          throw e;
        }
        if (!privateClaimed) {
          await finishScheduled(key, queued, {
            ...job,
            status: "uncertain",
            sentAt: new Date().toISOString(),
            error: "이 댓글에 대한 이전 발송 결과를 확인해야 합니다.",
            errorKind: "uncertain",
          });
          return;
        }
      }

      let result = await sendDmMessages({
        ...sendArgs,
        recipient: isPrivateReply ? { comment_id: job.commentId! } : { id: job.recipientId },
        // 비공개 답장은 첫 통만 허용된다. 이어지는 통은 열린 대화창(IGSID)으로.
        followUpRecipient: isPrivateReply && job.recipientId ? { id: job.recipientId } : undefined,
        messages: plan.messages,
        bestEffortFrom: plan.bestEffortFrom,
        fallback: plan.fallback,
      });

      /**
       * 비공개 답장 기회가 이미 소진된 경우(인스타그램 자체 자동 메시지가 먼저
       * 나갔거나, 같은 댓글에 다른 규칙이 즉시 발송을 했다) 아무것도 도착하지 않은
       * 채로 실패로 끝난다. 상대가 24시간 안에 말을 건 적이 있다면 대화창이 열려
       * 있으니 IGSID 로 한 번 더 시도해 예약 내용을 살린다.
       */
      if (
        !result.ok &&
        !result.partial &&
        isPrivateReply &&
        job.recipientId &&
        result.errorKind === "already_sent" &&
        withinDmWindow(await getDmContact(job.username, job.recipientId))
      ) {
        const direct = buildDirectDmPlan(content);
        if (direct.messages.length > 0) {
          result = await sendDmMessages({
            ...sendArgs,
            recipient: { id: job.recipientId },
            messages: direct.messages,
            bestEffortFrom: direct.bestEffortFrom,
            fallback: direct.fallback,
          });
        }
      }

      const sentAt = new Date().toISOString();
      if (result.ok || result.partial) {
        await finishScheduled(key, queued, {
          ...job,
          status: "sent",
          sentAt,
          error: replyFailure?.error,
          errorKind: replyFailure?.kind,
        });
        await appendDmLog(
          job.username,
          {
            kind: "dm",
            status: "sent",
            trigger: "scheduled",
            partial: result.partial,
            recipientId: job.recipientId,
            ruleId: job.ruleId || job.id,
            ruleName: job.ruleName ? `${job.ruleName} (예약)` : "예약 발송",
            messageId: result.messageId,
          },
          "scheduled-dm",
        );
      } else {
        const kind = result.errorKind || "other";
        const error = describeDmError(kind, result.error);
        if (kind === "rate_limit" && (job.commentId || (queued?.attempts ?? job.attempts ?? 0) < 12) &&
          (!job.commentId || Date.now() - Date.parse(job.commentAt || job.createdAt || "") < PRIVATE_REPLY_WINDOW_MS)) {
          const delay = retryDelay(queued?.attempts || 1);
          await release(job.username, sendKey, true);
          if (privateClaimed) await release(job.username, privateReplyKey(job.commentId!), true);
          await deferRateLimited(key, job, queued, delay, error);
          return;
        }
        if (kind !== "already_sent" && kind !== "uncertain") {
          await release(job.username, sendKey, true);
          if (privateClaimed) await release(job.username, privateReplyKey(job.commentId!), true);
        }
        await finishScheduled(key, queued, {
          ...job,
          status: kind === "uncertain" ? "uncertain" : "failed",
          sentAt,
          error,
          errorKind: kind,
        });
        await appendDmLog(
          job.username,
          {
            kind: "dm",
            status: "failed",
            trigger: "scheduled",
            recipientId: job.recipientId,
            ruleId: job.ruleId || job.id,
            ruleName: job.ruleName ? `${job.ruleName} (예약)` : "예약 발송",
            error,
            errorKind: kind,
          },
          "scheduled-dm",
        );
      }
    } catch (e) {
      // 처리 중 예외가 나면 예약은 대기열에 그대로 남는다. 선점만 풀어 다음 주기에
      // 다시 시도되게 한다 — 풀지 않으면 그 예약은 영영 나가지 않는다.
      if (queued) {
        await retryDmJob(queued, retryDelay(queued.attempts), (e as Error)?.message || "발송 오류", "other")
          .catch((retryError) => console.error("[scheduled-dm] retry failed:", retryError));
      } else {
        await releaseJobClaim(key);
      }
      console.error(`[scheduled-dm] error on ${key}:`, e);
    }
}

async function processQueuedComment(job: DmJob): Promise<boolean> {
  const payload = job.payload || {};
  const igAccountId = String(payload.igAccountId || job.ig_account_id || "");
  const change = payload.change;
  if (!igAccountId || !change?.value?.id) {
    await completeDmJob(job, "failed", "댓글 이벤트 정보가 비어 있습니다.", "invalid_payload");
    return false;
  }
  try {
    const result = await processWebhookPayload({
      entry: [{ id: igAccountId, time: payload.entryTime, changes: [change] }],
    });
    if (result.uncertain) {
      await completeDmJob(job, "uncertain", result.error, result.errorKind);
    } else if (result.retryable) {
      const commentAt = Number(payload.entryTime) > 0
        ? Number(payload.entryTime) * 1000
        : Date.parse(job.created_at || job.due_at);
      const expired = Date.now() - commentAt >= PRIVATE_REPLY_WINDOW_MS;
      if (expired || (result.errorKind !== "rate_limit" && job.attempts >= 12)) {
        await completeDmJob(job, "failed", result.error || "재시도 횟수를 초과했습니다.", result.errorKind);
        return Boolean(result.sideEffectAttempted);
      }
      const delay = retryDelay(job.attempts);
      await retryDmJob(job, delay, result.error || "일시적인 발송 오류", result.errorKind || "other");
      if (result.errorKind === "rate_limit") {
        await pauseDmAccount(igAccountId, delay).catch((e) =>
          console.error("[scheduled-dm] account pause failed:", e),
        );
      }
    } else {
      await completeDmJob(job, "sent");
    }
    return Boolean(result.sideEffectAttempted);
  } catch (e) {
    const error = (e as Error)?.message || "처리 오류";
    if (job.attempts >= 12) await completeDmJob(job, "failed", error, "other");
    else await retryDmJob(job, retryDelay(job.attempts), error, "other");
    return false;
  }
}

export default async () => {
  const started = Date.now();
  let processed = 0;
  try {
    while (processed < MAX_JOBS_PER_RUN && Date.now() - started < WORK_BUDGET_MS) {
      const [queued] = await claimDueJobs(1);
      if (!queued) break;
      processed += 1;
      const attemptedSend = queued.job_type === "comment_event"
        ? await processQueuedComment(queued)
        : (await processScheduled(queued.id, queued.payload as DmScheduledJob, queued), true);
      if (attemptedSend && processed < MAX_JOBS_PER_RUN && Date.now() - started < WORK_BUDGET_MS) {
        await wait(SEND_SPACING_MS);
      }
    }
  } catch (e) {
    console.error("[scheduled-dm] queue processing failed:", (e as Error)?.message);
  }
  if (Date.now() - started >= WORK_BUDGET_MS) return;
  const due = await listDueJobs(new Date(), 10);
  for (const { key, job } of due) {
    if (Date.now() - started >= WORK_BUDGET_MS) break;
    await processScheduled(key, job);
    if (Date.now() - started < WORK_BUDGET_MS) await wait(SEND_SPACING_MS);
  }
};

export const config: Config = {
  schedule: "* * * * *",
};
