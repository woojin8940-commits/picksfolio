import {
  cleanHandle,
  linkIsUsable,
  refreshStaleChannelImages,
  resolveSharedLink,
  syncChannelFromMeta,
} from "./instagram-metrics.mts";

/**
 * 판매 신청을 낸 인플루언서의 채널 정보(creator_channels)를 연동된 인스타 계정의
 * 지금 것으로 맞춘다.
 *
 * 어필리에이트 판매 신청은 "인스타 연동이 돼 있으면" 받는다. 그런데 연동은 자동 디엠 ·
 * 인사이트 · 브랜드 매칭받기가 함께 쓰는 하나라서, 자동 디엠 화면에서만 계정을 붙인
 * 사람은 연동은 됐어도 creator_channels 행이 한 번도 채워지지 않았을 수 있다. 또는
 * 예전에 다른 인스타 계정으로 채워 둔 행이 그대로 남아 있을 수 있다. 그러면 브랜드가
 * 보는 지원자 카드는
 *   - 인스타 사진 대신 픽스폴리오 페이지 아바타(전혀 다른 사진)를 보여 주거나,
 *   - 지난 계정의 사진 · 릴스를 보여 주거나,
 *   - 최근 릴스 자리를 통째로 비운다.
 *
 * 그래서 신청을 받을 때와 브랜드가 지원자 목록을 열 때 이 함수를 부른다. 아래 중
 * 하나라도 해당하면 메타에서 지표를 통째로 다시 받는다(syncChannelFromMeta).
 *   - 채널 행이 없다 / 연동 끊김으로 남아 있다
 *   - 행에 적힌 인스타 계정이 지금 연동된 계정과 다르다
 *   - 마지막으로 지표를 받은 지 하루가 넘었다
 * 나머지는 사진 · 썸네일 주소만 갈아 끼운다(refreshStaleChannelImages).
 *
 * 실패는 삼킨다 — 사진 한 장 때문에 신청이나 지원자 목록이 막히면 안 된다.
 */
const RESYNC_TTL_MS = 24 * 3600 * 1000;

function needsFullSync(row: any, link: any): boolean {
  if (!row || !row.connected) return true;

  const rowId = String(row.instagram_user_id || "").trim();
  const linkId = String(link?.igUserId || "").trim();
  if (rowId && linkId) {
    if (rowId !== linkId) return true;
  } else {
    const rowHandle = cleanHandle(row.instagram_handle).toLowerCase();
    const linkHandle = cleanHandle(link?.igUsername).toLowerCase();
    if (rowHandle && linkHandle && rowHandle !== linkHandle) return true;
  }

  // 사진 · 릴스가 비어 있어도 방금 받아 본 것이면 그 계정에 정말 없는 것이다.
  // 하루가 지났을 때만 다시 묻는다.
  const checked = Date.parse(String(row.metrics_checked_at || row.synced_at || ""));
  return !Number.isFinite(checked) || Date.now() - checked > RESYNC_TTL_MS;
}

export async function syncApplicantChannels(
  db: any,
  usernames: string[],
  { maxFullSync = 4 }: { maxFullSync?: number } = {},
): Promise<void> {
  const names = [
    ...new Set((usernames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean)),
  ];
  if (!names.length) return;

  let rows: any[] = [];
  try {
    rows = (await db.sql`
      SELECT username, connected, instagram_handle, instagram_user_id, profile_image,
             recent_reels, synced_at, metrics_checked_at
      FROM creator_channels WHERE username = ANY(${names})
    `) as any[];
  } catch (e) {
    console.warn("[applicant-sync] 채널 조회 실패:", (e as Error)?.message);
    return;
  }
  const rowBy = new Map<string, any>();
  for (const r of rows || []) rowBy.set(String(r.username || "").toLowerCase(), r);

  // 브랜드가 보는 화면이므로 "브랜드 매칭받기"를 끊어 둔 사람은 건드리지 않는다.
  const links = await Promise.all(
    names.map(async (name) => {
      try {
        const resolved = await resolveSharedLink(name, "collab");
        return { name, link: resolved.link, scope: resolved.scope };
      } catch {
        return { name, link: null, scope: null };
      }
    }),
  );

  const targets = links
    .filter((l) => linkIsUsable(l.link) && needsFullSync(rowBy.get(l.name), l.link))
    // 행이 아예 없거나 다른 계정인 사람이 먼저다 — 그 카드가 가장 틀려 보인다.
    .sort((a, b) => Number(!!rowBy.get(a.name)) - Number(!!rowBy.get(b.name)))
    .slice(0, Math.max(1, maxFullSync));

  const synced = new Set<string>();
  await Promise.all(
    targets.map(async (t) => {
      try {
        const result = await syncChannelFromMeta(db, t.name, t.link!, t.scope || "dm");
        if (result.ok) synced.add(t.name);
        else console.warn(`[applicant-sync] ${t.name} 동기화 실패:`, "error" in result ? result.error : "");
      } catch (e) {
        console.warn(`[applicant-sync] ${t.name} 동기화 실패:`, (e as Error)?.message);
      }
    }),
  );

  // 방금 통째로 받은 사람은 빼고, 나머지는 사진 · 썸네일 주소만 오래된 것을 갈아 끼운다.
  const rest = names.filter((n) => !synced.has(n));
  if (rest.length) await refreshStaleChannelImages(db, rest).catch(() => 0);
}

/** 정해진 시간 안에 끝나면 기다리고, 넘으면 응답을 먼저 보낸다(일은 계속 돈다). */
export async function withinTime(task: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    task.catch(() => {}),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }),
  ]);
  clearTimeout(timer);
}
