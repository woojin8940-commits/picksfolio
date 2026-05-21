import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const proposalId = context.params.proposalId;
  if (!proposalId) {
    return Response.json({ error: "Missing proposalId" }, { status: 400 });
  }

  const store = getStore("timelines");
  const key = `detail_${proposalId}`;

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(key, { type: "json" })) as any || {
      proposalId,
      influencerUsername: body.influencerUsername || "",
      businessUsername: body.businessUsername || "",
      companyName: body.companyName || "",
      proposalTitle: body.proposalTitle || "",
      comments: [],
      createdAt: new Date().toISOString(),
    };

    const comment = {
      id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      proposalId,
      authorType: body.authorType,
      authorName: body.authorName,
      authorUsername: body.authorUsername,
      content: body.content || "",
      createdAt: new Date().toISOString(),
      readBy: [body.authorUsername?.toLowerCase()],
      ...(body.attachments ? { attachments: body.attachments } : {}),
    };

    existing.comments = existing.comments || [];
    existing.comments.push(comment);

    if (body.influencerUsername) existing.influencerUsername = body.influencerUsername;
    if (body.businessUsername) existing.businessUsername = body.businessUsername;
    if (body.companyName) existing.companyName = body.companyName;
    if (body.proposalTitle) existing.proposalTitle = body.proposalTitle;

    await store.setJSON(key, existing);

    context.waitUntil((async () => {
      const ensureIndex = async (type: string, username: string) => {
        const indexKey = `index_${type}_${username.toLowerCase()}`;
        const indexData = ((await store.get(indexKey, { type: "json" })) as any[]) || [];
        const exists = indexData.some((t: any) => t.proposalId === proposalId);
        if (!exists) {
          indexData.unshift({
            proposalId,
            influencerUsername: existing.influencerUsername,
            businessUsername: existing.businessUsername,
            companyName: existing.companyName,
            proposalTitle: existing.proposalTitle,
            createdAt: existing.createdAt,
          });
          await store.setJSON(indexKey, indexData);
        }
      };

      const indexPromises: Promise<void>[] = [];
      if (existing.influencerUsername) {
        indexPromises.push(ensureIndex("influencer", existing.influencerUsername));
      }
      if (existing.businessUsername) {
        indexPromises.push(ensureIndex("business", existing.businessUsername));
      }
      await Promise.all(indexPromises);

      try {
        const { getDatabase } = await import("@netlify/database");
        const db = getDatabase();

        await db.sql`
          INSERT INTO timelines (proposal_id, influencer_username, business_username, company_name, proposal_title, created_at)
          VALUES (${proposalId}, ${(existing.influencerUsername || "").toLowerCase()}, ${(existing.businessUsername || "").toLowerCase()}, ${existing.companyName || ""}, ${existing.proposalTitle || ""}, ${existing.createdAt || new Date().toISOString()})
          ON CONFLICT (proposal_id) DO NOTHING
        `;

        await db.sql`
          INSERT INTO timeline_messages (id, proposal_id, author_type, author_name, author_username, content, attachments, read_by, created_at)
          VALUES (${comment.id}, ${proposalId}, ${comment.authorType}, ${comment.authorName}, ${comment.authorUsername}, ${comment.content}, ${body.attachments ? JSON.stringify(body.attachments) : null}, ${comment.readBy}, ${comment.createdAt})
          ON CONFLICT (id) DO NOTHING
        `;
      } catch (dbErr) {
        console.error("[timeline-comment] Failed to persist to SQL:", dbErr);
      }

      try {
        const authorUsername = (body.authorUsername || "").toLowerCase();
        const influencerUser = (existing.influencerUsername || "").toLowerCase();
        const businessUser = (existing.businessUsername || "").toLowerCase();
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
            existingNotif.sendAfter = new Date(Date.now() + 60_000).toISOString();
            await notifQueue.setJSON(queueKey, existingNotif);
          } else {
            await notifQueue.setJSON(queueKey, {
              recipientUsername,
              recipientType: recipientUsername === businessUser ? "business" : "influencer",
              proposalId,
              companyName: existing.companyName || "",
              proposalTitle: existing.proposalTitle || "협업 프로젝트",
              senderName: body.authorName || "",
              messageCount: 1,
              firstMessagePreview: messagePreview,
              lastMessagePreview: messagePreview,
              magicLink,
              siteOrigin,
              sendAfter: new Date(Date.now() + 60_000).toISOString(),
            });
          }
        }
      } catch (notifErr) {
        console.error("[timeline-comment] Failed to queue notification:", notifErr);
      }
    })());

    return Response.json({ success: true, comment });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/timeline/comment/:proposalId",
};
