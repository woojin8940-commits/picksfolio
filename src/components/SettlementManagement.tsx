import React, { useState, useEffect, useCallback } from 'react';

interface Settlement {
  id: string;
  influencer_username: string;
  title: string;
  amount: number;
  scheduled_date: string;
  status: 'pending' | 'completed' | 'cancelled';
  memo?: string;
  created_at: string;
}

interface SettlementManagementProps {
  userName: string;
}

const formatNumber = (value: string) => {
  const num = value.replace(/\D/g, '');
  return num.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

const parseNumber = (value: string) => value.replace(/,/g, '');

const SettlementManagement: React.FC<SettlementManagementProps> = ({ userName }) => {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [newSettlement, setNewSettlement] = useState({
    influencer_username: '',
    title: '',
    amount: '',
    scheduled_date: '',
    memo: '',
  });

  const fetchSettlements = useCallback(async () => {
    if (!userName) return;
    try {
      const res = await fetch(`/api/settlements/${encodeURIComponent(userName)}`);
      if (res.ok) {
        const data = await res.json();
        setSettlements(data);
        localStorage.setItem(`picks_settlements_${userName.toLowerCase()}`, JSON.stringify(data));
        return;
      }
    } catch (e) {
      console.error('Error fetching settlements:', e);
    }
    const saved = localStorage.getItem(`picks_settlements_${userName.toLowerCase()}`);
    if (saved) setSettlements(JSON.parse(saved));
  }, [userName]);

  useEffect(() => {
    setIsLoading(true);
    fetchSettlements().finally(() => setIsLoading(false));
  }, [fetchSettlements]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const settlement: Settlement = {
      id: Date.now().toString(),
      influencer_username: newSettlement.influencer_username,
      title: newSettlement.title,
      amount: Number(parseNumber(newSettlement.amount)),
      scheduled_date: newSettlement.scheduled_date,
      status: 'pending',
      memo: newSettlement.memo,
      created_at: new Date().toISOString(),
    };
    setSettlements(prev => [...prev, settlement]);
    setShowAddModal(false);
    setNewSettlement({ influencer_username: '', title: '', amount: '', scheduled_date: '', memo: '' });

    try {
      await fetch(`/api/settlements/${encodeURIComponent(userName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settlement),
      });
    } catch (e) {
      console.error('Error saving settlement:', e);
    }
  };

  const toggleStatus = async (id: string) => {
    const target = settlements.find(s => s.id === id);
    if (!target) return;
    const newStatus = target.status === 'pending' ? 'completed' : 'pending';

    setSettlements(prev => prev.map(s =>
      s.id === id ? { ...s, status: newStatus } : s
    ));

    try {
      await fetch(`/api/settlements/${encodeURIComponent(userName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus }),
      });
    } catch (e) {
      console.error('Error updating settlement status:', e);
    }
  };

  const deleteSettlement = async (id: string) => {
    if (confirm('이 정산 기록을 삭제하시겠습니까?')) {
      setSettlements(prev => prev.filter(s => s.id !== id));
      try {
        await fetch(`/api/settlements/${encodeURIComponent(userName)}?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      } catch (e) {
        console.error('Error deleting settlement:', e);
      }
    }
  };

  const totalPending = settlements.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.amount, 0);
  const totalCompleted = settlements.filter(s => s.status === 'completed').reduce((sum, s) => sum + s.amount, 0);

  const inputClass = "w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500";

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <div className="mb-8 md:mb-12 flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          <h2 className="text-2xl md:text-4xl font-black text-slate-900">정산 현황</h2>
          <p className="text-slate-400 text-sm md:text-base font-bold mt-1.5">인플루언서 정산을 관리합니다</p>
        </div>
        <button onClick={() => setShowAddModal(true)}
          className="px-5 py-2.5 bg-purple-600 text-white text-sm font-black rounded-xl hover:bg-purple-500 transition-all shadow-lg flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          정산 등록
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 md:gap-6 mb-8">
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">미지급 금액</p>
          <p className="text-xl md:text-3xl font-black text-amber-600">{totalPending.toLocaleString()}원</p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">지급 완료</p>
          <p className="text-xl md:text-3xl font-black text-teal-600">{totalCompleted.toLocaleString()}원</p>
        </div>
      </div>

      {/* Settlement List */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 md:p-6 border-b border-slate-100">
          <h3 className="font-black text-slate-900">정산 목록</h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 font-bold text-sm">불러오는 중...</p>
          </div>
        ) : settlements.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-slate-400 font-bold text-sm">등록된 정산 내역이 없습니다.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {[...settlements].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(s => (
              <div key={s.id} className="p-4 md:p-6 flex items-center gap-4 hover:bg-slate-50 transition-colors">
                <button onClick={() => toggleStatus(s.id)}
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${s.status === 'completed' ? 'bg-teal-500 border-teal-500' : 'border-slate-300 hover:border-purple-500'}`}>
                  {s.status === 'completed' && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`font-black text-sm ${s.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{s.title}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.status === 'completed' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}`}>
                      {s.status === 'completed' ? '지급완료' : '미지급'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-bold">@{s.influencer_username} · 정산일: {s.scheduled_date}</p>
                </div>
                <p className="font-black text-sm text-slate-900 whitespace-nowrap">{s.amount.toLocaleString()}원</p>
                <button onClick={() => deleteSettlement(s.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-slate-900 text-lg mb-4">정산 등록</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">인플루언서 아이디 *</label>
                <input type="text" value={newSettlement.influencer_username} onChange={e => setNewSettlement({ ...newSettlement, influencer_username: e.target.value })}
                  className={inputClass} placeholder="인플루언서 username" required />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">정산 제목 *</label>
                <input type="text" value={newSettlement.title} onChange={e => setNewSettlement({ ...newSettlement, title: e.target.value })}
                  className={inputClass} placeholder="예: 3월 광고 캠페인 정산" required />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">금액 (원) *</label>
                <input type="text" inputMode="numeric" value={formatNumber(newSettlement.amount)}
                  onChange={e => setNewSettlement({ ...newSettlement, amount: parseNumber(e.target.value) })}
                  className={inputClass} placeholder="500,000" required />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">정산 예정일 *</label>
                <input type="date" value={newSettlement.scheduled_date} onChange={e => setNewSettlement({ ...newSettlement, scheduled_date: e.target.value })}
                  className={inputClass} required />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">메모</label>
                <textarea value={newSettlement.memo} onChange={e => setNewSettlement({ ...newSettlement, memo: e.target.value })}
                  className={`${inputClass} resize-none h-20`} placeholder="정산 관련 메모 (선택사항)" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 rounded-xl font-black text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">취소</button>
                <button type="submit"
                  className="flex-1 py-3 rounded-xl font-black text-sm bg-purple-600 text-white hover:bg-purple-500 transition-colors">등록</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettlementManagement;
