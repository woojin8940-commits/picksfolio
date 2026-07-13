import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";

/**
 * Co-broadcast friends ("함께 방송할 친구") — a per-creator list of saved partners
 * so a host can invite someone from a list instead of retyping their username
 * every time. Friendships are added by USERNAME: usernames are globally unique
 * in this app (they are the profile/link name), so there is no ambiguity about
 * who is being added — the username is the identity.
 *
 * Routes (all under /api/live/friends):
 *   GET    ?owner=<username>                 → list saved friends (+ profile info)
 *   POST   { owner, friendUsername }         → add a friend by username
 *   DELETE ?owner=<username>&friend=<username> → remove a friend
 */

const norm = (v: unknown) =>
  String(v ?? "").trim().toLowerCase().replace(/^biz\//, "");

/** Look up display info (name/avatar) for a set of usernames from site_data. */
async function profilesFor(db: ReturnType<typeof getDatabase>, usernames: string[]) {
  if (usernames.length === 0) return new Map<string, { display_name: string; avatar_url: string }>();
  const rows = (await db.sql`
    SELECT username, data
    FROM site_data
    WHERE username = ANY(${usernames})
  `) as { username: string; data: any }[];
  const map = new Map<string, { display_name: string; avatar_url: string }>();
  for (const row of rows) {
    const d = row.data || {};
    map.set(row.username, {
      display_name: d.profile?.name || row.username,
      avatar_url: d.profile?.avatar_url || "",
    });
  }
  return map;
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const owner = norm(url.searchParams.get("owner"));
      if (!owner) return Response.json({ error: "owner required" }, { status: 400 });

      const rows = (await db.sql`
        SELECT friend_username, created_at
        FROM live_friends
        WHERE owner_username = ${owner}
        ORDER BY created_at DESC
      `) as { friend_username: string; created_at: string }[];

      const info = await profilesFor(db, rows.map((r) => r.friend_username));
      const friends = rows.map((r) => ({
        username: r.friend_username,
        display_name: info.get(r.friend_username)?.display_name || r.friend_username,
        avatar_url: info.get(r.friend_username)?.avatar_url || "",
        created_at: r.created_at,
      }));
      return Response.json({ friends });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        owner?: string;
        friendUsername?: string;
      };
      const owner = norm(body.owner);
      const friend = norm(body.friendUsername);

      if (!owner || !friend) {
        return Response.json({ error: "owner and friendUsername required" }, { status: 400 });
      }
      if (owner === friend) {
        return Response.json({ error: "자기 자신은 친구로 추가할 수 없습니다." }, { status: 400 });
      }
      // A basic sanity check on the username shape (usernames are the app's unique
      // identity). We intentionally do NOT hard-reject when the target has no
      // site_data row: signup writes that row inside a best-effort try/catch, so a
      // legitimate creator can be missing it — and rejecting here was the reason
      // "친구 추가가 안 된다". If the account genuinely doesn't exist the follow-up
      // invite step surfaces that; saving the friend by username is harmless and
      // the host can remove a typo from the list.
      if (friend.length < 3 || !/^[a-z0-9._-]+$/.test(friend)) {
        return Response.json(
          { error: "올바른 유저네임을 입력해 주세요." },
          { status: 400 }
        );
      }

      await db.sql`
        INSERT INTO live_friends (owner_username, friend_username)
        VALUES (${owner}, ${friend})
        ON CONFLICT (owner_username, friend_username) DO NOTHING
      `;

      const info = await profilesFor(db, [friend]);
      return Response.json({
        success: true,
        friend: {
          username: friend,
          display_name: info.get(friend)?.display_name || friend,
          avatar_url: info.get(friend)?.avatar_url || "",
        },
      });
    }

    if (req.method === "DELETE") {
      const owner = norm(url.searchParams.get("owner"));
      const friend = norm(url.searchParams.get("friend"));
      if (!owner || !friend) {
        return Response.json({ error: "owner and friend required" }, { status: 400 });
      }
      await db.sql`
        DELETE FROM live_friends
        WHERE owner_username = ${owner} AND friend_username = ${friend}
      `;
      return Response.json({ success: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (err: any) {
    console.error("[api-live-friends] failed:", err);
    return Response.json({ error: err?.message || "Request failed" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/live/friends",
};
