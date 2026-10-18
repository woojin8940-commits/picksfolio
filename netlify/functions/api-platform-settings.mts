import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireOperator } from "./_shared/manager-auth.mts";
import { DISCLOSURE_TEXT, SETTING_KEYS, jsonError, loadSettings, withTransaction } from "./_shared/affiliate.mts";

/**
 * 플랫폼 설정 — 판매 연동형 캠페인의 플랫폼 수수료율과 구매확정 간주 일수.
 *
 *   GET /api/platform-settings            누구나(등록 화면이 인플루언서 몫을 계산한다)
 *   GET /api/platform-settings?history=1  운영자: 변경 이력 포함
 *   PUT /api/platform-settings            운영자 전용 { platformRate?, autoConfirmDays? }
 *
 * 수수료율은 캠페인 등록 시점에 캠페인 행으로 복사된다. 여기서 바꿔도 이미 등록된
 * 캠페인의 정산은 달라지지 않는다.
 */

const LIMITS = {
  platformRate: { min: 0, max: 50 },
  autoConfirmDays: { min: 1, max: 90 },
};

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const settings = await loadSettings(db);
    if (url.searchParams.get("history") !== "1") {
      return Response.json({
        settings: {
          platformRate: settings.platformRate,
          autoConfirmDays: settings.autoConfirmDays,
          attributionDays: settings.attributionDays,
          // 캠페인에 자동으로 붙는 광고 표기 문구. 등록 화면이 미리 보여 준다.
          disclosureText: DISCLOSURE_TEXT,
        },
      });
    }
    const op = await requireOperator(req);
    if (!op.ok) return op.response;
    const history = (await db.sql`
      SELECT key, old_value, new_value, changed_by, changed_at FROM platform_setting_history
      ORDER BY changed_at DESC LIMIT 50
    `) as any[];
    return Response.json({
      settings: {
        ...settings,
        history: history.map((h) => ({
          key: h.key === SETTING_KEYS.platformRate ? "platformRate" : h.key === SETTING_KEYS.autoConfirmDays ? "autoConfirmDays" : h.key,
          oldValue: String(h.old_value),
          newValue: String(h.new_value),
          changedBy: String(h.changed_by),
          changedAt: new Date(h.changed_at).toISOString(),
        })),
      },
    });
  }

  if (req.method === "PUT") {
    const op = await requireOperator(req);
    if (!op.ok) return op.response;
    const body = await req.json().catch(() => ({}));

    const updates: { key: string; value: string }[] = [];
    for (const field of ["platformRate", "autoConfirmDays"] as const) {
      if (body?.[field] === undefined || body?.[field] === null || body?.[field] === "") continue;
      const n = Number(body[field]);
      const { min, max } = LIMITS[field];
      if (!Number.isFinite(n) || n < min || n > max) {
        return jsonError(field === "platformRate" ? `플랫폼 수수료율은 ${min}~${max}% 사이로 입력해 주세요.` : `구매확정 간주 일수는 ${min}~${max}일 사이로 입력해 주세요.`);
      }
      if (field === "autoConfirmDays" && !Number.isInteger(n)) return jsonError("일수는 정수로 입력해 주세요.");
      updates.push({ key: SETTING_KEYS[field], value: String(Math.round(n * 100) / 100) });
    }
    if (updates.length === 0) return jsonError("바꿀 값이 없습니다.");

    await withTransaction(db, async (q) => {
      for (const u of updates) {
        const prev = await q(`SELECT value FROM platform_settings WHERE key = $1 FOR UPDATE`, [u.key]);
        if (prev[0]?.value === u.value) continue;
        await q(
          `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [u.key, u.value, op.username],
        );
        await q(
          `INSERT INTO platform_setting_history (key, old_value, new_value, changed_by) VALUES ($1, $2, $3, $4)`,
          [u.key, String(prev[0]?.value ?? ""), u.value, op.username],
        );
      }
    });
    const settings = await loadSettings(db);
    return Response.json({ settings });
  }

  return jsonError("Method not allowed", 405);
};

export const config: Config = {
  path: "/api/platform-settings",
};
