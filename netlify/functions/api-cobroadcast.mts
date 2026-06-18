import { getDatabase } from "@netlify/database";
import type { Config } from "@netlify/functions";
import { sendPushToUser } from "./_shared/push.mts";

/**
 * Co-broadcast sessions ("함께 방송하기") — the lightweight record that ties two
 * creator channels into one shared broadcast and tracks the invite lifecycle.
 *
 * Method A: each host keeps broadcasting on their own channel exactly as before;
 * this session only records WHICH two channels belong together and what stage
 * the invite is in, so the partner host (and every viewer) can discover the
 * other channel. Media never flows through here.
 *
 * Lifecycle: pending → accepted → live → ended  (or pending → declined).
 *
 * Routes (all under /api/cobroadcast):
 *   GET ?incoming=<username>  → pending invites addressed to this user (guest)
 *   GET ?active=<username>    → the user's current accepted/live session, if any
 *   GET ?channel=<username>   → active session for a broadcaster channel + the
 *                               partner channel (used by viewers for split view)
 *   POST { action, ... }      → invite | accept | decline | live | end
 */

const norm = (v: unknown) =>
  String(v ?? "").trim().toLowerCase().replace(/^biz\//, "");

async function profilesFor(db: ReturnType<typeof getDatabase>, usernames: string[]) {
  const uniq = [...new Set(usernames.filter(Boolean))];
  const map = new Map<string, { display_name: string; avatar_url: string }>();
  if (uniq.length === 0) return map;
  const rows = (await db.sql`
    SELECT username, data FROM site_data WHERE username = ANY(${uniq})
  `) as { username: string; data: any }[];
  for (const row of rows) {
    const d = row.data || {};
    map.set(row.username, {
      display_name: d.profile?.name || row.username,
      avatar_url: d.profile?.avatar_url || "",
    });
  }
  return map;
}

async function userExists(db: ReturnType<typeof getDatabase>, username: string): Promise<boolean> {
  const rows = (await db.sql`SELECT 1 FROM site_data WHERE username = ${username} LIMIT 1`) as unknown[];
  return rows.length > 0;
}

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      // Pending invites addressed to a user (the invitee polls this).
      const incoming = norm(url.searchParams.get("incoming"));
      if (incoming) {
        const rows = (await db.sql`
          SELECT id, host_username, guest_username, invite_token, status, created_at
          FROM cobroadcast_sessions
          WHERE guest_username = ${incoming} AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 10
        `) as any[];
        const info = await profilesFor(db, rows.map((r) => r.host_username));
        return Response.json({
          invites: rows.map((r) => ({
            id: r.id,
            host: r.host_username,
            host_display_name: info.get(r.host_username)?.display_name || r.host_username,
            host_avatar_url: info.get(r.host_username)?.avatar_url || "",
            invite_token: r.invite_token,
            created_at: r.created_at,
          })),
        });
      }

      // The user's own current accepted/live session (host or guest side).
      const active = norm(url.searchParams.get("active"));
      if (active) {
        const rows = (await db.sql`
          SELECT id, host_username, guest_username, status, invite_token, started_at
          FROM cobroadcast_sessions
          WHERE (host_username = ${active} OR guest_username = ${active})
            AND status IN ('accepted', 'live')
          ORDER BY updated_at DESC
          LIMIT 1
        `) as any[];
        if (rows.length === 0) return Response.json({ session: null });
        const r = rows[0];
        const partner = r.host_username === active ? r.guest_username : r.host_username;
        const info = await profilesFor(db, [partner]);
        return Response.json({
          session: {
            id: r.id,
            status: r.status,
            role: r.host_username === active ? "host" : "guest",
            partner,
            partner_display_name: info.get(partner)?.display_name || partner,
            partner_avatar_url: info.get(partner)?.avatar_url || "",
          },
        });
      }

      // Partner channel for a broadcaster (viewers use this for split view). Only
      // surfaces a partner once the session is actually live, so viewers don't
      // try to subscribe to a channel that isn't broadcasting yet.
      const channel = norm(url.searchParams.get("channel"));
      if (channel) {
        const rows = (await db.sql`
          SELECT id, host_username, guest_username, status
          FROM cobroadcast_sessions
          WHERE (host_username = ${channel} OR guest_username = ${channel})
            AND status = 'live'
          ORDER BY updated_at DESC
          LIMIT 1
        `) as any[];
        if (rows.length === 0) return Response.json({ partner: null });
        const r = rows[0];
        const partner = r.host_username === channel ? r.guest_username : r.host_username;
        const info = await profilesFor(db, [partner]);
        return Response.json({
          partner,
          partner_display_name: info.get(partner)?.display_name || partner,
          partner_avatar_url: info.get(partner)?.avatar_url || "",
          sessionId: r.id,
        });
      }

      return Response.json({ error: "missing query" }, { status: 400 });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        action?: string;
        host?: string;
        guest?: string;
        user?: string;
        sessionId?: string;
      };
      const action = String(body.action || "");

      if (action === "invite") {
        const host = norm(body.host);
        const guest = norm(body.guest);
        if (!host || !guest) return Response.json({ error: "host and guest required" }, { status: 400 });
        if (host === guest) return Response.json({ error: "자기 자신은 초대할 수 없습니다." }, { status: 400 });
        if (!(await userExists(db, guest))) {
          return Response.json(
            { error: "해당 유저네임을 찾을 수 없습니다. 정확한 유저네임인지 확인해 주세요." },
            { status: 404 }
          );
        }

        // Reuse an existing open invite/session between these two instead of
        // stacking duplicates if the host taps invite twice.
        const existing = (await db.sql`
          SELECT id, status FROM cobroadcast_sessions
          WHERE host_username = ${host} AND guest_username = ${guest}
            AND status IN ('pending', 'accepted', 'live')
          ORDER BY created_at DESC LIMIT 1
        `) as any[];
        if (existing.length > 0) {
          return Response.json({ success: true, sessionId: existing[0].id, status: existing[0].status });
        }

        const id = crypto.randomUUID();
        const token = crypto.randomUUID().replace(/-/g, "");
        await db.sql`
          INSERT INTO cobroadcast_sessions (id, host_username, guest_username, status, invite_token)
          VALUES (${id}, ${host}, ${guest}, 'pending', ${token})
        `;

        const info = await profilesFor(db, [host]);
        const hostName = info.get(host)?.display_name || host;
        sendPushToUser(guest, {
          title: "함께 방송 초대",
          body: `${hostName}님이 함께 방송하자고 초대했어요.`,
          data: { type: "cobroadcast_invite", sessionId: id, host, path: "/golive" },
        }).catch(() => {});

        return Response.json({ success: true, sessionId: id, status: "pending", invite_token: token });
      }

      const sessionId = String(body.sessionId || "");
      const user = norm(body.user);
      if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });

      const rows = (await db.sql`
        SELECT id, host_username, guest_username, status FROM cobroadcast_sessions WHERE id = ${sessionId} LIMIT 1
      `) as any[];
      if (rows.length === 0) return Response.json({ error: "세션을 찾을 수 없습니다." }, { status: 404 });
      const sess = rows[0];
      const partner = sess.host_username === user ? sess.guest_username : sess.host_username;

      if (action === "accept") {
        await db.sql`
          UPDATE cobroadcast_sessions
          SET status = 'accepted', accepted_at = now(), updated_at = now()
          WHERE id = ${sessionId} AND status = 'pending'
        `;
        const info = await profilesFor(db, [user]);
        sendPushToUser(sess.host_username, {
          title: "함께 방송 수락",
          body: `${info.get(user)?.display_name || user}님이 초대를 수락했어요. 방송을 시작하세요!`,
          data: { type: "cobroadcast_accepted", sessionId, path: "/golive" },
        }).catch(() => {});
        return Response.json({ success: true, status: "accepted" });
      }

      if (action === "decline") {
        await db.sql`
          UPDATE cobroadcast_sessions
          SET status = 'declined', updated_at = now()
          WHERE id = ${sessionId} AND status = 'pending'
        `;
        return Response.json({ success: true, status: "declined" });
      }

      if (action === "live") {
        await db.sql`
          UPDATE cobroadcast_sessions
          SET status = 'live',
              started_at = COALESCE(started_at, now()),
              updated_at = now()
          WHERE id = ${sessionId} AND status IN ('accepted', 'live')
        `;
        return Response.json({ success: true, status: "live" });
      }

      if (action === "end") {
        await db.sql`
          UPDATE cobroadcast_sessions
          SET status = 'ended', ended_at = now(), updated_at = now()
          WHERE id = ${sessionId} AND status IN ('pending', 'accepted', 'live')
        `;
        if (partner) {
          sendPushToUser(partner, {
            title: "함께 방송 종료",
            body: "상대방이 함께 방송을 종료했어요.",
            data: { type: "cobroadcast_ended", sessionId },
          }).catch(() => {});
        }
        return Response.json({ success: true, status: "ended" });
      }

      return Response.json({ error: "unknown action" }, { status: 400 });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (err: any) {
    console.error("[api-cobroadcast] failed:", err);
    return Response.json({ error: err?.message || "Request failed" }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/cobroadcast",
};
