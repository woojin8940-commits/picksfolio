import { getDatabase } from "@picks/netlify-database";
import type { Config } from "@netlify/functions";
import { requireManager } from "./_shared/manager-auth.mts";
import { loadManagerContacts } from "./_shared/campaign-listup.mts";
import {
  KAKAO_CHANNEL_MESSAGE_MAX,
  phoneForUsername,
  sendKakaoChannelMessage,
} from "./_shared/kakao-message.mts";
import { checkRateLimit } from "./_shared/rate-limit.mts";

/**
 * 담당자 → 인플루언서 카카오톡 메시지. 픽스폴리오 카카오톡 채널 이름으로 나간다.
 *
 *   GET  ?username=..   보낼 수 있는 사람인지 확인. 창을 열 때 쓴다.
 *   POST { username, message }   보내기
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

async function recipientOf(username: string): Promise<{ phone: string }> {
  const fromAccount = String(await phoneForUsername(username)).replace(/\D/g, "");
  let phone = /^\d{10,11}$/.test(fromAccount) ? fromAccount : "";
  try {
    const contacts = await loadManagerContacts(getDatabase(), [username]);
    const card = contacts.get(username);
    if (!phone) {
      const entry = (card?.entries || []).find((e: any) => e?.kind === "phone");
      const digits = String(entry?.value || "").replace(/\D/g, "");
      if (/^\d{10,11}$/.test(digits)) phone = digits;
    }
  } catch (e) {
    console.error("[manager-kakao-message] contact lookup failed:", e);
  }
  return { phone };
}

export default async (req: Request) => {
  const manager = await requireManager(req);
  if (!manager.ok) return manager.response;

  if (req.method === "GET") {
    const username = norm(new URL(req.url).searchParams.get("username"));
    if (!username) {
      return Response.json({ error: "받는 사람을 지정해 주세요." }, { status: 400 });
    }
    const { phone } = await recipientOf(username);
    return Response.json({
      username,
      available: !!phone,
      maxLength: KAKAO_CHANNEL_MESSAGE_MAX,
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await req.json().catch(() => ({}))) as any;
  const username = norm(body?.username);
  const message = String(body?.message || "").trim();
  if (!username) {
    return Response.json({ error: "받는 사람을 지정해 주세요." }, { status: 400 });
  }
  if (!message) {
    return Response.json({ error: "보낼 내용을 적어 주세요." }, { status: 400 });
  }
  if (message.length > KAKAO_CHANNEL_MESSAGE_MAX) {
    return Response.json(
      { error: `메시지는 ${KAKAO_CHANNEL_MESSAGE_MAX}자까지 보낼 수 있습니다.` },
      { status: 400 },
    );
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

  const { phone } = await recipientOf(username);
  if (!phone) {
    return Response.json(
      { error: "이 인플루언서의 휴대폰 번호가 없어 메시지를 보낼 수 없습니다." },
      { status: 422 },
    );
  }

  const result = await sendKakaoChannelMessage({ phone, message });
  if (!result.success) {
    const error =
      result.error === "notification service not configured"
        ? "카카오톡 발송 설정(솔라피)이 되어 있지 않습니다."
        : "메시지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return Response.json({ error }, { status: 502 });
  }

  console.log(
    `[manager-kakao-message] ${manager.managerUsername} → ${username} (${result.type}, ${message.length}자)`,
  );
  return Response.json({ success: true, type: result.type });
};

export const config: Config = {
  path: "/api/manager-kakao-message",
};
