/**
 * seller-verification 레코드에는 카드로 실제 청구할 수 있는 빌링키가 들어 있다.
 * 화면에서 쓰지 않는 값이므로 응답에서 빼고 "등록됨" 여부만 내려준다.
 * (본인 확인을 통과한 요청이라도 굳이 브라우저까지 보낼 필요가 없다.)
 */
export function redactSellerRecord<T extends Record<string, any> | null | undefined>(
  record: T,
): T {
  if (!record || typeof record !== "object") return record;
  const { billing_key, toss_customer_key, ...rest } = record as Record<string, any>;
  return { ...rest, billing_key_registered: !!billing_key } as unknown as T;
}
