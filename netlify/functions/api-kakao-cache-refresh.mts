import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method === "POST") {
      const body = await req.json();
      const url = body.url;

      if (!url) {
        return new Response(JSON.stringify({ error: "url is required" }), { status: 400, headers });
      }

      const KAKAO_REST_API_KEY = Netlify.env.get("KAKAO_REST_API_KEY");
      if (KAKAO_REST_API_KEY) {
        try {
          await fetch("https://kapi.kakao.com/v2/api/talk/link/scrap", {
            method: "POST",
            headers: {
              Authorization: `KakaoAK ${KAKAO_REST_API_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ request_url: url }),
          });
        } catch (e) {
          console.error("Kakao cache refresh error:", e);
        }
      }

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Kakao cache refresh API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/kakao-cache-refresh" };
