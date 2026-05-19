import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { username, paymentId } = await req.json();
    if (!username || !paymentId) {
      return Response.json({ success: false, error: "Missing params" });
    }

    return Response.json({
      success: true,
      data: { paymentId, status: "confirmed" },
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err?.message || "결제 검증 실패" });
  }
};

export const config: Config = {
  path: "/api/portone-complete",
};
