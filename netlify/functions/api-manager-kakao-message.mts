import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";
import { loadManagerContacts } from "./_shared/campaign-listup.mts";
import { phoneForUsername, sendKakaoAlimtalk } from "./_shared/kakao-message.mts";
import {
  campaignProposalAlimtalk,
  contactRequestAlimtalk,
  contactRequestEnabled,
} from "./_shared/alimtalk-templates.mts";
import { checkRateLimit } from "./_shared/rate-limit.mts";

/**
 * 담당자 → 인플루언서 연락 요청 알림톡. 픽스폴리오 카카오톡 채널 이름으로 나간다.
 *
 *   GET                 연락 요청을 쓸 수 있는지(템플릿 승인 여부). 버튼을 그릴지 정한다.
 *   GET  ?username=..   보낼 수 있는 사람인지 확인.
 *   POST { username }   보내기
 *   POST { username, kind: "proposal", campaignId, brand, campaignTitle,
 *          uploadSchedule, contentType }
 *                       광고 협업 제안 알림톡 보내기 (후보 풀의 "제안하기")
 *
 * 처음에는 담당자가 쓴 자유 문장을 브랜드 메시지로 보냈다. 그런데 브랜드 메시지는
 * 채널 친구에게만 닿아서 대부분 문자로 떨어졌다. 그래서 정해진 문구의 알림톡
 * ("메시지를 보내 주세요")만 보내고, 인플루언서가 그 채팅방에 먼저 말을 걸면
 * 담당자는 채널 관리자센터에서 자유롭게 이어 간다.
 *
 * 인플루언서 로그인이 카카오로만 되면서 담당자 화면의 "카톡 아이디 미등록"은 뜻이
 * 없어졌다 — 연락은 아이디를 찾아 친구 추가하는 방식이 아니라 채널에서 바로 보내는
 * 방식이어야 한다. 받는 번호는 화면에 그대로 내려 보내지 않는다. 담당자가 고르는 것은
 * 사람이고, 번호는 서버가 찾는다.
 *
 * 번호는 계정(profiles.phone)을 먼저 본다. 카카오 로그인 때 받은 번호라 본인 번호다.
 * 없으면 등록서·지원서에 적어 낸 전화번호로 내려간다(loadManagerContacts).
 */

const norm = (raw: unknown) => String(raw || "").trim().toLowerCase().replace(/^@/, "");

async function recipientOf(username: string): Promise<{ phone: string; name: string }> {
  const fromAccount = String(await phoneForUsername(username)).replace(/\D/g, "");
  let phone = /^\d{10,11}$/.test(fromAccount) ? fromAccount : "";
  let name = "";
  try {
    const contacts = await loadManagerContacts(getDatabase(), [username]);
    const card = contacts.get(username);
    name = String(card?.name || "").trim();
    if (!phone) {
      const entry = (card?.entries || []).find((e: any) => e?.kind === "phone");
      const digits = String(entry?.value || "").replace(/\D/g, "");
      if (/^\d{10,11}$/.test(digits)) phone = digits;
    }
  } catch (e) {
    console.error("[manager-kakao-message] contact lookup failed:", e);
  }
  return { phone, name };
}

export default async (req: Request) => {
  const manager = await requireManager(req);
  if (!manager.ok) return manager.response;

  if (req.method === "GET") {
    const username = norm(new URL(req.url).searchParams.get("username"));
    if (!username) return Response.json({ enabled: contactRequestEnabled() });
    const { phone } = await recipientOf(username);
    return Response.json({
      username,
      enabled: contactRequestEnabled(),
      available: !!phone,
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await req.json().catch(() => ({}))) as any;
  const isProposal = body?.kind === "proposal";

  if (!isProposal && !contactRequestEnabled()) {
    return Response.json(
      { error: "연락 요청 알림톡 템플릿이 아직 승인되지 않았습니다." },
      { status: 503 },
    );
  }

  const username = norm(body?.username);
  if (!username) {
    return Response.json({ error: "받는 사람을 지정해 주세요." }, { status: 400 });
  }

  // 발송은 건마다 요금이 나간다. 담당자 한 명이 실수로 같은 창에서 여러 번 누르거나
  // 계정이 새어 나갔을 때 문자 폭탄이 되지 않도록 담당자 단위로 묶는다.
  const limited = await checkRateLimit({
    bucket: "manager-kakao-message",
    key: manager.managerUsername || "manager",
    limit: 60,
    windowSeconds: 60 * 60,
    message: "한 시간에 보낼 수 있는 메시지 수를 넘었습니다. 잠시 후 다시 시도해 주세요.",
  });
  if (!limited.ok) return limited.response;

  const { phone, name } = await recipientOf(username);
  if (!phone) {
    return Response.json(
      { error: "이 인플루언서의 휴대폰 번호가 없어 메시지를 보낼 수 없습니다." },
      { status: 422 },
    );
  }

  // 같은 사람에게 연달아 누르면 같은 알림톡이 여러 통 쌓인다. 제안은 캠페인마다
  // 따로 세어, 다른 캠페인으로 같은 사람에게 제안하는 것은 막지 않는다.
  const campaignId = String(body?.campaignId || "").trim().slice(0, 100);
  const repeated = await checkRateLimit({
    bucket: isProposal ? "manager-kakao-proposal" : "manager-kakao-contact-request",
    key: `${manager.managerUsername || "manager"}:${username}${isProposal ? `:${campaignId}` : ""}`,
    limit: 1,
    windowSeconds: 10 * 60,
    message: isProposal
      ? "이 인플루언서에게는 방금 이 캠페인 제안을 보냈습니다. 잠시 후 다시 시도해 주세요."
      : "이 인플루언서에게는 방금 연락 요청을 보냈습니다. 잠시 후 다시 시도해 주세요.",
  });
  if (!repeated.ok) return repeated.response;

  const template = isProposal
    ? campaignProposalAlimtalk({
        brand: body?.brand,
        campaignTitle: body?.campaignTitle,
        uploadSchedule: body?.uploadSchedule,
        contentType: body?.contentType,
      })
    : contactRequestAlimtalk({ influencer: name || username });
  const result = await sendKakaoAlimtalk({ phone, ...template });
  if (result.success && result.paused) {
    return Response.json(
      { error: "지금은 알림톡 발송이 잠시 중지되어 있습니다." },
      { status: 503 },
    );
  }
  if (!result.success) {
    const error =
      result.error === "notification service not configured"
        ? "카카오톡 발송 설정(솔라피)이 되어 있지 않습니다."
        : "메시지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return Response.json({ error }, { status: 502 });
  }

  console.log(
    `[manager-kakao-message] ${manager.managerUsername} → ${username} ${
      isProposal ? `협업 제안 ${campaignId}` : "연락 요청"
    } (${result.type})`,
  );
  return Response.json({ success: true, type: result.type });
};

export const config: Config = {
  path: "/api/manager-kakao-message",
};
