import React, { useState, useEffect, useMemo } from 'react';
import type { Settlement } from '../types';
import { formatKRW, stripCommas } from '../utils/formatters';
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
    setEditAmount(String(s.amount ?? 0));
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
        <>
          {/* Upcoming / Pending Settlements */}
          <div className="mb-8">
            <h3 className="text-base font-black text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
              예정된 정산 ({scheduledSettlements.length}건)
            </h3>
            {scheduledSettlements.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
                <p className="text-slate-400 text-sm font-medium">예정된 정산이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {scheduledSettlements.map(s => (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                          <span className="text-lg">💰</span>
                        </div>
                        <div>
                          <p className="font-black text-slate-900 text-sm">{s.title}</p>
                          <p className="text-slate-400 text-[10px] font-bold mt-0.5">{s.company_name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {isAmountPending(s) ? (
                          /* 담당자가 금액을 확정하기 전. 0원으로 그리면 무보수 협업으로
                             읽히고, 여기서 인플루언서가 임의로 금액을 적으면 담당자가
                             조율 중인 금액과 어긋난다 — 수정 칸도 열지 않는다. */
                          <>
                            <p className="font-black text-amber-600 text-base">협의중</p>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">담당자 확정 후 표시</p>
                          </>
                        ) : editingId === s.id ? (
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                value={editAmount}
                                onChange={e => setEditAmount(e.target.value)}
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
                        ) : (
                          <>
                            <div className="flex items-center justify-end gap-1.5">
                              <p className="font-black text-blue-600 text-base">{formatFee(s.amount)}</p>
                              <button
                                onClick={() => startEditAmount(s)}
                                className="text-slate-300 hover:text-blue-500 transition-colors"
                                title="정산금 수정"
                                aria-label="정산금 수정"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
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
                    {isAmountPending(s) ? (
                      /* 금액이 없으면 완료 처리할 것도 없다. 눌러서 0원 정산이
                         완료로 남으면 나중에 실제 지급액을 되짚을 수 없다. */
                      <p className="w-full mt-3 bg-amber-50 text-amber-700 py-2.5 rounded-xl font-black text-xs text-center">
                        담당자가 정산 금액을 조율하고 있습니다
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
                ))}
              </div>
            )}
          </div>

          {/* Completed Settlements */}
          <div>
            <h3 className="text-base font-black text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              정산 완료 ({completedSettlements.length}건)
            </h3>
            {completedSettlements.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
                <p className="text-slate-400 text-sm font-medium">완료된 정산이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {completedSettlements.map(s => (
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
                      <p className="font-black text-green-600 text-sm">{formatFee(s.amount)}</p>
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[9px] font-black rounded-md">완료</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default UserSettlement;
