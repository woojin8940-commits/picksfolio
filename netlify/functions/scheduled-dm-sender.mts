import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { dmAutomationAllowed } from "./_shared/dm-automation-access.mts";
import { appendDmLog } from "./_shared/dm-automation-log.mts";
import { getDmContact, withinDmWindow } from "./_shared/dm-contacts.mts";
import { claimJob, finishJob, listDueJobs, releaseJobClaim } from "./_shared/dm-schedule-store.mts";
import type { DmScheduledJob } from "./_shared/dm-schedule-store.mts";
import { buildDirectDmPlan, describeDmError, sendDmMessages } from "./_shared/instagram-dm.mts";
import { noteSentText } from "./_shared/dm-send-registry.mts";

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

interface DmSettings {
  enabled?: boolean;
  accessToken?: string;
  tokenSource?: string;
  igUserId?: string;
  igAccountId?: string;
  ownerAuthUserId?: string;
}

async function readSettings(username: string): Promise<DmSettings | null> {
  try {
    const store = getStore({ name: "dm-automation", consistency: "strong" });
    return ((await store.get(`dm_${username}`, { type: "json" })) as DmSettings) || null;
  } catch (e) {
    console.warn("[scheduled-dm] settings read failed:", (e as Error)?.message);
    return null;
  }
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
  const contact = await getDmContact(job.username, job.recipientId);
  if (!withinDmWindow(contact)) {
    return (
      "상대가 마지막으로 메시지를 보낸 뒤 24시간이 지나 발송하지 못했습니다. " +
      "인스타그램은 그 시점의 자유 형식 DM 을 허용하지 않습니다."
    );
  }
  return null;
}

export default async () => {
  const now = new Date();
  const due = await listDueJobs(now);
  if (due.length === 0) return;

  console.log(`[scheduled-dm] ${due.length} scheduled DM(s) due`);

  for (const { key, job } of due) {
    try {
      // 실행이 1분을 넘겨 다음 실행과 겹쳐도 같은 예약을 두 번 보내지 않는다.
      if (!(await claimJob(key))) continue;

      const settings = await readSettings(job.username);
      const blocked = await blockReason(job, settings);
      if (blocked) {
        await finishJob(key, {
          ...job,
          status: "failed",
          sentAt: new Date().toISOString(),
          error: blocked,
        });
        await appendDmLog(
          job.username,
          {
            kind: "dm",
            status: "failed",
            trigger: "scheduled",
            recipientId: job.recipientId,
            ruleId: job.id,
            ruleName: "예약 발송",
            error: blocked,
          },
          "scheduled-dm",
        );
        continue;
      }

      const plan = buildDirectDmPlan({
        messageType: "text",
        message: job.message,
        buttons: job.buttons,
      });
      if (plan.messages.length === 0) {
        await finishJob(key, {
          ...job,
          status: "failed",
          sentAt: new Date().toISOString(),
          error: "보낼 내용이 비어 있습니다.",
        });
        continue;
      }

      // 우리가 보낸 문구로 남긴다 — 발신 에코를 "외부 서비스가 보낸 DM"으로 잘못
      // 표시하지 않기 위해 발송 전에 남겨야 한다.
      for (const payload of plan.messages) {
        const text = typeof (payload as any)?.text === "string" ? (payload as any).text : "";
        if (text) await noteSentText(job.username, text);
      }

      const result = await sendDmMessages({
        graphHost: settings!.tokenSource === "instagram_login"
          ? "graph.instagram.com"
          : "graph.facebook.com",
        graphVersion: GRAPH_VERSION,
        igId: settings!.igUserId || settings!.igAccountId || "",
        accessToken: settings!.accessToken!,
        recipient: { id: job.recipientId },
        messages: plan.messages,
        bestEffortFrom: plan.bestEffortFrom,
      });

      const sentAt = new Date().toISOString();
      if (result.ok || result.partial) {
        await finishJob(key, { ...job, status: "sent", sentAt });
        await appendDmLog(
          job.username,
          {
            kind: "dm",
            status: "sent",
            trigger: "scheduled",
            partial: result.partial,
            recipientId: job.recipientId,
            ruleId: job.id,
            ruleName: "예약 발송",
            messageId: result.messageId,
          },
          "scheduled-dm",
        );
      } else {
        const kind = result.errorKind || "other";
        const error = describeDmError(kind, result.error);
        await finishJob(key, { ...job, status: "failed", sentAt, error, errorKind: kind });
        await appendDmLog(
          job.username,
          {
            kind: "dm",
            status: "failed",
            trigger: "scheduled",
            recipientId: job.recipientId,
            ruleId: job.id,
            ruleName: "예약 발송",
            error,
            errorKind: kind,
          },
          "scheduled-dm",
        );
      }
    } catch (e) {
      // 처리 중 예외가 나면 예약은 대기열에 그대로 남는다. 선점만 풀어 다음 주기에
      // 다시 시도되게 한다 — 풀지 않으면 그 예약은 영영 나가지 않는다.
      await releaseJobClaim(key);
      console.error(`[scheduled-dm] error on ${key}:`, e);
    }
  }
};

export const config: Config = {
  schedule: "* * * * *",
};
