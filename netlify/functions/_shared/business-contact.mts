/**
 * 브랜드 계정의 담당자 연락처.
 *
 * 캠페인을 올린 사람에게 연락할 방법이 담당자 화면 어디에도 없었다. 캠페인 행에는
 * `business_username` 과 `brand_name` 뿐이고, 그래서 담당자는 조건을 확정하거나
 * 일정을 물어볼 때마다 앱 안 대화만 쓰거나 운영자에게 계정을 물어봐야 했다.
 *
 * 연락처는 이미 있다. 비즈니스 가입에서 담당자명 · 이메일 · 연락처를 필수로 받고
 * (business-auth 의 signup), 그 값이 두 곳에 나뉘어 저장된다.
 *
 *   · Supabase `profiles`            : email · phone · full_name(회사명)
 *   · Supabase auth `user_metadata`  : contact_person · contact_email · contact_phone
 *
 * 담당자명(누구에게 전화하는지)은 metadata 에만 있어서 profiles 만 읽으면 "번호는
 * 아는데 누구 번호인지 모르는" 상태가 된다. 그래서 두 곳을 합쳐서 돌려준다.
 *
 * 옛 계정 · 메타데이터가 비어 있는 계정을 위해 마지막 수단으로 `proposals` 테이블을
 * 본다. 그 표에는 브랜드가 제안을 보낼 때 적은 연락처가 건마다 남아 있다. 가입
 * 시점 값보다 최신일 때도 있지만, 계정 정보를 덮어쓰지는 않는다 — 어디서 온 값인지
 * (`source`)를 함께 돌려주고 판단은 화면에 맡긴다.
 *
 * 이 값은 개인정보다. 목록 응답에 섞지 않고, 담당자가 캠페인 한 건을 열었을 때만
 * 따로 조회한다(api-manager-brand-contact). 브랜드·인플루언서 화면에는 나가지 않는다.
 */

const norm = (raw: unknown) =>
  String(raw || "").trim().toLowerCase().replace(/^biz\//, "");

const clean = (raw: unknown) => String(raw ?? "").trim();

export type BusinessContact = {
  businessUsername: string;
  companyName: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  /**
   * 값이 어디서 왔는지.
   *   "campaign"  = 캠페인을 등록할 때 브랜드가 적은 담당자 (가장 정확하다)
   *   "account"   = 가입 정보 (담당자 칸이 빈 옛 캠페인)
   *   "proposal"  = 제안에 적힌 연락처 (마지막 수단)
   */
  source: "campaign" | "account" | "proposal" | "none";
};

const empty = (businessUsername: string): BusinessContact => ({
  businessUsername,
  companyName: "",
  contactPerson: "",
  contactEmail: "",
  contactPhone: "",
  source: "none",
});

/**
 * 가입 정보에서 읽는다. Supabase 환경변수가 없는 환경(프리뷰)에서도 화면이 죽지
 * 않도록, 실패는 조용히 null 로 내린다 — 연락처가 안 보이는 것과 캠페인 화면이
 * 안 열리는 것은 무게가 다르다.
 */
async function fromAccount(businessUsername: string): Promise<BusinessContact | null> {
  try {
    const { getSupabaseServer } = await import("./supabase.mts");
    const supabase = getSupabaseServer();

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, full_name, email, phone")
      .eq("username", businessUsername)
      .maybeSingle();

    if (!profile) return null;

    // 담당자명은 auth metadata 에만 있다. 이 조회가 실패해도 profiles 에서 얻은
    // 이메일 · 번호는 그대로 쓴다.
    let meta: Record<string, unknown> = {};
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(String(profile.id));
      meta = (authUser?.user?.user_metadata as Record<string, unknown>) || {};
    } catch {}

    const contact: BusinessContact = {
      businessUsername,
      companyName: clean(meta.company_name) || clean(profile.full_name),
      contactPerson: clean(meta.contact_person),
      contactEmail: clean(meta.contact_email) || clean(profile.email),
      contactPhone: clean(meta.contact_phone) || clean(profile.phone),
      source: "account",
    };

    // 이름 · 이메일 · 번호가 모두 비어 있으면 계정에서 얻은 것이 없는 것과 같다.
    if (!contact.contactPerson && !contact.contactEmail && !contact.contactPhone) return null;
    return contact;
  } catch {
    return null;
  }
}

/**
 * 제안에 적힌 연락처에서 읽는다. 비어 있지 않은 값이 하나라도 있는 가장 최근
 * 제안을 고른다 — 최신 행부터 훑으면 연락처를 안 적은 건이 위에 있을 때 빈 값을
 * 집어 온다.
 */
async function fromProposals(businessUsername: string): Promise<BusinessContact | null> {
  try {
    const { getDatabase } = await import("@picks/netlify-database");
    const db = getDatabase();
    const rows = (await db.sql`
      SELECT company_name, contact_person, contact_email, contact_phone
      FROM proposals
      WHERE LOWER(COALESCE(business_username, '')) = ${businessUsername}
        AND (
          COALESCE(contact_person, '') <> ''
          OR COALESCE(contact_phone, '') <> ''
          OR COALESCE(contact_email, '') <> ''
        )
      ORDER BY created_at DESC
      LIMIT 1
    `) as any[];
    const row = rows?.[0];
    if (!row) return null;
    return {
      businessUsername,
      companyName: clean(row.company_name),
      contactPerson: clean(row.contact_person),
      contactEmail: clean(row.contact_email),
      contactPhone: clean(row.contact_phone),
      source: "proposal",
    };
  } catch {
    return null;
  }
}

export async function loadBusinessContact(rawUsername: unknown): Promise<BusinessContact> {
  const businessUsername = norm(rawUsername);
  if (!businessUsername) return empty("");

  const account = await fromAccount(businessUsername);
  if (account) return account;

  const proposal = await fromProposals(businessUsername);
  if (proposal) return proposal;

  return empty(businessUsername);
}

/**
 * 캠페인에 적힌 담당자를 계정 정보 위에 얹는다.
 *
 * 계정 정보를 버리지 않고 겹쳐 쓰는 이유: 캠페인 등록에서는 이름과 연락처만 필수로
 * 받고 이메일은 선택이다. 이메일이 비었다고 함께 지우면, 계정에 있는 주소로 자료를
 * 보낼 수 있었는데도 담당자 화면에는 아무 이메일도 남지 않는다.
 *
 * 반대로 이름과 번호는 캠페인 쪽이 이긴다. 계정의 가입자와 이 캠페인을 맡은 사람이
 * 다를 수 있고, 그 경우 담당자가 걸어야 하는 번호는 캠페인에 적힌 쪽이다.
 *
 * 이름만 있고 번호가 없는(또는 그 반대) 어중간한 캠페인 값은 섞지 않는다 — 캠페인의
 * 이름과 계정의 번호를 붙이면 "이 이름의 사람에게 이 번호로 전화한다"는 잘못된 조합이
 * 만들어진다. 등록 화면이 둘을 함께 필수로 받으므로 정상 경로에서는 생기지 않지만,
 * 컬럼이 추가되기 전에 만들어진 캠페인과 손으로 고친 행이 있을 수 있다.
 */
export function withCampaignContact(
  base: BusinessContact,
  campaign: { contact_person?: unknown; contact_phone?: unknown; contact_email?: unknown } | null,
): BusinessContact {
  const person = clean(campaign?.contact_person);
  const phone = clean(campaign?.contact_phone);
  if (!person || !phone) return base;

  return {
    ...base,
    contactPerson: person,
    contactPhone: phone,
    contactEmail: clean(campaign?.contact_email) || base.contactEmail,
    source: "campaign",
  };
}
