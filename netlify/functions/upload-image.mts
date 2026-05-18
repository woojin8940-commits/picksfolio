import { getStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers,
    });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const username = formData.get("username") as string | null;
    const purpose = formData.get("purpose") as string | null;

    if (!file || !username) {
      return new Response(
        JSON.stringify({ error: "file and username are required" }),
        { status: 400, headers }
      );
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({ error: "File size exceeds 10MB limit" }),
        { status: 400, headers }
      );
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
    ];
    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({
          error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF",
        }),
        { status: 400, headers }
      );
    }

    const store = getStore("portfolio-images");
    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const key = `${username.toLowerCase()}/${purpose || "image"}-${Date.now()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    await store.set(key, new Uint8Array(arrayBuffer), {
      metadata: {
        contentType: file.type,
        originalName: file.name,
        username: username.toLowerCase(),
        purpose: purpose || "general",
        uploadedAt: new Date().toISOString(),
      },
    });

    const siteUrl = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
    const imageUrl = `${siteUrl}/.netlify/blobs/${key}`;

    return new Response(
      JSON.stringify({
        success: true,
        url: imageUrl,
        key,
      }),
      { headers }
    );
  } catch (error: any) {
    console.error("Upload error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Upload failed" }),
      { status: 500, headers }
    );
  }
};
