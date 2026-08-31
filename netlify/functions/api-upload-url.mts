import type { Config } from "@netlify/functions";
import { getSupabaseServer } from "./_shared/supabase.mts";
import {
  DIRECT_UPLOAD_BUCKET,
  DIRECT_UPLOAD_MAX_BYTES,
  DIRECT_UPLOAD_MAX_MB,
  directUploadPath,
  resolveContentType,
} from "./_shared/upload-media.mts";

/**
 * 업로드용 링크만 발급한다. 파일은 이 함수를 지나가지 않는다.
 *
 * 예전 구조 — 브라우저가 파일을 함수로 보내고, 함수가 그걸 저장소에 옮겼다. 함수의
 * 요청 본문 한도가 약 6MB 이고 그 한도는 함수 코드가 실행되기 전에 걸리므로, 초안
 * 영상(보통 20~100MB)은 우리 코드에 닿지도 못하고 끊겼다.
 *
 * 지금 구조 — 함수는 "이 자리에 올려도 좋다"는 서명된 링크 하나만 만들어 준다.
 * 브라우저는 그 링크로 스토리지에 파일을 곧장 올린다. 이 함수가 주고받는 것은 짧은
 * JSON 뿐이라 파일 크기와 아무 상관이 없다.
 *
 * 무엇을 검사하는가 — 링크를 받은 뒤에는 우리가 끼어들 자리가 없으므로, 막을 것은
 * 여기서 다 막아야 한다.
 *   · 형식: 확장자를 허용 목록에 대조한다. 목록 밖이면 링크를 주지 않는다.
 *     (`text/html` 을 올려 우리 도메인에서 실행시키는 길을 막는 것과 같은 이유다.)
 *   · 크기: 스토리지 프로젝트 상한을 넘는 파일은 올려봐야 거절되므로 미리 막는다.
 *   · 자리: 경로는 서버가 정한다. 클라이언트가 지어 보내면 남의 파일을 덮어쓸 수 있다.
 *
 * 로그인을 요구하지 않는 것은 `/api/upload-image` 와 같은 이유다 — 비로그인 업체가
 * 쓰는 공개 제안서 폼이 같은 업로드를 쓴다. 대신 위의 세 가지로 범위를 좁힌다.
 *
 *   POST /api/upload-url  { username, filename, mimeType, size }
 *     → { uploadUrl, contentType, publicUrl, path, maxBytes }
 */

import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // 링크 발급도 횟수를 묶는다. 링크 하나가 곧 저장소 쓰기 한 번이다.
  const limited = await checkRateLimit({
    bucket: "upload-url",
    key: clientIp(req),
    limit: 60,
    windowSeconds: 600,
    message: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  });
  if (!limited.ok) return limited.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const filename = String(body.filename || "");
  const size = Number(body.size || 0);
  const username = String(body.username || "anonymous");

  const contentType = resolveContentType(filename, String(body.mimeType || ""));
  if (!contentType) return bad("이미지·영상·PDF 파일만 올릴 수 있습니다.", 415);
  if (!Number.isFinite(size) || size <= 0) return bad("파일 크기를 알 수 없습니다.");
  if (size > DIRECT_UPLOAD_MAX_BYTES) {
    return bad(
      `파일이 큽니다. ${DIRECT_UPLOAD_MAX_MB}MB 이하로 올려 주세요. ` +
        `(현재 ${(size / (1024 * 1024)).toFixed(1)}MB)`,
      413,
    );
  }

  const path = directUploadPath(username, filename);

  try {
    const storage = getSupabaseServer().storage.from(DIRECT_UPLOAD_BUCKET);
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      console.error("[api-upload-url] 업로드 링크 발급 실패:", error?.message || "빈 응답");
      return bad("업로드를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.", 502);
    }

    /**
     * 재생 주소는 공개 주소를 그대로 쓴다.
     *
     * 서명된 열기 주소(signed URL)는 유효기간이 있어서, 저장해 두면 며칠 뒤에 열 때
     * 만료된 링크가 된다 — 협업 기록은 몇 달 뒤에도 열어봐야 한다. 이 버킷은 이미
     * 공개이고 경로에 난수가 붙어 있어 주소를 모르면 닿을 수 없다.
     */
    const { data: pub } = storage.getPublicUrl(path);

    return Response.json({
      uploadUrl: data.signedUrl,
      contentType,
      publicUrl: pub?.publicUrl || "",
      path,
      maxBytes: DIRECT_UPLOAD_MAX_BYTES,
    });
  } catch (e) {
    // 스토리지 환경변수가 없거나 스토리지가 응답하지 않는 경우.
    console.error("[api-upload-url] 스토리지 연결 실패:", (e as Error)?.message);
    return bad("업로드 저장소에 연결할 수 없습니다. 관리자에게 알려 주세요.", 503);
  }
};

export const config: Config = {
  path: "/api/upload-url",
};
