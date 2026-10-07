import { getStore } from "@netlify/blobs";
import { dmAutomationAllowedForSend } from "./dm-automation-access.mts";
import { appendDmLog } from "./dm-automation-log.mts";
import { getDmContact, withinDmWindow } from "./dm-contacts.mts";
import { claimJob, finishJob, queueRemainingDmMessages, releaseJobClaim } from "./dm-schedule-store.mts";
import type { DmScheduledJob } from "./dm-schedule-store.mts";
import {
  buildBaitCommentPlan,
  buildCommentDmPlan,
  buildDirectDmPlan,
  describeDmError,
  postCommentReply,
  sendDmMessages,
  sentTextsOf,
} from "./instagram-dm.mts";
import type { DmContent } from "./instagram-dm.mts";
import { claimIfNew, confirmFailed, confirmedFailure, confirmSent, confirmedSent, contentHashOf, dmContentKey, noteSentText, noteUncertainReply, privateReplyKey, publicReplyKey, release, reopenClaim, UNCERTAIN_REPLY_RETRIES, uncertainReplyAttempts } from "./dm-send-registry.mts";
import { linkFeatureOff } from "./instagram-metrics.mts";
import { completeDmJob, enqueueScheduledJob, pauseDmAccount, retryDmJob } from "./dm-jobs.mts";
import type { DmJob } from "./dm-jobs.mts";
import { processWebhookPayload } from "../instagram-webhook.mts";
import { baitPayload, baitSuspended, noteBaitFailure, notifyAdminBaitIssue, saveBaitPending } from "./dm-bait.mts";

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
  featuresOff?: string[];
  automations?: { id: string; enabled?: boolean; scheduledAt?: string; sendMode?: string }[];
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
  // 판정 근거를 못 읽으면 예외가 올라가 이 예약은 대기열에서 다시 시도된다.
  if (!(await dmAutomationAllowedForSend(job.username, settings.ownerAuthUserId))) {
    return "디엠 자동화 플랜이 활성 상태가 아니라 발송하지 못했습니다.";
  }
  if (linkFeatureOff(settings as any, "dm")) return "자동 DM 기능이 비활성화되어 있습니다.";
  if (job.igAccountId && ![settings.igUserId, settings.igAccountId].includes(job.igAccountId)) return "예약한 인스타그램 계정의 연결이 변경되었습니다.";
  if (job.source === "comment" && job.ruleId && !settings.automations?.some((rule) => rule.id === job.ruleId && rule.enabled)) return "예약한 자동화가 삭제되었거나 비활성화되었습니다.";
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

const SEND_SPACING_MS = 400;

/**
 * 연결된 사용자를 찾지 못한 댓글 이벤트를 다시 확인하는 횟수.
 *
 * 연동 직후에는 역인덱스가 아직 비어 있을 수 있어 몇 번은 다시 본다. 주인을 못
 * 찾은 결과는 10분 동안 캐시되므로(dm-webhook-index) 그 뒤에 한 번 더 확인되도록
 * 1·2·4·8분 간격으로 5회까지만 본다. 그 이후는 연동이 해제된 계정의 이벤트로
 * 보고 조용히 종료한다 — 6시간 동안 12번 재시도하며 운영 화면의 "확인할 작업"을
 * 채우던 문제가 있었다.
 */
const ACCOUNT_LOOKUP_ATTEMPTS = 5;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelay(attempts: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));
}

async function finishScheduled(key: string, queued: DmJob | undefined, completed: DmScheduledJob) {
  if (queued) {
    await completeDmJob(queued, completed.status as "sent" | "failed" | "uncertain", completed.error, completed.errorKind, undefined, completed.partial ? "partial" : undefined);
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
  kind = "rate_limit",
) {
  if (queued) {
    await retryDmJob(queued, delay, error, kind);
  } else {
    const sendAt = new Date(Date.now() + delay).toISOString();
    await enqueueScheduledJob(job.username, job.id, job.igAccountId || "", sendAt, { ...job, sendAt, attempts: (job.attempts || 0) + 1 });
    await finishJob(key, { ...job, status: "canceled", sentAt: sendAt, error, errorKind: "rate_limit" });
  }
  if (kind === "rate_limit") await pauseDmAccount(job.igAccountId || "", delay);
}

/**
 * 예약이 이어받은 발송 대장 선점(버튼 클릭 뒤 본 메시지 등)의 결과를 남긴다.
 *
 * 발송이 끝나면 확인 표시를, 결과가 불확실하면 "확인 안 됨"으로 되돌리고, 실패하면
 * 선점을 푼다. 그래야 받지 못한 사람이 같은 버튼을 다시 눌렀을 때 다시 보낼 수 있다.
 * 기록 실패는 발송 결과를 바꾸지 않는다.
 */
async function settleClaim(job: DmScheduledJob, outcome: "sent" | "uncertain" | "failed") {
  if (!job.claimKey) return;
  const settle = outcome === "sent"
    ? confirmSent(job.username, job.claimKey)
    : outcome === "uncertain"
      ? reopenClaim(job.username, job.claimKey)
      : release(job.username, job.claimKey, true);
  await settle.catch((e) => console.warn("[scheduled-dm] claim settle failed:", (e as Error)?.message));
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
        await settleClaim(job, "failed");
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

      const rule = job.source === "comment" ? settings?.automations?.find((entry) => entry.id === job.ruleId) : undefined;
      const scheduledAt = rule?.sendMode === "scheduled" ? Date.parse(rule.scheduledAt || "") : NaN;
      if (queued && queued.attempts === 1 && Number.isFinite(scheduledAt) && scheduledAt > Date.now()) {
        await retryDmJob(queued, scheduledAt - Date.now(), "예약 시각 대기", "throttled");
        return;
      }
      let replyFailure: { error: string; kind: string } | null = null;
      let repliedNow = false;
      if (job.publicReply?.message) {
        const replyKey = publicReplyKey(job.commentId || job.publicReply.commentId);
        if (await claimIfNew(job.username, replyKey, true)) {
          const replyResult = await postCommentReply({
            igId: settings!.igUserId || settings!.igAccountId || "",
            host: settings!.tokenSource === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com",
            graphVersion: GRAPH_VERSION,
            commentId: job.publicReply.commentId,
            accessToken: settings!.accessToken!,
            message: job.publicReply.message,
          });
          repliedNow = true;
          if (replyResult.ok) {
            await confirmSent(job.username, replyKey);
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
            if (kind === "throttled") {
              await release(job.username, replyKey, true);
              await deferRateLimited(key, job, queued, replyResult.retryAfterMs || 1000, error, kind);
              return;
            }
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
              await deferRateLimited(key, job, queued, Math.max(replyResult.retryAfterMs || 0, retryDelay(queued?.attempts || 1)), error);
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
              // 답글 결과를 모른다. 답글 선점은 그대로 두어(다시 달지 않는다) 기록만 남기고,
              // DM 은 답글과 별개라 아래에서 그대로 보낸다. 예전에는 여기서 예약을 "결과
              // 확인 필요"로 끝내 DM 이 나가지 않았다.
              replyFailure = { error, kind: "uncertain" };
            } else {
              // 영구 실패한 답글은 처리 끝으로 표시한다. 되돌리면 DM 이 대기열로 돌아갈 때마다
              // 답글을 다시 시도해 실패하고, DM 은 나가지 못한 채 발송 한도만 쓴다.
              await confirmFailed(job.username, replyKey, error, kind);
              replyFailure = { error, kind };
            }
          }
        } else {
          replyFailure = await confirmedFailure(job.username, replyKey);
          if (!replyFailure && !(await confirmedSent(job.username, replyKey))) {
            // 앞선 답글의 결과를 모른다. 답글은 다시 달지 않고 DM 은 그대로 보낸다.
            replyFailure = { error: "이 댓글 답글의 이전 발송 결과를 확인해야 합니다.", kind: "uncertain" };
          }
        }
      }

      if (job.sendDm === false) {
        await finishScheduled(key, queued, {
          ...job,
          status: replyFailure ? (replyFailure.kind === "uncertain" ? "uncertain" : "failed") : "sent",
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
      const legacyPlan = isPrivateReply ? buildCommentDmPlan(content) : buildDirectDmPlan(content);
      /**
       * 2단계 발송 예약이면 비공개 답장 한 통은 미끼 카드다. 미끼가 거부되면 기존
       * 1통 카드가 대신 나간다. 2단계 방식이 멈춰 있으면(Meta 정책 변경 의심) 처음부터
       * 기존 1통 카드로 보낸다.
       */
      const bait = isPrivateReply && job.bait && !(await baitSuspended(job.username)) ? job.bait : undefined;
      // 앞서 못 보낸 나머지 통(링크 버튼 카드 등)은 만들어 둔 페이로드를 그대로 보낸다.
      const storedPayloads = !isPrivateReply && Array.isArray(job.payloads) && job.payloads.length > 0 ? job.payloads : null;
      const plan = storedPayloads
        ? { messages: storedPayloads, bestEffortFrom: storedPayloads.length }
        : bait && legacyPlan.messages.length > 0
        ? buildBaitCommentPlan({ message: bait.message, buttonLabel: bait.buttonLabel, payload: baitPayload(job.commentId!) }, content)
        : legacyPlan;
      if (plan.messages.length === 0) {
        await finishScheduled(key, queued, {
          ...job,
          status: "failed",
          sentAt: new Date().toISOString(),
          error: "보낼 내용이 비어 있습니다.",
        });
        await settleClaim(job, "failed");
        return;
      }

      // 우리가 보낸 문구로 남긴다 — 발신 에코를 "외부 서비스가 보낸 DM"으로 잘못
      // 표시하지 않기 위해 발송 전에 남겨야 한다.
      for (const text of sentTextsOf(plan.messages)) await noteSentText(job.username, text);

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
        await settleClaim(job, "uncertain");
        return;
      }
      let privateClaimed = false;
      if (isPrivateReply) {
        try {
          privateClaimed = await claimIfNew(job.username, privateReplyKey(job.commentId!), true);
          if (privateClaimed && bait && plan !== legacyPlan) {
            await saveBaitPending(job.username, {
              commentId: job.commentId!,
              fromId: job.recipientId,
              automationIds: bait.automationIds?.length ? bait.automationIds : [job.ruleId || ""].filter(Boolean),
              createdAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          if (privateClaimed) await release(job.username, privateReplyKey(job.commentId!), true);
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

      // 앞선 시도가 결과 불명으로 끝나 다시 시도하는 댓글인지(UNCERTAIN_REPLY_RETRIES).
      // 읽지 못하면 다시 시도하지도, IGSID 로 우회하지도 않는 쪽으로 본다.
      const priorUncertain = isPrivateReply
        ? await uncertainReplyAttempts(job.username, job.commentId!).catch(() => UNCERTAIN_REPLY_RETRIES)
        : 0;
      let resultMessages = plan.messages;
      let result = await sendDmMessages({
        ...sendArgs,
        recipient: isPrivateReply ? { comment_id: job.commentId! } : { id: job.recipientId },
        // 비공개 답장은 첫 통만 허용된다. 이어지는 통은 열린 대화창(IGSID)으로.
        followUpRecipient: isPrivateReply && job.recipientId && plan.messages.length > 1 &&
          withinDmWindow(await getDmContact(job.username, job.recipientId)) ? { id: job.recipientId } : undefined,
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
      // 앞선 시도가 결과 불명이었는데 이번에 "이미 답장함"이 왔다 — 앞선 시도가 도착했다.
      // 이때는 IGSID 로 다시 보내지 않는다(같은 내용이 두 번 간다).
      const deliveredEarlier =
        isPrivateReply && priorUncertain > 0 && !result.ok && !result.partial && result.errorKind === "already_sent";
      if (
        !result.ok &&
        !result.partial &&
        isPrivateReply &&
        priorUncertain === 0 &&
        job.recipientId &&
        result.errorKind === "already_sent" &&
        withinDmWindow(await getDmContact(job.username, job.recipientId))
      ) {
        const direct = buildDirectDmPlan(content);
        if (direct.messages.length > 0) {
          resultMessages = direct.messages;
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
      if (bait && result.ok && plan !== legacyPlan) {
        if (result.usedFallback) {
          if (await noteBaitFailure(job.username, "1단계(미끼) 카드가 거부돼 1통 카드로 대체 발송했습니다.")) {
            await notifyAdminBaitIssue(job.username, "미끼 카드(postback 버튼)가 연달아 거부돼 24시간 동안 기존 1통 카드 방식으로 전환했습니다.", "suspended");
          }
        }
      }
      // 본 내용(인사말 + 본 메시지) 중 아직 도착하지 않은 통 수. 버튼 클릭 뒤 본 메시지
      // 예약만 이 값을 갖는다(coreCount).
      const coreLeft = !result.ok && typeof job.coreCount === "number" ? Math.max(0, job.coreCount - result.sent) : 0;
      // 이 예약도 여러 통이면 뒤 통이 발송 간격에 걸릴 수 있다 — 남은 통을 다시 대기열로.
      // 본 내용이 남아 있으면 선점과 남은 본 내용 수를 이어 넘긴다.
      const followUpQueued = await queueRemainingDmMessages({
        id: `${job.id}_rest${result.sent}`,
        username: job.username,
        igAccountId: job.igAccountId || sendArgs.igId,
        recipientId: job.recipientId,
        messages: resultMessages,
        result,
        ruleId: job.ruleId,
        ruleName: job.ruleName,
        ...(coreLeft > 0 && job.claimKey ? { claimKey: job.claimKey, coreCount: coreLeft } : {}),
      });
      if (result.ok || result.partial || deliveredEarlier) {
        await finishScheduled(key, queued, {
          ...job,
          status: "sent",
          sentAt,
          error: replyFailure?.error || result.error || result.followUpError,
          errorKind: replyFailure?.kind || result.errorKind,
          partial: Boolean(replyFailure || (result.partial && !followUpQueued) || result.followUpError),
        });
        /**
         * 본 내용이 다 도착했을 때만 선점에 "보냄" 표시를 한다. 인사말만 가고 카드가 거부된
         * 것을 보냄으로 굳히면 같은 버튼을 다시 눌러도 다시 받을 수 없었다. 남은 본 내용을
         * 이어 보내는 작업을 넣었으면 그 작업이 결과를 남긴다.
         */
        if (coreLeft === 0) await settleClaim(job, "sent");
        else if (!followUpQueued) await settleClaim(job, result.errorKind === "uncertain" ? "uncertain" : "failed");
        await appendDmLog(
          job.username,
          {
            kind: "dm",
            status: "sent",
            trigger: "scheduled",
            partial: result.partial && !followUpQueued,
            followUpQueued: followUpQueued || undefined,
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
        if (kind === "throttled") {
          await release(job.username, sendKey, true);
          if (privateClaimed) await release(job.username, privateReplyKey(job.commentId!), true);
          await deferRateLimited(key, job, queued, result.retryAfterMs || 1000, error, kind);
          return;
        }
        if (kind === "rate_limit" && (job.commentId || (queued?.attempts ?? job.attempts ?? 0) < 12) &&
          (!job.commentId || Date.now() - Date.parse(job.commentAt || job.createdAt || "") < PRIVATE_REPLY_WINDOW_MS)) {
          const delay = Math.max(result.retryAfterMs || 0, retryDelay(queued?.attempts || 1));
          await release(job.username, sendKey, true);
          if (privateClaimed) await release(job.username, privateReplyKey(job.commentId!), true);
          await deferRateLimited(key, job, queued, delay, error);
          return;
        }
        /**
         * 결과 불명(인스타그램 5xx · 일시 오류 · 응답 시간 초과)으로 끝난 비공개 답장은 몇 번까지
         * 다시 시도한다. 비공개 답장은 댓글당 1회라 앞선 시도가 도착했다면 다음 시도는 "이미
         * 답장함"으로 거절되고(두 번 가지 않는다), 그 거절은 위에서 도착 확인으로 처리한다.
         */
        if (
          kind === "uncertain" &&
          isPrivateReply &&
          queued &&
          result.sent === 0 &&
          priorUncertain < UNCERTAIN_REPLY_RETRIES
        ) {
          await noteUncertainReply(job.username, job.commentId!, priorUncertain + 1);
          await release(job.username, sendKey, true);
          if (privateClaimed) await release(job.username, privateReplyKey(job.commentId!), true);
          await retryDmJob(queued, 60_000, error, "uncertain_retry");
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
        await settleClaim(job, kind === "uncertain" ? "uncertain" : "failed");
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
        const error = (e as Error)?.message || "발송 오류";
        const giveUp = queued.attempts >= 12;
        await (giveUp ? completeDmJob(queued, "failed", error, "other") : retryDmJob(queued, retryDelay(queued.attempts), error, "other"))
          .catch((retryError) => console.error("[scheduled-dm] retry failed:", retryError));
        if (giveUp) await settleClaim(job, "failed");
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
    } else if (result.retryable && result.errorKind === "account_lookup" && job.attempts >= ACCOUNT_LOOKUP_ATTEMPTS) {
      await completeDmJob(job, "canceled", result.error, result.errorKind, undefined, "unlinked");
    } else if (result.retryable) {
      const commentAt = Number(payload.entryTime) > 0
        ? Number(payload.entryTime) * 1000
        : Date.parse(job.created_at || job.due_at);
      const expired = Date.now() - commentAt >= PRIVATE_REPLY_WINDOW_MS;
      if (expired || (!["rate_limit", "throttled"].includes(result.errorKind || "") && job.attempts >= 12)) {
        await completeDmJob(job, "failed", result.error || "재시도 횟수를 초과했습니다.", result.errorKind);
        return Boolean(result.sideEffectAttempted);
      }
      const delay = result.errorKind === "throttled" ? result.retryAfterMs || 1000 : Math.max(result.retryAfterMs || 0, retryDelay(job.attempts));
      await retryDmJob(job, delay, result.error || "일시적인 발송 오류", result.errorKind || "other");
      if (result.errorKind === "rate_limit") {
        // 큐에 넣을 때 작업의 계정은 settings.igUserId 로 맞춰졌다(웹훅의 계정 ID 와 다를
        // 수 있다). 발송기가 보는 행과 같은 계정을 멈춰야 쿨다운이 실제로 걸린다.
        await pauseDmAccount(job.ig_account_id || igAccountId, delay).catch((e) =>
          console.error("[scheduled-dm] account pause failed:", e),
        );
      }
    } else {
      const failed = Boolean(result.failed && !result.sent);
      await completeDmJob(job, failed ? "failed" : "sent", result.error, result.errorKind, undefined,
        failed ? "failed" : result.failed || result.partial ? "partial" : result.sent ? "sent" : "processed");
    }
    return Boolean(result.sideEffectAttempted);
  } catch (e) {
    const error = (e as Error)?.message || "처리 오류";
    if (job.attempts >= 12) await completeDmJob(job, "failed", error, "other");
    else await retryDmJob(job, retryDelay(job.attempts), error, "other");
    return false;
  }
}

/** 버튼 클릭·받은 DM 에 답할 수 있는 기간(인스타그램 24시간 대화창). */
const MESSAGE_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 메시지 이벤트가 일어난 시각(epoch ms). 초 단위로 오는 경우도 받아 준다. */
function messageEventAt(job: DmJob): number {
  const raw = Number(job.payload?.event?.timestamp);
  if (Number.isFinite(raw) && raw > 0) return raw < 1e12 ? raw * 1000 : raw;
  const entryTime = Number(job.payload?.entryTime);
  if (Number.isFinite(entryTime) && entryTime > 0) return entryTime < 1e12 ? entryTime * 1000 : entryTime;
  return Date.parse(job.created_at || job.due_at);
}

/**
 * 대기열에 넣어 둔 버튼 클릭(postback) · 받은 DM 한 건을 처리한다.
 *
 * 처리 자체는 웹훅과 같은 함수(processWebhookPayload)가 한다. 대기열을 거치는 이유는
 * 실행 시간과 재시도다 — 웹훅 요청 안에서 여러 통을 보내다 끊기면 나머지 통을 이어 보낼
 * 방법이 없었다.
 */
async function processQueuedMessage(job: DmJob): Promise<void> {
  const payload = job.payload || {};
  const igAccountId = String(payload.igAccountId || job.ig_account_id || "");
  const event = payload.event;
  if (!igAccountId || !event || typeof event !== "object") {
    await completeDmJob(job, "failed", "메시지 이벤트 정보가 비어 있습니다.", "invalid_payload");
    return;
  }
  if (Date.now() - messageEventAt(job) >= MESSAGE_REPLY_WINDOW_MS) {
    await completeDmJob(job, "canceled", "24시간이 지나 답할 수 없는 메시지입니다.", "outside_window", undefined, "expired");
    return;
  }
  try {
    const result = await processWebhookPayload(
      { entry: [{ id: igAccountId, time: payload.entryTime, messaging: [event] }] },
      true,
    );
    if (result.retryable) {
      if (result.errorKind === "account_lookup" && job.attempts >= ACCOUNT_LOOKUP_ATTEMPTS) {
        await completeDmJob(job, "canceled", result.error, result.errorKind, undefined, "unlinked");
      } else if (job.attempts >= 12) {
        await completeDmJob(job, "failed", result.error || "재시도 횟수를 초과했습니다.", result.errorKind);
      } else {
        await retryDmJob(job, retryDelay(job.attempts), result.error || "일시적인 처리 오류", result.errorKind || "other");
      }
      return;
    }
    await completeDmJob(job, "sent", undefined, undefined, undefined, "processed");
  } catch (e) {
    const error = (e as Error)?.message || "처리 오류";
    if (job.attempts >= 12) await completeDmJob(job, "failed", error, "other");
    else await retryDmJob(job, retryDelay(job.attempts), error, "other");
  }
}

export async function processDmJob(job: DmJob): Promise<void> {
  if (job.job_type === "comment_event") await processQueuedComment(job);
  else if (job.job_type === "message_event") await processQueuedMessage(job);
  else await processScheduled(job.id, { ...(job.payload as DmScheduledJob), sendAt: job.due_at }, job);
}
