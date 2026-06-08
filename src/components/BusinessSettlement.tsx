import React, { useState, useEffect, useMemo } from 'react';
import type { Settlement } from '../types';
import { formatNumberWithCommas, stripCommas, formatKRW } from '../utils/formatters';

interface BusinessSettlementProps {
  businessUsername: string;
  companyName: string;
  // When rendered inside the 협업 현황 정산금 tab, drop the standalone page padding
  // and the big page title so it sits cleanly within the tab.
  embedded?: boolean;
}

type EditingField = { id: string; field: 'amount' | 'date'; value: string } | null;

const BusinessSettlement: React.FC<BusinessSettlementProps> = ({ businessUsername, companyName, embedded = false }) => {
  const cleanBusinessUsername = businessUsername.replace(/^biz\//, '');
  const settlementsBaseUrl = `/api/settlements/${encodeURIComponent(cleanBusinessUsername)}`;
  const cacheKey = `picks_biz_settlements_${cleanBusinessUsername.toLowerCase()}`;

  const cachedSettlements = (() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  })();

  const [settlements, setSettlements] = useState<Settlement[]>(cachedSettlements);
  const [loading, setLoading] = useState(cachedSettlements.length === 0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingField>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [selectedInfluencer, setSelectedInfluencer] = useState<string>('all');

  // Create form state
  const [formData, setFormData] = useState({
    influencer_username: '',
    title: '',
    amount: '',
    scheduled_date: '',
    memo: '',
    proposal_id: '',
  });

  const fetchSettlements = async () => {
    try {
      const res = await fetch(`${settlementsBaseUrl}?role=business`);
      if (res.ok) {
        const data = await res.json();
        const fresh = data.settlements || [];
        setSettlements(fresh);
        try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {}
      }
    } catch (e) {
      console.error('Failed to fetch settlements:', e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchSettlements(); }, [businessUsername]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.influencer_username || !formData.title || !formData.amount || !formData.scheduled_date) {
      alert('모든 필수 항목을 입력해 주세요.');
      return;
    }

    try {
      const res = await fetch(`${settlementsBaseUrl}?role=business`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          amount: parseInt(formData.amount),
          company_name: companyName,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSettlements(prev => [...prev, data.settlement]);
        setShowCreateModal(false);
        setFormData({ influencer_username: '', title: '', amount: '', scheduled_date: '', memo: '', proposal_id: '' });
      } else {
        alert('정산 생성에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    }
  };

  const handleComplete = async (settlementId: string) => {
    if (!confirm('정산 완료 처리하시겠습니까? 인플루언서에게도 완료로 표시됩니다.')) return;
    setUpdatingId(settlementId);
    try {
      const res = await fetch(`${settlementsBaseUrl}/${settlementId}?role=business`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (res.ok) {
        const data = await res.json();
        setSettlements(prev => prev.map(s => s.id === settlementId ? data.settlement : s));
      }
    } catch {
      alert('업데이트 실패');
    }
    setUpdatingId(null);
  };

  const submitEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const body = editing.field === 'amount'
        ? { amount: parseInt(editing.value) }
        : { scheduled_date: editing.value };

      const res = await fetch(`${settlementsBaseUrl}/${editing.id}?role=business`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setSettlements(prev => prev.map(s => s.id === editing.id ? data.settlement : s));
        setEditing(null);
      } else {
        alert(editing.field === 'amount' ? '금액 수정 실패' : '일정 수정 실패');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    }
    setSavingEdit(false);
  };

  const handleDelete = async (settlementId: string) => {
    if (!confirm('이 정산 건을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${settlementsBaseUrl}/${settlementId}?role=business`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSettlements(prev => prev.filter(s => s.id !== settlementId));
      }
    } catch {
      alert('삭제 실패');
    }
  };

  const influencerOptions = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    settlements.forEach(s => {
      const cur = map.get(s.influencer_username) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += s.amount;
      map.set(s.influencer_username, cur);
    });
    return Array.from(map.entries())
      .map(([username, stats]) => ({ username, ...stats }))
      .sort((a, b) => b.total - a.total);
  }, [settlements]);

  const visibleSettlements = useMemo(
    () => selectedInfluencer === 'all'
      ? settlements
      : settlements.filter(s => s.influencer_username === selectedInfluencer),
    [settlements, selectedInfluencer]
  );

  const scheduledSettlements = useMemo(
    () => visibleSettlements.filter(s => s.status === 'scheduled' || s.status === 'pending'),
    [visibleSettlements]
  );
  const completedSettlements = useMemo(
    () => visibleSettlements.filter(s => s.status === 'completed'),
    [visibleSettlements]
  );
  const totalAmount = visibleSettlements.reduce((sum, s) => sum + s.amount, 0);
  const completedAmount = completedSettlements.reduce((sum, s) => sum + s.amount, 0);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const inputClass = "w-full border border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 focus:outline-none focus:border-blue-500";

  return (
    <div className={embedded ? 'w-full animate-in fade-in duration-500' : 'p-4 md:p-14 w-full animate-in fade-in duration-500'}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-10">
        {!embedded ? (
          <div>
            <h2 className="text-xl md:text-3xl font-black text-slate-900">정산 관리</h2>
            <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">인플루언서 정산 일정과 금액을 관리합니다</p>
          </div>
        ) : (
          <div />
        )}
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-5 py-3 rounded-xl font-black text-sm hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" />
          </svg>
          정산 등록
        </button>
      </div>

      {/* Influencer filter */}
      {influencerOptions.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">인플루언서별 정산 현황</h3>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
            <button
              onClick={() => setSelectedInfluencer('all')}
              className={`shrink-0 px-4 py-2.5 rounded-xl font-black text-sm transition-all border ${
                selectedInfluencer === 'all'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
              }`}
            >
              전체 <span className="opacity-70 ml-1">({settlements.length})</span>
            </button>
            {influencerOptions.map(opt => (
              <button
                key={opt.username}
                onClick={() => setSelectedInfluencer(opt.username)}
                className={`shrink-0 px-4 py-2.5 rounded-xl font-black transition-all border flex items-center gap-2 ${
                  selectedInfluencer === opt.username
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'
                }`}
              >
                <span className="text-sm">@{opt.username}</span>
                <span className={`text-[10px] font-bold ${selectedInfluencer === opt.username ? 'opacity-80' : 'text-slate-400'}`}>
                  {opt.count}건 · {formatFee(opt.total)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
            {selectedInfluencer === 'all' ? '총 정산 금액' : `@${selectedInfluencer} 총 정산`}
          </p>
          <p className="text-lg md:text-2xl font-black text-slate-900">{formatFee(totalAmount)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">정산 완료</p>
          <p className="text-lg md:text-2xl font-black text-green-600">{formatFee(completedAmount)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 shadow-sm">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">미정산</p>
          <p className="text-lg md:text-2xl font-black text-amber-600">{formatFee(totalAmount - completedAmount)}</p>
        </div>
      </div>

      {/* Pending Settlements */}
      {loading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">로딩 중...</p>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h3 className="text-base font-black text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
              예정 / 대기 ({scheduledSettlements.length}건)
            </h3>
            {scheduledSettlements.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center">
                <p className="text-slate-400 text-sm font-medium">예정된 정산이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {scheduledSettlements.map(s => (
                  <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                          <span className="text-blue-600 font-black text-xs">@</span>
                        </div>
                        <div>
                          <p className="font-black text-slate-900 text-sm">{s.title}</p>
                          <p className="text-slate-600 text-sm font-bold">@{s.influencer_username}</p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[10px] font-black rounded-lg">
                        {s.status === 'pending' ? '대기중' : '예정'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">정산 금액</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-black text-blue-600">{formatFee(s.amount)}</p>
                          <button
                            onClick={() => setEditing({ id: s.id, field: 'amount', value: String(s.amount) })}
                            className="text-[9px] text-slate-400 hover:text-blue-500 font-bold underline"
                          >수정</button>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase mb-1">정산 예정일</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-700">{formatDate(s.scheduled_date)}</p>
                          <button
                            onClick={() => setEditing({ id: s.id, field: 'date', value: s.scheduled_date })}
                            className="text-[9px] text-slate-400 hover:text-blue-500 font-bold underline"
                          >수정</button>
                        </div>
                      </div>
                    </div>
                    {s.memo && <p className="text-[11px] text-slate-500 font-medium mb-3">{s.memo}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleComplete(s.id)}
                        disabled={updatingId === s.id}
                        className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white py-2.5 rounded-xl font-black text-xs shadow-lg shadow-green-500/20 hover:shadow-green-500/40 transition-all disabled:opacity-60"
                      >
                        {updatingId === s.id ? '처리 중...' : '정산 완료'}
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="px-4 py-2.5 bg-white text-red-500 rounded-xl font-black text-xs border border-red-200 hover:bg-red-50 transition-all"
                      >삭제</button>
                    </div>
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
                        <p className="text-slate-600 text-sm font-bold">@{s.influencer_username} <span className="text-slate-400 text-[10px] font-bold">· {formatDate(s.completed_at || s.updated_at || '')}</span></p>
                      </div>
                    </div>
                    <p className="font-black text-green-600 text-sm">{formatFee(s.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Create Settlement Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-slate-900 text-lg mb-4">정산 등록</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">인플루언서 아이디 *</label>
                <input
                  type="text" value={formData.influencer_username}
                  onChange={e => setFormData({ ...formData, influencer_username: e.target.value })}
                  className={inputClass} placeholder="인플루언서 username" required
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">정산 제목 *</label>
                <input
                  type="text" value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  className={inputClass} placeholder="예: 3월 광고 캠페인 정산" required
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">금액 (원) *</label>
                <input
                  type="text" inputMode="numeric" value={formatNumberWithCommas(formData.amount)}
                  onChange={e => setFormData({ ...formData, amount: stripCommas(e.target.value) })}
                  className={inputClass} placeholder="500,000" required
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">정산 예정일 *</label>
                <input
                  type="date" value={formData.scheduled_date}
                  onChange={e => setFormData({ ...formData, scheduled_date: e.target.value })}
                  className={inputClass} required
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">메모</label>
                <textarea
                  value={formData.memo}
                  onChange={e => setFormData({ ...formData, memo: e.target.value })}
                  className={`${inputClass} resize-none h-20`} placeholder="정산 관련 메모 (선택사항)"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-3 rounded-xl font-black text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
                  취소
                </button>
                <button type="submit"
                  className="flex-1 py-3 rounded-xl font-black text-sm bg-blue-600 text-white hover:bg-blue-500 transition-all">
                  등록
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Amount / Date Modal — picksfolio styled */}
      {editing && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !savingEdit && setEditing(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                editing.field === 'amount' ? 'bg-blue-100' : 'bg-blue-100'
              }`}>
                {editing.field === 'amount' ? (
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-lg leading-tight">
                  {editing.field === 'amount' ? '정산 금액 수정' : '정산 예정일 수정'}
                </h3>
                <p className="text-slate-400 text-[11px] font-bold">
                  {editing.field === 'amount' ? '새 정산 금액을 입력해 주세요' : '새 정산 예정일을 선택해 주세요'}
                </p>
              </div>
            </div>

            <div className="mb-5">
              <label className="block text-xs font-black text-slate-600 mb-1.5">
                {editing.field === 'amount' ? '금액 (원)' : '날짜'}
              </label>
              {editing.field === 'amount' ? (
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumberWithCommas(editing.value)}
                  onChange={e => setEditing({ ...editing, value: stripCommas(e.target.value) })}
                  className={inputClass}
                  placeholder="500,000"
                  autoFocus
                />
              ) : (
                <input
                  type="date"
                  value={editing.value}
                  onChange={e => setEditing({ ...editing, value: e.target.value })}
                  className={inputClass}
                  autoFocus
                />
              )}
              {editing.field === 'amount' && editing.value && !isNaN(parseInt(editing.value)) && (
                <p className="text-[11px] text-slate-500 font-bold mt-2 pl-1">
                  → {parseInt(editing.value).toLocaleString()}원
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={savingEdit}
                className="flex-1 py-3 rounded-xl font-black text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={
                  savingEdit ||
                  !editing.value ||
                  (editing.field === 'amount' && isNaN(parseInt(editing.value)))
                }
                className="flex-1 py-3 rounded-xl font-black text-sm bg-blue-600 text-white hover:bg-blue-500 transition-all disabled:opacity-60"
              >
                {savingEdit ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessSettlement;
