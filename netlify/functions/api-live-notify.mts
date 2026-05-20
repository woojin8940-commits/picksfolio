import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const influencer = url.searchParams.get("influencer")?.toLowerCase();

  if (!influencer) {
    return Response.json({ error: "Missing influencer" }, { status: 400 });
  }

  const store = getStore("live-notify");
  const subscriberStore = getStore({ name: "live-notify-subscribers", consistency: "strong" });

  if (req.method === "GET") {
    const phone = url.searchParams.get("phone") || "";
    if (!phone) {
      return Response.json({ subscribed: false });
    }
    const key = `notify_${influencer}_${phone.replace(/\D/g, "")}`;
    const data = await store.get(key, { type: "json" });
    return Response.json({ subscribed: !!data });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const phone = (body.phone || "").replace(/\D/g, "");
    const nickname = body.nickname || "";

    if (!phone) {
      return Response.json({ success: false, error: "전화번호가 필요합니다." });
    }

    const subscribedAt = new Date().toISOString();
    const key = `notify_${influencer}_${phone}`;
    await store.setJSON(key, {
      phone,
      nickname,
      influencer,
      subscribedAt,
    });

    // Sync to aggregated subscribers store (used by live-notify-send)
    try {
      const existing = (await subscriberStore.get(influencer, { type: "json" })) as { subscribers: any[] } | null;
      const subscribers = existing?.subscribers || [];
      const idx = subscribers.findIndex((s: any) => s.phone === phone);
      if (idx >= 0) {
        subscribers[idx] = { phone, nickname, subscribedAt };
      } else {
        subscribers.push({ phone, nickname, subscribedAt });
      }
      await subscriberStore.setJSON(influencer, { subscribers });
    } catch (syncErr) {
      console.error("[live-notify] Failed to sync subscriber store:", syncErr);
    }

    // Send subscribe confirmation alimtalk
    try {
      const siteOrigin = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
      const subscribeTemplateId = Netlify.env.get("SOLAPI_KAKAO_LIVE_SUBSCRIBE_TEMPLATE_ID") || "";

      if (subscribeTemplateId) {
        await fetch(`${siteOrigin}/api/send-kakao-alimtalk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone,
            message: `[픽스폴리오] 라이브 알림 신청이 완료되었습니다.\n\n${influencer}님의 라이브 방송이 시작되면 알림을 보내드리겠습니다.`,
            templateId: subscribeTemplateId,
            variables: {
              "#{고객명}": nickname || "고객",
              "#{인플루언서명}": influencer,
            },
          }),
        });
      }
    } catch (notifErr) {
      console.error("[live-notify] Failed to send subscribe confirmation:", notifErr);
    }

    return Response.json({ success: true });
  }

  if (req.method === "DELETE") {
    const body = await req.json();
    const phone = (body.phone || "").replace(/\D/g, "");
    if (phone) {
      const key = `notify_${influencer}_${phone}`;
      await store.delete(key);

      // Remove from aggregated subscribers store
      try {
        const existing = (await subscriberStore.get(influencer, { type: "json" })) as { subscribers: any[] } | null;
        if (existing?.subscribers) {
          existing.subscribers = existing.subscribers.filter((s: any) => s.phone !== phone);
          await subscriberStore.setJSON(influencer, existing);
        }
      } catch (syncErr) {
        console.error("[live-notify] Failed to sync subscriber removal:", syncErr);
      }
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/live-notify",
};
