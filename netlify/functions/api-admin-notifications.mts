import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return Response.json({ notifications: [] });
  }

  return Response.json({ notifications: [] });
};

export const config: Config = {
  path: "/api/admin/notifications",
  method: ["GET", "PATCH"],
};
