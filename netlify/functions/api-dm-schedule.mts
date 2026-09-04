import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import {
  DM_AUTOMATION_REQUIRED_MESSAGE,
  DM_AUTOMATION_TIER,
  dmAutomationAllowed,
} from "./_shared/dm-automation-access.mts";
import {
  DM_WINDOW_MS,
  getDmContact,
  listDmContacts,
  withinDmWindow,
} from "./_shared/dm-contacts.mts";
import {
  cancelScheduledJob,
  createScheduledJob,
  listScheduledJobs,
} from "./_shared/dm-schedule-store.mts";
import type { DmScheduledJob } from "./_shared/dm-schedule-store.mts";
import { normalizeLinkUrl } from "./_shared/instagram-dm.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 예약 DM (특정 날짜·시간에 미리 정해 둔 DM 을 보내기).
 *
 * GET  : 예약 목록 + 보낼 수 있는 대상 명단(최근에 DM 을 보내온 사람).
 * POST : `action: 'create' | 'cancel'`.
 *
 * ── 왜 "받는 사람을 직접 입력"이 아닌가 ──
 * 인스타그램은 **상대가 마지막으로 메시지를 보낸 뒤 24시간 안에만** 자유 형식 DM 을
 * 허용한다. 먼저 말을 거는 발송(콜드 아웃리치·일괄 홍보)은 정책 위반이고 Graph API
 * 도 거부한다. 그래서 이 기능의 대상은 "최근에 우리에게 DM 을 보낸 사람"으로
 * 한정되고, 화면은 그중에서 고르게 한다(명단은 웹훅이 메시지를 받을 때마다
 * `_shared/dm-contacts.mts` 에 쌓인다).
 *
 * 창을 넘긴 시각으로도 예약 자체는 만들 수 있게 둔다 — 그 사이 상대가 다시 메시지를
 * 보내면 창이 열리기 때문이다. 대신 만들 때 경고를 함께 돌려주고, 발송 시점에도
 * 다시 확인해 창이 닫혀 있으면 이유를 적어 실패로 남긴다(조용히 사라지면 사용자는
 * 예약이 나간 줄 안다).
 *
 * 저장은 Netlify Blobs 대기열(`_shared/dm-schedule-store.mts`)이고, 실제 발송은
 * 1분마다 도는 scheduled-dm-sender 가 맡는다.
 */

/** 한 사용자가 동시에 걸어 둘 수 있는 예약 수. */
const PENDING_MAX = 50;
/** 예약을 걸 수 있는 최대 미래 시점(30일). */
const HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

const genId = () => `sdm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

interface DmSettingsPeek {
  enabled?: boolean;
  accessToken?: string;
  igUserId?: string;
  igAccountId?: string;
}

async function readDmSettings(username: string): Promise<DmSettingsPeek | null> {
  try {
    const store = getStore({ name: "dm-automation", consistency: "strong" });
    return ((await store.get(`dm_${username}`, { type: "json" })) as DmSettingsPeek) || null;
  } catch {
    return null;
  }
}

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) return Response.json({ error: "Missing username" }, { status: 400 });

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  if (req.method === "GET") {
    const [jobs, contacts, settings] = await Promise.all([
      listScheduledJobs(username),
      listDmContacts(username),
      readDmSettings(username),
    ]);
    const now = new Date();
    return Response.json({
      jobs,
      // 화면이 "지금 보낼 수 있는지 / 언제까지 보낼 수 있는지"를 그릴 수 있게
      // 24시간 창 정보를 함께 내려준다.
      contacts: contacts.map((c) => ({
        ...c,
        open: withinDmWindow(c, now),
        openUntil: new Date(Date.parse(c.lastAt) + DM_WINDOW_MS).toISOString(),
      })),
      windowHours: DM_WINDOW_MS / 3_600_000,
      connected: Boolean(settings?.accessToken),
      masterEnabled: Boolean(settings?.enabled),
      entitled: await dmAutomationAllowed(username, auth.userId),
      requiredTier: DM_AUTOMATION_TIER,
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!(await dmAutomationAllowed(username, auth.userId))) {
    return Response.json(
      {
        error: DM_AUTOMATION_REQUIRED_MESSAGE,
        code: "DM_AUTOMATION_PLAN_REQUIRED",
        requiredTier: DM_AUTOMATION_TIER,
      },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as any;

  if (body?.action === "cancel") {
    const id = String(body?.id || "").trim();
    if (!id) return Response.json({ error: "취소할 예약 id 가 필요합니다." }, { status: 400 });
    const removed = await cancelScheduledJob(username, id);
    if (!removed) {
      return Response.json(
        {
          error: "이미 발송되었거나 취소된 예약입니다.",
          code: "NOT_PENDING",
          jobs: await listScheduledJobs(username),
        },
        { status: 409 },
      );
    }
    return Response.json({ success: true, jobs: await listScheduledJobs(username) });
  }

  if (body?.action !== "create") {
    return Response.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  }

  const settings = await readDmSettings(username);
  if (!settings?.accessToken) {
    return Response.json(
      { error: "인스타그램 계정을 먼저 연동해 주세요.", code: "NOT_CONNECTED" },
      { status: 400 },
    );
  }

  const recipientId = String(body?.recipientId || "").trim();
  if (!recipientId) {
    return Response.json({ error: "받는 사람을 선택해 주세요." }, { status: 400 });
  }

  /**
   * 대상은 명단에 있는 사람이어야 한다.
   *
   * 임의의 IGSID 를 받으면 이 기능이 곧 콜드 아웃리치 도구가 된다(인스타그램 정책
   * 위반이고, 앱 권한이 회수될 수 있는 사유다). 명단에 있다는 것은 그 사람이 이
   * 계정에 먼저 DM 을 보낸 적이 있다는 뜻이다.
   */
  const contact = await getDmContact(username, recipientId);
  if (!contact) {
    return Response.json(
      {
        error:
          "이 계정에 DM 을 보낸 적이 있는 사람에게만 예약할 수 있습니다. " +
          "인스타그램은 상대가 먼저 보낸 메시지에 대한 답장만 허용합니다.",
        code: "UNKNOWN_RECIPIENT",
      },
      { status: 400 },
    );
  }

  const sendAtMs = Date.parse(String(body?.sendAt || ""));
  if (Number.isNaN(sendAtMs)) {
    return Response.json({ error: "보낼 날짜·시간을 정확히 입력해 주세요." }, { status: 400 });
  }
  // 1분 전까지는 허용한다 — 화면에서 시간을 고르고 저장을 누르는 사이에 초 단위로
  // 과거가 되는 경우를 막을 수 없다.
  if (sendAtMs < Date.now() - 60_000) {
    return Response.json({ error: "지난 시각으로는 예약할 수 없습니다." }, { status: 400 });
  }
  if (sendAtMs > Date.now() + HORIZON_MS) {
    return Response.json(
      { error: "예약은 최대 30일 이내로만 걸 수 있습니다." },
      { status: 400 },
    );
  }

  const message = String(body?.message || "").slice(0, 1000);
  const buttons = (Array.isArray(body?.buttons) ? body.buttons : [])
    .slice(0, 3)
    .map((b: any) => ({
      label: String(b?.label || "").slice(0, 20),
      url: normalizeLinkUrl(String(b?.url || "")),
    }))
    .filter((b: { label: string; url: string }) => b.label && b.url);

  if (!message.trim() && buttons.length === 0) {
    return Response.json({ error: "보낼 내용을 입력해 주세요." }, { status: 400 });
  }

  const existing = await listScheduledJobs(username);
  if (existing.filter((j) => j.status === "pending").length >= PENDING_MAX) {
    return Response.json(
      { error: `예약은 최대 ${PENDING_MAX}건까지 걸 수 있습니다. 지난 예약을 정리해 주세요.` },
      { status: 400 },
    );
  }

  const job: DmScheduledJob = {
    id: genId(),
    username,
    recipientId,
    recipientName: contact.username || contact.name || undefined,
    sendAt: new Date(sendAtMs).toISOString(),
    message,
    buttons,
    createdAt: new Date().toISOString(),
    status: "pending",
    contactLastAt: contact.lastAt,
  };
  await createScheduledJob(job);

  /**
   * 24시간 창을 넘긴 예약이면 미리 알려준다.
   *
   * 막지는 않는다 — 그 사이 상대가 다시 메시지를 보내면 창이 열리고 정상 발송된다.
   * 다만 "예약은 걸렸는데 왜 안 갔는지" 를 나중에 궁금해하지 않도록, 지금 이유를
   * 함께 보여준다.
   */
  const willBeOpen = withinDmWindow(contact, new Date(sendAtMs));
  return Response.json({
    success: true,
    job,
    jobs: await listScheduledJobs(username),
    warning: willBeOpen
      ? undefined
      : "예약한 시각은 상대가 마지막으로 보낸 메시지로부터 24시간이 지난 뒤입니다. " +
        "인스타그램은 그 시점에 자유 형식 DM 을 허용하지 않으므로, 상대가 다시 메시지를 " +
        "보내지 않으면 발송이 실패로 기록됩니다.",
  });
};

export const config: Config = {
  path: "/api/dm-schedule/:username",
};
