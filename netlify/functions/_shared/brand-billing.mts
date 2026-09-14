/**
 * 브랜드에게 청구하는 금액은 인플루언서에게 줄 금액이 아니다.
 *
 * 돈은 브랜드 → 픽스폴리오 → 인플루언서로 흐르고, 두 구간의 금액이 다르다. 브랜드가
 * 보는 금액은 담당자가 리스트업(인플루언서 명단)에 적어 브랜드가 그걸 보고 고른
 * 광고비(campaign_listups.quoted_fee + quoted_second_use_fee)이고, 인플루언서가 받는
 * 금액은 그 뒤 제안에서 합의된 보수(collab_terms.fee = offer.fee)다. 그 차액이
 * 픽스폴리오의 마진이다 — 리스트업 화면이 브랜드에게 지급액을 숨기는 이유도 같다
 * (shapeListup 의 brand 분기).
 *
 * 그런데 브랜드 정산 화면과 담당자의 청구 금액은 한동안 collab_terms.fee 를 더해
 * 보여 줬다. 그러면 브랜드가 보낼 금액이 인플루언서 보수와 같아지고, 그대로 입금받으면
 * 마진이 0원이 된다 — 300만원짜리 협업의 청구서에 300만원이 찍히는 식이다.
 *
 * 그래서 청구 금액의 기준을 한 곳에 모아 둔다. 규칙은 두 줄이다.
 *
 *   · 리스트업을 거친 협업 — 광고비(제시가)가 곧 청구 금액이다. 아직 적히지 않았으면
 *     금액 미확정으로 남긴다. 보수로 대신 채우지 않는다. 그것이 처음의 문제였고,
 *     비워 두면 담당자가 광고비를 적어야 청구서가 완성된다는 사실이 화면에 남는다.
 *   · 리스트업이 없는 협업 — 브랜드가 캠페인에 직접 적어 공개 모집한 광고비가 그대로
 *     조건표에 들어온 건이다(campaigns.reward_amount → collab_terms.fee). 이때는
 *     조건표 금액이 곧 브랜드가 약속한 광고비이므로 그 값을 쓴다.
 */

export type BrandAmountInput = {
  /** 리스트업에 적힌 광고비 합계(제시가 + 2차 활용). */
  quotedTotal: number;
  /** 이 협업에 리스트업 행이 있는가. 없으면 공개 모집으로 들어온 건이다. */
  listed: boolean;
  /** 확정 조건의 보수 — 리스트업이 없을 때만 청구 금액이 된다. */
  payoutFee: number;
};

export type BrandAmount = {
  /** 브랜드가 픽스폴리오에 보낼 금액. */
  amount: number;
  /** 금액이 아직 정해지지 않았는가. 0원으로 그리면 보낼 것이 없는 건으로 읽힌다. */
  pending: boolean;
};

const won = (raw: unknown) => {
  const value = Math.trunc(Number(raw || 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** 협업 한 건의 브랜드 청구 금액. 규칙은 이 파일 맨 위 설명 그대로다. */
export function resolveBrandAmount(input: BrandAmountInput): BrandAmount {
  const quoted = won(input.quotedTotal);
  if (quoted > 0) return { amount: quoted, pending: false };
  // 리스트업을 거친 협업의 빈 광고비는 보수로 채우지 않는다 — 마진 없는 청구서가 된다.
  if (input.listed) return { amount: 0, pending: true };
  const payout = won(input.payoutFee);
  return { amount: payout, pending: payout <= 0 };
}
