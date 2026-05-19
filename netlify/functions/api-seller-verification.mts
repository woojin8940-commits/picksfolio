import { createDatabase } from "@netlify/database";
import type { Context } from "@netlify/functions";

const db = createDatabase();

export default async (req: Request, context: Context) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const username = pathParts[2] ? decodeURIComponent(pathParts[2]) : url.searchParams.get("username");

    if (!username) {
      return new Response(JSON.stringify({ error: "username is required" }), { status: 400, headers });
    }

    const normalizedUsername = username.toLowerCase();

    if (req.method === "GET") {
      const result = await db.sql`
        SELECT username, business_number, business_name, representative_name, business_type, business_category,
               bank_name, account_number, account_holder, is_verified, verified_at
        FROM seller_verifications WHERE username = ${normalizedUsername} LIMIT 1
      `;
      return new Response(JSON.stringify(result.rows[0] || null), { headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      await db.sql`
        INSERT INTO seller_verifications (username, business_number, business_name, representative_name, business_type, business_category, bank_name, account_number, account_holder)
        VALUES (${normalizedUsername}, ${body.business_number || null}, ${body.business_name || null}, ${body.representative_name || null}, ${body.business_type || null}, ${body.business_category || null}, ${body.bank_name || null}, ${body.account_number || null}, ${body.account_holder || null})
        ON CONFLICT (username) DO UPDATE SET
          business_number = EXCLUDED.business_number,
          business_name = EXCLUDED.business_name,
          representative_name = EXCLUDED.representative_name,
          business_type = EXCLUDED.business_type,
          business_category = EXCLUDED.business_category,
          bank_name = EXCLUDED.bank_name,
          account_number = EXCLUDED.account_number,
          account_holder = EXCLUDED.account_holder,
          updated_at = now()
      `;
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  } catch (error: any) {
    console.error("Seller verification API error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), { status: 500, headers });
  }
};

export const config = { path: "/api/seller-verification/*" };
