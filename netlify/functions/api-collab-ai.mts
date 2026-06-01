import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { applyComplimentaryMembership } from "./_shared/complimentary-memberships.mts";

// Collaboration AI assistant.
//
// Backed by Gemini 2.5 Flash-Lite through Netlify AI Gateway. Flash-Lite is the
// recommended model for the kind of work this assistant does (summarising a
// collaboration thread, organising schedules, drafting replies) — it is fast,
// cheap, and more than capable for lightweight summarisation/extraction.
//
// Two guard rails are enforced server-side so the feature stays safe and the
// operator's AI bill stays predictable:
//   1. Membership gate — only members on an AI-enabled plan may call the AI.
//      AI is bundled into the 스탠다드 AI 멤버십 (6,900) and the 커머스 멤버십
//      (13,900) tiers; the plain 스탠다드 (4,900) tier does NOT include it. The
//      check is keyed on the bare username (the `biz/` prefix is stripped
//      first), so business accounts and regular influencer accounts unlock it
//      through the exact same membership record. There is no separate business
//      membership.
//   2. Per-user daily quota — a soft cap stored in Blobs prevents a single heavy
//      user from running up the shared AI credit bill.
const MODEL = "gemini-2.5-flash-lite";
const DAILY_LIMIT = 100;
const MAX_CONTEXT_CHARS = 6000;
const MAX_TURNS = 12;

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const username = String(body?.username || "")
    .toLowerCase()
    .replace(/^biz\//, "");
  const messages: { role: string; content: string }[] = Array.isArray(body?.messages)
    ? body.messages
    : [];
  const context = body?.context || null;

  if (!username) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (messages.length === 0) {
    return Response.json({ error: "메시지가 비어 있습니다." }, { status: 400 });
  }

  // 1. Membership gate (same membership record for business and influencer accounts).
  //    AI is included only in the AI-enabled tiers: standard_ai (6,900) and
  //    commerce (13,900). Legacy 'live' is treated as commerce. The plain
  //    standard (4,900) tier is excluded.
  const sellerStore = getStore("seller-verification");
  const record = applyComplimentaryMembership(
    username,
    (await sellerStore.get(`seller_${username}`, { type: "json" })) as any,
  );
  const plan = record?.membership_plan;
  const aiEnabled =
    !!record?.membership_active &&
    (plan === "standard_ai" || plan === "commerce" || plan === "live");
  if (!aiEnabled) {
    return Response.json(
      {
        error:
          "AI 어시스턴트는 스탠다드 AI 멤버십(6,900원) 또는 커머스 멤버십에서 이용할 수 있어요. 플랜을 업그레이드하면 바로 사용할 수 있습니다.",
        code: "MEMBERSHIP_REQUIRED",
      },
      { status: 403 },
    );
  }

  // 2. Per-user daily soft quota
  const usageStore = getStore("ai-usage");
  const day = new Date().toISOString().slice(0, 10);
  const usageKey = `collab_${username}_${day}`;
  const used =
    ((await usageStore.get(usageKey, { type: "json" })) as { count?: number } | null)?.count || 0;
  if (used >= DAILY_LIMIT) {
    return Response.json(
      {
        error: "오늘 사용할 수 있는 AI 질문 횟수를 모두 사용했어요. 내일 다시 이용해 주세요.",
        code: "RATE_LIMITED",
      },
      { status: 429 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const baseUrl = process.env.GOOGLE_GEMINI_BASE_URL;
  if (!apiKey || !baseUrl) {
    return Response.json(
      { error: "AI 기능이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  const transcript = context?.transcript ? String(context.transcript).slice(-MAX_CONTEXT_CHARS) : "";
  const systemInstruction =
    "당신은 픽스폴리오(Picksfolio)의 인플루언서·비즈니스 협업을 돕는 한국어 AI 어시스턴트입니다. " +
    "협업 대화 요약, 일정·할 일 정리, 답장 메시지 초안 작성, 협상 포인트 정리를 도와주세요. " +
    "제공된 협업 대화 맥락만 근거로 답하고, 맥락에 없는 내용은 추측하지 말고 모른다고 답하세요. " +
    "항상 간결하고 친절한 한국어로, 핵심을 먼저 정리해 답하세요." +
    (transcript
      ? `\n\n[현재 협업: ${context?.title || "(제목 없음)"} · 상대: ${context?.partner || "(상대 정보 없음)"}]\n` +
        `아래는 이 협업의 최근 대화 내용입니다. 이 내용을 바탕으로 답해 주세요:\n${transcript}`
      : "\n\n현재 선택된 협업 대화가 없습니다. 일반적인 협업 도움을 제공하세요.");

  const contents = messages.slice(-MAX_TURNS).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }],
  }));

  try {
    const res = await fetch(`${baseUrl}/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[collab-ai] Gemini error", res.status, detail);
      return Response.json(
        { error: "AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }

    const data = await res.json();
    const reply: string =
      (data?.candidates?.[0]?.content?.parts || [])
        .map((p: any) => p?.text || "")
        .join("")
        .trim() || "죄송해요, 답변을 만들지 못했어요. 질문을 조금 더 구체적으로 적어 주세요.";

    // Record usage only after a successful response.
    await usageStore.setJSON(usageKey, { count: used + 1 });

    return Response.json({ reply, remaining: Math.max(0, DAILY_LIMIT - used - 1) });
  } catch (e) {
    console.error("[collab-ai] request failed", e);
    return Response.json(
      { error: "AI 응답 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/collab-ai",
};
