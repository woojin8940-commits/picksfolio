import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAccountOwner, requireSignedInUser } from "./_shared/user-auth.mts";
import { requireManager } from "./_shared/manager-auth.mts";
import { parseAmount } from "./_shared/collab-records.mts";
import { createCollabForApplication, logCollabEvent, norm } from "./_shared/collab-workflow.mts";
import { mirrorCollabProposal } from "./_shared/campaign-listup.mts";

/**
 * 캠페인 지원자 — 조회와 선정.
 *
 * 예전에는 브랜드가 직접 지원자를 수락/거절했다. 수락 한 번에 대화방과 정산까지
 * 만들어졌으므로 사실상 계약 체결 버튼이었는데, 그 뒤를 챙기는 사람은 아무도 없었다.
 *
 * 이제 선정은 픽스폴리오 담당자가 한다. 브랜드는 지원자를 보고 "이 사람이 좋다 /
 * 아니다"를 남길 수 있고(brand_preference), 그 의견은 담당자의 판단 근거가 되지만
 * 그 자체로 협업을 만들지는 않는다. 브랜드 의견과 실제 결정을 다른 컬럼에 두는 것이
 * 이 변경의 핵심이다 — 같은 컬럼을 공유하면 "누가 결정했는가"가 사라진다.
 */

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const campaign_id = url.searchParams.get("campaign_id");
      if (!campaign_id) {
        return Response.json({ error: "캠페인 ID가 필요합니다." }, { status: 400 });
      }

      const owner = await db.sql`
        SELECT business_username, manager_username, title, type FROM campaigns WHERE id = ${campaign_id}
      `;
      if (owner.length === 0) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }
      const campaign = owner[0] as any;

      // 지원자 목록에는 연락처·SNS 링크가 들어 있다. 캠페인을 등록한 브랜드와
      // 픽스폴리오 담당자만 볼 수 있다.
      const manager = await requireManager(req);
      let viewerRole: "manager" | "brand" = "manager";
      if (!manager.ok) {
        const auth = await requireAccountOwner(req, String(campaign.business_username || ""));
        if (!auth.ok) return auth.response;
        viewerRole = "brand";
      }

      const result = await db.sql`
        SELECT ca.*, cc.id AS collab_id, cc.status AS collab_status, cc.current_stage_key
        FROM campaign_applications ca
        LEFT JOIN campaign_collabs cc
          ON cc.campaign_id = ca.campaign_id AND cc.creator_username = ca.applicant_username
        WHERE ca.campaign_id = ${campaign_id}
        ORDER BY ca.created_at DESC
      `;

      return Response.json({
        applicants: result,
        viewerRole,
        // 브랜드 화면이 "수락" 버튼을 감추고 의견 입력으로 바꿀 수 있게 알려준다.
        selectionBy: "manager",
        managerUsername: campaign.manager_username || "",
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = await req.json();
      const { id } = body as any;
      const status = (body as any).status ? String((body as any).status) : "";
      const hasPreference = (body as any).brandPreference !== undefined;
      const preference = hasPreference ? String((body as any).brandPreference || "") : "";

      if (!id) {
        return Response.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
      }

      const appRows = await db.sql`
        SELECT ca.*, c.title as campaign_title, c.business_username, c.brand_name,
               c.type as campaign_type, c.reward_type, c.reward_amount,
               c.start_date, c.end_date, c.manager_username, c.description,
               c.product_name, c.product_url, c.upload_channel, c.content_format,
               c.video_concept, c.guideline_url, c.guideline_note,
               c.second_use_fee, c.second_use_note, c.upload_from, c.upload_to,
               c.package_tier
        FROM campaign_applications ca
        JOIN campaigns c ON c.id = ca.campaign_id
        WHERE ca.id = ${id}
      `;
      const appRow = (appRows as any[])?.[0];
      if (!appRow) {
        return Response.json({ error: "지원 내역을 찾을 수 없습니다." }, { status: 404 });
      }

      // --- 브랜드 의견 (구속력 없음) -------------------------------------
      // 의견을 지우는 것("")도 정상 요청이므로 값이 비었는지가 아니라 필드가
      // 왔는지로 분기한다.
      if (!status && hasPreference) {
        if (!["", "shortlist", "pass"].includes(preference)) {
          return Response.json({ error: "잘못된 의견 값입니다." }, { status: 400 });
        }
        const auth = await requireAccountOwner(req, String(appRow.business_username || ""));
        if (!auth.ok) return auth.response;

        const note = String((body as any).brandPreferenceNote ?? (body as any).note ?? "");
        await db.sql`
          UPDATE campaign_applications
          SET brand_preference = ${preference},
              brand_preference_note = ${note},
              updated_at = NOW()
          WHERE id = ${id}
        `;
        return Response.json({ success: true, brandPreference: preference });
      }

      if (!status) {
        return Response.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
      }
      if (!["pending", "accepted", "rejected"].includes(status)) {
        return Response.json({ error: "잘못된 상태값입니다." }, { status: 400 });
      }

      // --- 선정/거절 (담당자만) ------------------------------------------
      // 브랜드 소유자 확인에서 담당자 확인으로 바뀐 지점이다. 수락은 협업 본체와
      // 단계, 담당자 채널을 한꺼번에 만들어 내므로 중간에서 관리하는 사람이 눌러야 한다.
      const manager = await requireManager(req);
      if (!manager.ok) {
        // 브랜드가 예전 화면(캐시된 스크립트)으로 수락을 시도할 수 있으므로,
        // 왜 막혔는지와 무엇을 대신 할 수 있는지를 함께 알려준다.
        const signedIn = await requireSignedInUser(req);
        const isBrandOwner = signedIn.ok && signedIn.username === norm(appRow.business_username);
        if (isBrandOwner) {
          return Response.json(
            {
              error:
                "지원자 선정은 픽스폴리오 담당자가 진행합니다. 원하는 지원자를 '추천'으로 표시해 주시면 담당자가 확인합니다.",
              code: "SELECTION_BY_MANAGER",
            },
            { status: 403 },
          );
        }
        return manager.response;
      }

      const managerUsername = norm(appRow.manager_username) || manager.managerUsername;

      await db.sql`
        UPDATE campaign_applications
        SET status = ${status},
            manager_note = ${String((body as any).note || appRow.manager_note || "")},
            decided_by = ${manager.managerUsername},
            decided_at = NOW(),
            updated_at = NOW()
        WHERE id = ${id}
      `;

      if (status !== "accepted") {
        return Response.json({ success: true });
      }

      const businessUsername = norm(appRow.business_username);
      const creatorUsername = norm(appRow.applicant_username);
      const companyName = appRow.brand_name || "";
      const campaignTitle = appRow.campaign_title || "";
      const fee = parseAmount(appRow.reward_amount);

      // 1) 협업 본체 + 단계 + 조건 초안 + 담당자 채널 2개
      const collab = await createCollabForApplication({
        db,
        campaignId: appRow.campaign_id,
        applicationId: appRow.id,
        campaignType: appRow.campaign_type,
        packageTier: appRow.package_tier,
        campaignTitle,
        companyName,
        businessUsername,
        creatorUsername,
        managerUsername,
        rewardType: appRow.reward_type,
        fee,
        startDate: appRow.start_date,
        brief: {
          productName: appRow.product_name,
          productUrl: appRow.product_url,
          uploadChannel: appRow.upload_channel,
          contentFormat: appRow.content_format,
          videoConcept: appRow.video_concept,
          guideUrl: appRow.guideline_url,
          guideNote: appRow.guideline_note,
          secondUseFee: Number(appRow.second_use_fee || 0),
          secondUseNote: appRow.second_use_note,
          uploadFrom: appRow.upload_from,
          uploadTo: appRow.upload_to,
        },
      });

      // 2) 인플루언서의 제안 목록과 브랜드 수신함에 이 협업을 노출한다.
      //    (대화는 담당자 채널로 가지만, 목록에는 진행 중 협업으로 보여야 한다.)
      //    리스트업 수락도 같은 반영이 필요해서 공용 함수로 빼 두었다.
      await mirrorCollabProposal({
        collabId: collab.id,
        campaignId: appRow.campaign_id,
        campaignType: appRow.campaign_type,
        campaignTitle,
        description: appRow.description || "",
        companyName,
        businessUsername,
        creatorUsername,
        managerUsername,
        startDate: appRow.start_date || "",
        endDate: appRow.end_date || "",
        fee,
      });

      // 3) 정산은 여기서 만들지 않는다.
      //    예전에는 수락 시점 +30일로 예약했는데, 업로드가 그보다 늦어지면 아직
      //    게시되지도 않은 협업의 정산이 잡혀 있는 상태가 됐다. 이제 담당자가
      //    업로드를 확인한 단계(confirm)에서 익월 말일 기준으로 예약한다.
      await logCollabEvent(db, {
        collabId: collab.id,
        type: "applicant_selected",
        actorRole: "manager",
        actorUsername: manager.managerUsername,
        summary: `${creatorUsername} 선정`,
        payload: { applicationId: appRow.id, fee },
      });

      return Response.json({
        success: true,
        collabId: collab.id,
        threads: {
          influencerSupport: collab.influencerThreadId,
          brandSupport: collab.brandThreadId,
        },
        created: collab.created,
      });
    } catch (err: any) {
      return Response.json({ error: err?.message || "상태 변경 실패" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/campaign-applicants",
};
