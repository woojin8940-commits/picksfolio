import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";

/**
 * 브랜드 일괄 정산금 수납 — 담당자가 "브랜드 돈이 들어왔다"를 남기는 자리.
 *
 * 돈의 순서는 브랜드 → 픽스폴리오 → 인플루언서다. 브랜드는 인플루언서 스무 명에게
 * 스무 번 송금하지 않고 픽스폴리오에 한 번 보내며, 원천징수와 개별 지급은 픽스폴리오가
 * 한다. 그러니 인플루언서 지급은 브랜드 입금 뒤에만 할 수 있는 일인데, 그 앞쪽 절반이
 * 앱 밖(통장)에 있어서 캠페인 정산 탭에는 "서류를 냈으니 보낼 수 있다"까지만 적혀
 * 있었다. 담당자가 입금 전에 지급을 닫으면 픽스폴리오 돈이 먼저 나간다.
 *
 * 여기서 남긴 사실 하나(received_at)가 두 곳을 움직인다.
 *
 *   · 담당자 화면 — 사람별 '정산완료' 버튼이 이 값이 채워질 때까지 잠긴다.
 *     서버도 같은 규칙을 본다(api-collab-workflow 의 complete_settlement).
 *   · 브랜드 화면 — 캠페인 정산의 회차 줄이 '정산완료'로 바뀐다. 브랜드는 자기
 *     입금이 접수됐는지 담당자에게 묻지 않아도 된다(api-settlements 가 정산 항목에
 *     이 값을 실어 보낸다).
 *
 * 청구액은 확정된 보수의 합계를 기본값으로 계산해 함께 내려보낸다 — 담당자가 금액을
 * 다시 적지 않아도 "얼마가 들어와야 하는가"가 화면에 있어야 통장과 대조할 수 있다.
 *
 * 담당자가 적는 것은 실제로 들어온 금액 하나뿐이고, 남는 사실은 "입금이 되었는가"
 * 하나다. 입금 날짜는 받지도, 남기지도 않는다 — 담당자는 통장을 열어 확인한 그 자리에서
 * 누르므로 날짜는 언제나 '누른 날'이었고, 그것을 '입금일'로 화면에 붙이면 통장과 다를
 * 수 있는 값을 사실처럼 말하게 된다. 확인한 시각(received_at)이 지급을 여는 조건이고,
 * 화면이 필요한 것은 그 참/거짓뿐이다. 메모는 넘어오지 않으면 그대로 둔다.
 *
 *   GET   /api/campaign-brand-settlement?campaignId=...
 *   PATCH /api/campaign-brand-settlement  { campaignId, action, ... }
 *
 * 담당자 전용이다. 브랜드는 자기 수납 상태를 정산 화면에서 읽기만 하고(위 참조),
 * 자기 입금을 스스로 확인 처리할 수는 없다 — 통장을 보는 사람이 누르는 버튼이다.
 */

const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const jsonError = (message: string, status = 400) => Response.json({ error: message }, { status });

/** 금액 입력. 화면에서 "1,200,000원" 꼴로 넘어와도 숫자만 남긴다. */
const parseAmount = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/** 응답 모양. 담당자 화면과 브랜드 화면이 같은 이름으로 읽는다. */
const shapeBrandSettlement = (row: any) => ({
  campaignId: String(row?.campaign_id || ""),
  invoiceAmount: Number(row?.invoice_amount || 0),
  receivedAmount: Number(row?.received_amount || 0),
  receivedAt: row?.received_at || null,
  receivedBy: String(row?.received_by || ""),
  memo: String(row?.memo || ""),
  /** 담당자가 입금을 확인했는가. 인플루언서 지급이 열리는 조건이다. */
  received: Boolean(row?.received_at),
});

/**
 * 청구 근거 — 이 캠페인에서 인플루언서에게 나갈 확정 보수의 합계와 인원.
 *
 * 브랜드 정산 화면의 '일괄 정산 총액'과 같은 값이어야 한다. 그 화면은 정산 항목의
 * 금액을 더하고 여기서는 조건표의 보수를 더하는데, 정산 항목의 금액이 조건표에서
 * 오므로(scheduleSettlementFor) 같은 값이 된다.
 */
async function billingBasis(db: any, campaignId: string) {
  const rows = (await db.sql`
    SELECT COALESCE(SUM(ct.fee), 0) AS total,
           COUNT(*) AS headcount,
           COUNT(*) FILTER (WHERE COALESCE(ct.fee, 0) <= 0) AS pending_count
    FROM campaign_collabs cc
    LEFT JOIN collab_terms ct ON ct.collab_id = cc.id
    WHERE cc.campaign_id = ${campaignId}
      AND cc.status IN ('in_progress', 'completed')
  `) as any[];
  const row = rows?.[0] || {};
  return {
    amount: Number(row.total || 0),
    headcount: Number(row.headcount || 0),
    /** 조건이 아직 잠기지 않아 합계에 들어가지 않은 인원. 청구 전에 확인해야 한다. */
    pendingCount: Number(row.pending_count || 0),
  };
}

async function loadCampaign(db: any, campaignId: string) {
  const rows = (await db.sql`
    SELECT id, title, brand_name, business_username, budget_krw
    FROM campaigns WHERE id = ${campaignId} LIMIT 1
  `) as any[];
  return rows?.[0] || null;
}

export default async (req: Request) => {
  const auth = await requireManager(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const db = getDatabase();

  try {
    if (req.method === "GET") {
      const campaignId = String(url.searchParams.get("campaignId") || "").trim();
      if (!campaignId) return jsonError("캠페인을 지정해 주세요.");

      const campaign = await loadCampaign(db, campaignId);
      if (!campaign) return jsonError("캠페인을 찾을 수 없습니다.", 404);

      const [rows, billing] = await Promise.all([
        db.sql`SELECT * FROM campaign_brand_settlements WHERE campaign_id = ${campaignId}` as Promise<any[]>,
        billingBasis(db, campaignId),
      ]);

      return Response.json({
        settlement: rows?.[0] ? shapeBrandSettlement(rows[0]) : shapeBrandSettlement({ campaign_id: campaignId }),
        billing,
        campaign: {
          id: campaign.id,
          title: campaign.title || "",
          brandName: campaign.brand_name || "",
          businessUsername: norm(campaign.business_username),
          budgetKrw: Number(campaign.budget_krw || 0),
        },
      });
    }

    if (req.method === "PATCH") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const campaignId = String(body.campaignId || "").trim();
      const action = String(body.action || "");
      if (!campaignId) return jsonError("캠페인을 지정해 주세요.");

      const campaign = await loadCampaign(db, campaignId);
      if (!campaign) return jsonError("캠페인을 찾을 수 없습니다.", 404);
      const business = norm(campaign.business_username);

      switch (action) {
        // 입금 확인 완료. 이 순간부터 사람별 지급이 열린다.
        case "mark_received": {
          const billing = await billingBasis(db, campaignId);
          // 금액을 적지 않으면 청구액(= 확정 보수 합계)이 그대로 들어온 것으로 본다.
          // 부분 수납이면 담당자가 실제 입금액을 적는다.
          const invoiceAmount = parseAmount(body.invoiceAmount) || billing.amount;
          const receivedAmount = parseAmount(body.receivedAmount) || invoiceAmount;
          const memo = String(body.memo || "").trim().slice(0, 500);

          await db.sql`
            INSERT INTO campaign_brand_settlements (
              campaign_id, business_username, invoice_amount, received_amount,
              received_at, received_by, memo
            ) VALUES (
              ${campaignId}, ${business}, ${invoiceAmount}, ${receivedAmount},
              NOW(), ${auth.managerUsername}, ${memo}
            )
            ON CONFLICT (campaign_id) DO UPDATE SET
              business_username = EXCLUDED.business_username,
              invoice_amount = EXCLUDED.invoice_amount,
              received_amount = EXCLUDED.received_amount,
              -- 이미 확인된 건을 다시 누르면(금액 정정) 처음 확인한 시각을 지킨다.
              received_at = COALESCE(campaign_brand_settlements.received_at, NOW()),
              received_by = EXCLUDED.received_by,
              -- 메모는 이 호출에 없으면 지우지 않는다. 담당자 화면에 메모 칸이 없으므로
              -- 빈 값이 늘 넘어오는데, 그걸로 청구 때 적어 둔 메모를 덮으면 안 된다.
              memo = COALESCE(NULLIF(EXCLUDED.memo, ''), campaign_brand_settlements.memo),
              updated_at = NOW()
          `;
          break;
        }

        // 확인을 되돌린다 — 다른 브랜드 입금과 헷갈려 잘못 눌렀을 때. 금액과 메모는
        // 남겨 둔다(청구 근거이고, 되돌린 뒤 다시 확인할 때 그대로 쓴다).
        case "reopen": {
          const rows = (await db.sql`
            UPDATE campaign_brand_settlements
            SET received_at = NULL, received_by = '', updated_at = NOW()
            WHERE campaign_id = ${campaignId}
            RETURNING campaign_id
          `) as any[];
          if (!rows?.length) return jsonError("확인된 입금 기록이 없습니다.", 404);
          break;
        }

        // 청구 금액만 적어 둔다(입금 전). 담당자가 세금계산서를 발행하고 나서
        // 통장을 기다리는 동안, 브랜드가 보낼 금액이 화면에 있어야 대조가 된다.
        case "save_invoice": {
          const billing = await billingBasis(db, campaignId);
          const invoiceAmount = parseAmount(body.invoiceAmount) || billing.amount;
          const memo = String(body.memo || "").trim().slice(0, 500);
          await db.sql`
            INSERT INTO campaign_brand_settlements (
              campaign_id, business_username, invoice_amount, memo
            ) VALUES (${campaignId}, ${business}, ${invoiceAmount}, ${memo})
            ON CONFLICT (campaign_id) DO UPDATE SET
              business_username = EXCLUDED.business_username,
              invoice_amount = EXCLUDED.invoice_amount,
              memo = EXCLUDED.memo,
              updated_at = NOW()
          `;
          break;
        }

        default:
          return jsonError("알 수 없는 동작입니다.");
      }

      const [rows, billing] = await Promise.all([
        db.sql`SELECT * FROM campaign_brand_settlements WHERE campaign_id = ${campaignId}` as Promise<any[]>,
        billingBasis(db, campaignId),
      ]);
      return Response.json({
        success: true,
        settlement: rows?.[0] ? shapeBrandSettlement(rows[0]) : shapeBrandSettlement({ campaign_id: campaignId }),
        billing,
      });
    }

    return jsonError("Method not allowed", 405);
  } catch (err: any) {
    console.error("[campaign-brand-settlement] 처리 실패:", err);
    return jsonError(err?.message || "브랜드 정산 정보를 처리하지 못했습니다.", 500);
  }
};

export const config: Config = {
  path: "/api/campaign-brand-settlement",
};
