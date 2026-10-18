import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { encryptPii, jsonError, maskRrn, normalizeRrn, piiReady } from "./_shared/affiliate.mts";

/**
 * 판매 수수료 지급 정보 (인플루언서 본인만).
 *
 *   GET /api/affiliate-payout-account   내 지급 정보. 아직 없으면 협업 정산에서 낸 계좌로 미리 채운다.
 *   PUT /api/affiliate-payout-account   { legalName, rrn, bankName, accountNumber }
 *
 * 받는 것은 성명 · 주민등록번호 · 계좌뿐이다. 신분증 사본은 받지 않는다. 성명은 원천징수
 * (3.3%) 신고 이름이자 예금주라 계좌 예금주와 같아야 한다.
 *
 * 주민등록번호는 암호화해서만 저장하고, 응답에는 가린 값만 싣는다 — 본인에게도 원문을
 * 돌려주지 않는다. 이미 낸 적이 있으면 번호를 다시 적지 않고 계좌만 고칠 수 있다.
 * 원문은 운영자가 지급할 때만 열어 본다(api-affiliate-settlements 의 reveal_account).
 */

const shape = (r: any, prefilled = false) => ({
  legalName: String(r?.legal_name || r?.account_holder || ""),
  rrnMasked: prefilled ? "" : String(r?.rrn_masked || ""),
  bankName: String(r?.bank_name || ""),
  accountNumber: String(r?.account_number || ""),
  submittedAt: r?.submitted_at && !prefilled ? new Date(r.submitted_at).toISOString() : null,
  prefilled,
});

export default async (req: Request) => {
  const caller = await requireSignedInUser(req);
  if (!caller.ok) return caller.response;
  const me = caller.username;
  if (!me) return jsonError("아이디를 먼저 만들어 주세요.", 400);
  const db = getDatabase();

  if (req.method === "GET") {
    const own = ((await db.sql`SELECT * FROM influencer_payout_accounts WHERE username = ${me}`) as any[])[0];
    if (own) return Response.json({ account: shape(own) });
    try {
      const prev = ((await db.sql`
        SELECT si.account_holder, si.bank_name, si.account_number FROM collab_settlement_info si
        JOIN campaign_collabs cc ON cc.id = si.collab_id
        WHERE cc.creator_username = ${me} AND si.submitted_at IS NOT NULL
        ORDER BY si.submitted_at DESC LIMIT 1
      `) as any[])[0];
      return Response.json({ account: prev ? shape(prev, true) : null });
    } catch {
      return Response.json({ account: null });
    }
  }

  if (req.method === "PUT") {
    if (!piiReady()) return jsonError("지금은 지급 정보를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503);
    const body = await req.json().catch(() => ({}));
    const legalName = String(body?.legalName || "").trim().slice(0, 40);
    const bankName = String(body?.bankName || "").trim().slice(0, 40);
    const accountNumber = String(body?.accountNumber || "").replace(/[^0-9-]/g, "").slice(0, 40);
    if (!legalName) return jsonError("성명을 입력해 주세요.");
    if (!bankName || accountNumber.replace(/\D/g, "").length < 6) return jsonError("은행과 계좌번호를 정확히 입력해 주세요.");

    const existing = ((await db.sql`
      SELECT rrn_encrypted, rrn_masked FROM influencer_payout_accounts WHERE username = ${me}
    `) as any[])[0];
    const rawRrn = String(body?.rrn || "").trim();
    let rrnEncrypted = String(existing?.rrn_encrypted || "");
    let rrnMasked = String(existing?.rrn_masked || "");
    if (rawRrn) {
      const rrn = normalizeRrn(rawRrn);
      if (!rrn) return jsonError("주민등록번호를 정확히 입력해 주세요.");
      rrnEncrypted = encryptPii(rrn);
      rrnMasked = maskRrn(rrn);
    }
    if (!rrnEncrypted) return jsonError("주민등록번호를 입력해 주세요.");

    const rows = (await db.sql`
      INSERT INTO influencer_payout_accounts (username, legal_name, rrn_encrypted, rrn_masked, bank_name, account_number, submitted_at, updated_at)
      VALUES (${me}, ${legalName}, ${rrnEncrypted}, ${rrnMasked}, ${bankName}, ${accountNumber}, NOW(), NOW())
      ON CONFLICT (username) DO UPDATE SET
        legal_name = EXCLUDED.legal_name, rrn_encrypted = EXCLUDED.rrn_encrypted, rrn_masked = EXCLUDED.rrn_masked,
        bank_name = EXCLUDED.bank_name, account_number = EXCLUDED.account_number, submitted_at = NOW(), updated_at = NOW()
      RETURNING *
    `) as any[];
    return Response.json({ account: shape(rows[0]) });
  }

  return jsonError("Method not allowed", 405);
};

export const config: Config = {
  path: "/api/affiliate-payout-account",
};
