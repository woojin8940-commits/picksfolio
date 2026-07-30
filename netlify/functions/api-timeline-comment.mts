import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { sendPushToUser } from "./_shared/push.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { participantList, resolveTimelineAccess } from "./_shared/timeline-access.mts";

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
    // 사람인지 확인하고, (2) 그 방의 참여자인지 대조하고, (3) 작성자 이름은
    // body 가 아니라 토큰에서 확인된 본인으로 기록한다.
    const body = await req.json();

    const store = getStore(STORE);
    const key = `detail_${proposalId}`;
    const stored = (await store.get(key, { type: "json" })) as any;

    // 방이 아직 없으면(첫 메시지) body 가 알려준 당사자를 기준으로 판단한다.
    const influencerUsername = stored?.influencerUsername || body.influencerUsername || "";
    const businessUsername = stored?.businessUsername || body.businessUsername || "";
    const managerUsername = stored?.managerUsername || "";
    const threadKind = stored?.kind || "brand_influencer";

    const access = await resolveTimelineAccess(req, {
      influencer: influencerUsername,
      business: businessUsername,
      manager: managerUsername,
    });
    if (!access.ok) return access.response;

    // 담당자는 지원 목적으로 다른 참여자 이름으로 대신 쓸 수 있어야 했지만, 담당자
    // 채널이 생긴 뒤로는 그럴 이유가 없다. 담당자가 쓴 말은 담당자 이름으로 남는다 —
    // 나중에 "누가 그렇게 말했나"를 따질 때 이게 유일한 근거다.
    const authorUsername = access.username;
    const authorType = access.authorType;
    const defaultAuthorName = authorType === "manager" ? "픽스폴리오 담당자" : authorUsername;

    const comment = {
      id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      proposalId,
      authorType,
      authorName: body.authorName || defaultAuthorName,
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
        managerUsername: "",
        kind: "brand_influencer",
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
              kind: existing.kind || threadKind,
              collabId: existing.collabId || "",
              influencerUsername: existing.influencerUsername,
              businessUsername: existing.businessUsername,
              managerUsername: existing.managerUsername || "",
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
      if (existing.managerUsername) {
        indexPromises.push(ensureIndex("manager", existing.managerUsername));
      }

      const dbPromise = (async () => {
        try {
          const { getDatabase } = await import("@picks/netlify-database");
          const db = getDatabase();
          await Promise.all([
            db.sql`
              INSERT INTO timelines (proposal_id, influencer_username, business_username, company_name, proposal_title, created_at, kind, manager_username, collab_id)
              VALUES (${proposalId}, ${(existing.influencerUsername || "").toLowerCase()}, ${(existing.businessUsername || "").toLowerCase()}, ${existing.companyName || ""}, ${existing.proposalTitle || ""}, ${existing.createdAt || new Date().toISOString()}, ${existing.kind || threadKind}, ${norm(existing.managerUsername)}, ${existing.collabId || ""})
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
          const author = norm(comment.authorUsername);
          const businessUser = norm(existing.businessUsername);
          const managerUser = norm(existing.managerUsername);
          // 참여자가 둘이라고 가정하던 곳이다("상대방 = 인플루언서가 아니면 업체").
          // 담당자 채널이 생긴 뒤로는 방마다 참여자 구성이 다르므로, 작성자를 뺀
          // 나머지 전원에게 보낸다. 이렇게 두면 나중에 참여자가 늘어도 알림이 빠지지 않는다.
          const recipients = participantList({
            influencer: existing.influencerUsername,
            business: existing.businessUsername,
            manager: existing.managerUsername,
          }).filter((u) => u !== author);

          if (recipients.length === 0) return;

          const notifQueue = getStore({ name: "notification-queue", consistency: "strong" });
          const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
          const magicLink = `${siteOrigin}/admin?tab=timeline&proposal=${proposalId}`;
          const messagePreview = (body.content || "").slice(0, 50);
          const projectName = existing.proposalTitle || "협업 프로젝트";
          const senderName = comment.authorName
            || (comment.authorType === "manager" ? "픽스폴리오 담당자" : existing.companyName)
            || "상대방";

          await Promise.all(recipients.map(async (recipientUsername) => {
            const queueKey = `pending:${proposalId}_${recipientUsername}`;
            const existingNotif = await notifQueue.get(queueKey, { type: "json" }) as any;
            const recipientType = recipientUsername === managerUser
              ? "manager"
              : recipientUsername === businessUser
                ? "business"
                : "influencer";

            if (existingNotif) {
              existingNotif.messageCount = (existingNotif.messageCount || 1) + 1;
              existingNotif.lastMessagePreview = messagePreview;
              existingNotif.sendAfter = new Date(Date.now() + 30_000).toISOString();
              await notifQueue.setJSON(queueKey, existingNotif);
            } else {
              await notifQueue.setJSON(queueKey, {
                recipientUsername,
                recipientType,
                proposalId,
                companyName: existing.companyName || "",
                proposalTitle: projectName,
                senderName,
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
          }));
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
