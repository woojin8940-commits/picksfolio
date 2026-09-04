import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CalendarClock, Check, Clock, HelpCircle, Loader2, MessageCircle,
  MessageSquareReply, Plus, Send, Trash2, Users, X,
} from 'lucide-react';
import {
  apiService, DmContact, DmDirectSettings, DmFaqItem, DmFaqSettings, DmKeywordReply,
  DmScheduledJob, DM_FAQ_MAX, DM_FAQ_QUESTION_MAX,
} from '../services/apiService';
import Toggle from './DmToggle';

/**
 * 디엠 자동화의 추가 기능 세 가지.
 *
 *  1. 자주 묻는 질문   — DM 창 첫 화면의 추천 버튼(인스타그램 아이스브레이커).
 *  2. DM 자동 응답     — DM 을 받은 것 자체를 트리거로 쓰는 인사말 · 키워드 답장.
 *  3. 예약 발송        — 특정 날짜·시간에 미리 정해 둔 DM 보내기.
 *
 * 세 기능 모두 이미 승인받은 권한(`instagram_business_manage_messages`)만으로
 * 동작한다. 다만 인스타그램 쪽 제약이 각각 달라서, 화면에서 그 제약을 반드시
 * 같이 보여준다 — 사용자가 "설정했는데 왜 안 되지"를 겪지 않는 유일한 방법이다.
 *
 *  · 질문 버튼은 **인스타그램 앱**의 DM 화면에서만 보인다(웹은 지원하지 않는다).
 *  · 예약 발송은 상대가 마지막으로 메시지를 보낸 뒤 **24시간 안에만** 가능하다.
 *    먼저 말을 거는 발송은 정책 위반이라 대상은 "DM 을 보내온 사람" 명단에서만 고른다.
 *  · 게시물 자동화를 "예약 발송"으로 설정해 두면 댓글이 달린 순간 이 대기열에
 *    예약이 들어온다. 그 예약은 댓글 비공개 답장이라 24시간이 아니라 **댓글 작성 후
 *    7일** 창을 쓴다(목록에서 "댓글 자동화"로 표시된다).
 *
 * 파일을 나눠 둔 이유: DmAutomation.tsx 는 이미 2천 줄이 넘고, 이 세 기능은 저장
 * 경로(액션)도 서로 다르다. 한 파일에 더 밀어 넣으면 어느 상태가 어느 저장에
 * 실리는지 읽어낼 수 없다.
 */

type Notice = (type: 'ok' | 'err', text: string) => void;

/* ────────────────────────── 공통 조각 ────────────────────────── */

const SectionShell: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, title, desc, right, children }) => (
  <section className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm mb-6">
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-base md:text-lg font-black text-slate-900">{title}</h3>
          <p className="text-[11px] md:text-xs text-slate-500 font-medium leading-relaxed mt-0.5">{desc}</p>
        </div>
      </div>
      {right}
    </div>
    {children}
  </section>
);

const HintBox: React.FC<{ tone?: 'info' | 'warn'; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <div
    className={`rounded-2xl px-4 py-3 text-[11px] md:text-xs font-medium leading-relaxed ${
      tone === 'warn'
        ? 'bg-amber-50 border border-amber-200 text-amber-800'
        : 'bg-slate-50 border border-slate-200 text-slate-600'
    }`}
  >
    {children}
  </div>
);

const SaveButton: React.FC<{ saving: boolean; disabled?: boolean; onClick: () => void; label?: string }> = ({
  saving, disabled = false, onClick, label = '저장하기',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={saving || disabled}
    className="flex items-center justify-center gap-1.5 bg-slate-900 text-white rounded-xl py-2.5 px-5 text-xs md:text-sm font-black hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
  >
    {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {label}
  </button>
);

export const fmtDateTime = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/** `datetime-local` 입력에 넣을 수 있는 형식(현지 시간, 초 없음). */
export const toLocalInput = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const genId = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/* ────────────────────────── 1. 자주 묻는 질문 ────────────────────────── */

interface FaqProps {
  userName: string;
  connected: boolean;
  entitled: boolean;
  /** 전체 자동 발송 스위치. 꺼져 있으면 버튼을 눌러도 답변이 나가지 않는다. */
  masterEnabled: boolean;
  /** 버튼 클릭(postback) 웹훅이 구독돼 있는지. */
  postbackSubscribed: boolean;
  value: DmFaqSettings;
  onChange: (faq: DmFaqSettings) => void;
  onNotice: Notice;
}

export const DmFaqSection: React.FC<FaqProps> = ({
  userName, connected, entitled, masterEnabled, postbackSubscribed, value, onChange, onNotice,
}) => {
  const [draft, setDraft] = useState<DmFaqSettings>(value);
  const [saving, setSaving] = useState(false);

  // 서버가 확정한 값(등록 시각·실패 이유 포함)으로 화면을 맞춘다.
  useEffect(() => { setDraft(value); }, [value]);

  const items = draft.items || [];
  const patchItem = (id: string, patch: Partial<DmFaqItem>) =>
    setDraft({ ...draft, items: items.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  const addItem = () => {
    if (items.length >= DM_FAQ_MAX) return;
    setDraft({
      ...draft,
      items: [...items, { id: genId('faq'), question: '', answer: '', buttons: [] }],
    });
  };

  const save = async () => {
    // 질문만 있고 답변이 없는 항목은 서버가 버린다(버튼을 눌러도 아무 답이 없으므로).
    // 저장하고 나서 조용히 사라지면 사용자는 저장이 안 된 줄 알기 때문에 미리 막는다.
    const halfDone = items.find((f) => f.question.trim() && !f.answer.trim());
    if (halfDone) {
      onNotice('err', `"${halfDone.question.trim().slice(0, 20)}" 질문의 답변을 입력해 주세요.`);
      return;
    }
    setSaving(true);
    const result = await apiService.saveDmFaq(userName, {
      ...draft,
      items: items.filter((f) => f.question.trim()),
    });
    setSaving(false);
    if (result.faq) onChange(result.faq);
    if (result.ok) {
      onNotice(
        'ok',
        draft.enabled && items.some((f) => f.question.trim())
          ? '자주 묻는 질문을 인스타그램에 등록했어요. DM 창(앱)에서 확인해 보세요.'
          : '저장했어요.',
      );
      if (result.warning) onNotice('err', result.warning);
    } else {
      onNotice('err', result.error || '저장에 실패했습니다.');
    }
  };

  return (
    <SectionShell
      icon={<HelpCircle size={17} />}
      title="자주 묻는 질문 버튼"
      desc="DM 창을 처음 여는 사람에게 추천 질문을 최대 4개 보여줍니다. 누르면 미리 정해 둔 답변이 바로 발송돼요."
      right={
        <Toggle
          on={Boolean(draft.enabled)}
          onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
          disabled={!entitled || saving}
        />
      }
    >
      <div className="space-y-3 mb-4">
        {items.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
            <HelpCircle size={24} className="text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 font-bold text-xs">아직 등록한 질문이 없어요</p>
          </div>
        ) : (
          items.map((f, i) => (
            <div key={f.id} className="rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-black text-slate-400">질문 {i + 1}</span>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, items: items.filter((x) => x.id !== f.id) })}
                  className="text-slate-300 hover:text-red-500 transition-colors"
                  aria-label="질문 삭제"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <input
                value={f.question}
                onChange={(e) => patchItem(f.id, { question: e.target.value })}
                maxLength={DM_FAQ_QUESTION_MAX}
                placeholder="예) 가격이 궁금해요"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 placeholder:font-medium placeholder:text-slate-400 focus:outline-none focus:border-slate-400 mb-2"
              />
              <textarea
                value={f.answer}
                onChange={(e) => patchItem(f.id, { answer: e.target.value })}
                maxLength={1000}
                rows={3}
                placeholder="이 질문을 누르면 보낼 답변을 적어주세요."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 resize-none"
              />
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <button
          type="button"
          onClick={addItem}
          disabled={items.length >= DM_FAQ_MAX || !entitled}
          className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl py-2 px-3.5 text-xs font-black hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <Plus size={14} /> 질문 추가 ({items.length}/{DM_FAQ_MAX})
        </button>
        <SaveButton saving={saving} disabled={!entitled} onClick={save} />
      </div>

      {/* 실제로 DM 창에 올라갔는지 — 저장만으로는 알 수 없는 정보다. */}
      {draft.syncError ? (
        <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-[11px] md:text-xs font-bold text-red-700 leading-relaxed mb-3">
          <AlertCircle size={13} className="inline mr-1 -mt-0.5" />
          인스타그램에 등록하지 못했어요: {draft.syncError}
        </div>
      ) : draft.syncedAt ? (
        <p className="text-[11px] font-bold text-emerald-600 mb-3">
          <Check size={12} className="inline mr-1 -mt-0.5" />
          {fmtDateTime(draft.syncedAt)}에 인스타그램에 등록했어요.
        </p>
      ) : null}

      <div className="space-y-2">
        <HintBox>
          질문 버튼은 <b>인스타그램 앱</b>의 DM 화면에서만 보입니다(웹 instagram.com 은 이 기능을
          지원하지 않아요). 또 대화를 한 번도 하지 않은 상대의 첫 화면에만 표시됩니다.
        </HintBox>
        {!connected && (
          <HintBox tone="warn">인스타그램 계정을 연동하면 질문 버튼이 DM 창에 표시됩니다.</HintBox>
        )}
        {connected && !masterEnabled && (
          <HintBox tone="warn">
            자동 발송 스위치가 꺼져 있어요. 스위치를 끄면 답변이 나가지 않기 때문에, 질문 버튼도
            DM 창에서 함께 내려갑니다. 다시 켜면 자동으로 올라갑니다.
          </HintBox>
        )}
        {connected && draft.enabled && !postbackSubscribed && (
          <HintBox tone="warn">
            버튼 클릭을 받을 웹훅이 아직 연결되지 않았어요. 저장할 때 자동으로 다시 시도하며,
            그래도 안 되면 위의 "웹훅 다시 연결"을 눌러주세요.
          </HintBox>
        )}
      </div>
    </SectionShell>
  );
};

/* ────────────────────────── 2. DM 자동 응답 ────────────────────────── */

interface TriggerProps {
  userName: string;
  connected: boolean;
  entitled: boolean;
  masterEnabled: boolean;
  messagesSubscribed: boolean;
  value: DmDirectSettings;
  onChange: (direct: DmDirectSettings) => void;
  onNotice: Notice;
}

export const DmTriggerSection: React.FC<TriggerProps> = ({
  userName, connected, entitled, masterEnabled, messagesSubscribed, value, onChange, onNotice,
}) => {
  const [draft, setDraft] = useState<DmDirectSettings>(value);
  const [saving, setSaving] = useState(false);
  /**
   * 키워드 입력창의 원본 문자열.
   *
   * 배열에 바로 반영하면 쉼표를 찍는 순간 빈 항목이 걸러지면서 커서 뒤의 쉼표가
   * 사라져 계속 입력할 수 없다. 화면에서는 문자열을 그대로 들고 있다가 저장할 때
   * 배열로 바꾼다.
   */
  const [kwText, setKwText] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraft(value);
    const next: Record<string, string> = {};
    for (const r of value.replies || []) next[r.id] = (r.keywords || []).join(', ');
    setKwText(next);
  }, [value]);

  const greeting = draft.greeting;
  const replies = draft.replies || [];

  const patchGreeting = (patch: Partial<DmDirectSettings['greeting']>) =>
    setDraft({ ...draft, greeting: { ...greeting, ...patch } });

  const patchReply = (id: string, patch: Partial<DmKeywordReply>) =>
    setDraft({ ...draft, replies: replies.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const addReply = () => {
    const id = genId('kw');
    setKwText({ ...kwText, [id]: '' });
    setDraft({
      ...draft,
      replies: [
        ...replies,
        {
          id,
          name: `키워드 답장 ${replies.length + 1}`,
          enabled: true,
          keywords: [],
          message: '',
          buttons: [],
          createdAt: new Date().toISOString(),
        },
      ],
    });
  };

  const parseKeywords = (id: string, fallback: string[]): string[] => {
    const raw = kwText[id];
    if (raw === undefined) return fallback;
    return raw.split(',').map((k) => k.trim()).filter(Boolean);
  };

  const save = async () => {
    const resolved: DmDirectSettings = {
      greeting,
      replies: replies.map((r) => ({ ...r, keywords: parseKeywords(r.id, r.keywords) })),
    };

    // 켜 둔 채로 비워 두면 아무 일도 일어나지 않는다. 저장은 되지만 사용자는
    // "켰는데 안 온다"를 겪으므로 저장 전에 알려준다.
    if (resolved.greeting.enabled && !resolved.greeting.message.trim()) {
      onNotice('err', '인사말을 켜 두셨어요. 보낼 인사말 문구를 입력해 주세요.');
      return;
    }
    const emptyReply = resolved.replies.find(
      (r) => r.enabled && (r.keywords.length === 0 || !r.message.trim()),
    );
    if (emptyReply) {
      onNotice('err', `"${emptyReply.name}"의 키워드와 답장 문구를 모두 입력해 주세요.`);
      return;
    }

    setSaving(true);
    const result = await apiService.saveDmTriggers(userName, resolved);
    setSaving(false);
    if (result.ok) {
      onChange(result.direct || resolved);
      onNotice('ok', 'DM 자동 응답을 저장했어요.');
    } else {
      onNotice('err', result.error || '저장에 실패했습니다.');
    }
  };

  return (
    <SectionShell
      icon={<MessageSquareReply size={17} />}
      title="DM 자동 응답"
      desc="댓글과 무관하게, DM 을 받은 것 자체를 트리거로 씁니다. 처음 말을 걸어온 사람에게 인사말을 보내고, 메시지에 등록해 둔 단어가 있으면 그에 맞는 답장을 보냅니다."
    >
      {/* 첫 인사말 */}
      <div className="rounded-2xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h4 className="text-sm font-black text-slate-900">첫 인사말</h4>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              처음 DM 을 보내온 사람에게 자동으로 보냅니다.
            </p>
          </div>
          <Toggle
            on={Boolean(greeting.enabled)}
            onClick={() => patchGreeting({ enabled: !greeting.enabled })}
            size="sm"
            disabled={!entitled || saving}
          />
        </div>
        <textarea
          value={greeting.message}
          onChange={(e) => patchGreeting({ message: e.target.value })}
          maxLength={1000}
          rows={3}
          placeholder="예) 안녕하세요! 문의 주셔서 감사합니다 😊 궁금한 점을 남겨주시면 순서대로 답변드릴게요."
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 resize-none mb-3"
        />
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={greeting.onlyFirstContact !== false}
            onChange={(e) => patchGreeting({ onlyFirstContact: e.target.checked })}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-pink-600"
          />
          <span className="text-[11px] md:text-xs font-bold text-slate-600 leading-relaxed">
            처음 대화하는 사람에게만 보내기
            <span className="block font-medium text-slate-400">
              끄면 24시간 넘게 끊겼던 대화가 다시 시작될 때도 한 번 더 보냅니다.
              대화 중에는 어느 경우에도 다시 보내지 않아요.
            </span>
          </span>
        </label>
      </div>

      {/* 키워드 자동 답장 */}
      <div className="mb-4">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <h4 className="text-sm font-black text-slate-900">키워드 자동 답장</h4>
          <span className="text-[11px] font-black text-slate-400">{replies.length}개</span>
        </div>

        <div className="space-y-3">
          {replies.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
              <MessageSquareReply size={24} className="text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 font-bold text-xs">
                받은 DM 에 특정 단어가 있을 때 보낼 답장을 만들어보세요
              </p>
            </div>
          ) : (
            replies.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-200 p-3.5">
                <div className="flex items-center gap-2 mb-2.5">
                  <input
                    value={r.name}
                    onChange={(e) => patchReply(r.id, { name: e.target.value })}
                    maxLength={60}
                    className="flex-1 min-w-0 bg-transparent text-sm font-black text-slate-900 focus:outline-none"
                  />
                  <Toggle
                    on={r.enabled !== false}
                    onClick={() => patchReply(r.id, { enabled: r.enabled === false })}
                    size="sm"
                    disabled={!entitled || saving}
                  />
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, replies: replies.filter((x) => x.id !== r.id) })}
                    className="text-slate-300 hover:text-red-500 transition-colors"
                    aria-label="답장 삭제"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <input
                  value={kwText[r.id] ?? (r.keywords || []).join(', ')}
                  onChange={(e) => setKwText({ ...kwText, [r.id]: e.target.value })}
                  placeholder="키워드를 쉼표로 구분해 입력 (예: 가격, 얼마, 비용)"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 placeholder:font-medium placeholder:text-slate-400 focus:outline-none focus:border-slate-400 mb-2"
                />
                <textarea
                  value={r.message}
                  onChange={(e) => patchReply(r.id, { message: e.target.value })}
                  maxLength={1000}
                  rows={3}
                  placeholder="이 키워드가 들어오면 보낼 답장을 적어주세요."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 resize-none"
                />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <button
          type="button"
          onClick={addReply}
          disabled={!entitled || replies.length >= 20}
          className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 rounded-xl py-2 px-3.5 text-xs font-black hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <Plus size={14} /> 답장 추가
        </button>
        <SaveButton saving={saving} disabled={!entitled} onClick={save} />
      </div>

      <div className="space-y-2">
        <HintBox>
          받은 DM 에 답장하는 것은 인스타그램이 허용하는 범위입니다(상대가 먼저 말을 걸었으므로
          24시간 동안 자유롭게 답장할 수 있어요). 키워드는 문장 안에 포함되면 걸립니다 —
          "가격"을 등록하면 "가격 얼마예요?"에도 답장이 나갑니다.
        </HintBox>
        {connected && !masterEnabled && (
          <HintBox tone="warn">
            자동 발송 스위치가 꺼져 있어 지금은 답장이 나가지 않습니다. 설정은 저장돼요.
          </HintBox>
        )}
        {connected && !messagesSubscribed && (
          <HintBox tone="warn">
            받은 메시지를 받아올 웹훅이 아직 연결되지 않았어요. 저장할 때 자동으로 다시 시도합니다.
          </HintBox>
        )}
      </div>
    </SectionShell>
  );
};

/* ────────────────────────── 3. 예약 발송 ────────────────────────── */

interface ScheduleProps {
  userName: string;
  connected: boolean;
  entitled: boolean;
  onNotice: Notice;
}

const STATUS_LABEL: Record<DmScheduledJob['status'], { text: string; className: string }> = {
  pending: { text: '대기 중', className: 'bg-indigo-100 text-indigo-700' },
  sent: { text: '발송 완료', className: 'bg-emerald-100 text-emerald-700' },
  failed: { text: '발송 실패', className: 'bg-red-100 text-red-700' },
  canceled: { text: '취소됨', className: 'bg-slate-100 text-slate-500' },
};

/**
 * 목록에 보여줄 한 줄 요약.
 *
 * 댓글 자동화에서 들어온 캐러셀 예약은 본문(`message`)이 비어 있다. 그대로 두면
 * 목록에 빈 줄만 남아 무엇이 나갈 예약인지 알 수 없다.
 */
const jobSummary = (j: DmScheduledJob): string => {
  const text = (j.message || '').trim() || (j.intro || '').trim();
  if (text) return text;
  if (j.messageType === 'carousel') return `카드 ${j.cards?.length || 0}장`;
  return '';
};

/** 댓글 자동화에서 들어온 예약임을 알리는 표시. */
const JobSourceChip: React.FC<{ job: DmScheduledJob }> = ({ job }) =>
  job.source === 'comment' ? (
    <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 text-indigo-600 px-2 py-0.5 text-[10px] font-black max-w-[55%] truncate">
      <MessageCircle size={10} className="shrink-0" />
      <span className="truncate">댓글 자동화{job.ruleName ? ` · ${job.ruleName}` : ''}</span>
    </span>
  ) : null;

export const DmScheduleSection: React.FC<ScheduleProps> = ({ userName, connected, entitled, onNotice }) => {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<DmScheduledJob[]>([]);
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [recipientId, setRecipientId] = useState('');
  const [sendAt, setSendAt] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [canceling, setCanceling] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiService.getDmSchedule(userName)
      .then((data) => {
        // 목록을 못 받아온 것과 "예약이 없는" 것은 다르다. 구분하지 않으면 예약이
        // 조용히 사라진 것처럼 보인다.
        if (data.loadError) { onNotice('err', '예약 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
        setJobs(data.jobs);
        setContacts(data.contacts);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (connected) load(); else setLoading(false); /* eslint-disable-next-line */ }, [userName, connected]);

  const pending = useMemo(() => jobs.filter((j) => j.status === 'pending'), [jobs]);
  const history = useMemo(
    () => jobs.filter((j) => j.status !== 'pending').sort((a, b) => Date.parse(b.sendAt) - Date.parse(a.sendAt)),
    [jobs],
  );
  const selected = contacts.find((c) => c.igsid === recipientId) || null;

  const create = async () => {
    if (!recipientId) { onNotice('err', '받는 사람을 선택해 주세요.'); return; }
    if (!sendAt) { onNotice('err', '보낼 날짜와 시간을 정해 주세요.'); return; }
    if (!message.trim()) { onNotice('err', '보낼 내용을 입력해 주세요.'); return; }

    const at = new Date(sendAt);
    if (Number.isNaN(at.getTime())) { onNotice('err', '날짜·시간 형식을 확인해 주세요.'); return; }

    setCreating(true);
    const result = await apiService.createDmSchedule(userName, {
      recipientId,
      sendAt: at.toISOString(),
      message: message.trim(),
    });
    setCreating(false);
    if (!result.ok) { onNotice('err', result.error || '예약에 실패했습니다.'); return; }

    if (result.jobs) setJobs(result.jobs); else load();
    setMessage('');
    setSendAt('');
    onNotice('ok', `${fmtDateTime(at.toISOString())}에 보내도록 예약했어요.`);
    // 24시간 창을 넘긴 예약은 막지 않되 이유를 그대로 알려준다.
    if (result.warning) onNotice('err', result.warning);
  };

  const cancel = async (id: string) => {
    setCanceling(id);
    const result = await apiService.cancelDmSchedule(userName, id);
    setCanceling(null);
    if (result.jobs) setJobs(result.jobs);
    if (!result.ok) onNotice('err', result.error || '취소하지 못했습니다.');
  };

  return (
    <SectionShell
      icon={<CalendarClock size={17} />}
      title="예약 발송"
      desc="정한 날짜와 시간에 미리 작성해 둔 DM 을 보냅니다. 1분 단위로 확인해 발송해요."
    >
      {!connected ? (
        <HintBox tone="warn">인스타그램 계정을 먼저 연동해 주세요.</HintBox>
      ) : loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <>
          {/* 새 예약 */}
          <div className="rounded-2xl border border-slate-200 p-4 mb-5">
            <label className="block text-[11px] font-black text-slate-500 mb-1.5">받는 사람</label>
            {contacts.length === 0 ? (
              <HintBox tone="warn">
                아직 이 계정에 DM 을 보낸 사람이 없어요. 인스타그램은 <b>상대가 먼저 보낸
                메시지에 대한 답장</b>만 허용하기 때문에, DM 을 받으면 이 목록에 나타납니다.
              </HintBox>
            ) : (
              <>
                <select
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 mb-1.5"
                >
                  <option value="">DM 을 보내온 사람 중에서 선택</option>
                  {contacts.map((c) => (
                    <option key={c.igsid} value={c.igsid}>
                      {c.username ? `@${c.username}` : c.name || c.igsid}
                      {` · 마지막 메시지 ${fmtDateTime(c.lastAt)}`}
                      {c.open ? '' : ' (24시간 지남)'}
                    </option>
                  ))}
                </select>
                {selected && (
                  <p className={`text-[11px] font-bold mb-3 ${selected.open ? 'text-emerald-600' : 'text-amber-700'}`}>
                    <Clock size={12} className="inline mr-1 -mt-0.5" />
                    {selected.open
                      ? `${fmtDateTime(selected.openUntil)}까지 보낼 수 있어요.`
                      : '이 상대는 24시간 창이 닫혀 있어, 다시 메시지를 보내오지 않으면 발송이 실패합니다.'}
                  </p>
                )}

                <label className="block text-[11px] font-black text-slate-500 mb-1.5">보낼 시각</label>
                <input
                  type="datetime-local"
                  value={sendAt}
                  min={toLocalInput(new Date())}
                  onChange={(e) => setSendAt(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 mb-3"
                />

                <label className="block text-[11px] font-black text-slate-500 mb-1.5">보낼 내용</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="예약 시각에 보낼 DM 내용을 적어주세요."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 resize-none mb-3"
                />

                <button
                  type="button"
                  onClick={create}
                  disabled={creating || !entitled}
                  className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-pink-600 to-orange-500 text-white rounded-xl py-2.5 px-4 text-xs md:text-sm font-black shadow-lg shadow-pink-500/25 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {creating ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 예약하기
                </button>
              </>
            )}
          </div>

          {/* 예약 목록 */}
          {pending.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-black text-slate-900 mb-2.5">
                대기 중인 예약 <span className="text-slate-400">{pending.length}건</span>
              </h4>
              <div className="space-y-2">
                {pending.map((j) => (
                  <div key={j.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black ${STATUS_LABEL[j.status].className}`}>
                          {STATUS_LABEL[j.status].text}
                        </span>
                        <span className="text-xs font-black text-slate-900">{fmtDateTime(j.sendAt)}</span>
                        <JobSourceChip job={j} />
                      </div>
                      <p className="text-[11px] font-bold text-slate-500 truncate">
                        <Users size={11} className="inline mr-1 -mt-0.5" />
                        {j.recipientName ? `@${j.recipientName}` : j.recipientId}
                      </p>
                      <p data-user-content className="text-xs text-slate-600 font-medium mt-1 line-clamp-2">{jobSummary(j)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => cancel(j.id)}
                      disabled={canceling === j.id}
                      className="text-slate-300 hover:text-red-500 disabled:opacity-40 transition-colors shrink-0"
                      aria-label="예약 취소"
                    >
                      {canceling === j.id ? <Loader2 size={15} className="animate-spin" /> : <X size={16} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-black text-slate-900 mb-2.5">지난 예약</h4>
              <div className="space-y-2">
                {history.slice(0, 10).map((j) => (
                  <div key={j.id} className="rounded-2xl bg-slate-50 border border-slate-100 p-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black ${STATUS_LABEL[j.status].className}`}>
                        {STATUS_LABEL[j.status].text}
                      </span>
                      <span className="text-xs font-black text-slate-700">{fmtDateTime(j.sentAt || j.sendAt)}</span>
                      <JobSourceChip job={j} />
                    </div>
                    <p data-user-content className="text-xs text-slate-600 font-medium line-clamp-2">{jobSummary(j)}</p>
                    {j.error && (
                      <p className="text-[11px] font-bold text-red-600 mt-1 leading-relaxed">{j.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <HintBox>
            인스타그램은 <b>상대가 마지막으로 메시지를 보낸 뒤 24시간 안에만</b> 자유 형식 DM 을
            허용합니다. 그래서 예약 발송은 DM 을 보내온 사람에게만 걸 수 있고, 발송 시각에 그
            시간이 지났다면 실패로 기록됩니다(상대가 그 사이 다시 메시지를 보내면 정상 발송돼요).
            먼저 말을 거는 홍보 DM 은 정책상 보낼 수 없습니다.
          </HintBox>
          <HintBox>
            <b>댓글 자동화</b> 표시가 붙은 예약은 게시물 설정에서 "예약 발송"을 고른 자동화가
            만든 것입니다. 이 예약은 댓글에 대한 비공개 답장이라 상대가 DM 을 보내온 적이 없어도
            발송되고, 대신 <b>댓글이 달린 뒤 7일</b>이 지나면 보낼 수 없습니다. 여기서 취소하면
            그 댓글에는 DM 이 나가지 않아요.
          </HintBox>
        </>
      )}
    </SectionShell>
  );
};
