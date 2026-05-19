import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  return Response.json({ success: true });
};

export const config: Config = {
  path: ["/api/signal", "/api/signal/:room"],
};
