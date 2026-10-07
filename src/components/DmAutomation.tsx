import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Instagram, Check, Plus, Trash2, Send, Loader2, MessageSquare, MessageCircle,
  Zap, Link2, X, ChevronRight, Sparkles, AlertCircle, Pencil, Power, Users,
  CornerDownRight, Hash, Reply, Eye, MousePointerClick, Image as ImageIcon,
  LayoutGrid, AlignLeft, GalleryHorizontalEnd, Upload, ImagePlus, Copy,
  ArrowUp, ArrowDown, Images, Clock, CalendarClock, RefreshCw, Info,
} from 'lucide-react';
import {
  apiService, DmAutomationSettings, DmAutomationItem, DmMessageButton, DmCarouselCard, DmFollowUp,
  DmDirectSettings, DmFaqSettings, InstagramMedia, DM_CARD_IMAGE_MAX_MB,
} from '../services/apiService';
import { isNativeApp } from '../utils/appEnv';
import { useLanguage } from '../contexts/LanguageContext';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { setUnsavedWork } from '../utils/unsavedWork';
import ManualDmModal from './ManualDmModal';
import CollabMatchRegister from './CollabMatchRegister';
import Toggle from './DmToggle';
import { DM_SEND_SPEED_DEFAULT, DmFaqSection, DmSendSpeedSection, DmSendStatusSection, DmTriggerSection, fmtDateTime, toLocalInput } from './DmAutomationExtras';

interface DmAutomationProps {
  userName: string;
  /**
   * 브랜드(기업) 워크스페이스에서 열린 화면인가.
   *
   * 문구만 갈린다. 브랜드에게는 "브랜드 매칭받기"가 없고(인플루언서 쪽 기능이다)
   * 대신 연동 하나로 콘텐츠 성과(태그된 콘텐츠)를 본다. 해제 안내에 남의 기능을
   * 적어 두면 브랜드는 무엇이 멈추는지 알 수 없고, 반대로 성과 화면이 계속
   * 열려 있다는 사실을 적어 두지 않으면 끊기를 망설이거나 끊은 뒤에 "왜 아직
   * 내 인스타 데이터를 읽나"를 묻게 된다.
   */
  isBusiness?: boolean;
}

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const blankCard = (): DmCarouselCard => ({
  id: genId('card'), title: '', subtitle: '', imageUrl: '', buttonLabel: '', buttonUrl: '', buttons: [],
});

/** 카드 한 장에 달 수 있는 버튼 수(인스타그램 제네릭 템플릿 기준 최대 3개). */
const CARD_BUTTON_MAX = 3;

/** 카드 버튼 목록. 예전에 저장된 카드(버튼 1개 필드)는 목록으로 옮겨 읽는다. */
const cardButtonList = (c: DmCarouselCard): DmMessageButton[] =>
  Array.isArray(c.buttons)
    ? c.buttons
    : c.buttonLabel || c.buttonUrl
      ? [{ id: `${c.id}_b0`, label: c.buttonLabel || '', url: c.buttonUrl || '' }]
      : [];

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


/**
 * 2단계 발송(미끼 → 본 메시지) 기본 문구. 서버(instagram-dm.mts)의 기본값과 같다 —
 * 비워 두고 저장해도 발송기가 같은 문구로 채운다.
 */
const DEFAULT_BAIT_MESSAGE = '댓글 감사합니다! 아래 버튼을 눌러주세요 👇';
const DEFAULT_BAIT_BUTTON_LABEL = '메시지 받기';
const DEFAULT_FOLLOW_GATE_MESSAGE = '팔로우 후 아래 버튼을 다시 눌러주시면 안내 메시지를 보내드릴게요!';
const DEFAULT_FOLLOW_GATE_BUTTON_LABEL = '팔로우했어요';

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
  // 링크 버튼은 선택이다. 필요하면 '+ 버튼 추가'로 넣는다.
  buttons: [],
  cards: [],
  sendMode: 'instant',
  scheduledAt: '',
  baitEnabled: false,
  baitMessage: DEFAULT_BAIT_MESSAGE,
  baitButtonLabel: DEFAULT_BAIT_BUTTON_LABEL,
  mainIntro: '',
  followUps: [],
  followGateMessage: DEFAULT_FOLLOW_GATE_MESSAGE,
  followGateButtonLabel: DEFAULT_FOLLOW_GATE_BUTTON_LABEL,
  createdAt: new Date().toISOString(),
});

/** "예약 발송"을 처음 고를 때 채워 넣는 기본 시각 — 한 시간 뒤. */
const defaultScheduleAt = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const textValue = (value: unknown): string => typeof value === 'string' ? value : '';
const normalizeButtons = (value: unknown): DmMessageButton[] => Array.isArray(value)
  ? value.filter(isRecord).map((b, index) => ({
    ...b,
    id: textValue(b.id) || `btn_${index}`,
    label: textValue(b.label),
    url: textValue(b.url),
  }))
  : [];
const normalizeCards = (value: unknown): DmCarouselCard[] => Array.isArray(value)
  ? value.filter(isRecord).map((c, index) => {
    const card = {
      ...c,
      id: textValue(c.id) || `card_${index}`,
      title: textValue(c.title),
      subtitle: textValue(c.subtitle),
      imageUrl: textValue(c.imageUrl),
      buttonLabel: textValue(c.buttonLabel),
      buttonUrl: textValue(c.buttonUrl),
    };
    return { ...card, buttons: normalizeButtons(Array.isArray(c.buttons) ? c.buttons : cardButtonList(card)) };
  })
  : [];
const normalizeMedia = (value: unknown): InstagramMedia[] => Array.isArray(value)
  ? value.filter(isRecord).filter((m) => typeof m.id === 'string' && m.id).map((m) => ({
    ...m,
    id: textValue(m.id),
    caption: textValue(m.caption),
    mediaType: textValue(m.mediaType),
    mediaUrl: textValue(m.mediaUrl),
    thumbnailUrl: textValue(m.thumbnailUrl),
    permalink: textValue(m.permalink),
    timestamp: textValue(m.timestamp),
  }))
  : [];

// 이전에 저장된(신규 필드가 없는) 자동화도 안전하게 다룰 수 있도록 기본값을 채운다.
const normalizeAutomation = (a: DmAutomationItem): DmAutomationItem => ({
  ...a,
  name: textValue(a.name),
  message: textValue(a.message),
  keywords: Array.isArray(a.keywords) ? a.keywords.filter((k) => typeof k === 'string') : [],
  replies: Array.isArray(a.replies) ? a.replies.filter((r) => typeof r === 'string') : [],
  buttons: normalizeButtons(a.buttons),
  cards: normalizeCards(a.cards),
  mediaIds: Array.isArray(a.mediaIds) ? a.mediaIds.filter((id) => typeof id === 'string') : [],
  commentMatch: a.commentMatch === 'all' ? 'all' : 'keyword',
  followFilter: a.followFilter === 'followers' || a.followFilter === 'non_followers' ? a.followFilter : 'all',
  mediaScope: a.mediaScope === 'selected' ? 'selected' : 'all',
  messageType: a.messageType === 'carousel' ? 'carousel' : 'text',
  // 예약 시각이 없는 예약은 성립하지 않는다(발송 시점을 알 수 없다) → 즉시 발송으로 본다.
  sendMode: a.sendMode === 'scheduled' && a.scheduledAt ? 'scheduled' : 'instant',
  scheduledAt: typeof a.scheduledAt === 'string' ? a.scheduledAt : '',
  // 팔로우 조건은 버튼을 누른 시점에 확인하므로 2단계 발송이 전제다.
  baitEnabled: (a.followFilter || 'all') !== 'all' || Boolean(a.baitEnabled),
  baitMessage: typeof a.baitMessage === 'string' ? a.baitMessage : DEFAULT_BAIT_MESSAGE,
  baitButtonLabel: typeof a.baitButtonLabel === 'string' ? a.baitButtonLabel : DEFAULT_BAIT_BUTTON_LABEL,
  mainIntro: typeof a.mainIntro === 'string' ? a.mainIntro : '',
  followUps: Array.isArray(a.followUps)
    ? a.followUps.filter((f) => isRecord(f) && ['text', 'carousel', 'image'].includes(f.type)).map((f, index) => ({
      ...f,
      id: textValue(f.id) || `followup_${index}`,
      buttons: normalizeButtons(f.buttons),
      cards: normalizeCards(f.cards),
      imageUrl: textValue(f.imageUrl),
      message: textValue(f.message),
    }))
    : [],
  followGateMessage: typeof a.followGateMessage === 'string' ? a.followGateMessage : DEFAULT_FOLLOW_GATE_MESSAGE,
  followGateButtonLabel: typeof a.followGateButtonLabel === 'string' ? a.followGateButtonLabel : DEFAULT_FOLLOW_GATE_BUTTON_LABEL,
});
const normalizeAutomations = (value: unknown): DmAutomationItem[] => Array.isArray(value)
  ? value.filter((a) => isRecord(a) && typeof a.id === 'string' && a.id).map(normalizeAutomation)
  : [];

/**
 * DM 자동 응답(인사말·키워드 답장) 설정. 예전 버전이 남긴 캐시에는 인사말 항목이 빠져
 * 있을 수 있는데, 그대로 그리면 인사말 영역에서 화면 전체가 멈춘다.
 */
const normalizeDirect = (value: unknown): DmDirectSettings => {
  const v = isRecord(value) ? value : {};
  const greeting = isRecord(v.greeting) ? v.greeting : {};
  return {
    greeting: {
      enabled: Boolean(greeting.enabled),
      message: textValue(greeting.message),
      buttons: normalizeButtons(greeting.buttons),
      onlyFirstContact: greeting.onlyFirstContact !== false,
    },
    replies: Array.isArray(v.replies)
      ? v.replies.filter((r) => isRecord(r) && typeof r.id === 'string' && r.id).map((r) => ({
        ...r,
        id: textValue(r.id),
        name: textValue(r.name),
        enabled: r.enabled !== false,
        keywords: Array.isArray(r.keywords) ? r.keywords.filter((k: unknown) => typeof k === 'string') : [],
        message: textValue(r.message),
        buttons: normalizeButtons(r.buttons),
        createdAt: textValue(r.createdAt),
      }))
      : [],
  };
};

const dmSettingsCacheKey = (username: string) => `picks_dm_automation_${username.toLowerCase()}`;
const dmMediaCacheKey = (username: string) => `picks_dm_media_${username.toLowerCase()}`;

/**
 * 첫 응답 뒤에 배경에서 더 받아올 페이지 수 상한.
 *
 * 서버가 한 번에 최대 400개를 주므로 여기까지면 사실상 모든 계정을 덮는다. 상한을
 * 두는 이유는 커서가 어떤 이유로든 끝나지 않을 때 요청이 무한히 이어지지 않게
 * 하기 위해서다.
 */
const MAX_FEED_PAGES = 6;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/**
 * 편집 중인 자동화를 이 기기에 적어 둔다.
 *
 * 편집 창의 입력은 화면 메모리에만 있어서, 페이지가 새로 고쳐지거나(새 버전 반영 ·
 * 당겨서 새로고침) 앱이 사진을 고르는 동안 시스템에 정리되면 입력한 내용이 통째로
 * 사라졌다. 입력이 바뀔 때마다 적어 두고, 다음에 이 화면을 열면 이어서 편집할 수 있게
 * 한다. 저장하거나 닫기를 확인하면 지운다. 로그아웃하면 다른 `picks_` 기록과 함께
 * 지워진다.
 */
const EDITOR_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const editorDraftKey = (username: string) => `picks_dm_editor_draft_${username.toLowerCase()}`;

interface EditorDraft {
  savedAt: number;
  draft: DmAutomationItem;
  keywordInput: string;
}

function clearEditorDraft(username: string): void {
  try {
    localStorage.removeItem(editorDraftKey(username));
  } catch {}
}

function readEditorDraft(username: string): EditorDraft | null {
  const stored = readJson<EditorDraft>(editorDraftKey(username));
  if (!stored || !isRecord(stored.draft) || typeof stored.draft.id !== 'string' || !stored.draft.id) return null;
  const savedAt = Number(stored.savedAt);
  if (!(Date.now() - savedAt < EDITOR_DRAFT_TTL_MS)) {
    clearEditorDraft(username);
    return null;
  }
  return { savedAt, draft: normalizeAutomation(stored.draft), keywordInput: textValue(stored.keywordInput) };
}

/**
 * 게시물 그리드에 한 번에 그리는 개수.
 *
 * 게시물이 많은 계정(최대 수천 개)을 통째로 그리면 휴대폰 WebView 의 메모리 사용이
 * 커지고, 편집 창에서는 글자를 칠 때마다 그 전부를 다시 그렸다. 나머지는 "더 보기"로
 * 이어서 그린다.
 *
 * 인스타그램이 주는 게시물 이미지는 작은 크기가 따로 없어 원본(가로 1080px 안팎)이 그대로
 * 오고, 한 장을 그리는 데 수 MB 의 메모리가 든다. 60장씩이면 목록과 편집 창을 합쳐 수백 MB
 * 가 되어, 메모리가 빠듯한 인스타그램 앱 안 브라우저에서는 편집 창에서 키보드를 여는 순간
 * 화면이 꺼지고 페이지가 처음부터 다시 떴다(설정 화면 튕김). 한 번에 24장만 그린다.
 */
const MEDIA_GRID_STEP = 24;

const MoreMediaButton: React.FC<{ shown: number; total: number; onMore: () => void }> = ({ shown, total, onMore }) =>
  shown < total ? (
    <button
      type="button"
      onClick={onMore}
      className="col-span-full rounded-xl border border-slate-200 bg-white py-2 text-[11px] font-black text-slate-500 hover:bg-slate-50"
    >
      더 보기 ({total - shown}개 남음)
    </button>
  ) : null;

/**
 * 피드 미리보기 칸 수. 설정 화면에는 게시물을 처음부터 전부 그리지 않고 이만큼만 보여 준 뒤
 * 마지막 칸을 "+"로 두어, 누르면 전체 게시물 창을 연다. 처음 화면에서 수백 장을 그리면
 * 렉이 걸리고 인스타그램 앱 안 브라우저에서는 튕기기도 했다.
 */
const FEED_PREVIEW_COUNT = 7;

/** 피드 전체 게시물 창. 여기서도 한 번에 MEDIA_GRID_STEP 장씩만 그린다. */
const FeedAllMediaModal: React.FC<{
  media: InstagramMedia[];
  entitled: boolean;
  disabledTitle: string;
  onPick: (m: InstagramMedia) => void;
  onClose: () => void;
}> = ({ media, entitled, disabledTitle, onPick, onClose }) => {
  const [shown, setShown] = useState(MEDIA_GRID_STEP);
  useCloseOnBack(true, onClose);
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end md:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 md:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-3xl md:rounded-[2rem] rounded-t-[2rem] shadow-2xl max-h-[90vh] md:max-h-[85vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 md:px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2">
            <LayoutGrid size={17} className="text-slate-400" /> 내 피드 게시물 전체
            <span className="text-xs font-black text-slate-400">{media.length}개</span>
          </h3>
          <button type="button" onClick={onClose} className="shrink-0 w-10 h-10 -mr-1 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400" aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-5">
          <div className="grid grid-cols-4 gap-2">
            {media.slice(0, shown).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m)}
                disabled={!entitled}
                title={entitled ? '이 게시물에 자동 DM 설정' : disabledTitle}
                aria-label="이 게시물에 자동 DM 설정"
                className="relative block w-full aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-100 hover:border-pink-400 hover:ring-2 hover:ring-pink-200 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
              >
                {feedImageOf(m)
                  ? <img src={feedImageOf(m)} alt={m.caption.slice(0, 40)} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={20} className="text-slate-300" /></div>}
              </button>
            ))}
            {shown < media.length && (
              <button
                type="button"
                onClick={() => setShown((n) => n + MEDIA_GRID_STEP)}
                className="col-span-full rounded-xl border border-slate-200 bg-white py-2.5 text-[12px] font-black text-slate-500 hover:bg-slate-50"
              >
                더 보기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const FOLLOW_LABEL: Record<DmAutomationItem['followFilter'], string> = {
  all: '모든 사용자',
  followers: '팔로워에게만',
  non_followers: '비팔로워에게만',
};

/**
 * 인스타그램 제네릭 템플릿 카드의 제목 길이 제한. 댓글 자동 DM 은 1통만 도착하므로
 * 링크 버튼이 있으면 본문과 버튼을 카드 한 장에 담는다. 본문이 이 길이를 넘으면
 * 설명 줄(80자)까지 이어 싣고, 그래도 넘치는 부분은 잘린다.
 * (발송 로직: netlify/functions/_shared/instagram-dm.mts 의 buildCommentDmPlan)
 */
const CARD_TEXT_MAX = 80;

/** 발송기(splitCardText)와 같은 기준으로 본문을 카드 제목/설명으로 나눈다. */
const splitCardText = (message: string): { title: string; subtitle: string } => {
  if (message.length <= CARD_TEXT_MAX) return { title: message, subtitle: '' };
  const head = message.slice(0, CARD_TEXT_MAX);
  let cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
  if (cut < CARD_TEXT_MAX / 2) cut = CARD_TEXT_MAX;
  const title = message.slice(0, cut).trim();
  const rest = message.slice(cut).trim();
  const subtitle = rest.length > CARD_TEXT_MAX ? `${rest.slice(0, CARD_TEXT_MAX - 1).trimEnd()}…` : rest;
  return { title, subtitle };
};

/**
 * 2단계 본 메시지에서 본문 + 링크 버튼이 말풍선 한 통(버튼 템플릿)으로 갈 때의
 * 본문 길이 제한. 넘치는 앞부분은 텍스트로 먼저 간다.
 * (발송 로직: netlify/functions/_shared/instagram-dm.mts 의 buildMainDmPlan)
 */
const BUTTON_TEXT_MAX = 640;

/** 한 캐러셀에 담을 수 있는 카드 수. 발송기·서버 저장 한도와 같은 값이다. */
const CARD_MAX_COUNT = 10;

/** 2단계 본 메시지 뒤에 붙일 수 있는 추가 메시지 수. 서버(MAIN_FOLLOW_UP_MAX)와 같다. */
const FOLLOW_UP_MAX = 5;

/**
 * 본문에 링크 주소가 있는지. 서버 `_shared/instagram-dm.mts` 의 hasLinkInText 와 같은 규칙.
 * 본문 + 버튼을 한 통(버튼 템플릿)으로 보내면 본문 속 링크는 눌리지 않아서, 링크가
 * 있으면 발송기는 본문을 일반 텍스트로 따로 보낸다.
 */
const LINK_IN_TEXT = /(?:https?:\/\/|www\.)[^\s]|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s]/i;
const hasLinkInText = (message: string): boolean => LINK_IN_TEXT.test(message || '');

/** 미리보기에서 본문 속 링크를 인스타그램처럼 파란색으로 보여준다. */
const LINK_TOKEN = /((?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s]*)/gi;
const LinkifiedText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(LINK_TOKEN).map((part, i) => (i % 2 === 1
      ? <span key={i} className="text-blue-600 underline-offset-2">{part}</span>
      : <React.Fragment key={i}>{part}</React.Fragment>))}
  </>
);

const cleanLinkInput = (raw: string): string => (raw || '')
  .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  .replace(/[：]/g, ':')
  .replace(/[／]/g, '/')
  .replace(/[．]/g, '.')
  .trim()
  .replace(/^[<>'\"“”‘’]+|[<>'\"“”‘’]+$/g, '')
  .trim();

/**
 * Graph API 는 http/https 절대 URL 만 링크 버튼·카드 이미지로 받는다.
 *
 * 호스트 형태까지 본다. `/api/images/x` 처럼 상대 경로에 스킴만 붙이면
 * `https://api/images/x` 로 파싱돼 형식 검사만으로는 통과하는데, 인스타그램은 그
 * 주소를 찾아갈 수 없어 카드 한 장이 아니라 메시지 전체가 거부된다.
 * 서버 `_shared/instagram-dm.mts` 의 isValidLinkUrl 과 규칙을 맞춰 둔다.
 */
const isValidLinkUrl = (raw: string): boolean => {
  try {
    const u = new URL(cleanLinkInput(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname);
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
  const trimmed = cleanLinkInput(raw);
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) {
    const withScheme = `https:${trimmed}`;
    return isValidLinkUrl(withScheme) ? withScheme : '';
  }
  if (isValidLinkUrl(trimmed)) return trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    if (isValidLinkUrl(withScheme)) return withScheme;
  }
  return '';
};

const normalizeImageUrl = (raw: string): string => {
  const value = cleanLinkInput(raw);
  if (value.startsWith('/api/images/')) {
    const origin = typeof window === 'undefined' ? 'https://picks-folio.com' : window.location.origin;
    return `${origin.replace(/\/$/, '')}${value}`;
  }
  return normalizeLinkUrl(value);
};

/** 입력값이 링크로 쓸 수 없는 상태인지(비어 있지 않은데 정규화도 안 되는 경우). */
const linkUrlBroken = (raw: string): boolean => Boolean((raw || '').trim()) && !normalizeLinkUrl(raw);
const imageUrlBroken = (raw: string): boolean => Boolean((raw || '').trim()) && !normalizeImageUrl(raw);

/**
 * 이 카드가 실제로 발송되는지.
 *
 * 인스타그램의 제네릭 템플릿은 제목 말고도 속성이 최소 하나 있어야 한다
 * ("At least one property must be set in addition to title"). 제목만 적힌 카드는
 * 요소로 만들 수 없고, 그런 카드가 섞이면 캐러셀 전체가 거부돼 아무것도 도착하지
 * 않는다. 그래서 발송기(_shared/instagram-dm.mts)는 이미지·설명·버튼이 하나도
 * 없는 카드를 빼며, 화면도 같은 기준으로 판단해야 "카드 3장"으로 보이는 설정이
 * 실제로는 2장만 도착하는 일이 없다.
 */
const cardSendable = (c: DmCarouselCard): boolean =>
  Boolean(normalizeImageUrl(c.imageUrl)) || Boolean(c.subtitle.trim()) ||
  cardButtonList(c).some((b) => Boolean(b.label.trim() && isValidLinkUrl(b.url)));

/** 인스타그램 피드 게시물에서 카드 이미지로 쓸 수 있는 사진 주소. (영상은 썸네일) */
const feedImageOf = (m: InstagramMedia): string =>
  (m.mediaType === 'VIDEO' ? m.thumbnailUrl || m.mediaUrl : m.mediaUrl || m.thumbnailUrl) || '';

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
          // 앱에서는 인스타그램으로 나가는 링크를 걸지 않는다. 앱 화면이 인스타그램 웹으로
          // 바뀌어 버리고, 돌아오면 이 화면이 처음부터 다시 열린다.
          return m?.permalink && !isNativeApp() ? (
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
/** 캐러셀 카드 미리보기(본 메시지·추가 메시지 공용). */
const CarouselPreview: React.FC<{ cards: DmCarouselCard[] }> = ({ cards }) => (
  <div className="flex gap-2 overflow-x-auto pb-1 -mr-2">
    {cards.map((c) => (
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
          {cardButtonList(c).filter((b) => b.label.trim()).map((b) => (
            <div key={b.id} data-user-content className="mt-1.5 first:mt-2 text-center bg-slate-50 border border-slate-200 rounded-lg py-1.5 text-[11px] font-bold text-pink-600 truncate">
              {b.label}
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

/*
 * 말풍선 크기는 실제 인스타그램 앱 DM 화면 비율을 그대로 옮겼다(글자 크기 기준 em).
 * 줄바꿈이 실제 도착 화면과 같아지려면 글자 크기 대비 폭이 같아야 한다.
 *  - 텍스트 말풍선: 내용만큼 줄어들고, 최대 폭은 약 18글자. 한국어도 음절 단위로
 *    줄을 바꾼다(앱 전체의 keep-all 을 풀어준다).
 *  - 카드(링크·예고 버튼): 폭이 고정이고 제목은 본문보다 작은 글씨로, 두 줄이 되면
 *    양쪽 줄 길이를 비슷하게 나눈다(인스타그램 카드 제목의 줄 나눔 방식).
 */
const BUBBLE_TEXT = 'text-[14px] [letter-spacing:0]';

/** 일반 텍스트 말풍선. 링크 주소는 인스타그램처럼 파랗게 보인다. */
const TextBubble: React.FC<{ text: string }> = ({ text }) => (
  <div className={`${BUBBLE_TEXT} w-fit max-w-[min(100%,18.2em)] bg-white border border-slate-200 rounded-[1.3em] rounded-bl-md px-[0.8em] py-[0.55em] shadow-sm`}>
    {text
      ? (
        <p data-user-content className="text-slate-700 font-medium leading-[1.35] whitespace-pre-wrap [word-break:normal] [overflow-wrap:anywhere]">
          <LinkifiedText text={text} />
        </p>
      )
      : (
        <p className="text-slate-700 font-medium leading-[1.35] whitespace-pre-wrap [word-break:normal] [overflow-wrap:anywhere]">
          보낼 메시지를 입력하면 여기에 표시됩니다.
        </p>
      )}
  </div>
);

/** 본문(또는 카드 제목) + 버튼이 붙은 카드 한 통. 실제 인스타그램 카드처럼 폭이 고정이다. */
const ButtonsBubble: React.FC<{ title: string; subtitle?: string; buttons: { id: string; label: string }[]; bold?: boolean }> = ({ title, subtitle, buttons }) => (
  <div className={`${BUBBLE_TEXT} w-[15.3em] max-w-full bg-white border border-slate-200 rounded-[1.3em] rounded-bl-md px-[0.8em] pt-[0.75em] pb-[0.8em] shadow-sm`}>
    <p data-user-content className="text-[0.78em] text-slate-700 font-medium leading-[1.4] whitespace-pre-wrap [text-wrap:balance]">
      {title}
    </p>
    {subtitle && (
      <p data-user-content className="mt-0.5 text-[0.72em] text-slate-500 font-medium leading-[1.4] whitespace-pre-wrap [text-wrap:balance]">
        {subtitle}
      </p>
    )}
    <div className="mt-[0.65em] space-y-[0.35em]">
      {buttons.map((b) => (
        <div
          key={b.id}
          data-user-content
          className="w-full text-center bg-slate-100 rounded-[0.6em] py-[0.55em] px-3 text-[0.82em] font-bold text-slate-800 truncate"
        >
          {b.label}
        </div>
      ))}
    </div>
  </div>
);

/** 2단계 추가 메시지에 실제로 보낼 내용이 있는지(발송기와 같은 기준). */
const followUpSendable = (f: DmFollowUp): boolean =>
  f.type === 'image'
    ? Boolean(normalizeImageUrl(f.imageUrl || ''))
    : f.type === 'carousel'
      ? (f.cards || []).some(cardSendable)
      : Boolean((f.message || '').trim());

/**
 * 2단계 텍스트 + 링크 버튼이 어떻게 도착하는지(발송기 buildDmMessages 와 같은 기준).
 * 본문에 링크가 있으면 [텍스트] → [버튼 카드] 2통이다.
 */
const mainTextBubbles = (
  body: string,
  buttons: DmMessageButton[],
): React.ReactNode => {
  if (buttons.length === 0) return <TextBubble text={body} />;
  if (body && hasLinkInText(body)) {
    return (
      <>
        <TextBubble text={body} />
        <ButtonsBubble bold title={buttons[0].label.trim().slice(0, CARD_TEXT_MAX)} buttons={buttons} />
      </>
    );
  }
  if (!body) return <ButtonsBubble bold title={buttons[0].label.trim().slice(0, CARD_TEXT_MAX)} buttons={buttons} />;
  if (body.length > BUTTON_TEXT_MAX) {
    return (
      <>
        <TextBubble text={body.slice(0, body.length - BUTTON_TEXT_MAX)} />
        <ButtonsBubble title={body.slice(body.length - BUTTON_TEXT_MAX)} buttons={buttons} />
      </>
    );
  }
  return <ButtonsBubble title={body} buttons={buttons} />;
};

const DmPreview: React.FC<{
  igUsername: string;
  messageType: DmAutomationItem['messageType'];
  message: string;
  buttons: DmMessageButton[];
  cards: DmCarouselCard[];
  /** 2단계 발송이면 먼저 도착하는 예고 카드(문구 + 버튼 하나). */
  bait?: { message: string; buttonLabel: string } | null;
  /** 2단계 본 메시지 앞에 먼저 가는 텍스트. */
  intro?: string;
  /** 2단계 본 메시지 뒤에 이어 가는 추가 메시지. */
  followUps?: DmFollowUp[];
}> = ({ igUsername, messageType, message, buttons, cards, bait, intro, followUps = [] }) => {
  // 미리보기도 발송기와 같은 기준으로 카드를 고른다(제목 또는 올바른 이미지 주소).
  const validCards = cards.filter(cardSendable);
  const isCarousel = messageType === 'carousel' && validCards.length > 0;
  // 실제로 발송되는 버튼만(라벨 + 올바른 http/https URL) 미리보기에 표시한다.
  const sendableButtons = (list: DmMessageButton[] = []) => list.filter((b) => b.label.trim() && isValidLinkUrl(b.url));
  const validButtons = sendableButtons(buttons);
  const body = message.trim();
  // 댓글 DM(1통)은 링크 버튼이 있으면 본문과 버튼이 카드 한 장으로 도착한다(긴 본문은 잘린다).
  const cardText = splitCardText(body);
  const separated = Boolean(bait) && validButtons.length > 0 && Boolean(body) && hasLinkInText(body);
  const shownFollowUps = bait ? followUps.filter(followUpSendable) : [];
  const avatar = (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 shrink-0 flex items-center justify-center text-white">
      <Instagram size={15} />
    </div>
  );
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-3xl p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3 text-slate-400">
        <Instagram size={13} />
        <span className="text-[11px] font-black">DM 미리보기</span>
      </div>
      {bait && (
        <>
          <p className="text-[10px] font-black text-pink-500 mb-1.5">1단계 · 예고 메시지</p>
          <div className="flex items-end gap-2 mb-3">
            {avatar}
            <div className="max-w-[85%] min-w-0">
              <ButtonsBubble
                title={bait.message.trim() || DEFAULT_BAIT_MESSAGE}
                buttons={[{ id: 'bait', label: bait.buttonLabel.trim() || DEFAULT_BAIT_BUTTON_LABEL }]}
              />
            </div>
          </div>
          <p className="text-[10px] font-black text-pink-500 mb-1.5">2단계 · 버튼을 누르면 도착</p>
          {intro?.trim() && (
            <div className="flex items-end gap-2 mb-1.5">
              <div className="w-8 shrink-0" />
              <div className="max-w-[85%] min-w-0">
                <TextBubble text={intro} />
              </div>
            </div>
          )}
        </>
      )}
      <div className="flex items-end gap-2">
        {avatar}
        <div className="max-w-[85%] min-w-0">
          {isCarousel ? (
            <div className="space-y-1.5">
              <CarouselPreview cards={validCards} />
            </div>
          ) : bait ? (
            <div className="space-y-1.5">
              {mainTextBubbles(body, validButtons)}
            </div>
          ) : (
            <div className="space-y-1.5">
              {/* 버튼이 없으면 본문은 텍스트 버블로 도착한다. */}
              {validButtons.length === 0 && <TextBubble text={message} />}
              {validButtons.length > 0 && (
                <ButtonsBubble
                  bold
                  title={cardText.title || validButtons[0].label.trim().slice(0, CARD_TEXT_MAX)}
                  subtitle={cardText.subtitle}
                  buttons={validButtons}
                />
              )}
            </div>
          )}
          {shownFollowUps.length > 0 && (
            <div className="space-y-1.5 mt-1.5">
              {shownFollowUps.map((f) => (
                <div key={f.id}>
                  {f.type === 'image' ? (
                    <div className="w-48 max-w-full rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                      <img src={f.imageUrl} alt="" className="w-full h-auto object-cover" />
                    </div>
                  ) : f.type === 'carousel' ? (
                    <CarouselPreview cards={(f.cards || []).filter(cardSendable)} />
                  ) : (
                    <div className="space-y-1.5">
                      {mainTextBubbles((f.message || '').trim(), sendableButtons(f.buttons))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {igUsername && <span className="text-[10px] text-slate-400 font-bold ml-2 mt-1 inline-block">@{igUsername}</span>}
        </div>
      </div>
      {!isCarousel && validButtons.length > 0 && (
        <p className="mt-3 text-[10px] text-slate-400 font-bold leading-relaxed">
          {!bait
            ? '링크 버튼은 카드 형태로 전송됩니다. 인스타그램 모바일 앱에서만 표시되고 웹(instagram.com) DM 화면에서는 보이지 않습니다.'
            : separated
              ? '본문은 일반 메시지로, 링크 버튼은 카드로 따로 전송됩니다. 본문 속 링크는 파란색으로 표시되고 눌러서 열 수 있어요.'
              : '2단계 메시지는 본문과 링크 버튼이 메시지 한 통으로 전송됩니다. 링크 버튼은 인스타그램 모바일 앱에서만 표시되고 웹(instagram.com) DM 화면에서는 보이지 않을 수 있습니다.'}
        </p>
      )}
      {isCarousel && (
        <p className="mt-3 text-[10px] text-slate-400 font-bold leading-relaxed">
          캐러셀 카드 {validCards.length}장이 발송됩니다. 카드는 인스타그램 모바일 앱에서만 표시되고 웹(instagram.com) DM 화면에서는 보이지 않습니다.
        </p>
      )}
      {shownFollowUps.length > 0 && (
        <p className="mt-1 text-[10px] text-slate-400 font-bold leading-relaxed">
          본 메시지 뒤에 추가 메시지 {shownFollowUps.length}통이 순서대로 이어서 발송됩니다.
        </p>
      )}
    </div>
  );
};

/* ────────────────────────── 캐러셀 카드 빌더 ────────────────────────── */
/**
 * 카드의 이미지·문구·버튼을 만드는 편집기.
 *
 * 이미지는 세 가지 방법으로 넣는다 — 파일 올리기, 인스타그램 피드에서 고르기, 주소
 * 직접 붙여넣기. 어느 쪽이든 카드에 저장되는 값은 만료되지 않는 공개 절대주소다.
 * 인스타그램은 발송할 때 이 주소로 이미지를 직접 받아가기 때문에, 화면에서만 열리는
 * 값(미리보기용 `blob:` 주소, 서명이 붙은 피드 CDN 주소)을 저장하면 설정은 정상으로
 * 보이는데 카드가 이미지 없이 도착한다. 그래서 피드 사진도 고른 순간 서버가 우리
 * 저장소로 복사한다(api-dm-card-image).
 *
 * 순서도 여기서 바꾼다. 캐러셀은 왼쪽부터 순서대로 도착하므로, 순서를 못 바꾸면
 * 카드를 지우고 다시 만드는 수밖에 없다.
 */
const CarouselBuilder: React.FC<{
  userName: string;
  cards: DmCarouselCard[];
  media: InstagramMedia[];
  mediaLoading: boolean;
  /** 게시물을 받아오지 못한 이유. 있으면 "사진이 없다" 대신 이 사유를 보여준다. */
  mediaError: string;
  onRetryMedia: () => void;
  onChange: (cards: DmCarouselCard[]) => void;
  onBusyChange?: (busy: boolean) => void;
}> = ({ userName, cards, media, mediaLoading, mediaError, onRetryMedia, onChange, onBusyChange }) => {
  const latest = useRef({ cards, onChange });
  latest.current = { cards, onChange };
  const imageTasks = useRef<Record<string, number>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  /** 카드별 이미지 작업 상태. 업로드는 몇 초 걸릴 수 있어 진행률을 그대로 보여준다. */
  const [busy, setBusy] = useState<Record<string, { ratio: number; label: string }>>({});
  const busyNotice = useRef(onBusyChange);
  busyNotice.current = onBusyChange;
  const uploading = Object.keys(busy).length > 0;
  useEffect(() => {
    busyNotice.current?.(uploading);
    return () => { busyNotice.current?.(false); };
  }, [uploading]);
  const [imageError, setImageError] = useState<Record<string, string>>({});
  /** 피드 사진 고르기를 펼쳐 둔 카드. */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerShown, setPickerShown] = useState(MEDIA_GRID_STEP);

  const feedPhotos = useMemo(() => media.filter((m) => feedImageOf(m)), [media]);

  const setCard = (id: string, p: Partial<DmCarouselCard>) => {
    if ('imageUrl' in p) clearCardState(id);
    const current = latest.current;
    if (!current.cards.some((c) => c.id === id)) return;
    current.onChange(current.cards.map((c) => (c.id === id ? { ...c, ...p } : c)));
  };

  const clearCardState = (id: string) => {
    imageTasks.current[id] = (imageTasks.current[id] || 0) + 1;
    setBusy((b) => { const next = { ...b }; delete next[id]; return next; });
    setImageError((e) => { const next = { ...e }; delete next[id]; return next; });
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= cards.length) return;
    const next = [...cards];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const duplicate = (index: number) => {
    if (cards.length >= CARD_MAX_COUNT) return;
    const next = [...cards];
    next.splice(index + 1, 0, { ...cards[index], id: genId('card') });
    onChange(next);
  };

  const remove = (id: string) => {
    if (pickerFor === id) setPickerFor(null);
    clearCardState(id);
    onChange(cards.filter((c) => c.id !== id));
  };

  /** 이미지 작업을 감싸는 공통 흐름 — 진행 표시, 성공 시 주소 반영, 실패 시 사유 노출. */
  const runImageTask = async (
    cardId: string,
    label: string,
    task: (onProgress: (ratio: number) => void) => Promise<{ url?: string; error?: string }>,
  ) => {
    const taskId = (imageTasks.current[cardId] || 0) + 1;
    imageTasks.current[cardId] = taskId;
    setImageError((e) => ({ ...e, [cardId]: '' }));
    setBusy((b) => ({ ...b, [cardId]: { ratio: 0, label } }));
    const active = () => mounted.current && imageTasks.current[cardId] === taskId;
    try {
      const result = await task((ratio) => {
        if (active()) setBusy((b) => (b[cardId] ? { ...b, [cardId]: { ratio, label } } : b));
      });
      if (!active()) return;
      if (result.url) setCard(cardId, { imageUrl: result.url });
      else setImageError((e) => ({ ...e, [cardId]: result.error || '이미지를 넣지 못했습니다. 다시 시도해 주세요.' }));
    } catch {
      if (active()) setImageError((e) => ({ ...e, [cardId]: '이미지를 넣지 못했습니다. 다시 시도해 주세요.' }));
    } finally {
      if (active()) setBusy((b) => { const next = { ...b }; delete next[cardId]; return next; });
    }
  };

  const uploadImage = (cardId: string, file: File) =>
    runImageTask(cardId, '올리는 중', (onProgress) =>
      apiService.uploadDmCardImage(userName, file, onProgress),
    );

  const pickFromFeed = (cardId: string, m: InstagramMedia) => {
    const source = feedImageOf(m);
    if (!source) {
      setImageError((e) => ({ ...e, [cardId]: '이 게시물에서는 사진을 가져올 수 없어요. 파일로 올려 주세요.' }));
      return;
    }
    setPickerFor(null);
    return runImageTask(cardId, '피드에서 가져오는 중', () =>
      apiService.copyDmCardImageFromFeed(userName, source),
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500 font-medium">
        이미지 카드를 좌우로 넘겨보는 캐러셀 메시지예요. 카드는 최대 {CARD_MAX_COUNT}장까지 추가할 수 있고,
        왼쪽 카드부터 순서대로 도착합니다. 이미지는 정사각형(1:1)을 권장하며 {DM_CARD_IMAGE_MAX_MB}MB 이하 JPG·PNG·WEBP 를 넣을 수 있어요.
      </p>

      {cards.length === 0 && (
        <div className="text-center py-6 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
          <LayoutGrid size={24} className="text-slate-300 mx-auto mb-2" />
          <p className="text-xs font-bold text-slate-500">카드를 추가해 캐러셀을 만들어보세요</p>
        </div>
      )}

      {cards.map((c, i) => {
        // 카드 버튼도 링크가 잘못되면 발송 시 통째로 빠진다.
        const cardBtns = cardButtonList(c);
        const btnInvalid = (b: DmMessageButton) =>
          linkUrlBroken(b.url) || (Boolean(b.label.trim()) && !b.url.trim());
        const cardUrlInvalid = cardBtns.some(btnInvalid);
        // 버튼 목록을 바꾸면 첫 버튼을 예전 필드에도 같이 적어 둔다(구버전 발송기 호환).
        const setButtons = (buttons: DmMessageButton[]) =>
          setCard(c.id, { buttons, buttonLabel: buttons[0]?.label || '', buttonUrl: buttons[0]?.url || '' });
        const patchButton = (id: string, p: Partial<DmMessageButton>) =>
          setButtons(cardBtns.map((b) => (b.id === id ? { ...b, ...p } : b)));
        const imageInvalid = imageUrlBroken(c.imageUrl);
        const working = busy[c.id];
        const error = imageError[c.id];
        // 제목도 이미지도 없는 카드는 발송에서 빠진다. 저장 전에 알려 준다.
        const empty = !cardSendable(c);
        return (
          <div key={c.id} className="bg-slate-50 border border-slate-100 rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-black text-slate-500">카드 {i + 1}</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="앞으로 옮기기"
                  aria-label="앞으로 옮기기"
                  className="w-7 h-7 rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === cards.length - 1}
                  title="뒤로 옮기기"
                  aria-label="뒤로 옮기기"
                  className="w-7 h-7 rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => duplicate(i)}
                  disabled={cards.length >= CARD_MAX_COUNT}
                  title="카드 복제"
                  aria-label="카드 복제"
                  className="w-7 h-7 rounded-lg text-slate-400 hover:bg-white hover:text-slate-700 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Copy size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  title="카드 삭제"
                  aria-label="카드 삭제"
                  className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* 이미지 — 올리기 / 피드에서 고르기 */}
            <div className="flex gap-3">
              <div className="relative w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center">
                {c.imageUrl && !imageInvalid
                  ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" />
                  : <ImageIcon size={20} className="text-slate-300" />}
                {working && (
                  <div className="absolute inset-0 bg-white/85 flex flex-col items-center justify-center gap-1">
                    <Loader2 size={16} className="animate-spin text-pink-500" />
                    <span className="text-[10px] font-black text-slate-500">
                      {working.ratio > 0 ? `${Math.round(working.ratio * 100)}%` : working.label}
                    </span>
                  </div>
                )}
                {c.imageUrl && !working && (
                  <button
                    type="button"
                    onClick={() => { clearCardState(c.id); setCard(c.id, { imageUrl: '' }); }}
                    title="이미지 지우기"
                    aria-label="이미지 지우기"
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/70 text-white flex items-center justify-center hover:bg-slate-900"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                {/* 카드 한 장이 좁은 칸 안에 들어간다. 그림을 넣는 두 경로는 한 번씩
                    쓰고 마는 버튼이라, 칸의 자리를 그림 미리보기에 내주도록 낮고
                    작게 둔다. */}
                <div className="flex gap-1">
                  <label
                    className={`flex-1 flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 text-[10px] font-black text-slate-600 ${
                      working ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-pink-400 hover:text-pink-600'
                    }`}
                  >
                    <Upload size={11} className="flex-shrink-0" /> 이미지 올리기
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      disabled={Boolean(working)}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // 같은 파일을 다시 고를 수 있게 값을 비운다(안 비우면 onChange 가 안 뜬다).
                        e.target.value = '';
                        if (file) uploadImage(c.id, file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setPickerFor(pickerFor === c.id ? null : c.id)}
                    disabled={Boolean(working)}
                    className={`flex-1 flex items-center justify-center gap-1 rounded-lg border py-1.5 text-[10px] font-black transition-colors disabled:opacity-50 ${
                      pickerFor === c.id
                        ? 'border-pink-500 bg-pink-50 text-pink-600'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-pink-400 hover:text-pink-600'
                    }`}
                  >
                    <Images size={11} className="flex-shrink-0" /> 피드에서 고르기
                  </button>
                </div>
                {/*
                  이미지 주소를 손으로 붙여넣는 칸은 두지 않는다. 올리기·피드에서
                  고르기 두 경로가 모두 인스타그램이 받아갈 수 있는 공개 주소를
                  돌려주므로, 주소 입력은 잘못된 값(상대 경로·만료되는 링크)이
                  들어올 통로만 됐다.
                */}
                {imageInvalid && (
                  <p className="flex items-center gap-1 text-[10px] font-bold text-red-500">
                    <AlertCircle size={11} />
                    이 카드의 이미지 주소를 인스타그램이 받아갈 수 없습니다. 이미지를 다시 올려 주세요.
                  </p>
                )}
                {error && (
                  <p className="flex items-start gap-1 text-[10px] font-bold text-red-500">
                    <AlertCircle size={11} className="mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{error}</span>
                  </p>
                )}
              </div>
            </div>

            {/* 피드 사진 고르기 */}
            {pickerFor === c.id && (
              <div className="border border-slate-200 bg-white rounded-xl p-2.5">
                {mediaLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-[11px] font-bold">게시물을 불러오는 중…</span>
                  </div>
                ) : feedPhotos.length === 0 && mediaError ? (
                  <div className="text-center py-6">
                    <AlertCircle size={22} className="text-amber-400 mx-auto mb-1.5" />
                    <p className="text-[11px] font-bold text-slate-600">피드 사진을 불러오지 못했어요</p>
                    <button
                      type="button"
                      onClick={onRetryMedia}
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-900 text-white px-2.5 py-1.5 text-[10px] font-black hover:bg-slate-800"
                    >
                      <RefreshCw size={10} /> 다시 시도
                    </button>
                    <p className="text-[10px] text-slate-400 mt-1.5">파일로 직접 올려도 됩니다.</p>
                  </div>
                ) : feedPhotos.length === 0 ? (
                  <div className="text-center py-6">
                    <ImageIcon size={22} className="text-slate-300 mx-auto mb-1.5" />
                    <p className="text-[11px] font-bold text-slate-500">가져올 피드 사진이 없어요</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">파일로 직접 올려도 됩니다.</p>
                  </div>
                ) : (
                  <>
                    <p className="text-[10px] font-bold text-slate-400 mb-2">
                      고른 사진은 카드용으로 복사돼요. 원본 게시물을 지워도 카드 이미지는 남습니다.
                    </p>
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-48 overflow-y-auto pr-1">
                      {feedPhotos.slice(0, pickerShown).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => pickFromFeed(c.id, m)}
                          title={m.caption?.slice(0, 60) || '피드 사진'}
                          className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-pink-500 transition-all"
                        >
                          <img src={feedImageOf(m)} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </button>
                      ))}
                      <MoreMediaButton shown={pickerShown} total={feedPhotos.length} onMore={() => setPickerShown((n) => n + MEDIA_GRID_STEP)} />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 문구 */}
            <div className="space-y-2">
              <div>
                <input
                  value={c.title}
                  onChange={(e) => setCard(c.id, { title: e.target.value })}
                  placeholder="제목 (예: 여름 신제품)"
                  maxLength={CARD_TEXT_MAX}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                />
                <p className="text-right text-[10px] text-slate-400 font-bold mt-0.5">{c.title.length}/{CARD_TEXT_MAX}</p>
              </div>
              <div>
                <input
                  value={c.subtitle}
                  onChange={(e) => setCard(c.id, { subtitle: e.target.value })}
                  placeholder="설명 (선택)"
                  maxLength={CARD_TEXT_MAX}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium focus:outline-none focus:border-pink-500"
                />
                <p className="text-right text-[10px] text-slate-400 font-bold mt-0.5">{c.subtitle.length}/{CARD_TEXT_MAX}</p>
              </div>
            </div>

            {/* 카드 버튼 (최대 3개) */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-black text-slate-500">
                <Link2 size={12} /> 카드 버튼 <span className="text-slate-300 font-bold">(최대 {CARD_BUTTON_MAX}개)</span>
              </div>
              {cardBtns.map((b) => (
                <div key={b.id} className="flex gap-2 items-center">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <input
                      value={b.label}
                      onChange={(e) => patchButton(b.id, { label: e.target.value })}
                      placeholder="버튼 이름 (예: 보기)"
                      maxLength={20}
                      className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                    />
                    <input
                      value={b.url}
                      onChange={(e) => patchButton(b.id, { url: cleanLinkInput(e.target.value) })}
                      onBlur={(e) => {
                        const value = normalizeLinkUrl(e.currentTarget.value);
                        if (value) patchButton(b.id, { url: value });
                      }}
                      placeholder="버튼 링크 (https://...)"
                      className={`bg-white border rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500 ${
                        btnInvalid(b) ? 'border-red-300' : 'border-slate-200'
                      }`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setButtons(cardBtns.filter((x) => x.id !== b.id))}
                    aria-label="버튼 삭제"
                    className="w-8 h-8 shrink-0 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {cardBtns.length < CARD_BUTTON_MAX && (
                <button
                  type="button"
                  onClick={() => setButtons([...cardBtns, { id: genId('cbtn'), label: '', url: '' }])}
                  className="w-full border border-dashed border-slate-300 rounded-lg py-2 text-[11px] font-black text-slate-500 hover:border-pink-400 hover:text-pink-500"
                >
                  + 카드 버튼 추가
                </button>
              )}
            </div>
            {cardUrlInvalid && (
              <p className="flex items-center gap-1 px-1 text-[10px] font-bold text-red-500">
                <AlertCircle size={11} />
                https:// 로 시작하는 주소를 입력해야 카드 버튼이 전송됩니다.
              </p>
            )}
            {empty && !working && (
              <p className="flex items-center gap-1 px-1 text-[10px] font-bold text-amber-600">
                <AlertCircle size={11} />
                이미지를 올려야 이 카드가 발송됩니다. (설명이나 버튼만 채워도 됩니다 — 제목만 있는 카드는 인스타그램이 거부합니다.)
              </p>
            )}
          </div>
        );
      })}

      {cards.length < CARD_MAX_COUNT ? (
        <button
          type="button"
          onClick={() => onChange([...cards, blankCard()])}
          className="w-full flex items-center justify-center gap-1.5 border border-dashed border-slate-300 rounded-xl py-2.5 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500"
        >
          <ImagePlus size={14} /> 카드 추가 ({cards.length}/{CARD_MAX_COUNT})
        </button>
      ) : (
        <p className="text-center text-[11px] font-bold text-slate-400">카드는 최대 {CARD_MAX_COUNT}장까지 넣을 수 있어요.</p>
      )}
    </div>
  );
};

/* ────────────────────────── 2단계 추가 메시지 ────────────────────────── */
/** 링크 버튼 목록 편집기(최대 3개) — 추가 메시지의 텍스트에 쓴다. */
const LinkButtonsEditor: React.FC<{
  buttons: DmMessageButton[];
  onChange: (buttons: DmMessageButton[]) => void;
}> = ({ buttons, onChange }) => {
  const update = (id: string, p: Partial<DmMessageButton>) =>
    onChange(buttons.map((b) => (b.id === id ? { ...b, ...p } : b)));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-black text-slate-500">
        <Link2 size={13} /> 링크 버튼 <span className="text-slate-300 font-bold">(선택 · 최대 3개)</span>
      </div>
      {buttons.map((b) => {
        const urlInvalid = linkUrlBroken(b.url) || (Boolean(b.label.trim()) && !b.url.trim());
        return (
          <div key={b.id} className="bg-white border border-slate-100 rounded-xl p-2">
            <div className="flex gap-2 items-center">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  value={b.label}
                  onChange={(e) => update(b.id, { label: e.target.value })}
                  placeholder="버튼 이름 (예: 구매하기)"
                  maxLength={20}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                />
                <input
                  value={b.url}
                  onChange={(e) => update(b.id, { url: cleanLinkInput(e.target.value) })}
                  onBlur={(e) => {
                    const value = normalizeLinkUrl(e.currentTarget.value);
                    if (value) update(b.id, { url: value });
                  }}
                  placeholder="https://..."
                  className={`bg-white border rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500 ${
                    urlInvalid ? 'border-red-300' : 'border-slate-200'
                  }`}
                />
              </div>
              <button type="button" onClick={() => onChange(buttons.filter((x) => x.id !== b.id))} className="w-8 h-8 shrink-0 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center">
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
      {buttons.length < 3 && (
        <button
          type="button"
          onClick={() => onChange([...buttons, { id: genId('btn'), label: '', url: '' }])}
          className="w-full border border-dashed border-slate-300 rounded-xl py-2 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500 bg-white"
        >
          + 버튼 추가
        </button>
      )}
    </div>
  );
};

/** 이미지 한 장 메시지 편집기 — 파일 올리기 / 피드에서 고르기. */
const FollowUpImageEditor: React.FC<{
  userName: string;
  imageUrl: string;
  media: InstagramMedia[];
  mediaLoading: boolean;
  mediaError: string;
  onRetryMedia: () => void;
  onChange: (imageUrl: string) => void;
  onBusyChange?: (busy: boolean) => void;
}> = ({ userName, imageUrl, media, mediaLoading, mediaError, onRetryMedia, onChange, onBusyChange }) => {
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  const taskId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; taskId.current++; };
  }, []);
  const [busy, setBusy] = useState<{ ratio: number; label: string } | null>(null);
  const busyNotice = useRef(onBusyChange);
  busyNotice.current = onBusyChange;
  const uploading = Boolean(busy);
  useEffect(() => {
    busyNotice.current?.(uploading);
    return () => { busyNotice.current?.(false); };
  }, [uploading]);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerShown, setPickerShown] = useState(MEDIA_GRID_STEP);
  const feedPhotos = useMemo(() => media.filter((m) => feedImageOf(m)), [media]);

  const run = async (label: string, task: (onProgress: (ratio: number) => void) => Promise<{ url?: string; error?: string }>) => {
    const currentTask = ++taskId.current;
    const active = () => mounted.current && taskId.current === currentTask;
    setError('');
    setBusy({ ratio: 0, label });
    try {
      const result = await task((ratio) => { if (active()) setBusy((b) => (b ? { ratio, label } : b)); });
      if (!active()) return;
      if (result.url) latestChange.current(result.url);
      else setError(result.error || '이미지를 넣지 못했습니다. 다시 시도해 주세요.');
    } catch {
      if (active()) setError('이미지를 넣지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (active()) setBusy(null);
    }
  };

  const pickFromFeed = (m: InstagramMedia) => {
    const source = feedImageOf(m);
    if (!source) {
      setError('이 게시물에서는 사진을 가져올 수 없어요. 파일로 올려 주세요.');
      return;
    }
    setPickerOpen(false);
    run('피드에서 가져오는 중', () => apiService.copyDmCardImageFromFeed(userName, source));
  };

  const imageInvalid = imageUrlBroken(imageUrl);
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <div className="relative w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center">
          {imageUrl && !imageInvalid
            ? <img src={imageUrl} alt="" className="w-full h-full object-cover" />
            : <ImageIcon size={20} className="text-slate-300" />}
          {busy && (
            <div className="absolute inset-0 bg-white/85 flex flex-col items-center justify-center gap-1">
              <Loader2 size={16} className="animate-spin text-pink-500" />
              <span className="text-[10px] font-black text-slate-500">
                {busy.ratio > 0 ? `${Math.round(busy.ratio * 100)}%` : busy.label}
              </span>
            </div>
          )}
          {imageUrl && !busy && (
            <button
              type="button"
              onClick={() => { setError(''); onChange(''); }}
              title="이미지 지우기"
              aria-label="이미지 지우기"
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/70 text-white flex items-center justify-center hover:bg-slate-900"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-1">
            <label
              className={`flex-1 flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white py-1.5 text-[10px] font-black text-slate-600 ${
                busy ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-pink-400 hover:text-pink-600'
              }`}
            >
              <Upload size={11} className="flex-shrink-0" /> 이미지 올리기
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={Boolean(busy)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) run('올리는 중', (onProgress) => apiService.uploadDmCardImage(userName, file, onProgress));
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setPickerOpen(!pickerOpen)}
              disabled={Boolean(busy)}
              className={`flex-1 flex items-center justify-center gap-1 rounded-lg border py-1.5 text-[10px] font-black transition-colors disabled:opacity-50 ${
                pickerOpen
                  ? 'border-pink-500 bg-pink-50 text-pink-600'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-pink-400 hover:text-pink-600'
              }`}
            >
              <Images size={11} className="flex-shrink-0" /> 피드에서 고르기
            </button>
          </div>
          <p className="text-[10px] text-slate-400 font-bold leading-relaxed">
            {DM_CARD_IMAGE_MAX_MB}MB 이하 JPG·PNG·WEBP 이미지 한 장이 사진 메시지로 발송됩니다.
          </p>
          {imageInvalid && (
            <p className="flex items-center gap-1 text-[10px] font-bold text-red-500">
              <AlertCircle size={11} />
              이미지 주소를 인스타그램이 받아갈 수 없습니다. 이미지를 다시 올려 주세요.
            </p>
          )}
          {error && (
            <p className="flex items-start gap-1 text-[10px] font-bold text-red-500">
              <AlertCircle size={11} className="mt-0.5 shrink-0" />
              <span className="leading-relaxed">{error}</span>
            </p>
          )}
        </div>
      </div>
      {pickerOpen && (
        <div className="border border-slate-200 bg-white rounded-xl p-2.5">
          {mediaLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-[11px] font-bold">게시물을 불러오는 중…</span>
            </div>
          ) : feedPhotos.length === 0 ? (
            <div className="text-center py-6">
              <ImageIcon size={22} className="text-slate-300 mx-auto mb-1.5" />
              <p className="text-[11px] font-bold text-slate-500">
                {mediaError ? '피드 사진을 불러오지 못했어요' : '가져올 피드 사진이 없어요'}
              </p>
              {mediaError && (
                <button
                  type="button"
                  onClick={onRetryMedia}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-900 text-white px-2.5 py-1.5 text-[10px] font-black hover:bg-slate-800"
                >
                  <RefreshCw size={10} /> 다시 시도
                </button>
              )}
              <p className="text-[10px] text-slate-400 mt-1.5">파일로 직접 올려도 됩니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {feedPhotos.slice(0, pickerShown).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickFromFeed(m)}
                  title={m.caption?.slice(0, 60) || '피드 사진'}
                  className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-pink-500 transition-all"
                >
                  <img src={feedImageOf(m)} alt="" className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
              <MoreMediaButton shown={pickerShown} total={feedPhotos.length} onMore={() => setPickerShown((n) => n + MEDIA_GRID_STEP)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FOLLOW_UP_TYPES: { t: DmFollowUp['type']; label: string; icon: React.ReactNode }[] = [
  { t: 'text', label: '텍스트', icon: <AlignLeft size={14} /> },
  { t: 'carousel', label: '캐러셀', icon: <GalleryHorizontalEnd size={14} /> },
  { t: 'image', label: '이미지', icon: <ImageIcon size={14} /> },
];

const blankFollowUp = (t: DmFollowUp['type']): DmFollowUp => ({
  id: genId('fu'),
  type: t,
  message: '',
  buttons: [],
  cards: t === 'carousel' ? [blankCard()] : [],
  imageUrl: '',
});

/**
 * 2단계 본 메시지 뒤에 이어서 보낼 추가 메시지 목록.
 *
 * 예고 버튼을 누른 사람과는 대화창이 열려 있어 여러 통을 순서대로 보낼 수 있다.
 * 텍스트 · 캐러셀 · 이미지를 최대 {FOLLOW_UP_MAX}통까지 본 메시지 뒤에 붙인다.
 */
const FollowUpsEditor: React.FC<{
  userName: string;
  followUps: DmFollowUp[];
  media: InstagramMedia[];
  mediaLoading: boolean;
  mediaError: string;
  onRetryMedia: () => void;
  onChange: (followUps: DmFollowUp[]) => void;
  onBusyChange: (id: string, busy: boolean) => void;
}> = ({ userName, followUps, media, mediaLoading, mediaError, onRetryMedia, onChange, onBusyChange }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const setItem = (id: string, p: Partial<DmFollowUp>) =>
    onChange(followUps.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= followUps.length) return;
    const next = [...followUps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const add = (t: DmFollowUp['type']) => {
    setMenuOpen(false);
    onChange([...followUps, blankFollowUp(t)]);
  };

  return (
    <div className="mt-4 space-y-3">
      {followUps.map((f, i) => {
        const typeInfo = FOLLOW_UP_TYPES.find((x) => x.t === f.type) || FOLLOW_UP_TYPES[0];
        return (
          <div key={f.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-black text-slate-500">
                {typeInfo.icon} 추가 메시지 {i + 1} · {typeInfo.label}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="위로 옮기기"
                  aria-label="위로 옮기기"
                  className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === followUps.length - 1}
                  title="아래로 옮기기"
                  aria-label="아래로 옮기기"
                  className="w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(followUps.filter((x) => x.id !== f.id))}
                  title="메시지 삭제"
                  aria-label="메시지 삭제"
                  className="w-7 h-7 rounded-lg text-red-400 hover:bg-red-50 flex items-center justify-center"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {f.type === 'text' && (
              <>
                <div>
                  <textarea
                    value={f.message || ''}
                    onChange={(e) => setItem(f.id, { message: e.target.value })}
                    rows={3}
                    maxLength={1000}
                    placeholder="이어서 보낼 메시지를 입력하세요."
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-pink-500 resize-none"
                  />
                  <p className="text-right text-[10px] text-slate-400 font-bold mt-1">{(f.message || '').length}/1000</p>
                </div>
                <LinkButtonsEditor buttons={f.buttons || []} onChange={(buttons) => setItem(f.id, { buttons })} />
              </>
            )}
            {f.type === 'carousel' && (
              <CarouselBuilder
                userName={userName}
                cards={f.cards || []}
                media={media}
                mediaLoading={mediaLoading}
                mediaError={mediaError}
                onRetryMedia={onRetryMedia}
                onChange={(cards) => setItem(f.id, { cards })}
                onBusyChange={(busy) => onBusyChange(f.id, busy)}
              />
            )}
            {f.type === 'image' && (
              <FollowUpImageEditor
                userName={userName}
                imageUrl={f.imageUrl || ''}
                media={media}
                mediaLoading={mediaLoading}
                mediaError={mediaError}
                onRetryMedia={onRetryMedia}
                onChange={(imageUrl) => setItem(f.id, { imageUrl })}
                onBusyChange={(busy) => onBusyChange(f.id, busy)}
              />
            )}
            {!followUpSendable(f) && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-600">
                <AlertCircle size={11} /> 내용이 비어 있는 메시지는 발송되지 않습니다.
              </p>
            )}
          </div>
        );
      })}

      {followUps.length < FOLLOW_UP_MAX ? (
        menuOpen ? (
          <div className="rounded-2xl border border-dashed border-pink-300 bg-pink-50/40 p-3">
            <p className="text-[11px] font-black text-slate-500 mb-2">추가할 메시지 형식을 골라 주세요</p>
            <div className="grid grid-cols-3 gap-2">
              {FOLLOW_UP_TYPES.map((opt) => (
                <button
                  key={opt.t}
                  type="button"
                  onClick={() => add(opt.t)}
                  className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-slate-200 bg-white py-2.5 text-xs font-black text-slate-700 hover:border-pink-500 hover:text-pink-600"
                >
                  {opt.icon}{opt.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setMenuOpen(false)} className="mt-2 w-full text-[11px] font-bold text-slate-400 hover:text-slate-600">
              취소
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 border border-dashed border-slate-300 rounded-2xl py-3 text-xs font-black text-slate-500 hover:border-pink-400 hover:text-pink-500 bg-white"
          >
            <Plus size={14} /> 메시지 추가 ({followUps.length}/{FOLLOW_UP_MAX})
          </button>
        )
      ) : (
        <p className="text-center text-[11px] font-bold text-slate-400">추가 메시지는 최대 {FOLLOW_UP_MAX}통까지 넣을 수 있어요.</p>
      )}
    </div>
  );
};

/* ────────────────────────── 자동화 생성/편집 모달 ────────────────────────── */
const AutomationEditor: React.FC<{
  initial: DmAutomationItem;
  /**
   * 이 기기에 보관해 둔 입력을 이어서 여는 경우. 서버에는 아직 없는 내용이므로 처음부터
   * "저장하지 않은 변경"으로 본다.
   */
  restored?: { keywordInput: string } | null;
  /** 이어서 연 편집을 버리고 저장된 내용으로 다시 연다. 저장된 적 있는 자동화에만 있다. */
  onReopenSaved?: () => void;
  /** 로그인 계정(업로드 저장 경로에 쓴다). 인스타그램 계정명과 다를 수 있다. */
  userName: string;
  igUsername: string;
  media: InstagramMedia[];
  mediaLoading: boolean;
  /** 게시물을 받아오지 못한 이유. 목록이 비었을 때 무엇을 해야 하는지 가른다. */
  mediaError: string;
  onRetryMedia: () => void;
  onClose: () => void;
  onSave: (a: DmAutomationItem) => void;
  saving: boolean;
  saveError: string;
}> = ({ initial, restored, onReopenSaved, userName, igUsername, media, mediaLoading, mediaError, onRetryMedia, onClose, onSave, saving, saveError }) => {
  const [draft, setDraft] = useState<DmAutomationItem>(initial);
  const [keywordInput, setKeywordInput] = useState(() => restored?.keywordInput || '');
  const [mediaShown, setMediaShown] = useState(MEDIA_GRID_STEP);

  const initialJson = useMemo(() => JSON.stringify(initial), [initial]);
  const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = Boolean(restored) || keywordInput.trim() !== '' || draftJson !== initialJson;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  /**
   * 저장하지 않은 입력이 있으면 닫기 전에 묻는다. 가장자리 스와이프 · 앱의 뒤로 버튼 ·
   * 취소 버튼은 의도하지 않게 눌리기 쉬운데, 예전에는 그 한 번에 입력한 내용이 모두
   * 사라졌다.
   */
  const confirmDiscard = () => {
    // 저장 응답을 기다리는 동안에는 닫지 않는다. 여기서 닫으면 보관해 둔 입력까지 지워지는데,
    // 그 저장이 실패하면 입력이 어디에도 남지 않는다. 결과는 곧 이 창에 나온다.
    if (savingRef.current) return false;
    if (!dirtyRef.current) return true;
    if (!window.confirm('저장하지 않은 변경 내용이 있어요. 닫으면 입력한 내용이 사라집니다. 닫을까요?')) return false;
    clearEditorDraft(userName);
    return true;
  };
  const requestClose = () => {
    if (confirmDiscard()) onClose();
  };
  // 이 창은 열릴 때만 그려지므로 늘 열린 상태로 두면 된다. 자동응답 편집은 입력이
  // 많아 휴대폰에서 닫기 버튼이 위로 밀려나므로 뒤로가기로도 닫히게 한다.
  useCloseOnBack(true, onClose, confirmDiscard);

  // 입력이 바뀔 때마다 이 기기에 적어 둔다(EditorDraft 참고). 처음 상태로 되돌렸으면 지운다.
  useEffect(() => {
    if (!dirty) {
      clearEditorDraft(userName);
      return;
    }
    const timer = window.setTimeout(() => {
      writeJson<EditorDraft>(editorDraftKey(userName), { savedAt: Date.now(), draft, keywordInput });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, keywordInput, userName]);

  // 화면이 가려지는 순간(사진 고르기 · 다른 앱으로 전환)에는 기다리지 않고 바로 적는다.
  // 가려진 동안 시스템이 화면을 정리할 수 있다.
  const latestInput = useRef({ dirty, draft, keywordInput });
  latestInput.current = { dirty, draft, keywordInput };
  useEffect(() => {
    const flush = () => {
      const current = latestInput.current;
      if (document.visibilityState !== 'hidden' || !current.dirty) return;
      writeJson<EditorDraft>(editorDraftKey(userName), {
        savedAt: Date.now(),
        draft: current.draft,
        keywordInput: current.keywordInput,
      });
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, [userName]);

  // 저장하지 않은 입력이 있는 동안은 새 배포 반영을 위한 자동 새로고침을 미룬다.
  useEffect(() => {
    setUnsavedWork('dm-automation-editor', dirty);
    return () => setUnsavedWork('dm-automation-editor', false);
  }, [dirty]);
  const [uploads, setUploads] = useState<Record<string, boolean>>({});
  const trackUpload = (id: string, busy: boolean) => setUploads((current) => {
    if (Boolean(current[id]) === busy) return current;
    const next = { ...current };
    if (busy) next[id] = true;
    else delete next[id];
    return next;
  });
  const uploading = Object.keys(uploads).length > 0;

  const patch = (p: Partial<DmAutomationItem>) => setDraft((d) => ({ ...d, ...p }));

  // 입력칸 앞에 # 아이콘이 있어 "#가격" 처럼 # 까지 치는 경우가 많다. 댓글에는 보통
  // # 이 없으므로 앞의 # 은 떼고 저장한다.
  const cleanKeyword = (value: string) => value.trim().replace(/^#+/, '').trim();
  const addKeyword = () => {
    const k = cleanKeyword(keywordInput);
    if (!k || draft.keywords.includes(k)) { setKeywordInput(''); return; }
    patch({ keywords: [...draft.keywords, k] });
    setKeywordInput('');
  };
  // 입력만 하고 Enter · 추가를 누르지 않은 키워드도 저장에 포함한다 — 예전에는 조용히
  // 버려져, 키워드가 없는 자동화가 저장되거나 저장 버튼이 막혔다.
  const pendingKeyword = cleanKeyword(keywordInput);
  const effectiveKeywords = pendingKeyword && !draft.keywords.includes(pendingKeyword)
    ? [...draft.keywords, pendingKeyword]
    : draft.keywords;

  const updateButton = (id: string, p: Partial<DmMessageButton>) =>
    patch({ buttons: draft.buttons.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const addButton = () =>
    patch({ buttons: [...draft.buttons, { id: genId('btn'), label: '', url: '' }] });
  const removeButton = (id: string) =>
    patch({ buttons: draft.buttons.filter((b) => b.id !== id) });

  const toggleMedia = (id: string) => {
    const has = draft.mediaIds.includes(id);
    patch({ mediaIds: has ? draft.mediaIds.filter((m) => m !== id) : [...draft.mediaIds, id] });
  };

  // 실제로 발송되는 카드(이미지·설명·버튼 중 하나가 있는 카드)가 한 장이라도 있어야 저장한다.
  const validCards = draft.cards.filter(cardSendable);
  const messageValid = draft.messageType === 'carousel'
    ? validCards.length > 0
    : draft.message.trim().length > 0;
  const mediaValid = draft.mediaScope === 'all' || draft.mediaIds.length > 0;

  // 링크가 잘못돼 있으면 발송 시점에 그 버튼이 조용히 빠진다. 저장 자체를 막아
  // "설정은 저장됐는데 버튼만 안 보이는" 상황을 없앤다.
  const buttonBroken = (b: DmMessageButton) => linkUrlBroken(b.url) || (Boolean(b.label.trim()) && !b.url.trim());
  const cardBroken = (c: DmCarouselCard) =>
    cardButtonList(c).some(buttonBroken) ||
    // 카드 이미지도 인스타그램이 직접 받아가는 주소다. 잘못돼 있으면 서버가 저장을 거절한다.
    imageUrlBroken(c.imageUrl);
  const brokenLinks =
    draft.buttons.some(buttonBroken) ||
    draft.cards.some(cardBroken) ||
    (draft.followUps || []).some((f) =>
      (f.type === 'text' && (f.buttons || []).some(buttonBroken)) ||
      (f.type === 'carousel' && (f.cards || []).some(cardBroken)) ||
      (f.type === 'image' && imageUrlBroken(f.imageUrl || '')));

  /**
   * 예약 발송은 시각이 있어야 성립한다. 시각 없이 저장하면 발송기가 언제 보낼지
   * 알 수 없어 그 자동화는 아무 일도 하지 않는다.
   */
  const scheduleMs = draft.scheduledAt ? Date.parse(draft.scheduledAt) : NaN;
  const scheduleValid = draft.sendMode !== 'scheduled' || !Number.isNaN(scheduleMs);
  /** 정해 둔 예약 시각이 이미 지났는지. 저장은 막지 않고 안내만 한다. */
  const scheduleStale =
    draft.sendMode === 'scheduled' && !Number.isNaN(scheduleMs) && scheduleMs <= Date.now();

  /** 팔로우 조건을 쓰면 버튼을 누른 시점에 확인해야 하므로 2단계 발송이 강제된다. */
  const baitForced = draft.followFilter !== 'all';
  const baitOn = baitForced || Boolean(draft.baitEnabled);
  const baitValid = !baitOn || Boolean((draft.baitMessage || '').trim() && (draft.baitButtonLabel || '').trim());

  const canSave = messageValid &&
    !uploading &&
    baitValid &&
    mediaValid &&
    !brokenLinks &&
    scheduleValid &&
    (draft.commentMatch === 'all' || effectiveKeywords.length > 0);

  /**
   * 저장 버튼이 잠긴 이유. 예전에는 버튼만 흐려져서, 카드를 여러 장 만들어 둔
   * 사용자가 "왜 설정 완료가 안 눌리는지" 알 방법이 없었다.
   */
  const saveBlockedReason = canSave
    ? ''
    : uploading
      ? '이미지 업로드가 끝날 때까지 기다려 주세요.'
      : !mediaValid
      ? '적용할 게시물을 한 개 이상 선택해주세요.'
      : draft.commentMatch === 'keyword' && effectiveKeywords.length === 0
        ? '반응할 키워드를 한 개 이상 추가해주세요.'
        : !scheduleValid
          ? '예약 발송할 날짜·시간을 정해주세요.'
          : brokenLinks
            ? '링크·이미지 주소를 https:// 로 시작하는 주소로 고쳐주세요.'
            : !baitValid
              ? '예고 메시지 문구와 버튼 이름을 입력해주세요.'
            : draft.messageType === 'carousel'
              ? '이미지나 제목이 있는 카드를 한 장 이상 만들어주세요.'
              : '보낼 DM 메시지를 입력해주세요.';

  const cleanCard = (c: DmCarouselCard): DmCarouselCard => {
    const buttons = cardButtonList(c)
      .filter((b) => b.label.trim() || b.url.trim())
      .slice(0, CARD_BUTTON_MAX)
      .map((b) => ({ ...b, url: normalizeLinkUrl(b.url) }));
    return {
      ...c,
      buttons,
      buttonLabel: buttons[0]?.label || '',
      buttonUrl: buttons[0]?.url || '',
      imageUrl: normalizeImageUrl(c.imageUrl),
    };
  };

  const handleSave = () => {
    if (!canSave || saving) return;
    // 스킴이 빠진 주소(`example.com`)는 여기서 https:// 를 붙여 저장한다.
    onSave({
      ...draft,
      keywords: effectiveKeywords,
      name: draft.name.trim() || (draft.commentMatch === 'keyword' ? `키워드 DM` : '댓글 DM'),
      // 즉시 발송으로 되돌렸다면 예약 시각은 남겨두지 않는다.
      scheduledAt: draft.sendMode === 'scheduled' ? draft.scheduledAt : '',
      buttons: draft.buttons.map((b) => ({ ...b, url: normalizeLinkUrl(b.url) })),
      cards: draft.cards.map(cleanCard),
      // 추가 메시지는 2단계 발송에서만 나간다. 내용이 빈 메시지는 저장하지 않는다.
      followUps: (draft.followUps || [])
        .filter(followUpSendable)
        .map((f) => ({
          ...f,
          buttons: (f.buttons || [])
            .filter((b) => b.label.trim() || b.url.trim())
            .map((b) => ({ ...b, url: normalizeLinkUrl(b.url) })),
          cards: (f.cards || []).map(cleanCard),
          imageUrl: f.imageUrl ? normalizeImageUrl(f.imageUrl) : '',
        })),
    });
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-end md:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 md:p-6 animate-in fade-in duration-200">
      <div className="bg-white w-full md:max-w-4xl md:rounded-[2rem] rounded-t-[2rem] shadow-2xl max-h-[94vh] modal-maxh-94 md:max-h-[90vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 md:px-8 py-4 md:py-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center text-white">
              <Sparkles size={17} />
            </div>
            <h3 className="text-lg md:text-xl font-black text-slate-900">자동 DM 설정</h3>
          </div>
          <button onClick={requestClose} disabled={saving} className="shrink-0 w-11 h-11 md:w-9 md:h-9 -my-1 -mr-1 md:m-0 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400" aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        {/*
          스크롤 본문. 부모가 flex 컬럼이므로 `flex-1 min-h-0` 이 둘 다 필요하다 —
          min-h-0 없이는 flex 항목의 최소 높이가 내용 높이로 잡혀 본문이 카드 높이
          상한(max-h-[94vh])을 넘겨 버리고, 넘친 만큼이 잘려 스크롤도 되지 않는다.
        */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain grid grid-cols-1 lg:grid-cols-[1fr_340px]">
          {/* 좌: 설정 */}
          <fieldset disabled={saving} className="min-w-0 m-0 border-0 p-5 md:p-8 space-y-7">
            {/* 이 기기에 남아 있던 편집을 이어서 연 경우. 저장된(= 실제로 발송되는) 내용과 다를 수 있다. */}
            {restored && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="min-w-0 text-xs font-bold text-amber-800 break-words">
                  저장하지 않고 남아 있던 편집을 이어서 열었어요. 저장하기 전까지는 발송에 반영되지 않아요.
                </p>
                {onReopenSaved && (
                  <button
                    type="button"
                    onClick={onReopenSaved}
                    className="shrink-0 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-black text-amber-800 hover:bg-amber-100"
                  >
                    저장된 내용으로 열기
                  </button>
                )}
              </div>
            )}

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
                ) : media.length === 0 && mediaError ? (
                  <div className="text-center py-8 border border-dashed border-amber-200 rounded-2xl bg-amber-50/60">
                    <AlertCircle size={26} className="text-amber-400 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-700">게시물을 불러오지 못했어요</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 px-4 leading-relaxed">{mediaError}</p>
                    <button
                      type="button"
                      onClick={onRetryMedia}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-3 py-1.5 text-[11px] font-black hover:bg-slate-800"
                    >
                      <RefreshCw size={11} /> 다시 시도
                    </button>
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
                      {media.slice(0, mediaShown).map((m) => {
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
                            {feedImageOf(m)
                              ? <img src={feedImageOf(m)} alt={m.caption.slice(0, 40)} className="w-full h-full object-cover" loading="lazy" decoding="async" />
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
                      <MoreMediaButton shown={mediaShown} total={media.length} onMore={() => setMediaShown((n) => n + MEDIA_GRID_STEP)} />
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
                        onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
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
                    onClick={() => patch(f === 'all' ? { followFilter: f } : { followFilter: f, baitEnabled: true })}
                    className={`rounded-xl border-2 px-3 py-2.5 text-center transition-all text-xs font-black ${
                      draft.followFilter === f ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {FOLLOW_LABEL[f]}
                  </button>
                ))}
              </div>
              {draft.followFilter !== 'all' && (
                <p className="flex items-start gap-1.5 mt-2 text-[11px] text-pink-600 font-bold leading-relaxed">
                  <AlertCircle size={13} className="shrink-0 mt-px" />
                  팔로워 구분 발송을 위해서는 예고 메시지가 필요합니다. 버튼을 누른 순간 팔로우 여부를 확인해 본 메시지를 보냅니다.
                </p>
              )}
            </div>

            {/* 4. 발송 시점 — 즉시 / 예약 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">4</span>
                <h4 className="text-sm md:text-base font-black text-slate-900">언제 보낼까요?</h4>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { m: 'instant' as const, icon: <Zap size={15} />, label: '즉시 발송', desc: '댓글이 달리면 바로' },
                  { m: 'scheduled' as const, icon: <Clock size={15} />, label: '예약 발송', desc: '정해 둔 시각에' },
                ]).map((opt) => (
                  <button
                    key={opt.m}
                    type="button"
                    onClick={() => patch({
                      sendMode: opt.m,
                      // 예약을 처음 고른 경우에만 기본 시각(한 시간 뒤)을 채운다.
                      scheduledAt: opt.m === 'scheduled' && !draft.scheduledAt ? defaultScheduleAt() : draft.scheduledAt,
                    })}
                    className={`rounded-xl border-2 px-3 py-2.5 text-left transition-all ${
                      (draft.sendMode || 'instant') === opt.m ? 'border-pink-500 bg-pink-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <span className={`flex items-center gap-1.5 text-sm font-black ${
                      (draft.sendMode || 'instant') === opt.m ? 'text-pink-700' : 'text-slate-700'
                    }`}>
                      {opt.icon} {opt.label}
                    </span>
                    <span className="block text-[11px] font-medium text-slate-500 mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>

              {draft.sendMode === 'scheduled' && (
                <div className="mt-3 space-y-2">
                  <input
                    type="datetime-local"
                    value={draft.scheduledAt && !Number.isNaN(scheduleMs) ? toLocalInput(new Date(scheduleMs)) : ''}
                    onChange={(e) => patch({
                      scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : '',
                    })}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-pink-500"
                  />
                  <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
                    조건에 맞는 댓글이 달리면 바로 보내지 않고 <b>{draft.scheduledAt && !Number.isNaN(scheduleMs) ? fmtDateTime(draft.scheduledAt) : '정한 시각'}</b>에 보냅니다.
                    인스타그램은 댓글이 달린 뒤 <b>7일</b> 안의 DM(비공개 답장)만 허용하니, 그 안쪽 시각으로 정해주세요.
                  </p>
                  {scheduleStale && (
                    <p className="text-[11px] font-bold text-amber-600 leading-relaxed">
                      <AlertCircle size={12} className="inline mr-1 -mt-0.5" />
                      정해 둔 시각이 이미 지났어요. 지금 저장하면 앞으로 달리는 댓글에는 즉시 DM 이 나갑니다.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 5. 댓글 답글 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">5</span>
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

            {/* 6. 메시지 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-[11px] font-black">6</span>
                <h4 className="text-sm md:text-base font-black text-slate-900">보낼 DM 메시지</h4>
              </div>

              {/*
                2단계 발송(예고 메시지). 댓글 비공개 답장은 댓글 1건당 1통뿐이라, 켜면 첫 통은
                짧은 문구 + 버튼 하나만 보내고 버튼을 누른 사람에게 아래 본 메시지를 보낸다.
                버튼 클릭으로 대화창이 열려 본문 길이·통 수 제한이 사라진다.
              */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">예고 메시지 사용</p>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-relaxed">
                      댓글 직후 짧은 예고 메시지와 버튼을 먼저 보내고, 버튼을 누르면 본 메시지(긴 글·여러 버튼·캐러셀)를 보냅니다.
                    </p>
                  </div>
                  <Toggle
                    on={baitOn}
                    onClick={() => { if (!baitForced) patch({ baitEnabled: !draft.baitEnabled }); }}
                    disabled={baitForced}
                  />
                </div>
                <p className="flex items-start gap-1.5 mt-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600 font-medium leading-relaxed">
                  <Info size={13} className="shrink-0 mt-px text-slate-400" />
                  <span>
                    여러 개의 메시지를 보내려면 기본 메시지가 필요합니다.
                    <br />
                    기본 메시지의 버튼을 클릭하면 아래 "메시지 설정"에서 설정해주신 본문 메시지가 발송됩니다.
                  </span>
                </p>
                {baitForced && (
                  <p className="flex items-start gap-1.5 mt-2 text-[11px] text-pink-600 font-bold leading-relaxed">
                    <AlertCircle size={13} className="shrink-0 mt-px" />
                    팔로워 구분 발송을 위해서는 예고 메시지가 필요합니다.
                  </p>
                )}

                {baitOn && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs font-black text-slate-500">1단계 · 댓글 직후 보낼 예고 메시지</p>
                    <textarea
                      value={draft.baitMessage || ''}
                      onChange={(e) => patch({ baitMessage: e.target.value.slice(0, CARD_TEXT_MAX) })}
                      rows={2}
                      maxLength={CARD_TEXT_MAX}
                      placeholder={DEFAULT_BAIT_MESSAGE}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-pink-500 resize-none"
                    />
                    <p className="text-right text-[10px] text-slate-400 font-bold">{(draft.baitMessage || '').length}/{CARD_TEXT_MAX}</p>
                    <input
                      value={draft.baitButtonLabel || ''}
                      onChange={(e) => patch({ baitButtonLabel: e.target.value })}
                      maxLength={20}
                      placeholder={`버튼 이름 (예: ${DEFAULT_BAIT_BUTTON_LABEL})`}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                    />
                    <p className="flex items-start gap-1.5 text-[11px] text-slate-400 font-bold leading-relaxed">
                      <AlertCircle size={12} className="shrink-0 mt-px" />
                      버튼을 누르면 무엇을 받는지 솔직하게 적어 주세요. 받는 내용과 다른 문구로 클릭을 유도하면 인스타그램 스팸 정책에 걸릴 수 있습니다.
                    </p>

                    {baitForced && (
                      <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
                        <p className="text-xs font-black text-slate-500">
                          {draft.followFilter === 'followers'
                            ? '팔로우하지 않은 사람이 버튼을 누르면 보낼 안내'
                            : '이미 팔로우한 사람이 버튼을 누르면 보낼 안내'}
                        </p>
                        <textarea
                          value={draft.followGateMessage || ''}
                          onChange={(e) => patch({ followGateMessage: e.target.value })}
                          rows={2}
                          maxLength={CARD_TEXT_MAX}
                          placeholder={DEFAULT_FOLLOW_GATE_MESSAGE}
                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-pink-500 resize-none"
                        />
                        <input
                          value={draft.followGateButtonLabel || ''}
                          onChange={(e) => patch({ followGateButtonLabel: e.target.value })}
                          maxLength={20}
                          placeholder={`다시 확인 버튼 이름 (예: ${DEFAULT_FOLLOW_GATE_BUTTON_LABEL})`}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-pink-500"
                        />
                        <p className="text-[11px] text-slate-400 font-bold leading-relaxed">
                          안내와 함께 다시 확인 버튼이 나갑니다. 조건을 충족한 뒤 버튼을 누르면 본 메시지가 발송됩니다.
                        </p>
                      </div>
                    )}

                  </div>
                )}
              </div>

              {/* 2단계 · 본 메시지 — 예고 메시지를 켜면 형식(텍스트/캐러셀) 선택과 내용이 이 안에 들어간다. */}
              <div className={baitOn ? 'rounded-2xl border border-slate-200 bg-white p-4' : ''}>
              {baitOn && (
                <div className="mb-4 space-y-2">
                    <p className="text-xs font-black text-slate-500">2단계 · 버튼을 누르면 보낼 본 메시지</p>
                    {/* 인사말은 캐러셀일 때만 받는다. 텍스트는 본문에 바로 적으면 된다. */}
                    {draft.messageType === 'carousel' && (
                    <textarea
                      value={draft.mainIntro || ''}
                      onChange={(e) => patch({ mainIntro: e.target.value })}
                      rows={2}
                      maxLength={1000}
                      placeholder="본 메시지 앞에 먼저 보낼 인사말 (선택)"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-pink-500 resize-none"
                    />
                    )}
                    <p className="text-[11px] text-slate-400 font-bold leading-relaxed">
                      DM은 댓글을 남긴 사용자의 요청 폴더로 수신되며, 요청을 '수락'하지 않을 경우 다음 번 댓글을 남겼을 때 메시지를 받지 못할 수 있습니다.
                    </p>
                </div>
              )}
              {/* 메시지 형식 선택 */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                {([
                  { t: 'text' as const, icon: <AlignLeft size={15} />, label: '텍스트', desc: '메시지 (링크 버튼은 선택)' },
                  { t: 'carousel' as const, icon: <GalleryHorizontalEnd size={15} />, label: '캐러셀', desc: '이미지 카드 여러 장' },
                ]).map((opt) => (
                  <button
                    key={opt.t}
                    type="button"
                    onClick={() => patch(
                      // 캐러셀로 바꾸면 빈 카드 한 장을 미리 놓아 준다. 빈 화면에서
                      // '카드 추가'를 먼저 찾아야 하면 무엇을 채워야 하는지 보이지 않는다.
                      opt.t === 'carousel' && draft.cards.length === 0
                        ? { messageType: opt.t, cards: [blankCard()] }
                        : { messageType: opt.t },
                    )}
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
                  {/* 댓글 DM 은 1통만 도착해 링크 버튼이 있으면 본문이 카드 한 장에 담긴다. */}
                  {!baitOn && draft.buttons.some((b) => b.label.trim() || b.url.trim()) && (
                    <p className={`mt-1 text-[11px] font-bold leading-relaxed ${
                      draft.message.trim().length > CARD_TEXT_MAX ? 'text-red-500' : 'text-slate-400'
                    }`}>
                      {draft.message.trim().length > CARD_TEXT_MAX
                        ? `링크 버튼을 함께 보낼 때는 본문을 ${CARD_TEXT_MAX}자 이내로 작성해 주세요. (현재 ${draft.message.trim().length}자) 인스타그램은 댓글 1건당 DM을 1통만 허용해, 본문과 버튼이 카드 한 장에 담기며 ${CARD_TEXT_MAX}자를 넘는 내용은 작게 표시되거나 잘릴 수 있습니다.`
                        : `링크 버튼을 함께 보낼 때는 본문을 ${CARD_TEXT_MAX}자 이내로 작성해 주세요.`}
                    </p>
                  )}
                  {/* 2단계 본 메시지는 본문 + 링크 버튼이 말풍선 한 통으로 간다(본문 640자까지). */}
                  {baitOn && draft.buttons.some((b) => b.label.trim() || b.url.trim()) && (
                    hasLinkInText(draft.message) ? (
                      <p className="flex items-start gap-1.5 mt-1 text-[11px] font-bold leading-relaxed text-pink-600">
                        <Info size={12} className="shrink-0 mt-px" />
                        본문에 링크 주소가 있어 링크가 파란색으로 보이고 눌리도록 본문과 링크 버튼을 따로 보냅니다. (한 통으로 보내면 인스타그램이 본문 속 링크를 눌리지 않는 글자로 표시해요.)
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] font-bold leading-relaxed text-slate-400">
                        {draft.message.trim().length > BUTTON_TEXT_MAX
                          ? `본문이 ${BUTTON_TEXT_MAX}자를 넘어 앞부분은 텍스트로 먼저, 마지막 ${BUTTON_TEXT_MAX}자는 링크 버튼과 함께 한 통으로 발송됩니다. (현재 ${draft.message.trim().length}자)`
                          : `본문과 링크 버튼이 메시지 한 통으로 발송됩니다. (본문 ${BUTTON_TEXT_MAX}자까지) 따로 보내고 싶다면 아래 "메시지 추가"에서 텍스트를 추가해 링크 버튼을 넣어 주세요.`}
                      </p>
                    )
                  )}

                  {/* 링크 버튼 */}
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-500">
                      <Link2 size={13} /> 링크 버튼 <span className="text-slate-300 font-bold">(선택 · 최대 3개)</span>
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
                            onChange={(e) => updateButton(b.id, { url: cleanLinkInput(e.target.value) })}
                            onBlur={(e) => {
                              const value = normalizeLinkUrl(e.currentTarget.value);
                              if (value) updateButton(b.id, { url: value });
                            }}
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
                /* 캐러셀 카드 빌더 — 이미지·문구·버튼·순서를 여기서 만든다. */
                <div className="space-y-4">
                  {/*
                    캐러셀에는 인사말 입력칸을 두지 않는다. 인스타그램 메시지 한 통에는
                    텍스트와 첨부(캐러셀) 중 하나만 담을 수 있고, 댓글 자동 DM 은 댓글
                    1건당 비공개 답장 1통이 전부다. 인사말을 따로 받아 두면 대화창이
                    이미 열린 상대에게만 도착해 "적었는데 안 갔다"가 된다. 전하고 싶은
                    문구는 카드의 제목·설명에 적는다.
                  */}
                  <p className="flex items-start gap-1.5 text-[11px] text-slate-400 font-bold leading-relaxed">
                    <AlignLeft size={13} className="shrink-0 mt-px" />
                    {baitOn
                      ? '캐러셀은 버튼을 누른 사람에게 카드 한 통으로 발송됩니다. 인사말은 위 2단계 인사말 칸에 적으면 카드보다 먼저 도착합니다.'
                      : '캐러셀은 카드 한 통으로 발송됩니다. 인스타그램이 메시지 한 통에 텍스트와 카드를 함께 담지 못하기 때문에, 인사말처럼 전하고 싶은 문구는 카드의 제목·설명에 적어 주세요.'}
                  </p>

                  <CarouselBuilder
                    userName={userName}
                    cards={draft.cards}
                    media={media}
                    mediaLoading={mediaLoading}
                    mediaError={mediaError}
                    onRetryMedia={onRetryMedia}
                    onChange={(cards) => patch({ cards })}
                    onBusyChange={(busy) => trackUpload('main', busy)}
                  />
                </div>
              )}
              </div>

              {/* 2단계 본 메시지 뒤에 이어 보낼 추가 메시지(텍스트 · 캐러셀 · 이미지). */}
              {baitOn && (
                <div className="mt-4">
                  <p className="text-xs font-black text-slate-500">2단계 · 이어서 보낼 메시지 <span className="text-slate-300 font-bold">(선택)</span></p>
                  <p className="text-[11px] text-slate-400 font-bold leading-relaxed mt-0.5">
                    본 메시지 다음에 순서대로 발송됩니다. 텍스트 · 캐러셀 · 이미지를 최대 {FOLLOW_UP_MAX}통까지 추가할 수 있어요.
                  </p>
                  <FollowUpsEditor
                    userName={userName}
                    followUps={draft.followUps || []}
                    media={media}
                    mediaLoading={mediaLoading}
                    mediaError={mediaError}
                    onRetryMedia={onRetryMedia}
                    onChange={(followUps) => patch({ followUps })}
                    onBusyChange={(id, busy) => trackUpload(`followup_${id}`, busy)}
                  />
                </div>
              )}
            </div>
          </fieldset>

          {/* 우: 미리보기 (데스크톱 고정) */}
          <div className="hidden lg:block bg-slate-50/60 border-l border-slate-100 p-6">
            <div className="sticky top-0">
              <DmPreview
                igUsername={igUsername}
                messageType={draft.messageType}
                message={draft.message}
                buttons={draft.buttons}
                cards={draft.cards}
                bait={baitOn ? { message: draft.baitMessage || '', buttonLabel: draft.baitButtonLabel || '' } : null}
                intro={baitOn && draft.messageType === 'carousel' ? draft.mainIntro : ''}
                followUps={draft.followUps || []}
              />
            </div>
          </div>

          {/*
            모바일 미리보기. 스크롤 본문 안에 둔다 — 밖에 두면 줄어들지 않는
            형제 항목이 되어 설정 영역을 0 높이까지 밀어낸다.
          */}
          <div className="lg:hidden px-5 pb-5">
            <DmPreview
                igUsername={igUsername}
                messageType={draft.messageType}
                message={draft.message}
                buttons={draft.buttons}
                cards={draft.cards}
                bait={baitOn ? { message: draft.baitMessage || '', buttonLabel: draft.baitButtonLabel || '' } : null}
                intro={baitOn && draft.messageType === 'carousel' ? draft.mainIntro : ''}
                followUps={draft.followUps || []}
              />
          </div>
        </div>

        {/* 푸터 */}
        <div className="px-5 md:px-8 py-4 border-t border-slate-100 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4">
          {saveBlockedReason && (
            <p className="flex items-center gap-1.5 mb-2.5 text-[11px] font-bold text-amber-600">
              <AlertCircle size={12} className="shrink-0" /> {saveBlockedReason}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={requestClose} disabled={saving} className="flex-1 md:flex-none md:px-8 py-3 rounded-xl bg-slate-100 text-slate-600 text-sm font-black hover:bg-slate-200">취소</button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-orange-500 text-white text-sm font-black shadow-lg shadow-pink-500/25 disabled:opacity-40 disabled:shadow-none hover:opacity-95"
            >
              {saving ? '저장 중' : '설정 완료'}
            </button>
          </div>
          {saveError && <p role="alert" className="mt-2 text-xs font-bold text-red-500">{saveError}</p>}
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────── 토글 ────────────────────────── */
/* ────────────────────────── 메인 컴포넌트 ────────────────────────── */
/**
 * 인플루언서 자동 디엠 이용 조건 안내. 잠금 안내와 이용 중 안내가 같은 문장을 쓴다 —
 * 등록 전에 읽은 조건과 등록 후에 보는 조건이 다르면 안 된다.
 *
 * "3개월 동안 협업이 없으면 중단될 수 있다" 는 자동 규칙이 아니라 담당자 판단이다
 * (api-manager-dm-access). 제안을 못 받은 기간은 중단 사유가 아니므로 그것도 함께 적는다.
 */
const DmMatchPolicyNote: React.FC<{ tone?: 'slate' | 'emerald' }> = ({ tone = 'slate' }) => (
  <ul
    className={`mt-2 space-y-1 text-[11px] md:text-xs font-bold leading-relaxed ${
      tone === 'emerald' ? 'text-emerald-700' : 'text-slate-500'
    }`}
  >
    <li>· 등록 후 <strong>3개월 동안 캠페인 협업이 없으면</strong> 자동 디엠 이용이 중단될 수 있어요.</li>
    <li>· 담당자가 제안을 드리지 못해 협업이 없었던 경우에는 계속 이용할 수 있어요.</li>
    <li>· 중단되더라도 만들어 둔 자동화는 그대로 남고, 담당자가 제안한 유가시딩 캠페인을 수락하면 다시 열려요.</li>
  </ul>
);

const DmAutomation: React.FC<DmAutomationProps> = ({ userName, isBusiness = false }) => {
  const { t } = useLanguage();
  const cachedSettings = useMemo(() => readJson<DmAutomationSettings>(dmSettingsCacheKey(userName)), [userName]);
  const cachedMedia = useMemo(() => readJson<InstagramMedia[]>(dmMediaCacheKey(userName)), [userName]);
  const requests = useRef({ settings: 0, media: 0 });
  const saveLock = useRef(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualModalRule, setManualModalRule] = useState<DmAutomationItem | null>(null);

  const [loaded, setLoaded] = useState(() => Boolean(cachedSettings));
  // 설정을 받아오지 못한 상태. 예전에는 이 경우를 구분하지 않아서, 응답이 오지
  // 않으면 스피너가 그대로 남았고(화면이 "계속 로딩 중"), 응답 실패를 자격 없음으로
  // 삼키면 프로 플랜 사용자에게 결제 안내가 떴다. 실패는 실패로 보여 준다.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  // 저장이 진행 중인 동안에는 토글·삭제를 막는다. 두 번의 저장이 겹치면 나중에 끝난
  // 요청이 앞선 변경을 덮어써 자동화가 되살아나거나 사라진 것처럼 보인다.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [enabled, setEnabled] = useState(() => Boolean(cachedSettings?.enabled));
  const [connected, setConnected] = useState(() => Boolean(cachedSettings?.connected));
  const [igUsername, setIgUsername] = useState(() => cachedSettings?.igUsername || '');
  // 인스타그램 장기 토큰은 60일이면 만료된다. 만료되면 "연결됨"으로 보이지만 발송은
  // 전부 실패하므로, 남은 기간을 화면에서 알려 재연동을 유도한다.
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | undefined>(() => cachedSettings?.tokenExpiresAt);
  // 토큰 갱신이 거절돼(비밀번호 변경 · 앱 권한 해제 등) 다시 동의가 필요하다고 표시된 상태.
  // 만료일이 남아 있어도 DM 은 나가지 않으므로 만료와 같이 재연동을 안내한다.
  const [tokenNeedsReauth, setTokenNeedsReauth] = useState<boolean>(() => Boolean((cachedSettings as any)?.needsReauth));
  const [automations, setAutomations] = useState<DmAutomationItem[]>(() =>
    normalizeAutomations(cachedSettings?.automations),
  );

  const [editing, setEditing] = useState<DmAutomationItem | null>(null);
  /**
   * 이 기기에 남아 있는, 저장하지 않은 편집(편집 창이 저장 없이 사라진 경우 — 새로고침 ·
   * 앱 재시작 등). 목록 위에서 이어서 편집하거나 버릴 수 있게 한다.
   */
  const [pendingDraft, setPendingDraft] = useState<EditorDraft | null>(() => readEditorDraft(userName));
  /** 지금 열린 편집 창이 보관해 둔 입력을 이어받았는지. */
  const [restoredInput, setRestoredInput] = useState<{ keywordInput: string } | null>(null);
  /** 같은 자동화를 저장된 내용으로 다시 열 때 편집 창을 새로 그리기 위한 번호. */
  const [editorKey, setEditorKey] = useState(0);
  useEffect(() => {
    setPendingDraft(readEditorDraft(userName));
  }, [userName]);
  /**
   * 다른 곳에서 먼저 저장돼 거절된 자동화의 최신 저장 시각(자동화 ID → updatedAt).
   *
   * 저장 응답을 받지 못한 채(시간 초과 등) 다시 저장하면 서버에는 이미 직전 저장이 들어가
   * 있어 "다른 곳에서 먼저 수정됨"으로 거절된다. 편집 창의 기준 시각은 그대로라 몇 번을
   * 다시 눌러도 같은 이유로 거절됐다. 거절 때 받은 최신 시각을 기억해 두었다가, 사용자가
   * 안내를 보고 한 번 더 저장하면 그 시각을 기준으로 저장한다.
   */
  const staleBase = useRef<Record<string, string>>({});
  const [feedAllOpen, setFeedAllOpen] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const [media, setMedia] = useState<InstagramMedia[]>(() => normalizeMedia(cachedMedia));
  const [mediaLoading, setMediaLoading] = useState(() => Boolean(cachedSettings?.connected && !cachedMedia?.length));
  /**
   * 게시물을 받아오지 못한 이유.
   *
   * 빈 목록만으로는 "게시물이 없는 계정"과 "받아오지 못했다"를 구별할 수 없어서,
   * 화면이 게시물이 있는 사람에게도 "인스타그램에 게시물을 올린 뒤 다시
   * 확인해주세요"라고 말했다. 사유가 있으면 그 사유와 다시 시도할 방법을 준다.
   */
  const [mediaError, setMediaError] = useState('');
  /** 연동이 만료돼 다시 동의가 필요한 상태. 이때는 "다시 시도"가 아니라 재연동이 답이다. */
  const [mediaNeedsReauth, setMediaNeedsReauth] = useState(false);

  // 자동 디엠 이용 자격. 인플루언서는 브랜드 매칭받기 등록, 브랜드는 자동 디엠 플랜
  // 구독으로 열린다. 서버가 자격(entitled)과 이유(dmAccess)를 함께 내려주며, 자격이
  // 없으면 저장·발송이 403 으로 막히므로 화면에서도 무엇을 하면 열리는지 안내한다.
  const [entitled, setEntitled] = useState(() => cachedSettings?.entitled !== false);
  const [dmAccess, setDmAccess] = useState<{ suspended?: boolean; suspendedReason?: string } | null>(
    () => (cachedSettings as any)?.dmAccess || null,
  );

  /**
   * 이 앱이 보내지 않았는데 계정에서 나간 자동 DM.
   *
   * 인스타그램 자체 자동 메시지나 예전에 연결해 둔 다른 자동화 서비스가 보내는
   * 경우다. 여기 설정과 무관하게 나가기 때문에, 문구를 바꿔도 예전 문구가 함께
   * 도착하거나 자동 발송을 꺼도 DM 이 간다. 감지되면 끄는 방법을 안내한다.
   */
  const [externalDm, setExternalDm] = useState<DmAutomationSettings['externalDm']>(() => cachedSettings?.externalDm || null);

  /**
   * 2단계 발송(미끼 → 본 메시지) 상태. 버튼 클릭 뒤 본 메시지가 연달아 거부되면
   * 발송기가 잠시 기존 1통 카드 방식으로 되돌린다. 그 사실을 사용자에게 알린다.
   */
  const [baitHealth, setBaitHealth] = useState<DmAutomationSettings['baitHealth']>(() => cachedSettings?.baitHealth || null);
  const baitSuspendedUntil = Date.parse(baitHealth?.suspendedUntil || '');
  const baitPaused = !Number.isNaN(baitSuspendedUntil) && baitSuspendedUntil > Date.now();

  /**
   * 댓글 자동화와 별도로 저장·발송되는 추가 기능들.
   *
   *  faq     DM 창 첫 화면의 추천 질문 버튼(아이스브레이커).
   *  direct  DM 수신 자체를 트리거로 쓰는 인사말·키워드 답장.
   *
   * 저장 경로(액션)가 각각 다르고 인스타그램 쪽 등록 결과까지 함께 돌아오므로,
   * 서버가 돌려준 값을 그대로 다시 담아 화면과 실제 상태를 일치시킨다.
   */
  const [faq, setFaq] = useState<DmFaqSettings>(() => cachedSettings?.faq || { enabled: false, items: [] });
  const [direct, setDirect] = useState<DmDirectSettings>(() => normalizeDirect(cachedSettings?.direct));
  const [sendSpeed, setSendSpeed] = useState<number>(() => cachedSettings?.sendSpeed || DM_SEND_SPEED_DEFAULT);

  /** 추가 기능 섹션들이 쓰는 알림. 상단 배너를 그대로 재사용한다. */
  const notify = (type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    window.setTimeout(() => setBanner((cur) => (cur && cur.text === text ? null : cur)), 6000);
  };

  const writeSettingsCache = (overrides: Partial<DmAutomationSettings> = {}) => {
    writeJson(dmSettingsCacheKey(userName), {
      ...(cachedSettings || {}),
      enabled,
      connected,
      igUsername,
      tokenExpiresAt,
      automations,
      entitled,
      externalDm,
      baitHealth,
      faq,
      direct,
      sendSpeed,
      ...overrides,
    } as DmAutomationSettings);
  };

  /**
   * 피드 게시물을 불러온다.
   *
   * 서버는 첫 응답을 시간 예산 안에서 끝내고, 남은 게시물이 있으면 이어보기 커서를
   * 함께 준다. 여기서는 먼저 도착한 만큼을 곧바로 그려 놓고 나머지를 배경에서
   * 이어 받는다 — 게시물이 많은 계정 때문에 모두가 첫 화면을 몇 초씩 기다릴
   * 이유는 없다.
   *
   * 실패는 지우지 않는다. 예전에는 실패할 때 목록을 빈 배열로 덮어써서, 잠깐의
   * 오류 한 번에 방금까지 보이던 게시물이 사라지고 "게시물이 없어요"가 남았다.
   * 지금은 갖고 있던 목록을 그대로 두고 사유만 덧붙인다.
   */
  const loadMedia = async (opts: { refresh?: boolean } = {}) => {
    const request = ++requests.current.media;
    setMediaLoading(true);
    setMediaError('');
    try {
      const first = await apiService.getInstagramMedia(userName, { refresh: opts.refresh });
      if (request !== requests.current.media) return;

      let all = normalizeMedia(first.media);
      if (all.length > 0 || !first.error) setMedia(all);
      setMediaNeedsReauth(first.needsReauth);
      setMediaError(first.error);
      if (all.length > 0) writeJson(dmMediaCacheKey(userName), all);
      setMediaLoading(false);

      // 남은 페이지는 화면을 막지 않고 이어 받는다.
      let cursor = first.nextCursor;
      for (let page = 0; page < MAX_FEED_PAGES && cursor; page += 1) {
        const more = await apiService.getInstagramMedia(userName, { after: cursor });
        if (request !== requests.current.media) return;
        if (more.error) setMediaError(more.error);
        if (more.needsReauth) setMediaNeedsReauth(true);
        const pageMedia = normalizeMedia(more.media);
        if (pageMedia.length === 0) break;
        const seen = new Set(all.map((m) => m.id));
        all = [...all, ...pageMedia.filter((m) => !seen.has(m.id))];
        setMedia(all);
        writeJson(dmMediaCacheKey(userName), all);
        cursor = more.nextCursor;
      }
    } catch (e) {
      if (request !== requests.current.media) return;
      console.error('[DmAutomation] 게시물을 불러오지 못했습니다:', e);
      setMediaError('게시물을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setMediaLoading(false);
    }
  };

  const load = () => {
    if (saveLock.current) return;
    const request = ++requests.current.settings;
    setReloading(true);
    apiService.getDmAutomation(userName)
      .then((s) => {
        if (request !== requests.current.settings) return;
        if (s.loadError) {
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        setEnabled(s.enabled);
        setConnected(Boolean(s.connected));
        setIgUsername(s.igUsername || '');
        setTokenExpiresAt(s.tokenExpiresAt);
        setTokenNeedsReauth(Boolean((s as any).needsReauth));
        const nextAutomations = normalizeAutomations(s.automations);
        setAutomations(nextAutomations);
        setEntitled(s.entitled !== false);
        setDmAccess((s as any).dmAccess || null);
        setExternalDm(s.externalDm || null);
        setBaitHealth(s.baitHealth || null);
        if (s.faq) setFaq(s.faq);
        if (s.direct) setDirect(normalizeDirect(s.direct));
        if (s.sendSpeed) setSendSpeed(s.sendSpeed);
        writeJson(dmSettingsCacheKey(userName), { ...s, automations: nextAutomations });
        setLoaded(true);
        if (s.connected) void loadMedia({ refresh: true });
      })
      // getDmAutomation 은 스스로 오류를 삼키지만, 앞으로 구현이 바뀌어도 스피너가
      // 남지 않도록 여기서도 반드시 끝을 만든다.
      .catch((e) => {
        if (request !== requests.current.settings) return;
        console.error('[DmAutomation] 설정을 불러오지 못했습니다:', e);
        setLoadFailed(true);
      })
      .finally(() => { if (request === requests.current.settings) setReloading(false); });
  };

  useEffect(() => {
    load();
    return () => { requests.current.settings++; requests.current.media++; };
    /* eslint-disable-next-line */
  }, [userName]);

  // OAuth 연동 콜백 결과 처리 (?ig_connected / ?ig_error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // 이 화면 안의 브랜드 매칭받기 등록에서 시작한 연동이면 등록 카드가 결과를 읽고
    // 등록서를 되살린다(CollabMatchRegister). 여기서 주소를 먼저 지우면 그 복원이 끊긴다.
    if (params.get('collab_match')) {
      load();
      return;
    }
    if (params.get('ig_connected')) {
      setBanner({ type: 'ok', text: '인스타그램 계정이 연동되었습니다! 🎉' });
      // 연동 직후 바로 연동된 화면을 보여주고, 최신 정보를 다시 불러온다.
      setConnected(true);
      load();
      params.delete('ig_connected');
    } else if (params.get('ig_error')) {
      setBanner({
        type: 'err',
        text: params.get('ig_error') === 'state_browser_mismatch'
          ? '연동하기를 누른 브라우저(또는 앱)와 다른 곳에서 동의가 끝나 연동하지 않았어요. 연동하기를 누른 곳에서 다시 시도해 주세요.'
          : '연동에 실패했어요. 잠시 후 다시 시도해주세요.',
      });
      params.delete('ig_error');
    } else return;
    // 콜백이 함께 실어 보내는 지표 — 브랜드 매칭 화면이 카드를 바로 그리는 데
    // 쓰는 값이라 이 화면에서는 쓸 일이 없다. 남기면 주소창에 팔로워 수가 붙어
    // 다니므로 함께 지운다.
    ['ig_metrics', 'ig_handle', 'ig_followers', 'ig_following', 'ig_views'].forEach(k =>
      params.delete(k),
    );
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
    if (saveLock.current) return { ok: false as const, error: '저장 중입니다. 잠시 기다려 주세요.' };
    if (!entitled) {
      const text = isBusiness
        ? '브랜드 계정의 자동 디엠은 자동 디엠 플랜(월 5,900원)을 구독하면 바로 사용할 수 있어요.'
        : dmAccess?.suspended
          ? '담당자 판단으로 자동 디엠 이용이 중단되었어요. 유가시딩 캠페인 제안을 수락하면 다시 열립니다.'
          : '자동 디엠은 브랜드 매칭받기를 등록하면 무료로 사용할 수 있어요.';
      setBanner({ type: 'err', text });
      // 편집 창이 열려 있으면 위 배너는 창에 가려진다. 창 안에도 같은 이유를 띄워야
      // '설정 완료'를 눌렀는데 아무 일도 없는 것처럼 보이지 않는다.
      setSaveError(text);
      return { ok: false as const };
    }
    saveLock.current = true;
    setSaving(true);
    setSaveError('');
    requests.current.settings++;
    setReloading(false);
    try {
      const result = await apiService.saveDmAutomation(userName, next);
      if (result.ok) {
        setSavedAt(Date.now());
        setTimeout(() => setSavedAt(null), 2200);
        setBanner(result.backfillWarning ? { type: 'err', text: result.backfillWarning } : null);
      } else {
        const error = result.error || '저장에 실패했습니다. 다시 시도해주세요.';
        setSaveError(error);
        setBanner({ type: 'err', text: error });
      }
      return result;
    } catch {
      const error = '저장에 실패했습니다. 다시 시도해주세요.';
      setSaveError(error);
      setBanner({ type: 'err', text: error });
      return { ok: false as const, error };
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const connect = async () => {
    // 연동은 기능을 가리지 않는다. 여기서 계정을 붙이면 자동 디엠 · 인사이트 ·
    // 브랜드 매칭받기가 함께 살아난다(서버가 꺼 둔 기능 표시를 지운다).
    const result = await apiService.instagramConnectUrl(userName);
    if (!result.url) {
      setBanner({ type: 'err', text: result.error || '연동을 시작하지 못했습니다.' });
      return;
    }
    window.location.href = result.url;
  };

  const disconnect = async () => {
    // 해제는 토큰을 지우지 않고 기능 표시만 끈다. 그래서 무엇이 멈추고 무엇이
    // 남는지가 화면마다 다르다 — 브랜드의 콘텐츠 성과는 해제 뒤에도 같은 연동으로
    // 계속 조회된다(서버 _shared/tagged-media 의 loadBrandLink).
    const notice = isBusiness
      ? '인스타그램 계정 연동을 해제할까요?\n\n' +
        '자동화는 보관되지만 자동 DM 발송이 중단됩니다.\n' +
        '콘텐츠 성과(태그된 콘텐츠)는 그대로 볼 수 있습니다.'
      : '인스타그램 계정 연동을 해제할까요?\n\n' +
        '자동화는 보관되지만 DM 발송이 중단되고, 인사이트도 함께 해제됩니다.\n' +
        '브랜드 매칭받기는 그대로 유지됩니다.';
    if (!window.confirm(notice)) return;
    setDisconnecting(true);
    const ok = await apiService.disconnectInstagram(userName);
    setDisconnecting(false);
    if (ok) {
      requests.current.settings++;
      requests.current.media++;
      setReloading(false);
      setMediaLoading(false);
      setMediaError('');
      setMediaNeedsReauth(false);
      setConnected(false);
      setEnabled(false);
      setIgUsername('');
      setTokenExpiresAt(undefined);
      setMedia([]);
      try {
        localStorage.removeItem(dmSettingsCacheKey(userName));
        localStorage.removeItem(dmMediaCacheKey(userName));
      } catch {}
      setBanner({ type: 'ok', text: '연동이 해제되었습니다.' });
    }
  };

  // 저장이 실패하면(플랜 없음 · 네트워크 오류) 화면만 바뀌고 서버는 그대로여서, 새로고침
  // 하면 변경이 사라진 것처럼 보인다. 낙관적으로 먼저 반영하되 실패하면 직전 값으로
  // 되돌려 화면과 서버 상태가 어긋나지 않게 한다.
  const toggleMaster = async () => {
    if (saveLock.current) return;
    const prev = enabled;
    const v = !enabled;
    setEnabled(v);
    const { ok, faq: nextFaq } = await persist({ enabled: v });
    if (!ok) setEnabled(prev);
    // 스위치를 끄면 인스타그램에 올려둔 질문 버튼도 함께 내려간다. 서버가 그 결과를
    // 돌려주므로 등록 상태 표시가 실제와 어긋나지 않게 반영한다.
    else {
      if (nextFaq) setFaq(nextFaq);
      writeSettingsCache({ enabled: v, faq: nextFaq || faq });
    }
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
    if (saveLock.current) return { ok: false as const };
    const prev = automations;
    const exists = prev.some((x) => x.id === automation.id);
    const optimistic = exists ? prev.map((x) => (x.id === automation.id ? automation : x)) : [...prev, automation];
    setAutomations(optimistic);
    const result = await persist({ action: 'upsertAutomation', automation });
    // 저장에 실패하면 서버가 최신 목록을 함께 준 경우(다른 곳에서 먼저 수정) 그 값을,
    // 아니면 직전 화면 값을 쓴다. 어느 쪽이든 화면은 실제 저장 상태를 따라간다.
    if (!result.ok) {
      setAutomations(result.automations ? normalizeAutomations(result.automations) : prev);
      return result;
    }
    const savedAutomations = result.automations ? normalizeAutomations(result.automations) : optimistic;
    if (result.automations) setAutomations(savedAutomations);
    // 서버가 확정한 전체 스위치 상태를 그대로 따른다(저장 요청은 이 값을 바꾸지 않는다).
    const masterOn = typeof result.enabled === 'boolean' ? result.enabled : enabled;
    if (typeof result.enabled === 'boolean') setEnabled(result.enabled);
    writeSettingsCache({ automations: savedAutomations, enabled: masterOn });
    if (automation.enabled && !masterOn) {
      setBanner({
        type: 'ok',
        text: '저장했어요. 다만 자동 발송 스위치가 꺼져 있어 새 댓글에는 아직 DM이 나가지 않습니다. 발송하려면 위의 자동 발송을 켜주세요.',
      });
    }
    return result;
  };

  const saveAutomation = async (a: DmAutomationItem) => {
    const base = staleBase.current[a.id];
    const result = await commitAutomation(base ? { ...a, updatedAt: base } : a);
    if (result.ok) {
      delete staleBase.current[a.id];
      if (readEditorDraft(userName)?.draft.id === a.id) clearEditorDraft(userName);
      setPendingDraft(null);
      setRestoredInput(null);
      setEditing((current) => current?.id === a.id ? null : current);
      return;
    }
    if ('code' in result && result.code === 'STALE_AUTOMATION') {
      const latest = result.automations?.find((x) => x.id === a.id);
      if (latest?.updatedAt) {
        staleBase.current[a.id] = latest.updatedAt;
        setSaveError('이 자동화가 다른 곳(다른 기기·탭, 또는 응답을 받지 못한 직전 저장)에서 먼저 저장됐어요. 지금 화면의 내용으로 저장하려면 \'설정 완료\'를 한 번 더 눌러 주세요.');
      }
    }
  };

  /**
   * 편집 창을 연다. 이 기기에 저장하지 않은 편집이 남아 있으면 — 같은 자동화면 그 입력을
   * 이어서 열고, 다른 자동화면 그 입력이 사라진다는 것을 먼저 확인한다(보관 자리는 하나다).
   */
  const openEditor = (item: DmAutomationItem) => {
    const stored = readEditorDraft(userName);
    // 목록에서 난 저장 실패(스위치 · 삭제)의 문구가 새로 연 창에 남아 있지 않게 한다.
    setSaveError('');
    if (stored && stored.draft.id === item.id) {
      setRestoredInput({ keywordInput: stored.keywordInput });
      setEditing(stored.draft);
      return;
    }
    if (stored && !window.confirm('저장하지 않은 다른 자동 DM 설정이 있어요. 새로 편집하면 그 내용은 사라집니다. 계속할까요?')) return;
    if (stored) clearEditorDraft(userName);
    setPendingDraft(null);
    setRestoredInput(null);
    setEditing(item);
  };
  /**
   * 이어서 연 편집을 버리고 저장된 내용으로 다시 연다.
   *
   * 목록의 '편집'을 눌러도 이 기기에 남은 편집이 있으면 그 내용이 열린다. 저장된 문구를
   * 확인하려던 사람에게는 화면의 내용이 실제로 발송되는 내용과 다르다는 것을 알 길이
   * 없어서, 편집 창이 그 사실을 알리고 여기로 돌아올 길을 준다.
   */
  const reopenSaved = () => {
    const saved = editing ? automations.find((x) => x.id === editing.id) : undefined;
    if (!saved) return;
    if (!window.confirm('이어서 연 편집 내용을 버리고 저장된 내용으로 열까요?')) return;
    clearEditorDraft(userName);
    setPendingDraft(null);
    setRestoredInput(null);
    setSaveError('');
    setEditorKey((k) => k + 1);
    setEditing(saved);
  };
  const closeEditor = () => {
    setEditing(null);
    setSaveError('');
    setRestoredInput(null);
    setPendingDraft(readEditorDraft(userName));
    // '한 번 더 누르면 덮어쓴다'는 그 안내를 본 편집 창 안에서만 유효하다. 창을 닫은
    // 뒤까지 남기면, 나중에 이어서 연 편집이 그사이 다른 곳에서 저장된 내용을 묻지도
    // 않고 덮어쓴다.
    staleBase.current = {};
  };
  const discardPendingDraft = () => {
    clearEditorDraft(userName);
    setPendingDraft(null);
  };
  const backfillPastComments = async (a: DmAutomationItem) => {
    const result = await apiService.backfillDmComments(userName, a.id);
    setBanner(result.ok
      ? { type: 'ok', text: '예약 전 댓글 확인을 시작했습니다. 대상 댓글은 순차적으로 처리됩니다.' }
      : { type: 'err', text: result.error || '이전 댓글 확인을 시작하지 못했습니다.' });
  };
  const toggleAutomation = (id: string) => {
    const target = automations.find((x) => x.id === id);
    if (!target) return;
    void commitAutomation({ ...target, enabled: !target.enabled });
  };
  const deleteAutomation = async (id: string) => {
    if (saveLock.current) return;
    if (!window.confirm('이 자동화를 삭제할까요?')) return;
    const prev = automations;
    setAutomations(prev.filter((x) => x.id !== id));
    const result = await persist({ action: 'deleteAutomation', id });
    if (!result.ok) {
      setAutomations(result.automations ? normalizeAutomations(result.automations) : prev);
      return;
    }
    const savedAutomations = result.automations ? normalizeAutomations(result.automations) : automations.filter((x) => x.id !== id);
    if (result.automations) setAutomations(savedAutomations);
    writeSettingsCache({ automations: savedAutomations });
  };

  const activeCount = useMemo(() => automations.filter((a) => a.enabled).length, [automations]);

  // 만료됐거나 임박한 토큰만 알린다. 평소에는 배지를 띄우지 않는다(하루 한 번 도는
  // scheduled-instagram-token-refresh 가 미리 갱신한다).
  const tokenStatus = useMemo(() => {
    if (!connected) return null;
    if (tokenNeedsReauth) return { expired: true, days: 0 };
    if (!tokenExpiresAt) return null;
    const ms = new Date(tokenExpiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return { expired: true, days: 0 };
    const days = Math.ceil(ms / 86_400_000);
    return days <= 7 ? { expired: false, days } : null;
  }, [connected, tokenExpiresAt, tokenNeedsReauth]);

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

      {/* 자동 디엠 이용 안내 — 자격이 없으면 저장·발송이 막히므로 먼저 알려준다.
          인플루언서는 브랜드 매칭받기 등록(결제 없음), 브랜드는 자동 디엠 플랜 구독으로 열린다.
          담당자가 중단한 경우에는 사유와 다시 여는 방법을 함께 보여 준다. */}
      {!entitled && (
        <section className="mb-6 rounded-2xl border-2 border-indigo-200 bg-white p-6 md:p-8 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-xl shrink-0 shadow-md">
              {isBusiness ? '💬' : dmAccess?.suspended ? '⏸️' : '🤝'}
            </div>
            <div className="min-w-0">
              {isBusiness ? (
                <>
                  <h3 className="text-base md:text-lg font-black text-slate-900">브랜드 자동 디엠은 자동 디엠 플랜으로 이용할 수 있어요</h3>
                  {isNativeApp() ? (
                    <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 leading-relaxed">
                      자동 디엠 플랜(월 5,900원)은 PICKS Folio 웹사이트에서 구독할 수 있으며, 웹에서 구독하면 앱에서도 그대로 이용됩니다.
                    </p>
                  ) : (
                    <>
                      <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 leading-relaxed">
                        자동 디엠 플랜(월 5,900원 · 부가세 포함)을 구독하면 인스타그램 댓글 자동 DM 을 바로 사용할 수 있어요.
                        구독 전에는 자동화를 저장하거나 자동 DM 을 발송할 수 없습니다.
                      </p>
                      {/* 구독 전에도 막히지 않는 것을 함께 적는다. 실제로 잠기는 것은 저장과 발송뿐이다. */}
                      <p className="text-slate-500 text-xs md:text-sm font-medium mt-2 leading-relaxed">
                        인스타그램 계정 연동과 콘텐츠 성과(태그된 콘텐츠) 조회는 구독 없이도 그대로 사용할 수 있어요.
                      </p>
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent('navigate-membership'))}
                        className="mt-4 px-5 py-2.5 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 transition-all shadow-md hover:shadow-lg"
                      >
                        자동 디엠 플랜 보기
                      </button>
                    </>
                  )}
                </>
              ) : dmAccess?.suspended ? (
                <>
                  <h3 className="text-base md:text-lg font-black text-slate-900">자동 디엠 이용이 중단되었어요</h3>
                  {dmAccess.suspendedReason && (
                    <p className="text-rose-600 text-xs md:text-sm font-bold mt-1 leading-relaxed">사유: {dmAccess.suspendedReason}</p>
                  )}
                  <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 leading-relaxed">
                    담당자가 보내는 유가시딩 캠페인 제안을 수락하면 자동 디엠이 바로 다시 열려요. 만들어 둔 자동화는 지워지지 않고 그대로 남아 있습니다.
                  </p>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('navigate-campaign-collab'))}
                    className="mt-4 px-5 py-2.5 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 transition-all shadow-md hover:shadow-lg"
                  >
                    받은 제안 보기
                  </button>
                </>
              ) : (
                <>
                  <h3 className="text-base md:text-lg font-black text-slate-900">자동 디엠은 브랜드 매칭받기를 등록해야 사용할 수 있어요</h3>
                  <p className="text-slate-500 text-xs md:text-sm font-medium mt-1 leading-relaxed">
                    내 채널 정보를 브랜드 매칭받기에 등록하면 결제 없이 인스타그램 자동 디엠을 바로 사용할 수 있어요.
                    등록하면 담당자가 조건에 맞는 브랜드 캠페인을 제안해 드립니다.
                  </p>
                  <DmMatchPolicyNote />
                  {/* 다른 화면으로 보내지 않고 이 자리에서 바로 등록한다. 접수가 끝나면
                      자격을 다시 받아 와 잠금 안내를 걷어 낸다. */}
                  <div className="mt-4 max-w-sm">
                    <CollabMatchRegister
                      variant="influencer"
                      applicantUsername={userName}
                      returnView="dm-automation"
                      onRegisteredChange={() => load()}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 매칭 등록으로 자동 디엠을 쓰는 인플루언서에게, 이용이 무엇에 걸려 있는지 늘 보이게 둔다.
          모르고 지내다 중단 안내를 처음 받으면 "갑자기 막혔다" 로 읽힌다. */}
      {entitled && !isBusiness && loaded && (
        <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-5 py-4">
          <p className="text-sm font-black text-emerald-800">브랜드 매칭받기 등록으로 자동 디엠을 무료로 이용 중이에요</p>
          <DmMatchPolicyNote tone="emerald" />
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

      {/* 2단계 발송이 막혀 1통 카드 방식으로 자동 전환된 상태 */}
      {connected && baitPaused && automations.some((a) => a.baitEnabled || a.followFilter !== 'all') && (
        <section className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 md:p-6">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm md:text-base font-black text-amber-800">
                2단계 발송을 잠시 멈추고 1통 카드로 보내고 있어요
              </h3>
              <p className="text-[12px] md:text-sm text-amber-700 font-medium mt-1">
                버튼을 누른 뒤 보내는 본 메시지가 인스타그램에서 연달아 거부됐어요. 그동안 새 댓글에는
                기존처럼 본 메시지를 카드 한 통으로 압축해 보냅니다(팔로우 조건 확인은 댓글 시점에 합니다).
                {' '}{new Date(baitSuspendedUntil).toLocaleString('ko-KR')} 이후 자동으로 다시 시도합니다.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 연동 계정 피드 게시물 */}
      {connected && (
        <section className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base md:text-lg font-black text-slate-900 flex items-center gap-2">
              <LayoutGrid size={17} className="text-slate-400" /> 내 피드 게시물
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-400">{media.length}개</span>
              <button
                type="button"
                onClick={() => void loadMedia({ refresh: true })}
                disabled={mediaLoading}
                aria-label="피드 새로고침"
                title="피드 새로고침"
                className="w-8 h-8 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={mediaLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          {mediaLoading && media.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400">
              <Loader2 size={18} className="animate-spin" /> <span className="text-sm font-bold">게시물을 불러오는 중…</span>
            </div>
          ) : media.length === 0 && mediaError ? (
            /* 받아오지 못한 경우. 게시물이 없는 계정과 같은 말을 하면 안 된다 —
               할 일이 "게시물 올리기"가 아니라 "다시 시도"(또는 재연동)이다. */
            <div className="text-center py-10 border border-dashed border-amber-200 rounded-2xl bg-amber-50/60">
              <AlertCircle size={28} className="text-amber-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">게시물을 불러오지 못했어요</p>
              <p className="text-xs text-slate-500 mt-1 px-4 leading-relaxed">{mediaError}</p>
              <button
                type="button"
                onClick={() => (mediaNeedsReauth ? connect() : void loadMedia({ refresh: true }))}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-3.5 py-2 text-[11px] font-black hover:bg-slate-800"
              >
                <RefreshCw size={12} /> {mediaNeedsReauth ? '인스타그램 다시 연동하기' : '다시 시도'}
              </button>
            </div>
          ) : media.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
              <ImageIcon size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-500">불러올 게시물이 없어요</p>
              <p className="text-xs text-slate-400 mt-1">인스타그램에 게시물을 올린 뒤 다시 확인해주세요.</p>
              <button
                type="button"
                onClick={() => void loadMedia({ refresh: true })}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 text-slate-600 px-3.5 py-2 text-[11px] font-black hover:bg-slate-50"
              >
                <RefreshCw size={12} /> 새로고침
              </button>
            </div>
          ) : (
            <>
              <p className="text-[12px] text-slate-500 font-medium mb-3">
                게시물을 눌러 해당 게시물에 자동 DM을 설정하세요. 선택한 게시물의 댓글에만 자동으로 반응해요.
              </p>
              {mediaError && (
                /* 일부만 받아왔거나 보관해 둔 목록을 보여주는 중. 목록은 그대로 쓰되
                   "이게 전부가 아닐 수 있다"는 것을 숨기지 않는다. */
                <p className="flex items-start gap-1.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-3">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  <span className="leading-relaxed">
                    {mediaError}{' '}
                    <button type="button" onClick={() => void loadMedia({ refresh: true })} className="underline">
                      다시 시도
                    </button>
                  </span>
                </p>
              )}
              {/* 편집 창이 열린 동안에는 뒤에 가려진 이 목록의 이미지를 내려 둔다. 편집 창도 같은
                  게시물 이미지를 그리므로, 두 벌을 함께 들고 있으면 메모리가 두 배로 든다. */}
              {!editing && (
              <div className="grid grid-cols-4 gap-2">
                {media.slice(0, FEED_PREVIEW_COUNT).map((m) => (
                  /* 누르면 이 게시물에만 걸리는 새 자동화를 연다. */
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => openEditor({ ...blankAutomation(t), mediaScope: 'selected', mediaIds: [m.id] })}
                    disabled={!entitled}
                    title={entitled ? '이 게시물에 자동 DM 설정' : t('common.dmAccessNotice', '자동 디엠 이용 조건을 먼저 확인해 주세요.', 'Check the DM automation requirements first.')}
                    aria-label="이 게시물에 자동 DM 설정"
                    className="relative block w-full aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-100 hover:border-pink-400 hover:ring-2 hover:ring-pink-200 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {feedImageOf(m)
                      ? <img src={feedImageOf(m)} alt={m.caption.slice(0, 40)} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={20} className="text-slate-300" /></div>}
                  </button>
                ))}
                {/* 마지막 칸 — 나머지 게시물은 전체 게시물 창에서 본다. */}
                {media.length > FEED_PREVIEW_COUNT && (
                  <button
                    type="button"
                    onClick={() => setFeedAllOpen(true)}
                    title="전체 게시물 보기"
                    aria-label="전체 게시물 보기"
                    className="relative w-full aspect-square rounded-xl bg-white border-2 border-cyan-300 hover:border-cyan-400 hover:bg-cyan-50/40 active:scale-[0.98] transition-all flex items-center justify-center text-slate-900"
                  >
                    <Plus size={28} strokeWidth={3} />
                  </button>
                )}
              </div>
              )}
              {feedAllOpen && !editing && (
                <FeedAllMediaModal
                  media={media}
                  entitled={entitled}
                  disabledTitle={t('common.dmAccessNotice', '자동 디엠 이용 조건을 먼저 확인해 주세요.', 'Check the DM automation requirements first.')}
                  onPick={(m) => {
                    setFeedAllOpen(false);
                    openEditor({ ...blankAutomation(t), mediaScope: 'selected', mediaIds: [m.id] });
                  }}
                  onClose={() => setFeedAllOpen(false)}
                />
              )}
            </>
          )}
        </section>
      )}

      {/* 스팸 방지 — 답글/DM 발송 속도(시간당 발송량, 계정 전체). 피드 바로 아래에 얇게 둔다. */}
      {/* 발송 현황 — 오늘 나간 수와 앞으로 나갈 수. 발송 속도 바로 위에 둔다. */}
      {connected && <DmSendStatusSection userName={userName} sendSpeed={sendSpeed} />}

      {connected && (
        <DmSendSpeedSection
          userName={userName}
          value={sendSpeed}
          onChange={(v) => {
            setSendSpeed(v);
            writeSettingsCache({ sendSpeed: v });
          }}
          onNotice={notify}
        />
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
                onClick={() => openEditor(blankAutomation(t))}
                disabled={!entitled}
                title={entitled ? undefined : t('common.dmAccessNotice', '자동 디엠 이용 조건을 먼저 확인해 주세요.', 'Check the DM automation requirements first.')}
                className="flex items-center gap-1.5 bg-gradient-to-r from-pink-600 to-orange-500 text-white rounded-xl py-2.5 px-4 text-xs md:text-sm font-black shadow-lg shadow-pink-500/25 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Plus size={16} /> {t('dm.addAutomation', '자동화 추가하기', 'Add Automation')}
              </button>
            </div>
          )}
        </div>

        {/* 저장하지 않고 사라진 편집(새로고침 · 앱 재시작 등)이 이 기기에 남아 있으면 이어서 편집하게 한다. */}
        {connected && pendingDraft && !editing && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="min-w-0 text-xs md:text-sm font-bold text-amber-800 break-words">
              저장하지 않은 자동 DM 설정이 있어요
              {pendingDraft.draft.name.trim() ? ` · ${pendingDraft.draft.name.trim()}` : ''}
              <span className="ml-1 font-medium text-amber-700">({fmtDateTime(new Date(pendingDraft.savedAt).toISOString())})</span>
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openEditor(pendingDraft.draft)}
                disabled={!entitled}
                className="rounded-xl bg-slate-900 text-white px-3 py-1.5 text-xs font-black hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                이어서 편집
              </button>
              <button
                type="button"
                onClick={discardPendingDraft}
                className="rounded-xl border border-amber-200 bg-white text-amber-800 px-3 py-1.5 text-xs font-black hover:bg-amber-100"
              >
                버리기
              </button>
            </div>
          </div>
        )}

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
              onClick={() => openEditor(blankAutomation(t))}
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
                  {/* 즉시 발송은 기본값이라 굳이 표시하지 않고, 예약만 눈에 띄게 알린다. */}
                  {a.sendMode === 'scheduled' && (Date.parse(a.scheduledAt || '') <= Date.now() ? (
                    <span
                      className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 rounded-lg px-2 py-1 text-[11px] font-bold"
                      title="예약 시각이 지나 댓글이 달리면 즉시 DM이 나가요."
                    >
                      <AlertCircle size={11} />
                      {fmtDateTime(a.scheduledAt)} 지남 · 즉시 발송 중
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                      <CalendarClock size={11} />
                      {fmtDateTime(a.scheduledAt) || '예약'} 예약
                    </span>
                  ))}
                  {(a.baitEnabled || a.followFilter !== 'all') && (
                    <span
                      className="inline-flex items-center gap-1 bg-violet-100 text-violet-600 rounded-lg px-2 py-1 text-[11px] font-bold"
                      title="댓글 직후 버튼 메시지를 먼저 보내고, 버튼을 누르면 본 메시지를 보내요."
                    >
                      <Zap size={11} /> 예고 메시지
                    </span>
                  )}
                  {a.messageType === 'carousel' && (
                    <span className="inline-flex items-center gap-1 bg-pink-100 text-pink-600 rounded-lg px-2 py-1 text-[11px] font-bold">
                      <GalleryHorizontalEnd size={11} /> 캐러셀 {(a.cards || []).filter(cardSendable).length}장
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

                {/* 캐러셀 카드 이미지 — 목록에서 어떤 카드가 나가는지 바로 보인다. */}
                {a.messageType === 'carousel' && (a.cards || []).some((c) => c.imageUrl) && (
                  <div className="flex gap-1.5 mb-3 overflow-hidden">
                    {(a.cards || []).filter(cardSendable).slice(0, 5).map((c) => (
                      <div key={c.id} className="w-11 h-11 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
                        {c.imageUrl
                          ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                          : <ImageIcon size={14} className="text-slate-300" />}
                      </div>
                    ))}
                    {(a.cards || []).filter(cardSendable).length > 5 && (
                      <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center text-[11px] font-black text-slate-500">
                        +{(a.cards || []).filter(cardSendable).length - 5}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-start gap-1.5 text-[12px] text-slate-500 font-medium bg-slate-50 rounded-xl px-3 py-2.5 mb-3">
                  <CornerDownRight size={13} className="mt-0.5 shrink-0 text-slate-400" />
                  {(() => {
                    // 목록에는 실제로 도착하는 문구를 보여준다 — 캐러셀은 카드 한 통이
                    // 전부이므로 첫 카드의 제목이 상대가 보는 첫 문구다.
                    const line = a.messageType === 'carousel'
                      ? (a.cards || []).find((c) => c.title.trim())?.title || ''
                      : a.message;
                    if (!line) return <span className="line-clamp-2">이미지 카드 캐러셀 메시지</span>;
                    // 저장된 발송 문구는 사용자가 쓴 내용이다. 화면 번역이 손대면 목록에
                    // 보이는 문구와 실제로 나가는 문구가 갈라진다.
                    return <span data-user-content className="line-clamp-2">{line}</span>;
                  })()}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => openEditor(a)} className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl py-2 text-xs font-black hover:bg-slate-200 transition-colors">
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
                    <Send size={13} /> {t('dm.manualSend', '보내기', 'Send')}
                  </button>
                  {a.sendMode === 'scheduled' && (
                    <button
                      onClick={() => void backfillPastComments(a)}
                      disabled={!entitled || !enabled || !a.enabled}
                      title="예약 전 댓글 다시 확인"
                      aria-label="예약 전 댓글 다시 확인"
                      className="w-10 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <RefreshCw size={15} />
                    </button>
                  )}
                  <button onClick={() => deleteAutomation(a.id)} disabled={saving} className="w-10 rounded-xl text-red-400 hover:bg-red-50 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 추가 기능 — 저장 경로가 달라 별도 컴포넌트로 뺐다. */}
      <div className="mt-6">
        <DmTriggerSection
          userName={userName}
          connected={connected}
          entitled={entitled}
          masterEnabled={enabled}
          value={direct}
          onChange={setDirect}
          onNotice={notify}
        />
        {/* 자주 묻는 질문(DM 창 추천 질문 버튼)은 "디엠 자동응답" 아래에 둔다. */}
        <DmFaqSection
          userName={userName}
          connected={connected}
          entitled={entitled}
          masterEnabled={enabled}
          value={faq}
          onChange={setFaq}
          onNotice={notify}
        />
      </div>

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
          key={editorKey}
          initial={editing}
          restored={restoredInput}
          onReopenSaved={restoredInput && automations.some((x) => x.id === editing.id) ? reopenSaved : undefined}
          userName={userName}
          igUsername={igUsername}
          media={media}
          mediaLoading={mediaLoading}
          mediaError={mediaError}
          onRetryMedia={() => void loadMedia({ refresh: true })}
          onClose={closeEditor}
          onSave={saveAutomation}
          saving={saving}
          saveError={saveError}
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
