import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { DEFAULT_AVATAR } from '../utils/defaultAvatar';
import ErrorBoundary from './ErrorBoundary';
import SafeImage from './SafeImage';
import PhoneFrame from './PhoneFrame';
import { Block, DesignSettings, TemplateType } from '../types';

const BusinessInbox = lazy(() => import('./BusinessInbox'));
const BusinessEntCalendar = lazy(() => import('./BusinessEntCalendar'));
const BusinessSettlement = lazy(() => import('./BusinessSettlement'));
const LinkManagement = lazy(() => import('./LinkManagement'));
const PortfolioManagement = lazy(() => import('./PortfolioManagement'));
const AITrendAnalysis = lazy(() => import('./AITrendAnalysis'));
const LiveCommerceManagement = lazy(() => import('./LiveCommerceManagement'));
const BroadcastSettings = lazy(() => import('./BroadcastSettings'));
const OpenScheduleManagement = lazy(() => import('./OpenScheduleManagement'));
const MembershipPlan = lazy(() => import('./MembershipPlan'));
const BusinessTimeline = lazy(() => import('./BusinessTimeline'));
const CampaignCollabManagement = lazy(() => import('./CampaignCollabManagement'));

interface BusinessEnterpriseDashboardProps {
  businessUsername: string;
  companyName: string;
  onLogout: () => void;
}

type BizSubView = 'dashboard' | 'links' | 'portfolio' | 'trend' | 'live' | 'broadcast-settings' | 'inbox' | 'calendar' | 'settlement' | 'open-schedule' | 'membership' | 'timeline' | 'campaign-collab';

const BusinessEnterpriseDashboard: React.FC<BusinessEnterpriseDashboardProps> = ({ businessUsername, companyName, onLogout }) => {
  const [currentSubView, setCurrentSubView] = useState<BizSubView>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [timelineProposalId, setTimelineProposalId] = useState<string | null>(null);
  const [timelineUnread, setTimelineUnread] = useState(0);

  const cleanUsername = (businessUsername || '').replace(/^biz\//, '').toLowerCase();
  const statsCacheKey = `picks_biz_stats_${cleanUsername}`;
  const trendCacheKey = `picks_biz_trend`;

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

  // Phone preview state (matching user dashboard)
  const [previewBlocks, setPreviewBlocks] = useState<Block[]>([]);
  const [previewDesign, setPreviewDesign] = useState<DesignSettings>({
    templateType: TemplateType.SHOPPABLE_GRID,
    theme: 'midnight',
    accentColor: '#2563eb',
    borderRadius: 'full',
    gridGap: 1,
    gridColumns: 2,
    gridStyle: 'magazine',
    fontFamily: 'Sans',
    buttonStyle: 'solid',
    backgroundType: 'solid',
    profileLayout: 'center',
    homePriority: 'curation'
  });
  const [previewProfile, setPreviewProfile] = useState<any>({ name: companyName, bio: '', avatar_url: '' });
  const [previewPortfolio, setPreviewPortfolio] = useState<any[]>([]);
  const [topTrend, setTopTrend] = useState<string>(cachedTrend);
  const [proposalStats, setProposalStats] = useState(cachedStats);

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
      const res = await fetch(`/api/business-proposals/${encodeURIComponent(cleanUsername)}`);
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

  const loadPreviewData = useCallback(() => {
    const u = (businessUsername || '').toLowerCase();
    if (!u) return;
    try {
      const savedBlocks = localStorage.getItem(`picks_blocks_${u}`);
      if (savedBlocks) setPreviewBlocks(JSON.parse(savedBlocks));

      const savedDesign = localStorage.getItem(`picks_design_${u}`);
      if (savedDesign) setPreviewDesign(prev => ({ ...prev, ...JSON.parse(savedDesign) }));

      const savedProfile = localStorage.getItem(`picks_profile_${u}`);
      if (savedProfile) setPreviewProfile(JSON.parse(savedProfile));

      const savedPortfolio = localStorage.getItem(`picks_portfolio_${u}`);
      if (savedPortfolio) setPreviewPortfolio(JSON.parse(savedPortfolio));
    } catch (e) {
      console.error('Error loading preview data:', e);
    }
  }, [businessUsername]);

  useEffect(() => {
    if (currentSubView === 'dashboard') {
      loadPreviewData();
      fetchTopTrend();
      fetchProposalStats();
    }
  }, [currentSubView, loadPreviewData]);

  useEffect(() => {
    const timelineCacheKey = `picks_timelines_business_${cleanUsername}`;
    const fetchUnread = async () => {
      try {
        const res = await fetch(`/api/timeline/list/${cleanUsername}?type=business`);
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
    const handleStorageChange = () => loadPreviewData();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadPreviewData();
    };
    const handleNavigateTimeline = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.proposalId) {
        setTimelineProposalId(detail.proposalId);
      }
      setCurrentSubView('timeline');
    };
    const handleNavigateMembership = () => setCurrentSubView('membership');
    window.addEventListener('storage', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('navigate-timeline', handleNavigateTimeline);
    window.addEventListener('navigate-membership', handleNavigateMembership);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('navigate-timeline', handleNavigateTimeline);
      window.removeEventListener('navigate-membership', handleNavigateMembership);
    };
  }, [loadPreviewData]);

  const NavItem: React.FC<{ icon: string; label: string; active?: boolean; onClick?: () => void; badge?: number }> = ({ icon, label, active, onClick, badge }) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-5 py-4 rounded-2xl font-black text-sm transition-all text-left relative group ${
        active
          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-900/40'
          : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full"></div>
      )}
      <span className={`text-lg transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-110'}`}>{icon}</span>
      <span className={`flex-1 transition-all duration-300 ${active ? 'translate-x-1' : 'group-hover:translate-x-1'}`}>{label}</span>
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

  const BizLazyFallback = () => (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="text-center animate-in fade-in duration-300">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-slate-400 font-semibold text-xs">로딩 중...</p>
      </div>
    </div>
  );

  let subComponent: React.ReactNode = null;
  switch (currentSubView) {
    case 'links':
      subComponent = <Suspense fallback={<BizLazyFallback />}><LinkManagement userName={businessUsername} /></Suspense>;
      break;
    case 'portfolio':
      subComponent = <Suspense fallback={<BizLazyFallback />}><PortfolioManagement userName={businessUsername} onNavigateMembership={() => setCurrentSubView('membership')} /></Suspense>;
      break;
    case 'trend':
      subComponent = <Suspense fallback={<BizLazyFallback />}><AITrendAnalysis userName={businessUsername} /></Suspense>;
      break;
    case 'live':
      subComponent = <Suspense fallback={<BizLazyFallback />}><LiveCommerceManagement userName={businessUsername} /></Suspense>;
      break;
    case 'broadcast-settings':
      subComponent = <Suspense fallback={<BizLazyFallback />}><BroadcastSettings userName={businessUsername} onNavigateLive={() => setCurrentSubView('live')} /></Suspense>;
      break;
    case 'open-schedule':
      subComponent = <Suspense fallback={<BizLazyFallback />}><OpenScheduleManagement userName={businessUsername} /></Suspense>;
      break;
    case 'membership':
      subComponent = <Suspense fallback={<BizLazyFallback />}><MembershipPlan userName={businessUsername} /></Suspense>;
      break;
    case 'inbox':
      subComponent = (
        <Suspense fallback={<BizLazyFallback />}><BusinessInbox businessUsername={businessUsername} companyName={companyName} /></Suspense>
      );
      break;
    case 'calendar':
      subComponent = <Suspense fallback={<BizLazyFallback />}><BusinessEntCalendar businessUsername={businessUsername} companyName={companyName} /></Suspense>;
      break;
    case 'settlement':
      subComponent = <Suspense fallback={<BizLazyFallback />}><BusinessSettlement businessUsername={businessUsername} companyName={companyName} /></Suspense>;
      break;
    case 'timeline':
      subComponent = (
        <Suspense fallback={<BizLazyFallback />}>
          <BusinessTimeline userName={businessUsername} userType="business" initialProposalId={timelineProposalId || undefined} />
        </Suspense>
      );
      break;
    case 'campaign-collab':
      subComponent = (
        <Suspense fallback={<BizLazyFallback />}>
          <CampaignCollabManagement businessUsername={businessUsername} companyName={companyName} />
        </Suspense>
      );
      break;
    default:
      subComponent = null;
  }

  // Default dashboard view (matching user dashboard layout)
  const DashboardHome = () => (
    <main className="p-3 md:p-14 w-full animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 md:mb-12">
        <div className="flex items-center justify-between w-full md:w-auto">
          <h2 className="text-sm md:text-3xl font-black text-slate-900 whitespace-nowrap">
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

      <div className="flex gap-4 lg:gap-6 xl:gap-10">
        <div className="flex-1 min-w-0">
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
              <p className="text-lg md:text-2xl font-black text-slate-900">0<span className="text-sm font-bold">원</span></p>
            </div>
          </div>

          <button
            onClick={() => setCurrentSubView('links')}
            className="w-full bg-blue-600 text-white py-3 md:py-6 rounded-2xl font-black text-xs md:text-xl mb-6 md:mb-12 shadow-[0_10px_40px_rgba(37,99,235,0.3)] hover:bg-blue-500 transition-all active:scale-[0.99]"
          >
            + 새로운 포스트 & 링크 등록
          </button>

          {/* Feature Cards (matching user dashboard) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6 mb-6 md:mb-12">
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
            <div className="bg-indigo-900 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[360px] shadow-xl">
              <div>
                <h3 className="text-sm md:text-2xl font-black mb-1">라이브 커머스</h3>
                <p className="opacity-80 font-bold text-[9px] md:text-base whitespace-nowrap">실시간 소통으로 구매 전환율을 높여보세요.</p>
              </div>
              <button onClick={() => setCurrentSubView('live')} className="bg-indigo-500 text-white px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">스튜디오 입장</button>
            </div>
          </div>

          {/* Business management cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-6 md:mb-12">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-6 md:mb-12">
            <div className="bg-gradient-to-br from-amber-600 to-orange-700 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[300px] shadow-xl">
              <div>
                <h3 className="text-sm md:text-2xl font-black mb-1">📅 인플루언서 캘린더</h3>
                <p className="opacity-80 font-bold text-[9px] md:text-base">수락된 제안 일정을 캘린더로 관리하세요.</p>
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

        {/* Phone Preview - Right Side (matching user dashboard) */}
        <div className="hidden lg:block shrink-0 sticky top-6 self-start">
          <PhoneFrame
            size="sm"
            label="실시간 미리보기"
            liveUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${businessUsername}`}
            contentClassName={previewDesign.theme === 'white' ? 'bg-[#F8FAFC] text-slate-900' : 'bg-[#1E1E2E] text-white'}
          >
              {/* Profile Header */}
              <div className="pt-8 pb-4 flex flex-col items-center">
                <div className="w-14 h-14 rounded-full border-2 p-0.5 mb-2" style={{ borderColor: previewDesign.accentColor || '#2563eb' }}>
                  <img
                    src={previewProfile.avatar_url || DEFAULT_AVATAR}
                    alt=""
                    className="w-full h-full rounded-full object-cover bg-slate-800"
                  />
                </div>
                <h3 className="text-sm font-black">{previewProfile.name || companyName}</h3>
                {previewProfile.bio && (
                  <p className="text-[8px] font-medium opacity-60 mt-0.5 px-4 text-center line-clamp-2">{previewProfile.bio}</p>
                )}
              </div>

              {/* Content based on priority */}
              {previewDesign.homePriority === 'portfolio' ? (
                <>
                  {previewPortfolio.length > 0 && (
                    <div className="px-4 pb-4 space-y-3">
                      {previewPortfolio.slice(0, 4).map((section: any, idx: number) => (
                        <div key={section.id || idx}>
                          {section.type === 'text' ? (
                            <p className="text-[8px] font-medium opacity-70 leading-relaxed whitespace-pre-wrap">{section.content}</p>
                          ) : section.content ? (
                            <div className="rounded-lg overflow-hidden">
                              <img src={section.content} alt="" className="w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {previewBlocks.length > 0 && (
                    <div className={`px-3 pb-4 grid gap-1.5 ${previewDesign.gridColumns === 1 ? 'grid-cols-1' : previewDesign.gridColumns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      {previewBlocks.slice(0, 6).map(block => (
                        <div key={block.id} className={`rounded-lg overflow-hidden border ${previewDesign.theme === 'white' ? 'bg-white border-slate-100' : 'bg-white/5 border-white/10'}`}>
                          <SafeImage src={block.coverMedia} alt="" className="w-full aspect-square object-cover" />
                          <div className="p-1.5"><p className="text-[7px] font-black truncate">{block.title}</p></div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {previewBlocks.length > 0 && (
                    <div className={`px-3 pb-4 grid gap-1.5 ${previewDesign.gridColumns === 1 ? 'grid-cols-1' : previewDesign.gridColumns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      {previewBlocks.slice(0, 6).map(block => (
                        <div key={block.id} className={`rounded-lg overflow-hidden border ${previewDesign.theme === 'white' ? 'bg-white border-slate-100' : 'bg-white/5 border-white/10'}`}>
                          <SafeImage src={block.coverMedia} alt="" className="w-full aspect-square object-cover" />
                          <div className="p-1.5"><p className="text-[7px] font-black truncate">{block.title}</p></div>
                        </div>
                      ))}
                    </div>
                  )}
                  {previewPortfolio.length > 0 && (
                    <div className="px-4 pb-4 space-y-3">
                      {previewPortfolio.slice(0, 4).map((section: any, idx: number) => (
                        <div key={section.id || idx}>
                          {section.type === 'text' ? (
                            <p className="text-[8px] font-medium opacity-70 leading-relaxed whitespace-pre-wrap">{section.content}</p>
                          ) : section.content ? (
                            <div className="rounded-lg overflow-hidden">
                              <img src={section.content} alt="" className="w-full object-cover" />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Empty State */}
              {previewBlocks.length === 0 && previewPortfolio.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 opacity-40">
                  <p className="text-[10px] font-black">아직 콘텐츠가 없습니다</p>
                  <p className="text-[8px] font-medium mt-1">포스트나 포트폴리오를 추가해보세요</p>
                </div>
              )}
          </PhoneFrame>
        </div>
      </div>
    </main>
  );

  return (
    <div className={`flex flex-col md:flex-row min-h-screen bg-[#f8fafc] text-slate-800 md:pb-0 ${currentSubView === 'timeline' ? '' : 'pb-20'}`}>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-[#0b1221] text-white fixed h-full flex-col p-8 z-50">
        <div
          className="text-2xl font-black text-blue-500 tracking-tighter mb-12 cursor-pointer hover:scale-105 transition-transform"
          onClick={() => setCurrentSubView('dashboard')}
        >
          PICKSFOLIO
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem icon="🏠" label="대시보드" active={currentSubView === 'dashboard'} onClick={() => setCurrentSubView('dashboard')} />
          <NavItem icon="🔗" label="링크 & 그리드 관리" active={currentSubView === 'links'} onClick={() => setCurrentSubView('links')} />
          <NavItem icon="💼" label="포트폴리오 & 소개" active={currentSubView === 'portfolio'} onClick={() => setCurrentSubView('portfolio')} />
          <NavItem icon="🎥" label="라이브 커머스" active={currentSubView === 'live'} onClick={() => setCurrentSubView('live')} />
          <NavItem icon="📋" label="방송 설정" active={currentSubView === 'broadcast-settings'} onClick={() => setCurrentSubView('broadcast-settings')} />
          <div className="my-3 border-t border-white/10" />
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-5 py-1">비즈니스 관리</p>
          <NavItem icon="📢" label="캠페인 협업" active={currentSubView === 'campaign-collab'} onClick={() => setCurrentSubView('campaign-collab')} />
          <NavItem icon="📨" label="비즈니스 제안 현황" active={currentSubView === 'inbox'} onClick={() => setCurrentSubView('inbox')} />
          <NavItem icon="💬" label="협업 타임라인" active={currentSubView === 'timeline'} onClick={() => setCurrentSubView('timeline')} badge={timelineUnread} />
          <NavItem icon="📅" label="인플루언서 캘린더" active={currentSubView === 'calendar'} onClick={() => setCurrentSubView('calendar')} />
          <NavItem icon="🗓️" label="오픈 일정" active={currentSubView === 'open-schedule'} onClick={() => setCurrentSubView('open-schedule')} />
          <NavItem icon="💰" label="정산 관리" active={currentSubView === 'settlement'} onClick={() => setCurrentSubView('settlement')} />
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
          <NavItem icon="💎" label="멤버십 플랜" active={currentSubView === 'membership'} onClick={() => setCurrentSubView('membership')} />
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
          <MobileNavItem icon="💼" label="소개" active={currentSubView === 'portfolio'} onClick={() => setCurrentSubView('portfolio')} />
          <MobileNavItem icon="🎥" label="라이브" active={currentSubView === 'live'} onClick={() => setCurrentSubView('live')} />
          <MobileNavItem icon="📋" label="방송설정" active={currentSubView === 'broadcast-settings'} onClick={() => setCurrentSubView('broadcast-settings')} />
          <MobileNavItem icon="📢" label="캠페인" active={currentSubView === 'campaign-collab'} onClick={() => setCurrentSubView('campaign-collab')} />
          <MobileNavItem icon="📨" label="제안현황" active={currentSubView === 'inbox'} onClick={() => setCurrentSubView('inbox')} />
          <MobileNavItem icon="💬" label="타임라인" active={currentSubView === 'timeline'} onClick={() => setCurrentSubView('timeline')} badge={timelineUnread} />
          <MobileNavItem icon="📅" label="캘린더" active={currentSubView === 'calendar'} onClick={() => setCurrentSubView('calendar')} />
          <MobileNavItem icon="🗓️" label="오픈일정" active={currentSubView === 'open-schedule'} onClick={() => setCurrentSubView('open-schedule')} />
          <MobileNavItem icon="💰" label="정산" active={currentSubView === 'settlement'} onClick={() => setCurrentSubView('settlement')} />
          <MobileNavItem icon="💎" label="멤버십" active={currentSubView === 'membership'} onClick={() => setCurrentSubView('membership')} />
        </div>
      </nav>

      {/* Mobile Sidebar Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[200] animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <aside className="absolute left-0 top-0 w-64 h-full bg-[#0b1221] text-white p-8 flex flex-col animate-in slide-in-from-left duration-300">
            <div className="text-2xl font-black text-blue-500 tracking-tighter mb-12" onClick={() => { setCurrentSubView('dashboard'); setIsMobileMenuOpen(false); }}>
              PICKSFOLIO
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto">
              <NavItem icon="🏠" label="대시보드" active={currentSubView === 'dashboard'} onClick={() => { setCurrentSubView('dashboard'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="🔗" label="관리" active={currentSubView === 'links'} onClick={() => { setCurrentSubView('links'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="💼" label="소개" active={currentSubView === 'portfolio'} onClick={() => { setCurrentSubView('portfolio'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="🎥" label="라이브" active={currentSubView === 'live'} onClick={() => { setCurrentSubView('live'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📋" label="방송 설정" active={currentSubView === 'broadcast-settings'} onClick={() => { setCurrentSubView('broadcast-settings'); setIsMobileMenuOpen(false); }} />
              <div className="my-2 border-t border-white/10" />
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-5 py-1">비즈니스 관리</p>
              <NavItem icon="📢" label="캠페인 협업" active={currentSubView === 'campaign-collab'} onClick={() => { setCurrentSubView('campaign-collab'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📨" label="보낸 제안" active={currentSubView === 'inbox'} onClick={() => { setCurrentSubView('inbox'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="💬" label="협업 타임라인" active={currentSubView === 'timeline'} onClick={() => { setCurrentSubView('timeline'); setIsMobileMenuOpen(false); }} badge={timelineUnread} />
              <NavItem icon="📅" label="캘린더" active={currentSubView === 'calendar'} onClick={() => { setCurrentSubView('calendar'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="🗓️" label="오픈 일정" active={currentSubView === 'open-schedule'} onClick={() => { setCurrentSubView('open-schedule'); setIsMobileMenuOpen(false); }} />
              <NavItem icon="💰" label="정산 관리" active={currentSubView === 'settlement'} onClick={() => { setCurrentSubView('settlement'); setIsMobileMenuOpen(false); }} />
            </nav>
            <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
              <NavItem icon="💎" label="멤버십 플랜" active={currentSubView === 'membership'} onClick={() => { setCurrentSubView('membership'); setIsMobileMenuOpen(false); }} />
              <button type="button" onClick={onLogout} className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 font-bold hover:bg-white/5 hover:text-white transition-all text-sm">
                <span>👤</span><span>로그아웃</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className={`flex-1 md:ml-64 w-full ${currentSubView === 'timeline' ? 'md:min-h-screen' : 'min-h-screen'}`}>
        {subComponent ? (
          <ErrorBoundary>
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
