import { getStore } from "@netlify/blobs";
import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { linkIsUsable, type MetaLink } from "./_shared/instagram-metrics.mts";
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
 * 여기서 하는 쓰기는 creator_follower_snapshots 한 줄뿐이다. 연동 토큰도,
 * creator_channels(브랜드가 보는 숫자)도 건드리지 않는다 — 이 배치가 다른 화면의
 * 숫자를 바꾸면, 밤사이에 브랜드 명단이 조용히 달라지는 일이 생긴다.
 *
 * 토큰이 죽은 계정은 조용히 건너뛴다. 재연동 표시를 남기는 일은 이미 매일 도는
 * 토큰 갱신 배치(scheduled-instagram-token-refresh)가 한다. 두 곳에서 같은 표시를
 * 다투어 쓰면 어느 쪽이 먼저 돌았는지에 따라 화면 안내가 달라진다.
 */

/** 훑을 보관함. 같은 사용자가 양쪽에 있으면 앞쪽(collab)을 쓴다. */
const SOURCES = [
  { store: "collab-instagram", prefix: "ig_" },
  { store: "dm-automation", prefix: "dm_" },
] as const;

/** 한 번의 실행에서 처리할 계정 수 상한. 실행 시간이 터지지 않게 둔다. */
const MAX_ACCOUNTS = 500;
/** 동시에 부를 계정 수. 메타 호출을 한 줄로 세우면 계정이 늘수록 실행이 길어진다. */
const CHUNK = 8;

export default async () => {
  const db = getDatabase();

  // 사용자명 → 쓸 연동. 먼저 담긴 쪽(collab)이 이긴다.
  const links = new Map<string, MetaLink>();

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
        links.set(username, link!);
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

  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async ([username, link]) => {
        try {
          const profile = await fetchProfileCounts(link);
          // 팔로워 수를 못 받았으면 남길 값이 없다. 0 을 남기면 그래프에 절벽이 생긴다.
          if (!profile.ok || profile.followers === null) {
            skipped++;
            return;
          }
          await recordFollowerSnapshot(db, username, profile.followers, profile.following, "batch");
          saved++;
        } catch (e) {
          failed++;
          console.error(`[follower-snapshot] ${username} 실패:`, (e as Error)?.message);
        }
      }),
    );
  }

  console.log(
    `[follower-snapshot] 완료 — 저장 ${saved}, 건너뜀 ${skipped}, 실패 ${failed} / 대상 ${entries.length}`,
  );
};

export const config: Config = {
  // 매일 한 번, 한국 시간 새벽 5시 15분(UTC 20:15). 토큰 갱신 배치(UTC 18:40)와
  // 시간을 벌려 두어 같은 순간에 메타를 두 배로 부르지 않게 한다.
  schedule: "15 20 * * *",
};
