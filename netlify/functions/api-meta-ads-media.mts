import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { readMetaAdsDiagnosis, readMetaAdsToken, tokenErrorResponse } from "./_shared/meta-ads.mts";
import { graphErrorResponse, graphGet, graphPost, graphPostForm } from "./_shared/meta-ads-graph.mts";

/**
 * 광고 소재 업로드 — 직접 소재 업로드 창에서 고른 파일을 메타 광고 계정에 올린다.
 *
 *   POST /api/meta-ads/media/:username
 *     { kind: 'image', adAccountId, bytes }                 → act_{id}/adimages → { hash }
 *     { kind: 'video_start', adAccountId, fileSize }        → act_{id}/advideos (start)
 *     { kind: 'video_transfer', adAccountId, sessionId, startOffset, chunk }
 *     { kind: 'video_finish', adAccountId, sessionId, title }
 *     { kind: 'video_status', videoId }                     → { status: ready|processing|error }
 *
 * 영상은 메타의 분할 업로드(upload_phase)를 그대로 중계한다. 함수 요청 본문에는 크기
 * 제한이 있어 영상 한 개를 한 번에 받을 수 없고, 영상을 우리 저장소에 먼저 올렸다가
 * 메타가 가져가게 하면 브랜드 소재가 공개 주소로 한동안 떠 있게 된다. 조각은 base64 로
 * 받아 이 요청 안에서 바로 메타로 넘기고 어디에도 남기지 않는다.
 */

/** 이미지 한 장의 상한. 화면이 올리기 전에 줄여서 보낸다(본문 상한 6MB 안쪽). */
const MAX_IMAGE_BASE64 = 5_500_000;
const MAX_CHUNK_BASE64 = 5_500_000;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const username = String(context.params?.username || "")
    .replace(/^biz\//, "")
    .toLowerCase()
    .trim();
  if (!username) return Response.json({ error: "username은 필수입니다." }, { status: 400 });

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const stored = await readMetaAdsToken(username);
  if (!stored.ok) return tokenErrorResponse(stored.reason);
  const { token, proof } = stored;

  const body = (await req.json().catch(() => ({}))) as any;
  const kind = String(body?.kind || "");

  if (kind === "video_status") {
    const videoId = String(body?.videoId || "");
    if (!/^\d+$/.test(videoId)) return Response.json({ error: "videoId가 올바르지 않습니다." }, { status: 400 });
    const res = await graphGet(videoId, token, { fields: "status" }, proof);
    if (!res.ok) return graphErrorResponse(res, "영상 처리 상태를 확인하지 못했습니다.");
    return Response.json({ status: String(res.data?.status?.video_status || "processing") });
  }

  // 업로드 대상 광고 계정은 연동 결과에 있는 계정만 받는다 — 경로의 계정 주인이
  // 확인됐어도, 본문의 광고 계정은 그 사람이 고른 값이라 그대로 믿지 않는다.
  const adAccountId = String(body?.adAccountId || "");
  const diagnosis = await readMetaAdsDiagnosis(username);
  if (!diagnosis?.accounts?.some((a) => a.id === adAccountId)) {
    return Response.json({ error: "연동된 광고 계정이 아닙니다." }, { status: 400 });
  }

  if (kind === "image") {
    const bytes = String(body?.bytes || "").replace(/^data:[^,]+,/, "");
    if (!bytes) return Response.json({ error: "이미지가 비어 있습니다." }, { status: 400 });
    if (bytes.length > MAX_IMAGE_BASE64) {
      return Response.json({ error: "이미지가 너무 큽니다. 4MB 이하로 올려 주세요." }, { status: 413 });
    }
    const res = await graphPost(`${adAccountId}/adimages`, token, { bytes }, proof);
    if (!res.ok) return graphErrorResponse(res, "이미지를 Meta에 올리지 못했습니다.");
    const first: any = Object.values(res.data?.images || {})[0] || {};
    if (!first?.hash) return Response.json({ error: "Meta가 이미지 해시를 돌려주지 않았습니다." }, { status: 502 });
    return Response.json({ hash: String(first.hash), url: String(first.url || "") });
  }

  if (kind === "video_start") {
    const fileSize = Number(body?.fileSize) || 0;
    if (fileSize <= 0) return Response.json({ error: "영상 크기가 올바르지 않습니다." }, { status: 400 });
    const res = await graphPost(
      `${adAccountId}/advideos`,
      token,
      { upload_phase: "start", file_size: fileSize },
      proof,
    );
    if (!res.ok) return graphErrorResponse(res, "영상 업로드를 시작하지 못했습니다.");
    return Response.json({
      sessionId: String(res.data?.upload_session_id || ""),
      videoId: String(res.data?.video_id || ""),
      startOffset: Number(res.data?.start_offset) || 0,
      endOffset: Number(res.data?.end_offset) || 0,
    });
  }

  if (kind === "video_transfer") {
    const sessionId = String(body?.sessionId || "");
    const chunk = String(body?.chunk || "");
    if (!sessionId || !chunk) return Response.json({ error: "조각 정보가 비어 있습니다." }, { status: 400 });
    if (chunk.length > MAX_CHUNK_BASE64) return Response.json({ error: "조각이 너무 큽니다." }, { status: 413 });
    const form = new FormData();
    form.set("upload_phase", "transfer");
    form.set("upload_session_id", sessionId);
    form.set("start_offset", String(Number(body?.startOffset) || 0));
    form.set("video_file_chunk", new Blob([Buffer.from(chunk, "base64")]), "chunk");
    const res = await graphPostForm(`${adAccountId}/advideos`, token, form, proof);
    if (!res.ok) return graphErrorResponse(res, "영상 조각을 올리지 못했습니다.");
    return Response.json({
      startOffset: Number(res.data?.start_offset) || 0,
      endOffset: Number(res.data?.end_offset) || 0,
    });
  }

  if (kind === "video_finish") {
    const sessionId = String(body?.sessionId || "");
    if (!sessionId) return Response.json({ error: "업로드 세션이 없습니다." }, { status: 400 });
    const res = await graphPost(
      `${adAccountId}/advideos`,
      token,
      { upload_phase: "finish", upload_session_id: sessionId, title: String(body?.title || "PICKSfolio ad").slice(0, 100) },
      proof,
    );
    if (!res.ok) return graphErrorResponse(res, "영상 업로드를 마치지 못했습니다.");
    return Response.json({ ok: !!res.data?.success });
  }

  return Response.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
};

export const config: Config = {
  path: "/api/meta-ads/media/:username",
  method: ["POST"],
};
