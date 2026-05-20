import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const store = getStore("proposals");

  if (req.method === "GET") {
    const data = await store.get(`proposals_${username}`, { type: "json" });
    return Response.json(data || []);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const existing = (await store.get(`proposals_${username}`, { type: "json" })) as any[] || [];
    const proposal = {
      id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...body,
      influencer_username: username,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    existing.push(proposal);
    await store.setJSON(`proposals_${username}`, existing);

    const bizUsername = (body.business_username || "").toLowerCase().replace(/^biz\//, "");
    if (bizUsername) {
      const bizStore = getStore("business-proposals");
      const bizKey = `biz_proposals_${bizUsername}`;
      const bizExisting = ((await bizStore.get(bizKey, { type: "json" })) as any[]) || [];
      bizExisting.push({ ...proposal });
      await bizStore.setJSON(bizKey, bizExisting);
    }

    // Send alimtalk notification to the influencer about the new proposal
    try {
      const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
      const proposalTemplateId = Netlify.env.get("SOLAPI_KAKAO_PROPOSAL_TEMPLATE_ID") || "";
      const companyName = body.company_name || body.business_username || "기업";
      const proposalTitle = body.title || "협업 제안";
      const magicLink = `${siteOrigin}/admin?tab=proposals`;

      await fetch(`${siteOrigin}/api/send-kakao-alimtalk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          message: `[픽스폴리오] 새로운 협업 제안\n\n${companyName}에서 "${proposalTitle}" 협업을 제안했습니다.\n\n자세한 내용은 아래 링크에서 확인하세요.\n${magicLink}`,
          templateId: proposalTemplateId,
          variables: {
            "#{고객명}": username,
            "#{업체명}": companyName,
            "#{프로젝트명}": proposalTitle,
            "#{링크연결}": magicLink,
          },
        }),
      });
    } catch (notifErr) {
      console.error("[api-proposals] Failed to send proposal alimtalk:", notifErr);
    }

    return Response.json({ success: true, proposal });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/proposals/:username",
};
