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

/**
 * 가이드라인 파일 목록. 브랜드가 올린 PDF·이미지의 주소만 모아 둔다.
 *
 * 화면이 보낸 것을 그대로 믿지 않고 필요한 칸만 뽑아 다시 만든다 — 이 값은 협업
 * 상세를 통해 인플루언서 화면까지 그대로 흘러가므로, 임의의 객체가 섞여 들어오면
 * 그쪽에서 무엇이 렌더링될지 알 수 없다.
 */
const guidelineFiles = (raw: unknown): string => {
  let value: any = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return "[]"; }
  }
  if (!Array.isArray(value)) return "[]";
  const cleaned = value
    .filter((f) => f && typeof f === "object" && typeof f.url === "string" && /^https?:\/\//i.test(f.url))
    .slice(0, 20)
    .map((f: any) => ({
      url: String(f.url),
      name: String(f.name || "가이드라인").slice(0, 200),
      mimeType: String(f.mimeType || "").slice(0, 100),
      uploadedAt: String(f.uploadedAt || ""),
      uploadedBy: String(f.uploadedBy || "").slice(0, 100),
    }));
  return JSON.stringify(cleaned);
};

/**
 * 공개 목록에서 빼는 값. 공동구매 판매 수수료는 브랜드가 등록할 때 적어 두는
 * 희망 비율이고, 최종 비율은 담당자가 인플루언서와 이야기하며 정한다. 응답에
 * 남겨 두면 화면에서 지웠어도 값은 계속 내려가므로, 브랜드 자신의 관리 화면이
 * 아닌 조회에서는 응답 단계에서 떼어 낸다.
 */
const stripPrivateFields = (rows: any[]) =>
  rows.map(({ groupbuy_commission_rate: _rate, ...rest }) => rest);

/**
 * 캠페인 담당자. 등록할 때마다 "이 캠페인에 대해 물어볼 사람"을 받는다.
 *
 * 계정에 적힌 가입자 연락처로는 부족했다. 대행사 계정 하나로 여러 브랜드를 올리거나
 * 가입한 사람이 이미 퇴사한 경우, 담당자가 전화를 걸면 이 캠페인을 모르는 사람이 받는다.
 *
 * 번호는 숫자만 남긴다. 화면에서는 하이픈을 넣어 보여 주지만, 저장 형태가 사람마다
 * 다르면(010-1234-5678 / 01012345678 / +82 10…) 같은 번호인지 비교할 수 없다.
 */
const contactName = (raw: unknown) => String(raw ?? "").trim().slice(0, 60);
const contactPhone = (raw: unknown) => String(raw ?? "").replace(/[^\d]/g, "").slice(0, 11);
const contactEmail = (raw: unknown) => String(raw ?? "").trim().slice(0, 200);

/**
 * 담당자 칸 검사. 자릿수는 9~11 로 본다 — 휴대폰(10~11)뿐 아니라 02 지역번호(9)로
 * 적는 브랜드가 있어서, 휴대폰만 허용하면 유효한 번호가 반려된다.
 */
const contactError = (person: string, phone: string): string => {
  if (!person) return "캠페인 담당자 이름을 입력해 주세요.";
  if (!phone) return "캠페인 담당자 연락처를 입력해 주세요.";
  if (phone.length < 9 || phone.length > 11) return "담당자 연락처의 자릿수를 확인해 주세요.";
  return "";
};

/**
 * 담당자 연락처를 응답에서 떼어 낸다.
 *
 * 이 함수의 존재 이유: GET 은 `c.*` 로 캠페인 행을 그대로 내려보내고, 같은 응답을
 * 인플루언서의 캠페인 탐색 화면도 읽는다. 컬럼을 추가한 것만으로 브랜드 담당자의
 * 이름과 휴대폰 번호가 캠페인을 구경하는 모든 사람에게 흘러가게 되므로, 계정 주인으로
 * 확인된 요청이 아니면 무조건 떼어 낸다(담당자는 별도 API 로 본다).
 */
const stripContact = (rows: any[]) =>
  rows.map(({ contact_person: _p, contact_phone: _ph, contact_email: _e, ...rest }) => rest);

/**
 * 요청한 사람이 그 브랜드 계정의 주인인지 확인한다. 조회는 원래 로그인 없이도
 * 되는 곳이라, 토큰이 없거나 남의 계정이면 조용히 false 를 돌려주고 연락처만 가린다
 * (401 로 막으면 로그인 안 한 사람의 캠페인 탐색이 통째로 멈춘다).
 */
const viewerOwnsAccount = async (req: Request, businessUsername: string): Promise<boolean> => {
  if (!businessUsername) return false;
  const auth = await requireAccountOwner(req, businessUsername);
  return auth.ok;
};

/**
 * 목록 페이지 나누기. 캠페인이 쌓이면 한 번에 다 내려보내는 것이 무의미해진다
 * (화면도 무한 스크롤이 아니라 페이지 버튼을 쓴다).
 *
 * SQL LIMIT/OFFSET 이 아니라 걸러 낸 뒤 자르는 이유: 공개 목록은 아래에서
 * recruit_closed 와 진행 방식으로 한 번 더 거른다. 이 두 조건은 SQL 로 표현되어
 * 있지 않아서, DB 에서 20개를 잘라 오면 그중 절반이 걸러져 페이지마다 개수가
 * 들쭉날쭉해지고 마지막 페이지가 비기도 한다. 총 개수(total)도 걸러 낸 다음
 * 세어야 화면의 "N개"와 페이지 수가 맞는다.
 */
const paginate = <T,>(rows: T[], pageRaw: string, limitRaw: string) => {
  const limit = Math.min(60, Math.max(1, Number(limitRaw) || 0));
  const total = rows.length;
  if (!limitRaw || !Number.isFinite(limit)) {
    return { rows, total, page: 1, limit: total, total_pages: 1 };
  }
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(totalPages, Math.max(1, Number(pageRaw) || 1));
  const start = (page - 1) * limit;
  return { rows: rows.slice(start, start + limit), total, page, limit, total_pages: totalPages };
};

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
        const one = withRecruitState(result);
        const owner = String((result[0] as any).business_username || "");
        const forOwner = url.searchParams.get("business") === owner;
        const shaped = forOwner ? one[0] : stripPrivateFields(one)[0];
        // 담당자 연락처는 파라미터가 아니라 토큰으로 확인된 주인에게만 남긴다.
        const verified = forOwner && (await viewerOwnsAccount(req, owner));
        return Response.json({ campaign: verified ? shaped : stripContact([shaped])[0] });
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
      const pageParam = url.searchParams.get("page") || "";
      const limitParam = url.searchParams.get("limit") || "";

      // 공개 목록(브랜드 자신의 관리 화면이 아닌 경우)에서는 모집이 끝난 캠페인을
      // 제외한다. 브랜드가 "마감"을 누르지 않았더라도 종료일이 지난 캠페인은
      // 지원할 수 없어, 노출해 봐야 막다른 길이기 때문이다.
      // 진행 방식으로도 한 번 더 거른다 — 광고비 지급형은 지원을 받는 캠페인이 아니라
      // 담당자가 후보를 리스트업하는 캠페인이다(_shared/reward-mode.mts 주석 참고).
      // 브랜드 관리 화면(business 파라미터)에서는 마감된 캠페인도, 광고비 지급형도
      // 그대로 보여 준다 — 수정·재개·삭제해야 하므로.
      if (!business) {
        const open = campaigns.filter((c) => !c.recruit_closed && isOpenApplyMode(c.reward_mode));
        const paged = paginate(stripContact(stripPrivateFields(open)), pageParam, limitParam);
        return Response.json({
          campaigns: paged.rows,
          total: paged.total,
          page: paged.page,
          limit: paged.limit,
          total_pages: paged.total_pages,
        });
      }

      // 브랜드 자신의 관리 화면. 로그인이 확인되면 담당자 연락처까지 내려보낸다 —
      // 수정 화면이 이미 적어 둔 담당자를 되읽어야 하기 때문이다.
      const verified = await viewerOwnsAccount(req, business);
      const paged = paginate(verified ? campaigns : stripContact(campaigns), pageParam, limitParam);
      return Response.json({
        campaigns: paged.rows,
        total: paged.total,
        page: paged.page,
        limit: paged.limit,
        total_pages: paged.total_pages,
      });
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

      // 담당자 이름 · 연락처는 등록할 때마다 받는다. 화면에서도 막지만 서버에서
      // 한 번 더 본다 — 이 값이 비면 담당자는 다시 "누구에게 전화하나"로 돌아간다.
      const person = contactName(body.contact_person);
      const phone = contactPhone(body.contact_phone);
      const contactErr = contactError(person, phone);
      if (contactErr) return Response.json({ error: contactErr }, { status: 400 });

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
          influencer_styles, exclude_keywords, target_audience,
          contact_person, contact_phone, contact_email
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
          ${body.target_audience || ""},
          ${person}, ${phone}, ${contactEmail(body.contact_email)}
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

      /**
       * 담당자 칸의 수정 규칙.
       *
       * 빈 값이 오면 지우지 않고 기존 값을 유지한다. 이 API 는 마감 토글 · 가이드
       * 파일 저장처럼 몇 칸만 보내는 PATCH 도 받기 때문에, 안 보낸 것을 "지움"으로
       * 읽으면 그 호출들이 담당자 연락처를 조용히 비운다.
       *
       * 대신 값을 적어 보냈는데 번호 자릿수가 안 맞으면 막는다 — 잘못된 번호가
       * 저장되면 담당자는 없는 번호로 전화를 건다.
       */
      const nextPerson = contactName(updates.contact_person) || contactName(c.contact_person);
      const nextPhone = contactPhone(updates.contact_phone) || contactPhone(c.contact_phone);
      const askedPhone = contactPhone(updates.contact_phone);
      if (askedPhone && (askedPhone.length < 9 || askedPhone.length > 11)) {
        return Response.json({ error: "담당자 연락처의 자릿수를 확인해 주세요." }, { status: 400 });
      }

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
            guideline_files = ${updates.guideline_files === undefined ? (typeof c.guideline_files === "string" ? c.guideline_files : JSON.stringify(c.guideline_files ?? [])) : guidelineFiles(updates.guideline_files)}::jsonb,
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
            contact_person = ${nextPerson},
            contact_phone = ${nextPhone},
            contact_email = ${contactEmail(updates.contact_email) || contactEmail(c.contact_email)},
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
