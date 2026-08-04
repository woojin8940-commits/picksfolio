import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { formatNumberWithCommas, formatSignedKRW } from '../../utils/formatters';
import InfluencerCandidateCard from './InfluencerCandidateCard';

/**
 * 리스트업 작업대 — 후보를 찾아 명단에 올리고, 골라진 후보에게 제안한다.
 *
 * 담당자가 여기서 하는 일은 순서가 있다.
 *
 *   1. 후보 풀에서 어울리는 사람을 골라 명단에 올린다 (추천 이유와 브랜드 카드 값을 함께)
 *   2. 브랜드가 "진행 요청"으로 표시한 후보에게 조건을 담아 제안을 보낸다
 *   3. 인플루언서가 답하면 그 자리에서 협업이 생긴다 — 전화로 받은 답은 대신 기록한다
 *
 * 2번의 조건 폼은 캠페인 브리프에서 미리 채워진다. 담당자가 같은 값을 다시 적게
 * 만들면 브리프와 제안이 조금씩 달라지고, 그 차이는 항상 나중에 문제가 된다.
 *
 * 캠페인을 고르는 자리는 여기에 없다. 운영 콘솔은 드롭다운으로 고르고, 담당자
 * 대시보드는 캠페인 카드를 눌러 들어온다 — 고르는 방식이 화면마다 다르므로 고른
 * 결과(campaignId)만 받는다. 인증도 마찬가지다. 운영 콘솔은 관리자 토큰을 넘기고,
 * 담당자 대시보드는 비워 둔 채 본인 로그인으로 호출한다.
 */

interface ListupWorkspaceProps {
  campaignId: string;
  /** 운영 콘솔에서 열 때의 관리자 토큰. 담당자 대시보드에서는 비운다. */
  token?: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

const DECISION_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '브랜드 검토 중', cls: 'bg-slate-100 text-slate-500' },
  pick: { label: '브랜드 진행 요청', cls: 'bg-blue-50 text-blue-600' },
  pass: { label: '브랜드 넘김', cls: 'bg-slate-100 text-slate-400' },
};

const OUTREACH_BADGE: Record<string, { label: string; cls: string }> = {
  not_sent: { label: '제안 전', cls: 'bg-slate-100 text-slate-400' },
  sent: { label: '응답 대기', cls: 'bg-amber-50 text-amber-600' },
  accepted: { label: '수락 · 협업 생성', cls: 'bg-emerald-50 text-emerald-600' },
  declined: { label: '거절', cls: 'bg-red-50 text-red-500' },
  expired: { label: '기한 지남', cls: 'bg-slate-100 text-slate-400' },
};

const emptyOffer = {
  fee: '',
  secondUseFee: '',
  startDate: '',
  scriptDue: '',
  contentDue: '',
  uploadFrom: '',
  uploadTo: '',
  uploadChannel: '',
  contentFormat: '',
  videoConcept: '',
  guideUrl: '',
  guideNote: '',
  note: '',
  respondBy: '',
};

type OfferForm = typeof emptyOffer;

const asForm = (raw: any): OfferForm => ({
  fee: raw?.fee ? String(raw.fee) : '',
  secondUseFee: raw?.secondUseFee ? String(raw.secondUseFee) : '',
  startDate: raw?.startDate || '',
  scriptDue: raw?.scriptDue || '',
  contentDue: raw?.contentDue || '',
  uploadFrom: raw?.uploadFrom || '',
  uploadTo: raw?.uploadTo || '',
  uploadChannel: raw?.uploadChannel || '',
  contentFormat: raw?.contentFormat || '',
  videoConcept: raw?.videoConcept || '',
  guideUrl: raw?.guideUrl || '',
  guideNote: raw?.guideNote || '',
  note: raw?.note || '',
  respondBy: raw?.respondBy || '',
});

/**
 * 브랜드 카드에 찍히는 값 + 인플루언서에게 줄 금액.
 *
 * 두 금액을 한 폼에 둔 이유는 우리 수익이 그 차액이라는 점이다. 단가 100만원인
 * 사람을 110만원으로 넘기면 10만원이 우리 몫인데, 지급액을 제안 보낼 때 따로 적게
 * 하면 명단을 만드는 자리에서는 그 10만원이 보이지 않는다. 그래서 여기서 함께 적고
 * 차액을 바로 보여 준다.
 */
const emptyQuote = {
  fee: '',
  secondUseFee: '',
  guaranteedViews: '',
  badge: '',
  profileLine: '',
  payoutFee: '',
  payoutSecondUseFee: '',
};
type QuoteForm = typeof emptyQuote;

const quoteFrom = (c: any): QuoteForm => ({
  fee: c?.quotedFee ? String(c.quotedFee) : '',
  secondUseFee: c?.quotedSecondUseFee ? String(c.quotedSecondUseFee) : '',
  guaranteedViews: c?.guaranteedViews ? String(c.guaranteedViews) : '',
  badge: c?.badge || '',
  profileLine: c?.profileLine || '',
  payoutFee: c?.payoutFee ? String(c.payoutFee) : '',
  payoutSecondUseFee: c?.payoutSecondUseFee ? String(c.payoutSecondUseFee) : '',
});

/** 서버로 보내는 두 덩어리. 견적은 컬럼으로, 지급액은 제안 초안으로 들어간다. */
const quotePayload = (q: QuoteForm) => ({
  quote: {
    fee: q.fee,
    secondUseFee: q.secondUseFee,
    guaranteedViews: q.guaranteedViews,
    badge: q.badge,
    profileLine: q.profileLine,
  },
  payout: { fee: q.payoutFee, secondUseFee: q.payoutSecondUseFee },
});

/** 브랜드 카드 입력 한 벌. 명단에 올릴 때와 올린 뒤 고칠 때 같은 폼을 쓴다. */
const QuoteFields: React.FC<{
  value: QuoteForm;
  onChange: (next: QuoteForm) => void;
  hint?: string;
  /** 이미 제안을 보낸 후보. 지급액은 회수 전까지 고칠 수 없다. */
  payoutLocked?: boolean;
}> = ({ value, onChange, hint, payoutLocked }) => {
  const set = (key: keyof QuoteForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: e.target.value });
  const cls =
    'w-full text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400';
  const cpv =
    Number(value.fee || 0) > 0 && Number(value.guaranteedViews || 0) > 0
      ? Math.round(Number(value.fee) / Number(value.guaranteedViews))
      : 0;

  const brandAmount = Number(value.fee || 0) + Number(value.secondUseFee || 0);
  const payoutAmount = Number(value.payoutFee || 0) + Number(value.payoutSecondUseFee || 0);
  // 두 값이 모두 있을 때만 차액을 말한다. 지급액이 비어 있는데 차액을 보여 주면
  // 제시가 전액이 우리 수익으로 읽힌다.
  const margin = brandAmount > 0 && payoutAmount > 0 ? brandAmount - payoutAmount : null;
  const rate = margin !== null && brandAmount > 0 ? Math.round((margin / brandAmount) * 100) : 0;

  return (
    <div className="space-y-2">
      {/* 인플루언서에게 줄 금액 — 우리가 원가로 쓰는 값 */}
      <div className="bg-white/70 border border-slate-200 rounded-xl p-2.5">
        <p className="text-[10px] font-black text-slate-500 mb-1.5">
          인플루언서 지급 단가 <span className="text-slate-300 font-bold">· 브랜드에게 보이지 않습니다</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-slate-400 font-black mb-1">지급 단가(원)</label>
            <input
              type="number"
              value={value.payoutFee}
              onChange={set('payoutFee')}
              disabled={payoutLocked}
              placeholder="1000000"
              className={`${cls} disabled:bg-slate-50 disabled:text-slate-400`}
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-black mb-1">2차 활용 지급(원)</label>
            <input
              type="number"
              value={value.payoutSecondUseFee}
              onChange={set('payoutSecondUseFee')}
              disabled={payoutLocked}
              className={`${cls} disabled:bg-slate-50 disabled:text-slate-400`}
            />
          </div>
        </div>
        {payoutLocked && (
          <p className="text-[10px] font-bold text-amber-600 mt-1.5">
            이미 보낸 제안입니다. 지급 단가는 제안을 회수한 뒤 고칠 수 있습니다.
          </p>
        )}
      </div>

      {/* 브랜드에게 제시할 금액 — 지급 단가에 우리 수익을 붙인 값 */}
      <div className="bg-white/70 border border-blue-200 rounded-xl p-2.5">
        <p className="text-[10px] font-black text-blue-600 mb-1.5">
          브랜드 제시가 <span className="text-blue-300 font-bold">· 브랜드 카드에 찍히는 금액</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] text-slate-400 font-black mb-1">제시 광고비(원)</label>
            <input type="number" value={value.fee} onChange={set('fee')} placeholder="1100000" className={cls} />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-black mb-1">2차 활용(원)</label>
            <input
              type="number"
              value={value.secondUseFee}
              onChange={set('secondUseFee')}
              className={cls}
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-black mb-1">보장 조회수</label>
            <input
              type="number"
              value={value.guaranteedViews}
              onChange={set('guaranteedViews')}
              className={cls}
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 font-black mb-1">배지</label>
            <input
              type="text"
              value={value.badge}
              onChange={set('badge')}
              placeholder="인기"
              className={cls}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] text-slate-400 font-black mb-1">한 줄 소개</label>
            <input
              type="text"
              value={value.profileLine}
              onChange={set('profileLine')}
              placeholder="뷰티 · 20대 · 여성"
              className={cls}
            />
          </div>
        </div>
      </div>

      {/* 차액 = 우리 수익 */}
      <div
        className={`rounded-xl px-3 py-2 flex items-center justify-between gap-2 ${
          margin === null
            ? 'bg-slate-100'
            : margin > 0
              ? 'bg-emerald-50 border border-emerald-100'
              : 'bg-red-50 border border-red-100'
        }`}
      >
        <span className="text-[10px] font-black text-slate-500">우리 수익 (제시가 − 지급액)</span>
        {margin === null ? (
          <span className="text-[11px] font-black text-slate-400">두 금액을 모두 입력하면 계산됩니다</span>
        ) : (
          <span className={`text-[13px] font-black ${margin > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {formatSignedKRW(margin)}
            <span className="text-[10px] font-bold ml-1 opacity-70">마진율 {rate}%</span>
          </span>
        )}
      </div>

      <p className="text-[10px] text-slate-400 font-bold">
        {cpv > 0 ? `CPV ${formatNumberWithCommas(cpv)}원으로 표시됩니다. ` : ''}
        {hint || ''}
      </p>
    </div>
  );
};

const ListupWorkspace: React.FC<ListupWorkspaceProps> = ({ campaignId, token, onNotify }) => {
  const [candidates, setCandidates] = useState<any[]>([]);
  // 캠페인 한 건. 진행 방식에 따라 리스트업 자리 자체가 사라지므로 화면이 이 값을 읽는다.
  const [campaign, setCampaign] = useState<any>(null);
  const [pool, setPool] = useState<any[]>([]);
  const [offerDraft, setOfferDraft] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [addNote, setAddNote] = useState('');
  const [addQuote, setAddQuote] = useState<QuoteForm>(emptyQuote);

  const [offerFor, setOfferFor] = useState('');
  const [offer, setOffer] = useState<OfferForm>(emptyOffer);
  const [noteFor, setNoteFor] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [quoteFor, setQuoteFor] = useState('');
  const [quoteDraft, setQuoteDraft] = useState<QuoteForm>(emptyQuote);
  const [responseNote, setResponseNote] = useState<Record<string, string>>({});

  // 알림은 상위가 받아 가면 상위가, 아니면 이 화면이 직접 띄운다. 운영 콘솔은
  // 자체 알림 자리가 없어서 여기서 띄워야 하고, 담당자 대시보드는 화면 위쪽에
  // 한 곳으로 모은다.
  const notify = useCallback(
    (text: string, type: 'success' | 'error' = 'success') => {
      if (onNotify) {
        onNotify(text, type);
        return;
      }
      setMessage({ text, type });
      window.setTimeout(() => setMessage(null), 4000);
    },
    [onNotify],
  );

  const load = useCallback(
    async (q = '') => {
      if (!campaignId) return;
      setLoading(true);
      const res = await apiService.getCampaignListup(campaignId, { token, pool: true, q });
      setLoading(false);
      if (res.error) {
        notify(res.error, 'error');
        return;
      }
      setCandidates(res.candidates || []);
      setCampaign(res.campaign || null);
      setPool(res.pool || []);
      setOfferDraft(res.offerDraft || null);
    },
    [campaignId, token, notify],
  );

  useEffect(() => {
    setPicked([]);
    setOfferFor('');
    setQuoteFor('');
    setQuery('');
    load();
  }, [load]);

  const addCandidates = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    const res = await apiService.addListupCandidates(campaignId, picked, {
      token,
      note: addNote,
      ...quotePayload(addQuote),
    });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setPicked([]);
    setAddNote('');
    setAddQuote(emptyQuote);
    await load(query);
    notify(`${res.added}명을 명단에 올렸습니다.${res.skipped ? ` (이미 있던 ${res.skipped}명 제외)` : ''}`);
  };

  const act = async (id: string, action: any, payload: Record<string, any> = {}) => {
    setBusy(true);
    const res = await apiService.listupAction(id, action, payload, token);
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return null;
    }
    await load(query);
    return res;
  };

  const openOffer = (c: any) => {
    if (offerFor === c.id) {
      setOfferFor('');
      return;
    }
    setOfferFor(c.id);
    // 이미 보낸 제안이 있으면 그 값을, 없으면 캠페인 브리프에서 온 초안을 채운다.
    setOffer(asForm(c.offer?.fee ? c.offer : offerDraft));
  };

  const sendOffer = async (c: any) => {
    const res = await act(c.id, 'send_offer', { offer });
    if (!res) return;
    setOfferFor('');
    notify(`@${c.influencerUsername} 에게 제안을 보냈습니다.`);
  };

  const recordResponse = async (c: any, accept: boolean) => {
    const note = responseNote[c.id] || '';
    if (
      accept &&
      !window.confirm(
        `@${c.influencerUsername} 수락으로 처리하면 계약(협업)이 바로 생성됩니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }
    const res = await act(c.id, 'respond', { accept, note });
    if (!res) return;
    setResponseNote((p) => ({ ...p, [c.id]: '' }));
    notify(accept ? '수락으로 기록했습니다. 협업이 생성됐습니다.' : '거절로 기록했습니다.');
  };

  const field = (key: keyof OfferForm, label: string, type: 'text' | 'date' | 'number' = 'text') => (
    <div>
      <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">{label}</label>
      <input
        type={type}
        value={offer[key]}
        onChange={(e) => setOffer((p) => ({ ...p, [key]: e.target.value }))}
        className="w-full text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
      />
    </div>
  );

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
      </div>
    );
  }

  // 서버가 내려 주는 값을 그대로 쓴다. 진행 방식 목록을 화면에서 다시 판단하면 서버가
  // 막는 캠페인에 후보 풀이 열려 있는 상태가 생긴다. 값이 없던 시절의 응답에서는
  // 열어 둔다 — 담당자 작업을 막는 쪽으로 기울면 진행 중인 캠페인이 멈춘다.
  const listupAllowed = campaign ? campaign.managerListup !== false : true;

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`rounded-xl px-4 py-2.5 text-[11px] font-bold ${
            message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 제품 협찬형 안내. 후보 풀을 감추는 것만으로는 "왜 없지?"가 되므로 이유를 적어 둔다.
          이미 올라간 명단은 그대로 보여 준다 — 진행 방식이 바뀌기 전에 만든 후보가 화면에서
          사라지면 제안을 받은 인플루언서를 담당자가 찾을 수 없다. */}
      {campaign && !listupAllowed && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3">
          <p className="text-[12px] font-black text-amber-700">
            제품 협찬형 캠페인은 지원자만 받습니다
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-amber-600">
            광고비가 없는 협업은 제안 성사율이 낮아 담당자 리스트업을 붙이지 않습니다. 지원자
            명단에서 브랜드가 직접 고르는 방식이라 후보 풀은 표시하지 않습니다.
          </p>
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-4 ${listupAllowed ? 'xl:grid-cols-2' : ''}`}
      >
        {/* 후보 풀 */}
        {listupAllowed && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-black text-slate-900">후보 풀 ({pool.length})</h4>
              {picked.length > 0 && (
                <span className="text-[11px] text-blue-600 font-black">{picked.length}명 선택</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') load(query);
                }}
                placeholder="계정 · 이름 · 카테고리 검색"
                className="flex-1 text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
              />
              <button
                onClick={() => load(query)}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
              >
                검색
              </button>
            </div>
          </div>

          {picked.length > 0 && (
            <div className="px-4 py-3 bg-blue-50/70 border-b border-blue-100 space-y-2.5">
              <textarea
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                rows={2}
                placeholder="브랜드에게 보일 추천 이유 (예: 홈카페 리뷰 반응이 좋고 평균 조회수가 안정적입니다)"
                className="w-full text-[11px] font-medium text-slate-700 border border-blue-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
              />
              {/* 여기 적은 값이 브랜드 카드에 그대로 찍힌다. 비워 두면 광고비는
                  "협의"로, 보장 조회수는 채널 평균 조회수로 나간다. */}
              <QuoteFields
                value={addQuote}
                onChange={setAddQuote}
                hint="선택한 후보 전체에 같은 값으로 적용됩니다. 올린 뒤 한 명씩 고칠 수 있습니다."
              />
              <div className="flex justify-end">
                <button
                  onClick={addCandidates}
                  disabled={busy}
                  className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
                >
                  {picked.length}명 명단에 올리기
                </button>
              </div>
            </div>
          )}

          <div className="p-3 space-y-2.5 max-h-[720px] overflow-y-auto bg-slate-50/60">
            {pool.length === 0 ? (
              <p className="text-[11px] text-slate-400 font-bold text-center py-8">
                조건에 맞는 후보가 없습니다. 검색어를 바꿔 보세요.
              </p>
            ) : (
              pool.map((p) => {
                const on = picked.includes(p.username);
                return (
                  <InfluencerCandidateCard
                    key={p.username}
                    data={p}
                    badges={
                      <>
                        {p.isApplicant && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-50 text-blue-600">
                            이 캠페인 지원자
                          </span>
                        )}
                        <button
                          onClick={() =>
                            setPicked((prev) =>
                              on ? prev.filter((u) => u !== p.username) : [...prev, p.username],
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                            on
                              ? 'bg-slate-900 text-white hover:bg-slate-700'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {on ? '선택 해제' : '명단 후보'}
                        </button>
                      </>
                    }
                  />
                );
              })
            )}
          </div>
        </div>
        )}

        {/* 명단 */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100">
            <h4 className="text-sm font-black text-slate-900">명단 ({candidates.length})</h4>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              브랜드가 진행 요청한 후보에게만 제안을 보낼 수 있습니다.
            </p>
          </div>

          <div className="p-3 space-y-2.5 max-h-[720px] overflow-y-auto bg-slate-50/60">
            {candidates.length === 0 ? (
              <p className="text-[11px] text-slate-400 font-bold text-center py-8">
                {listupAllowed
                  ? '아직 명단이 비어 있습니다. 왼쪽에서 후보를 골라 올려 주세요.'
                  : '지원자만 받는 캠페인입니다. 명단은 만들지 않습니다.'}
              </p>
            ) : (
              candidates.map((c) => {
                const decision = DECISION_BADGE[c.brandDecision] || DECISION_BADGE.pending;
                const outreach = OUTREACH_BADGE[c.outreachStatus] || OUTREACH_BADGE.not_sent;
                const canSend = c.brandDecision === 'pick' && c.outreachStatus !== 'accepted';
                // 제안 폼에 지금 적혀 있는 단가로 계산한 차액. 저장된 값이 아니라 입력 중인
                // 값을 써야 보내기 전에 손해를 알아챌 수 있다.
                const offerBrandAmount = Number(c.quotedFee || 0) + Number(c.quotedSecondUseFee || 0);
                const offerPayAmount = Number(offer.fee || 0) + Number(offer.secondUseFee || 0);
                const offerMargin =
                  offerFor === c.id && offerBrandAmount > 0 && offerPayAmount > 0
                    ? offerBrandAmount - offerPayAmount
                    : null;
                return (
                  <InfluencerCandidateCard
                    key={c.id}
                    data={c}
                    note={c.managerNote}
                    badges={
                      <>
                        {c.brandFavorite && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-50 text-red-500">
                            브랜드 찜
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${decision.cls}`}>
                          {decision.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${outreach.cls}`}>
                          {outreach.label}
                        </span>
                      </>
                    }
                  >
                    {/* 브랜드가 지금 보고 있는 값과 우리가 남기는 차액. 담당자 화면에도
                        같이 띄우지 않으면 "브랜드가 얼마를 보고 고른 건지"와 "이 건이
                        얼마를 남기는지"를 다시 물어봐야 한다. */}
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 mb-2 flex flex-wrap gap-x-4 gap-y-0.5">
                      <span className="text-[11px] text-slate-700 font-bold">
                        브랜드 제시가{' '}
                        {c.quotedFee ? `${formatNumberWithCommas(c.quotedFee)}원` : '협의'}
                      </span>
                      <span className="text-[11px] text-slate-500 font-bold">
                        지급 단가{' '}
                        {c.payoutFee ? `${formatNumberWithCommas(c.payoutFee)}원` : '미입력'}
                      </span>
                      {c.margin === null || c.margin === undefined ? (
                        <span className="text-[11px] text-slate-400 font-bold">마진 미확정</span>
                      ) : (
                        <span
                          className={`text-[11px] font-black ${
                            c.margin > 0 ? 'text-emerald-600' : 'text-red-500'
                          }`}
                        >
                          차액 {formatSignedKRW(c.margin)}
                        </span>
                      )}
                      {c.guaranteedViews ? (
                        <span className="text-[11px] text-slate-500 font-bold">
                          보장 조회수 {formatNumberWithCommas(c.guaranteedViews)}
                          {c.cpv ? ` · CPV ${formatNumberWithCommas(c.cpv)}원` : ''}
                        </span>
                      ) : null}
                      {c.quotedSecondUseFee ? (
                        <span className="text-[11px] text-slate-500 font-bold">
                          2차 활용 {formatNumberWithCommas(c.quotedSecondUseFee)}원
                        </span>
                      ) : null}
                    </div>

                    {c.brandDecisionNote && (
                      <p className="text-[11px] text-slate-500 font-medium mb-2">
                        브랜드 메모: {c.brandDecisionNote}
                      </p>
                    )}

                    {c.outreachStatus === 'accepted' ? (
                      <p className="text-[11px] text-emerald-600 font-bold">
                        협업 생성 완료{c.collabId ? ` · ${c.collabId}` : ''} — 이후 진행은 협업 목록에서 봅니다.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => openOffer(c)}
                            disabled={!canSend}
                            className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
                          >
                            {offerFor === c.id
                              ? '조건 접기'
                              : c.outreachStatus === 'sent'
                                ? '조건 다시 보내기'
                                : '일정·가이드·단가 제안'}
                          </button>
                          {c.outreachStatus === 'sent' && (
                            <button
                              onClick={() => act(c.id, 'withdraw_offer')}
                              disabled={busy}
                              className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                            >
                              제안 회수
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setQuoteFor(quoteFor === c.id ? '' : c.id);
                              setQuoteDraft(quoteFrom(c));
                            }}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-50"
                          >
                            단가·마진
                          </button>
                          <button
                            onClick={() => {
                              setNoteFor(noteFor === c.id ? '' : c.id);
                              setNoteDraft(c.managerNote || '');
                            }}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-50"
                          >
                            추천 이유
                          </button>
                          {!c.collabId && (
                            <button
                              onClick={() => act(c.id, 'remove')}
                              disabled={busy}
                              className="text-[10px] text-slate-400 font-bold hover:text-red-500 ml-auto"
                            >
                              명단에서 빼기
                            </button>
                          )}
                        </div>

                        {quoteFor === c.id && (
                          <div className="bg-white rounded-xl border border-slate-200 p-3">
                            <QuoteFields
                              value={quoteDraft}
                              onChange={setQuoteDraft}
                              payoutLocked={c.outreachStatus !== 'not_sent'}
                              hint="보장 조회수를 비우면 채널 평균 조회수로 채워집니다. 지급 단가는 제안을 보낼 때 그대로 채워집니다."
                            />
                            <div className="flex justify-end mt-2">
                              <button
                                onClick={async () => {
                                  const res = await act(c.id, 'quote', quotePayload(quoteDraft));
                                  if (res) {
                                    setQuoteFor('');
                                    notify(
                                      res.warning || '제시가와 지급 단가를 저장했습니다.',
                                      res.warning ? 'error' : 'success',
                                    );
                                  }
                                }}
                                disabled={busy}
                                className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                              >
                                저장
                              </button>
                            </div>
                          </div>
                        )}

                        {noteFor === c.id && (
                          <div>
                            <textarea
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              rows={2}
                              className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                            />
                            <div className="flex justify-end mt-1.5">
                              <button
                                onClick={async () => {
                                  const res = await act(c.id, 'note', { managerNote: noteDraft });
                                  if (res) {
                                    setNoteFor('');
                                    notify('추천 이유를 저장했습니다.');
                                  }
                                }}
                                disabled={busy}
                                className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                              >
                                저장
                              </button>
                            </div>
                          </div>
                        )}

                        {offerFor === c.id && (
                          <div className="bg-white rounded-xl border border-slate-200 p-3">
                            <p className="text-[10px] text-slate-400 font-black uppercase mb-2">
                              제안 조건 — 인플루언서가 이 내용을 그대로 봅니다
                            </p>
                            {/* 여기 적는 단가가 인플루언서에게 나가는 금액이다. 브랜드에게
                                제시한 금액을 나란히 보여 주지 않으면, 제시가보다 높은 단가를
                                적어 손해가 나는 것을 보낸 뒤에야 알게 된다. */}
                            <div
                              className={`rounded-lg px-3 py-2 mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 ${
                                offerMargin === null
                                  ? 'bg-slate-50'
                                  : offerMargin > 0
                                    ? 'bg-emerald-50'
                                    : 'bg-red-50'
                              }`}
                            >
                              <span className="text-[10px] font-black text-slate-500">
                                브랜드 제시가{' '}
                                {c.quotedFee ? `${formatNumberWithCommas(c.quotedFee)}원` : '미입력'}
                              </span>
                              {offerMargin === null ? (
                                <span className="text-[10px] font-bold text-slate-400">
                                  제시가와 단가가 모두 있어야 차액이 계산됩니다
                                </span>
                              ) : (
                                <span
                                  className={`text-[11px] font-black ${
                                    offerMargin > 0 ? 'text-emerald-600' : 'text-red-500'
                                  }`}
                                >
                                  우리 수익 {formatSignedKRW(offerMargin)}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {field('fee', '지급 단가(원)')}
                              {field('secondUseFee', '2차 활용(원)')}
                              {field('startDate', '진행 시작일', 'date')}
                              {field('respondBy', '응답 기한', 'date')}
                              {field('scriptDue', '대본 마감', 'date')}
                              {field('contentDue', '영상 마감', 'date')}
                              {field('uploadFrom', '게시 시작', 'date')}
                              {field('uploadTo', '게시 종료', 'date')}
                              {field('uploadChannel', '업로드 채널')}
                              {field('contentFormat', '콘텐츠 형식')}
                            </div>
                            <div className="mt-2 space-y-2">
                              {field('guideUrl', '가이드라인 링크')}
                              <div>
                                <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
                                  가이드 요약
                                </label>
                                <textarea
                                  value={offer.guideNote}
                                  onChange={(e) => setOffer((p) => ({ ...p, guideNote: e.target.value }))}
                                  rows={2}
                                  className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
                                  담당자 메시지
                                </label>
                                <textarea
                                  value={offer.note}
                                  onChange={(e) => setOffer((p) => ({ ...p, note: e.target.value }))}
                                  rows={2}
                                  placeholder="이 캠페인을 왜 제안하는지, 협의 가능한 부분은 무엇인지"
                                  className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end mt-2">
                              <button
                                onClick={() => sendOffer(c)}
                                disabled={busy}
                                className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-500 disabled:opacity-40"
                              >
                                제안 보내기
                              </button>
                            </div>
                          </div>
                        )}

                        {c.outreachStatus === 'sent' && (
                          <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-3">
                            <p className="text-[10px] text-amber-700 font-black mb-1.5">
                              답을 대신 기록 — 전화·디엠으로 받은 답도 여기에 남겨야 기록이 됩니다
                            </p>
                            <input
                              type="text"
                              value={responseNote[c.id] || ''}
                              onChange={(e) =>
                                setResponseNote((p) => ({ ...p, [c.id]: e.target.value }))
                              }
                              placeholder="답변 요약 (예: 단가 조정 후 수락 / 일정이 겹쳐 거절)"
                              className="w-full text-[11px] font-medium text-slate-700 border border-amber-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
                            />
                            <div className="flex gap-1.5 justify-end mt-2">
                              <button
                                onClick={() => recordResponse(c, false)}
                                disabled={busy}
                                className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-50 disabled:opacity-40"
                              >
                                거절로 기록
                              </button>
                              <button
                                onClick={() => recordResponse(c, true)}
                                disabled={busy}
                                className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-500 disabled:opacity-40"
                              >
                                수락으로 기록
                              </button>
                            </div>
                          </div>
                        )}

                        {c.outreachStatus === 'declined' && c.responseNote && (
                          <p className="text-[11px] text-slate-500 font-medium">
                            거절 사유: {c.responseNote}
                          </p>
                        )}
                      </div>
                    )}
                  </InfluencerCandidateCard>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ListupWorkspace;
