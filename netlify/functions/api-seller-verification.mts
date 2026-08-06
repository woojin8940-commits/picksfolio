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

  // 이 레코드에는 빌링키가 들어 있고, 여기 쓰는 값이 유료 멤버십 활성 여부를
  // 결정한다. 읽기·쓰기 모두 본인(또는 관리자)만.
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
    //
    // 사업자등록증 제출과 정산 계좌 등록은 라이브 커머스 전용 절차였고, 라이브
    // 커머스를 접으면서 함께 없앴다. 이 엔드포인트는 이제 멤버십 상태만 다룬다.
    const merged = (await mutateBlobJSON<Record<string, any>>(STORE, key, (current) => {
      const next: Record<string, any> = { ...(current ?? {}) };

      // 멤버십은 결제를 거쳐야 시작된다(빌링키 발급 → 첫 결제 성공 시 서버가 직접 켠다).
      // 그래서 여기서는 해지(false)만 받는다. true 를 받아주면 결제 없이 유료 기능이
      // 열려버린다.
      if (body.membership_active === false) {
        next.membership_active = false;
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
