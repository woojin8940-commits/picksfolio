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

// ---------------------------------------------------------------------------
// 조각 업로드(큰 파일)
// ---------------------------------------------------------------------------

/**
 * 조각 하나의 크기.
 *
 * Netlify Functions 의 요청 본문 한도는 약 6MB 이고, multipart 로 감싸면서 조금 더
 * 늘어난다. 3MB 로 잡으면 감싸는 양을 다 더해도 한도의 절반 남짓이라 여유가 있고,
 * 조각 수도 크게 늘지 않는다(80MB 영상이면 27조각).
 */
export const PART_SIZE = 3 * 1024 * 1024;

/**
 * 한 파일이 가질 수 있는 최대 조각 수 → 전체 크기 상한(약 150MB).
 *
 * 상한을 두는 이유는 저장 비용이 아니라 사람의 시간이다. 조각은 한 번에 하나씩
 * 올라가므로 조각이 많아지면 업로드가 몇 분씩 걸리고, 그 사이 창을 닫으면 처음부터
 * 다시다. 초안 영상은 대개 1분 이하라 이 상한 안에 들어온다.
 */
export const MAX_PARTS = 50;

/** 조각이 저장되는 키. 목록표 키 뒤에 붙여 같은 폴더에 나란히 남는다. */
export const partKey = (key: string, index: number) => `${key}.part${index}`;

/**
 * 서버가 발급한 업로드 키의 모양인가.
 *
 * 조각 요청은 로그인을 요구하지 않으므로, 클라이언트가 임의의 키를 적어 보내
 * 다른 파일 위에 조각을 쓰는 일을 막아야 한다. 키는 항상 서버가 만든
 * `<폴더>/<타임스탬프>-<난수>.<확장자>` 꼴이고, 이 모양이 아니면 받지 않는다.
 * (상위 경로 `..` 나 슬래시 중첩도 이 검사에서 함께 걸린다.)
 */
export const isPartedKey = (key: string): boolean =>
  /^[a-z0-9._-]{1,64}\/\d{10,16}-[a-z0-9]{4,10}\.[a-z0-9]{1,8}$/.test(String(key || ""));

// ---------------------------------------------------------------------------
// 스토리지로 직접 올리기(큰 파일)
// ---------------------------------------------------------------------------

/**
 * 왜 서버를 거치지 않는가.
 *
 * 함수의 요청 본문 한도는 약 6MB 이고, 그 한도는 함수 코드가 실행되기 전에 걸린다.
 * 파일을 함수가 받아서 저장소에 옮기는 구조에서는 코드를 어떻게 고쳐도 6MB 를 넘길
 * 수 없다 — 위의 조각 업로드도 "6MB 를 넘기지 않으려고" 파일을 잘게 나눈 것이지,
 * 한 번에 큰 파일을 보낼 방법을 만든 것이 아니다.
 *
 * 그래서 파일이 함수를 지나가지 않게 한다. 서버는 "이 자리에 올려도 좋다"는 서명된
 * 링크만 발급하고, 실제 바이트는 브라우저에서 스토리지로 곧장 간다. 함수는 짧은
 * JSON 한 번만 주고받으므로 파일 크기와 무관해지고, 업로드 속도도 우리 함수의
 * 처리량이 아니라 사용자 회선에만 달린다.
 */

/**
 * 파일이 실제로 담기는 버킷.
 *
 * 새로 만들지 않고 이미 있는 공개 버킷을 쓴다. 프로필·커버 이미지가 이미 여기 올라가
 * 공개 주소로 재생되고 있어서, 새 버킷을 만들면 공개 여부와 접근 정책을 한 벌 더
 * 관리해야 한다. 재생은 이 공개 주소를 그대로 쓴다(구간 요청도 스토리지가 처리한다).
 */
export const DIRECT_UPLOAD_BUCKET = "images";

/**
 * 첨부가 모이는 폴더.
 *
 * 프로필 이미지는 `<아이디>/<파일명>` 으로 올라간다. 한 칸 안으로 넣어 두면 나중에
 * 협업 첨부만 따로 세거나 정리할 때 경로만 보고 구분할 수 있다.
 */
export const DIRECT_UPLOAD_PREFIX = "uploads";

/**
 * 한 번에 올릴 수 있는 크기 상한.
 *
 * 이 값은 우리가 정하는 것이 아니라 스토리지가 정한다. Supabase 프로젝트에는 업로드
 * 크기 상한이 프로젝트 단위로 걸려 있고, 버킷이나 우리 코드가 그 값을 넘길 수는 없다 —
 * 넘기면 스토리지가 `EntityTooLarge` 로 거절한다.
 *
 * 그래서 상한을 서버에서 먼저 확인해 링크 발급 단계에서 막는다. 상한을 모른 채 링크를
 * 내주면 사람은 100MB 를 다 올려보낸 뒤에야 거절을 받는다.
 *
 * 기본값 200 은 짐작이 아니라 확인한 값이다. 프로젝트 상한을 200MB 로 올린 뒤 실제로
 * 올려 봤을 때 199MB 는 통과하고 201MB 는 `EntityTooLarge` 로 거절됐다. 그래서 이 두
 * 숫자(대시보드 상한 · 서버 검사 기준)는 지금 200MB 로 일치한다.
 *
 * 프로젝트 상한을 다시 바꿨다면 이 값도 함께 맞춰야 한다. 코드를 고치지 않고 환경변수
 * `UPLOAD_MAX_MB` 로도 덮어쓸 수 있다 — 두 숫자가 어긋나면, 낮은 쪽이 우리 검사면
 * 올릴 수 있는 파일이 거절되고 낮은 쪽이 스토리지면 다 올린 뒤에 거절된다.
 */
export const DIRECT_UPLOAD_MAX_MB = (() => {
  const raw = Number(process.env.UPLOAD_MAX_MB || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
})();

export const DIRECT_UPLOAD_MAX_BYTES = DIRECT_UPLOAD_MAX_MB * 1024 * 1024;

/**
 * 올릴 자리를 서버가 정한다.
 *
 * 클라이언트가 경로를 지어 보내면 남의 파일 위에 덮어쓸 수 있다. 시간과 난수를 붙여
 * 늘 새 자리를 만들므로 같은 이름의 파일을 여러 번 올려도 서로를 지우지 않는다.
 */
export function directUploadPath(username: string, fileName: string): string {
  const ext = safeExtension(fileName) || "bin";
  const rand = Math.random().toString(36).slice(2, 10);
  return `${DIRECT_UPLOAD_PREFIX}/${safeKeyPrefix(username)}/${Date.now()}-${rand}.${ext}`;
}

/**
 * 우리가 발급한 자리에 실제로 올라간 파일의 주소인가.
 *
 * 제출물·자료함에 남는 `fileUrl` 은 화면에서 그대로 링크가 되므로, 아무 문자열이나
 * 받으면 협업 기록 안에 외부 주소를 심을 수 있다. 그래서 저장 전에 "우리 저장소의
 * 주소"인지만 확인한다.
 *
 * 두 모양을 받는다 — 업로드 경로가 한 번 바뀌었기 때문이다.
 *
 *   · `/api/images/<key>`  예전 경로. 파일이 함수를 거쳐 Blobs 에 저장되던 시절의
 *     주소다. 그때 올라간 가이드·기획안·초안 영상이 아직 남아 있어서 계속 받아야 한다.
 *   · 스토리지 공개 주소   지금 경로. 브라우저가 서명된 링크로 스토리지에 직접 올리고
 *     (`/api/upload-url`), 공개 주소를 받아 온다.
 *
 * 두 번째를 빼놓은 것이 실제 사고였다. 파일은 스토리지까지 정상적으로 올라가는데
 * 저장 단계에서 "업로드한 파일을 선택해 주세요"로 거절돼, 인플루언서 화면에서는
 * 초안 영상을 몇 번 올려도 등록되지 않았다.
 */
export function isUploadedFileUrl(raw: unknown): boolean {
  const url = String(raw || "").trim();
  if (!url) return false;
  if (url.startsWith("/api/images/")) return true;

  const base = String(process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return false;
  // 버킷 안이기만 하면 받는다. 막아야 하는 것은 "남의 도메인 주소"이고, 경로 안쪽은
  // 어차피 서버(directUploadPath)가 정한다.
  return url.startsWith(`${base}/storage/v1/object/public/${DIRECT_UPLOAD_BUCKET}/`);
}
