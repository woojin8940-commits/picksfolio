import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { applyComplimentaryMembership } from "./_shared/complimentary-memberships.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { redactSellerRecord } from "./_shared/seller-record.mts";

const STORE = "seller-verification";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 이 레코드에는 정산 계좌·사업자등록증·빌링키가 들어 있고, 여기 쓰는 값이
  // 유료 멤버십 활성 여부를 결정한다. 읽기·쓰기 모두 본인(또는 관리자)만.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore(STORE);
  const key = `seller_${username}`;

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    const enriched = applyComplimentaryMembership(username, data as any);
    if (!enriched) return Response.json(null, { status: 404 });
    return Response.json(redactSellerRecord(enriched));
  }

  if (req.method === "POST") {
    const body = await req.json();

    // 같은 레코드를 정기결제 스케줄러도 고친다. 통째로 읽고 다시 쓰면 서로의
    // 변경(다음 결제일 갱신 등)을 지울 수 있어 조건부 쓰기로 반영한다.
    const merged = (await mutateBlobJSON<Record<string, any>>(STORE, key, (current) => {
      const next: Record<string, any> = { ...(current ?? {}) };

      if (body.business !== undefined) {
        next.business = body.business;
        const b = body.business;
        // 자동 승인하지 않는다. 사업자등록증 이미지를 받아 관리자가 수동으로 심사·수락한다.
        // 제출이 들어오면 인증을 해제하고 심사 대기(pending) 상태로 둔다. 관리자가 수락해야
        // business_verified 가 true 가 되어 라이브 송출이 가능해진다.
        if (b && b.registration_image_url) {
          next.business_verified = false;
          next.business_review_status = "pending";
          next.business_review_reason = "";
          next.business_submitted_at = new Date().toISOString();
          next.business_reviewed_at = null;
        }
      }

      if (body.settlement !== undefined) {
        next.settlement = body.settlement;
        const s = body.settlement;
        if (s && s.bank_name && s.account_number && s.account_holder) {
          next.settlement_registered = true;
        }
      }

      // 멤버십은 결제를 거쳐야 시작된다(빌링키 발급 → 첫 결제 성공 시 서버가 직접 켠다).
      // 그래서 여기서는 해지(false)만 받는다. true 를 받아주면 결제 없이 유료 기능이
      // 열려버린다.
      if (body.membership_active === false) {
        next.membership_active = false;
      }

      // 라이브 커머스는 멤버십과 따로 결제하는 구독이라 해지도 따로 받는다.
      if (body.live_plan_active === false) {
        next.live_plan_active = false;
      }

      next.updatedAt = new Date().toISOString();
      return next;
    })) as Record<string, any>;

    const enriched = applyComplimentaryMembership(username, merged as any);
    return Response.json({ success: true, data: redactSellerRecord(enriched) });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/seller-verification/:username",
};
