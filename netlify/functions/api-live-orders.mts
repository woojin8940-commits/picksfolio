import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    return Response.json({ success: true, orderId: `order_${Date.now()}` });
  } catch {
    return Response.json({ success: false, error: "주문 처리 실패" });
  }
};

export const config: Config = {
  path: ["/api/live-order-batch", "/api/live-order-complete"],
};
