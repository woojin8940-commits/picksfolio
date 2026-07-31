import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { isRecruitClosed, todayInSeoul } from "./_shared/campaign-recruit.mts";
import { isOpenApplyMode, normalizeRewardMode } from "./_shared/reward-mode.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

/**
 * 조회 결과에 모집 마감 여부(recruit_closed)를 붙인다.
 * 브랜드가 직접 마감하지 않았더라도 종료일이 지난 캠페인은 지원을 받을 수 없으므로,
 * 화면에서 "마감"으로 표시할 수 있도록 계산해 준다.
 * (모집 인원이 다 차는 것은 마감 사유가 아니다 — 정원을 넘겨도 계속 지원받는다.)
 */
const withRecruitState = (rows: any[]) => {
  const today = todayInSeoul();
  return rows.map((c) => ({ ...c, recruit_closed: isRecruitClosed(c, today) }));
};

/**
 * 브리프에 들어오는 금액. "150,000원"처럼 사람이 적은 형태로 와도 숫자로 만든다 —
 * 숫자 컬럼에 문자열이 들어가면 저장 자체가 실패해서 캠페인 등록이 통째로 막힌다.
 */
const briefFee = (raw: unknown) => {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/**
 * 여러 개를 고르는 항목(연령대, 팔로워 규모, 스타일...)은 쉼표로 이어 한 칸에 넣는다.
 * 화면에서 배열로 보내도 되고 이미 이어진 문자열로 보내도 되게 받아 둔다 — 등록
 * 화면과 수정 화면이 서로 다른 모양으로 보내다가 조건이 통째로 사라지는 일을 막는다.
 */
const csv = (raw: unknown): string => {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean).join(",");
  return String(raw ?? "").trim();
};

/**
 * 진행 방식·목록 노출 규칙은 _shared/reward-mode.mts 에 모아 두었다. 브랜드 화면의
 * 수락 권한도 같은 규칙을 보기 때문에, 여기서 따로 판단하지 않는다.
 */
const rewardMode = (raw: unknown): string => normalizeRewardMode(raw);

export default async (req: Request) => {
  const db = getDatabase();
  const url = new URL(req.url);

  if (req.method === "GET") {
    try {
      const id = url.searchParams.get("id");

      if (id) {
        const result = await db.sql`
          SELECT c.*, COALESCE(ac.cnt, 0)::int as application_count
          FROM campaigns c
          LEFT JOIN (SELECT campaign_id, COUNT(*) as cnt FROM campaign_applications GROUP BY campaign_id) ac ON ac.campaign_id = c.id
          WHERE c.id = ${id}
        `;
        if (result.length === 0) {
          return Response.json({ error: "Campaign not found" }, { status: 404 });
        }
        return Response.json({ campaign: withRecruitState(result)[0] });
      }

      const type = url.searchParams.get("type") || "";
      const category = url.searchParams.get("category") || "";
      const business = url.searchParams.get("business") || "";
      const search = url.searchParams.get("search") || "";
      // 브랜드 관리 화면은 승인 대기·마감 등 모든 상태를 봐야 하므로, business 조회에는
      // status 조건을 걸지 않는다(명시로 넘긴 경우는 제외). 공개 목록은 기본 'active'.
      const statusParam = url.searchParams.get("status") || "";
      const status = business ? statusParam : statusParam || "active";
      const pattern = search ? `%${search}%` : "";

      // 조건별로 쿼리를 복사하지 않고, 넘어오지 않은 조건은 빈 문자열로 비활성화한다.
      // (조건 조합이 늘어날 때마다 분기를 추가하다 보면 category+type 처럼 빠지는
      //  조합이 생긴다.)
      const result = await db.sql`
        SELECT c.*, COALESCE(ac.cnt, 0)::int as application_count
        FROM campaigns c
        LEFT JOIN (SELECT campaign_id, COUNT(*) as cnt FROM campaign_applications GROUP BY campaign_id) ac ON ac.campaign_id = c.id
        WHERE (${business} = '' OR c.business_username = ${business})
          AND (${status} = '' OR c.status = ${status})
          AND (${type} = '' OR c.type = ${type})
          AND (${category} = '' OR c.category = ${category})
          AND (${pattern} = '' OR c.title ILIKE ${pattern} OR c.brand_name ILIKE ${pattern} OR c.description ILIKE ${pattern})
        ORDER BY c.created_at DESC
      `;

      const campaigns = withRecruitState(result as any[]);

      // 공개 목록(브랜드 자신의 관리 화면이 아닌 경우)에서는 모집이 끝난 캠페인을
      // 제외한다. 브랜드가 "마감"을 누르지 않았더라도 종료일이 지난 캠페인은
      // 지원할 수 없어, 노출해 봐야 막다른 길이기 때문이다.
      // 진행 방식으로도 한 번 더 거른다 — 광고비 지급형은 지원을 받는 캠페인이 아니라
      // 담당자가 후보를 리스트업하는 캠페인이다(_shared/reward-mode.mts 주석 참고).
      // 브랜드 관리 화면(business 파라미터)에서는 마감된 캠페인도, 광고비 지급형도
      // 그대로 보여 준다 — 수정·재개·삭제해야 하므로.
      if (!business) {
        return Response.json({
          campaigns: campaigns.filter((c) => !c.recruit_closed && isOpenApplyMode(c.reward_mode)),
        });
      }

      return Response.json({ campaigns });
    } catch (err: any) {
      return Response.json({ error: err?.message || "서버 오류" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (!body.business_username || !body.type || !body.title) {
        return Response.json({ error: "필수 항목을 입력해 주세요." }, { status: 400 });
      }

      // 남의 브랜드 이름으로 캠페인을 올릴 수 없도록 계정 주인인지 확인한다.
      const auth = await requireAccountOwner(req, String(body.business_username));
      if (!auth.ok) return auth.response;

      const id = `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // 광고 목적(ad_objective)은 || 가 아니라 ?? 로 받는다. 지원을 받아 고르는 방식
      // (제품 협찬형·공동구매)에는 광고 목적이 없어서 빈 문자열로 오는데, || 로 접으면
      // 고르지도 않은 '인지도'가 저장되고 담당자 화면에 조건으로 뜬다.
      await db.sql`
        INSERT INTO campaigns (
          id, business_username, type, title, description, brand_name, thumbnail_url, category,
          reward_type, reward_amount, requirements, max_applicants, start_date, end_date, status,
          product_name, product_url, upload_channel, content_format, video_concept,
          guideline_url, guideline_note, second_use_fee, second_use_note, upload_from, upload_to,
          package_tier, reward_mode, tier_counts,
          product_provide, ad_objective, budget_krw, seeding_count, groupbuy_commission_rate, fast_track,
          influencer_gender, influencer_ages, sns_category, follower_tiers, min_views,
          influencer_styles, exclude_keywords, target_audience
        )
        VALUES (
          ${id}, ${body.business_username}, ${body.type}, ${body.title}, ${body.description || ""},
          ${body.brand_name || ""}, ${body.thumbnail_url || ""}, ${body.category || ""},
          ${body.reward_type || ""}, ${body.reward_amount || ""}, ${body.requirements || ""},
          ${body.max_applicants || 0}, ${body.start_date || null}, ${body.end_date || null}, 'pending_approval',
          ${body.product_name || ""}, ${body.product_url || ""}, ${body.upload_channel || ""},
          ${body.content_format || ""}, ${body.video_concept || ""},
          ${body.guideline_url || ""}, ${body.guideline_note || ""},
          ${briefFee(body.second_use_fee)}, ${body.second_use_note || ""},
          ${body.upload_from || ""}, ${body.upload_to || ""},
          ${body.package_tier || "full"},
          ${rewardMode(body.reward_mode)}, ${body.tier_counts || ""},
          ${body.product_provide || "provide"},
          ${body.ad_objective ?? "awareness"}, ${briefFee(body.budget_krw)},
          ${briefFee(body.seeding_count)}, ${briefFee(body.groupbuy_commission_rate)},
          ${Boolean(body.fast_track)},
          ${body.influencer_gender || ""}, ${csv(body.influencer_ages)},
          ${body.sns_category || ""}, ${csv(body.follower_tiers)}, ${briefFee(body.min_views)},
          ${csv(body.influencer_styles)}, ${csv(body.exclude_keywords)},
          ${body.target_audience || ""}
        )
      `;

      return Response.json({ success: true, id });
    } catch (err: any) {
      return Response.json({ error: err?.message || "캠페인 생성 실패" }, { status: 500 });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = await req.json();
      const { id, ...updates } = body;
      if (!id) {
        return Response.json({ error: "캠페인 ID가 필요합니다." }, { status: 400 });
      }

      const existing = await db.sql`SELECT * FROM campaigns WHERE id = ${id}`;
      if (existing.length === 0) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      const c = existing[0] as Record<string, any>;

      // 캠페인 ID 만 알면 남의 캠페인을 고칠 수 있었다. 등록한 브랜드(또는 관리자)만
      // 수정할 수 있도록 확인한다.
      const auth = await requireAccountOwner(req, String(c.business_username || ""));
      if (!auth.ok) return auth.response;

      let newStatus = updates.status ?? c.status;
      if (c.status === 'pending_approval' || c.status === 'admin_rejected') {
        newStatus = c.status;
      }

      await db.sql`
        UPDATE campaigns
        SET title = ${updates.title ?? c.title},
            type = ${updates.type ?? c.type},
            description = ${updates.description ?? c.description},
            brand_name = ${updates.brand_name ?? c.brand_name},
            thumbnail_url = ${updates.thumbnail_url ?? c.thumbnail_url},
            category = ${updates.category ?? c.category},
            reward_type = ${updates.reward_type ?? c.reward_type},
            reward_amount = ${updates.reward_amount ?? c.reward_amount},
            requirements = ${updates.requirements ?? c.requirements},
            max_applicants = ${updates.max_applicants ?? c.max_applicants},
            start_date = ${updates.start_date ?? c.start_date},
            end_date = ${updates.end_date ?? c.end_date},
            product_name = ${updates.product_name ?? c.product_name ?? ""},
            product_url = ${updates.product_url ?? c.product_url ?? ""},
            upload_channel = ${updates.upload_channel ?? c.upload_channel ?? ""},
            content_format = ${updates.content_format ?? c.content_format ?? ""},
            video_concept = ${updates.video_concept ?? c.video_concept ?? ""},
            guideline_url = ${updates.guideline_url ?? c.guideline_url ?? ""},
            guideline_note = ${updates.guideline_note ?? c.guideline_note ?? ""},
            second_use_fee = ${updates.second_use_fee === undefined ? Number(c.second_use_fee || 0) : briefFee(updates.second_use_fee)},
            second_use_note = ${updates.second_use_note ?? c.second_use_note ?? ""},
            upload_from = ${updates.upload_from ?? c.upload_from ?? ""},
            upload_to = ${updates.upload_to ?? c.upload_to ?? ""},
            package_tier = ${updates.package_tier ?? c.package_tier ?? "full"},
            reward_mode = ${updates.reward_mode === undefined ? rewardMode(c.reward_mode) : rewardMode(updates.reward_mode)},
            tier_counts = ${updates.tier_counts === undefined ? (c.tier_counts ?? "") : String(updates.tier_counts || "")},
            product_provide = ${updates.product_provide ?? c.product_provide ?? "provide"},
            ad_objective = ${updates.ad_objective ?? c.ad_objective ?? "awareness"},
            budget_krw = ${updates.budget_krw === undefined ? Number(c.budget_krw || 0) : briefFee(updates.budget_krw)},
            seeding_count = ${updates.seeding_count === undefined ? Number(c.seeding_count || 0) : briefFee(updates.seeding_count)},
            groupbuy_commission_rate = ${updates.groupbuy_commission_rate === undefined ? Number(c.groupbuy_commission_rate || 0) : briefFee(updates.groupbuy_commission_rate)},
            fast_track = ${updates.fast_track === undefined ? Boolean(c.fast_track) : Boolean(updates.fast_track)},
            influencer_gender = ${updates.influencer_gender ?? c.influencer_gender ?? ""},
            influencer_ages = ${updates.influencer_ages === undefined ? (c.influencer_ages ?? "") : csv(updates.influencer_ages)},
            sns_category = ${updates.sns_category ?? c.sns_category ?? ""},
            follower_tiers = ${updates.follower_tiers === undefined ? (c.follower_tiers ?? "") : csv(updates.follower_tiers)},
            min_views = ${updates.min_views === undefined ? Number(c.min_views || 0) : briefFee(updates.min_views)},
            influencer_styles = ${updates.influencer_styles === undefined ? (c.influencer_styles ?? "") : csv(updates.influencer_styles)},
            exclude_keywords = ${updates.exclude_keywords === undefined ? (c.exclude_keywords ?? "") : csv(updates.exclude_keywords)},
            target_audience = ${updates.target_audience ?? c.target_audience ?? ""},
            status = ${newStatus},
            updated_at = NOW()
        WHERE id = ${id}
      `;

      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "캠페인 수정 실패" }, { status: 500 });
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = url.searchParams.get("id");
      if (!id) {
        return Response.json({ error: "캠페인 ID가 필요합니다." }, { status: 400 });
      }

      const existing = await db.sql`SELECT id, business_username FROM campaigns WHERE id = ${id}`;
      if (existing.length === 0) {
        return Response.json({ error: "캠페인을 찾을 수 없습니다." }, { status: 404 });
      }

      // 예전에는 business 쿼리 파라미터를 넘겼을 때만 소유자를 확인해서, 파라미터를
      // 빼면 누구나 남의 캠페인을 지울 수 있었다. 이제 토큰으로 확인한다.
      const auth = await requireAccountOwner(req, String((existing[0] as any).business_username || ""));
      if (!auth.ok) return auth.response;

      await db.sql`DELETE FROM campaign_collabs WHERE campaign_id = ${id}`;
      await db.sql`DELETE FROM campaign_applications WHERE campaign_id = ${id}`;
      await db.sql`DELETE FROM campaigns WHERE id = ${id}`;

      return Response.json({ success: true });
    } catch (err: any) {
      return Response.json({ error: err?.message || "캠페인 삭제 실패" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/campaigns",
};
