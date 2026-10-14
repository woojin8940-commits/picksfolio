import type { Config, Context } from "@netlify/functions";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { PARTNERSHIP_SCOPES, readMetaAdsDiagnosis, readMetaAdsToken, tokenErrorResponse } from "./_shared/meta-ads.mts";
import { graphErrorResponse, graphGet, graphPost, GraphResult } from "./_shared/meta-ads-graph.mts";

/**
 * 브랜드의 승인된 크리에이터 목록 — 파트너십 광고(instagram_branded_content_ads_brand).
 *
 *   GET  /api/meta-ads/creators/:username/:igUserId
 *        → GET /{ig-user-id}/branded_content_ad_permissions. 이 브랜드 인스타그램 계정이
 *          파트너십 광고 권한을 받은(또는 요청한) 크리에이터 목록.
 *   POST /api/meta-ads/creators/:username/:igUserId
 *        { action: 'add', creatorUsername }    크리에이터를 목록에 추가한다(권한 요청).
 *        { action: 'remove', creatorUsername } 크리에이터를 목록에서 뺀다(revoke=true).
 *
 * 목록은 저장하지 않고 매번 메타에서 읽는다. 크리에이터가 인스타그램 앱에서 직접 수락·
 * 철회할 수 있어서, 여기 복사해 두면 메타와 다른 상태를 보여 주게 된다.
 * igUserId 는 고른 페이스북 페이지에 연결된 브랜드 인스타그램 프로페셔널 계정이다.
 */

const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

const cleanCreator = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();

export interface ApprovedCreator {
  id: string;
  username: string;
  profilePictureUrl: string;
  /** 메타가 돌려준 상태(예: APPROVED, PENDING). 없으면 빈 문자열. */
  status: string;
  permissionType: string;
}

/** 메타 버전마다 행 모양이 조금씩 달라 아는 이름을 모두 확인한다. */
function toCreator(row: any): ApprovedCreator {
  const creator = row?.creator || row?.ig_user || row?.creator_instagram_account || {};
  return {
    id: String(creator?.id || row?.creator_id || row?.id || ""),
    username: String(creator?.username || row?.creator_username || row?.creator_instagram_username || row?.username || ""),
    profilePictureUrl: String(creator?.profile_picture_url || row?.profile_picture_url || ""),
    status: String(row?.status || row?.permission_status || "").toUpperCase(),
    permissionType: String(row?.permission_type || ""),
  };
}

async function listCreators(igUserId: string, token: string, proof: string): Promise<GraphResult> {
  const path = `${igUserId}/branded_content_ad_permissions`;
  const detailed = await graphGet(
    path,
    token,
    { fields: "id,status,permission_type,creator{id,username,profile_picture_url}", limit: 100 },
    proof,
  );
  // 필드 이름을 받지 않는 버전(오류 100)이면 기본 필드로 다시 읽는다.
  if (detailed.ok || detailed.errorCode !== 100) return detailed;
  return graphGet(path, token, { limit: 100 }, proof);
}

/** 연동할 때 파트너십 권한을 받지 않았으면 메타를 부르기 전에 알려 준다. */
function scopeError(granted: string[] | undefined): Response | null {
  if (!Array.isArray(granted) || granted.length === 0) return null;
  const missing = PARTNERSHIP_SCOPES.filter((s) => !granted.includes(s));
  if (missing.length === 0) return null;
  return Response.json(
    {
      error:
        `파트너십 광고 권한(${missing.join(", ")})이 연동에 없습니다. 메타 광고 계정을 다시 연동하고 ` +
        "동의 화면에서 해당 권한을 허용해 주세요.",
      missingScopes: missing,
    },
    { status: 403 },
  );
}

export default async (req: Request, context: Context) => {
  const username = String(context.params?.username || "")
    .replace(/^biz\//, "")
    .toLowerCase()
    .trim();
  const igUserId = String(context.params?.igUserId || "").trim();
  if (!username) return Response.json({ error: "username은 필수입니다." }, { status: 400 });
  if (!/^\d+$/.test(igUserId)) return Response.json({ error: "인스타그램 계정 ID가 올바르지 않습니다." }, { status: 400 });

  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const stored = await readMetaAdsToken(username);
  if (!stored.ok) return tokenErrorResponse(stored.reason);
  const { token, proof } = stored;

  const denied = scopeError((await readMetaAdsDiagnosis(username))?.granted);
  if (denied) return denied;

  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as any;
    const action = String(body?.action || "");
    if (action !== "add" && action !== "remove") {
      return Response.json({ error: "action은 add 또는 remove 여야 합니다." }, { status: 400 });
    }
    const creatorUsername = cleanCreator(body?.creatorUsername);
    if (!USERNAME_RE.test(creatorUsername)) {
      return Response.json({ error: "크리에이터 인스타그램 사용자 이름을 확인해 주세요." }, { status: 400 });
    }
    const res = await graphPost(
      `${igUserId}/branded_content_ad_permissions`,
      token,
      action === "add"
        ? { creator_instagram_username: creatorUsername }
        : { creator_instagram_username: creatorUsername, revoke: true },
      proof,
    );
    if (!res.ok) {
      return graphErrorResponse(
        res,
        action === "add" ? "크리에이터를 추가하지 못했습니다." : "크리에이터를 삭제하지 못했습니다.",
      );
    }
  }

  const res = await listCreators(igUserId, token, proof);
  if (!res.ok) return graphErrorResponse(res, "승인된 크리에이터 목록을 불러오지 못했습니다.");
  const creators = (Array.isArray(res.data?.data) ? res.data.data : [])
    .map(toCreator)
    // 철회된 권한은 목록에서 빠진 것으로 본다.
    .filter((c: ApprovedCreator) => c.status !== "REVOKED");
  return Response.json({ creators, fetchedAt: new Date().toISOString(), source: "meta_graph_api" });
};

export const config: Config = {
  path: "/api/meta-ads/creators/:username/:igUserId",
  method: ["GET", "POST"],
};
