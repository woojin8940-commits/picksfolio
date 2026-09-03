/**
 * seller-verification 레코드에는 카드로 실제 청구할 수 있는 빌링키가 들어 있다.
 * 화면에서 쓰지 않는 값이므로 응답에서 빼고 "등록됨" 여부만 내려준다.
 * (본인 확인을 통과한 요청이라도 굳이 브라우저까지 보낼 필요가 없다.)
 *
 * 예전 라이브 커머스 시절에 제출된 사업자등록증·정산 계좌도 오래된 레코드에는
 * 그대로 남아 있다. 두 절차 모두 없앴으니 쓰는 화면이 없고, 계좌번호를 다시
 * 브라우저로 흘려보낼 이유도 없어 응답에서 함께 뺀다.
 */
export function redactSellerRecord<T extends Record<string, any> | null | undefined>(
  record: T,
): T {
  if (!record || typeof record !== "object") return record;
  const {
    billing_key,
    // 레거시 필드 — 예전 결제 연동에서 저장된 값이 남아 있을 수 있어 공개 응답에서 계속 지운다.
    toss_customer_key,
    business,
    settlement,
    business_verified,
    business_review_status,
    business_review_reason,
    business_submitted_at,
    business_reviewed_at,
    settlement_registered,
    ...rest
  } = record as Record<string, any>;
  return { ...rest, billing_key_registered: !!billing_key } as unknown as T;
}
