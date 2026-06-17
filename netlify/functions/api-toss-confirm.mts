import type { Config } from "@netlify/functions";

/**
 * 토스페이먼츠 결제 승인 (Payment Widget v2 — 주문서형 연동)
 * https://docs.tosspayments.com/guides/v2/payment-widget/integration
 *
 * 결제위젯에서 결제가 끝나면 토스페이먼츠는 successUrl 로 paymentKey / orderId /
 * amount 를 붙여 리다이렉트한다. 그 값으로 이 엔드포인트가 토스페이먼츠 결제 승인
 * API 를 호출해야 실제 결제가 완료된다. 시크릿 키는 서버에서만 사용하며 브라우저로
 * 절대 노출하지 않는다.
 *
 * 인증: Authorization: Basic base64(`${시크릿키}:`)  ← 콜론 뒤 비밀번호는 비움.
 */

const CONFIRM_URL = "https://api.tosspayments.com/v1/payments/confirm";

// 운영 키는 Netlify 환경변수 TOSS_SECRET_KEY 로 주입한다. 미설정 시 토스 공식 문서에
// 공개된 테스트 시크릿 키로 동작(샌드박스). 운영 전환 시 환경변수를 반드시 설정할 것.
const TEST_SECRET_KEY = "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ message: "Method not allowed" }, { status: 405 });
  }

  let paymentKey: string | undefined;
  let orderId: string | undefined;
  let amount: number | string | undefined;
  try {
    ({ paymentKey, orderId, amount } = await req.json());
  } catch {
    return Response.json({ message: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  if (!paymentKey || !orderId || amount === undefined || amount === null) {
    return Response.json(
      { message: "paymentKey, orderId, amount는 필수입니다." },
      { status: 400 },
    );
  }

  const secretKey = process.env.TOSS_SECRET_KEY || TEST_SECRET_KEY;
  // base64(`${secretKey}:`) — 시크릿 키 뒤에 콜론을 붙이고 비밀번호 자리는 비운다.
  const encryptedSecretKey = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;

  try {
    const res = await fetch(CONFIRM_URL, {
      method: "POST",
      headers: {
        Authorization: encryptedSecretKey,
        "Content-Type": "application/json",
        // 동일 주문의 중복 승인을 방지하는 멱등키.
        "Idempotency-Key": `confirm-${orderId}`,
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });

    const data = await res.json();

    if (!res.ok) {
      // 토스페이먼츠가 내려준 에러(code/message)를 그대로 전달한다.
      return Response.json(data, { status: res.status });
    }

    // 승인 성공 — 실제 서비스라면 여기서 주문을 결제완료 처리한다.
    return Response.json(data, { status: 200 });
  } catch (err: any) {
    return Response.json(
      { message: err?.message || "결제 승인 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/payments/confirm",
};
