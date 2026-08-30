import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { PART_SIZE, resolveContentType, safeExtension, safeKeyPrefix } from "./_shared/upload-media.mts";

/**
 * 업로드는 공개 제안서 폼(비로그인 업체)에서도 쓰기 때문에 로그인을 요구하지 않는다.
 * 대신 (1) 서버가 형식을 정해 저장하고, (2) 허용 목록 밖의 형식은 거부하고,
 * (3) 크기를 제한한다. 예전에는 브라우저가 보낸 형식을 그대로 믿어서 HTML 파일을
 * 올려 우리 도메인에서 실행시킬 수 있었다.
 */

/**
 * 한 요청에 담을 수 있는 크기.
 *
 * 예전에는 10MB 로 적혀 있었다. 그런데 Netlify Functions 의 요청 본문 한도는 약 6MB
 * 이고 그 한도는 함수 코드가 실행되기 전에 걸린다 — 6MB 를 넘는 파일은 이 검사에
 * 닿지도 못하고 플랫폼 단계에서 끊겼고, 브라우저에는 우리가 쓴 안내문 대신 정체를
 * 알 수 없는 네트워크 실패가 남았다. 초안 영상이 "그냥 안 올라간다"고 보였던 이유다.
 *
 * 그래서 이 경로는 조각 하나 크기(PART_SIZE)까지만 받는다. 그보다 큰 파일은
 * `/api/upload-chunk` 로 나눠 올린다(화면에서는 자동으로 갈린다).
 */
const MAX_BYTES = PART_SIZE;

const TOO_BIG = `파일이 큽니다. ${Math.floor(PART_SIZE / (1024 * 1024))}MB 이하만 이 경로로 올릴 수 있습니다.`;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength && declaredLength > MAX_BYTES) {
    return Response.json(
      { error: TOO_BIG, code: "TOO_LARGE", partSize: PART_SIZE },
      { status: 413 },
    );
  }

  const formData = await req.formData();
  const file = (formData.get("image") || formData.get("file")) as File | null;
  const username = (formData.get("username") as string) || "anonymous";

  if (!file) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: TOO_BIG, code: "TOO_LARGE", partSize: PART_SIZE },
      { status: 413 },
    );
  }

  // 형식은 서버가 확장자를 보고 정한다. 허용 목록에 없으면 저장하지 않는다.
  const contentType = resolveContentType(file.name, file.type);
  if (!contentType) {
    return Response.json(
      { error: "이미지·영상·PDF 파일만 올릴 수 있습니다." },
      { status: 415 },
    );
  }

  const store = getStore("images");
  const ext = safeExtension(file.name) || "jpg";
  const key = `${safeKeyPrefix(username)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const buffer = await file.arrayBuffer();
  await store.set(key, buffer, {
    metadata: { contentType, originalName: file.name },
  });

  const imageUrl = `/api/images/${key}`;

  return Response.json({ url: imageUrl, key });
};

export const config: Config = {
  path: "/api/upload-image",
};
