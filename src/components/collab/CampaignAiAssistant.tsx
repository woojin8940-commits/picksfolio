import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiService, authHeaders } from '../../services/apiService';
import { membershipCovers } from '../../utils/membershipTiers';
import { StoryboardScene, normalizeScenes, scenesToBody } from '../../utils/collabScenes';
import { AiMarkdown } from '../AiMarkdown';

/**
 * 캠페인 진행 AI — 정산 탭 옆의 'AI' 탭.
 *
 * 하는 일이 하나다: 지금 열어 둔 캠페인의 기획안과 인스타 본문을 쓰고, 브랜드
 * 피드백대로 고친다. 협업 현황이나 정산 문의는 여기서 받지 않는다 — 그건 협업
 * 타임라인의 AI 가 한다. 화면을 좁게 잡은 이유는, 인플루언서가 이 탭을 여는 순간이
 * 정해져 있기 때문이다. 기획안 칸을 앞에 두고 첫 줄을 못 쓰고 있거나, 브랜드
 * 피드백 세 줄을 받고 어디를 어떻게 고쳐야 할지 보고 있을 때다.
 *
 * 사실은 이 컴포넌트가 보내지 않는다. `scope: 'campaign'` 과 열어 둔 협업 아이디만
 * 보내고, 서버가 로그인한 계정으로 그 캠페인의 가이드라인 파일·지금 기획안·브랜드
 * 피드백을 직접 읽는다. 본문으로 받으면 남의 협업 아이디를 끼워 넣을 수 있고, 이
 * 화면이 들고 있는 요약에는 정작 필요한 것이 빠져 있다.
 *
 * ── 검토하고 반영하기 ──────────────────────────────────────────────────
 * AI 가 기획안을 새로 쓰거나 고치면, 서버가 답에서 떼어낸 초안(draft)이 같이 온다.
 * 그 초안을 답 아래 카드로 보여 주고, 사용자가 읽어 본 뒤 버튼을 누르면 기획안에
 * 그대로 저장된다. 저장은 기획안 칸의 '등록하기'와 **완전히 같은 길**로 간다 —
 * `save_step_work`. 그래서 버전이 쌓이고(수정본 구조), 그 단계에 열려 있던 브랜드
 * 피드백이 반영 완료로 닫히는 것도 손으로 낸 것과 똑같이 일어난다. AI 전용 저장
 * 경로를 따로 두면 두 길이 언젠가 어긋나고, 어긋난 쪽으로 낸 기획안은 브랜드
 * 화면에서 몇 번째 안인지 알 수 없게 된다.
 *
 * 버튼을 누르기 전에는 아무것도 저장되지 않는다. AI 가 지어낸 문장이 사용자도 모르게
 * 브랜드에게 제출되는 일은 없어야 한다.
 *
 * v1 은 제미나이(멤버십 포함 모델)만 쓴다. 클로드는 지갑·크레딧 UI 와 함께 협업
 * 타임라인에 있고, 그 모달을 캠페인 진행 화면에 얹지 않는다.
 */

/** 서버가 답 끝의 표식에서 떼어내 주는 초안. campaign-ai-prompt.mts 의 규약과 같다. */
type CampaignDraft =
  | { kind: 'plan'; scenes: StoryboardScene[] }
  | { kind: 'caption'; text: string };

interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 이 답에 붙어 온 반영 가능한 초안. */
  draft?: CampaignDraft | null;
  /** 반영 버튼을 눌러 저장이 끝났는가. 같은 초안을 두 번 저장하지 않게 잠근다. */
  applied?: boolean;
}

interface CampaignAiAssistantProps {
  /** 로그인한 인플루언서 아이디. */
  userName: string;
  /** 지금 열어 둔 협업. */
  collabId: string;
  /** 진행 화면이 이미 불러온 협업 상세. 지금 기획안·본문·피드백 수를 여기서 읽는다. */
  detail?: any;
  campaignTitle?: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** 기획안에 반영한 뒤 진행 화면을 다시 불러오게 한다. */
  onApplied?: () => Promise<void> | void;
  isEn?: boolean;
}

/** 진행 화면(CampaignProcessBoard)과 같은 단계 이름 표. 예전 이름까지 같은 칸으로 본다. */
const PLAN_STAGE_KEYS = ['plan', 'script', 'script_review'];
const VIDEO_STAGE_KEYS = ['video', 'content', 'content_review'];

const QUICK_PROMPTS: Array<{ icon: string; label: string; prompt: string; needsPlan?: boolean }> = [
  {
    icon: '📄',
    label: '기획안 작성',
    prompt:
      '이 캠페인의 기획안을 작성해 주세요. 브랜드가 올린 가이드라인 파일을 먼저 읽고, 꼭 지켜야 할 ' +
      '표기와 필수 장면을 실제 장면 안에 넣어서 장면별로 써 주세요.',
  },
  {
    icon: '✍️',
    label: '피드백대로 기획안 수정',
    prompt:
      '브랜드가 남긴 피드백을 하나도 빠뜨리지 말고 반영해서 기획안을 수정해 주세요. 지적받지 않은 ' +
      '장면은 그대로 두고, 어느 장면을 왜 고쳤는지 알려 주세요.',
    needsPlan: true,
  },
  {
    icon: '📝',
    label: '본문 작성',
    prompt:
      '이 캠페인 게시물에 쓸 인스타그램 본문을 써 주세요. 첫 줄로 시선을 잡고, 가이드라인의 필수 문구와 ' +
      '해시태그, 계정 태그를 빠짐없이 넣어 주세요.',
  },
  {
    icon: '🔁',
    label: '피드백대로 본문 수정',
    prompt: '브랜드 피드백에 맞춰 인스타그램 본문을 수정해 주세요. 무엇을 고쳤는지도 알려 주세요.',
  },
  {
    icon: '📌',
    label: '가이드 필수사항 정리',
    prompt:
      '브랜드가 올린 가이드라인 파일을 읽고, 이 캠페인에서 반드시 지켜야 할 것과 하면 안 되는 것을 ' +
      '체크리스트로 정리해 주세요. 가이드에 없어서 담당자에게 확인해야 할 것도 따로 알려 주세요.',
  },
];

const MEMBERSHIP_NOTICE =
  'AI 어시스턴트는 AI 협업 멤버십(6,900원) 이상에서 이용할 수 있어요. 플랜을 업그레이드하면 바로 사용할 수 있습니다.';

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const CampaignAiAssistant: React.FC<CampaignAiAssistantProps> = ({
  userName,
  collabId,
  detail,
  campaignTitle,
  onNotify,
  onApplied,
  isEn = false,
}) => {
  const normalized = (userName || '').toLowerCase();

  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(-1);
  const [files, setFiles] = useState<File[]>([]);
  // 멤버십 확인이 끝나기 전에는 null. 캐시가 있으면 그것으로 먼저 그린다 —
  // 탭을 누른 직후에 안내문이 번쩍 바뀌지 않게 한다.
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(() => {
    const cached = apiService.getCachedSellerVerification(normalized);
    return cached ? membershipCovers(cached, 'standard_ai') : null;
  });

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 지금 이 캠페인의 상태 ────────────────────────────────────────────────
  // 서버도 같은 값을 DB 에서 다시 읽는다. 여기서 보는 것은 화면에 쓰기 위한 것이다 —
  // 브랜드 피드백이 몇 건 열려 있는지 보이지 않으면, 사용자는 AI 가 그것을 읽고
  // 고칠 수 있다는 것을 모른 채 피드백을 직접 옮겨 적는다.
  const { planScenes, hasPlan, planVersion, hasCaption, videoFileReady, openFeedbackCount } =
    useMemo(() => {
      const deliverables: any[] = Array.isArray(detail?.deliverables) ? detail.deliverables : [];
      const feedbacks: any[] = Array.isArray(detail?.feedbacks) ? detail.feedbacks : [];
      const lastOf = (keys: string[], kind: string) => {
        const rows = deliverables.filter(
          (d: any) => keys.includes(String(d.stageKey)) || String(d.kind) === kind,
        );
        return rows.length ? rows[rows.length - 1] : null;
      };
      const plan = lastOf(PLAN_STAGE_KEYS, 'plan');
      const video = lastOf(VIDEO_STAGE_KEYS, 'video');
      const scenes = normalizeScenes(plan?.payload?.scenes);
      return {
        planScenes: scenes,
        hasPlan: scenes.length > 0 || Boolean(String(plan?.payload?.body || '').trim()),
        planVersion: Number(plan?.version || 0),
        hasCaption: Boolean(String(video?.payload?.caption || '').trim()),
        // 본문만 고쳐 다시 낼 수 있는지. 초안 영상이 한 번도 올라가지 않았으면
        // 서버가 "초안 영상 파일을 올려 주세요"로 막는다(save_step_work 규칙).
        videoFileReady: Boolean(String(video?.payload?.fileUrl || '').trim()),
        openFeedbackCount: feedbacks.filter(
          (f: any) =>
            ['open', 'relayed'].includes(String(f.status)) &&
            (PLAN_STAGE_KEYS.includes(String(f.stageKey)) ||
              VIDEO_STAGE_KEYS.includes(String(f.stageKey))),
        ).length,
      };
    }, [detail]);

  useEffect(() => {
    let alive = true;
    if (aiEnabled === null && normalized) {
      apiService.getSellerVerification(normalized).then(data => {
        if (alive) setAiEnabled(membershipCovers(data, 'standard_ai'));
      });
    }
    return () => {
      alive = false;
    };
  }, [aiEnabled, normalized]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const send = useCallback(
    async (text: string) => {
      const attachedFiles = [...files];
      const typed = text.trim();
      const content =
        typed || (attachedFiles.length > 0 ? '첨부한 파일을 읽고 이 캠페인의 기획안을 작성해 주세요.' : '');
      if (!content || loading) return;

      // 서버가 진짜 판단하지만, 안 될 요청을 보내지는 않는다.
      if (aiEnabled === false) {
        setMessages(prev => [
          ...prev,
          { role: 'user', content },
          { role: 'assistant', content: MEMBERSHIP_NOTICE },
        ]);
        setInput('');
        return;
      }

      // 첨부한 파일은 대화에도 남겨 둔다. 파일 내용은 이번 요청에만 실려 가므로,
      // 다음 턴에서도 무엇을 보고 쓴 기획안인지 알 수 있어야 한다.
      const fileNote =
        attachedFiles.length > 0 ? `\n\n📎 ${attachedFiles.map(f => f.name).join(', ')}` : '';
      const next: AiMessage[] = [...messages, { role: 'user', content: content + fileNote }];
      setMessages(next);
      setInput('');
      setFiles([]);
      setLoading(true);
      if (inputRef.current) inputRef.current.style.height = 'auto';

      try {
        // 붙인 파일을 먼저 올린다. 서버는 주소만 받아 저장소에서 원본을 읽는다.
        const attachments: { url: string; fileName: string; fileType: string }[] = [];
        for (const file of attachedFiles) {
          const formData = new FormData();
          formData.append('image', file);
          formData.append('username', normalized);
          const uploadRes = await fetch('/api/upload-image', { method: 'POST', body: formData });
          const uploadData = await uploadRes.json().catch(() => null);
          if (uploadData?.url) {
            attachments.push({ url: uploadData.url, fileName: file.name, fileType: file.type });
          }
        }

        const res = await fetch('/api/collab-ai', {
          method: 'POST',
          headers: await authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            username: normalized,
            userType: 'influencer',
            // 이 캠페인 한 건만 읽고 기획안·본문만 다루게 하는 스위치. 협업 타임라인은
            // 이 값을 보내지 않으므로 그쪽 동작은 그대로다.
            scope: 'campaign',
            campaignFocusId: collabId || '',
            // 초안(draft)은 대화 기록에 싣지 않는다. 서버가 쓰는 것은 역할과 글뿐이다.
            messages: next.map(m => ({ role: m.role, content: m.content })),
            attachments,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data?.code === 'MEMBERSHIP_REQUIRED') setAiEnabled(false);
          setMessages(prev => [
            ...prev,
            {
              role: 'assistant',
              content:
                data?.code === 'MEMBERSHIP_REQUIRED'
                  ? MEMBERSHIP_NOTICE
                  : data?.error || 'AI 응답에 실패했어요. 잠시 후 다시 시도해 주세요.',
            },
          ]);
        } else {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: data.reply || '...', draft: data.draft || null },
          ]);
        }
      } catch {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: '네트워크 오류로 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.' },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [aiEnabled, collabId, files, loading, messages, normalized],
  );

  /**
   * 검토한 초안을 기획안에 그대로 반영한다.
   *
   * 손으로 낼 때와 같은 action 을 같은 payload 모양으로 보낸다. 줄글 본문도 같은
   * 함수(scenesToBody)로 만들어서, AI 로 낸 기획안과 직접 낸 기획안이 담당자 화면에서
   * 다르게 보이지 않게 한다.
   */
  const applyDraft = useCallback(
    async (index: number, draft: CampaignDraft) => {
      if (applying >= 0) return;
      setApplying(index);
      try {
        const payload =
          draft.kind === 'plan'
            ? { stepKey: 'plan', scenes: draft.scenes, body: scenesToBody(draft.scenes) }
            : { stepKey: 'video', caption: draft.text };
        const res = await apiService.collabAction(
          collabId,
          'save_step_work',
          payload,
          undefined,
          'influencer',
        );
        if (res?.error) {
          onNotify(res.error, 'error');
          return;
        }
        setMessages(prev => prev.map((m, i) => (i === index ? { ...m, applied: true } : m)));
        onNotify(
          draft.kind === 'plan'
            ? '기획안에 반영했습니다. 브랜드가 확인하면 알려 드릴게요.'
            : '본문에 반영했습니다. 브랜드가 확인하면 알려 드릴게요.',
        );
        await onApplied?.();
      } catch {
        onNotify('반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      } finally {
        setApplying(-1);
      }
    },
    [applying, collabId, onApplied, onNotify],
  );

  const dismissDraft = (index: number) =>
    setMessages(prev => prev.map((m, i) => (i === index ? { ...m, draft: null } : m)));

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  /** 초안 검토 카드. 저장되기 전의 내용을 기획안 칸과 같은 모양으로 보여 준다. */
  const renderDraftCard = (index: number, message: AiMessage) => {
    const draft = message.draft;
    if (!draft) return null;
    const isPlan = draft.kind === 'plan';
    const busy = applying === index;
    // 본문만 고쳐 내려면 이미 올라간 초안 영상이 있어야 한다. 없으면 눌러도 서버가
    // 막으므로, 버튼을 잠그고 이유를 먼저 보여 준다.
    const blocked = !isPlan && !videoFileReady;

    return (
      <div className="mt-2 rounded-2xl border-2 border-violet-200 bg-violet-50/40 overflow-hidden">
        <div className="px-3.5 py-2.5 bg-white/70 border-b border-violet-100 flex items-center gap-2">
          <span className="text-sm leading-none">{isPlan ? '📄' : '📝'}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-black text-slate-900">
              {isPlan
                ? `AI 기획안 초안 · 장면 ${draft.scenes.length}개`
                : `AI 본문 초안 · ${draft.text.length}자`}
            </p>
            <p className="text-[10px] font-bold text-slate-500">
              {message.applied
                ? isPlan
                  ? '기획안에 반영했습니다.'
                  : '본문에 반영했습니다.'
                : '읽어 보고 아래 버튼을 누르면 이 내용이 그대로 저장됩니다.'}
            </p>
          </div>
        </div>

        <div className="px-3.5 py-3 max-h-[340px] overflow-y-auto space-y-2.5">
          {isPlan ? (
            draft.scenes.map((s, i) => (
              <div key={i} className="rounded-xl bg-white border border-violet-100 px-3 py-2.5">
                <p className="text-[10px] font-black text-violet-700 mb-1">장면 {i + 1}</p>
                <p className="text-[12px] text-slate-800 leading-relaxed whitespace-pre-wrap">{s.visual}</p>
                {s.subtitle.trim() && (
                  <p className="mt-1.5 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">
                    <span className="font-black text-slate-400">자막 </span>
                    {s.subtitle}
                  </p>
                )}
                {s.narration.trim() && (
                  <p className="mt-1 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">
                    <span className="font-black text-slate-400">나레이션 </span>
                    {s.narration}
                  </p>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-xl bg-white border border-violet-100 px-3 py-2.5">
              <p className="text-[12px] text-slate-800 leading-relaxed whitespace-pre-wrap">{draft.text}</p>
            </div>
          )}
        </div>

        {blocked && !message.applied && (
          <p className="px-3.5 pb-1 text-[10px] font-bold text-amber-700 leading-relaxed">
            초안 영상을 한 번 올린 뒤에 본문을 반영할 수 있어요. 콘텐츠 단계에서 영상을 먼저 제출해
            주세요. (그 전에는 위 본문을 복사해 두셔도 됩니다.)
          </p>
        )}

        {!message.applied && (
          <div className="px-3.5 pb-3 pt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyDraft(index, draft)}
              disabled={busy || blocked || applying >= 0}
              className="flex-1 px-3 py-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {busy ? '반영 중…' : isPlan ? '수정하기 · 기획안에 반영' : '수정하기 · 본문에 반영'}
            </button>
            <button
              type="button"
              onClick={() => dismissDraft(index)}
              disabled={busy}
              className="px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-[11px] font-black text-slate-500 hover:text-slate-800 disabled:opacity-40 transition-colors"
            >
              닫기
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {/* 머리말 — 이 AI 가 무엇을 보고 있는지 한 줄로 밝힌다. 가이드 파일과 브랜드
          피드백을 읽는다는 것을 모르면 "고쳐 줘"라고 부탁할 생각을 하지 않는다. */}
      <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50/70 to-blue-50/50">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-[0_6px_16px_-8px_rgba(76,29,149,0.7)]">
            <span className="text-base leading-none">✨</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-900">
              {isEn ? 'Campaign content AI' : '캠페인 기획 AI'}
            </p>
            <p className="text-[11px] text-slate-500 font-bold truncate">
              {isEn
                ? 'Writes and revises the content plan and caption for this campaign'
                : `이 캠페인의 기획안 · 본문만 쓰고 고쳐요${
                    openFeedbackCount > 0 ? ` · 브랜드 피드백 ${openFeedbackCount}건 확인 중` : ''
                  }`}
            </p>
          </div>
        </div>
      </div>

      {aiEnabled === false ? (
        <div className="p-8 md:p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <span className="text-xl leading-none">🔒</span>
          </div>
          <p className="text-sm font-black text-slate-900 mb-1">
            {isEn ? 'Included with the AI membership' : 'AI 협업 멤버십부터 이용할 수 있어요'}
          </p>
          <p className="text-[12px] text-slate-500 font-bold leading-relaxed max-w-sm mx-auto">
            {isEn
              ? 'The AI assistant is bundled into the AI collaboration membership (6,900 KRW) and every tier above it.'
              : 'AI 어시스턴트는 AI 협업 멤버십(6,900원) 이상에 포함되어 있어요. 플랜을 올리면 이 탭에서 바로 쓸 수 있습니다.'}
          </p>
        </div>
      ) : (
        <>
          {/* 대화 */}
          <div className="px-4 md:px-5 py-5 min-h-[280px] max-h-[560px] overflow-y-auto">
            {messages.length === 0 && (
              <div className="max-w-lg mx-auto text-center pt-2">
                <h3 className="text-sm font-extrabold text-slate-900 mb-1.5">
                  {isEn ? 'Plan or revise this campaign' : '기획안을 쓰거나 고쳐 드릴까요?'}
                </h3>
                <p className="text-[11px] md:text-xs text-slate-500 leading-relaxed">
                  {isEn ? (
                    'Ask for a content plan or an Instagram caption for this campaign and it will be written from the brand guideline files. Ask for a revision and it will read the brand feedback and rewrite it — you review the result, then apply it with one button.'
                  ) : (
                    <>
                      <strong className="text-slate-700">기획안</strong>이나{' '}
                      <strong className="text-slate-700">본문</strong>을 부탁하면 브랜드가 올린{' '}
                      <strong className="text-slate-700">가이드 파일</strong>을 읽고 써 드려요. 수정을
                      부탁하면 <strong className="text-slate-700">브랜드 피드백</strong>을 확인해서
                      고치고, 그 결과를 검토하신 뒤{' '}
                      <strong className="text-slate-700">수정하기</strong> 버튼을 누르면 기획안에 그대로
                      반영됩니다.
                      {campaignTitle && (
                        <>
                          {' '}
                          지금은 <strong className="text-slate-700">{campaignTitle}</strong> 기준으로
                          씁니다.
                        </>
                      )}
                    </>
                  )}
                </p>

                {/* 지금 무엇이 있는지 짧게 — 고칠 것이 있는지 보고 부탁하게 한다. */}
                {!isEn && (
                  <p className="mt-2 text-[10px] font-bold text-slate-400">
                    {hasPlan
                      ? `현재 기획안 ${planVersion > 0 ? `${planVersion}번째 안 · ` : ''}장면 ${planScenes.length}개`
                      : '아직 제출된 기획안 없음'}
                    {hasCaption ? ' · 본문 작성됨' : ' · 본문 미작성'}
                    {openFeedbackCount > 0 ? ` · 미반영 피드백 ${openFeedbackCount}건` : ''}
                  </p>
                )}

                <div className="flex flex-wrap justify-center gap-1.5 mt-4">
                  {QUICK_PROMPTS.filter(q => !q.needsPlan || hasPlan).map(q => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={loading}
                      onClick={() => send(q.prompt)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] md:text-xs font-bold text-slate-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50/60 active:scale-95 transition-all shadow-[0_4px_12px_-8px_rgba(15,23,42,0.5)] disabled:opacity-50"
                    >
                      <span className="leading-none">{q.icon}</span>
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 md:space-y-4 max-w-3xl mx-auto">
              {messages.map((m, idx) => (
                <div key={idx} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-xs font-bold shadow-[0_5px_12px_-4px_rgba(76,29,149,0.55)] ${
                      m.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gradient-to-br from-violet-500 to-blue-600 text-white'
                    }`}
                  >
                    {m.role === 'user' ? (normalized.slice(0, 2).toUpperCase() || '나') : '✨'}
                  </div>
                  <div className={`min-w-0 max-w-[82%] ${m.role === 'user' ? 'text-right' : ''}`}>
                    <div
                      className={`inline-block px-3 py-2 md:px-3.5 md:py-2.5 rounded-2xl text-[13px] md:text-[15px] leading-[1.6] break-words text-left ${
                        m.role === 'user'
                          ? 'bg-blue-50 border border-blue-100 text-slate-900 rounded-tr-sm whitespace-pre-wrap shadow-[0_6px_16px_-8px_rgba(37,99,235,0.55)]'
                          : 'bg-slate-50 border border-slate-100 text-slate-900 rounded-tl-sm shadow-[0_6px_16px_-10px_rgba(15,23,42,0.5)]'
                      }`}
                    >
                      {m.role === 'assistant' ? <AiMarkdown content={m.content} /> : m.content}
                    </div>
                    {m.role === 'assistant' && renderDraftCard(idx, m)}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex gap-2.5">
                  <div className="shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-xs">
                    ✨
                  </div>
                  <div className="inline-flex items-center gap-1 px-3.5 py-3 rounded-2xl rounded-tl-sm bg-slate-50 border border-slate-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          {/* 입력 */}
          <div className="px-4 md:px-5 pb-4 pt-1 border-t border-slate-100">
            <div className="max-w-3xl mx-auto relative bg-white border-2 border-slate-200 rounded-lg overflow-hidden focus-within:border-violet-400 transition-all">
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
                  {files.map((file, idx) => (
                    <div key={idx} className="relative group flex items-center gap-1.5 bg-violet-50 border border-violet-100 rounded-lg px-2 py-1 max-w-[170px]">
                      <span className="text-sm leading-none shrink-0">{file.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-700 font-semibold truncate">{file.name}</p>
                        <p className="text-[9px] text-slate-400">{formatFileSize(file.size)}</p>
                      </div>
                      <button
                        onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        title="첨부 취소"
                      >
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5 md:gap-2 p-2 md:p-2.5">
                {/* 캠페인에 등록된 가이드라인 파일은 서버가 매번 알아서 읽는다.
                    이 첨부는 담당자가 따로 준 파일이나 참고 이미지를 더 읽히는 자리다. */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.jpg,.jpeg,.png,.gif,.webp,.pdf"
                  onChange={e => {
                    const picked = Array.from(e.target.files || []);
                    setFiles(prev => [...prev, ...picked].slice(0, 3));
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || files.length >= 3}
                  className="shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-violet-600 transition-colors disabled:opacity-40"
                  title="참고 파일 첨부 (이미지 · PDF, 최대 3개)"
                >
                  <svg className="w-4 h-4 md:w-[18px] md:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => {
                    setInput(e.target.value);
                    const ta = e.target;
                    ta.style.height = 'auto';
                    ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
                  }}
                  onKeyDown={onKeyDown}
                  placeholder={
                    isEn
                      ? 'Ask for a content plan, a caption, or a revision.'
                      : '기획안이나 본문을 부탁하거나, 수정해 달라고 해 보세요.'
                  }
                  rows={1}
                  className="flex-1 bg-transparent text-[13px] md:text-[15px] text-slate-900 placeholder-slate-400 resize-none focus:outline-none py-1 px-1 leading-relaxed"
                  style={{ maxHeight: '80px' }}
                />
                <button
                  onClick={() => send(input)}
                  disabled={(!input.trim() && files.length === 0) || loading}
                  className={`shrink-0 w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all ${
                    (input.trim() || files.length > 0) && !loading
                      ? 'bg-gradient-to-br from-violet-600 to-blue-600 text-white hover:opacity-90 active:scale-95 shadow-[0_6px_14px_-5px_rgba(124,58,237,0.8)]'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14m-7-7l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
            <p className="max-w-3xl mx-auto text-[10px] text-slate-400 font-bold mt-1.5 px-1">
              {isEn
                ? 'Nothing is saved until you press the apply button. Campaign terms and settlement questions go to your manager.'
                : '반영 버튼을 누르기 전에는 저장되지 않아요. 조건 · 일정 · 정산 문의는 담당자에게 확인해 주세요.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default CampaignAiAssistant;
