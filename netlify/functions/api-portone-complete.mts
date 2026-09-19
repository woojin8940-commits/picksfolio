import type { Config } from "@netlify/functions";
import { verifyPortOnePayment } from "./_shared/portone-payment.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const { username, paymentId, payMethod } = await req.json();
    if (!username || !paymentId) {
      return Response.json({ success: false, error: "Missing params" }, { status: 400 });
    }

    const auth = await requireAccountOwner(req, String(username));
    if (!auth.ok) return auth.response;

    const verified = await verifyPortOnePayment({
      paymentId: String(paymentId),
      payMethod: String(payMethod || ""),
      expectedOwner: String(username),
    });
    if (!verified.ok) {
      return Response.json(
        { success: false, error: verified.error },
        { status: verified.status },
      );
    }
    const { payment, paidAmount } = verified;

    return Response.json({
      success: true,
      data: {
        paymentId: payment.id || paymentId,
        status: payment.status,
        amount: paidAmount,
        pgTxId: payment.pgTxId,
        paidAt: payment.paidAt,
      },
    });
  } catch (err: any) {
    console.error("[PortOne] payment verification failed", err);
    return Response.json({ success: false, error: "결제 검증에 실패했습니다." }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/portone-complete",
  method: ["POST"],
};
