import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import {
  MAX_PARTS,
  PART_SIZE,
  isPartedKey,
  partKey,
  resolveContentType,
  safeExtension,
  safeKeyPrefix,
} from "./_shared/upload-media.mts";

/**
 * 큰 파일(주로 초안 영상)을 여러 조각으로 나눠 받는다.
 *
 * ※ 화면은 더 이상 이 경로를 쓰지 않는다. 지금은 `/api/upload-url` 로 서명된 링크를
 *   받아 브라우저가 스토리지에 파일을 곧장 올린다 — 조각으로 나누는 것은 함수의 요청
 *   본문 한도(약 6MB)를 피하려던 방법이었고, 파일이 함수를 지나가지 않으면 애초에
 *   나눌 이유가 없다. 이 경로를 남겨 두는 이유는 두 가지다: 이미 이 방식으로 올라간
 *   파일이 계속 재생돼야 하고(목록표를 읽는 쪽은 `api-serve-image`), 예전 화면을 띄워
 *   둔 브라우저가 올리던 파일이 중간에 끊기지 않아야 한다.
 *
 * 왜 필요한가 — `/api/upload-image` 는 파일 하나를 요청 본문 하나에 담는다. 그런데
 * Netlify Functions 의 요청 본문 한도는 약 6MB 다(함수 코드에 적힌 10MB 는 그 한도
 * 안쪽에서만 의미가 있다). 초안 영상은 짧은 릴스라도 20~80MB 가 흔해서, "영상 파일
 * 선택 → 올리기" 는 예외 없이 실패했다. 화면에는 서버가 보낸 사유가 아니라
 * "파일 업로드에 실패했습니다." 만 떴으므로, 사람 입장에서는 이유를 알 길이 없었다.
 *
 * 해결 방향 — 한 요청에 6MB 를 넘기지 않는다. 파일을 PART_SIZE 조각으로 잘라 조각마다
 * 한 번씩 요청하고, 마지막에 "다 올렸다"를 알린다. 조각을 하나로 이어 붙이지는 않는다:
 *
 *   · 이어 붙이려면 완료 요청 하나가 조각 전부를 읽어 큰 버퍼로 합쳐 다시 써야 한다.
 *     80MB 짜리 영상이면 그 요청 하나가 함수 실행 시간(10초)과 메모리를 다 태운다.
 *   · 내려줄 때도 이득이 없다. `/api/images/*` 는 영상을 항상 4MB 이하의 부분 응답
 *     (206)으로 내려주므로, 조각을 그대로 두면 필요한 조각만 읽어 그 구간을 만들 수
 *     있다 — 오히려 매 요청마다 전체를 읽던 지금보다 적게 읽는다.
 *
 * 그래서 조각은 저장된 자리에 그대로 남고, 완료 요청은 "조각이 몇 개이고 전체 크기가
 * 얼마인지" 적은 목록표(manifest)만 원래 키에 쓴다. 목록표의 키는 예전과 똑같은
 * `/api/images/<key>` 주소가 되므로, 저장하는 쪽(협업 제출물)과 보여주는 쪽 코드는
 * 하나도 바뀌지 않는다.
 *
 * 인증 — `/api/upload-image` 와 같은 이유로 로그인을 요구하지 않는다(비로그인 업체가
 * 쓰는 공개 제안서 폼이 같은 업로드를 쓴다). 대신 (1) 저장 키를 서버가 만들고,
 * (2) 허용 목록 밖 형식은 시작 단계에서 거부하고, (3) 조각 수·조각 크기·전체 크기에
 * 상한을 둔다. 클라이언트가 키를 지어 보낼 수는 없다 — 조각 요청은 서버가 발급한
 * 키 모양(`<폴더>/<타임스탬프>-<난수>.<확장자>`)만 받는다.
 *
 *   POST /api/upload-chunk   { action: 'init', username, filename, size }
 *     → { key, partSize, parts }
 *   POST /api/upload-chunk   multipart: key, index, chunk
 *     → { ok: true, index }
 *   POST /api/upload-chunk   { action: 'complete', key, parts, size, filename }
 *     → { url, key }
 */

/** 조각을 하나라도 받아 둘 수 있는 최대 전체 크기. */
const MAX_TOTAL_BYTES = PART_SIZE * MAX_PARTS;

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });

/** 조각과 목록표는 파일 본체와 같은 저장소에 둔다 — 내려주는 쪽이 한 저장소만 본다. */
const imagesStore = () => getStore("images");

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const contentType = String(req.headers.get("content-type") || "");

  // ── 조각 올리기(multipart) ──────────────────────────────────────────
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const key = String(form.get("key") || "");
    const index = Number(form.get("index"));
    const chunk = form.get("chunk") as File | null;

    if (!isPartedKey(key)) return bad("잘못된 업로드 주소입니다.");
    if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS) {
      return bad("잘못된 조각 번호입니다.");
    }
    if (!chunk) return bad("조각이 비어 있습니다.");
    // 조각 하나가 규격보다 크면 나머지 조각의 시작 위치 계산이 어긋난다. 내려줄 때
    // 구간을 조각 번호로 되짚기 때문에, 이 크기는 규격과 정확히 맞아야 한다.
    if (chunk.size > PART_SIZE) return bad("조각이 너무 큽니다.");

    await imagesStore().set(partKey(key, index), await chunk.arrayBuffer(), {
      metadata: { part: index, ofKey: key },
    });
    return Response.json({ ok: true, index });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  // ── 시작: 저장 키를 서버가 발급한다 ─────────────────────────────────
  if (action === "init") {
    const filename = String(body.filename || "");
    const size = Number(body.size || 0);
    const username = String(body.username || "anonymous");

    const mime = resolveContentType(filename, String(body.mimeType || ""));
    if (!mime) return bad("이미지·영상·PDF 파일만 올릴 수 있습니다.", 415);
    if (!Number.isFinite(size) || size <= 0) return bad("파일 크기를 알 수 없습니다.");
    if (size > MAX_TOTAL_BYTES) {
      return bad(
        `파일이 너무 큽니다. ${Math.floor(MAX_TOTAL_BYTES / (1024 * 1024))}MB 이하로 올려 주세요.`,
        413,
      );
    }

    const ext = safeExtension(filename) || "bin";
    const key = `${safeKeyPrefix(username)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    return Response.json({
      key,
      partSize: PART_SIZE,
      parts: Math.ceil(size / PART_SIZE),
      maxBytes: MAX_TOTAL_BYTES,
    });
  }

  // ── 완료: 목록표를 원래 키에 쓴다 ───────────────────────────────────
  if (action === "complete") {
    const key = String(body.key || "");
    const parts = Number(body.parts || 0);
    const size = Number(body.size || 0);
    const filename = String(body.filename || "");

    if (!isPartedKey(key)) return bad("잘못된 업로드 주소입니다.");
    if (!Number.isInteger(parts) || parts <= 0 || parts > MAX_PARTS) return bad("조각 수가 잘못됐습니다.");
    if (!Number.isFinite(size) || size <= 0 || size > MAX_TOTAL_BYTES) return bad("파일 크기가 잘못됐습니다.");

    const mime = resolveContentType(key, "");
    if (!mime) return bad("이미지·영상·PDF 파일만 올릴 수 있습니다.", 415);

    /**
     * 조각이 정말 다 올라왔는지 여기서 확인한다.
     *
     * 확인하지 않으면 중간 조각 하나가 빠진 파일에 목록표가 붙는다. 그러면 화면에는
     * 업로드가 성공한 것으로 남고, 나중에 브랜드가 영상을 열 때 그 구간에서 재생이
     * 멈춘다 — 그때는 무엇이 빠졌는지 아무도 알 수 없다. 본문은 읽지 않고
     * 메타데이터만 확인하므로(getMetadata) 큰 파일이어도 이 요청은 가볍다.
     */
    const missing: number[] = [];
    for (let i = 0; i < parts; i += 1) {
      const meta = await imagesStore().getMetadata(partKey(key, i));
      if (!meta) missing.push(i);
    }
    if (missing.length > 0) {
      return bad(`업로드가 끝나지 않았습니다(${missing.length}조각 누락). 다시 시도해 주세요.`, 409);
    }

    // 목록표 본문은 비워 둔다. 실제 바이트는 조각에 있고, 내려주는 쪽은 메타데이터의
    // parts 를 보고 조각에서 읽는다.
    await imagesStore().set(key, new ArrayBuffer(0), {
      metadata: {
        contentType: mime,
        originalName: filename || key,
        parts,
        partSize: PART_SIZE,
        size,
      },
    });

    return Response.json({ url: `/api/images/${key}`, key, size, parts });
  }

  return bad("알 수 없는 요청입니다.");
};

export const config: Config = {
  path: "/api/upload-chunk",
};
