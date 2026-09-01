import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessProposal } from '../types';
import { formatKRW } from '../utils/formatters';
import { authHeaders, apiService } from '../services/apiService';
import BrandSettlementSummary from './collab/BrandSettlementSummary';
import {
  CampaignCollabStatus,
  campaignCollabsAsProposals,
  dropProposalsCoveredByCollabs,
  openCampaignCollab,
  toCampaignCollabStatuses,
} from '../utils/campaignCollabStatus';

interface BusinessEntCalendarProps {
  businessUsername: string;
}

/**
 * 이 화면의 한 줄.
 *
 * 비즈니스 제안과 캠페인 협업이 같은 배열에 들어온다. 캘린더 칸 · 인플루언서별 묶음 ·
 * 마감 임박 · 통계가 모두 이 배열 하나를 보므로, 새 갈래를 넣을 때 다섯 곳을 각각
 * 고칠 필요가 없다. `_collabId` 가 있으면 캠페인 협업이다.
 */
type CollabRow = BusinessProposal & {
  _collabId?: string;
  _campaignId?: string;
  _progress?: number;
  _stageTitle?: string;
  _todo?: string;
};

/** 로컬 시간대 기준 YYYY-MM-DD. UTC 변환으로 날짜가 하루 밀리는 것을 막는다. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 'YYYY-MM-DDTHH:mm:ss' 든 'YYYY-MM-DD' 든 날짜 부분만. */
const dayOnly = (v?: string) => (v || '').split('T')[0];

/**
 * 달력 한 칸에 찍히는 업로드 일정.
 *
 * 칸이 답해야 하는 질문은 "이 날 누가 올리나" 하나다. 기간은 협업 내역 탭이 이미
 * 보여 주므로, 여기서는 날짜 하나에 점 하나만 놓는다.
 */
type UploadChip = {
  id: string;
  /** 콘텐츠를 올리는 날(YYYY-MM-DD). */
  date: string;
  /** 업로드가 끝났는가. 남은 일을 앞으로 올리고 색을 가르는 데 쓴다. */
  done: boolean;
  /** 칸을 눌렀을 때 아래 상세가 그리는 원래 협업 줄. */
  row: CollabRow;
};

const BusinessEntCalendar: React.FC<BusinessEntCalendarProps> = ({ businessUsername }) => {
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
  const [collabs, setCollabs] = useState<CampaignCollabStatus[]>([]);
  const [loading, setLoading] = useState(cachedProposals.length === 0);
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    const fetchProposals = async () => {
      try {
        const res = await fetch(`/api/business-proposals/${encodeURIComponent(cleanUsername)}`, {
          headers: await authHeaders(),
        });
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
    /**
     * 캠페인 협업. 캐시에는 넣지 않는다 — 진행 단계가 자주 바뀌는 값이라, 지난번에
     * 저장해 둔 상태가 잠깐 보이면 그동안 오간 승인·수정요청이 없던 일처럼 읽힌다.
     */
    const fetchCollabs = async () => {
      try {
        const res = await apiService.getCollabs('brand');
        setCollabs(toCampaignCollabStatuses(res.collabs || [], 'brand'));
      } catch (e) {
        console.error('Failed to fetch campaign collabs:', e);
      }
    };
    fetchProposals();
    fetchCollabs();
  }, [businessUsername]);

  /**
   * 제안 + 캠페인 협업. 아래 계산은 전부 이 배열만 본다.
   *
   * 제안 목록에는 선정된 캠페인 지원자가 제안 한 줄로 접혀서 함께 온다. 그 줄을 빼지
   * 않으면 같은 협업이 캘린더에 막대 두 개로 그려지고, 진행 건수와 총 협업비도 두 번
   * 세어진다.
   */
  const rows = useMemo<CollabRow[]>(
    () => [...dropProposalsCoveredByCollabs(proposals, collabs), ...campaignCollabsAsProposals(collabs)],
    [proposals, collabs],
  );

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  // 로컬 날짜 기준. `toISOString()` 은 UTC라서 한국 시간 오전 9시 이전에는
  // 어제 날짜가 나오고, 그동안 "오늘"과 완료 판정이 하루씩 어긋났다.
  const today = ymd(new Date());

  // Keep the calendar status in sync with the dates: an accepted proposal whose
  // end date has already passed (or which is already settled/completed) is shown
  // as 완료됨 instead of lingering as 진행중. Dates are compared as YYYY-MM-DD.
  const isCollabDone = (p: CollabRow): boolean => {
    if (p.status === 'completed') return true;
    const end = (p.end_date || '').split('T')[0];
    return !!end && end < today;
  };

  const getDateStr = (day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  /**
   * 협업 줄에 붙은 원래 협업. 업로드 날짜와 확인 여부가 여기에만 있다.
   *
   * `campaignCollabsAsProposals` 는 제안 모양으로 맞추느라 기간과 금액만 옮겨 온다.
   * 달력이 보는 값은 기간이 아니라 업로드 마감이므로 원본을 한 번 더 짚는다.
   */
  const byCollabId = useMemo(
    () => new Map(collabs.map(c => [c.id, c])),
    [collabs],
  );

  /**
   * 이 협업을 올리는 날.
   *
   * 이미 올렸으면 올린 날, 아직이면 확정 조건의 업로드 마감이다. 둘 다 없는 줄(브랜드가
   * 직접 보낸 제안)은 종료일을 쓴다 — 서버는 일정을 확정할 때 업로드 마감을 협업
   * 종료일로 옮겨 적으므로 둘은 같은 날을 가리킨다.
   */
  const uploadDateOf = (p: CollabRow): string => {
    const linked = p._collabId ? byCollabId.get(p._collabId) : undefined;
    return (
      dayOnly(linked?.uploadedDay) ||
      dayOnly(linked?.uploadDue) ||
      dayOnly(p.end_date) ||
      dayOnly(p.start_date)
    );
  };

  /** 업로드가 끝났는가. 캠페인 협업은 확인 기록으로, 직접 보낸 제안은 기존 완료 판정으로 가른다. */
  const isUploadDone = (p: CollabRow): boolean => {
    const linked = p._collabId ? byCollabId.get(p._collabId) : undefined;
    if (linked) {
      return (
        linked.state === 'completed' ||
        Boolean(linked.uploadConfirmedAt) ||
        Boolean(linked.uploadedDay)
      );
    }
    // 직접 보낸 제안에는 업로드를 확인하는 단계가 없다. 옆의 '완료됨' 집계와 같은
    // 규칙을 써야 달력의 색과 사이드바 숫자가 어긋나지 않는다.
    return isCollabDone(p);
  };

  /**
   * 달력에 찍는 날 — 콘텐츠가 올라가는 날 하나뿐이다.
   *
   * 예전에는 협업 기간을 막대로 그렸다. 그런데 담당자가 일정을 확정하기 전의 협업은
   * 기간이 "협업이 만들어진 날 ~ 캠페인 종료일"까지 벌어져서, 인플루언서 한 명과 네 건만
   * 진행해도 막대가 달 전체를 덮고 칸마다 '+2'가 붙었다. 정작 브랜드가 달력에서 알고
   * 싶은 것 — 언제 콘텐츠가 올라오나 — 는 그 막대 어디에도 적혀 있지 않았다.
   *
   * 그래서 기간은 버리고 업로드하는 날만 점으로 찍는다. 기간과 금액 합계는 협업 내역
   * 탭이, 회차별 지급액은 정산금 탭이 이미 보여 준다.
   */
  const dayChipsMap = useMemo(() => {
    const map: Record<string, UploadChip[]> = {};
    rows.forEach(p => {
      const date = uploadDateOf(p);
      if (!date) return;
      if (!map[date]) map[date] = [];
      map[date].push({ id: p.id, date, done: isUploadDone(p), row: p });
    });
    // 남은 일이 먼저다. 같은 날 여러 명이 올리면 아직 안 올린 쪽부터 보여 준다.
    Object.values(map).forEach(list =>
      list.sort(
        (a, b) =>
          Number(a.done) - Number(b.done) ||
          a.row.influencer_username.localeCompare(b.row.influencer_username),
      ),
    );
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, byCollabId, today]);

  /** 점의 색. 마감이 지났는데 안 올라온 건을 회색으로 두면 놓친 것을 놓친 줄 모른다. */
  const chipClass = (ev: UploadChip) => {
    if (ev.done) return 'bg-emerald-100 text-emerald-700';
    if (ev.date < today) return 'bg-red-100 text-red-700';
    return 'bg-blue-100 text-blue-700';
  };

  const chipLabel = (ev: UploadChip) =>
    ev.done ? '업로드 완료' : ev.date < today ? '마감 지남 (미업로드)' : '업로드 예정';

  const chipIcon = (ev: UploadChip) => (ev.done ? '✅' : ev.date < today ? '⚠️' : '⬆️');

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(ymd(now));
  };

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  // Group accepted proposals by influencer for the list view
  const groupedByInfluencer = useMemo(() => {
    const groups: Record<string, CollabRow[]> = {};
    rows.forEach(p => {
      if (!groups[p.influencer_username]) groups[p.influencer_username] = [];
      groups[p.influencer_username].push(p);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  // Stats
  const acceptedCount = rows.filter(p => !isCollabDone(p)).length;
  const completedCount = rows.filter(p => isCollabDone(p)).length;
  const totalInfluencers = new Set(rows.map(p => p.influencer_username)).size;
  const totalCollabCost = rows.filter(p => isCollabDone(p)).reduce((sum, p) => sum + (p.fee || 0), 0);

  // Upcoming deadlines
  const upcomingDeadlines = useMemo(() => {
    return rows
      .filter(p => !isCollabDone(p) && p.end_date && new Date(p.end_date) >= new Date())
      .map(p => ({ id: p.id, title: p.title, influencer: p.influencer_username, endDate: p.end_date, fee: p.fee }))
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
      .slice(0, 6);
  }, [rows]);

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

  // 고른 날에 업로드가 잡힌 협업. 기간이 걸쳐 있다고 뜨지 않는다 — 달력의 점과 같은 목록이다.
  const selectedDateChips = useMemo(
    () => (selectedDate ? dayChipsMap[selectedDate] || [] : []),
    [dayChipsMap, selectedDate],
  );

  /**
   * 캠페인 협업 줄에 붙는 표시.
   *
   * 통합 목록에서 이것이 없으면 "브랜드가 직접 보낸 제안"과 "담당자를 거치는 캠페인
   * 협업"이 같은 줄로 보인다 — 두 갈래는 연락하는 상대도, 진행을 여는 화면도 다르다.
   */
  const collabBadge = (row: CollabRow) =>
    row._collabId ? (
      <span className="px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-600 text-[9px] font-black shrink-0">
        캠페인 {row._progress ?? 0}%
      </span>
    ) : null;

  /** 캠페인 협업 줄은 눌러서 진행사항으로 간다. 제안 줄은 눌러도 갈 곳이 없다. */
  const openIfCollab = (row: CollabRow) => {
    if (!row._collabId) return;
    openCampaignCollab({ campaignId: row._campaignId, collabId: row._collabId });
  };

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
            비즈니스 제안과 진행 중인 캠페인 협업을 캘린더·내역·정산금으로 함께 관리합니다
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

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = getDateStr(day);
                const chips = dayChipsMap[dateStr] || [];
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                const dayOfWeek = (firstDayOfWeek + day - 1) % 7;

                return (
                  <div
                    key={day}
                    onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                    className={`p-2 md:p-3 min-h-[100px] md:min-h-[130px] overflow-hidden border-b border-r border-slate-50 cursor-pointer transition-all hover:bg-blue-50/50 ${
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
                    {/* 올리는 날(⬆️)만 찍는다. 세 건이 넘는 날은 개수로 접고, 자세한
                        내용은 칸을 눌렀을 때 아래 상세에서 본다. */}
                    <div className="mt-1.5">
                      {chips.slice(0, 3).map(ev => (
                        <div
                          key={ev.id}
                          title={[chipLabel(ev), ev.row.title, `@${ev.row.influencer_username}`]
                            .filter(Boolean)
                            .join(' · ')}
                          className={`text-[10px] md:text-xs font-bold py-1 px-1.5 rounded leading-tight overflow-hidden whitespace-nowrap text-ellipsis mb-[1px] ${chipClass(ev)}`}
                        >
                          {chipIcon(ev)} @{ev.row.influencer_username}
                        </div>
                      ))}
                      {chips.length > 3 && (
                        <p className="text-[10px] font-bold text-slate-400 px-1">+{chips.length - 3}건</p>
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
                {formatDate(selectedDate)} 업로드 일정
              </h4>
              {selectedDateChips.length === 0 ? (
                <p className="text-slate-400 text-sm font-bold text-center py-4">이 날짜에 예정된 업로드가 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {selectedDateChips.map(ev => {
                    const p = ev.row;
                    return (
                      <div
                        key={ev.id}
                        onClick={() => openIfCollab(p)}
                        className={`flex items-center gap-3 p-4 bg-slate-50 rounded-xl ${p._collabId ? 'cursor-pointer hover:bg-violet-50 transition-colors' : ''}`}
                      >
                        <div
                          className={`w-2 h-12 rounded-full shrink-0 ${
                            ev.done ? 'bg-emerald-500' : ev.date < today ? 'bg-red-500' : 'bg-blue-500'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                            {collabBadge(p)}
                          </div>
                          <p className="text-xs font-bold text-slate-400">@{p.influencer_username} · {formatFee(p.fee)}</p>
                          {/* 협업 기간은 달력에서 빼는 대신 여기 한 줄로 남긴다 — 점 하나만
                              보고는 이 협업이 언제부터 돌고 있는지 알 수 없다. */}
                          <p className="text-[10px] font-bold text-slate-300 mt-0.5">
                            협업 기간 {formatDate(p.start_date)} ~ {formatDate(p.end_date)}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-black shrink-0 ${
                            ev.done ? 'text-emerald-500' : ev.date < today ? 'text-red-500' : 'text-blue-500'
                          }`}
                        >
                          {chipLabel(ev)}
                        </span>
                      </div>
                    );
                  })}
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
                <p className="text-slate-400 text-sm font-medium">인플루언서가 제안을 수락하거나 캠페인에서 선정되면 여기에 일정이 표시됩니다.</p>
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
                        <div
                          key={p.id}
                          onClick={() => openIfCollab(p)}
                          className={`flex items-center justify-between bg-slate-50 rounded-xl p-3 ${p._collabId ? 'cursor-pointer hover:bg-violet-50 transition-colors' : ''}`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-bold text-slate-800 text-xs truncate">{p.title}</p>
                              {collabBadge(p)}
                            </div>
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
                <p className="text-xl md:text-2xl font-black text-blue-600">{rows.length}</p>
                <p className="text-[10px] md:text-xs font-bold text-blue-500">총 협업</p>
              </div>
            </div>
            {totalCollabCost > 0 && (
              <div className="mt-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-3 md:p-4 text-center">
                <p className="text-lg md:text-xl font-black text-blue-700">{formatFee(totalCollabCost)}</p>
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

          {/* Legend — 달력이 찍는 것은 콘텐츠가 올라가는 날, 하나뿐이다. */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">범례</h4>
            <p className="text-[11px] font-bold text-slate-400 mb-3 leading-relaxed">
              달력에는 인플루언서의 업로드 일정만 표시됩니다. 일정이 확정되기 전에는 캠페인 종료일에
              놓이고, 담당자가 업로드 마감을 확정하면 그 날짜로 옮겨집니다. 협업 기간과 금액 합계는
              협업 내역, 회차별 지급액은 정산금 탭에서 볼 수 있습니다.
            </p>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-blue-400" />
                <span className="text-sm font-bold text-slate-600">⬆️ 업로드 예정</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-red-400" />
                <span className="text-sm font-bold text-slate-600">⚠️ 마감 지남 (미업로드)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-full bg-emerald-400" />
                <span className="text-sm font-bold text-slate-600">✅ 업로드 완료</span>
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
              <p className="text-xl md:text-2xl font-black text-indigo-600">{rows.length}</p>
              <p className="text-[10px] md:text-xs font-bold text-indigo-500">총 협업</p>
            </div>
            <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-4 text-center">
              <p className="text-base md:text-xl font-black text-teal-700">{formatFee(totalCollabCost)}</p>
              {/* 업체 화면에서 이 금액은 지급한 비용이다. 같은 값을 위쪽 타일에서는
                  "완료 협업 총 비용"이라 부르고 있어서 표기를 맞춘다. */}
              <p className="text-[10px] md:text-xs font-bold text-teal-500">완료 협업 총 비용</p>
            </div>
          </div>

          {/* Collab list */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
            {rows.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">🤝</div>
                <p className="text-slate-400 text-sm font-bold">아직 진행 중인 협업이 없습니다.</p>
                <p className="text-slate-300 text-xs mt-1">제안이 수락되거나 캠페인 인플루언서가 선정되면 여기에 협업 건들이 표시됩니다.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...rows]
                  .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime())
                  .map(p => (
                    <div
                      key={p.id}
                      onClick={() => openIfCollab(p)}
                      className={`flex items-center gap-3 p-3 rounded-xl transition-all ${p._collabId ? 'cursor-pointer hover:bg-violet-50' : 'hover:bg-slate-50'}`}
                    >
                      <div className={`w-2 h-10 rounded-full shrink-0 ${isCollabDone(p) ? 'bg-blue-500' : 'bg-green-500'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                          {collabBadge(p)}
                        </div>
                        <p className="text-xs font-bold text-slate-400">
                          @{p.influencer_username}
                          {p.start_date && ` · ${formatDate(p.start_date)}`}
                          {p.end_date && ` ~ ${formatDate(p.end_date)}`}
                          {p.fee > 0 && ` · ${formatFee(p.fee)}`}
                        </p>
                        {p._todo && <p className="text-[10px] font-bold text-violet-500 mt-0.5 truncate">{p._todo}</p>}
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

      {/* 정산은 회차 요약이다. 예전에는 이 자리에서 브랜드가 인플루언서별 정산 항목을
          직접 만들고 금액과 지급일을 고칠 수 있었다. 브랜드는 개별 송금을 하지 않으므로
          고칠 것이 없고, 고칠 수 있게 두면 담당자가 업로드를 확인해 잡아 둔 지급 근거와
          어긋난다. */}
      {topTab === 'settlement' && <BrandSettlementSummary businessUsername={businessUsername} />}
    </div>
  );
};

export default BusinessEntCalendar;
