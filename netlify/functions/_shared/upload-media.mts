/**
 * 업로드된 파일을 어떤 형식으로 저장하고 내려줄지 한곳에서 정한다.
 *
 * 예전에는 업로드 시 브라우저가 보낸 `file.type` 을 그대로 저장하고, 내려줄 때도
 * 그 값을 그대로 `Content-Type` 으로 썼다. 그래서 `text/html` 로 올리면 우리
 * 도메인에서 실행되는 HTML 이 되어(같은 출처) 로그인 토큰까지 읽어갈 수 있었다.
 * 이제 확장자를 이 표에 대조해 서버가 형식을 정하고, 표에 없으면 거부한다.
 */

export const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  pdf: "application/pdf",
  // 영상도 같은 저장소를 쓴다. 큰 파일은 서브 요청(range)으로 나눠 내려준다.
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  ogv: "video/ogg",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

/** 파일명에서 확장자만 안전하게 추출한다(경로 문자·대문자 제거). */
export function safeExtension(fileName: string): string {
  const base = String(fileName || "").split(/[\\/]/).pop() || "";
  const ext = base.includes(".") ? base.split(".").pop() || "" : "";
  return ext.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 확장자 → 저장/전송에 쓸 형식. 허용 목록에 없으면 null(거부). */
export function resolveContentType(fileName: string, declaredType?: string): string | null {
  const ext = safeExtension(fileName);
  const byExt = ALLOWED_CONTENT_TYPES[ext];
  if (byExt) return byExt;

  // 확장자가 없거나 낯선 경우, 브라우저가 알려준 형식이 허용 목록의 값과
  // 정확히 같을 때만 받아준다(임의 문자열은 받지 않는다).
  const declared = String(declaredType || "").split(";")[0].trim().toLowerCase();
  if (declared && Object.values(ALLOWED_CONTENT_TYPES).includes(declared)) return declared;

  return null;
}

/**
 * 저장 키에 들어가는 폴더명. 슬래시·상위 경로(..)로 다른 곳에 쓰이는 것을 막는다.
 * (키는 그대로 `/api/images/<key>` URL 이 된다.)
 */
export function safeKeyPrefix(raw: string): string {
  const cleaned = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 64);
  return cleaned || "anonymous";
}

/**
 * SVG 는 그 자체로 스크립트를 담을 수 있다. `<img>` 로 불릴 때는 실행되지 않지만
 * 주소창에 직접 열면 실행되므로, 스크립트·외부 요청을 모두 막는 CSP 를 같이 보낸다.
 * 형식 추측(sniffing)도 끈다.
 */
export function protectiveHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff" };
  if (contentType === "image/svg+xml") {
    headers["Content-Security-Policy"] =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";
  }
  return headers;
}
