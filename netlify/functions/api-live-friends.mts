import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";

/**
 * Co-broadcast friends ("함께 방송할 친구") — a per-creator list of saved partners
 * so a host can invite someone from a list instead of retyping their username
 * every time. Friendships are added by USERNAME: usernames are globally unique
 * in this app (they are the profile/link name), so there is no ambiguity about
 * who is being added — the username is the identity.
 *
 * Adding a friend is a two-step REQUEST → ACCEPT flow: the requester sends a
 * request (a `pending` row where owner=requester, friend=recipient); the
 * recipient sees it as an incoming request and accepts (flips it to `accepted`)
 * or declines (deletes it). Only accepted rows count as mutual friends and show
 * in both users' lists — regardless of who originally sent the request.
 *
 * Routes (all under /api/live/friends):
 *   GET    ?owner=<username>                          → { friends, incoming, outgoing }
 *   POST   { owner, friendUsername }                  → send a friend request
 *   POST   { owner, friendUsername, action:'accept' } → owner accepts a request from friendUsername
 *   POST   { owner, friendUsername, action:'decline'} → owner declines a request from friendUsername
 *   DELETE ?owner=<username>&friend=<username>        → remove a friend (either direction)
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

/** True when a creator account exists for this username. */
async function userExists(db: ReturnType<typeof getDatabase>, username: string): Promise<boolean> {
  const rows = (await db.sql`
    SELECT 1 FROM site_data WHERE username = ${username} LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const owner = norm(url.searchParams.get("owner"));
      if (!owner) return Response.json({ error: "owner required" }, { status: 400 });

      // Accepted friendships are mutual: owner may be on either side of the edge.
      const acceptedRows = (await db.sql`
        SELECT owner_username, friend_username, created_at
        FROM live_friends
        WHERE status = 'accepted' AND (owner_username = ${owner} OR friend_username = ${owner})
        ORDER BY created_at DESC
      `) as { owner_username: string; friend_username: string; created_at: string }[];

      // Incoming requests: someone asked to be THIS user's friend, awaiting them.
      const incomingRows = (await db.sql`
        SELECT owner_username AS requester, created_at
        FROM live_friends
        WHERE status = 'pending' AND friend_username = ${owner}
        ORDER BY created_at DESC
      `) as { requester: string; created_at: string }[];

      // Outgoing requests: this user asked others, awaiting their acceptance.
      const outgoingRows = (await db.sql`
        SELECT friend_username AS recipient, created_at
        FROM live_friends
        WHERE status = 'pending' AND owner_username = ${owner}
        ORDER BY created_at DESC
      `) as { recipient: string; created_at: string }[];

      // The "other" party on each accepted edge is the friend.
      const friendNames = acceptedRows.map((r) =>
        r.owner_username === owner ? r.friend_username : r.owner_username
      );
      const allNames = Array.from(
        new Set([
          ...friendNames,
          ...incomingRows.map((r) => r.requester),
          ...outgoingRows.map((r) => r.recipient),
        ])
      );
      const info = await profilesFor(db, allNames);
      const decorate = (username: string, created_at: string) => ({
        username,
        display_name: info.get(username)?.display_name || username,
        avatar_url: info.get(username)?.avatar_url || "",
        created_at,
      });

      return Response.json({
        friends: acceptedRows.map((r, i) => decorate(friendNames[i], r.created_at)),
        incoming: incomingRows.map((r) => decorate(r.requester, r.created_at)),
        outgoing: outgoingRows.map((r) => decorate(r.recipient, r.created_at)),
      });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        owner?: string;
        friendUsername?: string;
        action?: string;
      };
      const owner = norm(body.owner);
      const friend = norm(body.friendUsername);
      const action = String(body.action || "request");

      if (!owner || !friend) {
        return Response.json({ error: "owner and friendUsername required" }, { status: 400 });
      }
      if (owner === friend) {
        return Response.json({ error: "자기 자신은 친구로 추가할 수 없습니다." }, { status: 400 });
      }
      if (!(await userExists(db, friend))) {
        return Response.json(
          { error: "해당 유저네임을 찾을 수 없습니다. 정확한 유저네임인지 확인해 주세요." },
          { status: 404 }
        );
      }

      const friendInfo = await profilesFor(db, [friend]);
      const friendCard = {
        username: friend,
        display_name: friendInfo.get(friend)?.display_name || friend,
        avatar_url: friendInfo.get(friend)?.avatar_url || "",
      };

      // owner ACCEPTS a request that friend sent them.
      if (action === "accept") {
        await db.sql`
          UPDATE live_friends
          SET status = 'accepted', updated_at = now()
          WHERE owner_username = ${friend} AND friend_username = ${owner} AND status = 'pending'
        `;
        return Response.json({ success: true, accepted: true, friend: friendCard });
      }

      // owner DECLINES a request that friend sent them.
      if (action === "decline") {
        await db.sql`
          DELETE FROM live_friends
          WHERE owner_username = ${friend} AND friend_username = ${owner} AND status = 'pending'
        `;
        return Response.json({ success: true, declined: true });
      }

      // Default: owner SENDS a friend request to friend.
      // Already friends (either direction)? Nothing to do.
      const existingAccepted = (await db.sql`
        SELECT 1 FROM live_friends
        WHERE status = 'accepted'
          AND ((owner_username = ${owner} AND friend_username = ${friend})
            OR (owner_username = ${friend} AND friend_username = ${owner}))
        LIMIT 1
      `) as unknown[];
      if (existingAccepted.length > 0) {
        return Response.json({ success: true, alreadyFriends: true, friend: friendCard });
      }

      // The other person already requested us? Accept theirs instead of creating
      // a second, mirror-image pending row.
      const reversePending = (await db.sql`
        SELECT 1 FROM live_friends
        WHERE owner_username = ${friend} AND friend_username = ${owner} AND status = 'pending'
        LIMIT 1
      `) as unknown[];
      if (reversePending.length > 0) {
        await db.sql`
          UPDATE live_friends
          SET status = 'accepted', updated_at = now()
          WHERE owner_username = ${friend} AND friend_username = ${owner} AND status = 'pending'
        `;
        return Response.json({ success: true, accepted: true, friend: friendCard });
      }

      // Create (or keep) the pending request.
      await db.sql`
        INSERT INTO live_friends (owner_username, friend_username, status)
        VALUES (${owner}, ${friend}, 'pending')
        ON CONFLICT (owner_username, friend_username) DO NOTHING
      `;
      return Response.json({ success: true, requested: true, friend: friendCard });
    }

    if (req.method === "DELETE") {
      const owner = norm(url.searchParams.get("owner"));
      const friend = norm(url.searchParams.get("friend"));
      if (!owner || !friend) {
        return Response.json({ error: "owner and friend required" }, { status: 400 });
      }
      // Remove the friendship (or a pending request) regardless of direction.
      await db.sql`
        DELETE FROM live_friends
        WHERE (owner_username = ${owner} AND friend_username = ${friend})
           OR (owner_username = ${friend} AND friend_username = ${owner})
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
