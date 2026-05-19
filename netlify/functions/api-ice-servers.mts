import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  return Response.json({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
};

export const config: Config = {
  path: "/api/ice-servers",
};
