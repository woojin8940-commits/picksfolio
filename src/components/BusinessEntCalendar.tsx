import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessProposal } from '../types';
import { formatKRW } from '../utils/formatters';
import BusinessSettlement from './BusinessSettlement';

interface BusinessEntCalendarProps {
  businessUsername: string;
  companyName: string;
}

const BusinessEntCalendar: React.FC<BusinessEntCalendarProps> = ({ businessUsername, companyName }) => {
  const cleanUsername = businessUsername.replace(/^biz\//, '');
  const cacheKey = `picks_biz_calendar_${cleanUsername.toLowerCase()}`;

  // Top section tabs — mirrors the influencer's 협업 현황: the collaboration
  // calendar, the list of collaboration deals (협업 내역), and the settlement
  // (정산금) summary, all in one place.
  const [topTab, setTopTab] = useState<'calendar' | 'collabs' | 'settlement'>('calendar');

  const cachedProposals = (() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  })();

  const [proposals, setProposals] = useState<BusinessProposal[]>(cachedProposals);
  const [loading, setLoading] = useState(cachedProposals.length === 0);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    const fetchProposals = async () => {
      try {
        const res = await fetch(`/api/business-proposals/${encodeURIComponent(cleanUsername)}`);
        if (res.ok) {
          const data = await res.json();
          const fresh = (data.proposals || []).filter((p: BusinessProposal) => p.status === 'accepted' || p.status === 'completed');
          setProposals(fresh);
          try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {}
        }
      } catch (e) {
        console.error('Failed to fetch proposals:', e);
      }
      setLoading(false);
    };
    fetchProposals();
  }, [businessUsername]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const today = new Date().toISOString().split('T')[0];

  // Keep the calendar status in sync with the dates: an accepted proposal whose
  // end date has already passed (or which is already settled/completed) is shown
  // as 완료됨 instead of lingering as 진행중. Dates are compared as YYYY-MM-DD.
  const isCollabDone = (p: BusinessProposal): boolean => {
    if (p.status === 'completed') return true;
    const end = (p.end_date || '').split('T')[0];
    return !!end && end < today;
  };

  const getDateStr = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const calendarDays = useMemo(() => {
    const days: { day: number; proposals: BusinessProposal[] }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = getDateStr(d);
      const dayProposals = proposals.filter(p => {
        const start = p.start_date?.split('T')[0] || '';
        const end = p.end_date?.split('T')[0] || '';
        return start <= dateStr && end >= dateStr;
      });
      days.push({ day: d, proposals: dayProposals });
    }
    return days;
  }, [proposals, year, month, daysInMonth]);

  const eventOrder = useMemo(() => {
    const order: Record<string, number> = {};
    const sorted = [...proposals].sort((a, b) => {
      const startDiff = new Date(a.start_date).getTime() - new Date(b.start_date).getTime();
      if (startDiff !== 0) return startDiff;
      return new Date(b.end_date).getTime() - new Date(a.end_date).getTime();
    });
    sorted.forEach((p, i) => { order[p.id] = i; });
    return order;
  }, [proposals]);

  const getEventPosition = (startDate: string, endDate: string, dateStr: string) => {
    const startStr = (startDate || '').split('T')[0];
    const endStr = (endDate || '').split('T')[0];
    const dayOfWeek = new Date(dateStr).getDay();
    const isFirst = dateStr === startStr || dayOfWeek === 0;
    const isLast = dateStr === endStr || dayOfWeek === 6;
    return { isFirst, isLast };
  };

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now.toISOString().split('T')[0]);
  };

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  // Group accepted proposals by influencer for the list view
  const groupedByInfluencer = useMemo(() => {
    const groups: Record<string, BusinessProposal[]> = {};
    proposals.forEach(p => {
      if (!groups[p.influencer_username]) groups[p.influencer_username] = [];
      groups[p.influencer_username].push(p);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [proposals]);

  // Stats
  const acceptedCount = proposals.filter(p => !isCollabDone(p)).length;
  const completedCount = proposals.filter(p => isCollabDone(p)).length;
  const totalInfluencers = new Set(proposals.map(p => p.influencer_username)).size;
  const totalRevenue = proposals.filter(p => isCollabDone(p)).reduce((sum, p) => sum + (p.fee || 0), 0);

  // Upcoming deadlines
  const upcomingDeadlines = useMemo(() => {
    return proposals
      .filter(p => !isCollabDone(p) && new Date(p.end_date) >= new Date())
      .map(p => ({ id: p.id, title: p.title, influencer: p.influencer_username, endDate: p.end_date, fee: p.fee }))
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
      .slice(0, 6);
  }, [proposals]);

  const getDaysLeft = (endDate: string) => {
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return '마감됨';
    if (diff === 0) return 'D-Day';
    return `D-${diff}`;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  // Selected date proposals
  const selectedDateProposals = useMemo(() => {
    if (!selectedDate) return [];
    return proposals.filter(p => {
      const start = p.start_date?.split('T')[0] || '';
      const end = p.end_date?.split('T')[0] || '';
      return start <= selectedDate && end >= selectedDate;
    });
  }, [proposals, selectedDate]);

  if (loading) {
    return (
      <div className="p-14 text-center">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400 font-bold text-sm">캘린더 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <div className="mb-8 md:mb-12 flex flex-col md:flex-row md:items-end gap-4 justify-between">
        <div>
          <h2 className="text-2xl md:text-4xl font-black text-slate-900">협업 현황</h2>
          <p className="text-slate-400 text-sm md:text-base font-bold mt-1.5">
            협업 캘린더, 협업 내역, 정산금을 한곳에서 관리합니다
          </p>
        </div>
      </div>

      {/* Top section tabs */}
      <div className="flex gap-2 mb-5 md:mb-6 overflow-x-auto scrollbar-hide">
        {([
          { id: 'calendar', label: '협업 캘린더', icon: '📅' },
          { id: 'collabs', label: '협업 내역', icon: '🤝' },
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
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Calendar Grid */}
        <div className="flex-1">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            {/* Month Navigation */}
            <div className="flex flex-col gap-3 p-5 md:p-8 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <button onClick={prevMonth} className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all">
                  <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h3 className="text-xl md:text-2xl font-black text-slate-900">{year}년 {month + 1}월</h3>
                <button onClick={nextMonth} className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all">
                  <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 justify-center">
                <button onClick={goToToday} className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all">
                  오늘
                </button>
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

            {/* Calendar Days */}
            <div className="grid grid-cols-7">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} className="p-2 md:p-3 min-h-[100px] md:min-h-[130px] border-b border-r border-slate-50" />
              ))}

              {calendarDays.map(({ day, proposals: dayProposals }) => {
                const dateStr = getDateStr(day);
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                const dayOfWeek = (firstDayOfWeek + day - 1) % 7;

                return (
                  <div
                    key={day}
                    onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                    className={`p-2 md:p-3 min-h-[100px] md:min-h-[130px] border-b border-r border-slate-50 cursor-pointer transition-all hover:bg-blue-50/50 ${
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
                      {dayProposals
                        .sort((a, b) => (eventOrder[a.id] ?? 0) - (eventOrder[b.id] ?? 0))
                        .slice(0, 2)
                        .map(p => {
                          const { isFirst, isLast } = getEventPosition(p.start_date, p.end_date, dateStr);
                          const colorClass = isCollabDone(p) ? 'bg-blue-500' : 'bg-green-500';
                          return (
                            <div
                              key={p.id}
                              className={`relative z-10 ${colorClass} text-white text-[9px] md:text-[11px] font-bold py-0.5 leading-tight overflow-hidden whitespace-nowrap mb-[2px] ${
                                isFirst && isLast ? 'rounded px-1.5 mx-0' :
                                isFirst ? 'rounded-l pl-1.5 -mr-[9px] md:-mr-[13px]' :
                                isLast ? 'rounded-r pr-1.5 -ml-[9px] md:-ml-[13px]' :
                                '-mx-[9px] md:-mx-[13px]'
                              }`}
                            >
                              {isFirst ? `@${p.influencer_username}` : ' '}
                            </div>
                          );
                        })}
                      {dayProposals.length > 2 && (
                        <p className="text-[9px] font-black text-blue-500 mt-0.5">+{dayProposals.length - 2}</p>
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
              <h4 className="font-black text-slate-900 text-base mb-4">
                {formatDate(selectedDate)} 일정
              </h4>
              {selectedDateProposals.length === 0 ? (
                <p className="text-slate-400 text-sm font-bold text-center py-4">이 날짜에 해당하는 일정이 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {selectedDateProposals.map(p => (
                    <div key={p.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                      <div className={`w-2 h-12 rounded-full shrink-0 ${isCollabDone(p) ? 'bg-blue-500' : 'bg-green-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                        <p className="text-xs font-bold text-slate-400">@{p.influencer_username} · {formatFee(p.fee)}</p>
                        <p className="text-[10px] font-bold text-slate-300 mt-0.5">{formatDate(p.start_date)} ~ {formatDate(p.end_date)}</p>
                      </div>
                      <span className={`text-xs font-black shrink-0 ${isCollabDone(p) ? 'text-blue-500' : 'text-green-500'}`}>
                        {isCollabDone(p) ? '완료' : '진행중'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Influencer Schedule List */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">수락된 인플루언서 일정</h4>
            {groupedByInfluencer.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">📅</div>
                <h4 className="font-black text-slate-900 text-base mb-1">수락된 협업이 없습니다</h4>
                <p className="text-slate-400 text-sm font-medium">인플루언서가 제안을 수락하면 여기에 일정이 표시됩니다.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedByInfluencer.map(([influencer, infProposals]) => (
                  <div key={influencer} className="p-4 md:p-5 rounded-xl hover:bg-slate-50 transition-all">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                        <span className="text-blue-600 font-black text-sm">@</span>
                      </div>
                      <div>
                        <p className="font-black text-slate-900 text-sm">{influencer}</p>
                        <p className="text-slate-400 text-[10px] font-bold">{infProposals.length}개 협업 진행중</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {infProposals.map(p => (
                        <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
                          <div>
                            <p className="font-bold text-slate-800 text-xs">{p.title}</p>
                            <p className="text-slate-400 text-[10px] font-bold">{formatDate(p.start_date)} ~ {formatDate(p.end_date)}</p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black ${
                            isCollabDone(p) ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {isCollabDone(p) ? '완료' : '진행중'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="xl:w-96 shrink-0 space-y-6">
          {/* Stats */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">일정 현황</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-green-600">{acceptedCount}</p>
                <p className="text-[10px] md:text-xs font-bold text-green-500">진행중</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-blue-600">{completedCount}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">완료됨</p>
              </div>
              <div className="bg-indigo-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-indigo-600">{totalInfluencers}</p>
                <p className="text-[10px] md:text-xs font-bold text-indigo-500">인플루언서</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-xl md:text-2xl font-black text-blue-600">{proposals.length}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">총 협업</p>
              </div>
            </div>
            {totalRevenue > 0 && (
              <div className="mt-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-lg md:text-xl font-black text-blue-700">{formatFee(totalRevenue)}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">완료 협업 총 비용</p>
              </div>
            )}
          </div>

          {/* Upcoming Deadlines */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">다가오는 마감</h4>
            {upcomingDeadlines.length === 0 ? (
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
                        </div>
                        <span className="text-[11px] font-bold text-slate-300">~{formatDate(p.endDate)}</span>
                      </div>
                      <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                      <p className="text-xs font-bold text-slate-400 mt-0.5">@{p.influencer} · {formatFee(p.fee)}</p>
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
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                <span className="text-sm font-bold text-slate-600">진행중 (수락됨)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-blue-500" />
                <span className="text-sm font-bold text-slate-600">완료됨</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {topTab === 'collabs' && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-green-50 rounded-2xl p-4 text-center">
              <p className="text-xl md:text-2xl font-black text-green-600">{acceptedCount}</p>
              <p className="text-[10px] md:text-xs font-bold text-green-500">진행중</p>
            </div>
            <div className="bg-blue-50 rounded-2xl p-4 text-center">
              <p className="text-xl md:text-2xl font-black text-blue-600">{completedCount}</p>
              <p className="text-[10px] md:text-xs font-bold text-blue-500">완료됨</p>
            </div>
            <div className="bg-indigo-50 rounded-2xl p-4 text-center">
              <p className="text-xl md:text-2xl font-black text-indigo-600">{proposals.length}</p>
              <p className="text-[10px] md:text-xs font-bold text-indigo-500">총 협업</p>
            </div>
            <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-4 text-center">
              <p className="text-base md:text-xl font-black text-teal-700">{formatFee(totalRevenue)}</p>
              <p className="text-[10px] md:text-xs font-bold text-teal-500">완료 수익</p>
            </div>
          </div>

          {/* Collab list */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
            {proposals.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🤝</div>
                <p className="text-slate-400 text-sm font-bold">아직 진행 중인 협업이 없습니다.</p>
                <p className="text-slate-300 text-xs mt-1">인플루언서가 제안을 수락하면 여기에 협업 건들이 표시됩니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...proposals]
                  .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
                  .map(p => (
                    <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-all">
                      <div className={`w-2 h-10 rounded-full shrink-0 ${isCollabDone(p) ? 'bg-blue-500' : 'bg-green-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                        <p className="text-xs font-bold text-slate-400">
                          @{p.influencer_username} · {formatDate(p.start_date)} ~ {formatDate(p.end_date)} · {formatFee(p.fee)}
                        </p>
                      </div>
                      <span className={`text-xs font-black shrink-0 ${isCollabDone(p) ? 'text-blue-500' : 'text-green-500'}`}>
                        {isCollabDone(p) ? '완료' : '진행중'}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {topTab === 'settlement' && (
        <BusinessSettlement businessUsername={businessUsername} companyName={companyName} embedded />
      )}
    </div>
  );
};

export default BusinessEntCalendar;
