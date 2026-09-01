import React, { useState, useEffect } from 'react';
import ErrorBoundary from './ErrorBoundary';
import { isNativeApp } from '../utils/appEnv';
import { authHeaders, setActiveBusinessAccount } from '../services/apiService';
// 청크를 못 받은 화면이 "로딩 중" 에서 멈추지 않도록, 크리에이터 대시보드와 같은
// 래퍼(재시도 → 실패 시 오류 경계)를 쓴다.
import { lazyWithRetry, LazyRoute } from '../utils/lazyRoute';

const BusinessInbox = lazyWithRetry(() => import('./BusinessInbox'));
const BusinessEntCalendar = lazyWithRetry(() => import('./BusinessEntCalendar'));
const LinkManagement = lazyWithRetry(() => import('./LinkManagement'));
const AITrendAnalysis = lazyWithRetry(() => import('./AITrendAnalysis'));
const DmAutomation = lazyWithRetry(() => import('./DmAutomation'));
const OpenScheduleManagement = lazyWithRetry(() => import('./OpenScheduleManagement'));
const MembershipPlan = lazyWithRetry(() => import('./MembershipPlan'));
const BusinessTimeline = lazyWithRetry(() => import('./BusinessTimeline'));
const CampaignCollabManagement = lazyWithRetry(() => import('./CampaignCollabManagement'));
const BusinessCampaignHistory = lazyWithRetry(() => import('./BusinessCampaignHistory'));
// 브랜드용 인사이트(우리 계정을 태그한 인플루언서 콘텐츠). 인플루언서용 인사이트와는
// 다른 화면이며, 이 대시보드에서만 열린다.
const BusinessTaggedContent = lazyWithRetry(() => import('./BusinessTaggedContent'));

interface BusinessEnterpriseDashboardProps {
  businessUsername: string;
  companyName: string;
  onLogout: () => void;
}

type BizSubView = 'dashboard' | 'links' | 'trend' | 'dm-automation' | 'inbox' | 'calendar' | 'open-schedule' | 'membership' | 'timeline' | 'campaign-collab' | 'tagged-insights' | 'campaign-history';

const BusinessEnterpriseDashboard: React.FC<BusinessEnterpriseDashboardProps> = ({ businessUsername, companyName, onLogout }) => {
  const [currentSubView, setCurrentSubView] = useState<BizSubView>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [timelineProposalId, setTimelineProposalId] = useState<string | null>(null);
  /** 현황 화면에서 "캠페인 진행사항 열기"로 지목한 캠페인. 캠페인 협업 화면이 이것을 펼친다. */
  const [collabCampaignId, setCollabCampaignId] = useState<string | null>(null);
  const [timelineUnread, setTimelineUnread] = useState(0);

  const cleanUsername = (businessUsername || '').replace(/^biz\//, '').toLowerCase();
  const statsCacheKey = `picks_biz_stats_${cleanUsername}`;
  const trendCacheKey = `picks_biz_trend`;
  const settlementCacheKey = `picks_biz_settlement_${cleanUsername}`;

  /**
   * 이 화면에 있는 동안의 요청은 비즈니스 계정 토큰으로 보낸다.
   *
   * 같은 브라우저에 크리에이터 세션이 남아 있으면 인증 헤더가 그쪽 토큰을 집어
   * 서버에서 "다른 계정의 정보에는 접근할 수 없습니다"로 막혔다(캠페인 등록 실패).
   * 대시보드를 벗어나면 다시 비운다 — 크리에이터 화면은 크리에이터 토큰을 써야 한다.
   *
   * 렌더 중에도 한 번 맞춘다: 자식 화면의 첫 요청이 아래 effect 보다 먼저 나갈 수 있다.
   */
  setActiveBusinessAccount(cleanUsername);
  useEffect(() => {
    setActiveBusinessAccount(cleanUsername);
    return () => setActiveBusinessAccount('');
  }, [cleanUsername]);

  const cachedStats = (() => {
    try {
      const raw = localStorage.getItem(statsCacheKey);
      return raw ? JSON.parse(raw) : { total: 0, accepted: 0, inProgress: 0 };
    } catch { return { total: 0, accepted: 0, inProgress: 0 }; }
  })();
  const cachedTrend = (() => {
    try { return localStorage.getItem(trendCacheKey) || '분석 중...'; }
    catch { return '분석 중...'; }
  })();
  const cachedSettlement = (() => {
    try {
      const raw = localStorage.getItem(settlementCacheKey);
      return raw ? Number(raw) || 0 : 0;
    } catch { return 0; }
  })();

  // Phone preview removed — the business home now matches the regular user
  // dashboard's single-column layout.
  const [topTrend, setTopTrend] = useState<string>(cachedTrend);
  const [proposalStats, setProposalStats] = useState(cachedStats);
  const [monthlySettlement, setMonthlySettlement] = useState<number>(cachedSettlement);

  const fetchTopTrend = async () => {
    try {
      const response = await fetch('/.netlify/functions/api-naver-datalab');
      if (response.ok) {
        const data = await response.json();
        if (data.mainInsight && data.mainInsight.keyword) {
          setTopTrend(data.mainInsight.keyword);
          try { localStorage.setItem(trendCacheKey, data.mainInsight.keyword); } catch {}
        }
      }
    } catch (e) {
      console.error('Error fetching top trend:', e);
    }
  };

  const fetchProposalStats = async () => {
    try {
      const res = await fetch(`/api/business-proposals/${encodeURIComponent(cleanUsername)}`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const proposals = data.proposals || [];
        const stats = {
          total: proposals.length,
          accepted: proposals.filter((p: any) => p.status === 'accepted').length,
          inProgress: proposals.filter((p: any) => p.status === 'accepted' || p.status === 'completed').length,
        };
        setProposalStats(stats);
        try { localStorage.setItem(statsCacheKey, JSON.stringify(stats)); } catch {}
      }
    } catch (e) {
      console.error('Error fetching proposal stats:', e);
    }
  };

  // Sum the current calendar month's settlements for this business so the
  // "이번 달 정산" KPI reflects real data instead of a hardcoded 0.
  const fetchMonthlySettlement = async () => {
    try {
      const res = await fetch(`/api/settlements/${encodeURIComponent(cleanUsername)}?role=business`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const settlements = data.settlements || [];
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const sum = settlements.reduce((acc: number, s: any) => {
          const dateStr = String(s.scheduled_date || s.created_at || '');
          return dateStr.slice(0, 7) === ym ? acc + (Number(s.amount) || 0) : acc;
        }, 0);
        setMonthlySettlement(sum);
        try { localStorage.setItem(settlementCacheKey, String(sum)); } catch {}
      }
    } catch (e) {
      console.error('Error fetching monthly settlement:', e);
    }
  };

  useEffect(() => {
    if (currentSubView === 'dashboard') {
      fetchTopTrend();
      fetchProposalStats();
      fetchMonthlySettlement();
    }
  }, [currentSubView]);

  useEffect(() => {
    const timelineCacheKey = `picks_timelines_business_${cleanUsername}`;
    const fetchUnread = async () => {
      try {
        const res = await fetch(`/api/timeline/list/${cleanUsername}?type=business`, {
          headers: await authHeaders(),
        });
        const data = await res.json();
        if (data.timelines) {
          const total = (data.timelines as { unreadCount?: number }[]).reduce((sum, t) => sum + (t.unreadCount || 0), 0);
          setTimelineUnread(total);
          try { localStorage.setItem(timelineCacheKey, JSON.stringify(data.timelines)); } catch {}
        }
      } catch {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [cleanUsername]);

  useEffect(() => {
    const handleNavigateTimeline = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.proposalId) {
        setTimelineProposalId(detail.proposalId);
      }
      setCurrentSubView('timeline');
    };
    const handleNavigateMembership = () => setCurrentSubView('membership');
    /**
     * 현황 화면 → 캠페인 진행사항. 진행사항 보드는 캠페인 협업 화면 안에만 있고,
     * 현황 화면이 보드를 한 벌 더 품으면 같은 협업의 상태가 두 곳에서 갈린다.
     */
    const handleNavigateCampaignCollab = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.campaignId) setCollabCampaignId(String(detail.campaignId));
      setCurrentSubView('campaign-collab');
    };
    window.addEventListener('navigate-timeline', handleNavigateTimeline);
    window.addEventListener('navigate-membership', handleNavigateMembership);
    window.addEventListener('navigate-campaign-collab', handleNavigateCampaignCollab);
    return () => {
      window.removeEventListener('navigate-timeline', handleNavigateTimeline);
      window.removeEventListener('navigate-membership', handleNavigateMembership);
      window.removeEventListener('navigate-campaign-collab', handleNavigateCampaignCollab);
    };
  }, []);

  const NavItem: React.FC<{ icon: string; label: string; active?: boolean; onClick?: () => void; badge?: number }> = ({ icon, label, active, onClick, badge }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-black text-sm transition-all text-left relative group ${
        active
          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/40'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-r-full"></div>
      )}
      <span className="text-base">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full">{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  );

  const MobileNavItem = ({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: number }) => (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-1 rounded-xl transition-all min-w-[46px] flex-shrink-0 relative ${
        active ? 'text-blue-400' : 'text-slate-500'
      }`}
    >
      <span className="text-base mb-0.5 relative">
        {icon}
        {badge != null && badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[8px] font-bold min-w-[14px] h-[14px] flex items-center justify-center px-0.5 rounded-full">{badge > 99 ? '99+' : badge}</span>
        )}
      </span>
      <span className="text-[8px] font-black tracking-tighter whitespace-nowrap">{label}</span>
    </button>
  );

  let subComponent: React.ReactNode = null;
  switch (currentSubView) {
    case 'links':
      subComponent = <LazyRoute><LinkManagement userName={businessUsername} /></LazyRoute>;
      break;
    case 'trend':
      subComponent = <LazyRoute><AITrendAnalysis userName={businessUsername} /></LazyRoute>;
      break;
    case 'dm-automation':
      subComponent = <LazyRoute><DmAutomation userName={businessUsername} /></LazyRoute>;
      break;
    case 'open-schedule':
      subComponent = <LazyRoute><OpenScheduleManagement userName={businessUsername} /></LazyRoute>;
      break;
    case 'membership':
      subComponent = <LazyRoute><MembershipPlan userName={businessUsername} /></LazyRoute>;
      break;
    case 'inbox':
      subComponent = (
        <LazyRoute><BusinessInbox businessUsername={businessUsername} companyName={companyName} /></LazyRoute>
      );
      break;
    case 'calendar':
      subComponent = <LazyRoute><BusinessEntCalendar businessUsername={businessUsername} /></LazyRoute>;
      break;
    case 'timeline':
      subComponent = (
        <LazyRoute>
          <BusinessTimeline userName={businessUsername} userType="business" initialProposalId={timelineProposalId || undefined} />
        </LazyRoute>
      );
      break;
    case 'campaign-collab':
      subComponent = (
        <LazyRoute>
          <CampaignCollabManagement
            businessUsername={businessUsername}
            companyName={companyName}
            initialCampaignId={collabCampaignId || undefined}
          />
        </LazyRoute>
      );
      break;
    case 'tagged-insights':
      subComponent = (
        <LazyRoute>
          <BusinessTaggedContent businessUsername={businessUsername} />
        </LazyRoute>
      );
      break;
    case 'campaign-history':
      subComponent = (
        <LazyRoute>
          <BusinessCampaignHistory businessUsername={businessUsername} companyName={companyName} />
        </LazyRoute>
      );
      break;
    default:
      subComponent = null;
  }

  // Default dashboard view (matching user dashboard layout)
  const DashboardHome = () => (
    <main className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-6 md:mb-10">
        <div className="flex items-center justify-between w-full md:w-auto">
          <h2 className="text-base md:text-3xl font-black text-slate-900 whitespace-nowrap">
            반가워요, <span className="text-blue-600">{companyName}</span>님!
          </h2>
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-1.5 text-slate-900 md:hidden"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => {
              const url = `${window.location.origin}/${businessUsername}`;
              window.open(url, '_blank');
            }}
            className="bg-slate-900 text-white px-4 py-2 rounded-xl font-black text-[10px] md:text-sm hover:bg-slate-800 transition-all shadow-xl flex items-center gap-2 border border-white/10"
          >
            <span className="hidden md:inline">내 페이지 실시간 보기</span>
            <span className="md:hidden">내 링크</span>
            <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          </button>
        </div>
      </header>

      <div>
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-6">
            <div className="bg-white p-3 md:p-5 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">보낸 제안</p>
              <p className="text-lg md:text-2xl font-black text-slate-900">{proposalStats.total}<span className="text-sm font-bold">건</span></p>
            </div>
            <div className="bg-white p-3 md:p-5 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">수락됨</p>
              <p className="text-lg md:text-2xl font-black text-green-600">{proposalStats.accepted}<span className="text-sm font-bold">건</span></p>
            </div>
            <div className="bg-white p-3 md:p-5 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">진행중 협업</p>
              <p className="text-lg md:text-2xl font-black text-blue-600">{proposalStats.inProgress}<span className="text-sm font-bold">건</span></p>
            </div>
            <div className="bg-white p-3 md:p-5 rounded-2xl border border-slate-100 shadow-sm">
              <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">이번 달 정산</p>
              <p className="text-lg md:text-2xl font-black text-slate-900">{monthlySettlement.toLocaleString()}<span className="text-sm font-bold">원</span></p>
            </div>
          </div>

          <button
            onClick={() => setCurrentSubView('links')}
            className="w-full bg-blue-600 text-white py-3 md:py-5 rounded-2xl font-black text-xs md:text-lg mb-6 md:mb-8 shadow-[0_8px_30px_rgba(124,58,237,0.25)] hover:bg-blue-500 transition-all active:scale-[0.99]"
          >
            + 새로운 포스트 & 링크 등록
          </button>

          {/* AI Trend section — embedded directly on the home like the user
              dashboard, so the business account sees the same AI capability. */}
          <section className="mb-6 md:mb-8">
            <LazyRoute>
              <AITrendAnalysis userName={businessUsername} embedded />
            </LazyRoute>
          </section>

          {/* Collaboration Timeline CTA (AI 협업 도우미) — mirrors the user
              dashboard's prominent 협업 entry point. */}
          <button
            onClick={() => setCurrentSubView('timeline')}
            className="w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-pink-500 text-white py-4 md:py-5 rounded-2xl font-black text-sm md:text-lg mb-6 md:mb-8 shadow-[0_8px_30px_rgba(124,58,237,0.25)] hover:shadow-[0_12px_40px_rgba(124,58,237,0.35)] transition-all active:scale-[0.99] flex items-center justify-center gap-3 relative"
          >
            <span className="text-xl">💬</span>
            협업 타임라인 열기
            {timelineUnread > 0 && (
              <span className="bg-white text-blue-600 text-[10px] font-black min-w-[20px] h-5 flex items-center justify-center px-1.5 rounded-full">{timelineUnread > 99 ? '99+' : timelineUnread}</span>
            )}
            <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
          </button>

          {/* Feature Cards (matching user dashboard) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-6 md:mb-8">
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[360px] shadow-xl">
              <div>
                <h3 className="text-sm md:text-2xl font-black mb-1">AI 트렌드 요약</h3>
                <p className="opacity-80 font-bold text-[9px] md:text-base whitespace-nowrap">지금 "{topTrend}" 룩이 다시 부상하고 있어요.</p>
              </div>
              <button onClick={() => setCurrentSubView('trend')} className="bg-white text-blue-700 px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">분석 리포트 보기</button>
            </div>
            <div className="bg-slate-900 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[360px] shadow-xl">
              <div>
                <h3 className="text-sm md:text-2xl font-black mb-1">협업 타임라인</h3>
                <p className="opacity-80 font-bold text-[9px] md:text-base whitespace-nowrap">인플루언서와의 협업 메시지를 확인하세요.</p>
              </div>
              <button onClick={() => setCurrentSubView('timeline')} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">타임라인 열기</button>
            </div>
          </div>

          {/* Business management cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-6 md:mb-8">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[300px] shadow-xl">
              <div>
                <h3 className="text-sm md:text-2xl font-black mb-1">📢 캠페인 협업</h3>
                <p className="opacity-80 font-bold text-[9px] md:text-base">캠페인을 등록하고 크리에이터의 지원을 받아보세요.</p>
              </div>
              <button onClick={() => setCurrentSubView('campaign-collab')} className="bg-white text-blue-700 px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">캠페인 관리</button>
            </div>
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[300px] shadow-xl">
              <div>
                <h3 className="text-sm md:text-2xl font-black mb-1">📨 비즈니스 제안 현황</h3>
                <p className="opacity-80 font-bold text-[9px] md:text-base">인플루언서에게 보낸 제안 현황을 확인하세요.</p>
              </div>
              <button onClick={() => setCurrentSubView('inbox')} className="bg-white text-emerald-700 px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">현황 보기</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-6 md:mb-8">
            <div className="bg-gradient-to-br from-amber-600 to-orange-700 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[300px] shadow-xl">
              <div>
                <h3 className="text-sm md:text-2xl font-black mb-1">📅 협업 현황</h3>
                <p className="opacity-80 font-bold text-[9px] md:text-base">수락된 제안 일정과 정산을 한곳에서 관리하세요.</p>
              </div>
              <button onClick={() => setCurrentSubView('calendar')} className="bg-white text-amber-700 px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">캘린더 보기</button>
            </div>
          </div>

          {/* Quick Management */}
          <div className="mb-6">
            <h4 className="text-base md:text-xl font-black text-slate-900 mb-4 md:mb-6">빠른 관리</h4>
            <div className="grid grid-cols-1 gap-6">
              <div
                onClick={() => setCurrentSubView('links')}
                className="bg-white p-4 md:p-8 rounded-xl md:rounded-[2rem] border border-slate-100 flex items-center space-x-3 md:space-x-6 cursor-pointer hover:border-blue-600 hover:-translate-y-1 transition-all group shadow-sm"
              >
                <div className="w-10 h-10 md:w-16 md:h-16 bg-slate-50 rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-3xl group-hover:bg-blue-50 transition-all shrink-0">
                  🎨
                </div>
                <div>
                  <h5 className="font-black text-sm md:text-lg text-slate-900 group-hover:text-blue-600 transition-all">링크 & 테마 꾸미기</h5>
                  <p className="text-slate-500 text-xs md:text-sm font-medium leading-tight">내 페이지의 템플릿과 디자인을 자유롭게 변경합니다.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
    </main>
  );

  return (
    <div className={`flex flex-col md:flex-row min-h-screen bg-[#f8fafc] text-slate-800 md:pb-0 ${currentSubView === 'timeline' ? '' : 'pb-20'}`}>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-60 bg-[#0b1221] text-white fixed h-full flex-col p-6 z-50">
        <div
          className="text-xl font-black text-blue-500 tracking-tighter mb-8 cursor-pointer hover:scale-105 transition-transform"
          onClick={() => setCurrentSubView('dashboard')}
        >
          PICKSFOLIO
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem icon="🏠" label="대시보드" active={currentSubView === 'dashboard'} onClick={() => setCurrentSubView('dashboard')} />
          <NavItem icon="🔗" label="링크 & 그리드 관리" active={currentSubView === 'links'} onClick={() => setCurrentSubView('links')} />
          <NavItem icon="📩" label="DM 자동화" active={currentSubView === 'dm-automation'} onClick={() => setCurrentSubView('dm-automation')} />
          {/* 인사이트는 내 계정 데이터를 보는 메뉴라, 캠페인 그룹 위 · DM 자동화 바로 아래에 둔다. */}
          <NavItem icon="📈" label="인사이트" active={currentSubView === 'tagged-insights'} onClick={() => setCurrentSubView('tagged-insights')} />
          <div className="my-3 border-t border-white/10" />
          <NavItem icon="📢" label="캠페인 협업" active={currentSubView === 'campaign-collab'} onClick={() => setCurrentSubView('campaign-collab')} />
          <NavItem icon="📊" label="캠페인 이력" active={currentSubView === 'campaign-history'} onClick={() => setCurrentSubView('campaign-history')} />
          <NavItem icon="📨" label="비즈니스 제안 현황" active={currentSubView === 'inbox'} onClick={() => setCurrentSubView('inbox')} />
          <NavItem icon="💬" label="협업 타임라인" active={currentSubView === 'timeline'} onClick={() => setCurrentSubView('timeline')} badge={timelineUnread} />
          <NavItem icon="📅" label="협업 현황" active={currentSubView === 'calendar'} onClick={() => setCurrentSubView('calendar')} />
          <NavItem icon="🗓️" label="오픈 일정" active={currentSubView === 'open-schedule'} onClick={() => setCurrentSubView('open-schedule')} />
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
          {!isNativeApp() && (
            <NavItem icon="💎" label="멤버십 플랜" active={currentSubView === 'membership'} onClick={() => setCurrentSubView('membership')} />
          )}
          <button
            type="button" onClick={onLogout}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 font-bold hover:bg-white/5 hover:text-white transition-all text-sm cursor-pointer"
          >
            <span>👤</span>
            <span>로그아웃</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-[#0b1221] text-white z-[100] border-t border-white/10 fixed-bottom-nav">
        <div className="flex overflow-x-auto scrollbar-hide px-1 py-2 gap-0.5" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}>
          <MobileNavItem icon="🏠" label="홈" active={currentSubView === 'dashboard'} onClick={() => setCurrentSubView('dashboard')} />
          <MobileNavItem icon="🔗" label="관리" active={currentSubView === 'links'} onClick={() => setCurrentSubView('links')} />
          <MobileNavItem icon="📩" label="DM자동화" active={currentSubView === 'dm-automation'} onClick={() => setCurrentSubView('dm-automation')} />
          <MobileNavItem icon="📈" label="인사이트" active={currentSubView === 'tagged-insights'} onClick={() => setCurrentSubView('tagged-insights')} />
          <MobileNavItem icon="📢" label="캠페인" active={currentSubView === 'campaign-collab'} onClick={() => setCurrentSubView('campaign-collab')} />
          <MobileNavItem icon="📊" label="캠페인이력" active={currentSubView === 'campaign-history'} onClick={() => setCurrentSubView('campaign-history')} />
          <MobileNavItem icon="📨" label="제안현황" active={currentSubView === 'inbox'} onClick={() => setCurrentSubView('inbox')} />
          <MobileNavItem icon="💬" label="타임라인" active={currentSubView === 'timeline'} onClick={() => setCurrentSubView('timeline')} badge={timelineUnread} />
          <MobileNavItem icon="📅" label="협업현황" active={currentSubView === 'calendar'} onClick={() => setCurrentSubView('calendar')} />
          <MobileNavItem icon="🗓️" label="오픈일정" active={currentSubView === 'open-schedule'} onClick={() => setCurrentSubView('open-schedule')} />
          {!isNativeApp() && (
            <MobileNavItem icon="💎" label="멤버십" active={currentSubView === 'membership'} onClick={() => setCurrentSubView('membership')} />
          )}
        </div>
      </nav>

      {/* Mobile Sidebar Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[200] animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <aside className="absolute left-0 top-0 w-72 max-w-[85vw] h-full bg-[#0b1221] text-white p-6 flex flex-col animate-in slide-in-from-left duration-300 overflow-y-auto overscroll-contain">
            <div className="text-2xl font-black text-blue-500 tracking-tighter mb-8" onClick={() => { setCurrentSubView('dashboard'); setIsMobileMenuOpen(false); }}>
              PICKSFOLIO
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto">
              <NavItem icon="🏠" label="대시보드" active={currentSubView === 'dashboard'} onClick={() => { setCurrentSubView('dashboard'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="🔗" label="링크 & 그리드 관리" active={currentSubView === 'links'} onClick={() => { setCurrentSubView('links'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📩" label="DM 자동화" active={currentSubView === 'dm-automation'} onClick={() => { setCurrentSubView('dm-automation'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📈" label="인사이트" active={currentSubView === 'tagged-insights'} onClick={() => { setCurrentSubView('tagged-insights'); setIsMobileMenuOpen(false); }} />
              <div className="my-2 border-t border-white/10" />
              <NavItem icon="📢" label="캠페인 협업" active={currentSubView === 'campaign-collab'} onClick={() => { setCurrentSubView('campaign-collab'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📊" label="캠페인 이력" active={currentSubView === 'campaign-history'} onClick={() => { setCurrentSubView('campaign-history'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📨" label="비즈니스 제안 현황" active={currentSubView === 'inbox'} onClick={() => { setCurrentSubView('inbox'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="💬" label="협업 타임라인" active={currentSubView === 'timeline'} onClick={() => { setCurrentSubView('timeline'); setIsMobileMenuOpen(false); }} badge={timelineUnread} />
              <NavItem icon="📅" label="협업 현황" active={currentSubView === 'calendar'} onClick={() => { setCurrentSubView('calendar'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="🗓️" label="오픈 일정" active={currentSubView === 'open-schedule'} onClick={() => { setCurrentSubView('open-schedule'); setIsMobileMenuOpen(false); }} />
            </nav>
            <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
              {!isNativeApp() && (
                <NavItem icon="💎" label="멤버십 플랜" active={currentSubView === 'membership'} onClick={() => { setCurrentSubView('membership'); setIsMobileMenuOpen(false); }} />
              )}
              <button type="button" onClick={onLogout} className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 font-bold hover:bg-white/5 hover:text-white transition-all text-sm">
                <span>👤</span><span>로그아웃</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className={`flex-1 md:ml-60 w-full ${currentSubView === 'timeline' ? 'md:min-h-screen' : 'min-h-screen'}`}>
        {subComponent ? (
          /* key 를 메뉴로 둔다. 경계는 한 번 오류를 잡으면 그 상태로 굳으므로, key 가
             없으면 한 메뉴에서 난 오류가 다른 메뉴로 옮겨 가도 계속 오류 화면으로
             보인다. 메뉴가 바뀌면 경계도 새로 만들어져 정상 화면부터 다시 그린다. */
          <ErrorBoundary key={currentSubView}>
            {subComponent}
          </ErrorBoundary>
        ) : (
          <DashboardHome />
        )}
      </div>
    </div>
  );
};

export default BusinessEnterpriseDashboard;
