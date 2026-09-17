import React, { useEffect, useState } from 'react';
import {
  AlertCircle, Check, HelpCircle, Loader2, MessageSquareReply, Plus, Trash2,
} from 'lucide-react';
import {
  apiService, DmDirectSettings, DmFaqItem, DmFaqSettings, DmKeywordReply,
  DM_FAQ_MAX, DM_FAQ_QUESTION_MAX,
} from '../services/apiService';
import Toggle from './DmToggle';

/**
 * 디엠 자동화의 추가 기능 두 가지.
 *
 *  1. 자주 묻는 질문   — DM 창 첫 화면의 추천 버튼(인스타그램 아이스브레이커).
 *  2. DM 자동 응답     — DM 을 받은 것 자체를 트리거로 쓰는 인사말 · 키워드 답장.
 *
 * 둘 다 이미 승인받은 권한(`instagram_business_manage_messages`)만으로 동작한다.
 * 다만 인스타그램 쪽 제약이 각각 달라서, 화면에서 그 제약을 반드시 같이 보여준다 —
 * 사용자가 "설정했는데 왜 안 되지"를 겪지 않는 유일한 방법이다.
 *
 *  · 질문 버튼은 **인스타그램 앱**의 DM 화면에서만 보인다(웹은 지원하지 않는다).
 *  · 받은 DM 에 답장하는 것은 상대가 마지막으로 메시지를 보낸 뒤 **24시간 안에만**
 *    가능하다. 먼저 말을 거는 발송은 정책 위반이라 아예 만들지 않는다.
 *
 * 예약 발송 목록은 여기 있었지만 지웠다. 예약은 게시물 자동화를 만들 때 발송 방식으로
 * 고르는 것이고(댓글이 달린 순간 대기열에 들어간다), 그 대기열을 다시 한 화면으로
 * 보여 주는 자리는 "여기서 뭘 해야 하나"만 늘렸다 — 취소는 자동화 자체를 끄면 되고,
 * 사람이 직접 예약을 만드는 길(24시간 창 안의 상대를 골라 시각을 찍는 일)은 실제로
 * 쓰이지 않았다.
 *
 * 파일을 나눠 둔 이유: DmAutomation.tsx 는 이미 2천 줄이 넘고, 두 기능은 저장
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
  value: DmFaqSettings;
  onChange: (faq: DmFaqSettings) => void;
  onNotice: Notice;
}

export const DmFaqSection: React.FC<FaqProps> = ({
  userName, connected, entitled, masterEnabled, value, onChange, onNotice,
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
                placeholder="예) 💜 브랜드 소개"
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
        {/* 버튼이 화면 어디에 어떻게 놓이는지는 우리가 정할 수 없다. 그 사실을 여기 적어
            두지 않으면 "가운데로 옮겨 달라"는 요청이 설정에서 찾을 수 없는 값을 찾는
            일이 된다 — 인스타그램에 보내는 값은 질문 문구와 답변 연결뿐이다. */}
        <HintBox>
          버튼이 놓이는 자리(가운데 정렬 · 오른쪽 정렬)와 색은 <b>인스타그램 앱이 정합니다</b>.
          앱 버전과 다크 모드에 따라 달라서 우리 설정으로는 바꿀 수 없어요. 우리가 보내는 것은
          질문 문구와 눌렀을 때 나갈 답변뿐입니다 — 문구 앞에 이모지를 하나 붙이고 짧게
          쓰면 어느 배치에서도 잘 읽힙니다.
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
  value: DmDirectSettings;
  onChange: (direct: DmDirectSettings) => void;
  onNotice: Notice;
}

export const DmTriggerSection: React.FC<TriggerProps> = ({
  userName, connected, entitled, masterEnabled, value, onChange, onNotice,
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
      </div>
    </SectionShell>
  );
};
