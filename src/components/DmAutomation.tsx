import React, { useEffect, useMemo, useState } from 'react';
import {
  Instagram, Check, Plus, Trash2, Send, Loader2, MessageSquare, MessageCircle,
  Zap, Link2, X, ChevronRight, Sparkles, AlertCircle, Pencil, Power, Users,
  CornerDownRight, Hash, Reply, Eye, MousePointerClick, Image as ImageIcon,
  LayoutGrid, AlignLeft, GalleryHorizontalEnd,
} from 'lucide-react';
import { apiService, DmAutomationSettings, DmAutomationItem, DmMessageButton, DmCarouselCard, InstagramMedia } from '../services/apiService';

interface DmAutomationProps {
  userName: string;
}

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const blankCard = (): DmCarouselCard => ({
  id: genId('card'), title: '', subtitle: '', imageUrl: '', buttonLabel: '', buttonUrl: '',
});

const blankAutomation = (): DmAutomationItem => ({
  id: genId('auto'),
  name: '',
  enabled: true,
  commentMatch: 'all',
  keywords: [],
  replyEnabled: false,
  replies: [],
  followFilter: 'all',
  mediaScope: 'all',
  mediaIds: [],
  messageType: 'text',
  message: '안녕하세요! 관심 가져주셔서 감사합니다 😊 아래 링크에서 더 많은 정보를 확인해보세요.',
  buttons: [{ id: genId('btn'), label: '링크 바로가기', url: '' }],
  cards: [],
  createdAt: new Date().toISOString(),
});

// 이전에 저장된(신규 필드가 없는) 자동화도 안전하게 다룰 수 있도록 기본값을 채운다.
const normalizeAutomation = (a: DmAutomationItem): DmAutomationItem => ({
  ...a,
  keywords: Array.isArray(a.keywords) ? a.keywords : [],
  replies: Array.isArray(a.replies) ? a.replies : [],
  buttons: Array.isArray(a.buttons) ? a.buttons : [],
  cards: Array.isArray(a.cards) ? a.cards : [],
  mediaIds: Array.isArray(a.mediaIds) ? a.mediaIds : [],
  mediaScope: a.mediaScope === 'selected' ? 'selected' : 'all',
  messageType: a.messageType === 'carousel' ? 'carousel' : 'text',
});

const FOLLOW_LABEL: Record<DmAutomationItem['followFilter'], string> = {
  all: '모든 사용자',
  followers: '팔로워에게만',
  non_followers: '비팔로워에게만',
};

/**
 * 인스타그램 제네릭 템플릿 카드의 제목 길이 제한. 본문이 이 길이를 넘으면
 * 본문은 일반 텍스트 버블로 먼저 도착하고 링크 버튼은 별도 카드로 이어진다.
 * (발송 로직: netlify/functions/_shared/instagram-dm.mts)
 */
const CARD_TEXT_MAX = 80;

/** Graph API 는 http/https 절대 URL 만 링크 버튼으로 받는다. */
const isValidLinkUrl = (raw: string): boolean => {
  try {
    const u = new URL((raw || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/* ────────────────────────── DM 미리보기 버블 ────────────────────────── */
const DmPreview: React.FC<{
  igUsername: string;
  messageType: DmAutomationItem['messageType'];
  message: string;
  buttons: DmMessageButton[];
  cards: DmCarouselCard[];
}> = ({ igUsername, messageType, message, buttons, cards }) => {
  const validCards = cards.filter((c) => c.title || c.imageUrl || c.buttonUrl);
  const isCarousel = messageType === 'carousel' && validCards.length > 0;
  // 실제로 발송되는 버튼만(라벨 + 올바른 http/https URL) 미리보기에 표시한다.
  const validButtons = buttons.filter((b) => b.label.trim() && isValidLinkUrl(b.url));
  // 본문이 카드 제목 한도를 넘으면 본문 텍스트와 버튼 카드가 두 개의 버블로 도착한다.
  const splitBubbles = validButtons.length > 0 && message.trim().length > CARD_TEXT_MAX;
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-3xl p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3 text-slate-400">
        <Instagram size={13} />
        <span className="text-[11px] font-black">DM 미리보기</span>
      </div>
      <div className="flex items-end gap-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 shrink-0 flex items-center justify-center text-white">
          <Instagram size={15} />
        </div>
        <div className="max-w-[85%] min-w-0">
          {isCarousel ? (
            <div className="flex gap-2 overflow-x-auto pb-1 -mr-2">
              {validCards.map((c) => (
                <div key={c.id} className="w-40 shrink-0 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="w-full aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                    {c.imageUrl
                      ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" />
                      : <ImageIcon size={22} className="text-slate-300" />}
                  </div>
                  <div className="p-2.5">
                    <p className="text-[12px] font-black text-slate-800 truncate">{c.title || '카드 제목'}</p>
                    {c.subtitle && <p className="text-[11px] text-slate-500 font-medium truncate">{c.subtitle}</p>}
                    {c.buttonLabel && (
                      <div className="mt-2 text-center bg-slate-50 border border-slate-200 rounded-lg py-1.5 text-[11px] font-bold text-pink-600 truncate">
                        {c.buttonLabel}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* 버튼이 없거나 본문이 길면 본문은 별도의 텍스트 버블로 도착한다. */}
              {(validButtons.length === 0 || splitBubbles) && (
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <p className="text-[13px] text-slate-700 font-medium leading-relaxed whitespace-pre-wrap break-words">
                    {message || '보낼 메시지를 입력하면 여기에 표시됩니다.'}
                  </p>
                </div>
              )}
              {validButtons.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md overflow-hidden shadow-sm">
                  <p className="px-4 py-3 text-[13px] text-slate-700 font-bold leading-relaxed whitespace-pre-wrap break-words">
                    {splitBubbles ? '👇 아래 버튼을 눌러주세요' : message}
                  </p>
                  <div className="border-t border-slate-100">
                    {validButtons.map((b) => (
                      <div
                        key={b.id}
                        className="w-full text-center border-b border-slate-100 last:border-b-0 py-2.5 text-[12px] font-bold text-pink-600 truncate px-3"
                      >
                        {b.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {igUsername && <span className="text-[10px] text-slate-400 font-bold ml-2 mt-1 inline-block">@{igUsername}</span>}
        </div>
      </div>
      {!isCarousel && validButtons.length > 0 && (
        <p className="mt-3 text-[10px] text-slate-400 font-bold leading-relaxed">
          링크 버튼은 카드 형태로 전송됩니다. 인스타그램 모바일 앱에서만 표시되고 웹(instagram.com) DM 화면에서는 보이지 않습니다.
        </p>
      )}
    </div>
  );
};

/* ────────────────────────── 자동화 생성/편집 모달 ────────────────────────── */
const AutomationEditor: React.FC<{
  initial: DmAutomationItem;
  igUsername: string;
  media: InstagramMedia[];
  mediaLoading: boolean;
  onClose: () => void;
  onSave: (a: DmAutomationItem) => void;
}> = ({ initial, igUsername, media, mediaLoading, onClose, onSave }) => {
  const [draft, setDraft] = useState<DmAutomationItem>(initial);
  const [keywordInput, setKeywordInput] = useState('');

  const patch = (p: Partial<DmAutomationItem>) => setDraft((d) => ({ ...d, ...p }));

  const addKeyword = () => {
    const k = keywordInput.trim();
    if (!k || draft.keywords.includes(k)) { setKeywordInput(''); return; }
    patch({ keywords: [...draft.keywords, k] });
    setKeywordInput('');
  };

  const updateButton = (id: string, p: Partial<DmMessageButton>) =>
    patch({ buttons: draft.buttons.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const addButton = () =>
    patch({ buttons: [...draft.buttons, { id: genId('btn'), label: '', url: '' }] });
  const removeButton = (id: string) =>
    patch({ buttons: draft.buttons.filter((b) => b.id !== id) });

  const updateCard = (id: string, p: Partial<DmCarouselCard>) =>
    patch({ cards: draft.cards.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const addCard = () => patch({ cards: [...draft.cards, blankCard()] });
  const removeCard = (id: string) => patch({ cards: draft.cards.filter((c) => c.id !== id) });

  const toggleMedia = (id: string) => {
    const has = draft.mediaIds.includes(id);
    patch({ mediaIds: has ? draft.mediaIds.filter((m) => m !== id) : [...draft.mediaIds, id] });
  };

  const validCards = draft.cards.filter((c) => c.title || c.imageUrl || c.buttonUrl);
  const messageValid = draft.messageType === 'carousel'
    ? validCards.length > 0
    : draft.message.trim().length > 0;
  const mediaValid = draft.mediaScope === 'all' || draft.mediaIds.length > 0;

  const canSave = messageValid &&
    mediaValid &&
    (draft.commentMatch === 'all' || draft.keywords.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    onSave({ ...draft, name: draft.name.trim() || (draft.commentMatch === 'keyword' ? `키워드 DM` : '댓글 DM') });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 md:p-6 animate-in fade-in duration-200">
      <div className="bg-white w-full md:max-w-4xl md:rounded-[2rem] rounded-t-[2rem] shadow-2xl max-h-[94vh] md:max-h-[90vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 md:px-8 py-4 md:py-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-white">
              <Sparkles size={17} />
            </div>
            <h3 className="text-lg md:text-xl font-black text-slate-900">자동 DM 설정</h3>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400" aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto grid grid-cols-1 lg:grid-cols-[1fr_340px]">
          {/* 좌: 설정 */}
          <div className="p-5 md:p-8 space-y-7">
            {/* 이름 */}
            <div>
              <label className="block text-xs font-black text-slate-500 mb-2">자동화 이름</label>
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="예: 신제품 문의 자동응답"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-pink-500"
              />
            </div>

            {/* 1. 어떤 게시물 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">1</span>
                <h4 className="text-sm md:text-base font-black text-slate-900">어떤 게시물에 적용할까요?</h4>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {(['all', 'selected'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => patch({ mediaScope: m })}
                    className={`rounded-xl border-2 px-4 py-3 text-left transition-all ${
                      draft.mediaScope === m ? 'border-pink-500 bg-pink-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <span className="block text-sm font-black text-slate-900">{m === 'all' ? '모든 게시물' : '특정 게시물'}</span>
                    <span className="block text-[11px] text-slate-500 font-medium mt-0.5">
                      {m === 'all' ? '모든 게시물의 댓글에 반응' : '선택한 게시물에만 반응'}
                    </span>
                  </button>
                ))}
              </div>

              {draft.mediaScope === 'selected' && (
                mediaLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                    <Loader2 size={16} className="animate-spin" /> <span className="text-xs font-bold">게시물을 불러오는 중…</span>
                  </div>
                ) : media.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
                    <ImageIcon size={26} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-500">불러올 게시물이 없어요</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">인스타그램에 게시물이 있는지 확인해주세요.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] text-slate-500 font-bold mb-2">{draft.mediaIds.length}개 선택됨</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto pr-1">
                      {media.map((m) => {
                        const selected = draft.mediaIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleMedia(m.id)}
                            className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all group ${
                              selected ? 'border-pink-500 ring-2 ring-pink-200' : 'border-transparent hover:border-slate-300'
                            }`}
                          >
                            {m.mediaUrl
                              ? <img src={m.mediaUrl} alt={m.caption.slice(0, 40)} className="w-full h-full object-cover" loading="lazy" />
                              : <div className="w-full h-full bg-slate-100 flex items-center justify-center"><ImageIcon size={20} className="text-slate-300" /></div>}
                            {selected && (
                              <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-pink-500 text-white flex items-center justify-center shadow">
                                <Check size={12} />
                              </span>
                            )}
                            {!selected && <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors" />}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )
              )}
            </div>

            {/* 2. 어떤 댓글 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">2</span>
                <h4 className="text-sm md:text-base font-black text-slate-900">어떤 댓글에 DM을 보낼까요?</h4>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['all', 'keyword'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => patch({ commentMatch: m })}
                    className={`rounded-xl border-2 px-4 py-3 text-left transition-all ${
                      draft.commentMatch === m ? 'border-pink-500 bg-pink-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <span className="block text-sm font-black text-slate-900">{m === 'all' ? '모든 댓글' : '특정 키워드'}</span>
                    <span className="block text-[11px] text-slate-500 font-medium mt-0.5">
                      {m === 'all' ? '댓글이 달리면 모두 발송' : '키워드가 포함된 댓글만'}
                    </span>
                  </button>
                ))}
              </div>

              {draft.commentMatch === 'keyword' && (
                <div className="mt-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                        placeholder="키워드 입력 후 Enter (예: 가격)"
                        className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-4 py-2.5 text-sm font-bold focus:outline-none focus:border-pink-500"
                      />
                    </div>
                    <button type="button" onClick={addKeyword} className="px-4 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800">추가</button>
                  </div>
                  {draft.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {draft.keywords.map((k) => (
                        <span key={k} className="inline-flex items-center gap-1 bg-pink-100 text-pink-700 rounded-full pl-3 pr-1.5 py-1 text-xs font-bold">
                          {k}
                          <button type="button" onClick={() => patch({ keywords: draft.keywords.filter((x) => x !== k) })} className="w-4 h-4 rounded-full hover:bg-pink-200 flex items-center justify-center">
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. 팔로우 여부 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">3</span>
                <h4 className="text-sm md:text-base font-black text-slate-900">누구에게 보낼까요?</h4>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['all', 'followers', 'non_followers'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => patch({ followFilter: f })}
                    className={`rounded-xl border-2 px-3 py-2.5 text-center transition-all text-xs font-black ${
                      draft.followFilter === f ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {FOLLOW_LABEL[f]}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. 댓글 답글 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">4</span>
                  <h4 className="text-sm md:text-base font-black text-slate-900">댓글에 답글도 남길까요?</h4>
                </div>
                <Toggle on={draft.replyEnabled} onClick={() => patch({ replyEnabled: !draft.replyEnabled })} />
              </div>
              {draft.replyEnabled && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500 font-medium">여러 개를 등록하면 랜덤으로 하나가 공개 답글로 달립니다.</p>
                  {draft.replies.map((r, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={r}
                        onChange={(e) => patch({ replies: draft.replies.map((x, j) => (j === i ? e.target.value : x)) })}
                        placeholder="예: DM 확인해주세요! 📩"
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:border-pink-500"
                      />
                      <button type="button" onClick={() => patch({ replies: draft.replies.filter((_, j) => j !== i) })} className="w-10 rounded-xl border border-red-100 text-red-400 flex items-center justify-center hover:bg-red-50">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => patch({ replies: [...draft.replies, ''] })} className="w-full border border-dashed border-slate-300 rounded-xl py-2.5 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500">
                    + 답글 추가
                  </button>
                </div>
              )}
            </div>

            {/* 5. 메시지 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">5</span>
                <h4 className="text-sm md:text-base font-black text-slate-900">보낼 DM 메시지</h4>
              </div>

              {/* 메시지 형식 선택 */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                {([
                  { t: 'text' as const, icon: <AlignLeft size={15} />, label: '텍스트', desc: '메시지 + 링크 버튼' },
                  { t: 'carousel' as const, icon: <GalleryHorizontalEnd size={15} />, label: '캐러셀', desc: '이미지 카드 여러 장' },
                ]).map((opt) => (
                  <button
                    key={opt.t}
                    type="button"
                    onClick={() => patch({ messageType: opt.t })}
                    className={`rounded-xl border-2 px-4 py-3 text-left transition-all ${
                      draft.messageType === opt.t ? 'border-pink-500 bg-pink-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-black text-slate-900">{opt.icon}{opt.label}</span>
                    <span className="block text-[11px] text-slate-500 font-medium mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>

              {draft.messageType === 'text' ? (
                <>
                  <textarea
                    value={draft.message}
                    onChange={(e) => patch({ message: e.target.value })}
                    rows={4}
                    maxLength={1000}
                    placeholder="자동으로 보낼 메시지를 입력하세요."
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-pink-500 resize-none"
                  />
                  <p className="text-right text-[10px] text-slate-400 font-bold mt-1">{draft.message.length}/1000</p>

                  {/* 링크 버튼 */}
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-500">
                      <Link2 size={13} /> 링크 버튼 <span className="text-slate-300 font-bold">(최대 3개)</span>
                    </div>
                    {draft.buttons.map((b) => {
                      // URL 이 비어 있거나 http/https 가 아니면 발송 시 버튼이 빠진다.
                      const urlInvalid = Boolean(b.label.trim()) && !isValidLinkUrl(b.url);
                      return (
                      <div key={b.id} className="bg-slate-50 border border-slate-100 rounded-xl p-2">
                        <div className="flex gap-2 items-center">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={b.label}
                            onChange={(e) => updateButton(b.id, { label: e.target.value })}
                            placeholder="버튼 이름 (예: 구매하기)"
                            maxLength={20}
                            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                          />
                          <input
                            value={b.url}
                            onChange={(e) => updateButton(b.id, { url: e.target.value })}
                            placeholder="https://..."
                            className={`bg-white border rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500 ${
                              urlInvalid ? 'border-red-300' : 'border-slate-200'
                            }`}
                          />
                        </div>
                        <button type="button" onClick={() => removeButton(b.id)} className="w-8 h-8 shrink-0 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center">
                          <Trash2 size={14} />
                        </button>
                        </div>
                        {urlInvalid && (
                          <p className="flex items-center gap-1 mt-1.5 px-1 text-[10px] font-bold text-red-500">
                            <AlertCircle size={11} />
                            https:// 로 시작하는 주소를 입력해야 버튼이 전송됩니다.
                          </p>
                        )}
                      </div>
                      );
                    })}
                    {draft.buttons.length < 3 && (
                      <button type="button" onClick={addButton} className="w-full border border-dashed border-slate-300 rounded-xl py-2.5 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500">
                        + 버튼 추가
                      </button>
                    )}
                  </div>
                </>
              ) : (
                /* 캐러셀 카드 빌더 */
                <div className="space-y-3">
                  <p className="text-[11px] text-slate-500 font-medium">이미지 카드를 좌우로 넘겨보는 캐러셀 메시지예요. 카드는 최대 10장까지 추가할 수 있어요.</p>
                  {draft.cards.length === 0 && (
                    <div className="text-center py-6 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
                      <LayoutGrid size={24} className="text-slate-300 mx-auto mb-2" />
                      <p className="text-xs font-bold text-slate-500">카드를 추가해 캐러셀을 만들어보세요</p>
                    </div>
                  )}
                  {draft.cards.map((c, i) => (
                    <div key={c.id} className="bg-slate-50 border border-slate-100 rounded-2xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-slate-500">카드 {i + 1}</span>
                        <button type="button" onClick={() => removeCard(c.id)} className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center">
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <div className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center">
                          {c.imageUrl
                            ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" />
                            : <ImageIcon size={18} className="text-slate-300" />}
                        </div>
                        <div className="flex-1 space-y-2">
                          <input
                            value={c.imageUrl}
                            onChange={(e) => updateCard(c.id, { imageUrl: e.target.value })}
                            placeholder="이미지 URL (https://...)"
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                          />
                          <input
                            value={c.title}
                            onChange={(e) => updateCard(c.id, { title: e.target.value })}
                            placeholder="제목"
                            maxLength={80}
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                          />
                        </div>
                      </div>
                      <input
                        value={c.subtitle}
                        onChange={(e) => updateCard(c.id, { subtitle: e.target.value })}
                        placeholder="설명 (선택)"
                        maxLength={80}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:border-pink-500"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={c.buttonLabel}
                          onChange={(e) => updateCard(c.id, { buttonLabel: e.target.value })}
                          placeholder="버튼 이름 (예: 보기)"
                          maxLength={20}
                          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                        />
                        <input
                          value={c.buttonUrl}
                          onChange={(e) => updateCard(c.id, { buttonUrl: e.target.value })}
                          placeholder="버튼 링크 (https://...)"
                          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                        />
                      </div>
                    </div>
                  ))}
                  {draft.cards.length < 10 && (
                    <button type="button" onClick={addCard} className="w-full border border-dashed border-slate-300 rounded-xl py-2.5 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500">
                      + 카드 추가
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 우: 미리보기 (데스크톱 고정) */}
          <div className="hidden lg:block bg-slate-50/60 border-l border-slate-100 p-6">
            <div className="sticky top-0">
              <DmPreview igUsername={igUsername} messageType={draft.messageType} message={draft.message} buttons={draft.buttons} cards={draft.cards} />
            </div>
          </div>
        </div>

        {/* 모바일 미리보기 */}
        <div className="lg:hidden px-5 pb-2">
          <DmPreview igUsername={igUsername} messageType={draft.messageType} message={draft.message} buttons={draft.buttons} cards={draft.cards} />
        </div>

        {/* 푸터 */}
        <div className="px-5 md:px-8 py-4 border-t border-slate-100 flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 md:flex-none md:px-8 py-3 rounded-xl bg-slate-100 text-slate-600 text-sm font-black hover:bg-slate-200">취소</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-orange-500 text-white text-sm font-black shadow-lg shadow-pink-500/25 disabled:opacity-40 disabled:shadow-none hover:opacity-95"
          >
            설정 완료
          </button>
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────── 토글 ────────────────────────── */
const Toggle: React.FC<{ on: boolean; onClick: () => void; size?: 'sm' | 'md' }> = ({ on, onClick, size = 'md' }) => {
  const s = size === 'sm' ? { w: 'w-10', h: 'h-6', k: 'w-4 h-4', on: 'left-5', off: 'left-1' } : { w: 'w-12', h: 'h-7', k: 'w-5 h-5', on: 'left-6', off: 'left-1' };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative ${s.w} ${s.h} rounded-full transition-all shrink-0 ${on ? 'bg-pink-500' : 'bg-slate-300'}`}
      aria-label="켜기/끄기"
    >
      <span className={`absolute top-1 ${s.k} bg-white rounded-full shadow transition-all ${on ? s.on : s.off}`} />
    </button>
  );
};

/* ────────────────────────── 메인 컴포넌트 ────────────────────────── */
const DmAutomation: React.FC<DmAutomationProps> = ({ userName }) => {
  const [loaded, setLoaded] = useState(false);
  const [, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [igUsername, setIgUsername] = useState('');
  const [automations, setAutomations] = useState<DmAutomationItem[]>([]);
  const [logs, setLogs] = useState<DmAutomationSettings['logs']>([]);

  const [editing, setEditing] = useState<DmAutomationItem | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  const loadMedia = () => {
    setMediaLoading(true);
    apiService.getInstagramMedia(userName)
      .then((m) => setMedia(m))
      .finally(() => setMediaLoading(false));
  };

  const load = () => {
    apiService.getDmAutomation(userName).then((s) => {
      setEnabled(s.enabled);
      setConnected(Boolean(s.connected));
      setIgUsername(s.igUsername || '');
      setAutomations(Array.isArray(s.automations) ? s.automations.map(normalizeAutomation) : []);
      setLogs(s.logs || []);
      setLoaded(true);
      if (s.connected) loadMedia();
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userName]);

  // OAuth 연동 콜백 결과 처리 (?ig_connected / ?ig_error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ig_connected')) {
      setBanner({ type: 'ok', text: '인스타그램 계정이 연동되었습니다! 🎉' });
      // 연동 직후 바로 연동된 화면을 보여주고, 최신 정보를 다시 불러온다.
      setConnected(true);
      load();
      params.delete('ig_connected');
    } else if (params.get('ig_error')) {
      setBanner({ type: 'err', text: '연동에 실패했어요. 잠시 후 다시 시도해주세요.' });
      params.delete('ig_error');
    } else return;
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, []);

  const persist = async (next: Partial<DmAutomationSettings>) => {
    setSaving(true);
    const ok = await apiService.saveDmAutomation(userName, next);
    setSaving(false);
    if (ok) {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2200);
    } else {
      setBanner({ type: 'err', text: '저장에 실패했습니다. 다시 시도해주세요.' });
    }
    return ok;
  };

  const connect = () => { window.location.href = apiService.instagramConnectUrl(userName); };

  const disconnect = async () => {
    if (!window.confirm('인스타그램 계정 연동을 해제할까요? 자동화는 보관되지만 DM 발송이 중단됩니다.')) return;
    setDisconnecting(true);
    const ok = await apiService.disconnectInstagram(userName);
    setDisconnecting(false);
    if (ok) { setConnected(false); setEnabled(false); setIgUsername(''); setMedia([]); setBanner({ type: 'ok', text: '연동이 해제되었습니다.' }); }
  };

  const toggleMaster = () => { const v = !enabled; setEnabled(v); persist({ enabled: v }); };

  const saveAutomation = (a: DmAutomationItem) => {
    const exists = automations.some((x) => x.id === a.id);
    const next = exists ? automations.map((x) => (x.id === a.id ? a : x)) : [...automations, a];
    setAutomations(next);
    setEditing(null);
    persist({ automations: next });
  };
  const toggleAutomation = (id: string) => {
    const next = automations.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x));
    setAutomations(next);
    persist({ automations: next });
  };
  const deleteAutomation = (id: string) => {
    if (!window.confirm('이 자동화를 삭제할까요?')) return;
    const next = automations.filter((x) => x.id !== id);
    setAutomations(next);
    persist({ automations: next });
  };

  const activeCount = useMemo(() => automations.filter((a) => a.enabled).length, [automations]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-7 h-7 text-pink-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500 max-w-5xl mx-auto">
      {/* 헤더 */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-white shadow-lg shadow-pink-500/30">
            <Instagram className="w-6 h-6 md:w-7 md:h-7" />
          </div>
          <div>
            <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-0.5 md:mb-1">DM 자동화</h2>
            <p className="text-slate-500 font-medium text-[11px] md:text-base">
              댓글이 달리면 인스타그램 DM을 자동으로 보내드려요.
            </p>
          </div>
        </div>
        {savedAt && (
          <span className="text-green-600 text-[11px] md:text-sm font-bold flex items-center gap-1">
            <Check size={15} /> 저장됨
          </span>
        )}
      </header>

      {/* 배너 */}
      {banner && (
        <div className={`mb-5 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold ${
          banner.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100'
        }`}>
          {banner.type === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
          {banner.text}
        </div>
      )}

      {/* 계정 연동 카드 */}
      {!connected ? (
        <section className="relative overflow-hidden bg-gradient-to-br from-purple-600 via-pink-600 to-orange-500 p-6 md:p-10 rounded-3xl md:rounded-[2.5rem] shadow-xl shadow-pink-500/20 mb-6 text-white">
          <div className="absolute -right-8 -top-8 opacity-15">
            <Instagram className="w-40 h-40" />
          </div>
          <div className="relative">
            <span className="inline-block bg-white/20 rounded-full px-3 py-1 text-[11px] font-black mb-3">시작하기</span>
            <h3 className="text-xl md:text-3xl font-black mb-2 leading-snug">
              인스타그램 계정을 연동하고<br />자동 DM을 시작하세요
            </h3>
            <p className="text-white/80 text-xs md:text-sm font-medium mb-6 max-w-md">
              계정을 연동하면 게시물 댓글에 자동으로 DM을 보내 팔로워를 고객으로 전환할 수 있어요.
            </p>
            <button
              onClick={connect}
              className="inline-flex items-center gap-2 bg-white text-pink-600 rounded-2xl py-3.5 px-7 text-sm md:text-base font-black shadow-lg hover:scale-[1.02] transition-transform"
            >
              <Instagram size={18} /> 인스타그램 계정 연동하기
              <ChevronRight size={18} />
            </button>
            <p className="text-white/60 text-[11px] font-medium mt-3">
              연동 시 DM·댓글 관리 권한이 필요하며, 언제든지 해제할 수 있어요.
            </p>
          </div>
        </section>
      ) : (
        <section className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-white shrink-0">
              <Instagram size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900 text-base md:text-lg truncate">@{igUsername || '연결된 계정'}</span>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">● 연결됨</span>
              </div>
              <p className="text-[11px] md:text-xs text-slate-500 font-medium">인스타그램 비즈니스 계정 연동됨</p>
            </div>
          </div>
          <button
            onClick={disconnect}
            disabled={disconnecting}
            className="shrink-0 flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-red-500 border border-slate-200 rounded-xl px-3 py-2 transition-colors disabled:opacity-50"
          >
            {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />} 연동 해제
          </button>
        </section>
      )}

      {/* 전체 자동화 스위치 */}
      {connected && (
        <section className="bg-slate-900 p-5 md:p-6 rounded-3xl shadow-lg mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-white">
            <Zap className={`w-6 h-6 shrink-0 ${enabled ? 'text-yellow-300' : 'text-slate-500'}`} />
            <div>
              <h3 className="text-base md:text-lg font-black">자동 발송 {enabled ? 'ON' : 'OFF'}</h3>
              <p className="text-[11px] md:text-sm text-slate-400 font-medium">
                {enabled ? `${activeCount}개의 자동화가 실행 중이에요.` : '켜면 아래 자동화가 작동합니다.'}
              </p>
            </div>
          </div>
          <Toggle on={enabled} onClick={toggleMaster} />
        </section>
      )}

      {/* 연동 계정 피드 게시물 */}
      {connected && (
        <section className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2">
              <LayoutGrid size={17} className="text-slate-400" /> 내 피드 게시물
            </h3>
            <span className="text-xs font-black text-slate-400">{media.length}개</span>
          </div>
          {mediaLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 size={18} className="animate-spin" /> <span className="text-sm font-bold">게시물을 불러오는 중…</span>
            </div>
          ) : media.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
              <ImageIcon size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-500">불러올 게시물이 없어요</p>
              <p className="text-xs text-slate-400 mt-1">인스타그램에 게시물을 올린 뒤 다시 확인해주세요.</p>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-slate-500 font-medium mb-3">
                게시물을 눌러 해당 게시물에 자동 DM을 설정하세요. 선택한 게시물의 댓글에만 자동으로 반응해요.
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {media.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setEditing({ ...blankAutomation(), mediaScope: 'selected', mediaIds: [m.id] })}
                    className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group border border-slate-100"
                    title="이 게시물로 자동화 만들기"
                  >
                    {m.mediaUrl
                      ? <img src={m.mediaUrl} alt={m.caption.slice(0, 40)} className="w-full h-full object-cover" loading="lazy" />
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={20} className="text-slate-300" /></div>}
                    <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/40 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white text-pink-600 rounded-full px-2.5 py-1 text-[11px] font-black shadow">
                        <Plus size={12} /> 자동화
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* 자동화 목록 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg md:text-xl font-black text-slate-900">내 자동화</h3>
            <span className="text-xs font-black text-slate-400">총 {automations.length}개</span>
          </div>
          {connected && (
            <button
              onClick={() => setEditing(blankAutomation())}
              className="flex items-center gap-1.5 bg-gradient-to-r from-pink-600 to-orange-500 text-white rounded-xl py-2.5 px-4 text-sm font-black shadow-lg shadow-pink-500/25 hover:opacity-95"
            >
              <Plus size={16} /> 자동화 추가하기
            </button>
          )}
        </div>

        {!connected ? (
          <div className="text-center py-14 border border-dashed border-slate-200 rounded-3xl bg-slate-50/60">
            <Instagram size={30} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-bold text-sm">계정을 먼저 연동해주세요</p>
            <p className="text-slate-400 text-xs mt-1">연동 후 자동화를 추가할 수 있어요.</p>
          </div>
        ) : automations.length === 0 ? (
          <div className="text-center py-14 border border-dashed border-slate-200 rounded-3xl bg-slate-50/60">
            <MessageSquare size={30} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600 font-black text-sm">아직 만든 자동화가 없어요</p>
            <p className="text-slate-400 text-xs mt-1 mb-5">인스타그램 자동화로 팔로워를 고객으로 전환해보세요.</p>
            <button
              onClick={() => setEditing(blankAutomation())}
              className="inline-flex items-center gap-1.5 bg-pink-600 text-white rounded-xl py-2.5 px-5 text-sm font-black hover:bg-pink-700"
            >
              <Plus size={16} /> 첫 자동화 만들기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {automations.map((a) => (
              <div key={a.id} className={`bg-white rounded-3xl border p-5 shadow-sm transition-all ${a.enabled ? 'border-slate-100' : 'border-slate-100 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center shrink-0">
                      <MessageCircle size={17} />
                    </div>
                    <h4 className="font-black text-slate-900 text-sm md:text-base truncate">{a.name}</h4>
                  </div>
                  <Toggle on={a.enabled} onClick={() => toggleAutomation(a.id)} size="sm" />
                </div>

                {/* 조건 요약 칩 */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                    <LayoutGrid size={11} />
                    {a.mediaScope === 'selected' ? `게시물 ${a.mediaIds?.length || 0}개` : '모든 게시물'}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                    <MessageSquare size={11} />
                    {a.commentMatch === 'all' ? '모든 댓글' : `키워드 ${a.keywords.length}개`}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                    <Users size={11} /> {FOLLOW_LABEL[a.followFilter]}
                  </span>
                  {a.messageType === 'carousel' && (
                    <span className="inline-flex items-center gap-1 bg-pink-100 text-pink-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                      <GalleryHorizontalEnd size={11} /> 캐러셀 {a.cards?.filter((c) => c.title || c.imageUrl).length || 0}장
                    </span>
                  )}
                  {a.replyEnabled && (
                    <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                      <Reply size={11} /> 답글 {a.replies.filter(Boolean).length}개
                    </span>
                  )}
                  {a.messageType !== 'carousel' && a.buttons.filter((b) => b.label).length > 0 && (
                    <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                      <Link2 size={11} /> 버튼 {a.buttons.filter((b) => b.label).length}개
                    </span>
                  )}
                </div>

                <div className="flex items-start gap-1.5 text-[12px] text-slate-500 font-medium bg-slate-50 rounded-xl px-3 py-2.5 mb-3">
                  <CornerDownRight size={13} className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="line-clamp-2">
                    {a.messageType === 'carousel'
                      ? (a.cards?.find((c) => c.title)?.title || '이미지 카드 캐러셀 메시지')
                      : a.message}
                  </span>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setEditing(a)} className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl py-2 text-xs font-black hover:bg-slate-200">
                    <Pencil size={13} /> 편집
                  </button>
                  <button onClick={() => deleteAutomation(a.id)} className="w-10 rounded-xl text-red-400 hover:bg-red-50 flex items-center justify-center">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 최근 발송 기록 */}
      {logs && logs.length > 0 && (
        <section className="bg-white p-5 md:p-7 rounded-3xl border border-slate-100 shadow-sm mt-6">
          <h3 className="text-base md:text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
            <Send size={16} className="text-slate-400" /> 최근 발송 기록
          </h3>
          <div className="space-y-2">
            {logs.map((log, i) => (
              <div key={i} className="flex items-center gap-3 bg-slate-50/70 border border-slate-100 rounded-xl px-4 py-2.5">
                <span className={`text-[10px] font-black px-2 py-1 rounded-full shrink-0 ${
                  log.status === 'sent' ? 'bg-green-100 text-green-700'
                    : log.status === 'failed' ? 'bg-red-100 text-red-600'
                    : 'bg-slate-200 text-slate-500'
                }`}>
                  {log.status === 'sent' ? '전송' : log.status === 'failed' ? '실패' : '건너뜀'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-700 truncate">
                    {log.recipientId ? `→ ${log.recipientId}` : '수신자 미지정'}
                    {log.test && <span className="ml-1 text-blue-500">(테스트)</span>}
                  </p>
                  {(log.error || log.reason) && (
                    <p className="text-[10px] text-red-400 font-medium truncate">{log.error || log.reason}</p>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 font-bold shrink-0">
                  {new Date(log.at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 성과 요약 (연결 시) */}
      {connected && automations.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mt-6">
          {[
            { icon: <Send size={16} />, label: '활성 자동화', value: `${activeCount}개` },
            { icon: <Eye size={16} />, label: '전체 자동화', value: `${automations.length}개` },
            { icon: <MousePointerClick size={16} />, label: '상태', value: enabled ? '작동 중' : '중지됨' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 text-center">
              <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center mx-auto mb-2">{s.icon}</div>
              <p className="text-lg font-black text-slate-900">{s.value}</p>
              <p className="text-[10px] text-slate-400 font-bold">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AutomationEditor
          initial={editing}
          igUsername={igUsername}
          media={media}
          mediaLoading={mediaLoading}
          onClose={() => setEditing(null)}
          onSave={saveAutomation}
        />
      )}
    </div>
  );
};

export default DmAutomation;
