import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface CollabRecord {
  id: string;
  title: string;
  company_name: string;
  type: string;
  fee: number;
  date: string;
  end_date?: string;
  start_date?: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  memo?: string;
}

interface Proposal {
  id: string;
  title: string;
  company_name: string;
  fee: number;
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
  start_date: string;
  end_date: string;
  description?: string;
}

interface CollabCalendarProps {
  userName: string;
}

const CollabCalendar: React.FC<CollabCalendarProps> = ({ userName }) => {
  const [collabs, setCollabs] = useState<CollabRecord[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'proposals' | 'collabs'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [newCollab, setNewCollab] = useState<Partial<CollabRecord>>({
    title: '', company_name: '', type: '광고', fee: 0, date: new Date().toISOString().split('T')[0],
    end_date: '', status: 'scheduled', memo: '',
  });

  const fetchData = useCallback(async () => {
    if (!userName) return;
    const normalizedUsername = userName.toLowerCase();

    try {
      const [collabsRes, proposalsRes] = await Promise.all([
        fetch(`/.netlify/functions/api-collabs?username=${encodeURIComponent(userName)}`),
        fetch(`/.netlify/functions/api-proposals?username=${encodeURIComponent(userName)}`),
      ]);

      if (collabsRes.ok) {
        const data = await collabsRes.json();
        setCollabs(data);
        localStorage.setItem(`picks_collabs_${normalizedUsername}`, JSON.stringify(data));
      }
      if (proposalsRes.ok) {
        const data = await proposalsRes.json();
        setProposals(data);
        localStorage.setItem(`picks_proposals_${normalizedUsername}`, JSON.stringify(data));
      }
      return;
    } catch (e) {
      console.error('Error fetching calendar data:', e);
    }

    const savedCollabs = localStorage.getItem(`picks_collabs_${normalizedUsername}`);
    if (savedCollabs) setCollabs(JSON.parse(savedCollabs));
    const savedProposals = localStorage.getItem(`picks_proposals_${normalizedUsername}`);
    if (savedProposals) setProposals(JSON.parse(savedProposals));
  }, [userName]);

  useEffect(() => {
    setIsLoading(true);
    fetchData().finally(() => setIsLoading(false));
  }, [fetchData]);

  const handleAddCollab = async (e: React.FormEvent) => {
    e.preventDefault();
    const record: CollabRecord = {
      id: Date.now().toString(),
      title: newCollab.title || '',
      company_name: newCollab.company_name || '',
      type: newCollab.type || '광고',
      fee: Number(newCollab.fee) || 0,
      date: newCollab.date || new Date().toISOString().split('T')[0],
      end_date: newCollab.end_date || newCollab.date,
      start_date: newCollab.date,
      status: (newCollab.status as CollabRecord['status']) || 'scheduled',
      memo: newCollab.memo,
    };

    setCollabs(prev => [...prev, record]);
    setShowAddModal(false);
    setNewCollab({ title: '', company_name: '', type: '광고', fee: 0, date: new Date().toISOString().split('T')[0], end_date: '', status: 'scheduled', memo: '' });

    try {
      await fetch(`/.netlify/functions/api-collabs?username=${encodeURIComponent(userName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
    } catch (e) {
      console.error('Error saving collab:', e);
    }
  };

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  const calendarDays = useMemo(() => {
    const days: (string | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push(dateStr);
    }
    return days;
  }, [year, month, firstDay, daysInMonth]);

  const proposalsByDate = useMemo(() => {
    const map: Record<string, Proposal[]> = {};
    proposals.forEach(p => {
      const start = new Date(p.start_date);
      const end = new Date(p.end_date);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = cursor.toISOString().split('T')[0];
        if (!map[key]) map[key] = [];
        map[key].push(p);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [proposals]);

  const collabsByDate = useMemo(() => {
    const map: Record<string, CollabRecord[]> = {};
    collabs.forEach(c => {
      const start = new Date(c.start_date || c.date);
      const end = new Date(c.end_date || c.date);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = cursor.toISOString().split('T')[0];
        if (!map[key]) map[key] = [];
        map[key].push(c);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [collabs]);

  const formatDate = (d: string) => {
    if (!d) return '-';
    const date = new Date(d);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };

  const formatCurrency = (n: number) => `${n.toLocaleString()}원`;

  const statusLabel = (s: string) => {
    switch (s) {
      case 'scheduled': return '예정';
      case 'in_progress': return '진행중';
      case 'completed': return '완료';
      case 'cancelled': return '취소';
      default: return s;
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case 'scheduled': return 'bg-amber-500';
      case 'in_progress': return 'bg-orange-500';
      case 'completed': return 'bg-teal-500';
      case 'cancelled': return 'bg-slate-400';
      default: return 'bg-purple-500';
    }
  };

  const proposalStatusColor = (s: string) => {
    switch (s) {
      case 'accepted': return 'bg-green-500';
      case 'completed': return 'bg-blue-500';
      default: return 'bg-purple-500';
    }
  };

  const totalCollabs = collabs.length;
  const completedCollabs = collabs.filter(c => c.status === 'completed').length;
  const totalRevenue = collabs.filter(c => c.status === 'completed').reduce((sum, c) => sum + c.fee, 0);

  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  const selectedDateProposals = selectedDate ? (proposalsByDate[selectedDate] || []) : [];
  const selectedDateCollabs = selectedDate ? (collabsByDate[selectedDate] || []) : [];

  if (isLoading) {
    return (
      <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <div className="mb-8 md:mb-12">
          <h2 className="text-2xl md:text-4xl font-black text-slate-900">협업 캘린더</h2>
          <p className="text-slate-400 text-sm md:text-base font-bold mt-1.5">협업 일정과 기록을 한눈에 관리합니다</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
          <div className="w-6 h-6 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 font-bold text-sm">불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <div className="mb-8 md:mb-12 flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          <h2 className="text-2xl md:text-4xl font-black text-slate-900">협업 캘린더</h2>
          <p className="text-slate-400 text-sm md:text-base font-bold mt-1.5">협업 일정과 기록을 한눈에 관리합니다</p>
        </div>
        <button onClick={() => setShowAddModal(true)}
          className="px-5 py-2.5 bg-purple-600 text-white text-sm font-black rounded-xl hover:bg-purple-500 transition-all shadow-lg flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
          </svg>
          협업 기록 추가
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3 md:gap-6 mb-8">
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">전체 협업</p>
          <p className="text-xl md:text-3xl font-black text-slate-900">{totalCollabs}</p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">완료</p>
          <p className="text-xl md:text-3xl font-black text-teal-600">{completedCollabs}</p>
        </div>
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm text-center">
          <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1">총 수익</p>
          <p className="text-lg md:text-2xl font-black text-purple-600">{formatCurrency(totalRevenue)}</p>
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-8 mb-8">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => setCurrentMonth(new Date(year, month - 1))} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h3 className="text-lg md:text-xl font-black text-slate-900">{year}년 {month + 1}월</h3>
          <button onClick={() => setCurrentMonth(new Date(year, month + 1))} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {dayNames.map((d, i) => (
            <div key={d} className={`text-center text-xs font-black py-2 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400'}`}>{d}</div>
          ))}
          {calendarDays.map((dateStr, idx) => {
            if (!dateStr) return <div key={`empty-${idx}`} className="p-2 min-h-[60px] md:min-h-[80px]" />;
            const day = parseInt(dateStr.split('-')[2]);
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const dayOfWeek = new Date(dateStr).getDay();
            const hasProposals = (proposalsByDate[dateStr] || []).length > 0;
            const hasCollabs = (collabsByDate[dateStr] || []).length > 0;

            return (
              <div key={dateStr} onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                className={`p-1 md:p-2 min-h-[60px] md:min-h-[80px] rounded-xl cursor-pointer transition-all border-2 ${isSelected ? 'border-purple-500 bg-purple-50' : 'border-transparent hover:bg-slate-50'}`}>
                <div className={`flex items-center justify-center w-7 h-7 rounded-full text-sm font-black ${isToday ? 'bg-purple-600 text-white' : dayOfWeek === 0 ? 'text-red-400' : dayOfWeek === 6 ? 'text-blue-400' : 'text-slate-700'}`}>
                  {day}
                </div>
                <div className="mt-1">
                  {hasProposals && <div className="bg-green-500 text-white text-[11px] font-bold py-0.5 px-1 rounded mb-0.5 truncate leading-tight">제안</div>}
                  {hasCollabs && <div className="bg-purple-500 text-white text-[11px] font-bold py-0.5 px-1 rounded truncate leading-tight">협업</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Date Detail */}
      {selectedDate && (
        <div className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-black text-slate-900 text-base">{formatDate(selectedDate)} 일정</h4>
          </div>
          <div className="flex gap-2 mb-4">
            {(['all', 'proposals', 'collabs'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${filter === f ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {f === 'all' ? '전체' : f === 'proposals' ? '제안' : '협업 기록'}
              </button>
            ))}
          </div>
          {(filter === 'all' || filter === 'proposals') && selectedDateProposals.length > 0 && (
            <div className="space-y-3 mb-4">
              {filter === 'all' && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">비즈니스 제안</p>}
              {selectedDateProposals.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                  <div className={`w-2 h-12 rounded-full shrink-0 ${proposalStatusColor(p.status)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                    <p className="text-xs font-bold text-slate-400">{p.company_name} · {formatCurrency(p.fee)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(filter === 'all' || filter === 'collabs') && selectedDateCollabs.length > 0 && (
            <div className="space-y-3">
              {filter === 'all' && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">협업 기록</p>}
              {selectedDateCollabs.map(c => (
                <div key={c.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                  <div className={`w-2 h-12 rounded-full shrink-0 ${statusColor(c.status)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm truncate">{c.title}</p>
                    <p className="text-xs font-bold text-slate-400">{c.company_name} · {formatCurrency(c.fee)} · {statusLabel(c.status)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {selectedDateProposals.length === 0 && selectedDateCollabs.length === 0 && (
            <p className="text-sm text-slate-400 font-bold text-center py-6">이 날짜에 등록된 일정이 없습니다.</p>
          )}
        </div>
      )}

      {/* Add Collab Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-slate-900 text-lg mb-4">협업 기록 추가</h3>
            <form onSubmit={handleAddCollab} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">협업 제목 *</label>
                <input type="text" value={newCollab.title} onChange={e => setNewCollab({ ...newCollab, title: e.target.value })}
                  className="w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500" placeholder="예: 5월 인스타 광고" required />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">브랜드/회사명 *</label>
                <input type="text" value={newCollab.company_name} onChange={e => setNewCollab({ ...newCollab, company_name: e.target.value })}
                  className="w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500" placeholder="브랜드명" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">유형</label>
                  <select value={newCollab.type} onChange={e => setNewCollab({ ...newCollab, type: e.target.value })}
                    className="w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500">
                    <option value="광고">광고</option>
                    <option value="커머스">커머스</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">금액 (원)</label>
                  <input type="number" value={newCollab.fee || ''} onChange={e => setNewCollab({ ...newCollab, fee: Number(e.target.value) })}
                    className="w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500" placeholder="500000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">시작일</label>
                  <input type="date" value={newCollab.date} onChange={e => setNewCollab({ ...newCollab, date: e.target.value })}
                    className="w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500" required />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">종료일</label>
                  <input type="date" value={newCollab.end_date} onChange={e => setNewCollab({ ...newCollab, end_date: e.target.value })}
                    className="w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">메모</label>
                <textarea value={newCollab.memo} onChange={e => setNewCollab({ ...newCollab, memo: e.target.value })}
                  className="w-full border border-slate-200 p-3 rounded-xl font-bold text-sm focus:outline-none focus:border-purple-500 resize-none h-20" placeholder="메모 (선택사항)" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="flex-1 py-3 rounded-xl font-black text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">취소</button>
                <button type="submit"
                  className="flex-1 py-3 rounded-xl font-black text-sm bg-purple-600 text-white hover:bg-purple-500 transition-colors">추가</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollabCalendar;
