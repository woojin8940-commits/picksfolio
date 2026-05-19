import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method === "POST") {
      const body = await req.json();
      const username = body.username?.toLowerCase();
      const paymentId = body.paymentId;

      if (!username || !paymentId) {
        return new Response(JSON.stringify({ error: "username and paymentId are required" }), { status: 400, headers });
      }

      const PORTONE_API_SECRET = Netlify.env.get("PORTONE_API_SECRET");
      if (!PORTONE_API_SECRET) {
        return new Response(JSON.stringify({ success: true, verified: false, message: "Payment verification not configured" }), { headers });
      }

      try {
        const paymentRes = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
          headers: { Authorization: `PortOne ${PORTONE_API_SECRET}` },
        });

        if (paymentRes.ok) {
          const payment = await paymentRes.json();
          return new Response(JSON.stringify({
            success: true,
            verified: payment.status === "PAID",
            payment: {
              status: payment.status,
              amount: payment.amount?.total,
              method: payment.method?.type,
            },
          }), { headers });
        }
      } catch (e) {
        console.error("PortOne API error:", e);
      }

      return new Response(JSON.stringify({ success: true, verified: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("PortOne complete API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/portone-complete" };
