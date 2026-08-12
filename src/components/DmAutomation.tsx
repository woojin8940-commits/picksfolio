import React, { useEffect, useMemo, useState } from 'react';
import {
  Instagram, Check, Plus, Trash2, Send, Loader2, MessageSquare, MessageCircle,
  Zap, Link2, X, ChevronRight, Sparkles, AlertCircle, Pencil, Power, Users,
  CornerDownRight, Hash, Reply, Eye, MousePointerClick, Image as ImageIcon,
  LayoutGrid, AlignLeft, GalleryHorizontalEnd,
} from 'lucide-react';
import { apiService, DmAutomationSettings, DmAutomationItem, DmMessageButton, DmCarouselCard, InstagramMedia } from '../services/apiService';
import { isNativeApp } from '../utils/appEnv';
import { useLanguage } from '../contexts/LanguageContext';
import ManualDmModal from './ManualDmModal';

interface DmAutomationProps {
  userName: string;
}

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const blankCard = (): DmCarouselCard => ({
  id: genId('card'), title: '', subtitle: '', imageUrl: '', buttonLabel: '', buttonUrl: '',
});

/**
 * 새 자동화의 기본 문구는 화면 언어를 따라간다.
 *
 * 이 값은 화면 문구가 아니라 저장돼서 그대로 인스타그램으로 나가는 내용이다.
 * 예전에는 한국어 문장을 그대로 심어 놨는데, 영어로 쓰는 사용자는 화면 번역을
 * 거친 영어를 읽으면서 실제로는 한국어 DM 을 저장하게 됐다. 기본 문구를 아예
 * 언어별로 두면 "보이는 문구 = 발송될 문구"가 처음부터 맞는다.
 */
type TranslateFn = (key: string, defaultKo?: string, defaultEn?: string) => string;

const defaultDmMessage = (t: TranslateFn) => t(
  'dm.defaultMessage',
  '안녕하세요! 관심 가져주셔서 감사합니다 😊 아래 링크에서 더 많은 정보를 확인해보세요.',
  'Hello! Thank you for your interest 😊 Check out more information at the link below.',
);

const defaultButtonLabel = (t: TranslateFn) => t('dm.defaultButtonLabel', '링크 바로가기', 'Open link');

const blankAutomation = (t: TranslateFn): DmAutomationItem => ({
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
  message: defaultDmMessage(t),
  buttons: [{ id: genId('btn'), label: defaultButtonLabel(t), url: '' }],
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

/**
 * 저장 직전에 링크를 정리한다. `example.com/abc` 처럼 스킴만 빠진 입력은 살려주고,
 * 그래도 http/https 가 아니면 빈 문자열을 돌려준다(= 저장 불가).
 * 서버 `_shared/instagram-dm.mts` 의 normalizeLinkUrl 과 규칙을 맞춰 둔다.
 */
const normalizeLinkUrl = (raw: string): string => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (isValidLinkUrl(trimmed)) return trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    if (isValidLinkUrl(withScheme)) return withScheme;
  }
  return '';
};

/** 입력값이 링크로 쓸 수 없는 상태인지(비어 있지 않은데 정규화도 안 되는 경우). */
const linkUrlBroken = (raw: string): boolean => Boolean((raw || '').trim()) && !normalizeLinkUrl(raw);

/* ─────────── 자동화 카드에 표시하는 대상 피드 썸네일 ─────────── */
// 자동화 목록만 보고는 "어떤 게시물에 걸어둔 자동화인지" 알 수 없으므로, 카드마다 대상
// 게시물의 피드 이미지를 함께 보여준다. 선택형(selected)은 지정한 게시물 그대로,
// 전체(all)는 실제로 전 피드에 적용되므로 최신 게시물 몇 개를 대표 이미지로 노출한다.
const MAX_FEED_THUMBS = 4;

// 썸네일이 44px 였을 때는 "어떤 피드인지" 알아볼 수 없다는 피드백이 있었다. 한 변을
// 5rem(모바일)~6rem(데스크톱)으로 키워 게시물 사진이 한눈에 구분되게 한다. 여러 장이면
// 카드 폭을 넘길 수 있으므로 줄바꿈을 허용하고, 설명 문구는 썸네일 옆이 아니라 아래로
// 내려 이미지가 쓸 수 있는 폭을 최대한 확보한다.
const THUMB_SIZE = 'w-20 h-20 md:w-24 md:h-24';

const AutomationFeedThumbs: React.FC<{
  media: InstagramMedia[];
  loading: boolean;
  scope: DmAutomationItem['mediaScope'];
  mediaIds: string[];
}> = ({ media, loading, scope, mediaIds }) => {
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const targetIds = scope === 'selected' ? mediaIds : media.map((m) => m.id);
  const shown = targetIds.slice(0, MAX_FEED_THUMBS);
  const overflow = Math.max(0, targetIds.length - shown.length);

  if (loading && shown.length === 0) {
    return (
      <div className="mb-3">
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${THUMB_SIZE} rounded-xl bg-slate-100 animate-pulse`} />
          ))}
        </div>
      </div>
    );
  }

  // 선택형인데 대상이 없으면(또는 게시물이 삭제됨) 사용자가 알아챌 수 있게 안내한다.
  if (shown.length === 0) {
    if (scope !== 'selected') return null;
    return (
      <div className="flex items-center gap-1.5 mb-3 text-[11px] font-bold text-slate-400">
        <ImageIcon size={13} /> 대상 게시물이 지정되지 않았어요
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        {shown.map((id) => {
          const m = byId.get(id);
          const thumb = m?.mediaUrl || m?.thumbnailUrl || '';
          const label = m?.caption?.slice(0, 60) || '연동된 피드 게시물';
          const inner = thumb
            ? <img src={thumb} alt={label} className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={22} className="text-slate-300" /></div>;
          return m?.permalink ? (
            <a
              key={id}
              href={m.permalink}
              target="_blank"
              rel="noopener noreferrer"
              title={label}
              className={`${THUMB_SIZE} rounded-xl overflow-hidden bg-slate-100 border border-slate-200 hover:border-pink-300 transition-colors block shrink-0`}
            >
              {inner}
            </a>
          ) : (
            <div
              key={id}
              title={label}
              className={`${THUMB_SIZE} rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0`}
            >
              {inner}
            </div>
          );
        })}
        {overflow > 0 && (
          <div className={`${THUMB_SIZE} rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-black text-slate-500 shrink-0`}>
            +{overflow}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] font-bold text-slate-400 leading-tight">
        {scope === 'selected' ? '이 게시물 댓글에만 반응' : '모든 게시물 댓글에 반응'}
      </p>
    </div>
  );
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
                    {c.title
                      ? <p data-user-content className="text-[12px] font-black text-slate-800 truncate">{c.title}</p>
                      : <p className="text-[12px] font-black text-slate-800 truncate">카드 제목</p>}
                    {c.subtitle && <p data-user-content className="text-[11px] text-slate-500 font-medium truncate">{c.subtitle}</p>}
                    {c.buttonLabel && (
                      <div data-user-content className="mt-2 text-center bg-slate-50 border border-slate-200 rounded-lg py-1.5 text-[11px] font-bold text-pink-600 truncate">
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
                  {message
                    ? (
                      <p data-user-content className="text-[13px] text-slate-700 font-medium leading-relaxed whitespace-pre-wrap break-words">
                        {message}
                      </p>
                    )
                    : (
                      <p className="text-[13px] text-slate-700 font-medium leading-relaxed whitespace-pre-wrap break-words">
                        보낼 메시지를 입력하면 여기에 표시됩니다.
                      </p>
                    )}
                </div>
              )}
              {validButtons.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md overflow-hidden shadow-sm">
                  {splitBubbles ? (
                    <p className="px-4 py-3 text-[13px] text-slate-700 font-bold leading-relaxed whitespace-pre-wrap break-words">
                      👇 아래 버튼을 눌러주세요
                    </p>
                  ) : (
                    <p data-user-content className="px-4 py-3 text-[13px] text-slate-700 font-bold leading-relaxed whitespace-pre-wrap break-words">
                      {message}
                    </p>
                  )}
                  <div className="border-t border-slate-100">
                    {validButtons.map((b) => (
                      <div
                        key={b.id}
                        data-user-content
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

  // 링크가 잘못돼 있으면 발송 시점에 그 버튼이 조용히 빠진다. 저장 자체를 막아
  // "설정은 저장됐는데 버튼만 안 보이는" 상황을 없앤다.
  const brokenLinks =
    draft.buttons.some((b) => linkUrlBroken(b.url) || (Boolean(b.label.trim()) && !b.url.trim())) ||
    draft.cards.some((c) => linkUrlBroken(c.buttonUrl) || (Boolean(c.buttonLabel.trim()) && !c.buttonUrl.trim()));

  const canSave = messageValid &&
    mediaValid &&
    !brokenLinks &&
    (draft.commentMatch === 'all' || draft.keywords.length > 0);

  const handleSave = () => {
    if (!canSave) return;
    // 스킴이 빠진 주소(`example.com`)는 여기서 https:// 를 붙여 저장한다.
    onSave({
      ...draft,
      name: draft.name.trim() || (draft.commentMatch === 'keyword' ? `키워드 DM` : '댓글 DM'),
      buttons: draft.buttons.map((b) => ({ ...b, url: normalizeLinkUrl(b.url) })),
      cards: draft.cards.map((c) => ({ ...c, buttonUrl: normalizeLinkUrl(c.buttonUrl) })),
    });
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
                      // URL 이 비어 있거나 http/https 로 고칠 수 없으면 저장을 막는다.
                      const urlInvalid = linkUrlBroken(b.url) || (Boolean(b.label.trim()) && !b.url.trim());
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
                        )}                      </div>
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
                  {draft.cards.map((c, i) => {
                    // 카드 버튼도 링크가 잘못되면 발송 시 통째로 빠진다.
                    const cardUrlInvalid =
                      linkUrlBroken(c.buttonUrl) || (Boolean(c.buttonLabel.trim()) && !c.buttonUrl.trim());
                    return (
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
                          className={`bg-white border rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500 ${
                            cardUrlInvalid ? 'border-red-300' : 'border-slate-200'
                          }`}
                        />
                      </div>
                      {cardUrlInvalid && (
                        <p className="flex items-center gap-1 px-1 text-[10px] font-bold text-red-500">
                          <AlertCircle size={11} />
                          https:// 로 시작하는 주소를 입력해야 카드 버튼이 전송됩니다.
                        </p>
                      )}
                    </div>
                    );
                  })}
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
const Toggle: React.FC<{ on: boolean; onClick: () => void; size?: 'sm' | 'md'; disabled?: boolean }> = ({ on, onClick, size = 'md', disabled = false }) => {
  const s = size === 'sm' ? { w: 'w-10', h: 'h-6', k: 'w-4 h-4', on: 'left-5', off: 'left-1' } : { w: 'w-12', h: 'h-7', k: 'w-5 h-5', on: 'left-6', off: 'left-1' };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={`relative ${s.w} ${s.h} rounded-full transition-all shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${on ? 'bg-pink-500' : 'bg-slate-300'}`}
      aria-label="켜기/끄기"
    >
      <span className={`absolute top-1 ${s.k} bg-white rounded-full shadow transition-all ${on ? s.on : s.off}`} />
    </button>
  );
};

/* ────────────────────────── 메인 컴포넌트 ────────────────────────── */
const DmAutomation: React.FC<DmAutomationProps> = ({ userName }) => {
  const { t } = useLanguage();
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualModalRule, setManualModalRule] = useState<DmAutomationItem | null>(null);

  const [loaded, setLoaded] = useState(false);
  // 설정을 받아오지 못한 상태. 예전에는 이 경우를 구분하지 않아서, 응답이 오지
  // 않으면 스피너가 그대로 남았고(화면이 "계속 로딩 중"), 응답 실패를 자격 없음으로
  // 삼키면 프로 플랜 사용자에게 결제 안내가 떴다. 실패는 실패로 보여 준다.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  // 저장이 진행 중인 동안에는 토글·삭제를 막는다. 두 번의 저장이 겹치면 나중에 끝난
  // 요청이 앞선 변경을 덮어써 자동화가 되살아나거나 사라진 것처럼 보인다.
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [igUsername, setIgUsername] = useState('');
  // 인스타그램 장기 토큰은 60일이면 만료된다. 만료되면 "연결됨"으로 보이지만 발송은
  // 전부 실패하므로, 남은 기간을 화면에서 알려 재연동을 유도한다.
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | undefined>(undefined);
  const [automations, setAutomations] = useState<DmAutomationItem[]>([]);

  const [editing, setEditing] = useState<DmAutomationItem | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  // 디엠 자동화는 프로 플랜 전용 기능이다. 서버가 계정 자격(entitled)을 함께 내려주며,
  // 자격이 없으면 저장·발송이 403 으로 막히므로 화면에서도 업그레이드 안내를 보여준다.
  const [entitled, setEntitled] = useState(true);

  /**
   * 이 앱이 보내지 않았는데 계정에서 나간 자동 DM.
   *
   * 인스타그램 자체 자동 메시지나 예전에 연결해 둔 다른 자동화 서비스가 보내는
   * 경우다. 여기 설정과 무관하게 나가기 때문에, 문구를 바꿔도 예전 문구가 함께
   * 도착하거나 자동 발송을 꺼도 DM 이 간다. 감지되면 끄는 방법을 안내한다.
   */
  const [externalDm, setExternalDm] = useState<DmAutomationSettings['externalDm']>(null);
  /** 발신 에코 구독 여부. 꺼져 있으면 외부 자동 DM 을 감지할 수 없다. */
  const [echoSubscribed, setEchoSubscribed] = useState(true);

  const loadMedia = () => {
    setMediaLoading(true);
    apiService.getInstagramMedia(userName)
      .then((m) => setMedia(m))
      .catch(() => setMedia([]))
      .finally(() => setMediaLoading(false));
  };

  const load = () => {
    setReloading(true);
    apiService.getDmAutomation(userName)
      .then((s) => {
        if (s.loadError) {
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        setEnabled(s.enabled);
        setConnected(Boolean(s.connected));
        setIgUsername(s.igUsername || '');
        setTokenExpiresAt(s.tokenExpiresAt);
        setAutomations(Array.isArray(s.automations) ? s.automations.map(normalizeAutomation) : []);
        setEntitled(s.entitled !== false);
        setExternalDm(s.externalDm || null);
        setEchoSubscribed(s.echoSubscribed !== false);
        setLoaded(true);
        if (s.connected) loadMedia();
      })
      // getDmAutomation 은 스스로 오류를 삼키지만, 앞으로 구현이 바뀌어도 스피너가
      // 남지 않도록 여기서도 반드시 끝을 만든다.
      .catch((e) => {
        console.error('[DmAutomation] 설정을 불러오지 못했습니다:', e);
        setLoadFailed(true);
      })
      .finally(() => setReloading(false));
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
    // 콜백이 함께 실어 보내는 지표 동기화 결과 — 이 화면에서는 쓰지 않으므로 지운다.
    params.delete('ig_metrics');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, []);

  /** 외부 자동 DM 안내를 닫는다. 다시 감지되면 서버가 새로 기록해 또 보여준다. */
  const dismissExternalDm = () => {
    setExternalDm(null);
    apiService.dismissExternalDm(userName).catch(() => undefined);
  };

  const persist = async (next: Partial<DmAutomationSettings> & {    action?: 'upsertAutomation' | 'deleteAutomation';
    automation?: DmAutomationItem;
    id?: string;
  }) => {
    if (!entitled) {
      setBanner({ type: 'err', text: '디엠 자동화는 프로 플랜(월 18,700원) 전용 기능이에요. 멤버십에서 프로 플랜을 구독하면 바로 사용할 수 있어요.' });
      return { ok: false as const };
    }
    setSaving(true);
    const result = await apiService.saveDmAutomation(userName, next);
    setSaving(false);
    if (result.ok) {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2200);
      setBanner(null);
    } else {
      setBanner({ type: 'err', text: result.error || '저장에 실패했습니다. 다시 시도해주세요.' });
    }
    return result;
  };

  const connect = async () => {
    const result = await apiService.instagramConnectUrl(userName);
    if (!result.url) {
      setBanner({ type: 'err', text: result.error || '연동을 시작하지 못했습니다.' });
      return;
    }
    window.location.href = result.url;
  };

  const disconnect = async () => {
    if (!window.confirm('인스타그램 계정 연동을 해제할까요? 자동화는 보관되지만 DM 발송이 중단됩니다.')) return;
    setDisconnecting(true);
    const ok = await apiService.disconnectInstagram(userName);
    setDisconnecting(false);
    if (ok) { setConnected(false); setEnabled(false); setIgUsername(''); setTokenExpiresAt(undefined); setMedia([]); setBanner({ type: 'ok', text: '연동이 해제되었습니다.' }); }
  };

  // 저장이 실패하면(플랜 없음 · 네트워크 오류) 화면만 바뀌고 서버는 그대로여서, 새로고침
  // 하면 변경이 사라진 것처럼 보인다. 낙관적으로 먼저 반영하되 실패하면 직전 값으로
  // 되돌려 화면과 서버 상태가 어긋나지 않게 한다.
  const toggleMaster = async () => {
    const prev = enabled;
    const v = !enabled;
    setEnabled(v);
    const { ok } = await persist({ enabled: v });
    if (!ok) setEnabled(prev);
  };

  /**
   * 자동화 한 건을 저장한다.
   *
   * 목록 전체를 보내지 않고 바뀐 한 건만 보낸다. 목록 전체를 보내면 저장이 겹칠 때
   * 늦게 도착한 옛 목록이 방금 고친 메시지를 되돌려, 화면에는 새 문구가 보이는데
   * 실제 DM 은 예전 문구로 나갔다. 저장 뒤에는 서버가 돌려준 목록으로 화면을 맞춰
   * "보이는 내용 = 발송될 내용"을 보장한다.
   *
   * 전체 스위치(자동 발송)는 여기서 절대 건드리지 않는다.
   *
   * 예전에는 켜진 자동화를 저장하면 "이걸 돌려 달라는 뜻"으로 보고 전체 스위치까지
   * 같이 켰다. 그런데 새 자동화는 항상 켜진 상태로 만들어지기 때문에, 자동 발송을
   * 일부러 꺼 둔 사람이 문구를 다듬거나 자동화 하나를 켜기만 해도 전체 스위치가
   * 조용히 다시 켜졌다. 사용자 입장에서는 "발송 버튼은 꺼 놨는데 댓글이 달리니 예전에
   * 설정해 둔 메시지가 나갔다"가 된다. 끄는 건 사용자의 명시적인 의사이므로, 다시
   * 켜는 것도 사용자가 스위치를 눌렀을 때만 일어나야 한다.
   *
   * 대신 전체 스위치가 꺼진 채로 자동화를 저장하면 "지금은 작동하지 않는다"를 알려
   * 준다. 목록 위의 안내 배너에서 바로 켤 수 있다.
   */
  const commitAutomation = async (automation: DmAutomationItem) => {
    const prev = automations;
    const exists = prev.some((x) => x.id === automation.id);
    setAutomations(exists ? prev.map((x) => (x.id === automation.id ? automation : x)) : [...prev, automation]);
    const result = await persist({ action: 'upsertAutomation', automation });
    // 저장에 실패하면 서버가 최신 목록을 함께 준 경우(다른 곳에서 먼저 수정) 그 값을,
    // 아니면 직전 화면 값을 쓴다. 어느 쪽이든 화면은 실제 저장 상태를 따라간다.
    if (!result.ok) {
      setAutomations(result.automations ? result.automations.map(normalizeAutomation) : prev);
      return;
    }
    if (result.automations) setAutomations(result.automations.map(normalizeAutomation));
    // 서버가 확정한 전체 스위치 상태를 그대로 따른다(저장 요청은 이 값을 바꾸지 않는다).
    const masterOn = typeof result.enabled === 'boolean' ? result.enabled : enabled;
    if (typeof result.enabled === 'boolean') setEnabled(result.enabled);
    if (automation.enabled && !masterOn) {
      setBanner({
        type: 'ok',
        text: '저장했어요. 다만 자동 발송 스위치가 꺼져 있어 새 댓글에는 아직 DM이 나가지 않습니다. 발송하려면 위의 자동 발송을 켜주세요.',
      });
    }
  };

  const saveAutomation = (a: DmAutomationItem) => {
    setEditing(null);
    void commitAutomation(a);
  };
  const toggleAutomation = (id: string) => {
    const target = automations.find((x) => x.id === id);
    if (!target) return;
    void commitAutomation({ ...target, enabled: !target.enabled });
  };
  const deleteAutomation = async (id: string) => {
    if (!window.confirm('이 자동화를 삭제할까요?')) return;
    const prev = automations;
    setAutomations(prev.filter((x) => x.id !== id));
    const result = await persist({ action: 'deleteAutomation', id });
    if (!result.ok) {
      setAutomations(result.automations ? result.automations.map(normalizeAutomation) : prev);
      return;
    }
    if (result.automations) setAutomations(result.automations.map(normalizeAutomation));
  };

  const activeCount = useMemo(() => automations.filter((a) => a.enabled).length, [automations]);

  /**
   * 게시물에서 "수동발송"을 누를 때 어떤 문구를 채워 넣을지 고른다.
   *
   * 예전에는 언제나 기본 예시 문구로 시작했다. 그래서 그 게시물에 이미 자동화를
   * 걸어 둔 사람이 수동발송을 누르면, 방금 저장한 자기 문구가 아니라 기본 예시
   * 문구가 채워진 채 발송돼 "설정한 메시지가 아닌 엉뚱한 메시지가 나갔다"가 됐다.
   * 그 게시물에 걸린 자동화가 있으면 가장 최근에 설정한 것을 그대로 쓴다.
   */
  const configuredAt = (a: DmAutomationItem) => {
    const ms = Date.parse(a.updatedAt || a.createdAt || '');
    return Number.isNaN(ms) ? 0 : ms;
  };

  const manualRuleForMedia = (mediaId: string, caption: string): DmAutomationItem => {
    const targeting = automations
      .filter((a) => a.mediaScope === 'selected' && (a.mediaIds || []).includes(mediaId))
      .sort((x, y) => Number(y.enabled) - Number(x.enabled) || configuredAt(y) - configuredAt(x));
    if (targeting.length > 0) return targeting[0];
    return {
      ...blankAutomation(t),
      name: caption ? caption.slice(0, 20) : '선택한 게시물',
      mediaScope: 'selected',
      mediaIds: [mediaId],
    };
  };

  // 만료됐거나 임박한 토큰만 알린다. 평소에는 배지를 띄우지 않는다(하루 한 번 도는
  // scheduled-instagram-token-refresh 가 미리 갱신한다).
  const tokenStatus = useMemo(() => {
    if (!connected || !tokenExpiresAt) return null;
    const ms = new Date(tokenExpiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return { expired: true, days: 0 };
    const days = Math.ceil(ms / 86_400_000);
    return days <= 7 ? { expired: false, days } : null;
  }, [connected, tokenExpiresAt]);

  // 아직 한 번도 못 불러왔는데 실패했다면, 스피너를 계속 돌리는 대신 이유와 재시도를
  // 준다. 로그인이 풀렸거나(401) 네트워크가 끊긴 경우가 대부분이다.
  if (!loaded && loadFailed) {
    return (
      <div className="p-4 md:p-14 w-full max-w-2xl mx-auto">
        <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 md:p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-slate-400" />
          </div>
          <h2 className="text-lg md:text-xl font-black text-slate-900 mb-2">
            DM 자동화 설정을 불러오지 못했습니다.
          </h2>
          <p className="text-slate-500 text-xs md:text-sm font-medium leading-relaxed mb-6">
            네트워크가 불안정하거나 로그인이 만료되었을 수 있어요.
            <br />
            다시 시도해도 같으면 로그아웃 후 다시 로그인해 주세요.
          </p>
          <button
            type="button"
            onClick={load}
            disabled={reloading}
            className="px-6 py-3 rounded-xl font-black text-sm text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 transition-all shadow-md"
          >
            {reloading ? '불러오는 중...' : '다시 시도'}
          </button>
        </div>
      </div>
    );
  }

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

      {/* 한 번 불러온 뒤의 새로고침이 실패한 경우. 이미 보여 준 내용을 지우면 작업
          중이던 것이 사라지므로, 오래된 내용일 수 있다는 사실만 알리고 남겨 둔다. */}
      {loadFailed && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-bold text-amber-700">
            <AlertCircle size={16} /> 최신 설정을 불러오지 못했어요. 화면의 내용이 오래되었을 수 있습니다.
          </span>
          <button
            type="button"
            onClick={load}
            disabled={reloading}
            className="px-3 py-1.5 rounded-lg bg-white text-amber-700 border border-amber-200 text-xs font-black hover:bg-amber-100 disabled:opacity-50"
          >
            {reloading ? '불러오는 중...' : '다시 불러오기'}
          </button>
        </div>
      )}

      {/* 프로 플랜 안내 — 자격이 없으면 저장·발송이 막히므로 먼저 알려준다.
          다른 멤버십 안내(멤버십 게이트 · 타임라인 AI 게이트)와 같은 밝은 카드
          형태로 맞추고, 색도 멤버십 화면의 프로 플랜 카드와 같은 계열로 쓴다. */}
      {!entitled && (
        <section className="mb-6 rounded-2xl border-2 border-indigo-200 bg-white p-6 md:p-8 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-xl shrink-0 shadow-md">
              🚀
            </div>
            <div className="min-w-0">
              <h3 className="text-base md:text-lg font-black text-slate-900">디엠 자동화는 프로 플랜 전용 기능입니다</h3>
              {isNativeApp() ? (
                <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 leading-relaxed">
                  프로 플랜에 가입하면 모든 멤버십 혜택과 함께 인스타그램 디엠 자동화를 사용할 수 있어요.
                  가입은 PICKS Folio 웹사이트에서 할 수 있으며, 웹에서 가입하면 앱에서도 그대로 이용됩니다.
                </p>
              ) : (
                <>
                  <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 leading-relaxed">
                    프로 플랜(월 18,700원 · 부가세 포함)을 구독하면 모든 멤버십 플랜 혜택과 함께 인스타그램 디엠 자동화를
                    사용할 수 있어요. 구독 전에는 자동화를 저장하거나 자동 DM 을 발송할 수 없습니다.
                  </p>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('navigate-membership'))}
                    className="mt-4 px-5 py-2.5 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 transition-all shadow-md hover:shadow-lg"
                  >
                    멤버십 플랜 보기
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
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
        <section className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm mb-5">
          <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-white shrink-0">
              <Instagram size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900 text-base md:text-lg truncate">@{igUsername || '연결된 계정'}</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${
                  tokenStatus?.expired ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
                }`}>
                  {tokenStatus?.expired ? '● 연결 만료' : '● 연결됨'}
                </span>
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
          </div>

          {/* 토큰이 만료됐거나 임박하면 재연동을 안내한다. 만료 상태에서는 화면상
              "연결됨"으로 보여도 DM 이 한 건도 나가지 않는다. */}
          {tokenStatus && (
            <div className={`mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-xs font-bold ${
              tokenStatus.expired ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-amber-50 text-amber-700 border border-amber-100'
            }`}>
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p>
                  {tokenStatus.expired
                    ? '인스타그램 연동이 만료되어 자동 DM 이 발송되지 않습니다.'
                    : `인스타그램 연동이 ${tokenStatus.days}일 뒤 만료됩니다.`}
                </p>
                <button onClick={connect} className="mt-1 underline underline-offset-2">
                  지금 다시 연동하기
                </button>
              </div>
            </div>
          )}
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
                {enabled
                  ? `${activeCount}개의 자동화가 실행 중이에요.`
                  : '꺼져 있으면 이 앱에서는 DM을 보내지 않아요. 켜면 아래 자동화가 작동합니다.'}
              </p>
            </div>
          </div>
          <Toggle on={enabled && entitled} onClick={toggleMaster} disabled={saving} />
        </section>
      )}

      {/* 이 앱이 보내지 않은 자동 DM 감지 안내.
          인스타그램 자체 자동 메시지나 예전에 연결해 둔 다른 자동화 서비스는 이 화면의
          설정과 무관하게 발송된다. 그래서 문구를 바꿔도 예전 문구가 함께 도착하고,
          자동 발송을 꺼도 DM 이 나간다. 어디서 끄는지 알려주지 않으면 사용자는 이 앱이
          예전 메시지를 보낸다고 생각할 수밖에 없다. */}
      {connected && externalDm && (
        <section className="mb-6 rounded-3xl border border-red-200 bg-red-50 p-5 md:p-6">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-red-500 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm md:text-base font-black text-red-800">
                이 앱이 보내지 않은 자동 DM이 감지됐어요
              </h3>
              <p className="text-[12px] md:text-sm text-red-700 font-medium mt-1">
                댓글 직후 아래 문구가 발송됐는데, 이 화면의 자동화가 보낸 메시지가 아니에요.
                인스타그램(메타) 자체 자동 메시지이거나, 예전에 연결해 둔 다른 DM 자동화
                서비스에서 나간 것입니다. <span className="font-black">그래서 여기서 문구를 바꾸거나
                자동 발송을 꺼도 이 메시지는 계속 도착합니다.</span>
              </p>
              <blockquote className="mt-3 rounded-2xl bg-white border border-red-100 px-4 py-3 text-[12px] md:text-sm text-slate-700 font-medium whitespace-pre-wrap break-words">
                {externalDm.text}
              </blockquote>
              <p className="text-[11px] text-red-600 font-bold mt-1.5">
                마지막 감지: {externalDm.at ? new Date(externalDm.at).toLocaleString('ko-KR') : '-'}
                {externalDm.count > 1 ? ` · ${externalDm.count}회` : ''}
              </p>
              <div className="mt-3 rounded-2xl bg-white/70 border border-red-100 px-4 py-3">
                <p className="text-[12px] font-black text-red-800 mb-1.5">끄는 방법</p>
                <ol className="text-[12px] text-red-700 font-medium space-y-1 list-decimal list-inside">
                  <li>인스타그램 앱 → 프로페셔널 대시보드 → 자동 메시지(자동 답장)에서 위 문구를 찾아 끕니다.</li>
                  <li>Meta Business Suite → 받은 메시지함 → 자동화에서 댓글 자동 답장을 끕니다.</li>
                  <li>예전에 연결한 다른 DM 자동화 서비스가 있다면 인스타그램 설정 → 비즈니스 도구에서 연결을 해제합니다.</li>
                </ol>
              </div>
              <button
                type="button"
                onClick={dismissExternalDm}
                className="mt-3 rounded-xl bg-red-600 text-white px-3.5 py-2 text-[11px] font-black hover:bg-red-700"
              >
                확인했어요
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 발신 에코 구독이 아직 연결되지 않은 상태 안내.
          이 구독이 없으면 이 앱을 거치지 않고 나간 자동 DM(인스타그램 자체 자동 메시지,
          예전에 연결해 둔 다른 자동화 서비스)을 감지할 수 없어, 위의 "외부 자동 DM"
          안내가 영영 뜨지 않는다. 감지가 꺼져 있다는 사실 자체를 알려줘야 한다. */}
      {connected && !echoSubscribed && (
        <section className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 md:px-6">
          <p className="text-[12px] md:text-sm font-bold text-amber-800">
            인스타그램 발신 메시지 알림(에코) 구독이 아직 연결되지 않았습니다. 그래서 이 앱을 거치지
            않고 나간 자동 DM 은 자동으로 감지하지 못합니다. 자동화를 한 번 저장하면 다시 연결을
            시도합니다.
          </p>
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
                  <div
                    key={m.id}
                    className="relative aspect-square rounded-xl overflow-hidden bg-slate-100 group border border-slate-100"
                    title={entitled ? '이 게시물의 댓글 단 사람에게 수동 DM 발송 또는 자동화 설정' : '디엠 자동화는 프로 플랜 전용 기능이에요.'}
                  >
                    {m.mediaUrl
                      ? <img src={m.mediaUrl} alt={m.caption.slice(0, 40)} className="w-full h-full object-cover" loading="lazy" />
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={20} className="text-slate-300" /></div>}
                    <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/60 transition-colors flex flex-col items-center justify-center gap-1.5 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setManualModalRule(manualRuleForMedia(m.id, m.caption));
                          setManualModalOpen(true);
                        }}
                        disabled={!entitled}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-pink-600 text-white rounded-full px-2.5 py-1 text-[11px] font-black shadow hover:bg-pink-700 disabled:opacity-40"
                      >
                        <Send size={11} /> 수동발송
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ ...blankAutomation(t), mediaScope: 'selected', mediaIds: [m.id] })}
                        disabled={!entitled}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white text-pink-600 rounded-full px-2.5 py-1 text-[11px] font-black shadow hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Plus size={11} /> 자동화
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* 자동화 목록 */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg md:text-xl font-black text-slate-900">{t('dm.myAutomations', '내 자동화', 'My Automations')}</h3>
            <span className="text-xs font-black text-slate-400">총 {automations.length}개</span>
          </div>
          {connected && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(blankAutomation(t))}
                disabled={!entitled}
                title={entitled ? undefined : t('common.proPlanNotice', '디엠 자동화는 프로 플랜 전용 기능이에요.', 'DM Automation is a Pro Plan exclusive feature.')}
                className="flex items-center gap-1.5 bg-gradient-to-r from-pink-600 to-orange-500 text-white rounded-xl py-2.5 px-4 text-xs md:text-sm font-black shadow-lg shadow-pink-500/25 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Plus size={16} /> {t('dm.addAutomation', '자동화 추가하기', 'Add Automation')}
              </button>
            </div>
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
              onClick={() => setEditing(blankAutomation(t))}
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
                    <h4 data-user-content className="font-black text-slate-900 text-sm md:text-base truncate">{a.name}</h4>
                  </div>
                  <Toggle on={a.enabled} onClick={() => toggleAutomation(a.id)} size="sm" disabled={saving} />
                </div>

                {/* 어떤 피드 게시물에 걸린 자동화인지 이미지로 확인 */}
                <AutomationFeedThumbs
                  media={media}
                  loading={mediaLoading}
                  scope={a.mediaScope}
                  mediaIds={a.mediaIds || []}
                />

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
                  {a.messageType === 'carousel' && !a.cards?.find((c) => c.title) ? (
                    <span className="line-clamp-2">이미지 카드 캐러셀 메시지</span>
                  ) : (
                    // 저장된 발송 문구는 사용자가 쓴 내용이다. 화면 번역이 손대면 목록에
                    // 보이는 문구와 실제로 나가는 문구가 갈라진다.
                    <span data-user-content className="line-clamp-2">
                      {a.messageType === 'carousel'
                        ? a.cards?.find((c) => c.title)?.title
                        : a.message}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setEditing(a)} className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl py-2 text-xs font-black hover:bg-slate-200 transition-colors">
                    <Pencil size={13} /> {t('dm.edit', '편집', 'Edit')}
                  </button>
                  <button
                    onClick={() => {
                      setManualModalRule(a);
                      setManualModalOpen(true);
                    }}
                    disabled={!entitled}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-pink-50 text-pink-600 border border-pink-200/60 rounded-xl py-2 text-xs font-black hover:bg-pink-100 disabled:opacity-50 transition-colors"
                  >
                    <Send size={13} /> {t('dm.manualSend', '수동 발송', 'Send Manual')}
                  </button>
                  <button onClick={() => deleteAutomation(a.id)} disabled={saving} className="w-10 rounded-xl text-red-400 hover:bg-red-50 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 성과 요약 (연결 시) */}
      {connected && automations.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mt-6">
          {[
            { icon: <Send size={16} />, label: t('dm.activeAutomation', '활성 자동화', 'Active Rules'), value: `${activeCount}개` },
            { icon: <Eye size={16} />, label: t('dm.totalAutomation', '전체 자동화', 'Total Rules'), value: `${automations.length}개` },
            { icon: <MousePointerClick size={16} />, label: t('dm.status', '상태', 'Status'), value: enabled ? t('common.active', '작동 중', 'Active') : t('common.inactive', '중지됨', 'Inactive') },
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

      <ManualDmModal
        isOpen={manualModalOpen}
        onClose={() => {
          setManualModalOpen(false);
          setManualModalRule(null);
        }}
        userName={userName}
        igUsername={igUsername}
        automations={automations}
        initialAutomation={manualModalRule}
        entitled={entitled}
        media={media}
      />
    </div>
  );
};

export default DmAutomation;
