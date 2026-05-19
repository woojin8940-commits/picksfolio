import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await req.formData();
  const file = (formData.get("image") || formData.get("file")) as File | null;
  const username = (formData.get("username") as string) || "anonymous";

  if (!file) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }

  const store = getStore("images");
  const ext = file.name.split(".").pop() || "jpg";
  const key = `${username.toLowerCase()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const buffer = await file.arrayBuffer();
  await store.set(key, buffer, {
    metadata: { contentType: file.type, originalName: file.name },
  });

  const imageUrl = `/api/images/${key}`;

  return Response.json({ url: imageUrl, key });
};

export const config: Config = {
  path: "/api/upload-image",
};
