import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      return Response.json({ success: false, error: "Missing url" });
    }

    const kakaoRestKey = Netlify.env.get("KAKAO_REST_API_KEY");
    if (!kakaoRestKey) {
      return Response.json({ success: false, error: "Missing Kakao API key" });
    }

    const res = await fetch(
      `https://kapi.kakao.com/v2/search/web?query=${encodeURIComponent(url)}`,
      {
        headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
      }
    );

    return Response.json({ success: res.ok });
  } catch {
    return Response.json({ success: false });
  }
};

export const config: Config = {
  path: "/api/kakao-cache-refresh",
};
