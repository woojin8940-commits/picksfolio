import type { Config } from "@netlify/functions";
import { readMetaAdsToken } from "./_shared/meta-ads.mts";
import {
  graphGet,
  isMissingObject,
  isReconnectError,
  graphObjectError,
  listAdRecordOwners,
  readAdRecords,
  readRejectionNotices,
  writeRejectionNotices,
  withAdRecordLock,
  type MetaAdRecord,
} from "./_shared/meta-ads-graph.mts";
import { sendPushToUser } from "./_shared/push.mts";
import { todayInSeoul } from "./_shared/campaign-recruit.mts";

/**
 * 광고 반려 점검 (30분마다).
 *
 * 광고 현황 화면은 메타가 광고를 반려하면 "반려됨"을 정확히 보여 주지만, 브랜드가 그
 * 화면을 다시 열어야만 안다. 반려된 광고는 노출 0인 채로 예산만 묶여 있으므로, 이
 * 작업이 브랜드가 집행한 광고의 상태를 메타에서 읽어 반려(DISAPPROVED)로 바뀐 광고를
 * 찾으면 앱 푸시로 알린다.
 *
 * 같은 광고의 반려는 한 번만 알린다(ads_rejected_<아이디>에 광고 ID를 남긴다). 광고를
 * 고쳐 다시 승인되면 표시를 지워, 다음에 또 반려되면 다시 알린다.
 *
 * 알림톡은 보내지 않는다 — 광고 반려용으로 승인된 템플릿이 없어 보내면 대체 문자로
 * 떨어진다(_shared/alimtalk-templates.mts). 템플릿이 승인되면 여기에 붙인다.
 */

/** 종료일이 이만큼 지난 광고는 더 보지 않는다. 끝난 광고의 반려는 알려도 할 일이 없다. */
const ENDED_GRACE_DAYS = 1;

const daysBefore = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** 광고 ID 들의 지금 상태. 하나라도 지워졌으면 묶음이 실패하므로 그때만 하나씩 읽는다. */
async function readStatuses(token: string, proof: string, ids: string[]) {
  const fields = "id,effective_status,ad_review_feedback";
  const rows: Record<string, any> = {};
  let reconnectRequired = false;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await graphGet("", token, { ids: batch.join(","), fields }, proof);
    if (res.ok) {
      for (const id of batch) {
        const row = res.data?.[id];
        const error = graphObjectError(row);
        if (error) {
          reconnectRequired ||= isReconnectError(error);
          continue;
        }
        if (row && String(row.id) === id && row.effective_status) rows[id] = row;
      }
      if (reconnectRequired) break;
      continue;
    }
    reconnectRequired ||= isReconnectError(res);
    if (reconnectRequired) break;
    if (!isMissingObject(res)) {
      console.warn(`[meta-ads-review] 상태 조회 실패: ${res.error}`);
      continue;
    }
    for (const id of batch) {
      const one = await graphGet(id, token, { fields }, proof);
      if (one.ok) rows[id] = one.data;
      reconnectRequired ||= isReconnectError(one);
      if (reconnectRequired) break;
    }
  }
  return { rows, reconnectRequired };
}

const reasonOf = (row: any): string => {
  const global = row?.ad_review_feedback?.global;
  const first = global && typeof global === "object" ? Object.values(global).map(String)[0] || "" : "";
  return first.trim().slice(0, 120);
};

async function checkAccount(username: string, today: string): Promise<number> {
  return (await withAdRecordLock(username, '__meta_ads_review__', () => checkAccountLocked(username, today))) ?? 0;
}

async function checkAccountLocked(username: string, today: string): Promise<number> {
  const cutoff = daysBefore(today, ENDED_GRACE_DAYS);
  const records = (await readAdRecords(username)).filter(
    (r: MetaAdRecord) => r.step === "done" && r.adId && (!r.endDate || r.endDate >= cutoff),
  );
  if (records.length === 0) return 0;

  const stored = await readMetaAdsToken(username);
  const notices = await readRejectionNotices(username);
  const notifyReconnect = async () => {
    if (notices.__reconnect__) return 0;
    const delivered = await sendPushToUser(username, {
      title: 'Meta 광고 계정을 다시 연동해 주세요',
      body: '광고 계정 연결 또는 권한을 확인하지 못했습니다. 광고 현황에서 다시 연동해 주세요.',
      data: { type: 'meta_ads_reconnect', path: '/business-admin?tab=ads' },
    });
    if (!delivered) return 0;
    notices.__reconnect__ = new Date().toISOString();
    await writeRejectionNotices(username, notices);
    return 1;
  };
  if (!stored.ok) return stored.reason === 'missing' ? 0 : notifyReconnect();
  const { rows, reconnectRequired } = await readStatuses(stored.token, stored.proof, records.map((r) => r.adId!));
  if (reconnectRequired) return notifyReconnect();
  let changed = false;
  let sent = 0;
  if (Object.keys(rows).length && notices.__reconnect__) {
    delete notices.__reconnect__;
    changed = true;
  }

  for (const r of records) {
    const row = rows[r.adId!];
    if (!row) continue;
    const rejected = String(row.effective_status || "") === "DISAPPROVED";
    if (!rejected) {
      if (notices[r.adId!]) {
        delete notices[r.adId!];
        changed = true;
      }
      continue;
    }
    if (notices[r.adId!]) continue;

    const name = (r.campaignTitle || r.name || "광고").slice(0, 60);
    const reason = reasonOf(row);
    try {
      const delivered = await sendPushToUser(username, {
        title: "광고가 메타 심사에서 반려됐어요",
        body: reason
          ? `'${name}' 광고가 반려되어 노출되지 않고 있어요. 사유: ${reason}`
          : `'${name}' 광고가 반려되어 노출되지 않고 있어요. 광고 현황에서 사유를 확인해 주세요.`,
        data: { type: "meta_ad_rejected", adId: r.adId, path: "/business-admin?tab=ads" },
      });
      if (!delivered) continue;
    } catch (e) {
      console.error(`[meta-ads-review] 푸시 실패 (${username}):`, e);
      continue;
    }
    notices[r.adId!] = new Date().toISOString();
    changed = true;
    sent += 1;
  }

  // 지금 보지 않는 광고(끝났거나 기록에서 지워진 것)의 표시는 정리한다.
  const watching = new Set(records.map((r) => r.adId!));
  for (const adId of Object.keys(notices)) {
    if (adId !== "__reconnect__" && !watching.has(adId)) {
      delete notices[adId];
      changed = true;
    }
  }
  if (changed) await writeRejectionNotices(username, notices);
  return sent;
}

export default async () => {
  const today = todayInSeoul();
  let owners: string[] = [];
  try {
    owners = await listAdRecordOwners();
  } catch (e) {
    console.error("[meta-ads-review] 광고 기록 목록을 읽지 못했습니다:", e);
    return;
  }

  let sent = 0;
  for (const username of owners) {
    try {
      sent += await checkAccount(username, today);
    } catch (e) {
      console.error(`[meta-ads-review] ${username} 점검 실패:`, e);
    }
  }
  console.log(`[meta-ads-review] ${owners.length}개 계정 점검, 반려 알림 ${sent}건`);
};

export const config: Config = {
  schedule: "17,47 * * * *",
};
