import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { resolveIdentities } from "./_shared/manager-auth.mts";
import {
  SETTLEMENTS_STORE,
  parseAmount,
  readRecords,
  settlementBizKey,
} from "./_shared/collab-records.mts";

/**
 * 브랜드 → 픽스폴리오 일괄 정산. 회차 금액과 "입금일 조율" 을 함께 내려준다.
 *
 *   GET   /api/brand-settlement?business=<브랜드>[&campaign=<캠페인>]
 *   PATCH /api/brand-settlement   { business, roundKey, action, date?, note? }
 *
 * 브랜드와 픽스폴리오 담당자가 같은 응답을 읽는다. 둘이 같은 화면을 보고 전화로
 * 이야기하기 때문에(브랜드 ↔ 담당자 사이에는 앱 안 타임라인이 없다), 서로 다른
 * 숫자를 들고 있으면 통화가 숫자 확인으로 끝난다.
 *
 * 인플루언서별 정산 항목(누가 언제 얼마를 받는지)은 담지 않는다. 브랜드는 인플루언서
 * 스무 명에게 스무 번 송금하지 않고 픽스폴리오에 한 번 보내므로, 회차 금액과 인원
 * 수까지가 브랜드가 대조할 수 있는 전부다. 화면에서 가리는 것으로는 부족하다 —
 * 응답에 담아 두면 개발자 도구로 그대로 열린다.
 *
 * 입금일은 미리 정해 두지 않는다. 자동으로 잡히는 날짜(인플루언서 지급 예정일)를
 * 브랜드의 입금일처럼 보여 주면, 약속하지 않은 날짜가 약속처럼 걸려 있게 된다.
 * 어느 쪽이든 제안하고 상대가 동의할 때만 확정된다 — 표 설명은
 * `20260901000000_add_brand_settlement_schedule` 마이그레이션에 적어 두었다.
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

/** DATE 컬럼은 드라이버에 따라 Date 또는 'YYYY-MM-DD HH:mm' 으로 온다. 날짜만 남긴다. */
const dateOnly = (raw: unknown) => {
  const text = raw instanceof Date ? raw.toISOString() : String(raw || "");
  const key = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
};

type Side = "brand" | "manager";

/** 한 회차. 브랜드가 한 번에 보내는 단위다. */
type Round = {
  /** 'YYYY-MM'. 인플루언서 지급 예정월을 회차 이름으로 쓴다. */
  roundKey: string;
  amount: number;
  headcount: number;
  /** 금액이 아직 확정되지 않은 건수(공동구매 수수료 등). 확정되면 합계에 더해진다. */
  pendingCount: number;
};

/**
 * 호출자가 이 브랜드의 정산을 볼 수 있는지 판정하고, 어느 쪽으로 말할 수 있는지
 * 돌려준다. 담당자 자격과 브랜드 계정을 함께 쥔 사람이 있으므로(운영 콘솔에
 * 로그인한 브라우저에서 자기 브랜드 계정을 쓰는 경우) 둘 다 참일 수 있다.
 */
async function resolveSides(
  req: Request,
  business: string,
): Promise<{ isBrand: boolean; isManager: boolean; username: string } | { error: Response }> {
  const { account, manager, accountError } = await resolveIdentities(req);
  const isBrand = !!account && !!business && norm(account.username) === business;
  const isManager = !!manager;
  if (!isBrand && !isManager) {
    return { error: accountError || jsonError("이 브랜드의 정산은 볼 수 없습니다.", 403) };
  }
  return {
    isBrand,
    isManager,
    username: (isManager ? manager?.username : account?.username) || "",
  };
}

/**
 * 정산 원장(Blobs)에서 회차를 만든다.
 *
 * 회차 키는 지급 예정일의 '월' 이다 — 담당자가 인플루언서마다 지급일을 하루씩 옮겨도
 * 브랜드가 보내는 횟수는 늘지 않아야 한다. 지급일이 아직 없는 항목은 회차를 정할 수
 * 없으므로 키가 빈 회차로 모이고, 조율 대상이 되지 않는다.
 */
function buildRounds(records: any[], campaignId: string): Round[] {
  const map = new Map<string, Round>();
  for (const s of records || []) {
    // 취소된 정산은 타입에는 없지만 옛 기록에 남아 있을 수 있다 — 합계에서 뺀다.
    if (String(s?.status || "") === "cancelled") continue;
    // 정산 항목의 proposal_id 에 캠페인 id 가 들어 있다(`campaign_<캠페인>_<아이디>`).
    if (campaignId && !String(s?.proposal_id || "").includes(campaignId)) continue;
    const month = String(s?.scheduled_date || "").slice(0, 7);
    const roundKey = /^\d{4}-\d{2}$/.test(month) ? month : "";
    const cur = map.get(roundKey) || { roundKey, amount: 0, headcount: 0, pendingCount: 0 };
    const amount = parseAmount(s?.amount || 0);
    cur.amount += amount;
    cur.headcount += 1;
    if (s?.amount_pending && amount <= 0) cur.pendingCount += 1;
    map.set(roundKey, cur);
  }
  return [...map.values()];
}

/**
 * 회차별 조율 상태. 표가 아직 없는 환경(마이그레이션 전 프리뷰)에서도 금액은 보여야
 * 하므로, 조회가 실패하면 "조율 기록 없음" 으로만 처리한다 — 여기서 오류를 올리면
 * 정산 화면 전체가 빈 화면이 되고, 정작 급한 청구 금액을 볼 수 없다.
 */
async function loadSchedule(business: string): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  try {
    const rows = (await getDatabase().sql`
      SELECT * FROM brand_settlement_schedule WHERE business_username = ${business}
    `) as any[];
    for (const row of rows || []) map.set(String(row.round_key || ""), row);
  } catch (err: any) {
    console.error("[brand-settlement] 조율 기록 조회 실패", err?.message || err);
  }
  return map;
}

/**
 * 조율 상태. 담당자 아이디(제안·동의·확인한 사람)는 담당자에게만 담는다 — 브랜드가
 * 볼 이유가 없고, 화면에는 어느 쪽이 말했는지만 있으면 충분하다.
 */
function shapeSchedule(row: any, forManager: boolean) {
  if (!row) return null;
  return {
    proposedDate: dateOnly(row.proposed_date),
    proposedSide: String(row.proposed_side || ""),
    proposedNote: String(row.proposed_note || ""),
    proposedAt: row.proposed_at || null,
    proposedBy: forManager ? String(row.proposed_by || "") : "",
    agreedDate: dateOnly(row.agreed_date),
    agreedSide: String(row.agreed_side || ""),
    agreedAt: row.agreed_at || null,
    agreedBy: forManager ? String(row.agreed_by || "") : "",
    receivedAt: row.received_at || null,
    receivedBy: forManager ? String(row.received_by || "") : "",
  };
}

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const business = norm(url.searchParams.get("business"));
    if (!business) return jsonError("브랜드를 지정해 주세요.");
    const sides = await resolveSides(req, business);
    if ("error" in sides) return sides.error;

    const campaignId = String(url.searchParams.get("campaign") || "").trim();
    try {
      const [records, schedule] = await Promise.all([
        readRecords(SETTLEMENTS_STORE, settlementBizKey(business)),
        loadSchedule(business),
      ]);

      const rounds = buildRounds(records, campaignId);
      // 정산 항목이 지워졌더라도 이미 오간 약속은 화면에서 사라지지 않게 남긴다.
      // 조용히 없어지면 "합의한 입금일이 어디 갔나"를 담당자에게 물어야 한다.
      // 캠페인 하나만 걸러 본 화면에는 끼워 넣지 않는다 — 그 캠페인과 무관한 회차다.
      if (!campaignId) {
        const seen = new Set(rounds.map((r) => r.roundKey));
        for (const [roundKey, row] of schedule) {
          if (seen.has(roundKey) || !roundKey) continue;
          if (!row.proposed_date && !row.agreed_date && !row.received_at) continue;
          rounds.push({ roundKey, amount: 0, headcount: 0, pendingCount: 0 });
        }
      }

      rounds.sort((a, b) => (a.roundKey || "9999-99").localeCompare(b.roundKey || "9999-99"));
      return Response.json({
        business,
        /**
         * 담당자 자격으로 읽었는지. 화면은 이미 자기가 어느 쪽인지 알지만, 응답에
         * 담당자용 칸(제안·동의·확인한 사람)이 들어 있는지를 이 값으로 판단한다.
         */
        isManager: sides.isManager,
        rounds: rounds.map((round) => ({
          ...round,
          schedule: shapeSchedule(schedule.get(round.roundKey), sides.isManager),
        })),
      });
    } catch (err: any) {
      return jsonError(err?.message || "정산 정보를 불러오지 못했습니다.", 500);
    }
  }

  if (req.method !== "PATCH") {
    return jsonError("Method not allowed", 405);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonError("요청을 읽을 수 없습니다.");
  }

  const business = norm(body?.business);
  if (!business) return jsonError("브랜드를 지정해 주세요.");
  const sides = await resolveSides(req, business);
  if ("error" in sides) return sides.error;

  const roundKey = String(body?.roundKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(roundKey)) {
    return jsonError("정산 회차를 지정해 주세요.");
  }

  // 브랜드 계정과 담당자 자격을 함께 쥔 사람은 어느 쪽으로 말하는지 화면이 알려
  // 준다. 알려 주지 않으면 담당자 쪽으로 본다 — 조율은 담당자가 더 자주 연다.
  const asked = body?.side === "brand" || body?.side === "manager" ? (body.side as Side) : null;
  const side: Side =
    asked === "brand" && sides.isBrand ? "brand" : sides.isManager ? "manager" : "brand";

  const action = String(body?.action || "");
  const note = String(body?.note || "").slice(0, 300);
  const date = String(body?.date || "").slice(0, 10);
  const now = new Date().toISOString();

  try {
    const db = getDatabase();
    const existing = (await db.sql`
      SELECT * FROM brand_settlement_schedule
      WHERE business_username = ${business} AND round_key = ${roundKey}
      LIMIT 1
    `) as any[];
    const row = existing?.[0] || null;

    if (action === "propose") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError("입금일을 선택해 주세요.");
      // 다시 제안하면 지난 동의는 지운다. 남겨 두면 제안과 합의가 서로 다른 날짜로
      // 함께 걸려 있게 되고, 어느 쪽이 유효한지 화면에서 판단할 수 없다.
      await db.sql`
        INSERT INTO brand_settlement_schedule (
          business_username, round_key, proposed_date, proposed_side, proposed_by,
          proposed_note, proposed_at, agreed_date, agreed_side, agreed_by, agreed_at, updated_at
        ) VALUES (
          ${business}, ${roundKey}, ${date}, ${side}, ${sides.username},
          ${note}, ${now}, NULL, '', '', NULL, ${now}
        )
        ON CONFLICT (business_username, round_key) DO UPDATE SET
          proposed_date = ${date},
          proposed_side = ${side},
          proposed_by = ${sides.username},
          proposed_note = ${note},
          proposed_at = ${now},
          agreed_date = NULL,
          agreed_side = '',
          agreed_by = '',
          agreed_at = NULL,
          updated_at = ${now}
      `;
    } else if (action === "agree") {
      const proposed = dateOnly(row?.proposed_date);
      if (!proposed) return jsonError("아직 제안된 입금일이 없습니다.");
      // 자기 제안에 자기가 동의하면 조율이 아니라 통보다. 상대가 동의할 때만 확정한다.
      if (String(row?.proposed_side || "") === side) {
        return jsonError("상대가 제안한 입금일에만 동의할 수 있습니다.");
      }
      await db.sql`
        UPDATE brand_settlement_schedule SET
          agreed_date = ${proposed},
          agreed_side = ${side},
          agreed_by = ${sides.username},
          agreed_at = ${now},
          updated_at = ${now}
        WHERE business_username = ${business} AND round_key = ${roundKey}
      `;
    } else if (action === "reset") {
      // 조율을 처음으로 되돌린다. 이미 입금이 확인된 회차는 되돌리지 않는다 —
      // 받은 돈의 근거가 사라진다.
      if (row?.received_at) return jsonError("입금이 확인된 회차는 되돌릴 수 없습니다.");
      await db.sql`
        UPDATE brand_settlement_schedule SET
          proposed_date = NULL, proposed_side = '', proposed_by = '', proposed_note = '',
          proposed_at = NULL, agreed_date = NULL, agreed_side = '', agreed_by = '',
          agreed_at = NULL, updated_at = ${now}
        WHERE business_username = ${business} AND round_key = ${roundKey}
      `;
    } else if (action === "receive" || action === "unreceive") {
      // 입금을 받은 사실은 픽스폴리오만 확인할 수 있다. 브랜드가 스스로 체크하게 두면
      // 담당자는 통장을 보지 않고 지급을 진행하게 된다.
      if (!sides.isManager) return jsonError("입금 확인은 픽스폴리오 담당자만 합니다.", 403);
      const received = action === "receive" ? now : null;
      const receivedBy = action === "receive" ? sides.username : "";
      await db.sql`
        INSERT INTO brand_settlement_schedule (
          business_username, round_key, received_at, received_by, updated_at
        ) VALUES (${business}, ${roundKey}, ${received}, ${receivedBy}, ${now})
        ON CONFLICT (business_username, round_key) DO UPDATE SET
          received_at = ${received}, received_by = ${receivedBy}, updated_at = ${now}
      `;
    } else {
      return jsonError("알 수 없는 요청입니다.");
    }

    const after = (await db.sql`
      SELECT * FROM brand_settlement_schedule
      WHERE business_username = ${business} AND round_key = ${roundKey}
      LIMIT 1
    `) as any[];
    return Response.json({
      roundKey,
      schedule: shapeSchedule(after?.[0] || null, sides.isManager),
    });
  } catch (err: any) {
    return jsonError(err?.message || "입금일을 저장하지 못했습니다.", 500);
  }
};

export const config: Config = {
  path: "/api/brand-settlement",
};
