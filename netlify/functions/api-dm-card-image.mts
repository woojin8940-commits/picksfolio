import type { Config, Context } from "@netlify/functions";
import {
  DM_AUTOMATION_REQUIRED_MESSAGE,
  DM_AUTOMATION_TIER,
  dmAutomationAllowed,
} from "./_shared/dm-automation-access.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { getSupabaseServer } from "./_shared/supabase.mts";
import { DIRECT_UPLOAD_BUCKET, directUploadPath } from "./_shared/upload-media.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 인스타그램 피드 사진을 캐러셀 카드 이미지로 복사한다.
 *
 *   POST /api/dm-card-image/:username  { sourceUrl }
 *     → { url }   (만료되지 않는 공개 절대주소)
 *
 * 왜 서버가 복사하는가.
 *
 * 캐러셀 카드의 이미지는 인스타그램이 발송 시점에 그 주소로 직접 받아간다. 피드
 * 사진의 CDN 주소를 그대로 카드에 저장하면 처음 며칠은 잘 보이다가, 서명이 만료되는
 * 순간부터 카드가 이미지 없이 도착한다 — 설정을 바꾼 것도 아닌데 어느 날부터 사진만
 * 사라지는, 사용자가 원인을 찾을 수 없는 고장이다. 그래서 고른 순간에 사진을 우리
 * 저장소로 옮겨 두고, 카드에는 그 주소를 넣는다.
 *
 * 브라우저에서 직접 복사할 수는 없다. 인스타그램 CDN 은 교차 출처 읽기를 허용하지
 * 않아서 화면에서 사진의 바이트를 받아 다시 올릴 방법이 없다.
 *
 * 임의의 주소를 받아 서버가 대신 요청하는 창구는 그 자체로 위험하므로(내부망 주소를
 * 넣어 우리 서버를 발판으로 쓰는 요청), 받아들이는 주소를 인스타그램/페이스북 CDN
 * 으로 한정하고 크기·형식도 함께 검사한다.
 */

/** 사진을 가져올 수 있는 호스트. 이 목록 밖의 주소는 요청하지 않는다. */
const ALLOWED_HOST_SUFFIXES = [
  ".cdninstagram.com",
  ".fbcdn.net",
  ".instagram.com",
  ".facebook.com",
];

/** 받아들일 이미지 형식 → 저장할 확장자. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 카드 이미지 한 장의 크기 상한(화면의 업로드 한도와 같은 값). */
const MAX_BYTES = 8 * 1024 * 1024;

/** 원격 이미지를 기다릴 시간. 넘기면 화면에서 다시 시도하게 안내한다. */
const FETCH_TIMEOUT_MS = 15_000;

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

/** 가져와도 되는 주소인가. https 이고 허용 호스트일 때만 통과한다. */
function allowedSource(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const ok = ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  );
  return ok ? url : null;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const username = context.params.username?.toLowerCase();
  if (!username) return bad("Missing username");

  // 본인(또는 관리자)만 자기 계정의 카드 이미지를 만들 수 있다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  // 디엠 자동화와 같은 자격을 요구한다. 카드 이미지는 그 기능의 일부다.
  if (!(await dmAutomationAllowed(username, auth.userId))) {
    return Response.json(
      {
        error: DM_AUTOMATION_REQUIRED_MESSAGE,
        code: "DM_AUTOMATION_PLAN_REQUIRED",
        requiredTier: DM_AUTOMATION_TIER,
      },
      { status: 403 },
    );
  }

  // 한 번의 호출이 곧 외부 요청 한 번 + 저장소 쓰기 한 번이다. 횟수를 묶어 둔다.
  const limited = await checkRateLimit({
    bucket: "dm-card-image",
    key: `${username}:${clientIp(req)}`,
    limit: 60,
    windowSeconds: 600,
    message: "이미지 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  });
  if (!limited.ok) return limited.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const source = allowedSource(String(body.sourceUrl || ""));
  if (!source) {
    return bad("인스타그램 피드 사진 주소만 가져올 수 있습니다. 다른 이미지는 직접 올려 주세요.");
  }

  let bytes: ArrayBuffer;
  let contentType: string;
  try {
    const res = await fetch(source.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 서명이 이미 만료된 주소(오래된 피드 목록)면 여기로 온다.
      return bad(
        `피드 사진을 가져오지 못했습니다. (HTTP ${res.status}) 게시물 목록을 새로 불러온 뒤 다시 시도해 주세요.`,
        502,
      );
    }

    contentType = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!EXTENSION_BY_TYPE[contentType]) {
      return bad("이미지 파일이 아닙니다. (JPG · PNG · WEBP 만 카드에 넣을 수 있습니다)", 415);
    }

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) {
      return bad(`사진이 큽니다. ${Math.floor(MAX_BYTES / (1024 * 1024))}MB 이하만 카드에 넣을 수 있습니다.`, 413);
    }

    bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0) return bad("빈 이미지를 받았습니다. 잠시 후 다시 시도해 주세요.", 502);
    if (bytes.byteLength > MAX_BYTES) {
      return bad(`사진이 큽니다. ${Math.floor(MAX_BYTES / (1024 * 1024))}MB 이하만 카드에 넣을 수 있습니다.`, 413);
    }
  } catch (e) {
    const aborted = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    console.warn("[dm-card-image] 피드 사진 가져오기 실패:", (e as Error)?.message);
    return bad(
      aborted
        ? "피드 사진을 가져오는 데 너무 오래 걸렸습니다. 다시 시도해 주세요."
        : "피드 사진을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      502,
    );
  }

  // 저장 자리는 서버가 정한다(업로드 경로와 같은 규칙). 매번 새 자리라 덮어쓸 일이 없다.
  const path = directUploadPath(`dm-cards-${username}`, `card.${EXTENSION_BY_TYPE[contentType]}`);

  try {
    const storage = getSupabaseServer().storage.from(DIRECT_UPLOAD_BUCKET);
    const { error } = await storage.upload(path, bytes, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) {
      console.error("[dm-card-image] 저장 실패:", error.message);
      return bad("이미지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }

    /**
     * 공개 주소를 그대로 돌려준다. 서명된 열기 주소는 유효기간이 있어서, 저장해 두면
     * 며칠 뒤 인스타그램이 이미지를 받아갈 때 만료된 링크가 된다 — 이 함수가 존재하는
     * 이유가 바로 그 만료를 없애는 것이다.
     */
    const { data: pub } = storage.getPublicUrl(path);
    const url = pub?.publicUrl || "";
    if (!url) return bad("이미지 주소를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);

    return Response.json({ url, path });
  } catch (e) {
    console.error("[dm-card-image] 스토리지 연결 실패:", (e as Error)?.message);
    return bad("업로드 저장소에 연결할 수 없습니다. 관리자에게 알려 주세요.", 503);
  }
};

export const config: Config = {
  path: "/api/dm-card-image/:username",
};
