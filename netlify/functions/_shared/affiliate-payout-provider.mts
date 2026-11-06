/**
 * 지급 실행(송금) 방식. 지급 완료 처리는 모두 executePayout() 하나를 거친다.
 *
 * 지금은 운영자가 은행에서 직접 이체한 뒤 "지급 완료"를 누르는 수동 방식(manual)만 있다.
 * 나중에 포트원 파트너 정산 API 로 자동 송금하려면 PayoutProvider 를 하나 더 만들어
 * PROVIDERS 에 넣고 activeProvider() 가 그것을 고르게 하면 된다. 호출부(운영자 화면 · API)는
 * 그대로 두고, 결과(externalRef)는 affiliate_payout_requests.external_ref 에 남는다.
 *
 * 규칙: 계좌번호 · 주민등록번호 원문을 로그에 남기지 않는다.
 */

export interface PayoutTarget {
  id: string;
  partyType: "brand" | "influencer";
  party: string;
  /** 실제 보낼 금액(인플루언서는 원천징수 뒤 실지급액). */
  netAmount: number;
  bankName: string;
  /** 암호화된 계좌번호. 자동 송금 방식만 필요할 때 복호화한다. */
  accountEncrypted: string;
  accountHolder: string;
}

export type PayoutResult =
  | { ok: true; method: string; externalRef: string }
  | { ok: false; method: string; error: string; code?: string };

export interface PayoutProvider {
  method: string;
  execute(target: PayoutTarget, ctx: { operator: string }): Promise<PayoutResult>;
}

/** 수동 이체: 운영자가 이미 은행에서 보냈다. 여기서는 기록만 남긴다. */
const manualProvider: PayoutProvider = {
  method: "manual",
  async execute(_target, ctx) {
    return { ok: true, method: "manual", externalRef: `manual:${ctx.operator || "operator"}` };
  },
};

// 예) const portonePartnerProvider: PayoutProvider = { method: "portone_partner", async execute(t) { ... } };
const PROVIDERS: Record<string, PayoutProvider> = { manual: manualProvider };

export function activeProvider(): PayoutProvider {
  // 자동 송금을 붙이면 여기서 고른다(예: 운영 설정 값). 지금은 수동 이체만.
  return PROVIDERS.manual;
}

export async function executePayout(target: PayoutTarget, ctx: { operator: string }): Promise<PayoutResult> {
  const provider = activeProvider();
  try {
    return await provider.execute(target, ctx);
  } catch (e: any) {
    console.error("[affiliate-payout] provider failed", target.id, provider.method, e?.code || e?.name || "");
    return { ok: false, method: provider.method, error: "지급 처리에 실패했습니다.", code: "PROVIDER_ERROR" };
  }
}
