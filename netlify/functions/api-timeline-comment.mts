import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { sendPushToUser } from "./_shared/push.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import {
  callerIsAnyOf,
  forbiddenResponse,
  requireSignedInUser,
} from "./_shared/user-auth.mts";

const STORE = "timelines";

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }

  if (req.method === "POST") {
    // 작성자 정보를 body 에서 그대로 받아 저장하던 곳이다. 즉 남의 협업방에
    // 상대방 이름으로 메시지를 넣고 푸시까지 보낼 수 있었다. 이제 (1) 로그인한
    // 사람인지 확인하고, (2) 그 협업의 당사자인지 대조하고, (3) 작성자 이름은
    // body 가 아니라 토큰에서 확인된 본인으로 기록한다.
    const caller = await requireSignedInUser(req);
    if (!caller.ok) return caller.response;

    const body = await req.json();

    const store = getStore(STORE);
    const key = `detail_${proposalId}`;
    const stored = (await store.get(key, { type: "json" })) as any;

    // 방이 아직 없으면(첫 메시지) body 가 알려준 당사자를 기준으로 판단한다.
    const influencerUsername = stored?.influencerUsername || body.influencerUsername || "";
    const businessUsername = stored?.businessUsername || body.businessUsername || "";
    if (!callerIsAnyOf(caller, [influencerUsername, businessUsername])) {
      return forbiddenResponse();
    }

    // 관리자는 지원 목적으로 대신 작성할 수 있으므로 body 값을 존중한다.
    const authorUsername = caller.isAdmin
      ? norm(body.authorUsername || caller.username)
      : caller.username;
    const authorType = caller.isAdmin
      ? body.authorType
      : authorUsername === norm(businessUsername)
        ? "business"
        : "influencer";

    const comment = {
      id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      proposalId,
      authorType,
      authorName: body.authorName || authorUsername,
      authorUsername,
      content: body.content || "",
      createdAt: new Date().toISOString(),
      readBy: [authorUsername],
      ...(body.attachments ? { attachments: body.attachments } : {}),
    };

    // 양쪽이 동시에 답장하면 통째로 덮어쓰기가 상대 메시지를 지운다. 최신 대화를
    // 다시 읽어 이 메시지만 덧붙이는 조건부 쓰기로 저장한다.
    const existing = (await mutateBlobJSON<any>(STORE, key, (current) => {
      const base = current ?? {
        proposalId,
        influencerUsername: body.influencerUsername || "",
        businessUsername: body.businessUsername || "",
        companyName: body.companyName || "",
        proposalTitle: body.proposalTitle || "",
        comments: [],
        createdAt: new Date().toISOString(),
      };

      const next: any = {
        ...base,
        comments: [...(Array.isArray(base.comments) ? base.comments : []), comment],
      };

      // 당사자는 비어 있을 때만 채운다 — 이미 기록된 상대를 body 로 바꿔치기하면
      // 남의 협업방을 가져올 수 있다.
      if (!next.influencerUsername && body.influencerUsername) {
        next.influencerUsername = body.influencerUsername;
      }
      if (!next.businessUsername && body.businessUsername) {
        next.businessUsername = body.businessUsername;
      }
      if (body.companyName) next.companyName = body.companyName;
      if (body.proposalTitle) next.proposalTitle = body.proposalTitle;

      return next;
    })) as any;

    // Return immediately — all secondary work runs in background
    const response = Response.json({ success: true, comment });

    context.waitUntil((async () => {
      const indexPromises: Promise<void>[] = [];

      const ensureIndex = async (type: string, username: string) => {
        const indexKey = `index_${type}_${username.toLowerCase()}`;
        // 목록 색인도 두 협업이 동시에 추가되면 서로를 지운다 — 조건부 쓰기로 넣는다.
        await mutateBlobJSON<any[]>(STORE, indexKey, (current) => {
          const indexData = Array.isArray(current) ? current : [];
          if (indexData.some((t: any) => t.proposalId === proposalId)) return null;
          return [
            {
              proposalId,
              influencerUsername: existing.influencerUsername,
              businessUsername: existing.businessUsername,
              companyName: existing.companyName,
              proposalTitle: existing.proposalTitle,
              createdAt: existing.createdAt,
            },
            ...indexData,
          ];
        });
      };

      if (existing.influencerUsername) {
        indexPromises.push(ensureIndex("influencer", existing.influencerUsername));
      }
      if (existing.businessUsername) {
        indexPromises.push(ensureIndex("business", existing.businessUsername));
      }

      const dbPromise = (async () => {
        try {
          const { getDatabase } = await import("@picks/netlify-database");
          const db = getDatabase();
          await Promise.all([
            db.sql`
              INSERT INTO timelines (proposal_id, influencer_username, business_username, company_name, proposal_title, created_at)
              VALUES (${proposalId}, ${(existing.influencerUsername || "").toLowerCase()}, ${(existing.businessUsername || "").toLowerCase()}, ${existing.companyName || ""}, ${existing.proposalTitle || ""}, ${existing.createdAt || new Date().toISOString()})
              ON CONFLICT (proposal_id) DO NOTHING
            `,
            db.sql`
              INSERT INTO timeline_messages (id, proposal_id, author_type, author_name, author_username, content, attachments, read_by, created_at)
              VALUES (${comment.id}, ${proposalId}, ${comment.authorType}, ${comment.authorName}, ${comment.authorUsername}, ${comment.content}, ${body.attachments ? JSON.stringify(body.attachments) : null}, ${comment.readBy}, ${comment.createdAt})
              ON CONFLICT (id) DO NOTHING
            `,
          ]);
        } catch (dbErr) {
          console.error("[timeline-comment] Failed to persist to SQL:", dbErr);
        }
      })();

      const notifPromise = (async () => {
        try {
          const authorUsername = norm(comment.authorUsername);
          const influencerUser = norm(existing.influencerUsername);
          const businessUser = norm(existing.businessUsername);
          const recipientUsername = authorUsername === influencerUser ? businessUser : influencerUser;

          if (recipientUsername && recipientUsername !== authorUsername) {
            const notifQueue = getStore({ name: "notification-queue", consistency: "strong" });
            const queueKey = `pending:${proposalId}_${recipientUsername}`;
            const existingNotif = await notifQueue.get(queueKey, { type: "json" }) as any;
            const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
            const magicLink = `${siteOrigin}/admin?tab=timeline&proposal=${proposalId}`;
            const messagePreview = (body.content || "").slice(0, 50);

            if (existingNotif) {
              existingNotif.messageCount = (existingNotif.messageCount || 1) + 1;
              existingNotif.lastMessagePreview = messagePreview;
              existingNotif.sendAfter = new Date(Date.now() + 30_000).toISOString();
              await notifQueue.setJSON(queueKey, existingNotif);
            } else {
              await notifQueue.setJSON(queueKey, {
                recipientUsername,
                recipientType: recipientUsername === businessUser ? "business" : "influencer",
                proposalId,
                companyName: existing.companyName || "",
                proposalTitle: existing.proposalTitle || "협업 프로젝트",
                senderName: comment.authorName || "",
                messageCount: 1,
                firstMessagePreview: messagePreview,
                lastMessagePreview: messagePreview,
                magicLink,
                siteOrigin,
                sendAfter: new Date(Date.now() + 30_000).toISOString(),
              });
            }

            // Native push is immediate — its whole value is reaching the
            // recipient the moment the message lands (the Kakao alimtalk above
            // is debounced 30s and acts as the fallback when the app is gone).
            const projectName = existing.proposalTitle || "협업 프로젝트";
            const senderName = comment.authorName || existing.companyName || "상대방";
            const pushBody = messagePreview
              || (body.attachments?.length ? "사진을 보냈어요." : "새 메시지가 도착했어요.");
            await sendPushToUser(recipientUsername, {
              title: `${senderName} · ${projectName}`,
              body: pushBody,
              data: {
                type: "timeline",
                proposalId,
                path: `/admin?tab=timeline&proposal=${proposalId}`,
              },
            });
          }
        } catch (notifErr) {
          console.error("[timeline-comment] Failed to queue notification:", notifErr);
        }
      })();

      await Promise.all([...indexPromises, dbPromise, notifPromise]);
    })());

    return response;
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/comment/:proposalId",
};
