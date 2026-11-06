import { getDatabase } from "@picks/netlify-database";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { randomBytes } from "node:crypto";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { requireOperator } from "./_shared/manager-auth.mts";
import { CREATOR_APPROVAL_REQUIRED_MESSAGE, readCreatorAccess } from "./_shared/creator-access.mts";
import { STORE_TESTERS } from "./_shared/store-testers.mts";
import { sendPushToUser } from "./_shared/push.mts";
import { PiiCryptoError, decryptPii, encryptPii, formatRrn, maskAccount, maskRrn, piiKeyConfigured } from "./_shared/pii-crypto.mts";
import { executePayout } from "./_shared/affiliate-payout-provider.mts";
import {
  PAYOUT_SETTING_KEYS,
  createPayoutRequest,
  kstToday,
  loadRequests,
  payoutSettings,
  payoutSummary,
  releasePayoutRequest,
  scheduledDateFor,
  withTx,
  withholding,
  type PartyType,
} from "./_shared/affiliate-payouts.mts";

/**
 * 어필리에이트 스토어 정산 — 정산 정보(계좌) 등록 · 지급 신청 · 운영자 지급 처리.
 *
 *   GET  ?as=brand|influencer                    내 정산 정보(가린 값) · 지급 가능 금액 등 · 신청 내역
 *   GET  ?as=brand&scope=bankbook                 브랜드: 내가 올린 통장 사본 이미지
 *   POST { as, action: save_account | request | cancel, ... }
 *
 *   GET  ?scope=admin[&partyType&status&scheduledDate]   운영자: 지급 신청 목록 · 설정
 *   GET  ?scope=admin-transfer-csv&scheduledDate=YYYY-MM-DD 이체용 CSV(계좌번호 전체 · 열람 기록)
 *   GET  ?scope=admin-withholding-csv&month=YYYY-MM          원천징수 신고용 CSV(주민등록번호 · 열람 기록)
 *   GET  ?scope=admin-bankbook&party=<브랜드>               통장 사본 보기(열람 기록)
 *   POST { action: admin_mark_paid | admin_reject | admin_view_rrn | admin_set_settings, ... }
 *
 * 규칙: 주민등록번호 · 계좌번호 원문은 DB 에 암호문으로만 두고, 로그 · 오류 메시지 · 주소(URL) ·
 * 일반 응답에 넣지 않는다. 원문이 나가는 곳은 운영자의 CSV 다운로드와 "주민번호 보기" 뿐이며,
 * 모두 affiliate_pii_access_log 에 남는다(응답은 캐시 금지).
 */

const err = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  Response.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");
const newId = () => `apr_${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;
const docsStore = () => getStore({ name: "affiliate-payout-docs", consistency: "strong" });

export const BANKS = [
  "KB국민은행", "신한은행", "우리은행", "하나은행", "NH농협은행", "IBK기업은행", "SC제일은행", "한국씨티은행",
  "카카오뱅크", "토스뱅크", "케이뱅크", "부산은행", "경남은행", "대구은행(iM뱅크)", "광주은행", "전북은행",
  "제주은행", "수협은행", "새마을금고", "신협", "우체국", "KDB산업은행", "저축은행",
];

const PRIVACY_CONSENT_VERSION = "2026-11-v1";
const MAX_BANKBOOK_BYTES = 3 * 1024 * 1024;

/** 이름 비교용: 공백 · 법인 표기 · 괄호를 뺀다. */
const nameKey = (v: string) => String(v || "")
  .replace(/주식회사|유한회사|\(주\)|㈜|\(유\)|\s|[()（）.,·]/g, "")
  .toLowerCase();

/** 주민등록번호 13자리 형식(생년월일 · 성별 자리) 확인. */
function validRrn(d: string): boolean {
  if (!/^\d{13}$/.test(d)) return false;
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  const g = Number(d[6]);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && g >= 1 && g <= 8;
}

/** 신청자에게 화면 알림 + 앱 푸시(실패해도 처리는 끝난다). */
async function notifyParty(db: any, t: PartyType, party: string, kind: string, title: string, body: string) {
  const link = t === "brand" ? "/business-admin?tab=affiliate" : "";
  try {
    await db.sql`
      INSERT INTO affiliate_store_notifications (recipient_type, recipient, kind, title, body, link)
      VALUES (${t}, ${party}, ${kind}, ${title.slice(0, 200)}, ${body.slice(0, 500)}, ${link})
    `;
  } catch (e: any) {
    console.error("[affiliate-payout] notification insert failed", kind, e?.code || "");
  }
  sendPushToUser(party, { title, body, data: { path: link } }).catch(() => {});
}

async function logPiiAccess(q: any, rows: { partyType: PartyType; username: string }[], viewedBy: string, purpose: string, detail = "") {
  for (const r of rows) {
    await q.sql`
      INSERT INTO affiliate_pii_access_log (username, viewed_by, purpose, party_type, detail)
      VALUES (${r.username}, ${viewedBy}, ${purpose}, ${r.partyType}, ${detail.slice(0, 200)})
    `;
  }
}

// ─────────────────────────── 정산 정보 ───────────────────────────

function shapeInfluencerAccount(r: any) {
  if (!r || !r.submitted_at) return null;
  return {
    legalName: r.legal_name,
    rrnMasked: r.rrn_masked,
    bankName: r.bank_name,
    accountMasked: maskAccount(r.account_last4),
    accountHolder: r.account_holder,
    privacyConsentedAt: r.privacy_consented_at,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
  };
}

function shapeBrandAccount(r: any) {
  if (!r || !r.submitted_at) return null;
  return {
    bankName: r.bank_name,
    accountMasked: maskAccount(r.account_last4),
    accountHolder: r.account_holder,
    hasBankbook: !!r.bankbook_key,
    taxInvoiceEmail: r.tax_invoice_email,
    holderMismatch: !!r.holder_mismatch,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
  };
}

const loadInfluencerAccount = async (db: any, u: string) =>
  ((await db.sql`SELECT * FROM influencer_payout_accounts WHERE username = ${u}`) as any[])[0] || null;
const loadBrandAccount = async (db: any, u: string) =>
  ((await db.sql`SELECT * FROM affiliate_brand_payout_accounts WHERE business_username = ${u}`) as any[])[0] || null;
const loadApplication = async (db: any, u: string) =>
  ((await db.sql`SELECT business_name, ceo_name, brand_name, status FROM affiliate_store_applications WHERE business_username = ${u}`) as any[])[0] || null;

async function saveInfluencerAccount(db: any, username: string, body: any) {
  const legalName = clip(body.legalName, 30);
  const rrnDigits = String(body.rrn ?? "").replace(/\D/g, "");
  const bankName = clip(body.bankName, 30);
  const accountDigits = String(body.accountNumber ?? "").replace(/\D/g, "");
  const holder = clip(body.accountHolder, 30);
  const existing = await loadInfluencerAccount(db, username);
  const hasExisting = !!existing?.submitted_at;

  if (body.privacyConsent !== true) return err("개인정보 수집 · 이용에 동의해 주세요.");
  if (legalName.length < 2) return err("실명을 입력해 주세요.");
  // 수정할 때는 주민등록번호 · 계좌번호를 비워 두면 기존 값을 그대로 쓴다.
  if (rrnDigits || !hasExisting || !existing?.rrn_encrypted) {
    if (!validRrn(rrnDigits)) return err("주민등록번호 13자리를 정확히 입력해 주세요.");
  }
  if (!BANKS.includes(bankName)) return err("은행을 선택해 주세요.");
  if (accountDigits || !hasExisting || !existing?.account_encrypted) {
    if (accountDigits.length < 8 || accountDigits.length > 20) return err("계좌번호를 정확히 입력해 주세요.");
  }
  if (!holder) return err("예금주를 입력해 주세요.");
  if (nameKey(holder) !== nameKey(legalName)) return err("예금주는 실명과 같아야 해요. 본인 명의 계좌를 입력해 주세요.");
  if (!piiKeyConfigured()) return err("정산 정보 저장 준비가 아직 끝나지 않았어요. 잠시 후 다시 시도해 주세요.", 503);

  const rrnEnc = rrnDigits ? encryptPii(rrnDigits) : existing.rrn_encrypted;
  const rrnMasked = rrnDigits ? maskRrn(rrnDigits) : existing.rrn_masked;
  const accEnc = accountDigits ? encryptPii(accountDigits) : existing.account_encrypted;
  const last4 = accountDigits ? accountDigits.slice(-4) : existing.account_last4;

  const rows = (await db.sql`
    INSERT INTO influencer_payout_accounts
      (username, legal_name, rrn_encrypted, rrn_masked, bank_name, account_number, account_encrypted, account_last4,
       account_holder, privacy_consented_at, privacy_consent_version, submitted_at, updated_at)
    VALUES (${username}, ${legalName}, ${rrnEnc}, ${rrnMasked}, ${bankName}, '', ${accEnc}, ${last4},
       ${holder}, NOW(), ${PRIVACY_CONSENT_VERSION}, NOW(), NOW())
    ON CONFLICT (username) DO UPDATE SET
      legal_name = EXCLUDED.legal_name, rrn_encrypted = EXCLUDED.rrn_encrypted, rrn_masked = EXCLUDED.rrn_masked,
      bank_name = EXCLUDED.bank_name, account_number = '', account_encrypted = EXCLUDED.account_encrypted,
      account_last4 = EXCLUDED.account_last4, account_holder = EXCLUDED.account_holder,
      privacy_consented_at = NOW(), privacy_consent_version = EXCLUDED.privacy_consent_version,
      submitted_at = COALESCE(influencer_payout_accounts.submitted_at, NOW()), updated_at = NOW()
    RETURNING *
  `) as any[];
  return ok({ account: shapeInfluencerAccount(rows[0]) });
}

async function saveBrandAccount(db: any, username: string, body: any) {
  const bankName = clip(body.bankName, 30);
  const accountDigits = String(body.accountNumber ?? "").replace(/\D/g, "");
  const holder = clip(body.accountHolder, 60);
  const email = clip(body.taxInvoiceEmail, 200);
  const image = String(body.bankbookImage || "");
  const existing = await loadBrandAccount(db, username);
  const hasExisting = !!existing?.submitted_at;

  if (!BANKS.includes(bankName)) return err("은행을 선택해 주세요.");
  if (accountDigits || !hasExisting || !existing?.account_encrypted) {
    if (accountDigits.length < 8 || accountDigits.length > 20) return err("계좌번호를 정확히 입력해 주세요.");
  }
  if (!holder) return err("예금주를 입력해 주세요.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("세금계산서를 받을 이메일을 정확히 입력해 주세요.");
  if (!image && !existing?.bankbook_key) return err("통장 사본 이미지를 올려 주세요.");
  if (!piiKeyConfigured()) return err("정산 정보 저장 준비가 아직 끝나지 않았어요. 잠시 후 다시 시도해 주세요.", 503);

  let bankbookKey = existing?.bankbook_key || "";
  if (image) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m) return err("통장 사본은 JPG · PNG · WEBP 이미지로 올려 주세요.");
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length === 0 || bytes.length > MAX_BANKBOOK_BYTES) return err("통장 사본 이미지는 3MB 이하로 올려 주세요.");
    const key = `brand/${username}/${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
    await docsStore().set(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { metadata: { contentType: m[1] } });
    bankbookKey = key;
  }

  const app = await loadApplication(db, username);
  const names = [app?.business_name, app?.ceo_name].map((v) => nameKey(v || "")).filter(Boolean);
  const mismatch = !names.includes(nameKey(holder));
  const accEnc = accountDigits ? encryptPii(accountDigits) : existing.account_encrypted;
  const last4 = accountDigits ? accountDigits.slice(-4) : existing.account_last4;

  const rows = (await db.sql`
    INSERT INTO affiliate_brand_payout_accounts
      (business_username, bank_name, account_encrypted, account_last4, account_holder, bankbook_key, tax_invoice_email,
       holder_mismatch, submitted_at, updated_at)
    VALUES (${username}, ${bankName}, ${accEnc}, ${last4}, ${holder}, ${bankbookKey}, ${email}, ${mismatch}, NOW(), NOW())
    ON CONFLICT (business_username) DO UPDATE SET
      bank_name = EXCLUDED.bank_name, account_encrypted = EXCLUDED.account_encrypted, account_last4 = EXCLUDED.account_last4,
      account_holder = EXCLUDED.account_holder, bankbook_key = EXCLUDED.bankbook_key,
      tax_invoice_email = EXCLUDED.tax_invoice_email, holder_mismatch = EXCLUDED.holder_mismatch,
      submitted_at = COALESCE(affiliate_brand_payout_accounts.submitted_at, NOW()), updated_at = NOW()
    RETURNING *
  `) as any[];
  return ok({ account: shapeBrandAccount(rows[0]) });
}

async function serveBankbook(db: any, brand: string) {
  const acc = await loadBrandAccount(db, brand);
  if (!acc?.bankbook_key) return err("통장 사본이 없어요.", 404);
  const res = await docsStore().getWithMetadata(acc.bankbook_key, { type: "arrayBuffer" });
  if (!res) return err("통장 사본이 없어요.", 404);
  const ct = String((res.metadata as any)?.contentType || "image/jpeg");
  return new Response(res.data as ArrayBuffer, {
    headers: { "Content-Type": ct, "Cache-Control": "no-store, private", "Content-Disposition": "inline" },
  });
}

// ─────────────────────────── 신청자 화면 ───────────────────────────

async function partyGet(db: any, t: PartyType, party: string) {
  const [account, summary, requests, settings, app] = await Promise.all([
    t === "brand" ? loadBrandAccount(db, party) : loadInfluencerAccount(db, party),
    payoutSummary(db, t, party),
    loadRequests(db, { partyType: t, party }),
    payoutSettings(db),
    t === "brand" ? loadApplication(db, party) : Promise.resolve(null),
  ]);
  const minAmount = t === "brand" ? settings.minBrand : settings.minInfluencer;
  return ok({
    partyType: t,
    account: t === "brand" ? shapeBrandAccount(account) : shapeInfluencerAccount(account),
    summary,
    preview: t === "influencer" ? withholding(Math.max(0, summary.available)) : null,
    requests,
    minAmount,
    nextScheduledDate: scheduledDateFor(),
    banks: BANKS,
    brandNames: app ? { businessName: app.business_name || "", ceoName: app.ceo_name || "" } : null,
  });
}

async function partyRequest(db: any, t: PartyType, party: string) {
  const acc = t === "brand" ? await loadBrandAccount(db, party) : await loadInfluencerAccount(db, party);
  if (!acc?.submitted_at || !acc.account_encrypted) return err("정산 정보를 먼저 등록해 주세요.", 400, { code: "NO_ACCOUNT" });
  const settings = await payoutSettings(db);
  const r = await createPayoutRequest(db, t, party, {
    legalName: t === "influencer" ? acc.legal_name : "",
    bankName: acc.bank_name,
    accountEncrypted: acc.account_encrypted,
    accountLast4: acc.account_last4,
    accountHolder: acc.account_holder,
    holderMismatch: t === "brand" ? !!acc.holder_mismatch : false,
  }, { id: newId(), minAmount: t === "brand" ? settings.minBrand : settings.minInfluencer });
  if (r.ok === false) return err(r.error, r.status, { code: r.code });
  const [request] = await loadRequests(db, { partyType: t, party }, 1);
  const note = `${t === "brand" ? "브랜드" : "인플루언서"} ${party} · ${(request?.grossAmount || 0).toLocaleString("ko-KR")}원`;
  try {
    await db.sql`
      INSERT INTO affiliate_store_notifications (recipient_type, recipient, kind, title, body, link)
      VALUES ('operator', 'operator', 'payout_requested', '새 지급 신청이 있어요', ${note}, '')
    `;
  } catch { /* 운영자 알림만 빠진다 */ }
  return ok({ request }, 201);
}

async function partyCancel(db: any, t: PartyType, party: string, body: any) {
  const r = await releasePayoutRequest(db, clip(body.id, 80), "cancelled", { party: { type: t, party } });
  if (r.ok === false) return err(r.error, r.status);
  return ok({ ok: true });
}

// ─────────────────────────── 운영자 ───────────────────────────

async function adminGet(db: any, url: URL) {
  const partyType = url.searchParams.get("partyType") === "influencer" ? "influencer" : url.searchParams.get("partyType") === "brand" ? "brand" : undefined;
  const status = ["requested", "paid", "rejected", "cancelled"].includes(String(url.searchParams.get("status"))) ? String(url.searchParams.get("status")) : "";
  const scheduledDate = /^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get("scheduledDate"))) ? String(url.searchParams.get("scheduledDate")) : "";
  const [requests, settings, brands, counts, schedules] = await Promise.all([
    loadRequests(db, { partyType, status, scheduledDate }, 500),
    payoutSettings(db),
    db.sql`SELECT business_username, brand_name, business_name FROM affiliate_store_applications` as Promise<any[]>,
    db.sql`SELECT party_type, COUNT(*)::int AS n FROM affiliate_payout_requests WHERE status = 'requested' GROUP BY party_type` as Promise<any[]>,
    db.sql`SELECT DISTINCT scheduled_date FROM affiliate_payout_requests ORDER BY scheduled_date DESC LIMIT 24` as Promise<any[]>,
  ]);
  const brandName = new Map(brands.map((b) => [b.business_username, b.brand_name || b.business_name || b.business_username]));
  return ok({
    requests: requests.map((r) => ({ ...r, displayName: r.partyType === "brand" ? brandName.get(r.party) || r.party : r.legalName || r.party })),
    settings,
    waiting: Object.fromEntries(counts.map((c) => [c.party_type, c.n])),
    scheduledDates: schedules.map((s) => s.scheduled_date),
    nextScheduledDate: scheduledDateFor(),
  });
}

async function adminMarkPaid(db: any, operator: string, body: any) {
  const id = clip(body.id, 80);
  const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.paidDate || "")) ? String(body.paidDate) : kstToday();
  const cur = ((await db.sql`SELECT * FROM affiliate_payout_requests WHERE id = ${id}`) as any[])[0];
  if (!cur) return err("지급 신청을 찾을 수 없어요.", 404);
  if (cur.status !== "requested") return err(cur.status === "paid" ? "이미 지급 완료된 신청이에요." : "지급 대기 중인 신청만 처리할 수 있어요.", 409);

  // 송금 실행(지금은 수동 이체 기록만). 자동 송금 방식으로 바꾸면 여기서 실제 송금이 일어난다.
  const exec = await executePayout({
    id, partyType: cur.party_type, party: cur.party, netAmount: Number(cur.net_amount) || 0,
    bankName: cur.bank_name, accountEncrypted: cur.account_encrypted, accountHolder: cur.account_holder,
  }, { operator });
  if (exec.ok === false) return err(exec.error, 502);

  const updated = await withTx(db, async (client) => {
    const r = (await client.query(
      `UPDATE affiliate_payout_requests SET status = 'paid', paid_at = NOW(), paid_date = $2, paid_by = $3,
         payout_method = $4, external_ref = $5, updated_at = NOW()
       WHERE id = $1 AND status = 'requested' RETURNING *`,
      [id, paidDate, operator, exec.method, exec.externalRef.slice(0, 200)],
    )).rows[0];
    return r || null;
  });
  if (!updated) return err("이미 처리된 신청이에요.", 409);
  const t = updated.party_type as PartyType;
  await notifyParty(db, t, updated.party, "payout_paid", "수수료가 지급되었어요",
    `${Number(updated.net_amount).toLocaleString("ko-KR")}원이 ${updated.bank_name} ${maskAccount(updated.account_last4)} 계좌로 지급되었어요(${paidDate}).`);
  return ok({ ok: true });
}

async function adminReject(db: any, operator: string, body: any) {
  const reason = clip(body.reason, 500);
  if (!reason) return err("반려 사유를 입력해 주세요.");
  const r = await releasePayoutRequest(db, clip(body.id, 80), "rejected", { operator, reason });
  if (r.ok === false) return err(r.error, r.status);
  await notifyParty(db, r.request.party_type, r.request.party, "payout_rejected", "지급 신청이 반려되었어요",
    `사유: ${reason} · 신청 금액은 지급 가능 금액으로 돌아갔어요. 정산 정보를 확인한 뒤 다시 신청해 주세요.`);
  return ok({ ok: true });
}

async function adminViewRrn(db: any, operator: string, body: any) {
  const username = norm(body.username);
  const acc = await loadInfluencerAccount(db, username);
  if (!acc?.rrn_encrypted) return err("등록된 주민등록번호가 없어요.", 404);
  let rrn = "";
  try {
    rrn = formatRrn(decryptPii(acc.rrn_encrypted));
  } catch (e: any) {
    console.error("[affiliate-payout] rrn decrypt failed", e instanceof PiiCryptoError ? e.code : "ERROR");
    return err("주민등록번호를 복호화하지 못했어요. 암호화 키 설정을 확인해 주세요.", 500);
  }
  await logPiiAccess(db, [{ partyType: "influencer", username }], operator, "view_rrn", clip(body.reason, 100) || "운영자 보기");
  return ok({ rrn, legalName: acc.legal_name });
}

async function adminSetSettings(db: any, operator: string, body: any) {
  const current = await payoutSettings(db);
  const changes: { key: string; oldValue: string; newValue: string }[] = [];
  for (const [field, key] of Object.entries(PAYOUT_SETTING_KEYS)) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Math.floor(Number(String(raw).replace(/,/g, "")));
    if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return err("최소 신청 금액은 0원 이상으로 입력해 주세요.");
    const old = (current as any)[field];
    if (n !== old) changes.push({ key, oldValue: String(old), newValue: String(n) });
  }
  if (changes.length) {
    await withTx(db, async (client) => {
      for (const c of changes) {
        await client.query(
          `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [c.key, c.newValue, operator],
        );
        await client.query(
          `INSERT INTO platform_setting_history (key, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4)`,
          [c.key, c.oldValue, c.newValue, operator],
        );
      }
    });
  }
  return ok({ settings: await payoutSettings(db) });
}

/** CSV 한 칸. 엑셀 수식으로 해석되지 않게 =,+,-,@ 로 시작하는 값 앞에 ' 를 붙인다. */
const cell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvResponse = (rows: unknown[][], filename: string) =>
  new Response("﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, private",
    },
  });

async function adminTransferCsv(db: any, operator: string, url: URL) {
  const date = String(url.searchParams.get("scheduledDate") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("지급 예정일을 선택해 주세요.");
  const rows = (await db.sql`
    SELECT * FROM affiliate_payout_requests WHERE status = 'requested' AND scheduled_date = ${date} ORDER BY party_type, requested_at
  `) as any[];
  const out: unknown[][] = [["은행", "계좌번호", "예금주", "금액", "구분", "아이디", "신청번호"]];
  try {
    for (const r of rows) {
      out.push([r.bank_name, decryptPii(r.account_encrypted), r.account_holder, Number(r.net_amount) || 0,
        r.party_type === "brand" ? "브랜드" : "인플루언서", r.party, r.id]);
    }
  } catch (e: any) {
    console.error("[affiliate-payout] transfer csv decrypt failed", e instanceof PiiCryptoError ? e.code : "ERROR");
    return err("계좌번호를 복호화하지 못했어요. 암호화 키 설정을 확인해 주세요.", 500);
  }
  await logPiiAccess(db, rows.map((r) => ({ partyType: r.party_type, username: r.party })), operator, "transfer_csv", `지급 예정일 ${date}`);
  return csvResponse(out, `payout-transfer-${date}.csv`);
}

async function adminWithholdingCsv(db: any, operator: string, url: URL) {
  const month = String(url.searchParams.get("month") || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return err("지급 완료월을 선택해 주세요.");
  const rows = (await db.sql`
    SELECT r.*, a.rrn_encrypted FROM affiliate_payout_requests r
    LEFT JOIN influencer_payout_accounts a ON a.username = r.party
    WHERE r.party_type = 'influencer' AND r.status = 'paid' AND LEFT(r.paid_date, 7) = ${month}
    ORDER BY r.paid_date, r.party
  `) as any[];
  const out: unknown[][] = [["실명", "주민등록번호", "지급 총액", "소득세", "지방소득세", "실지급액", "지급일", "아이디", "신청번호"]];
  try {
    for (const r of rows) {
      out.push([r.legal_name, r.rrn_encrypted ? formatRrn(decryptPii(r.rrn_encrypted)) : "", Number(r.gross_amount) || 0,
        Number(r.income_tax) || 0, Number(r.local_tax) || 0, Number(r.net_amount) || 0, r.paid_date, r.party, r.id]);
    }
  } catch (e: any) {
    console.error("[affiliate-payout] withholding csv decrypt failed", e instanceof PiiCryptoError ? e.code : "ERROR");
    return err("주민등록번호를 복호화하지 못했어요. 암호화 키 설정을 확인해 주세요.", 500);
  }
  const people = [...new Set(rows.map((r) => r.party as string))].map((u) => ({ partyType: "influencer" as const, username: u }));
  await logPiiAccess(db, people, operator, "withholding_csv", `지급 완료월 ${month}`);
  return csvResponse(out, `payout-withholding-${month}.csv`);
}

// ─────────────────────────── 진입 ───────────────────────────

export default async (req: Request) => {
  const url = new URL(req.url);
  const db = getDatabase();
  let body: any = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  else if (req.method !== "GET") return err("Method not allowed", 405);
  const scope = req.method === "GET" ? String(url.searchParams.get("scope") || "") : "";
  const action = String(body?.action || "");

  try {
    if (scope.startsWith("admin") || action.startsWith("admin_")) {
      const op = await requireOperator(req);
      if (op.ok === false) return op.response;
      const operator = op.username || "operator";
      if (scope === "admin") return await adminGet(db, url);
      if (scope === "admin-transfer-csv") return await adminTransferCsv(db, operator, url);
      if (scope === "admin-withholding-csv") return await adminWithholdingCsv(db, operator, url);
      if (scope === "admin-bankbook") {
        const brand = norm(url.searchParams.get("party"));
        await logPiiAccess(db, [{ partyType: "brand", username: brand }], operator, "view_bankbook");
        return await serveBankbook(db, brand);
      }
      if (action === "admin_mark_paid") return await adminMarkPaid(db, operator, body);
      if (action === "admin_reject") return await adminReject(db, operator, body);
      if (action === "admin_view_rrn") return await adminViewRrn(db, operator, body);
      if (action === "admin_set_settings") return await adminSetSettings(db, operator, body);
      return err("알 수 없는 요청입니다.");
    }

    const caller = await requireSignedInUser(req);
    if (caller.ok === false) return caller.response;
    const username = norm(caller.username);
    if (!username) return err("로그인이 필요합니다.", 401);
    if (!STORE_TESTERS.has(username) && !caller.isAdmin) return err("아직 오픈 전인 메뉴입니다.", 403);

    const as = (req.method === "GET" ? url.searchParams.get("as") : body.as) === "brand" ? "brand" : "influencer";
    if (as === "brand") {
      const app = await loadApplication(db, username);
      if (app?.status !== "approved") return err("입점 승인 후 이용할 수 있어요.", 403);
    } else if (!caller.isAdmin) {
      const creator = await readCreatorAccess(username);
      if (!creator) return err("크리에이터 승인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
      if (!creator.approved) return err(CREATOR_APPROVAL_REQUIRED_MESSAGE, 403, { code: "CREATOR_APPROVAL_REQUIRED" });
    }

    if (req.method === "GET") {
      if (scope === "bankbook" && as === "brand") return await serveBankbook(db, username);
      return await partyGet(db, as, username);
    }
    switch (action) {
      case "save_account": return as === "brand" ? await saveBrandAccount(db, username, body) : await saveInfluencerAccount(db, username, body);
      case "request": return await partyRequest(db, as, username);
      case "cancel": return await partyCancel(db, as, username, body);
      default: return err("알 수 없는 요청입니다.");
    }
  } catch (e: any) {
    // 오류 객체 전체를 남기지 않는다(요청 값이 섞일 수 있다). 코드만 남긴다.
    console.error("[affiliate-payout] failed", action || scope || "get", e instanceof PiiCryptoError ? e.code : e?.code || e?.name || "");
    if (e instanceof PiiCryptoError && e.code === "NO_KEY") return err("정산 정보 저장 준비가 아직 끝나지 않았어요. 잠시 후 다시 시도해 주세요.", 503);
    return err("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
};

export const config: Config = {
  path: "/api/affiliate-payouts",
};
