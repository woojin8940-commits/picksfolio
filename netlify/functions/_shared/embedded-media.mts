import { getStore } from "@netlify/blobs";
import { ALLOWED_CONTENT_TYPES, safeKeyPrefix } from "./upload-media.mts";

/**
 * 문서 안에 박힌 `data:` URL 을 블롭으로 옮긴다.
 *
 * 링크 관리의 이미지·영상은 `/api/upload-image` 로 올려 `/api/images/<키>` 주소만
 * 저장하는 게 정상 경로다. 그런데 화면에는 업로드가 실패했을 때 base64 `data:` URL
 * 을 그대로 값에 넣는 폴백이 있다(LinkManagement 의 `blobToDataUrl`). 한 번 그렇게
 * 저장되면 그 문서는 영구히 무거워진다 — 실제로 한 계정의 site_data 는 본문 6.5KB
 * 에 1.43MB 짜리 base64 PNG 하나가 붙어 1.46MB 가 되어 있었다.
 *
 * 그 문서는 저장할 때마다 통째로: 읽고 → 스냅샷으로 한 번 더 쓰고 → 병합해 다시
 * 쓰고 → 다시 읽어 → 블롭으로 복사된다. 6.5KB 를 저장하려고 매번 7MB 가까이
 * 오가는 셈이라 함수 실행 시간을 넘겨 저장이 실패했고, 화면에는 "로컬에 저장됨
 * (클라우드 동기화 재시도 중...)" 만 남았다. 같은 요청을 다시 보내는 재시도는
 * 당연히 같은 이유로 또 실패한다.
 *
 * 그래서 저장 경로에서 `data:` URL 을 발견하면 블롭으로 옮기고 값은
 * `/api/images/<키>` 주소로 바꾼다. 들어오는 요청과 이미 저장된 문서 양쪽에
 * 적용하므로, 이미 무거워진 문서도 다음 저장 한 번으로 정상 크기로 돌아온다.
 * 이미지는 그대로 남는다 — 주소만 바뀐다.
 */

/** 이 크기 이하의 data URL 은 그냥 둔다(아이콘 등 아주 작은 값). */
const INLINE_LIMIT = 8 * 1024;

/** 한 요청에서 옮길 수 있는 양의 상한. 함수 실행 시간을 예측 가능하게 유지한다. */
const MAX_OFFLOAD_BYTES = 12 * 1024 * 1024;
const MAX_OFFLOAD_ITEMS = 40;

/** `data:<형식>;base64,<본문>`. 화면의 FileReader 폴백이 만드는 형태다. */
const DATA_URL_RE = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]*)$/i;

/** 형식 → 확장자. 저장 키의 확장자가 곧 내려줄 때의 Content-Type 근거가 된다. */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [ext, type] of Object.entries(ALLOWED_CONTENT_TYPES)) {
    if (!map[type]) map[type] = ext;
  }
  return map;
})();

export interface OffloadReport {
  /** 블롭으로 옮긴 값의 개수. */
  moved: number;
  /** 옮긴 원본 바이트 수. */
  bytes: number;
  /** 옮기지 못하고 그대로 둔 값의 개수(형식 미허용 · 저장 실패 · 상한 초과). */
  skipped: number;
}

function decodeBase64(body: string): Uint8Array | null {
  try {
    const buf = Buffer.from(body.replace(/\s+/g, ""), "base64");
    return buf.byteLength > 0 ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

/**
 * `value` 안의 모든 문자열을 훑어 큰 base64 data URL 만 블롭으로 옮긴다.
 *
 * 옮기지 못한 값은 원래대로 남겨 둔다 — 저장에 실패해도 이미지를 잃는 것보다
 * 무거운 문서로 남는 게 낫다. 실패는 `report` 로만 알린다(호출부가 로그를 남긴다).
 */
export async function offloadEmbeddedMedia<T>(
  value: T,
  username: string,
  report: OffloadReport = { moved: 0, bytes: 0, skipped: 0 },
): Promise<{ value: T; report: OffloadReport }> {
  const prefix = safeKeyPrefix(username);
  let store: ReturnType<typeof getStore> | null = null;

  const moveOne = async (dataUrl: string): Promise<string> => {
    if (dataUrl.length <= INLINE_LIMIT) return dataUrl;

    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) {
      report.skipped += 1;
      return dataUrl;
    }

    const contentType = match[1].toLowerCase();
    const ext = EXTENSION_BY_CONTENT_TYPE[contentType];
    // 허용 목록에 없는 형식은 블롭에 두지 않는다(업로드 경로와 같은 기준).
    if (!ext) {
      report.skipped += 1;
      return dataUrl;
    }

    if (report.moved >= MAX_OFFLOAD_ITEMS || report.bytes >= MAX_OFFLOAD_BYTES) {
      report.skipped += 1;
      return dataUrl;
    }

    const bytes = decodeBase64(match[2]);
    if (!bytes) {
      report.skipped += 1;
      return dataUrl;
    }

    try {
      if (!store) store = getStore("images");
      const key = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await store.set(key, bytes, { metadata: { contentType, originalName: `embedded.${ext}` } });
      report.moved += 1;
      report.bytes += bytes.byteLength;
      return `/api/images/${key}`;
    } catch {
      // 블롭에 쓰지 못했으면 값은 그대로 둔다. 저장 자체는 계속 진행한다.
      report.skipped += 1;
      return dataUrl;
    }
  };

  const walk = async (node: any): Promise<any> => {
    if (typeof node === "string") {
      return node.startsWith("data:") ? await moveOne(node) : node;
    }
    if (Array.isArray(node)) {
      const out = new Array(node.length);
      for (let i = 0; i < node.length; i += 1) out[i] = await walk(node[i]);
      return out;
    }
    if (node && typeof node === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(node)) out[k] = await walk(v);
      return out;
    }
    return node;
  };

  // data URL 이 하나도 없으면(대부분의 저장) 원본을 그대로 돌려준다 — 문서를
  // 복제하지 않으므로 정상 저장에는 비용이 붙지 않는다.
  if (!JSON.stringify(value ?? null).includes("data:")) {
    return { value, report };
  }

  return { value: (await walk(value)) as T, report };
}
