import React, { useState, useEffect, useMemo } from 'react';
import type { Settlement } from '../types';
import { formatKRW, formatNumberWithCommas, stripCommas } from '../utils/formatters';
import { authHeaders } from '../services/apiService';
import { useLanguage } from '../contexts/LanguageContext';

interface UserSettlementProps {
  userName: string;
  // When rendered inside the 협업 현황 정산금 tab, drop the standalone page padding
  // and the big page title so it sits cleanly within the tab.
  embedded?: boolean;
  // 협업 현황 안에 들어가 있을 때, 정산 목록이 바뀌면 부모(협업 내역/합계)도
  // 같은 값을 쓰도록 알려준다. 이게 없으면 정산을 완료 처리해도 협업 내역은
  // 새로고침할 때까지 예전 상태로 남아 있었다.
  onSettlementsChange?: (settlements: Settlement[]) => void;
}

/**
 * 서버가 돌려준 메시지를 그대로 보여준다. 동시 수정 충돌(409)이나 권한 오류(401/403)
 * 처럼 사용자가 다음 행동을 정할 수 있는 경우가 있어서, 뭉뚱그린 실패 문구보다 낫다.
 */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

/**
 * 'YYYY-MM-DD' 를 그대로 new Date() 에 넣으면 UTC 자정으로 해석돼서, 한국 시간
 * 기준으로 하루가 밀려 보인다. 날짜만 들어온 값은 그 지역의 자정으로 읽는다.
 */
function parseLocalDate(value?: string): Date | null {
  if (!value) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 금액이 아직 정해지지 않은 정산인지.
 *
 * 공동구매는 판매 수수료를 담당자가 인플루언서와 조율해 정한다 — 그 전까지는 지급될
 * 금액이 없는 것이 아니라 "아직 정해지지 않은" 상태다. 0원으로 그리면 무보수 협업으로
 * 읽히므로, 담당자가 금액을 넣기 전에는 협의중으로만 보여 준다.
 */
function isAmountPending(s: Settlement): boolean {
  return !!s.amount_pending && !Number(s.amount || 0);
}

type SettlementSourceKey = 'campaign' | 'proposal';

/**
 * 이 정산이 담당자가 관리하는 캠페인에서 온 것인지, 브랜드가 직접 보낸 비즈니스
 * 제안에서 온 것인지.
 *
 * 둘은 돈이 흐르는 길이 달라서 화면에서 섞이면 안 된다. 캠페인은 브랜드 →
 * 픽스폴리오 → 인플루언서로 흐르고 금액·지급 완료를 담당자가 잡는다. 제안은
 * 브랜드가 인플루언서에게 바로 보내므로 두 사람이 서로 확인하면 끝난다.
 *
 * 서버가 `source` 를 내려주지만, 캐시된 예전 응답에는 없을 수 있어 식별자 규칙으로
 * 한 번 더 판단한다.
 */
function sourceOf(s: Settlement): SettlementSourceKey {
  if (s.source === 'campaign' || s.source === 'proposal') return s.source;
  return String(s.proposal_id || '').startsWith('campaign_') ? 'campaign' : 'proposal';
}

/**
 * 공동구매 협업인지.
 *
 * 공동구매의 보수는 정해진 금액이 아니라 판매액에 대한 수수료율이다. 그래서 판매가
 * 끝나기 전에는 지급될 금액이라는 게 존재하지 않는다 — 금액 칸에는 약속된 비율을
 * 보여 준다.
 */
function isGroupbuy(s: Settlement): boolean {
  return s.reward_mode === 'groupbuy';
}

function groupbuyRate(s: Settlement): number {
  return Number(s.groupbuy_rate || 0);
}

const UserSettlement: React.FC<UserSettlementProps> = ({ userName, embedded = false, onSettlementsChange }) => {
  const { language, t } = useLanguage();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const commitSettlements = (next: Settlement[]) => {
    setSettlements(next);
    onSettlementsChange?.(next);
  };

  const startEditAmount = (s: Settlement) => {
    setEditingId(s.id);
    setEditAmount(formatNumberWithCommas(s.amount ?? 0));
  };

  const cancelEditAmount = () => {
    setEditingId(null);
    setEditAmount('');
  };

  const handleSaveAmount = async (settlementId: string) => {
    const amount = parseInt(stripCommas(editAmount), 10);
    if (isNaN(amount) || amount < 0) {
      alert('올바른 금액을 입력해주세요.');
      return;
    }
    setSavingId(settlementId);
    try {
      const res = await fetch(`/api/settlements/${encodeURIComponent(userName)}/${settlementId}?role=influencer`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ amount }),
      });
      if (res.ok) {
        const data = await res.json();
        commitSettlements(settlements.map(s =>
          s.id === settlementId
            ? (data.settlement || { ...s, amount })
            : s
        ));
        setEditingId(null);
        setEditAmount('');
      } else {
        alert(await readError(res, '정산금 수정에 실패했습니다.'));
      }
    } catch {
      alert('정산금 수정에 실패했습니다.');
    }
    setSavingId(null);
  };

  // Let the influencer confirm a settlement themselves. Previously only the
  // business account could press "정산 완료"; now either side can finalize it and
  // the change is mirrored to the business via the shared settlements API.
  const handleComplete = async (settlementId: string) => {
    if (!confirm('정산을 완료 처리하시겠습니까?')) return;
    setUpdatingId(settlementId);
    try {
      const res = await fetch(`/api/settlements/${encodeURIComponent(userName)}/${settlementId}?role=influencer`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'completed' }),
      });
      if (res.ok) {
        const data = await res.json();
        commitSettlements(settlements.map(s =>
          s.id === settlementId
            ? (data.settlement || { ...s, status: 'completed', completed_at: new Date().toISOString() })
            : s
        ));
      } else {
        alert(await readError(res, '정산 완료 처리에 실패했습니다.'));
      }
    } catch {
      alert('정산 완료 처리에 실패했습니다.');
    }
    setUpdatingId(null);
  };

  const fetchSettlements = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/settlements/${encodeURIComponent(userName)}?role=influencer`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        commitSettlements(data.settlements || []);
      }
    } catch (e) {
      console.error('Failed to fetch settlements:', e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchSettlements(); }, [userName]);

  // 날짜가 비어 있거나 형식이 깨진 항목은 예전에는 NaN 으로 비교돼서 목록 순서가
  // 들쭉날쭉했다. 지금은 날짜 있는 항목을 먼저 빠른 순으로 놓고, 날짜가 없는
  // 항목은 뒤로 모아 둔다.
  const scheduledSettlements = useMemo(() =>
    settlements.filter(s => s.status === 'scheduled' || s.status === 'pending')
      .sort((a, b) => {
        const at = parseLocalDate(a.scheduled_date)?.getTime();
        const bt = parseLocalDate(b.scheduled_date)?.getTime();
        if (at === undefined && bt === undefined) return 0;
        if (at === undefined) return 1;
        if (bt === undefined) return -1;
        return at - bt;
      }),
    [settlements]
  );
  const completedSettlements = useMemo(() =>
    settlements.filter(s => s.status === 'completed')
      .sort((a, b) => {
        const at = parseLocalDate(a.completed_at || a.updated_at)?.getTime();
        const bt = parseLocalDate(b.completed_at || b.updated_at)?.getTime();
        if (at === undefined && bt === undefined) return 0;
        if (at === undefined) return 1;
        if (bt === undefined) return -1;
        return bt - at;
      }),
    [settlements]
  );

  /**
   * 정산금을 출처별로 두 묶음으로 나눈다.
   *
   * 한 목록에 섞여 있으면 "이건 누구한테 물어봐야 하나"가 구분되지 않는다. 캠페인
   * 정산은 담당자가 브랜드 입금을 확인하고 원천징수를 떼고 보내 주는 건이고, 제안
   * 정산은 브랜드와 직접 주고받는 건이다. 완료를 누를 수 있는 사람도 다르다.
   *
   * 한 건도 없는 묶음은 내보내지 않는다 — 빈 제목만 남으면 목록이 비어 보인다.
   */
  const groups = useMemo(() => {
    const build = (key: SettlementSourceKey, title: string, hint: string) => ({
      key,
      title,
      hint,
      scheduled: scheduledSettlements.filter(s => sourceOf(s) === key),
      completed: completedSettlements.filter(s => sourceOf(s) === key),
    });
    return [
      build(
        'campaign',
        '픽스폴리오 담당자 관리 캠페인',
        '담당자가 브랜드 입금을 확인한 뒤 지급합니다. 지급이 끝나면 자동으로 정산완료로 바뀝니다.',
      ),
      build(
        'proposal',
        '비즈니스 제안 직접 협업',
        '브랜드가 직접 지급합니다. 나와 브랜드 중 어느 한쪽이 정산완료를 누르면 완료로 표시됩니다.',
      ),
    ].filter(g => g.scheduled.length + g.completed.length > 0);
  }, [scheduledSettlements, completedSettlements]);

  const totalAmount = settlements.reduce((sum, s) => sum + s.amount, 0);
  const completedAmount = completedSettlements.reduce((sum, s) => sum + s.amount, 0);
  const pendingAmount = totalAmount - completedAmount;
  // 담당자가 아직 금액을 확정하지 않은 협업(공동구매 수수료 등). 합계에는 0원으로
  // 들어가므로, 몇 건이 협의중인지 따로 알려 주지 않으면 합계가 틀린 것처럼 보인다.
  const negotiatingCount = settlements.filter(isAmountPending).length;

  const formatDate = (dateStr: string) => {
    const d = parseLocalDate(dateStr);
    if (!d) return '-';
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const getDaysUntil = (dateStr: string) => {
    const target = parseLocalDate(dateStr);
    if (!target) return null;
    // 날짜끼리만 비교한다. 예전에는 'YYYY-MM-DD' 를 그대로 Date 로 만들어(UTC 자정)
    // 지금 시각과 뺐기 때문에, 한국 시간 오전 9시 이전에는 오늘 정산이 'D-1' 로,
    // 오후에는 어제 정산이 '오늘' 로 보이는 하루 오차가 있었다.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - startOfToday.getTime()) / 86400000);
    if (diff < 0) return <span className="text-red-500 font-black text-[10px]">{language === 'en' ? 'Overdue' : '기한 지남'}</span>;
    if (diff === 0) return <span className="text-amber-500 font-black text-[10px]">{language === 'en' ? 'Today' : '오늘'}</span>;
    if (diff <= 7) return <span className="text-amber-500 font-black text-[10px]">D-{diff}</span>;
    return <span className="text-slate-400 font-bold text-[10px]">D-{diff}</span>;
  };

  /**
   * 금액 칸. 공동구매는 금액이 아니라 판매 수수료율이 약속이므로 비율을 보여 준다.
   * 담당자가 판매 결과로 금액을 확정한 뒤에는 그 금액을 아래에 함께 적어, 비율만
   * 보고 실제 받을 돈을 알 수 없는 상태로 남지 않게 한다.
   */
  const renderAmount = (s: Settlement, tone: 'scheduled' | 'completed') => {
    const settled = Number(s.amount || 0) > 0 && !isAmountPending(s);
    if (isGroupbuy(s)) {
      const rate = groupbuyRate(s);
      return (
        <>
          <p className={`font-black text-base ${tone === 'completed' ? 'text-green-600' : 'text-purple-600'}`}>
            {rate > 0 ? `${rate}%` : '수수료 협의중'}
          </p>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">
            {settled ? `공동구매 판매 수수료 · 확정 ${formatFee(s.amount)}` : '공동구매 판매 수수료'}
          </p>
        </>
      );
    }
    return (
      <p className={`font-black text-base ${tone === 'completed' ? 'text-green-600' : 'text-blue-600'}`}>
        {formatFee(s.amount)}
      </p>
    );
  };

  /** 아직 지급되지 않은 정산 한 줄. */
  const renderScheduledCard = (s: Settlement) => {
    const managerManaged = sourceOf(s) === 'campaign';
    /*
     * 금액을 직접 고칠 수 있는 건은 브랜드와 직접 주고받는 제안 정산뿐이다.
     * 캠페인 금액은 담당자가 확정한 협업 조건에서 오고(서버도 인플루언서의 금액
     * 수정을 거절한다), 공동구매는 애초에 금액이 아니라 비율로 약속된 건이다.
     */
    const canEditAmount = !managerManaged && !isGroupbuy(s) && !isAmountPending(s);
    return (
      <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isGroupbuy(s) ? 'bg-purple-100' : 'bg-blue-100'}`}>
              <span className="text-lg">{isGroupbuy(s) ? '🛒' : '💰'}</span>
            </div>
            <div>
              <p className="font-black text-slate-900 text-sm">{s.title}</p>
              <p className="text-slate-400 text-[10px] font-bold mt-0.5">{s.company_name}</p>
            </div>
          </div>
          <div className="text-right">
            {editingId === s.id && canEditAmount ? (
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editAmount}
                    onChange={e => setEditAmount(formatNumberWithCommas(e.target.value))}
                    autoFocus
                    className="w-28 md:w-32 text-right font-black text-blue-600 text-base border-2 border-blue-200 rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-xs font-bold text-slate-400">원</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleSaveAmount(s.id)}
                    disabled={savingId === s.id}
                    className="px-3 py-1 bg-blue-600 text-white rounded-lg font-black text-[10px] hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {savingId === s.id ? '저장 중...' : '저장'}
                  </button>
                  <button
                    onClick={cancelEditAmount}
                    disabled={savingId === s.id}
                    className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg font-black text-[10px] hover:bg-slate-200 transition-colors disabled:opacity-60"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : isAmountPending(s) && !isGroupbuy(s) ? (
              /* 담당자가 금액을 확정하기 전. 0원으로 그리면 무보수 협업으로 읽힌다. */
              <>
                <p className="font-black text-amber-600 text-base">협의중</p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5">담당자 확정 후 표시</p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-end gap-1.5">
                  <div className="text-right">{renderAmount(s, 'scheduled')}</div>
                  {canEditAmount && (
                    <button
                      onClick={() => startEditAmount(s)}
                      className="mt-1 text-slate-300 hover:text-blue-500 transition-colors"
                      title="정산금 수정"
                      aria-label="정산금 수정"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                </div>
                {getDaysUntil(s.scheduled_date)}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3 mt-2">
          <div>
            <p className="text-[9px] font-black text-slate-400 uppercase">정산 예정일</p>
            <p className="text-xs font-bold text-slate-700">{formatDate(s.scheduled_date)}</p>
          </div>
          <span className={`px-2.5 py-1 text-[10px] font-black rounded-lg ${
            s.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {s.status === 'pending' ? '대기중' : '예정'}
          </span>
        </div>
        {s.memo && (
          <p className="text-[11px] text-slate-500 font-medium mt-2 pl-1">{s.memo}</p>
        )}
        {managerManaged ? (
          /* 담당자가 관리하는 캠페인은 담당자가 실제로 이체를 마쳤을 때만 완료다.
             여기서 인플루언서가 먼저 닫아 버리면 아직 못 받은 돈이 받은 것으로
             남는다 — 그래서 버튼 대신 어떻게 완료되는지만 알려 준다. */
          <p className="w-full mt-3 bg-indigo-50 text-indigo-700 py-2.5 rounded-xl font-black text-[11px] text-center">
            담당자가 지급을 완료하면 정산완료로 표시됩니다
          </p>
        ) : isAmountPending(s) ? (
          /* 금액이 없으면 완료 처리할 것도 없다. 눌러서 0원 정산이 완료로 남으면
             나중에 실제 지급액을 되짚을 수 없다. */
          <p className="w-full mt-3 bg-amber-50 text-amber-700 py-2.5 rounded-xl font-black text-xs text-center">
            정산 금액이 아직 확정되지 않았습니다
          </p>
        ) : (
          <button
            onClick={() => handleComplete(s.id)}
            disabled={updatingId === s.id}
            className="gradient-btn-fix w-full mt-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white py-2.5 rounded-xl font-black text-xs shadow-lg shadow-green-500/20 hover:shadow-green-500/40 transition-all disabled:opacity-60"
          >
            {updatingId === s.id ? '처리 중...' : '정산 완료 처리'}
          </button>
        )}
      </div>
    );
  };

  /** 지급이 끝난 정산 한 줄. */
  const renderCompletedRow = (s: Settlement) => (
    <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="font-bold text-slate-800 text-sm">{s.title}</p>
          <p className="text-slate-400 text-[10px] font-bold mt-0.5">
            {s.company_name} · 완료일: {formatDate(s.completed_at || s.updated_at || '')}
          </p>
        </div>
      </div>
      <div className="text-right">
        {renderAmount(s, 'completed')}
        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[9px] font-black rounded-md">완료</span>
      </div>
    </div>
  );

  return (
    <div className={embedded ? 'w-full animate-in fade-in duration-500' : 'p-3 md:p-14 w-full animate-in fade-in duration-500'}>
      {!embedded && (
        <div className="mb-6 md:mb-10">
          <h2 className="text-xl md:text-3xl font-black text-slate-900">{language === 'en' ? 'Settlement Status' : '정산 현황'}</h2>
          <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">
            {language === 'en' ? 'Settlement schedule is automatically added when a proposal is accepted' : '협업 제안이 수락되면 정산 일정이 자동으로 추가됩니다'}
          </p>
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-8">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 p-4 md:p-5">
          <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">{language === 'en' ? 'TOTAL SETTLEMENT' : '총 정산 금액'}</p>
          <p className="text-base md:text-2xl font-black text-blue-700">{formatFee(totalAmount)}</p>
          <p className="text-[10px] font-bold text-blue-400 mt-1">
            {settlements.length}{language === 'en' ? ' items' : '건'}{negotiatingCount > 0 && (language === 'en' ? ` · In negotiation ${negotiatingCount}` : ` · 협의중 ${negotiatingCount}건`)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{language === 'en' ? 'COMPLETED' : '정산 완료'}</p>
          <p className="text-base md:text-2xl font-black text-green-600">{formatFee(completedAmount)}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-1">{completedSettlements.length}{language === 'en' ? ' items' : '건'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{language === 'en' ? 'PENDING' : '미정산'}</p>
          <p className="text-base md:text-2xl font-black text-amber-600">{formatFee(pendingAmount)}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-1">{scheduledSettlements.length}{language === 'en' ? ' items' : '건'}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">{t('common.loading', '로딩 중...', 'Loading...')}</p>
        </div>
      ) : settlements.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-12 text-center">
          <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">💰</div>
          <h3 className="font-black text-slate-900 text-lg mb-2">{language === 'en' ? 'No Settlement Records' : '정산 내역이 없습니다'}</h3>
          <p className="text-slate-400 text-sm font-medium">{language === 'en' ? 'Settlement items will be organized automatically when collaborations are confirmed.' : '협업이 확정되면 정산이 자동으로 정리됩니다.'}</p>
        </div>
      ) : (
        <div className="space-y-10">
          {groups.map(group => (
            <section key={group.key}>
              <div className="mb-4">
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${group.key === 'campaign' ? 'bg-indigo-500' : 'bg-sky-500'}`}></span>
                  {group.title} ({group.scheduled.length + group.completed.length}건)
                </h3>
                <p className="text-[11px] font-bold text-slate-400 mt-1.5 pl-4 leading-relaxed">{group.hint}</p>
              </div>

              <div className="mb-6">
                <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2">
                  예정 {group.scheduled.length}건
                </p>
                {group.scheduled.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 text-center">
                    <p className="text-slate-400 text-xs font-medium">예정된 정산이 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-3">{group.scheduled.map(renderScheduledCard)}</div>
                )}
              </div>

              <div>
                <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-2">
                  정산 완료 {group.completed.length}건
                </p>
                {group.completed.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-100 p-4 text-center">
                    <p className="text-slate-400 text-xs font-medium">완료된 정산이 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-2">{group.completed.map(renderCompletedRow)}</div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserSettlement;
