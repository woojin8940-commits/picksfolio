import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireAccountOwner, requireSignedInUser } from "./_shared/user-auth.mts";
import { requireManager } from "./_shared/manager-auth.mts";
import { parseAmount } from "./_shared/collab-records.mts";
import { createCollabForApplication, logCollabEvent, norm } from "./_shared/collab-workflow.mts";
import { buildSnapshots, mirrorCollabProposal } from "./_shared/campaign-listup.mts";
import { isOpenApplyMode, normalizeRewardMode } from "./_shared/reward-mode.mts";

/**
 * 캠페인 지원자 — 조회와 선정.
 *
 * 누가 고르는지가 진행 방식에 따라 갈린다.
 *
 *   광고비 지급형(paid): 담당자가 조건에 맞는 후보를 찾아 리스트업하는 길이다. 지원자
 *     선정도 담당자가 한다. 브랜드는 "이 사람이 좋다 / 아니다"를 남길 수 있고
 *     (brand_preference) 그 의견은 담당자의 판단 근거가 되지만 협업을 만들지는 않는다.
 *
 *   제품 협찬형·공동구매(OPEN_APPLY_MODES): 지원자 명단이 곧 후보 명단이다. 브랜드가
 *     지원자를 보고 함께 하고 싶은 사람을 직접 수락하고, 그 뒤부터 픽스폴리오 담당자가
 *     중간에서 조건과 일정을 맡는다. 브랜드가 "추천"만 남기고 담당자의 확인을 기다리게
 *     하면, 브랜드는 이미 결정을 내렸는데 아무 일도 일어나지 않는 시간이 생긴다.
 *
 * 어느 쪽이든 수락은 협업 본체·단계·담당자 채널 2개를 한꺼번에 만든다(담당자가 중간에
 * 들어오는 지점이다). 그래서 누가 눌렀는지를 decided_by / decided_by_role 로 나눠 남긴다
 * — 한 컬럼을 공유하면 "브랜드가 고른 협업"과 "담당자가 고른 협업"을 나중에 구분할 수 없다.
 *
 * 브랜드가 사람을 고를 수 있어야 하니, 목록에는 메타 API 로 받아 둔 채널 지표를 함께
 * 실어 보낸다(buildSnapshots). 지원서에 적힌 자기 소개만으로는 고를 수 없다.
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
        SELECT business_username, manager_username, title, type, reward_mode
        FROM campaigns WHERE id = ${campaign_id}
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

      // 지원자마다 채널 지표를 붙인다. 메타 API 로 받아 둔 값이 있으면 그것이 먼저고,
      // 없으면 등록서에 적어 둔 값이 온다 — 어느 쪽인지는 metricsSource 로 구분된다.
      // 화면이 사람마다 따로 조회하면 목록 하나에 요청이 수십 개 나가므로 한 번에 모은다.
      const rows = (result as any[]) || [];
      const snapshots = await buildSnapshots(
        db,
        rows.map((r) => String(r.applicant_username || "")),
      );

      const rewardMode = normalizeRewardMode(campaign.reward_mode);
      return Response.json({
        applicants: rows.map((r) => ({
          ...r,
          insights: snapshots.get(norm(r.applicant_username)) || null,
        })),
        viewerRole,
        // 브랜드 화면이 "수락" 버튼과 "추천 의견" 중 무엇을 보여줄지 여기서 갈린다.
        selectionBy: isOpenApplyMode(rewardMode) ? "brand" : "manager",
        rewardMode,
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
      // 추천 이유만 고치는 요청. 지우는 것("")도 정상이므로 값이 비었는지가 아니라
      // 필드가 왔는지로 가른다.
      const hasManagerNote = (body as any).managerNote !== undefined;

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
               c.reward_mode, c.package_tier
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

      // --- 담당자 추천 이유 (선정과 분리) ---------------------------------
      // 브랜드 카드에 그대로 보이는 줄이다. 선정할 때만 적을 수 있게 두면, 브랜드가
      // 고르는 캠페인에서는 담당자가 이유를 남길 자리가 아예 없어진다 — 정작 그
      // 화면이 이유를 가장 필요로 한다.
      if (!status && !hasPreference && hasManagerNote) {
        const manager = await requireManager(req);
        if (!manager.ok) return manager.response;

        const note = String((body as any).managerNote || "").slice(0, 2000);
        await db.sql`
          UPDATE campaign_applications
          SET manager_note = ${note},
              updated_at = NOW()
          WHERE id = ${id}
        `;
        return Response.json({ success: true, managerNote: note });
      }

      if (!status) {
        return Response.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
      }
      if (!["pending", "accepted", "rejected"].includes(status)) {
        return Response.json({ error: "잘못된 상태값입니다." }, { status: 400 });
      }

      // --- 선정/거절 ------------------------------------------------------
      // 제품 협찬형·공동구매는 브랜드가 지원자 중에서 직접 수락하고, 광고비 지급형은
      // 담당자가 고른다. 어느 쪽이든 수락은 협업 본체와 단계, 담당자 채널을 한꺼번에
      // 만들어 담당자를 중간에 세운다.
      const openApply = isOpenApplyMode(appRow.reward_mode);
      const manager = await requireManager(req);
      let actorRole: "manager" | "brand" = "manager";
      let actorUsername = manager.ok ? manager.managerUsername : "";

      if (!manager.ok) {
        const signedIn = await requireSignedInUser(req);
        const isBrandOwner = signedIn.ok && signedIn.username === norm(appRow.business_username);
        if (!isBrandOwner) return manager.response;

        // 브랜드가 못 하는 것은 거절이다. 지원자에게 "안 됐다"를 전하는 일까지 브랜드가
        // 하면 중간에서 맡는 의미가 없다 — 브랜드는 '보류' 표시만 남기고 담당자가 정리한다.
        // (광고비 지급형은 수락도 담당자 몫이다. 예전 화면이 캐시돼 있을 수 있으므로
        //  왜 막혔고 무엇을 대신 할 수 있는지 함께 알려준다.)
        if (!openApply || status !== "accepted") {
          return Response.json(
            {
              error: openApply
                ? "지원자 거절은 픽스폴리오 담당자가 진행합니다. 함께 하고 싶은 지원자만 수락해 주시고 나머지는 '보류'로 표시해 주세요."
                : "지원자 선정은 픽스폴리오 담당자가 진행합니다. 원하는 지원자를 '추천'으로 표시해 주시면 담당자가 확인합니다.",
              code: openApply ? "REJECTION_BY_MANAGER" : "SELECTION_BY_MANAGER",
            },
            { status: 403 },
          );
        }
        actorRole = "brand";
        actorUsername = signedIn.username;
      }

      // 캠페인에 배정된 담당자가 곧 이 협업의 담당자다. 브랜드가 수락한 경우에는
      // 누르는 사람이 담당자가 아니므로 캠페인 쪽 배정만 본다. 아직 배정 전이라면
      // 빈 값으로 두고, 담당자 콘솔의 "담당자 없는 협업"에 잡히게 한다 — 여기서
      // 임의의 담당자를 넣으면 아무도 자기 일인 줄 모르는 협업이 생긴다.
      const managerUsername =
        norm(appRow.manager_username) || (manager.ok ? manager.managerUsername : "");

      await db.sql`
        UPDATE campaign_applications
        SET status = ${status},
            manager_note = ${String((body as any).note || appRow.manager_note || "")},
            decided_by = ${actorUsername},
            decided_by_role = ${actorRole},
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
        rewardMode: appRow.reward_mode,
        campaignTitle,
        companyName,
        businessUsername,
        creatorUsername,
        managerUsername,
        selectedBy: actorRole,
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
        actorRole,
        actorUsername,
        summary: `${creatorUsername} ${actorRole === "brand" ? "수락(브랜드)" : "선정"}`,
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
        // 담당자 배정 전이라면 화면이 "담당자가 곧 연락드립니다"로 안내할 수 있게 알려준다.
        managerUsername,
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
