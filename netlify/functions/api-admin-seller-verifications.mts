import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { requireAdmin } from "./_shared/admin-auth.mts";

// 셀러 사업자등록증 수동 심사 콘솔용 API.
// 셀러가 제출한 사업자 정보(사업자등록증 이미지 포함)를 관리자가 직접 검토하고
// 수락(approve)/거절(reject)한다. 수락된 셀러만 라이브 커머스 송출이 가능하다.
const STORE = "seller-verification";
const PREFIX = "seller_";

type ReviewStatus = "pending" | "approved" | "rejected";

function reviewStatusOf(data: any): ReviewStatus | null {
  if (!data?.business) return null;
  if (data.business_review_status) return data.business_review_status as ReviewStatus;
  // 구 데이터 호환: 명시적 상태가 없으면 검증 여부로 추정한다.
  return data.business_verified ? "approved" : "pending";
}

export default async (req: Request) => {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const store = getStore(STORE);
  const url = new URL(req.url);

  if (req.method === "GET") {
    const statusFilter = url.searchParams.get("status"); // pending | approved | rejected | all
    const { blobs } = await store.list({ prefix: PREFIX });

    const items: any[] = [];
    for (const b of blobs) {
      const data = (await store.get(b.key, { type: "json" })) as any;
      if (!data?.business) continue;
      const status = reviewStatusOf(data);
      if (statusFilter && statusFilter !== "all" && status !== statusFilter) continue;
      items.push({
        username: b.key.slice(PREFIX.length),
        business: data.business,
        business_verified: !!data.business_verified,
        review_status: status,
        review_reason: data.business_review_reason || "",
        submitted_at: data.business_submitted_at || data.updatedAt || null,
        reviewed_at: data.business_reviewed_at || null,
      });
    }

    // 최근 제출 순으로 정렬한다.
    items.sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));

    const pendingCount = items.filter((i) => i.review_status === "pending").length;
    return Response.json({ items, pendingCount });
  }

  if (req.method === "PATCH") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }

    const username = String(body?.username || "").trim().toLowerCase();
    const action = body?.action;
    const reason = String(body?.reason || "");

    if (!username || !["approve", "reject"].includes(action)) {
      return Response.json({ error: "username 과 action(approve|reject)이 필요합니다." }, { status: 400 });
    }

    const key = `${PREFIX}${username}`;
    const existing = (await store.get(key, { type: "json" })) as any;
    if (!existing?.business) {
      return Response.json({ error: "사업자 제출 내역을 찾을 수 없습니다." }, { status: 404 });
    }

    const merged = { ...existing };
    if (action === "approve") {
      merged.business_verified = true;
      merged.business_review_status = "approved";
      merged.business_review_reason = "";
    } else {
      merged.business_verified = false;
      merged.business_review_status = "rejected";
      merged.business_review_reason = reason;
    }
    merged.business_reviewed_at = new Date().toISOString();
    merged.updatedAt = new Date().toISOString();

    await store.setJSON(key, merged);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/admin/seller-verifications",
};
