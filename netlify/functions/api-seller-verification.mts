import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { applyComplimentaryMembership } from "./_shared/complimentary-memberships.mts";
import {
  applyOperatorMembershipGrant,
  getOperatorMembershipGrant,
} from "./_shared/operator-membership-grants.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";
import { mutateBlobJSON } from "./_shared/blob-write.mts";
import { redactSellerRecord } from "./_shared/seller-record.mts";
import { readSellerMembership } from "./_shared/seller-membership-store.mts";
import { resolveCancellation } from "./_shared/membership-billing.mts";

const STORE = "seller-verification";

export default async (req: Request, context: Context) => {
  const username = context.params.username?.toLowerCase();
  if (!username) {
    return Response.json({ error: "Missing username" }, { status: 400 });
  }

  // 이 레코드에는 빌링키가 들어 있고, 여기 쓰는 값이 유료 멤버십 활성 여부를
  // 결정한다. 읽기·쓰기 모두 본인(또는 관리자)만.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;

  const store = getStore(STORE);
  const key = `seller_${username}`;

  if (req.method === "GET") {
    const data = await readSellerMembership(store, username);
    const complimentary = applyComplimentaryMembership(username, data as any);
    const grant = await getOperatorMembershipGrant({
      authUserId: auth.isAdmin ? null : auth.userId,
      username,
    });
    const enriched = applyOperatorMembershipGrant(complimentary, grant);
    if (!enriched) return Response.json(null, { status: 404 });
    return Response.json(redactSellerRecord(enriched));
  }

  if (req.method === "POST") {
    const body = await req.json();

    await readSellerMembership(store, username);

    // 같은 레코드를 정기결제 스케줄러도 고친다. 통째로 읽고 다시 쓰면 서로의
    // 변경(다음 결제일 갱신 등)을 지울 수 있어 조건부 쓰기로 반영한다.
    //
    // 사업자등록증 제출과 정산 계좌 등록은 라이브 커머스 전용 절차였고, 라이브
    // 커머스를 접으면서 함께 없앴다. 이 엔드포인트는 이제 멤버십 상태만 다룬다.
    const merged = (await mutateBlobJSON<Record<string, any>>(STORE, key, (current) => {
      const next: Record<string, any> = { ...(current ?? {}) };

      // 멤버십은 결제를 거쳐야 시작된다(빌링키 발급 → 첫 결제 성공 시 서버가 직접 켠다).
      // 그래서 여기서는 해지(false)만 받는다. true 를 받아주면 결제 없이 유료 기능이
      // 열려버린다.
      //
      // 해지는 즉시 차단이 아니라 "결제한 이용 기간이 끝나는 날 종료"다. 이미 한 달치를
      // 받아 두었으므로 남은 기간은 그대로 쓰게 두고(membership_active 유지), 예약만
      // 걸어 다음 달 결제를 막는다. 종료일에 정기결제 스케줄러가 청구 대신 멤버십을 끈다.
      const at = new Date().toISOString();

      if (body.membership_active === false) {
        const decision = resolveCancellation(next, new Date());
        if (decision.mode === "scheduled") {
          next.membership_cancel_at_period_end = true;
          next.membership_canceled_at = next.membership_canceled_at || at;
          next.membership_ends_at = decision.endsAt;
        } else {
          // 남은 결제 기간이 없는 경우(증정 멤버십처럼 결제일이 없거나 이미 지난 경우)
          // 는 그 자리에서 끝낸다.
          next.membership_active = false;
          next.membership_cancel_at_period_end = false;
          next.membership_canceled_at = at;
          next.membership_ends_at = at;
          next.membership_ended_at = at;
          next.next_billing_date = null;
        }
      } else if (body.membership_cancel_at_period_end === false) {
        // 해지 예약 취소(= 구독 계속하기). 아직 이용 기간이 남아 활성인 구독만 되돌릴 수
        // 있으므로, 이 경로로 결제 없이 멤버십이 켜지는 일은 없다.
        if (next.membership_active && next.membership_cancel_at_period_end) {
          next.membership_cancel_at_period_end = false;
          next.membership_canceled_at = null;
          next.membership_ends_at = null;
        }
      }

      next.updatedAt = at;
      return next;
    })) as Record<string, any>;

    const complimentary = applyComplimentaryMembership(username, merged as any);
    const grant = await getOperatorMembershipGrant({
      authUserId: auth.isAdmin ? null : auth.userId,
      username,
    });
    const enriched = applyOperatorMembershipGrant(complimentary, grant);
    return Response.json({ success: true, data: redactSellerRecord(enriched) });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/seller-verification/:username",
};
