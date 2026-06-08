import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { applyComplimentaryMembership } from "./_shared/complimentary-memberships.mts";
import {
  CLAUDE_MODEL,
  AUTO_RECHARGE_THRESHOLD_CREDITS,
  AUTO_RECHARGE_DAILY_CAP,
  chargeBillingKey,
  creditsForKrw,
  deductionCredits,
  rawCostKrw,
  readClaudeCredits,
  writeClaudeCredits,
  type ClaudeCredits,
} from "./_shared/claude-credits.mts";

// Collaboration AI assistant.
//
// Backed by Gemini 2.5 Flash-Lite through Netlify AI Gateway. Flash-Lite is the
// recommended model for the kind of work this assistant does (summarising
// collaboration threads, organising schedules, drafting replies) — it is fast,
// cheap, and more than capable for lightweight summarisation/extraction.
//
// The assistant is "workspace aware": instead of only seeing the single
// conversation the user is currently looking at, it is given a compact overview
// of EVERY collaboration thread the account has (how many partners, which ones
// are waiting on a reply, recent messages of each, plus a deeper transcript of
// the conversation in focus). That lets it answer cross-conversation questions
// such as "how many companies am I talking to?", "which collaborations need a
// reply?", or "draft a reply to <company>" — not just summarise one thread.
//
// Two guard rails are enforced server-side so the feature stays safe and the
// operator's AI bill stays predictable:
//   1. Membership gate — for influencer accounts, only members on an AI-enabled
//      plan may call the AI. AI is bundled into the 스탠다드 AI 멤버십 (6,900) and
//      the 커머스 멤버십 (13,900) tiers; the plain 스탠다드 (4,900) tier does NOT
//      include it. Business (company) accounts are exempt from this gate — the AI
//      assistant is part of their collaboration workspace — and reach the AI
//      through the same endpoint with `userType: "business"`.
//   2. Per-user daily quota — a soft cap stored in Blobs prevents a single heavy
//      user (business or influencer) from running up the shared AI credit bill.
const MODEL = "gemini-2.5-flash-lite";
const DAILY_LIMIT = 100;
const MAX_CONTEXT_CHARS = 6000;
const MAX_TURNS = 12;

// Workspace overview bounds — keep the assembled context predictable in size.
const WORKSPACE_MAX_CONVERSATIONS = 30; // most-recent conversations pulled into context
const OTHER_CONV_MSGS = 5; // recent messages summarised per non-focused conversation
const OTHER_CONV_CHARS = 600; // char cap on each non-focused transcript
const ACTIVE_CONV_MSGS = 30; // recent messages for the conversation in focus
const ACTIVE_CONV_CHARS = 3500; // char cap on the focused transcript
const WORKSPACE_CONTEXT_CHARS = 12000; // overall cap on the assembled overview

interface CollabComment {
  authorType?: string;
  authorName?: string;
  authorUsername?: string;
  content?: string;
  createdAt?: string;
  attachments?: unknown[];
}

interface CollabMeta {
  proposalId: string;
  influencerUsername?: string;
  businessUsername?: string;
  companyName?: string;
  proposalTitle?: string;
  createdAt?: string;
}

const oneLine = (s: string, max = 80) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
};

const relTime = (dateStr?: string) => {
  if (!dateStr) return "";
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  if (h < 24) return `${h}시간 전`;
  if (d < 7) return `${d}일 전`;
  return new Date(t).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
};

const roleLabel = (authorType?: string) => (authorType === "business" ? "비즈니스" : "인플루언서");

const previewOf = (c?: CollabComment) => {
  if (!c) return "";
  if (c.content) return oneLine(c.content, 70);
  if (Array.isArray(c.attachments) && c.attachments.length > 0)
    return `[첨부 파일 ${c.attachments.length}개]`;
  return "[빈 메시지]";
};

const transcriptOf = (comments: CollabComment[], maxMsgs: number, maxChars: number) => {
  const recent = comments.slice(-maxMsgs);
  let s = recent
    .map((c) => {
      const text = c.content
        ? c.content
        : Array.isArray(c.attachments) && c.attachments.length > 0
          ? `[첨부 파일 ${c.attachments.length}개]`
          : "[빈 메시지]";
      return `    ${c.authorName || "(이름 없음)"}(${roleLabel(c.authorType)}): ${oneLine(text, 240)}`;
    })
    .join("\n");
  if (s.length > maxChars) s = "    …(이전 생략)\n" + s.slice(-maxChars);
  return s;
};

// Assemble a compact, workspace-wide context string covering all of the user's
// collaboration threads. Conversation metadata can be supplied by the client
// (the list it already renders); transcripts are always read from the canonical
// `timelines` Blobs store so the AI sees real message content.
async function buildWorkspaceContext(
  username: string,
  userType: string,
  activeProposalId: string,
  clientTimelines: CollabMeta[],
): Promise<string | null> {
  const store = getStore("timelines");

  let list: CollabMeta[] =
    Array.isArray(clientTimelines) && clientTimelines.length > 0 ? clientTimelines : [];
  if (list.length === 0) {
    const idx = (await store
      .get(`index_${userType}_${username}`, { type: "json" })
      .catch(() => null)) as CollabMeta[] | null;
    list = Array.isArray(idx) ? idx : [];
  }
  if (list.length === 0) return null;

  // De-duplicate by proposalId, most-recent first, then cap.
  const seen = new Set<string>();
  const ordered = [...list]
    .filter((t) => t && t.proposalId && !seen.has(t.proposalId) && seen.add(t.proposalId))
    .sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );
  const totalCount = ordered.length;
  const capped = ordered.slice(0, WORKSPACE_MAX_CONVERSATIONS);

  const details = await Promise.all(
    capped.map((t) =>
      store.get(`detail_${t.proposalId}`, { type: "json" }).catch(() => null),
    ),
  );

  let needReplyCount = 0;
  let unreadConvCount = 0;

  const blocks: string[] = [];
  let activeBlock = "";

  capped.forEach((meta, i) => {
    const detail = (details[i] || {}) as { comments?: CollabComment[] };
    const comments = Array.isArray(detail.comments) ? detail.comments : [];
    const partner =
      userType === "business"
        ? meta.influencerUsername || "(상대 정보 없음)"
        : meta.companyName || meta.businessUsername || "(상대 정보 없음)";
    const title = meta.proposalTitle || "(제목 없음)";
    const last = comments[comments.length - 1];
    const lastFromOther =
      !!last && (last.authorUsername || "").toLowerCase() !== username;

    // Incoming-unread is computed from each message's readBy list.
    const unread = comments.filter((c) => {
      const isIncoming = (c.authorUsername || "").toLowerCase() !== username;
      const readBy = Array.isArray((c as any).readBy)
        ? ((c as any).readBy as string[]).map((r) => String(r).toLowerCase())
        : [];
      return isIncoming && !readBy.includes(username);
    }).length;

    if (lastFromOther) needReplyCount++;
    if (unread > 0) unreadConvCount++;

    const isActive = !!activeProposalId && meta.proposalId === activeProposalId;
    const header =
      `${i + 1}. ${partner} — 제안 "${title}"${isActive ? " (지금 보고 있는 협업)" : ""}\n` +
      `   메시지 ${comments.length}개 · 안 읽음 ${unread}개 · ${lastFromOther ? "⚠ 답장 필요" : "답장 완료"}\n` +
      `   마지막: ${last ? `${last.authorName}(${roleLabel(last.authorType)}) "${previewOf(last)}" (${relTime(last.createdAt)})` : "메시지 없음"}`;

    if (isActive) {
      activeBlock =
        `\n\n[지금 보고 있는 협업 상세]\n` +
        `상대: ${partner} · 제안: "${title}"\n` +
        `최근 대화:\n${transcriptOf(comments, ACTIVE_CONV_MSGS, ACTIVE_CONV_CHARS)}`;
      blocks.push(header);
    } else if (comments.length > 0) {
      blocks.push(
        header + `\n   최근 대화:\n${transcriptOf(comments, OTHER_CONV_MSGS, OTHER_CONV_CHARS)}`,
      );
    } else {
      blocks.push(header);
    }
  });

  const overview =
    `[협업 워크스페이스 현황 — ${userType === "business" ? "비즈니스" : "인플루언서"} 계정: ${username}]\n` +
    `- 진행 중인 협업(업체) 수: ${totalCount}개${totalCount > capped.length ? ` (아래 목록은 최근 ${capped.length}개)` : ""}\n` +
    `- 상대의 마지막 메시지에 아직 답장하지 않은 협업: ${needReplyCount}개\n` +
    `- 안 읽은 수신 메시지가 있는 협업: ${unreadConvCount}개`;

  // Assemble within the overall char budget; the focused conversation detail is
  // appended last so it is never dropped.
  let body = `\n\n[협업 목록 (최근 활동순)]\n`;
  for (const b of blocks) {
    if (body.length + b.length > WORKSPACE_CONTEXT_CHARS) {
      body += "\n…(이후 협업 생략)";
      break;
    }
    body += b + "\n\n";
  }

  return overview + body + activeBlock;
}

// Top up the Claude wallet via the stored billing key when the balance has fallen
// below the auto-recharge threshold and the member opted in. Enforces a per-day cap
// so a runaway loop can never run unbounded charges. Fails soft: on any problem the
// wallet is returned unchanged and the member is steered to manual recharge instead.
async function maybeAutoRecharge(
  username: string,
  credits: ClaudeCredits,
): Promise<{ credits: ClaudeCredits; recharged: boolean }> {
  if (!credits.autoRecharge || !credits.billingKey) return { credits, recharged: false };
  if (credits.balanceCredits >= AUTO_RECHARGE_THRESHOLD_CREDITS) return { credits, recharged: false };

  const today = new Date().toISOString().slice(0, 10);
  const countToday = credits.autoRechargeDay === today ? credits.autoRechargeCountToday : 0;
  if (countToday >= AUTO_RECHARGE_DAILY_CAP) return { credits, recharged: false };

  const amount = credits.autoRechargeAmountKrw;
  const charge = await chargeBillingKey(username, credits.billingKey, amount);
  if (!charge.success) {
    console.error("[collab-ai] auto-recharge failed", charge.error);
    return { credits, recharged: false };
  }

  // The member is charged `amount` ₩; the wallet gains the equivalent credits.
  const grantedCredits = creditsForKrw(amount);
  credits.balanceCredits += grantedCredits;
  credits.lifetimeChargedKrw += amount;
  credits.autoRechargeDay = today;
  credits.autoRechargeCountToday = countToday + 1;
  credits.grants = [
    {
      at: new Date().toISOString(),
      amountKrw: amount,
      credits: grantedCredits,
      kind: "auto" as const,
      paymentId: charge.paymentId,
    },
    ...credits.grants,
  ].slice(0, 100);
  return { credits, recharged: true };
}

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
  const userType = body?.userType === "business" ? "business" : "influencer";
  const activeProposalId = String(body?.activeProposalId || "");
  const clientTimelines: CollabMeta[] = Array.isArray(body?.timelines) ? body.timelines : [];
  // Which model to answer with. Gemini (default) is bundled into the AI memberships;
  // Claude is the optional premium model gated on the separately-purchased Claude plan.
  const useClaude = body?.model === "claude";

  if (!username) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (messages.length === 0) {
    return Response.json({ error: "메시지가 비어 있습니다." }, { status: 400 });
  }

  // Gating differs by model:
  //  • Gemini (default) — bundled into the AI memberships; requires an AI-enabled
  //    membership and is limited by a per-user daily soft quota.
  //  • Claude — the optional premium model; requires an active, separately-purchased
  //    Claude plan with credit balance. Independent of the membership tier, so a
  //    member can use Claude even without an AI membership.
  let claudeCredits: ClaudeCredits | null = null;
  let usageStore: ReturnType<typeof getStore> | null = null;
  let usageKey = "";
  let used = 0;

  if (useClaude) {
    claudeCredits = await readClaudeCredits(username);
    if (!claudeCredits.planActive) {
      return Response.json(
        {
          error:
            "클로드(Claude)는 클로드 플랜 전용 기능이에요. 클로드 플랜을 시작하면 기본 크레딧이 지급되어 바로 사용할 수 있습니다.",
          code: "CLAUDE_PLAN_REQUIRED",
        },
        { status: 403 },
      );
    }
    // A depleted wallet can be revived by auto-recharge before the request runs.
    if (claudeCredits.balanceCredits <= 0) {
      const r = await maybeAutoRecharge(username, claudeCredits);
      claudeCredits = r.credits;
      if (r.recharged) await writeClaudeCredits(username, claudeCredits);
    }
    if (claudeCredits.balanceCredits <= 0) {
      return Response.json(
        {
          error:
            "클로드 크레딧을 모두 사용했어요. 크레딧을 충전하면 계속 이용할 수 있습니다. (제미나이는 그대로 무료로 사용할 수 있어요.)",
          code: "CLAUDE_CREDITS_EMPTY",
        },
        { status: 402 },
      );
    }
    if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_BASE_URL) {
      return Response.json(
        { error: "클로드 기능이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }
  } else {
    // Gemini membership gate. AI is included only in the AI-enabled tiers:
    // standard_ai (6,900) and commerce (13,900). Legacy 'live' is treated as
    // commerce. The plain standard (4,900) tier is excluded.
    //
    // Business (company) accounts are exempt from this gate — the AI assistant is
    // part of their collaboration workspace, not an influencer membership add-on.
    // They are still bounded by the per-user daily quota below.
    if (userType !== "business") {
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
    }

    // Per-user daily soft quota (Gemini only — Claude is bounded by its wallet).
    usageStore = getStore("ai-usage");
    usageKey = `collab_${username}_${new Date().toISOString().slice(0, 10)}`;
    used =
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

    if (!process.env.GEMINI_API_KEY || !process.env.GOOGLE_GEMINI_BASE_URL) {
      return Response.json(
        { error: "AI 기능이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 },
      );
    }
  }

  // Build the workspace-wide overview (all conversations). Falls back to the
  // legacy single-conversation transcript the client used to send when the
  // overview cannot be assembled.
  let workspaceContext: string | null = null;
  try {
    workspaceContext = await buildWorkspaceContext(
      username,
      userType,
      activeProposalId,
      clientTimelines,
    );
  } catch (e) {
    console.error("[collab-ai] failed to build workspace context", e);
  }

  const legacyTranscript = context?.transcript
    ? String(context.transcript).slice(-MAX_CONTEXT_CHARS)
    : "";

  const systemInstruction =
    "당신은 픽스폴리오(Picksfolio)의 인플루언서·비즈니스 협업을 돕는 유능한 한국어 AI 업무 비서입니다. " +
    "당신에게는 사용자의 '모든' 협업 대화 목록과 현황이 제공됩니다. 따라서 다음과 같은 일을 도울 수 있습니다:\n" +
    "- 전체 현황 파악: 지금 대화 중인 업체(협업)가 몇 곳인지, 어떤 협업이 답장이 필요한지, 안 읽은 메시지가 있는지 알려주기\n" +
    "- 특정 업체 대응: 사용자가 언급한 업체와의 대화를 찾아 요약하고, 그 업체에 보낼 답장 초안을 작성하기\n" +
    "- 우선순위 제안: 먼저 답해야 할 협업, 마감/일정이 임박한 협업을 정리해 주기\n" +
    "- 일정·할 일 정리, 협상 포인트 정리, 메시지 톤 다듬기\n" +
    "- 업무 일반 지식 상담: 협업 데이터에 없는 주제라도 인플루언서·커머스 비즈니스 운영에 필요한 " +
    "계약·정산·세금·광고 표시(뒷광고)·저작권/초상권·개인정보·전자상거래 등 법적·업무적 질문에 " +
    "당신의 일반 지식으로 실무적인 설명과 조언을 제공하기\n" +
    "답변 규칙:\n" +
    "1) 사용자의 협업 '사실'(업체 수, 누구와 무슨 대화를 했는지, 누가 답장이 필요한지 등)은 반드시 " +
    "제공된 협업 데이터에 근거해서만 답하고, 데이터에 없는 사실은 지어내지 말고 모른다고 말하세요. " +
    "업체를 지목할 때는 목록의 상대 이름이나 제안 제목으로 명확히 가리키세요.\n" +
    "1-1) 협업 현황을 묻는 질문(예: '대화 중인 업체가 몇 곳이야?', '진행 중인 협업 알려줘')에는 숫자만 " +
    "단답하지 말고, 반드시 ①전체 업체 수와 함께 ②각 업체의 이름(상대 이름/회사명)을 하나씩 나열하고 " +
    "③각 업체의 대화 현황(답장이 필요한지, 안 읽은 메시지가 있는지, 마지막 메시지 요약 등)을 곁들여 " +
    "한눈에 파악되도록 정리하세요. 사용자가 묻지 않았더라도 바로 다음 행동을 정할 수 있게 핵심 현황을 " +
    "먼저 챙겨서 알려 주세요. 예를 들어 업체가 2곳이면 '총 2곳'이라고만 하지 말고 두 업체의 이름과 " +
    "각각의 답장 필요 여부까지 함께 제시하세요.\n" +
    "2) 반면 일반적인 업무·법률·세무·계약 지식 질문에는 협업 데이터에 없더라도 당신이 아는 범위에서 " +
    "도움이 되는 설명과 실무 팁을 적극적으로 제공하세요. 다만 법률·세무처럼 책임이 큰 주제는 " +
    "'일반적인 안내이며 구체적인 사안은 변호사·세무사 등 전문가 확인이 필요하다'는 점을 한 줄로 덧붙이고, " +
    "확실하지 않으면 단정하지 말고 한계를 분명히 밝히세요.\n" +
    "항상 핵심을 먼저 제시하고, 필요하면 목록이나 짧은 단락으로 간결하고 친절하게 한국어로 답하세요.\n" +
    "가독성 규칙: 답변은 마크다운으로 작성하세요. 항목이 2개 이상이면 '- ' 글머리 기호나 '1.' 번호 목록을 쓰고, " +
    "단계·순서가 있으면 번호 목록을 쓰세요. 중요한 키워드(업체명, 금액, 마감일 등)는 **굵게** 강조하고, " +
    "긴 답변은 짧은 단락으로 나누되, 표나 코드 블록은 쓰지 마세요. 단순한 질문이면 한 문장으로 끝내도 되지만, 협업 현황(업체 수·목록·답장 필요 여부 등)을 묻는 질문에는 위 1-1 규칙대로 업체 이름과 현황을 함께 정리해 주세요." +
    (workspaceContext
      ? `\n\n아래는 현재 사용자의 협업 현황 데이터입니다. 이 데이터를 근거로 답하세요:\n${workspaceContext}`
      : legacyTranscript
        ? `\n\n[현재 협업: ${context?.title || "(제목 없음)"} · 상대: ${context?.partner || "(상대 정보 없음)"}]\n` +
          `아래는 이 협업의 최근 대화 내용입니다. 이 내용을 바탕으로 답해 주세요:\n${legacyTranscript}`
        : "\n\n현재 불러올 수 있는 협업 대화가 없습니다. 협업이 아직 없다면 일반적인 협업·업무 도움을 제공하세요.");

  // ── Claude (premium, credit-metered) ───────────────────────────────────────
  if (useClaude) {
    const credits = claudeCredits as ClaudeCredits;
    // Anthropic message format. The large system instruction (role + workspace
    // overview) is sent as a cached block, so repeat turns within ~5 minutes are
    // billed at the discounted cache-read rate — the saving is passed through to
    // the member's credit deduction, keeping long conversations cheap.
    const claudeMessages = messages.slice(-MAX_TURNS).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }));

    try {
      const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY as string,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          temperature: 0.6,
          system: [
            { type: "text", text: systemInstruction, cache_control: { type: "ephemeral" } },
          ],
          messages: claudeMessages,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error("[collab-ai] Claude error", res.status, detail);
        return Response.json(
          { error: "클로드 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." },
          { status: 502 },
        );
      }

      const data = await res.json();
      const reply: string =
        (data?.content || [])
          .map((p: any) => (p?.type === "text" ? p.text || "" : ""))
          .join("")
          .trim() || "죄송해요, 답변을 만들지 못했어요. 질문을 조금 더 구체적으로 적어 주세요.";

      // Deduct credits based on the tokens actually consumed, then (if opted in
      // and the balance is now low) auto-recharge for the next request.
      const usage = data?.usage || {};
      const charged = deductionCredits(usage);
      credits.balanceCredits = Math.max(0, credits.balanceCredits - charged);
      credits.lifetimeSpentCredits += charged;
      credits.usage = [
        {
          at: new Date().toISOString(),
          model: CLAUDE_MODEL,
          inputTokens:
            (Number(usage.input_tokens) || 0) +
            (Number(usage.cache_creation_input_tokens) || 0) +
            (Number(usage.cache_read_input_tokens) || 0),
          outputTokens: Number(usage.output_tokens) || 0,
          cachedTokens: Number(usage.cache_read_input_tokens) || 0,
          costKrw: Math.round(rawCostKrw(usage)),
          chargedCredits: charged,
        },
        ...credits.usage,
      ].slice(0, 50);

      const after = await maybeAutoRecharge(username, credits);
      await writeClaudeCredits(username, after.credits);

      return Response.json({
        reply,
        model: "claude",
        creditsUsed: charged,
        balanceCredits: after.credits.balanceCredits,
        autoRecharged: after.recharged,
      });
    } catch (e) {
      console.error("[collab-ai] claude request failed", e);
      return Response.json(
        { error: "AI 응답 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 500 },
      );
    }
  }

  // ── Gemini (default, membership-bundled) ───────────────────────────────────
  const contents = messages.slice(-MAX_TURNS).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }],
  }));

  try {
    const res = await fetch(
      `${process.env.GOOGLE_GEMINI_BASE_URL}/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY as string,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
        }),
      },
    );

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
    if (usageStore) await usageStore.setJSON(usageKey, { count: used + 1 });

    return Response.json({ reply, model: "gemini", remaining: Math.max(0, DAILY_LIMIT - used - 1) });
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
