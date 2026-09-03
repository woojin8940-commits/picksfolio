import { getStore } from "@netlify/blobs";
import { computeLiveUsage } from "./_shared/live-usage.mts";
import { checkLiveBroadcastAccess } from "./_shared/live-access.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import type { Config, Context } from "@netlify/functions";

/**
 * 송출 자격증명(Amazon IVS ingest 주소 + 스트림 키)을 내주는 엔드포인트.
 *
 * 스트림 키는 곧 "이 채널로 방송할 수 있는 권한"이다. 개인 채널이 없는 셀러는
 * IVS_STREAM_KEY 환경변수의 공용 채널로 폴백하므로, 무인증으로 열려 있으면 아무나
 * 공용 채널을 탈취해 다른 셀러의 방송 위에 송출할 수 있다. 그래서 이 경로는
 *   1) 본인 계정인지(requireAccountOwner)
 *   2) 라이브 송출 자격이 있는지(checkLiveBroadcastAccess)
 * 를 모두 통과해야 한다. 사용량 한도 검사는 그 다음이다.
 */

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore("stream-keys");
  const key = `stream_${username}`;

  if (req.method === "GET") {
    // 멤버십/사업자 인증 게이트. 관리자는 운영 목적으로 통과시킨다.
    if (!auth.isAdmin) {
      const access = await checkLiveBroadcastAccess(username, auth.userId);
      if (!access.allowed) {
        return Response.json(
          {
            error: access.message,
            gate: access.reason,
          },
          { status: 403 },
        );
      }
    }

    // Gate broadcasting on remaining time: once the monthly allowance
    // (included 3h + prepaid charged hours) is spent, refuse to hand out the
    // stream key so the live console can't start a new broadcast. The seller
    // must charge more time via "시간 충전하기".
    try {
      const usage = await computeLiveUsage(username, new Date());
      if (usage.exhausted) {
        return Response.json(
          {
            capReached: "exhausted",
            error:
              "이번 달 라이브 잔여시간을 모두 사용했습니다. 시간을 충전한 후 다시 시작해주세요.",
            usage,
          },
          { status: 403 },
        );
      }
      if (usage.monthlyHardCapReached) {
        return Response.json(
          {
            capReached: "monthly",
            error: "월 송출 한도(50시간)에 도달했습니다.",
            usage,
          },
          { status: 403 },
        );
      }
    } catch (e) {
      // Never let a usage-lookup failure block an otherwise-valid broadcast.
      console.warn("[stream-key] usage gate check failed (allowing):", e);
    }

    const data = await store.get(key, { type: "json" });
    if (data) {
      return Response.json(data);
    }

    // No per-seller channel stored yet — fall back to the shared Amazon IVS
    // channel provisioned via environment variables. Without this, the live
    // console (web) and the native broadcast screen both get a 404 and treat it
    // as "저장된 스트림 정보가 없어요", leaving the seller unable to go live even
    // though a perfectly good shared channel exists.
    const ingestServer = process.env.IVS_INGEST_SERVER;
    const streamKey = process.env.IVS_STREAM_KEY;
    if (ingestServer && streamKey) {
      const playbackUrl = process.env.VITE_IVS_PLAYBACK_URL || "";
      const rtmpUrl = `${ingestServer.replace(/\/$/, "")}/${streamKey}`;
      return Response.json({ ingestServer, streamKey, playbackUrl, rtmpUrl });
    }

    return Response.json(null, { status: 404 });
  }

  if (req.method === "POST") {
    const body = await req.json();
    await store.setJSON(key, body);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/stream-key/:username",
};
