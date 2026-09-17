import { getStore } from "@netlify/blobs";
import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import {
  applyFollowerCounts,
  applyRenamedHandle,
  linkIsUsable,
  syncChannelFromMeta,
  type MetaLink,
  type MetaLinkScope,
} from "./_shared/instagram-metrics.mts";
import { fetchProfileCounts, recordFollowerSnapshot } from "./_shared/creator-insights.mts";

/**
 * 팔로워 수 일별 스냅샷 배치.
 *
 * 인스타그램은 "지금 팔로워 몇 명"만 알려주고 어제 몇 명이었는지는 알려주지 않는다.
 * 그래서 증감 추이는 우리가 매일 한 줄씩 남겨 두는 것 말고는 만들 방법이 없다.
 * 배치를 켠 날부터만 그래프가 생기므로, 화면보다 이쪽이 먼저 돌기 시작해야 한다.
 *
 * 대상은 이미 연동돼 있는 계정 전부다. 보관함이 두 곳이라(캠페인 등록 collab,
 * 디엠 자동화 dm) 양쪽을 훑고 같은 사용자는 한 번만 처리한다 — 같은 사람의 하루에
 * 두 줄이 필요하지 않고, collab 연동이 있으면 그 계정이 본인이 고른 계정이다.
 *
 * ── 무엇을 쓰는가 ──
 *
 * ① creator_follower_snapshots — 오늘의 팔로워 수 한 줄(이 배치의 본래 목적).
 *
 * ② creator_channels 의 팔로워·팔로잉(applyFollowerCounts). 처음에는 이 표를 일부러
 *    건드리지 않았다 — 밤사이에 브랜드 명단의 숫자가 조용히 달라지지 않게 하려는
 *    뜻이었다. 그 대가가 컸다. 명단 행의 팔로워 수는 인플루언서가 연동한 날 또는
 *    본인이 '갱신'을 누른 날에만 채워지므로, 담당자·운영자 대시보드는 몇 달 전
 *    숫자를 지금 숫자처럼 보여 줬다. 명단에서 보는 숫자가 틀린 것이 명단에서 보는
 *    숫자가 달라지는 것보다 나쁘다. 팔로워 수는 ①을 위해 이미 받아 온 값이라 이
 *    쓰기에 메타 호출은 한 건도 늘지 않는다.
 *
 * ③ 지표 전체를 다시 받아 오는 순환 재동기화(syncChannelFromMeta) — 하루에 정해진
 *    수만큼. 팔로워 수와 달리 최근 릴스·피드 목록은 프로필 한 번으로 오지 않고,
 *    받아 두지 않으면 인플루언서가 지운 게시물이 명단과 진행사항 카드에 계속 남는다
 *    (그림 주소만 갈아 끼우는 가벼운 길은 사라진 게시물을 일부러 건드리지 않는다 —
 *    remirrorChannelMedia 주석). 연동된 계정 전부를 매일 그렇게 훑을 수는 없으므로
 *    마지막 동기화가 가장 오래된 계정부터 차례로 돌린다. 며칠이면 한 바퀴가 돈다.
 *
 * 연동 토큰은 건드리지 않는다.
 *
 * 팔로워 수를 물어보는 같은 호출에 지금 인스타 아이디(@이름)가 함께 실려 오는데,
 * 그 이름이 바뀌었으면 여기서 반영한다. 이름은 숫자가 아니라 "이 계정이 누구인가"이고,
 * 틀린 이름은 명단에서 없는 계정을 가리키는 링크가 된다. 연동해 둔 계정 전부를 매일
 * 한 번 훑는 곳이 여기뿐이라, 이 자리에서 확인하지 않으면 이름을 바꾼 사람은 다시
 * 연동할 때까지 옛 이름으로 남는다(applyRenamedHandle).
 *
 * 토큰이 죽은 계정은 조용히 건너뛴다. 재연동 표시를 남기는 일은 이미 매일 도는
 * 토큰 갱신 배치(scheduled-instagram-token-refresh)가 한다. 두 곳에서 같은 표시를
 * 다투어 쓰면 어느 쪽이 먼저 돌았는지에 따라 화면 안내가 달라진다.
 */

/** 훑을 보관함. 같은 사용자가 양쪽에 있으면 앞쪽(collab)을 쓴다. */
const SOURCES = [
  { store: "collab-instagram", prefix: "ig_", scope: "collab" },
  { store: "dm-automation", prefix: "dm_", scope: "dm" },
] as const;

/** 한 번의 실행에서 처리할 계정 수 상한. 실행 시간이 터지지 않게 둔다. */
const MAX_ACCOUNTS = 500;
/** 동시에 부를 계정 수. 메타 호출을 한 줄로 세우면 계정이 늘수록 실행이 길어진다. */
const CHUNK = 8;
/**
 * 한 번의 실행에서 지표를 통째로 다시 받을 계정 수 상한.
 *
 * 팔로워 수 한 건(프로필 호출 하나)과 지표 전체(미디어 목록 + 릴스 인사이트 +
 * 새 썸네일 사본)는 같은 무게가 아니다. 전부를 매일 돌리면 실행 시간이 터지고,
 * 절반만 끝난 실행은 어느 계정이 갱신됐는지 알 수 없는 상태를 남긴다. 그래서
 * 오래된 순서로 정해진 수만큼만 돌린다 — 지운 게시물이 명단에서 사라지는 데
 * 며칠이 걸릴 수 있지만, 영원히 남는 것과는 다르다.
 */
const MAX_FULL_SYNC = 60;
/** 지표 전체 동기화를 동시에 돌릴 계정 수. 팔로워 조회보다 무거워 좁게 잡는다. */
const FULL_SYNC_CHUNK = 4;

export default async () => {
  const db = getDatabase();

  // 사용자명 → 쓸 연동. 먼저 담긴 쪽(collab)이 이긴다.
  const links = new Map<string, { link: MetaLink; scope: MetaLinkScope }>();

  for (const source of SOURCES) {
    try {
      const store = getStore({ name: source.store, consistency: "eventual" });
      const { blobs } = await store.list({ prefix: source.prefix });
      for (const blob of blobs) {
        const username = blob.key.slice(source.prefix.length).toLowerCase();
        if (!username || links.has(username)) continue;
        const link = (await store.get(blob.key, { type: "json" })) as MetaLink | null;
        // 토큰이 죽은 연동은 부르면 실패한다. 재연동은 사람이 해야 하는 일이다.
        if (!linkIsUsable(link)) continue;
        links.set(username, { link: link!, scope: source.scope });
        if (links.size >= MAX_ACCOUNTS) break;
      }
    } catch (e) {
      console.error(`[follower-snapshot] ${source.store} 목록 실패:`, (e as Error)?.message);
    }
    if (links.size >= MAX_ACCOUNTS) break;
  }

  if (links.size === 0) {
    console.log("[follower-snapshot] 연동된 계정이 없다 — 남길 것이 없음");
    return;
  }

  const entries = [...links.entries()];
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  let renamed = 0;
  let moved = 0;

  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async ([username, { link, scope }]) => {
        try {
          const profile = await fetchProfileCounts(link);
          // 이름이 바뀐 것은 팔로워 수를 못 받은 경우와 따로 본다. 실패한 응답의
          // 이름은 지금 값을 그대로 돌려준 것이라 비교할 값이 아니다.
          if (profile.ok) {
            const rename = await applyRenamedHandle(db, username, scope, link, profile.igUsername);
            if (rename.changed) renamed++;
          }
          // 팔로워 수를 못 받았으면 남길 값이 없다. 0 을 남기면 그래프에 절벽이 생긴다.
          if (!profile.ok || profile.followers === null) {
            skipped++;
            return;
          }
          await recordFollowerSnapshot(db, username, profile.followers, profile.following, "batch");
          saved++;
          // 방금 받은 숫자를 브랜드·담당자가 보는 명단 행에도 옮긴다(위 ② 참고).
          // 메타를 다시 부르지 않으므로 이 배치가 길어지지 않는다.
          if (await applyFollowerCounts(db, username, profile.followers, profile.following)) {
            moved++;
          }
        } catch (e) {
          failed++;
          console.error(`[follower-snapshot] ${username} 실패:`, (e as Error)?.message);
        }
      }),
    );
  }

  /*
   * 지표 전체 순환 재동기화(위 ③).
   *
   * 대상은 위에서 쓸 수 있는 연동을 찾아 둔 계정 중, 명단 행이 있고 연동이 살아
   * 있는 계정이다. 마지막으로 **물어본** 시각이 오래된 순서로 고른다(한 번도 받은
   * 적이 없는 행이 가장 먼저다). 받아 온 시각(synced_at)으로 줄을 세우면 메타가
   * 실패를 돌려주는 계정이 영원히 맨 앞에 남아 뒤에 선 계정은 차례가 오지 않는다.
   * 실패는 계정별로 삼킨다 — 한 계정의 토큰 문제로 나머지 순서가 밀리면 그
   * 계정들은 하루를 더 낡은 채로 보낸다.
   */
  const linked = new Map(entries);
  let resynced = 0;
  let resyncFailed = 0;
  try {
    const due = (await db.sql`
      SELECT username
      FROM creator_channels
      WHERE username = ANY(${[...linked.keys()]})
        AND connected = TRUE
      ORDER BY metrics_checked_at ASC NULLS FIRST
      LIMIT ${MAX_FULL_SYNC}
    `) as any[];

    for (let i = 0; i < due.length; i += FULL_SYNC_CHUNK) {
      const slice = due.slice(i, i + FULL_SYNC_CHUNK);
      await Promise.all(
        slice.map(async (row) => {
          const username = String(row?.username || "").toLowerCase();
          const entry = linked.get(username);
          if (!entry) return;
          try {
            const result = await syncChannelFromMeta(db, username, entry.link, entry.scope);
            if (result.ok) resynced++;
            else resyncFailed++;
          } catch (e) {
            resyncFailed++;
            console.error(`[follower-snapshot] ${username} 지표 동기화 실패:`, (e as Error)?.message);
          }
        }),
      );
    }
  } catch (e) {
    console.error("[follower-snapshot] 재동기화 대상 조회 실패:", (e as Error)?.message);
  }

  console.log(
    `[follower-snapshot] 완료 — 저장 ${saved}, 건너뜀 ${skipped}, 실패 ${failed}, ` +
      `아이디 변경 ${renamed}, 명단 반영 ${moved} / 대상 ${entries.length} · ` +
      `지표 재동기화 ${resynced}건(실패 ${resyncFailed})`,
  );
};

export const config: Config = {
  // 매일 한 번, 한국 시간 새벽 5시 15분(UTC 20:15). 토큰 갱신 배치(UTC 18:40)와
  // 시간을 벌려 두어 같은 순간에 메타를 두 배로 부르지 않게 한다.
  schedule: "15 20 * * *",
};
