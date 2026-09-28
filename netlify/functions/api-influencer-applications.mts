import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireOperator } from "./_shared/manager-auth.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

/**
 * 광고로 모집하는 인플루언서 지원서(/influencer-apply).
 *
 *   POST  — 공개. 지원 페이지가 성함 · 연락처 · 인스타 프로필을 저장한다.
 *   GET   — 운영자. 운영 콘솔의 "인플루언서 지원자" 탭이 목록을 읽는다.
 *   PATCH — 운영자. 연락 상태와 메모를 바꾼다.
 *
 * POST 는 로그인 없이 열려 있으므로 IP 당 횟수를 묶고, 봇이 채우는 숨은 칸
 * (bot-field)에 값이 있으면 저장하지 않고 성공으로만 답한다 — 실패로 답하면
 * 봇이 막힌 이유를 알고 우회한다.
 */

const STATUSES = ["new", "contacted", "done"] as const;

const clip = (raw: unknown, max: number) => String(raw ?? "").trim().slice(0, max);

export default async (req: Request) => {
  if (req.method === "POST") {
    const limited = await checkRateLimit({
      bucket: "influencer-apply",
      key: clientIp(req),
      limit: 5,
      windowSeconds: 600,
      message: "잠시 후 다시 시도해 주세요.",
    });
    if (!limited.ok) return limited.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (clip(body["bot-field"], 200)) return Response.json({ ok: true });

    const name = clip(body.name, 50);
    const phone = clip(body.phone, 20);
    const instagram = clip(body.instagram, 200);
    if (!name || !phone || !instagram) {
      return Response.json({ error: "성함, 연락처, 인스타그램 프로필을 모두 입력해 주세요." }, { status: 400 });
    }
    if (body.privacy_consent !== true && body.privacy_consent !== "동의") {
      return Response.json({ error: "개인정보 수집·이용에 동의해 주세요." }, { status: 400 });
    }

    const db = getDatabase();
    await db.sql`
      INSERT INTO influencer_applications (name, phone, instagram)
      VALUES (${name}, ${phone}, ${instagram})
    `;
    return Response.json({ ok: true }, { status: 201 });
  }

  const operator = await requireOperator(req);
  if (!operator.ok) return operator.response;

  const db = getDatabase();

  if (req.method === "GET") {
    const rows = await db.sql`
      SELECT id, name, phone, instagram, status, memo, created_at, updated_at
      FROM influencer_applications
      ORDER BY created_at DESC
      LIMIT 1000
    `;
    return Response.json({ applications: rows });
  }

  if (req.method === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: "잘못된 지원서입니다." }, { status: 400 });
    }
    const status = body.status === undefined ? null : String(body.status);
    if (status !== null && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      return Response.json({ error: "알 수 없는 상태입니다." }, { status: 400 });
    }
    const memo = body.memo === undefined ? null : clip(body.memo, 2000);

    const rows = (await db.sql`
      UPDATE influencer_applications
      SET status = COALESCE(${status}, status),
          memo = COALESCE(${memo}, memo),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, name, phone, instagram, status, memo, created_at, updated_at
    `) as any[];
    if (!rows[0]) return Response.json({ error: "지원서를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ application: rows[0] });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/influencer-applications",
};
