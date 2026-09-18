import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import {
  clearMetaAdsDiagnosis,
  META_ADS_SCOPES,
  metaAdsAppId,
  metaAdsConfigId,
  readMetaAdsDiagnosis,
} from "./_shared/meta-ads.mts";

/**
 * 메타 광고 계정 연동 상태 조회·해제.
 *
 *   GET  /api/meta-ads/connection/:username   연동(진단) 결과를 읽는다.
 *   POST /api/meta-ads/connection/:username   { action: 'disconnect' } 로 지운다.
 *
 * 연동 상태를 브라우저(localStorage)에 두지 않고 서버에서 읽는 이유는, 이제 그 값이
 * 화면 확인용 임시 기록이 아니라 실제로 메타에 물어본 결과이기 때문이다. 브라우저에
 * 두면 기기를 바꾸면 연동이 사라진 것처럼 보이고, 무엇보다 "연동됨"을 화면이 스스로
 * 적을 수 있게 되어 mock 시절의 문제가 그대로 돌아온다.
 *
 * 고른 광고 계정(selectedAccountId)만 브라우저에 남긴다 — 그건 이 브라우저에서 무엇을
 * 보고 있는지에 대한 기록이고, 서버가 돌려준 계정 목록으로 매번 검증한다.
 */
export default async (req: Request, context: Context) => {
  const username = String(context.params?.username || "")
    .replace(/^biz\//, "")
    .toLowerCase()
    .trim();
  if (!username) {
    return Response.json({ error: "username은 필수입니다." }, { status: 400 });
  }

  // 진단 결과에는 이 브랜드의 광고 계정·비즈니스 이름이 들어 있다. 본인만 읽는다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  if (req.method === "GET") {
    const diagnosis = await readMetaAdsDiagnosis(username);
    return Response.json({
      connection: diagnosis,
      // 연동 전 화면이 "무엇을 물어볼 것인지" 안내할 때 쓴다.
      scopes: metaAdsConfigId() ? [] : META_ADS_SCOPES,
      // 앱 설정이 비어 있으면 버튼을 눌러도 동의 화면까지 못 간다. 그 사실을 누르기
      // 전에 화면에 적을 수 있게 알려준다(앱 ID 값 자체는 보내지 않는다).
      appConfigured: !!metaAdsAppId(),
    });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));
    if (String(body?.action || "") !== "disconnect") {
      return Response.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
    }
    // 저장한 토큰이 없으므로 지울 것은 진단 결과뿐이다. 메타 쪽 권한을 회수하려면
    // 페이스북 계정 설정에서 앱을 삭제해야 한다 — 화면 안내에 그렇게 적어 둔다.
    await clearMetaAdsDiagnosis(username);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/meta-ads/connection/:username",
  method: ["GET", "POST"],
};
