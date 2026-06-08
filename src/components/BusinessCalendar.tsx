import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessProposal, CollabRecord } from '../types';
import { apiService } from '../services/apiService';
import { formatNumberWithCommas, stripCommas, formatKRW } from '../utils/formatters';
import UserSettlement from './UserSettlement';

interface BusinessCalendarProps {
  userName: string;
}

const COLLAB_CATEGORIES = ['광고', '커머스', '기타'] as const;
const COLLAB_STATUSES = [
  { value: 'scheduled', label: '예정' },
  { value: 'in_progress', label: '진행중' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
] as const;

const BusinessCalendar: React.FC<BusinessCalendarProps> = ({ userName }) => {
  const [proposals, setProposals] = useState<BusinessProposal[]>([]);
  const [collabRecords, setCollabRecords] = useState<CollabRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCollab, setEditingCollab] = useState<CollabRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'proposals' | 'collabs'>('all');
  const [jumpYear, setJumpYear] = useState('');
  const [jumpMonth, setJumpMonth] = useState('');
  // Top-level section of the 협업 현황 page: the calendar, the list of collab
  // deals (커머스/광고/기타), or the settlement (정산금) summary.
  const [topTab, setTopTab] = useState<'calendar' | 'collabs' | 'settlement'>('calendar');
  const [collabFilter, setCollabFilter] = useState<'전체' | '커머스' | '광고' | '기타'>('전체');

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    company_name: '',
    category: '기타' as CollabRecord['category'],
    date: '',
    end_date: '',
    fee: 0,
    status: 'scheduled' as CollabRecord['status'],
    memo: '',
  });

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const [proposalData, collabData] = await Promise.all([
        apiService.getProposals(userName),
        apiService.getCollabRecords(userName),
      ]);
      setProposals(proposalData);
      setCollabRecords(collabData);
      setLoading(false);
    };
    fetchData();
  }, [userName]);

  const handleComplete = async (proposalId: string) => {
    setUpdatingId(proposalId);
    const success = await apiService.updateProposalStatus(userName, proposalId, 'completed');
    if (success) {
      setProposals(prev =>
        prev.map(p => p.id === proposalId ? { ...p, status: 'completed', updated_at: new Date().toISOString() } : p)
      );
    }
    setUpdatingId(null);
  };

  const resetForm = () => {
    setFormData({
      title: '',
      company_name: '',
      category: '기타',
      date: selectedDate || '',
      end_date: '',
      fee: 0,
      status: 'scheduled',
      memo: '',
    });
    setEditingCollab(null);
  };

  const openAddForm = () => {
    resetForm();
    setFormData(prev => ({ ...prev, date: selectedDate || new Date().toISOString().split('T')[0] }));
    setShowAddForm(true);
  };

  const openEditForm = (collab: CollabRecord) => {
    setEditingCollab(collab);
    setFormData({
      title: collab.title,
      company_name: collab.company_name,
      category: collab.category,
      date: collab.date,
      end_date: collab.end_date || '',
      fee: collab.fee,
      status: collab.status,
      memo: collab.memo || '',
    });
    setShowAddForm(true);
  };

  const handleSaveCollab = async () => {
    if (!formData.title || !formData.date) return;
    setSaving(true);

    if (editingCollab) {
      const success = await apiService.updateCollabRecord(userName, editingCollab.id, formData);
      if (success) {
        setCollabRecords(prev =>
          prev.map(c => c.id === editingCollab.id ? { ...c, ...formData, updated_at: new Date().toISOString() } : c)
        );
      }
    } else {
      const record = await apiService.createCollabRecord(userName, formData);
      if (record) {
        setCollabRecords(prev => [...prev, record]);
      }
    }

    setSaving(false);
    setShowAddForm(false);
    resetForm();
  };

  const handleDeleteCollab = async (collabId: string) => {
    if (!confirm('이 협업 기록을 삭제하시겠습니까?')) return;
    const success = await apiService.deleteCollabRecord(userName, collabId);
    if (success) {
      setCollabRecords(prev => prev.filter(c => c.id !== collabId));
    }
  };

  const handleUpdateCollabStatus = async (collabId: string, status: CollabRecord['status']) => {
    setUpdatingId(collabId);
    const success = await apiService.updateCollabRecord(userName, collabId, { status });
    if (success) {
      setCollabRecords(prev =>
        prev.map(c => c.id === collabId ? { ...c, status, updated_at: new Date().toISOString() } : c)
      );
    }
    setUpdatingId(null);
  };

  const acceptedProposals = useMemo(
    () => proposals.filter(p => p.status === 'accepted' || p.status === 'completed'),
    [proposals]
  );

  // Calendar helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now.toISOString().split('T')[0]);
  };

  const handleJumpToDate = () => {
    const y = parseInt(jumpYear);
    const m = parseInt(jumpMonth);
    if (y >= 2020 && y <= 2099 && m >= 1 && m <= 12) {
      setCurrentDate(new Date(y, m - 1, 1));
      setJumpYear('');
      setJumpMonth('');
    }
  };

  const getDateStr = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Map proposal events per date
  const proposalEventsMap = useMemo(() => {
    const map: Record<string, BusinessProposal[]> = {};
    acceptedProposals.forEach(p => {
      if (!p.start_date || !p.end_date) return;
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
  }, [acceptedProposals]);

  // Map collab records per date
  const collabEventsMap = useMemo(() => {
    const map: Record<string, CollabRecord[]> = {};
    collabRecords.forEach(c => {
      if (!c.date) return;
      const start = new Date(c.date);
      const end = c.end_date ? new Date(c.end_date) : start;
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = cursor.toISOString().split('T')[0];
        if (!map[key]) map[key] = [];
        map[key].push(c);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [collabRecords]);

  // Stable ordering of proposal events
  const eventOrder = useMemo(() => {
    const order: Record<string, number> = {};
    const sorted = [...acceptedProposals].sort((a, b) => {
      const startDiff = new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
      if (startDiff !== 0) return startDiff;
      return new Date(b.end_date).getTime() - new Date(a.end_date).getTime();
    });
    sorted.forEach((p, i) => { order[p.id] = i; });
    return order;
  }, [acceptedProposals]);

  const getEventPosition = (startDate: string, endDate: string, dateStr: string) => {
    const startStr = new Date(startDate).toISOString().split('T')[0];
    const endStr = new Date(endDate).toISOString().split('T')[0];
    const dayOfWeek = new Date(dateStr).getDay();
    const isFirst = dateStr === startStr || dayOfWeek === 0;
    const isLast = dateStr === endStr || dayOfWeek === 6;
    return { isFirst, isLast };
  };

  const selectedProposalEvents = selectedDate ? (proposalEventsMap[selectedDate] || []) : [];
  const selectedCollabEvents = selectedDate ? (collabEventsMap[selectedDate] || []) : [];

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const getProposalStatusColor = (status: string) => {
    switch (status) {
      case 'accepted': return 'bg-green-500';
      case 'completed': return 'bg-blue-500';
      default: return 'bg-blue-500';
    }
  };

  const getCollabStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-amber-500';
      case 'in_progress': return 'bg-orange-500';
      case 'completed': return 'bg-teal-500';
      case 'cancelled': return 'bg-slate-400';
      default: return 'bg-blue-500';
    }
  };

  const getCollabStatusLabel = (status: string) => {
    switch (status) {
      case 'scheduled': return '예정';
      case 'in_progress': return '진행중';
      case 'completed': return '완료';
      case 'cancelled': return '취소';
      default: return status;
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case '광고': return 'bg-pink-100 text-pink-700';
      case '커머스': return 'bg-indigo-100 text-indigo-700';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  // Stats
  const totalCollabs = collabRecords.length;
  const completedCollabs = collabRecords.filter(c => c.status === 'completed').length;
  const inProgressCollabs = collabRecords.filter(c => c.status === 'in_progress').length;
  const scheduledCollabs = collabRecords.filter(c => c.status === 'scheduled').length;
  const totalRevenue = collabRecords.filter(c => c.status === 'completed').reduce((sum, c) => sum + c.fee, 0);

  // Upcoming deadlines (proposals + collabs combined)
  const upcomingDeadlines = useMemo(() => {
    const proposalItems = acceptedProposals
      .filter(p => p.status === 'accepted' && new Date(p.end_date) >= new Date())
      .map(p => ({ id: p.id, title: p.title, company: p.company_name, endDate: p.end_date, type: 'proposal' as const }));
    const collabItems = collabRecords
      .filter(c => (c.status === 'scheduled' || c.status === 'in_progress') && new Date(c.end_date || c.date) >= new Date())
      .map(c => ({ id: c.id, title: c.title, company: c.company_name, endDate: c.end_date || c.date, type: 'collab' as const }));
    return [...proposalItems, ...collabItems]
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
      .slice(0, 6);
  }, [acceptedProposals, collabRecords]);

  const getDaysLeft = (endDate: string) => {
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return '마감됨';
    if (diff === 0) return 'D-Day';
    return `D-${diff}`;
  };

  // All collabs sorted for history view
  const allCollabsSorted = useMemo(() => {
    return [...collabRecords].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [collabRecords]);

  // Collab deals filtered by category for the 협업한 건들 tab.
  const filteredCollabs = useMemo(() => {
    if (collabFilter === '전체') return allCollabsSorted;
    return allCollabsSorted.filter(c => c.category === collabFilter);
  }, [allCollabsSorted, collabFilter]);

  const commerceCount = useMemo(() => collabRecords.filter(c => c.category === '커머스').length, [collabRecords]);
  const adCount = useMemo(() => collabRecords.filter(c => c.category === '광고').length, [collabRecords]);

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="p-4 md:px-14 md:py-6 w-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-4 md:mb-6 flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          <h2 className="text-2xl md:text-4xl font-black text-slate-900">협업 현황</h2>
          <p className="text-slate-400 text-sm md:text-base font-bold mt-1.5">
            협업 캘린더, 협업한 건들(커머스·광고), 정산금을 한곳에서 관리합니다
          </p>
        </div>
        {topTab !== 'settlement' && (
          <button
            onClick={openAddForm}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-black rounded-xl hover:bg-blue-700 transition-all shrink-0 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            협업 기록 추가
          </button>
        )}
      </div>

      {/* Top section tabs */}
      <div className="flex gap-2 mb-5 md:mb-6 overflow-x-auto scrollbar-hide">
        {([
          { id: 'calendar', label: '협업 캘린더', icon: '📅' },
          { id: 'collabs', label: '협업한 건들', icon: '🤝' },
          { id: 'settlement', label: '정산금', icon: '💰' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTopTab(t.id)}
            className={`px-4 md:px-5 py-2.5 text-sm font-black rounded-xl transition-all shrink-0 flex items-center gap-1.5 ${
              topTab === t.id ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {topTab === 'calendar' && (
      <>
      {/* On wide screens the calendar sits beside its stats/legend sidebar; on
          narrow screens they stack vertically. */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Calendar Grid */}
        <div className="flex-1">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Month Navigation + Date Jump */}
            <div className="flex flex-col gap-3 p-4 md:p-5 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <button
                  onClick={prevMonth}
                  className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all"
                >
                  <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h3 className="text-xl md:text-2xl font-black text-slate-900">
                  {year}년 {month + 1}월
                </h3>
                <button
                  onClick={nextMonth}
                  className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all"
                >
                  <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              {/* Quick Nav */}
              <div className="flex items-center gap-2 justify-center flex-wrap">
                <button
                  onClick={goToToday}
                  className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all"
                >
                  오늘
                </button>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    placeholder="년도"
                    value={jumpYear}
                    onChange={e => setJumpYear(e.target.value)}
                    className="w-20 px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                    min={2020}
                    max={2099}
                  />
                  <input
                    type="number"
                    placeholder="월"
                    value={jumpMonth}
                    onChange={e => setJumpMonth(e.target.value)}
                    className="w-14 px-2 py-1.5 text-xs border border-slate-200 rounded-lg text-center focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                    min={1}
                    max={12}
                  />
                  <button
                    onClick={handleJumpToDate}
                    className="px-3 py-1.5 text-xs font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
                  >
                    이동
                  </button>
                </div>
              </div>
            </div>

            {/* Weekday Headers */}
            <div className="grid grid-cols-7">
              {weekDays.map(day => (
                <div key={day} className="p-2.5 text-center text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Days — on desktop the grid is enlarged to fill nearly the full viewport
                height so the month cells are big; this also pushes the 협업 히스토리 list below the
                fold so it only appears on scroll. Rows divide the space equally. */}
            <div className="grid grid-cols-7 md:auto-rows-fr md:h-[calc(100vh-170px)]">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="p-2 md:p-3 min-h-[80px] md:min-h-0 border-b border-r border-slate-50" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = getDateStr(day);
                const pEvents = proposalEventsMap[dateStr] || [];
                const cEvents = collabEventsMap[dateStr] || [];
                const totalEvents = pEvents.length + cEvents.length;
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                const dayOfWeek = (firstDay + i) % 7;

                return (
                  <div
                    key={day}
                    onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                    className={`p-2 md:p-3 min-h-[80px] md:min-h-0 overflow-hidden border-b border-r border-slate-50 cursor-pointer transition-all hover:bg-blue-50/50 ${
                      isSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-black ${
                      isToday
                        ? 'bg-blue-600 text-white'
                        : dayOfWeek === 0
                        ? 'text-red-400'
                        : dayOfWeek === 6
                        ? 'text-blue-400'
                        : 'text-slate-700'
                    }`}>
                      {day}
                    </span>
                    <div className="mt-1.5">
                      {/* Proposal events */}
                      {pEvents
                        .sort((a, b) => (eventOrder[a.id] ?? 0) - (eventOrder[b.id] ?? 0))
                        .slice(0, 1)
                        .map(ev => {
                          const { isFirst, isLast } = getEventPosition(ev.start_date, ev.end_date, dateStr);
                          return (
                            <div
                              key={ev.id}
                              className={`${getProposalStatusColor(ev.status)} text-white text-[11px] md:text-xs font-bold py-1 leading-tight overflow-hidden whitespace-nowrap mb-[1px] ${
                                isFirst && isLast ? 'rounded px-1.5 mx-0' :
                                isFirst ? 'rounded-l pl-1.5 -mr-[13px] md:-mr-[13px]' :
                                isLast ? 'rounded-r pr-1.5 -ml-[13px] md:-ml-[13px]' :
                                '-mx-[13px] md:-mx-[13px]'
                              }`}
                            >
                              {isFirst ? ev.title : '\u00A0'}
                            </div>
                          );
                        })}
                      {/* Collab events */}
                      {cEvents.slice(0, 1).map(ev => {
                        const endDate = ev.end_date || ev.date;
                        const { isFirst, isLast } = getEventPosition(ev.date, endDate, dateStr);
                        return (
                          <div
                            key={ev.id}
                            className={`${getCollabStatusColor(ev.status)} text-white text-[11px] md:text-xs font-bold py-1 leading-tight overflow-hidden whitespace-nowrap mb-[1px] ${
                              isFirst && isLast ? 'rounded px-1.5 mx-0' :
                              isFirst ? 'rounded-l pl-1.5 -mr-[13px] md:-mr-[13px]' :
                              isLast ? 'rounded-r pr-1.5 -ml-[13px] md:-ml-[13px]' :
                              '-mx-[13px] md:-mx-[13px]'
                            }`}
                          >
                            {isFirst ? ev.title : '\u00A0'}
                          </div>
                        );
                      })}
                      {totalEvents > 2 && (
                        <p className="text-[11px] font-bold text-slate-400 px-1">+{totalEvents - 2}건</p>
                      )}
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
                <h4 className="font-black text-slate-900 text-base">
                  {formatDate(selectedDate)} 일정
                </h4>
                <button
                  onClick={() => {
                    setFormData(prev => ({ ...prev, date: selectedDate }));
                    openAddForm();
                  }}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  이 날짜에 추가
                </button>
              </div>

              {/* Tab filter */}
              <div className="flex gap-2 mb-4">
                {(['all', 'proposals', 'collabs'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {tab === 'all' ? '전체' : tab === 'proposals' ? '제안' : '협업 기록'}
                  </button>
                ))}
              </div>

              {(activeTab === 'all' || activeTab === 'proposals') && selectedProposalEvents.length > 0 && (
                <div className="space-y-3 mb-4">
                  {activeTab === 'all' && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">비즈니스 제안</p>}
                  {selectedProposalEvents.map(ev => (
                    <div key={ev.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                      <div className={`w-2 h-12 rounded-full shrink-0 ${getProposalStatusColor(ev.status)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-900 text-sm truncate">{ev.title}</p>
                        <p className="text-xs font-bold text-slate-400">{ev.company_name} · {formatFee(ev.fee)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-xs font-black ${ev.status === 'completed' ? 'text-blue-500' : 'text-green-500'}`}>
                          {ev.status === 'completed' ? '완료' : '진행중'}
                        </span>
                      </div>
                      {ev.status === 'accepted' && (
                        <button
                          onClick={() => handleComplete(ev.id)}
                          disabled={updatingId === ev.id}
                          className="px-4 py-2 bg-blue-500 text-white text-xs font-black rounded-lg hover:bg-blue-600 transition-all disabled:opacity-60 shrink-0"
                        >
                          완료 처리
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(activeTab === 'all' || activeTab === 'collabs') && selectedCollabEvents.length > 0 && (
                <div className="space-y-3">
                  {activeTab === 'all' && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">협업 기록</p>}
                  {selectedCollabEvents.map(ev => (
                    <div key={ev.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                      <div className={`w-2 h-12 rounded-full shrink-0 ${getCollabStatusColor(ev.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-black text-slate-900 text-sm truncate">{ev.title}</p>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryBadge(ev.category)}`}>
                            {ev.category}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-400">
                          {ev.company_name ? `${ev.company_name} · ` : ''}{formatFee(ev.fee)}
                          {ev.end_date && ` · ${formatDate(ev.date)} ~ ${formatDate(ev.end_date)}`}
                        </p>
                        {ev.memo && <p className="text-xs text-slate-400 mt-1 truncate">{ev.memo}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs font-black ${
                          ev.status === 'completed' ? 'text-teal-500' :
                          ev.status === 'in_progress' ? 'text-orange-500' :
                          ev.status === 'cancelled' ? 'text-slate-400' :
                          'text-amber-500'
                        }`}>
                          {getCollabStatusLabel(ev.status)}
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditForm(ev); }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 transition-all"
                            title="수정"
                          >
                            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteCollab(ev.id); }}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 transition-all"
                            title="삭제"
                          >
                            <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {((activeTab === 'all' && selectedProposalEvents.length === 0 && selectedCollabEvents.length === 0) ||
                (activeTab === 'proposals' && selectedProposalEvents.length === 0) ||
                (activeTab === 'collabs' && selectedCollabEvents.length === 0)) && (
                <p className="text-slate-400 text-sm font-bold text-center py-4">이 날짜에 해당하는 일정이 없습니다.</p>
              )}
            </div>
          )}

          {/* Collab History List */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">협업 히스토리</h4>
            {loading ? (
              <p className="text-slate-400 text-sm font-bold text-center py-8">로딩 중...</p>
            ) : allCollabsSorted.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-400 text-sm font-bold">아직 기록된 협업이 없습니다.</p>
                <p className="text-slate-300 text-xs mt-1">상단의 "협업 기록 추가" 버튼으로 첫 기록을 남겨보세요.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allCollabsSorted.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-all cursor-pointer group"
                    onClick={() => {
                      const d = new Date(c.date);
                      setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1));
                      setSelectedDate(c.date);
                    }}
                  >
                    <div className={`w-2 h-8 rounded-full shrink-0 ${getCollabStatusColor(c.status)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-slate-900 text-sm truncate">{c.title}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryBadge(c.category)}`}>
                          {c.category}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-400">
                        {formatDate(c.date)}{c.end_date ? ` ~ ${formatDate(c.end_date)}` : ''} · {c.company_name || '미지정'} · {formatFee(c.fee)}
                      </p>
                    </div>
                    <span className={`text-xs font-black shrink-0 ${
                      c.status === 'completed' ? 'text-teal-500' :
                      c.status === 'in_progress' ? 'text-orange-500' :
                      c.status === 'cancelled' ? 'text-slate-400' :
                      'text-amber-500'
                    }`}>
                      {getCollabStatusLabel(c.status)}
                    </span>
                    {c.status !== 'completed' && c.status !== 'cancelled' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateCollabStatus(c.id, c.status === 'scheduled' ? 'in_progress' : 'completed');
                        }}
                        disabled={updatingId === c.id}
                        className="px-3 py-1.5 text-[11px] font-bold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-40 shrink-0"
                      >
                        {c.status === 'scheduled' ? '진행 시작' : '완료 처리'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="xl:w-96 shrink-0 space-y-6">
          {/* Stats */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">일정 현황</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-amber-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-amber-600">{scheduledCollabs}</p>
                <p className="text-[10px] md:text-xs font-bold text-amber-500">예정</p>
              </div>
              <div className="bg-orange-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-orange-600">{inProgressCollabs + acceptedProposals.filter(p => p.status === 'accepted').length}</p>
                <p className="text-[10px] md:text-xs font-bold text-orange-500">진행중</p>
              </div>
              <div className="bg-teal-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-teal-600">{completedCollabs + acceptedProposals.filter(p => p.status === 'completed').length}</p>
                <p className="text-[10px] md:text-xs font-bold text-teal-500">완료됨</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-blue-600">{totalCollabs}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">총 협업</p>
              </div>
            </div>
            {totalRevenue > 0 && (
              <div className="mt-3 bg-gradient-to-r from-blue-50 to-pink-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-lg md:text-xl font-black text-blue-700">{formatFee(totalRevenue)}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">완료 협업 총 수익</p>
              </div>
            )}
          </div>

          {/* Upcoming Deadlines */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">다가오는 마감</h4>
            {loading ? (
              <p className="text-slate-400 text-sm font-bold text-center py-4">로딩 중...</p>
            ) : upcomingDeadlines.length === 0 ? (
              <p className="text-slate-400 text-sm font-bold text-center py-4">예정된 마감이 없습니다</p>
            ) : (
              <div className="space-y-3">
                {upcomingDeadlines.map(p => {
                  const daysLeft = getDaysLeft(p.endDate);
                  const isUrgent = daysLeft === 'D-Day' || (daysLeft.startsWith('D-') && parseInt(daysLeft.slice(2)) <= 3);
                  return (
                    <div key={p.id} className={`p-3 rounded-xl border ${isUrgent ? 'border-red-200 bg-red-50/50' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-black ${isUrgent ? 'text-red-500' : 'text-slate-400'}`}>
                            {daysLeft}
                          </span>
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${
                            p.type === 'proposal' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'
                          }`}>
                            {p.type === 'proposal' ? '제안' : '협업'}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-slate-300">~{formatDate(p.endDate)}</span>
                      </div>
                      <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                      <p className="text-xs font-bold text-slate-400 mt-0.5">{p.company}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">범례</h4>
            <div className="space-y-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">제안</p>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                <span className="text-sm font-bold text-slate-600">진행중 (수락됨)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-blue-500" />
                <span className="text-sm font-bold text-slate-600">완료됨</span>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">협업 기록</p>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-amber-500" />
                <span className="text-sm font-bold text-slate-600">예정</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-orange-500" />
                <span className="text-sm font-bold text-slate-600">진행중</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-teal-500" />
                <span className="text-sm font-bold text-slate-600">완료됨</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-slate-400" />
                <span className="text-sm font-bold text-slate-600">취소</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {topTab === 'collabs' && (
        <div className="space-y-5">
          {/* Category summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-indigo-50 rounded-2xl p-4 text-center">
              <p className="text-xl md:text-2xl font-black text-indigo-600">{commerceCount}</p>
              <p className="text-[10px] md:text-xs font-bold text-indigo-500">커머스</p>
            </div>
            <div className="bg-pink-50 rounded-2xl p-4 text-center">
              <p className="text-xl md:text-2xl font-black text-pink-600">{adCount}</p>
              <p className="text-[10px] md:text-xs font-bold text-pink-500">광고</p>
            </div>
            <div className="bg-blue-50 rounded-2xl p-4 text-center">
              <p className="text-xl md:text-2xl font-black text-blue-600">{totalCollabs}</p>
              <p className="text-[10px] md:text-xs font-bold text-blue-500">총 협업</p>
            </div>
            <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-4 text-center">
              <p className="text-base md:text-xl font-black text-teal-700">{formatFee(totalRevenue)}</p>
              <p className="text-[10px] md:text-xs font-bold text-teal-500">완료 수익</p>
            </div>
          </div>

          {/* Category filter */}
          <div className="flex gap-2 flex-wrap">
            {(['전체', '커머스', '광고', '기타'] as const).map(f => (
              <button
                key={f}
                onClick={() => setCollabFilter(f)}
                className={`px-4 py-2 text-xs font-black rounded-lg transition-all ${
                  collabFilter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Collab list */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
            {loading ? (
              <p className="text-slate-400 text-sm font-bold text-center py-8">로딩 중...</p>
            ) : filteredCollabs.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-slate-400 text-sm font-bold">
                  {collabFilter === '전체' ? '아직 기록된 협업이 없습니다.' : `${collabFilter} 협업 기록이 없습니다.`}
                </p>
                <p className="text-slate-300 text-xs mt-1">상단의 "협업 기록 추가" 버튼으로 기록을 남겨보세요.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCollabs.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-all group"
                  >
                    <div className={`w-2 h-10 rounded-full shrink-0 ${getCollabStatusColor(c.status)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-slate-900 text-sm truncate">{c.title}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getCategoryBadge(c.category)}`}>
                          {c.category}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-400">
                        {formatDate(c.date)}{c.end_date ? ` ~ ${formatDate(c.end_date)}` : ''} · {c.company_name || '미지정'} · {formatFee(c.fee)}
                      </p>
                      {c.memo && <p className="text-xs text-slate-400 mt-0.5 truncate">{c.memo}</p>}
                    </div>
                    <span className={`text-xs font-black shrink-0 ${
                      c.status === 'completed' ? 'text-teal-500' :
                      c.status === 'in_progress' ? 'text-orange-500' :
                      c.status === 'cancelled' ? 'text-slate-400' :
                      'text-amber-500'
                    }`}>
                      {getCollabStatusLabel(c.status)}
                    </span>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditForm(c); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 transition-all"
                        title="수정"
                      >
                        <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteCollab(c.id); }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 transition-all"
                        title="삭제"
                      >
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {topTab === 'settlement' && (
        <UserSettlement userName={userName} embedded />
      )}

      {/* Add/Edit Collab Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">
                {editingCollab ? '협업 기록 수정' : '협업 기록 추가'}
              </h3>
              <p className="text-xs font-bold text-slate-400 mt-1">
                협업 내용을 입력하고 캘린더에서 관리하세요
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">제목 *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="예: 브랜드A 인스타 콘텐츠 협업"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">업체명</label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={e => setFormData(prev => ({ ...prev, company_name: e.target.value }))}
                  placeholder="협업 업체명"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">카테고리</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData(prev => ({ ...prev, category: e.target.value as CollabRecord['category'] }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none bg-white"
                  >
                    {COLLAB_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">상태</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as CollabRecord['status'] }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none bg-white"
                  >
                    {COLLAB_STATUSES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">시작일 *</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">종료일</label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={e => setFormData(prev => ({ ...prev, end_date: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">금액 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formData.fee ? formatNumberWithCommas(formData.fee) : ''}
                  onChange={e => setFormData(prev => ({ ...prev, fee: parseInt(stripCommas(e.target.value)) || 0 }))}
                  placeholder="0"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-600 mb-1.5">메모</label>
                <textarea
                  value={formData.memo}
                  onChange={e => setFormData(prev => ({ ...prev, memo: e.target.value }))}
                  placeholder="협업 관련 메모 (선택사항)"
                  rows={3}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-300 focus:border-blue-400 outline-none resize-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-100 flex gap-3 justify-end">
              <button
                onClick={() => { setShowAddForm(false); resetForm(); }}
                className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-all"
              >
                취소
              </button>
              <button
                onClick={handleSaveCollab}
                disabled={saving || !formData.title || !formData.date}
                className="px-5 py-2.5 text-sm font-black text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50"
              >
                {saving ? '저장 중...' : editingCollab ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessCalendar;
