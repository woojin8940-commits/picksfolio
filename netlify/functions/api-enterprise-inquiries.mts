import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireOperator } from "./_shared/manager-auth.mts";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

/**
 * 브랜드 멤버십 "엔터프라이즈 문의하기".
 *
 *   POST  — 멤버십 화면의 문의 폼. 회사명 · 담당자 성함 · 연락처 · 이메일 · 문의 내용을 저장한다.
 *           로그인한 브랜드 계정이면 회사 아이디를 함께 남긴다(없어도 받는다).
 *   GET   — 운영자. 운영 콘솔의 "엔터프라이즈 문의" 탭이 목록을 읽는다.
 *   PATCH — 운영자. 진행 상태와 상담 메모를 바꾼다.
 *
 * POST 는 IP 당 횟수를 묶고, 봇이 채우는 숨은 칸(bot-field)에 값이 있으면 저장하지 않고
 * 성공으로만 답한다. 문의 내용은 로그에 남기지 않는다.
 */

const STATUSES = ["new", "contacted", "done"] as const;

const clip = (raw: unknown, max: number) => String(raw ?? "").trim().slice(0, max);

export default async (req: Request) => {
  if (req.method === "POST") {
    const limited = await checkRateLimit({
      bucket: "enterprise-inquiry",
      key: clientIp(req),
      limit: 5,
      windowSeconds: 600,
      message: "문의를 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.",
    });
    if (!limited.ok) return limited.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (clip(body["bot-field"], 200)) return Response.json({ ok: true });

    const company = clip(body.company, 100);
    const name = clip(body.name, 50);
    const phone = clip(body.phone, 20);
    const email = clip(body.email, 200);
    const message = clip(body.message, 3000);
    if (!company || !name || !phone || !email || !message) {
      return Response.json(
        { error: "회사명, 담당자 성함, 연락처, 이메일, 문의 내용을 모두 입력해 주세요." },
        { status: 400 },
      );
    }
    if (phone.replace(/[^0-9]/g, "").length < 9) {
      return Response.json({ error: "연락처를 정확히 입력해 주세요." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "이메일 주소를 정확히 입력해 주세요." }, { status: 400 });
    }
    if (body.privacy_consent !== true) {
      return Response.json({ error: "개인정보 수집·이용에 동의해 주세요." }, { status: 400 });
    }

    // 로그인한 브랜드 계정이면 회사 아이디를 남긴다. 로그인하지 않았거나 확인에 실패해도 문의는 받는다.
    let companyUsername: string | null = null;
    if (/^Bearer\s+\S+/i.test(req.headers.get("authorization") || "")) {
      try {
        const auth = await requireSignedInUser(req);
        if (auth.ok && auth.teamRole && auth.username) companyUsername = auth.username;
      } catch {
        companyUsername = null;
      }
    }

    await getDatabase().sql`
      INSERT INTO enterprise_inquiries (company_username, company, name, phone, email, message)
      VALUES (${companyUsername}, ${company}, ${name}, ${phone}, ${email}, ${message})
    `;
    return Response.json({ ok: true }, { status: 201 });
  }

  const operator = await requireOperator(req);
  if (!operator.ok) return operator.response;

  const db = getDatabase();

  if (req.method === "GET") {
    const rows = await db.sql`
      SELECT id, company_username, company, name, phone, email, message, status, memo, created_at, updated_at
      FROM enterprise_inquiries
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    return Response.json({ inquiries: rows });
  }

  if (req.method === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "잘못된 문의입니다." }, { status: 400 });
    }
    const status = body.status === undefined ? null : String(body.status);
    if (status !== null && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return Response.json({ error: "알 수 없는 상태입니다." }, { status: 400 });
    }
    const memo = body.memo === undefined ? null : clip(body.memo, 2000);

    const rows = (await db.sql`
      UPDATE enterprise_inquiries
      SET status = COALESCE(${status}, status),
          memo = COALESCE(${memo}, memo),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, company_username, company, name, phone, email, message, status, memo, created_at, updated_at
    `) as any[];
    if (!rows[0]) return Response.json({ error: "문의를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ inquiry: rows[0] });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/enterprise-inquiries",
};
