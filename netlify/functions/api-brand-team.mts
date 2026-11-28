import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { requireSignedInUser } from "./_shared/user-auth.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { checkUsernameRules } from "./_shared/username-rules.mts";
import { usernameHasBlobLeftovers } from "./_shared/username-leftovers.mts";
import { redactSellerRecord } from "./_shared/seller-record.mts";
import {
  hasActiveBrandPlan,
  includedSeats,
  inviteSeatCapacity,
  paidExtraSeats,
  staffSeatCapacity,
  purchaseSeats,
  readSeatRecord,
  scheduleSeatCount,
  seatPlanSummary,
  settleStaleSeatCharge,
} from "./_shared/brand-seats.mts";
import {
  claimInvite,
  createInvite,
  findOpenInvite,
  insertMember,
  listTeam,
  releaseInvite,
  removeMember,
  revokeInvite,
  usedSeats,
} from "./_shared/brand-team.mts";

/**
 * 브랜드 팀원(직원 좌석) 관리.
 *
 *   · overview        좌석 · 직원 · 대기 중인 초대 (회사 계정 누구나 — 직원은 보기만)
 *   · create_invite   빈 좌석에 1회용 초대 링크 만들기 (관리자)
 *   · revoke_invite   초대 취소 → 좌석이 다시 빈다 (관리자)
 *   · remove_member   직원 내보내기 → 좌석이 다시 빈다, 추가 비용 없음 (관리자)
 *   · add_seats       직원 좌석 추가 결제(남은 기간 일할) (관리자)
 *   · schedule_seats  다음 결제일부터 좌석 줄이기 · 예약 취소 (관리자)
 *   · invite_info     초대 링크 확인 (로그인 없이)
 *   · join            초대 링크로 직원 계정 만들기 (로그인 없이)
 *
 * 역할은 회사 관리자(회사 아이디로 로그인한 계정 = 결제한 계정) / 직원 두 가지다.
 * 초대 · 내보내기 · 좌석 결제는 모두 회사 관리자만 한다.
 */

const SUPABASE_URL = "https://rjksilpewohjvtbxrsvu.supabase.co";

const admin = () => {
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
};

const fail = (status: number, error: string) => Response.json({ success: false, error }, { status });

const siteOrigin = (req: Request) =>
  (Netlify.env.get("URL") || "").replace(/\/+$/, "") || new URL(req.url).origin;

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;

async function usernameTaken(username: string): Promise<boolean | null> {
  try {
    const { data, error } = await admin().from("profiles").select("id").eq("username", username).maybeSingle();
    if (error) return null;
    if (data) return true;
    if (await usernameHasBlobLeftovers(username)) return true;
    const { getDatabase } = await import("@picks/netlify-database");
    const rows = await getDatabase().sql`SELECT 1 FROM site_data WHERE username = ${username} LIMIT 1`;
    return rows.length > 0;
  } catch {
    return null;
  }
}

async function companyName(company: string): Promise<string> {
  try {
    const { data } = await admin().from("profiles").select("full_name").eq("username", company).maybeSingle();
    return String(data?.full_name || "");
  } catch {
    return "";
  }
}

async function overview(company: string) {
  await settleStaleSeatCharge(company).catch(() => "busy");
  const record = await readSeatRecord(company);
  const extra = paidExtraSeats(record);
  const included = includedSeats(record);
  const capacity = staffSeatCapacity(record);
  const team = await listTeam(company, capacity);
  const used = team.members.length + team.invites.length;
  return {
    plan: seatPlanSummary(record),
    seats: {
      // 관리자 계정 1개는 멤버십에 들어 있다. 직원 좌석 = 등급 포함(그로스 1석) + 결제한 좌석.
      total: (hasActiveBrandPlan(record) ? 1 : 0) + capacity,
      included,
      extra,
      capacity,
      used,
      available: Math.max(0, inviteSeatCapacity(record) - used),
    },
    members: team.members,
    invites: team.invites,
    billingHistory: (Array.isArray(record?.billing_history) ? record!.billing_history : [])
      .filter((e: any) => e?.tier === "brand_campaign" || e?.tier === "brand_growth")
      .slice(0, 12),
  };
}

async function handleJoin(req: Request, body: any): Promise<Response> {
  const limited = await checkRateLimit({
    bucket: "brand-team-join",
    key: clientIp(req),
    limit: 10,
    windowSeconds: 3600,
    message: "가입 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  });
  if (!limited.ok) return limited.response;

  const token = String(body?.token || "").trim();
  const username = String(body?.username || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const name = String(body?.name || "").trim().slice(0, 40);

  const invite = await findOpenInvite(token);
  if (!invite) return fail(410, "만료됐거나 이미 사용한 초대 링크예요. 회사 관리자에게 새 링크를 요청해 주세요.");
  if (!hasActiveBrandPlan(await readSeatRecord(invite.company))) {
    return fail(409, "회사의 멤버십이 이용 중이 아니어서 지금은 가입할 수 없어요. 회사 관리자에게 문의해 주세요.");
  }
  if (!name) return fail(400, "이름을 입력해 주세요.");
  const rules = checkUsernameRules(username);
  if (!rules.ok) return fail(400, rules.error);
  if (!PASSWORD_RULE.test(password)) return fail(400, "비밀번호는 영문과 숫자를 섞어 8자 이상으로 만들어 주세요.");

  const taken = await usernameTaken(username);
  if (taken === null) return fail(503, "아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  if (taken) return fail(409, "이미 사용 중인 아이디입니다.");

  const supabase = admin();
  const email = `biz_${username}@picks.me`;
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { brand_team_member: true, company_username: invite.company, display_name: name },
  });
  if (createError || !created?.user) {
    if (String(createError?.message || "").includes("already been registered")) return fail(409, "이미 사용 중인 아이디입니다.");
    return fail(500, "계정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const userId = created.user.id;
  const rollbackUser = async () => {
    await supabase.from("profiles").delete().eq("id", userId).then(() => {}, () => {});
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
  };

  const { error: profileError } = await supabase.from("profiles").upsert(
    { id: userId, username, email, full_name: name, role: "operator" },
    { onConflict: "id" },
  );
  if (profileError) {
    await rollbackUser();
    return fail(500, "회원정보를 저장하지 못했습니다. 다시 시도해 주세요.");
  }

  const claimed = await claimInvite(token, userId).catch(() => null);
  if (!claimed) {
    await rollbackUser();
    return fail(410, "만료됐거나 이미 사용한 초대 링크예요. 회사 관리자에게 새 링크를 요청해 주세요.");
  }
  try {
    await insertMember({
      company: claimed.company,
      userId,
      username,
      displayName: name,
      inviteId: claimed.id,
    });
  } catch (e) {
    console.error("[api-brand-team] member insert failed:", (e as Error)?.message);
    await releaseInvite(claimed.id).catch(() => {});
    await rollbackUser();
    return fail(500, "팀에 들어가지 못했습니다. 다시 시도해 주세요.");
  }

  const { data: session } = await supabase.auth.signInWithPassword({ email, password });
  return Response.json({
    success: true,
    username: claimed.company,
    company_name: await companyName(claimed.company),
    role: "operator",
    team_role: "member",
    member_username: username,
    member_name: name,
    access_token: session?.session?.access_token || "",
    refresh_token: session?.session?.refresh_token || "",
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, "요청을 읽지 못했습니다.");
  }
  const action = String(body?.action || "");

  try {
    if (action === "invite_info") {
      const invite = await findOpenInvite(String(body?.token || "").trim());
      if (!invite) return fail(410, "만료됐거나 이미 사용한 초대 링크예요. 회사 관리자에게 새 링크를 요청해 주세요.");
      return Response.json({
        success: true,
        invite: {
          companyName: (await companyName(invite.company)) || invite.company,
          label: invite.label,
          expiresAt: invite.expiresAt,
        },
      });
    }
    if (action === "join") return await handleJoin(req, body);

    const auth = await requireSignedInUser(req);
    if (!auth.ok) return auth.response;
    if (!auth.teamRole || !auth.username) {
      return fail(403, "브랜드 회사 계정에서만 팀원을 관리할 수 있어요.");
    }
    const company = auth.username;
    const isOwner = auth.teamRole === "owner";
    const by = auth.memberUsername || company;

    if (action === "overview") {
      const view = await overview(company);
      return Response.json({
        success: true,
        viewer: { teamRole: auth.teamRole, memberUsername: auth.memberUsername || null },
        ...view,
        // 결제 내역은 결제한 회사 관리자에게만 보인다.
        billingHistory: isOwner ? view.billingHistory : [],
      });
    }

    if (!isOwner) return fail(403, "팀원 관리와 좌석 결제는 회사 관리자 계정에서만 할 수 있어요.");

    if (action === "create_invite") {
      const record = await readSeatRecord(company);
      if (!hasActiveBrandPlan(record)) return fail(403, "멤버십을 구독한 뒤에 직원을 초대할 수 있어요.");
      const created = await createInvite(company, inviteSeatCapacity(record), {
        label: body?.label,
        createdBy: by,
      });
      if (!created) return fail(409, "빈 좌석이 없어요. 좌석을 추가하거나 직원 · 초대를 정리해 주세요.");
      return Response.json({
        success: true,
        invite: created.invite,
        url: `${siteOrigin(req)}/business/join?invite=${encodeURIComponent(created.token)}`,
      });
    }

    if (action === "revoke_invite") {
      const ok = await revokeInvite(company, Number(body?.inviteId));
      if (!ok) return fail(404, "이미 사용했거나 취소된 초대예요.");
      return Response.json({ success: true });
    }

    if (action === "remove_member") {
      const memberId = Number(body?.memberId);
      const team = await listTeam(company, 0);
      const target = team.members.find((m) => m.id === memberId);
      if (!target) return fail(404, "이미 내보낸 직원이에요.");
      await removeMember(company, memberId, by);
      return Response.json({ success: true });
    }

    if (action === "add_seats") {
      const limited = await checkRateLimit({
        bucket: "brand-seat-purchase",
        key: company,
        limit: 10,
        windowSeconds: 3600,
        message: "좌석 결제를 너무 많이 시도했습니다. 잠시 후 다시 시도해 주세요.",
      });
      if (!limited.ok) return limited.response;
      const result = await purchaseSeats(company, Number(body?.count));
      if (!result.ok) return fail(result.status, result.error);
      return Response.json({
        success: true,
        chargedKrw: result.chargedKrw,
        record: redactSellerRecord(result.record),
        ...(await overview(company)),
      });
    }

    if (action === "schedule_seats") {
      const result = await scheduleSeatCount(company, Number(body?.seats), await usedSeats(company));
      if (!result.ok) return fail(result.status, result.error);
      return Response.json({ success: true, ...(await overview(company)) });
    }

    return fail(400, "알 수 없는 요청입니다.");
  } catch (e) {
    console.error("[api-brand-team] failed:", action, (e as Error)?.message);
    return fail(500, "팀원 정보를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
};

export const config: Config = {
  path: "/api/brand-team",
};
