import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { sendKakaoAlimtalk } from "./_shared/kakao-message.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const influencer = url.searchParams.get("influencer")?.toLowerCase();

  if (!influencer) {
    return Response.json({ error: "Missing influencer" }, { status: 400 });
  }

  const store = getStore("live-notify");

  if (req.method === "GET") {
    const phone = (url.searchParams.get("phone") || "").replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(phone)) {
      return Response.json({ subscribed: false });
    }
    const key = `notify_${influencer}_${phone}`;
    const data = await store.get(key, { type: "json" });
    return Response.json({ subscribed: !!data });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const nickname = String(body.nickname || "").trim().slice(0, 50);

    if (!/^01\d{8,9}$/.test(phone)) {
      return Response.json({ success: false, error: "올바른 휴대폰 번호를 입력해 주세요." }, { status: 400 });
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
      await mutateBlobJSON<{ subscribers: any[] }>("live-notify-subscribers", influencer, (current) => {
        const subscribers = Array.isArray(current?.subscribers) ? [...current!.subscribers] : [];
        const idx = subscribers.findIndex((subscriber: any) => subscriber.phone === phone);
        const next = { phone, nickname, subscribedAt };
        if (idx >= 0) subscribers[idx] = next;
        else subscribers.push(next);
        return { subscribers: subscribers.slice(-10000) };
      });
    } catch (syncErr) {
      console.error("[live-notify] Failed to sync subscriber store:", syncErr);
    }

    // Send subscribe confirmation alimtalk
    try {
      const subscribeTemplateId = Netlify.env.get("SOLAPI_KAKAO_LIVE_SUBSCRIBE_TEMPLATE_ID") || "";

      if (subscribeTemplateId) {
        await sendKakaoAlimtalk({
          phone,
          message: `[픽스폴리오] 라이브 알림 신청이 완료되었습니다.\n\n${influencer}님의 라이브 방송이 시작되면 알림을 보내드리겠습니다.`,
          templateId: subscribeTemplateId,
          variables: {
            "#{고객명}": nickname || "고객",
            "#{인플루언서명}": influencer,
          },
        });
      }
    } catch (notifErr) {
      console.error("[live-notify] Failed to send subscribe confirmation:", notifErr);
    }

    return Response.json({ success: true });
  }

  if (req.method === "DELETE") {
    const body = await req.json();
    const phone = String(body.phone || "").replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(phone)) {
      return Response.json({ success: false, error: "올바른 휴대폰 번호를 입력해 주세요." }, { status: 400 });
    }
    const key = `notify_${influencer}_${phone}`;
    await store.delete(key);

    // Remove from aggregated subscribers store
    try {
      await mutateBlobJSON<{ subscribers: any[] }>("live-notify-subscribers", influencer, (current) => {
        if (!Array.isArray(current?.subscribers)) return null;
        return { subscribers: current!.subscribers.filter((subscriber: any) => subscriber.phone !== phone) };
      });
    } catch (syncErr) {
      console.error("[live-notify] Failed to sync subscriber removal:", syncErr);
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/live-notify",
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: "ip" },
};
