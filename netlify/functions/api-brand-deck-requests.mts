import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireOperator } from "./_shared/manager-auth.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

/**
 * 브랜드 "서비스 소개서 신청"(/brand-deck). 메타 광고 랜딩 페이지가 쓴다.
 *
 *   POST  — 공개. 신청 페이지가 회사명 · 담당자 이름 · 전화번호 · 직책 · 이메일을 저장한다.
 *   GET   — 운영자. 운영 콘솔의 "브랜드 신청자" 탭이 목록을 읽는다.
 *   PATCH — 운영자. 진행 상태와 메모를 바꾼다.
 *
 * POST 는 로그인 없이 열려 있으므로 IP 당 횟수를 묶고, 봇이 채우는 숨은 칸
 * (bot-field)에 값이 있으면 저장하지 않고 성공으로만 답한다.
 */

const STATUSES = ["new", "sent", "done"] as const;

const clip = (raw: unknown, max: number) => String(raw ?? "").trim().slice(0, max);

export default async (req: Request) => {
  if (req.method === "POST") {
    const limited = await checkRateLimit({
      bucket: "brand-deck",
      key: clientIp(req),
      limit: 5,
      windowSeconds: 600,
      message: "잠시 후 다시 시도해 주세요.",
    });
    if (!limited.ok) return limited.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (clip(body["bot-field"], 200)) return Response.json({ ok: true });

    const company = clip(body.company, 100);
    const name = clip(body.name, 50);
    const phone = clip(body.phone, 20);
    const position = clip(body.position, 50);
    const email = clip(body.email, 200);
    if (!company || !name || !phone || !position || !email) {
      return Response.json(
        { error: "회사명, 담당자 이름, 전화번호, 직책, 이메일 주소를 모두 입력해 주세요." },
        { status: 400 },
      );
    }
    if (phone.replace(/[^0-9]/g, "").length < 9) {
      return Response.json({ error: "전화번호를 정확히 입력해 주세요." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "이메일 주소를 정확히 입력해 주세요." }, { status: 400 });
    }
    if (body.privacy_consent !== true && body.privacy_consent !== "동의") {
      return Response.json({ error: "개인정보 수집·이용에 동의해 주세요." }, { status: 400 });
    }

    const db = getDatabase();
    await db.sql`
      INSERT INTO brand_deck_requests (company, name, phone, position, email)
      VALUES (${company}, ${name}, ${phone}, ${position}, ${email})
    `;
    return Response.json({ ok: true }, { status: 201 });
  }

  const operator = await requireOperator(req);
  if (!operator.ok) return operator.response;

  const db = getDatabase();

  if (req.method === "GET") {
    const rows = await db.sql`
      SELECT id, company, name, phone, position, email, status, memo, created_at, updated_at
      FROM brand_deck_requests
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    return Response.json({ requests: rows });
  }

  if (req.method === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "잘못된 신청서입니다." }, { status: 400 });
    }
    const status = body.status === undefined ? null : String(body.status);
    if (status !== null && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return Response.json({ error: "알 수 없는 상태입니다." }, { status: 400 });
    }
    const memo = body.memo === undefined ? null : clip(body.memo, 2000);

    const rows = (await db.sql`
      UPDATE brand_deck_requests
      SET status = COALESCE(${status}, status),
          memo = COALESCE(${memo}, memo),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, company, name, phone, position, email, status, memo, created_at, updated_at
    `) as any[];
    if (!rows[0]) return Response.json({ error: "신청서를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ request: rows[0] });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/brand-deck-requests",
};
