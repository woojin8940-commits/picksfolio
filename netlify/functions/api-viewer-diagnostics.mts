import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  return Response.json({ error: "Not implemented" }, { status: 501 });
};

export const config: Config = {
  path: "/api/viewer-diagnostics/:username",
};
