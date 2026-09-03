import type { Config, Context } from "@netlify/functions";

type DiagnosticBody = {
  flow?: unknown;
  clientIdFingerprint?: unknown;
  redirectUri?: unknown;
  pageOrigin?: unknown;
  bundlePath?: unknown;
  nativeApp?: unknown;
};

const shortString = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.slice(0, maxLength) : "";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: DiagnosticBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const flow = shortString(body.flow, 32);
  const clientIdFingerprint = shortString(body.clientIdFingerprint, 12);
  if (!/^(javascript-sdk|rest-fallback)$/.test(flow)) {
    return new Response("Bad request", { status: 400 });
  }
  if (!/^(?:[a-f0-9]{12}|unavailable)$/.test(clientIdFingerprint)) {
    return new Response("Bad request", { status: 400 });
  }

  console.info("[kakao-auth-diagnostic]", JSON.stringify({
    flow,
    clientIdFingerprint,
    redirectUri: shortString(body.redirectUri, 256),
    pageOrigin: shortString(body.pageOrigin, 128),
    bundlePath: shortString(body.bundlePath, 160),
    nativeApp: body.nativeApp === true,
    deployId: context.deploy.id,
    deployContext: context.deploy.context,
  }));

  return new Response(null, { status: 204 });
};

export const config: Config = {
  path: "/api/kakao-auth-diagnostic",
};
