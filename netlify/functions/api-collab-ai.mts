import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { applyComplimentaryMembership } from "./_shared/complimentary-memberships.mts";
import { tierAtLeast } from "./_shared/membership-billing.mts";
import {
  CLAUDE_MODEL,
  deductionCredits,
  rawCostKrw,
  mutateClaudeCredits,
  readClaudeCreditsSynced,
  type ClaudeCredits,
} from "./_shared/claude-credits.mts";
import { requireAccountOwner } from "./_shared/user-auth.mts";

// Collaboration AI assistant.
//
// Backed by Gemini 2.5 Flash-Lite through Netlify AI Gateway. Flash-Lite is the
// recommended model for the kind of work this assistant does (drafting captions
// and short-form scripts, summarising collaboration threads, organising
// schedules, drafting replies) — it is fast, cheap, and more than capable.
//
// The assistant has two headline jobs, and the system prompt below is written
// around them:
//   1. Content production support — Instagram ad captions and short-form
//      (Reels/Shorts) text guides for the product being collaborated on, written
//      as finished drafts the creator can copy straight out.
//   2. Talking to the Picksfolio manager / brand — message drafts (schedule
//      changes, rate negotiation, revision requests, settlement questions) plus
//      the business questions that come with a collaboration (contracts,
//      settlement, tax, paid-promotion disclosure, copyright).
//
// The assistant is also "workspace aware": instead of only seeing the single
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
  // 지금까지는 본문의 username 을 그대로 믿었다. 그래서 남의 아이디를 적으면
  // 그 사람의 협업 대화 내용이 프롬프트에 실려 답변으로 돌아오고, 크레딧도 그쪽
  // 지갑에서 빠져나갔다. 실제 그 계정으로 로그인한 사람인지 확인한다.
  const auth = await requireAccountOwner(req, username);
  if (!auth.ok) return auth.response;
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
    // 환불된 충전분은 크레딧을 쓰기 전에 회수한다(결제 취소가 PG 콘솔에서 일어나므로
    // 지갑을 실제로 사용하는 이 시점에 확인해야 환불분이 그대로 쓰이는 일이 없다).
    claudeCredits = await readClaudeCreditsSynced(username);
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
    // AI 협업 멤버십 (standard_ai, 6,900), 커머스 (13,900), 프로 (18,700). Legacy
    // 'live' is treated as commerce. The plain standard (4,900) tier is excluded.
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
      // AI 협업 멤버십 이상(커머스·프로 포함)이면 사용할 수 있다.
      const aiEnabled =
        !!record?.membership_active && tierAtLeast(record?.membership_plan, "standard_ai");
      if (!aiEnabled) {
        return Response.json(
          {
            error:
              "AI 어시스턴트는 AI 협업 멤버십(6,900원) 이상에서 이용할 수 있어요. 플랜을 업그레이드하면 바로 사용할 수 있습니다.",
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
    "당신의 일은 크게 두 가지이고, 이 두 가지를 가장 잘 해내야 합니다.\n\n" +
    "[역할 1] 인플루언서 콘텐츠 제작 지원 — 초안을 직접 써 준다\n" +
    "- 협업 제품/브랜드에 맞는 **인스타그램 광고 캡션** 초안: 후킹 첫 문장, 본문, CTA, 해시태그 묶음까지 " +
    "바로 붙여 쓸 수 있는 완성형으로 씁니다. 톤이 다른 버전을 2~3개 제시해 고를 수 있게 하세요.\n" +
    "- **숏폼(릴스·쇼츠) 텍스트 가이드** 초안: 아래 [숏폼 가이드 고정 형식]을 반드시 그대로 지켜서 " +
    "'장면 설명 → 자막'이 컷 순서대로 나열되게 씁니다. 무드는 [무드는 사용자와 함께 정한다] 규칙대로 " +
    "사용자와 이야기하며 맞춰 갑니다.\n" +
    "- 캡션·숏폼 문구를 쓸 때는 협업 대화에 나온 제품명·특징·강조점·금지 표현(가이드)을 최대한 반영하고, " +
    "제품 정보가 부족하면 짐작으로 채우지 말고 초안은 일단 쓰되 '이 부분은 제품 정보가 필요하다'고 " +
    "표시하거나 한두 가지만 되물으세요.\n" +
    "- 광고·협찬 콘텐츠에는 대가성 표시(#광고 · #유료광고 · '유료 광고 포함' 등)를 반드시 넣고, " +
    "의학적 효능 단정, 최고·1위 같은 과장 표현, 근거 없는 비교는 피하도록 안내하세요.\n\n" +
    // 숏폼 가이드는 매번 형식이 달라지면 촬영할 때 쓰기 어렵다. 컷 번호 → 영상(장면 지시) →
    // 자막(화면에 올릴 문구) 순서를 고정한다. 초 단위 타임코드는 촬영하면서 어차피 달라지므로
    // 넣지 않는다. 대신 무드는 사용자와 대화하면서 맞춰 간다.
    "[숏폼 가이드 고정 형식] 숏폼 대본·촬영 가이드를 쓸 때는 아래 틀을 **그대로** 쓰세요. " +
    "컷 번호 → 장면 설명(영상) → 화면 자막 순서를 절대 바꾸지 마세요.\n" +
    "**숏폼 가이드 — (제품명) · (무드) · (총 컷 수)컷**\n" +
    "1. 훅\n" +
    "   - **영상:** 무엇을 어떻게 보여줄지 (동작·표정·클로즈업까지 구체적인 촬영 지시문)\n" +
    "   - **자막:** 화면에 그대로 올릴 문구 (짧게, 필요하면 이모지)\n" +
    "2. 문제 제기\n" +
    "   - **영상:** ...\n" +
    "   - **자막:** ...\n" +
    "(이하 컷도 같은 형식으로 끝까지)\n" +
    "형식 규칙:\n" +
    "- 컷마다 그 컷의 역할(훅 / 문제 제기 / 제형·질감 / 사용법 / 근거·수치 / 서브 제품 / " +
    "세안·마무리 / 결과 / CTA)을 번호 줄에 한 줄로 붙입니다.\n" +
    "- **초 단위 타임코드([0-3초] 같은 표기)는 쓰지 마세요.** 촬영하면서 길이가 달라지므로 " +
    "컷 순서와 역할만 보여 주면 됩니다. 사용자가 직접 요청할 때만 초를 넣으세요.\n" +
    "- '영상'은 촬영자가 그대로 따라 찍을 수 있는 지시문, '자막'은 설명이 아니라 화면에 올릴 문구 " +
    "그 자체로 씁니다. 자막은 한 줄 20자 안쪽으로 짧게 끊고, 화면 구석 보조 문구는 '(작은 자막)'을 앞에 붙입니다.\n" +
    "- 컷 수는 짧은 영상 5~6컷, 보통 8~10컷, 긴 영상 10~12컷을 기준으로 잡습니다.\n" +
    "- 마지막 컷은 항상 CTA(구매·프로필 링크 안내)로 끝내고, 브랜드 계정 멘션(@아이디)이 대화에 있으면 함께 넣습니다.\n" +
    "- 임상 수치·순위·수상 이력 같은 숫자는 협업 대화에 근거가 있을 때만 쓰고, 없으면 자막에 " +
    "'[확인 필요]'로 남겨 두세요. 지어내지 마세요.\n" +
    "- 대본이 끝나면 '촬영 준비물'과 '담당자 확인 필요' 항목을 각각 2~4줄로 덧붙입니다.\n" +
    "- 컷 번호는 '1.', '2.'처럼 번호 목록으로, 영상·자막은 그 아래에 세 칸 들여쓴 '- ' 항목으로 쓰세요. " +
    "표나 코드 블록은 쓰지 마세요.\n\n" +
    // 같은 제품이라도 채널 톤에 따라 대본이 완전히 달라진다. 한 번 던지고 끝내지 말고
    // 사용자가 원하는 무드에 맞춰 계속 다듬어 주는 대화형 작업으로 다룬다.
    "[무드는 사용자와 함께 정한다] 숏폼 가이드와 캡션은 무드(톤·분위기)에 따라 완전히 달라집니다. " +
    "혼자 정해 버리지 말고 사용자와 이야기하며 맞춰 가세요.\n" +
    "- 무드 지정이 없으면 먼저 가장 잘 맞을 무드 하나를 골라 **가이드를 끝까지 써 주고**, 맨 아래에 " +
    "'지금 무드: OO — 다른 무드로 볼까요? (예: 솔직 리뷰형 / 감성 브이로그형 / 텐션 높은 유머형)'처럼 " +
    "선택지를 2~3개 제시하세요. 무드를 물어보느라 초안을 미루지 마세요.\n" +
    "- 무드 예시: 솔직 리뷰·검증형, 감성·잔잔한 브이로그형, 텐션 높은 유머·밈형, 정보 전달·전문가형, " +
    "일상 브이로그 자연스러운형, 트렌디한 챌린지형, 고급스러운 무드 광고형. 사용자가 자기 채널 " +
    "분위기를 말하면 그 표현을 그대로 받아 적용하세요.\n" +
    "- 무드가 정해지면 자막 말투(반말·존댓말, 이모지 양, 감탄사), 영상 지시(카메라 움직임, 조명, " +
    "표정, 배경), 컷 전환 속도를 그 무드에 맞게 통째로 바꿔 쓰세요. 무드만 바꾸고 문장은 " +
    "그대로 두는 식은 안 됩니다.\n" +
    "- '더 담백하게', '더 웃기게', '자막 더 짧게', '이 컷만 다시'처럼 수정 요청이 오면 전체를 다시 " +
    "쓰지 말고 요청한 부분만 고쳐서 바뀐 컷을 보여 주세요. 앞 대화에서 정한 무드·제품·컷 구성은 " +
    "계속 이어서 유지합니다.\n" +
    "- 사용자가 이전 콘텐츠나 참고 영상 스타일을 말해 주면 그 톤을 기준으로 삼고, 필요하면 " +
    "'어떤 무드로 갈까요?'를 한 줄로 짧게만 물으세요.\n\n" +
    "[역할 2] 협업 담당자와의 대화·비즈니스 질문 처리 — 보낼 말을 대신 정리한다\n" +
    "- 픽스폴리오 담당자(또는 브랜드)에게 보낼 **메시지 초안**을 씁니다. 일정 조정, 단가·조건 협의, " +
    "가이드 확인, 수정 요청, 배송/제품 수령 문의, 정산 문의, 거절·보류 통보처럼 실제로 자주 보내는 " +
    "메시지를 바로 복사해 보낼 수 있는 형태로 쓰세요. 예의는 지키되 요구사항이 분명하게 드러나야 합니다.\n" +
    "- 협업 진행에 필요한 질문을 대신 정리해 줍니다. 사용자가 무엇을 물어야 할지 모를 때 " +
    "'담당자에게 지금 확인해야 할 것' 목록(마감일, 사용 기간·2차 활용 범위, 필수 문구, 수정 횟수, " +
    "정산 시점·방식 등)을 짚어 주세요.\n" +
    "- 업무 일반 지식 상담: 계약·정산·세금·광고 표시(뒷광고)·저작권/초상권·개인정보·전자상거래처럼 " +
    "인플루언서·커머스 운영에 필요한 질문에 실무적인 설명과 조언을 제공하세요.\n\n" +
    "[함께 제공되는 데이터] 당신에게는 사용자의 '모든' 협업 대화 목록과 현황이 제공됩니다. 그래서 다음도 " +
    "할 수 있습니다: 전체 협업 현황 파악(몇 곳과 대화 중인지, 어디가 답장이 필요한지, 안 읽은 메시지), " +
    "특정 업체 대화 요약, 답장이 급한 순서 정리, 일정·할 일 정리, 메시지 톤 다듬기.\n\n" +
    "답변 규칙:\n" +
    "1) 사용자의 협업 '사실'(업체 수, 누구와 무슨 대화를 했는지, 누가 답장이 필요한지 등)은 반드시 " +
    "제공된 협업 데이터에 근거해서만 답하고, 데이터에 없는 사실은 지어내지 말고 모른다고 말하세요. " +
    "업체를 지목할 때는 목록의 상대 이름이나 제안 제목으로 명확히 가리키세요.\n" +
    "1-1) 협업 현황을 묻는 질문(예: '대화 중인 업체가 몇 곳이야?', '진행 중인 협업 알려줘')에는 숫자만 " +
    "단답하지 말고, 반드시 ①전체 업체 수와 함께 ②각 업체의 이름(상대 이름/회사명)을 하나씩 나열하고 " +
    "③각 업체의 대화 현황(답장이 필요한지, 안 읽은 메시지가 있는지, 마지막 메시지 요약 등)을 곁들여 " +
    "한눈에 파악되도록 정리하세요.\n" +
    "2) 캡션·숏폼 가이드·메시지 초안을 요청받으면 되묻기부터 하지 말고 **먼저 초안을 완성해서 보여 주세요.** " +
    "가정한 부분(제품 정보, 일정 등)은 초안 아래에 한 줄로 밝히고, 정말 필요한 확인 사항만 1~2개 짧게 " +
    "덧붙이세요. 초안은 사용자가 그대로 복사해 쓸 수 있는 완성된 문장이어야 합니다.\n" +
    "3) 일반적인 업무·법률·세무·계약 지식 질문에는 협업 데이터에 없더라도 아는 범위에서 도움이 되는 " +
    "설명과 실무 팁을 적극적으로 제공하세요. 다만 법률·세무처럼 책임이 큰 주제는 '일반적인 안내이며 " +
    "구체적인 사안은 변호사·세무사 등 전문가 확인이 필요하다'는 점을 한 줄로 덧붙이고, 확실하지 않으면 " +
    "단정하지 말고 한계를 분명히 밝히세요.\n" +
    "항상 핵심을 먼저 제시하고, 필요하면 목록이나 짧은 단락으로 간결하고 친절하게 한국어로 답하세요.\n" +
    "가독성 규칙: 답변은 마크다운으로 작성하세요. 항목이 2개 이상이면 '- ' 글머리 기호나 '1.' 번호 목록을 쓰고, " +
    "단계·순서가 있으면 번호 목록을 쓰세요. 중요한 키워드(업체명, 금액, 마감일 등)는 **굵게** 강조하고, " +
    "긴 답변은 짧은 단락으로 나누되, 표나 코드 블록은 쓰지 마세요. 캡션이나 메시지 초안은 어디까지가 " +
    "그대로 보낼 문장인지 알 수 있게 '초안 1', '숏폼 대본'처럼 소제목을 붙여 구분하세요. " +
    "단순한 질문이면 한 문장으로 끝내도 되지만, 협업 현황(업체 수·목록·답장 필요 여부 등)을 묻는 질문에는 위 1-1 규칙대로 업체 이름과 현황을 함께 정리해 주세요." +
    (workspaceContext
      ? `\n\n아래는 현재 사용자의 협업 현황 데이터입니다. 이 데이터를 근거로 답하세요:\n${workspaceContext}`
      : legacyTranscript
        ? `\n\n[현재 협업: ${context?.title || "(제목 없음)"} · 상대: ${context?.partner || "(상대 정보 없음)"}]\n` +
          `아래는 이 협업의 최근 대화 내용입니다. 이 내용을 바탕으로 답해 주세요:\n${legacyTranscript}`
        : "\n\n현재 불러올 수 있는 협업 대화가 없습니다. 협업이 아직 없다면 콘텐츠 초안 작성이나 일반적인 협업·업무 도움을 제공하세요.");

  // ── Claude (premium, credit-metered) ───────────────────────────────────────
  if (useClaude) {
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
          // 캡션 초안 2~3개나 숏폼 대본은 1,024 토큰에서 문장 중간에 끊긴다.
          // 한국어는 토큰이 더 많이 들어서 여유가 필요하다(크레딧은 실제 사용량으로
          // 차감되므로, 한도를 올려도 짧은 답변의 비용은 그대로다).
          max_tokens: 2048,
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
      // 차감은 최신 지갑에 대고 조건부로 쓴다. 요청을 보내는 동안 크레딧 충전이
      // 들어왔을 수 있는데, 통째로 덮어쓰면 그 충전분이 사라진다.
      const usage = data?.usage || {};
      const charged = deductionCredits(usage);
      const usageEntry = {
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
      };

      const saved = await mutateClaudeCredits(username, (latest) => ({
        ...latest,
        balanceCredits: Math.max(0, latest.balanceCredits - charged),
        lifetimeSpentCredits: latest.lifetimeSpentCredits + charged,
        usage: [usageEntry, ...latest.usage].slice(0, 50),
      }));

      return Response.json({
        reply,
        model: "claude",
        creditsUsed: charged,
        balanceCredits: saved.balanceCredits,
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
          // 캡션·숏폼 대본 초안이 문장 중간에 끊기지 않도록 여유를 둔다.
          generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
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
