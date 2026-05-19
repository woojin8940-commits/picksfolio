import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    return Response.json({
      success: true,
      data: { status: "issued" },
    });
  } catch (err: any) {
    return Response.json({ success: false, error: err?.message || "빌링 발급 실패" });
  }
};

export const config: Config = {
  path: "/api/billing-issue",
};
