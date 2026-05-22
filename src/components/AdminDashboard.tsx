
import React, { useState, useEffect, useCallback } from 'react';
import { getStatsForRange, getTopClickedItemsForRange } from '../services/analyticsService';
import { getSiteSettings } from '../services/settingsService';
import { prefetchLinkData } from '../services/prefetchService';
import { apiService } from '../services/apiService';
import { Block } from '../types';
import AITrendAnalysis from './AITrendAnalysis';


import ErrorBoundary from './ErrorBoundary';

interface AdminDashboardProps {
  userName: string;
  onLogout: () => void;
  currentSubView: 'dashboard' | 'links' | 'portfolio' | 'live' | 'broadcast-settings' | 'broadcast-history' | 'business' | 'calendar' | 'membership' | 'open-schedule' | 'settlement' | 'timeline' | 'campaigns';
  onNavigateDashboard: () => void;
  onNavigateLinks: () => void;
  onNavigatePortfolio: () => void;
  onNavigateLive: () => void;
  onNavigateBroadcastSettings: () => void;
  onNavigateBusiness: () => void;
  onNavigateCalendar: () => void;
  onNavigateMembership: () => void;
  onNavigateOpenSchedule: () => void;
  onNavigateSettlement: () => void;
  onNavigateTimeline: () => void;
  onNavigateCampaigns: () => void;
  children?: React.ReactNode;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({
  userName,
  onLogout,
  currentSubView,
  onNavigateDashboard,
  onNavigateLinks,
  onNavigatePortfolio,
  onNavigateLive,
  onNavigateBroadcastSettings,
  onNavigateBusiness,
  onNavigateCalendar,
  onNavigateMembership,
  onNavigateOpenSchedule,
  onNavigateSettlement,
  onNavigateTimeline,
  onNavigateCampaigns,
  children
}) => {
  const [stats, setStats] = useState({ views: 0, clicks: 0, ctr: 0 });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [topItemsData, setTopItemsData] = useState<{ id: string; count: number }[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [timelineUnread, setTimelineUnread] = useState(0);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Dashboard data counts
  const [previewBlocks, setPreviewBlocks] = useState<Block[]>([]);
  const [previewPortfolio, setPreviewPortfolio] = useState<any[]>([]);
  const [previewSchedule, setPreviewSchedule] = useState<any[]>([]);
  const [previewMaterials, setPreviewMaterials] = useState<any[]>([]);

  const loadDashboardCounts = useCallback(() => {
    const u = (userName || '').toLowerCase();
    if (!u) return;

    try {
      const savedBlocks = localStorage.getItem(`picks_blocks_${u}`);
      if (savedBlocks) setPreviewBlocks(JSON.parse(savedBlocks));

      const savedPortfolio = localStorage.getItem(`picks_portfolio_${u}`);
      if (savedPortfolio) setPreviewPortfolio(JSON.parse(savedPortfolio));

      const savedSchedule = localStorage.getItem(`picks_schedule_${u}`);
      if (savedSchedule) setPreviewSchedule(JSON.parse(savedSchedule));

      const savedMaterials = localStorage.getItem(`picks_materials_${u}`);
      if (savedMaterials) setPreviewMaterials(JSON.parse(savedMaterials));
    } catch (e) {
      console.error('Error loading dashboard data from localStorage:', e);
    }

    apiService.getSiteData(u).then(apiData => {
      if (!apiData) return;
      if (Array.isArray(apiData.blocks)) {
        setPreviewBlocks(apiData.blocks);
        localStorage.setItem(`picks_blocks_${u}`, JSON.stringify(apiData.blocks));
      }
      if (apiData.portfolio) {
        setPreviewPortfolio(apiData.portfolio);
        localStorage.setItem(`picks_portfolio_${u}`, JSON.stringify(apiData.portfolio));
      }
      if (apiData.openSchedule) {
        setPreviewSchedule(apiData.openSchedule);
        localStorage.setItem(`picks_schedule_${u}`, JSON.stringify(apiData.openSchedule));
      }
      if (apiData.materials) {
        setPreviewMaterials(apiData.materials);
        localStorage.setItem(`picks_materials_${u}`, JSON.stringify(apiData.materials));
      }
    }).catch(e => {
      console.warn('Error loading dashboard data from API:', e);
    });
  }, [userName]);

  useEffect(() => {
    if (currentSubView === 'dashboard') {
      loadDashboardCounts();
    }
  }, [currentSubView, loadDashboardCounts]);

  useEffect(() => {
    if (!userName) return;
    const normalizedName = userName.toLowerCase();
    const cacheKey = `picks_timelines_influencer_${normalizedName}`;
    const fetchUnread = async () => {
      try {
        const res = await fetch(`/api/timeline/list/${normalizedName}?type=influencer`);
        const data = await res.json();
        if (data.timelines) {
          const total = (data.timelines as { unreadCount?: number }[]).reduce((sum, t) => sum + (t.unreadCount || 0), 0);
          setTimelineUnread(total);
          try { localStorage.setItem(cacheKey, JSON.stringify(data.timelines)); } catch {}
        }
      } catch {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [userName]);

  const fetchStats = async () => {
    if (!userName) return;
    try {
      console.log('Fetching stats for:', userName, startDate, endDate);
      const data = await getStatsForRange(userName, startDate, endDate);
      setStats(data || { views: 0, clicks: 0, ctr: 0 });

      // Fetch blocks from site settings (API -> Supabase -> localStorage cascade)
      const settings = await getSiteSettings(userName);
      if (settings && settings.blocks && settings.blocks.length > 0) {
        setBlocks(Array.isArray(settings.blocks) ? settings.blocks : []);
      } else {
        setBlocks([]);
      }

      // Fetch real top clicked items for the selected range
      const topItems = await getTopClickedItemsForRange(userName, startDate, endDate);
      setTopItemsData(Array.isArray(topItems) ? topItems : []);
    } catch (e) {
      console.error('Error fetching stats:', e);
    }
  };

  useEffect(() => {
    fetchStats();
    // Only auto-refresh if the end date is today
    const today = new Date().toISOString().split('T')[0];
    if (endDate === today) {
      const interval = setInterval(fetchStats, 3600000); // Update every hour
      return () => clearInterval(interval);
    }
  }, [userName, startDate, endDate]);

  // Map real click counts to blocks for the TOP 3 section
  const topItems = (Array.isArray(topItemsData) ? topItemsData.map((item, idx) => {
    if (!item || !item.id) return null;

    const block = Array.isArray(blocks) ? blocks.find(b => b && String(b.id) === String(item.id)) : null;
    if (block) {
      return {
        rank: idx + 1,
        name: block.title || 'Untitled',
        clicks: item.count || 0,
        image: block.coverMedia,
        products: block.products || []
      };
    }

    return null;
  }).filter(Boolean) : []).slice(0, 3) as any[];

  // If no real clicks yet, show first 3 blocks as placeholders
  const displayTopItems = topItems.length > 0
    ? topItems
    : (Array.isArray(blocks) && blocks.length > 0
        ? blocks.filter(Boolean).slice(0, 3).map((block, idx) => ({
            rank: idx + 1,
            name: block.title || 'Untitled',
            clicks: 0,
            image: block.coverMedia,
            products: block.products || []
          }))
        : []
      );

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#f8fafc] text-slate-800 pb-20 md:pb-0">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-60 bg-[#0b1221] text-white fixed h-full flex-col p-6 z-50">
        <div
          className="text-xl font-black text-purple-500 tracking-tighter mb-8 cursor-pointer hover:scale-105 transition-transform"
          onClick={onNavigateDashboard}
        >
          PICKSFOLIO
        </div>
        
        <nav className="flex-1 space-y-1">
          <NavItem 
            icon="🏠" 
            label="대시보드" 
            active={currentSubView === 'dashboard'} 
            onClick={onNavigateDashboard}
          />
          <NavItem 
            icon="🔗" 
            label="링크 & 그리드 관리" 
            active={currentSubView === 'links'} 
            onClick={onNavigateLinks}
            onMouseEnter={() => prefetchLinkData(userName)}
          />
          <NavItem
            icon="💼"
            label="포트폴리오 & 소개"
            active={currentSubView === 'portfolio'}
            onClick={onNavigatePortfolio}
          />
          <NavItem
            icon="🎥"
            label="라이브 커머스"
            active={currentSubView === 'live'}
            onClick={onNavigateLive}
          />
          <NavItem
            icon="📋"
            label="방송 설정"
            active={currentSubView === 'broadcast-settings'}
            onClick={onNavigateBroadcastSettings}
          />
          <div className="my-3 border-t border-white/10" />
          <NavItem
            icon="📢"
            label="캠페인 협업"
            active={currentSubView === 'campaigns'}
            onClick={onNavigateCampaigns}
          />
          <NavItem
            icon="📨"
            label="비즈니스 수신함"
            active={currentSubView === 'business'}
            onClick={onNavigateBusiness}
          />
          <NavItem
            icon="💬"
            label="협업 타임라인"
            active={currentSubView === 'timeline'}
            onClick={onNavigateTimeline}
            badge={timelineUnread}
          />
          <NavItem
            icon="📅"
            label="협업 캘린더"
            active={currentSubView === 'calendar'}
            onClick={onNavigateCalendar}
          />
          <NavItem
            icon="🗓️"
            label="오픈 일정"
            active={currentSubView === 'open-schedule'}
            onClick={onNavigateOpenSchedule}
          />
          <NavItem
            icon="💰"
            label="정산 현황"
            active={currentSubView === 'settlement'}
            onClick={onNavigateSettlement}
          />
        </nav>

        <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
          <NavItem
            icon="💎"
            label="멤버십 플랜"
            active={currentSubView === 'membership'}
            onClick={onNavigateMembership}
          />
          <button
            type="button"
            onClick={() => {
              console.log('Logout button clicked');
              onLogout();
            }}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 font-bold hover:bg-white/5 hover:text-white transition-all text-sm cursor-pointer"
          >
            <span>👤</span>
            <span>로그아웃</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-[#0b1221] text-white z-[100] border-t border-white/10 fixed-bottom-nav">
        <div className="grid grid-cols-5 px-1 py-2 gap-0.5">
          <MobileNavItem icon="🏠" label="홈" active={currentSubView === 'dashboard'} onClick={() => { onNavigateDashboard(); setIsMobileMenuOpen(false); }} />
          <MobileNavItem
            icon="🔗"
            label="관리"
            active={currentSubView === 'links'}
            onClick={() => { onNavigateLinks(); setIsMobileMenuOpen(false); }}
            onMouseEnter={() => prefetchLinkData(userName)}
          />
          <MobileNavItem icon="🎥" label="라이브" active={currentSubView === 'live'} onClick={() => { onNavigateLive(); setIsMobileMenuOpen(false); }} />
          <MobileNavItem icon="📨" label="수신함" active={currentSubView === 'business'} onClick={() => { onNavigateBusiness(); setIsMobileMenuOpen(false); }} />
          <MobileNavItem
            icon="⋯"
            label="더보기"
            active={['portfolio','broadcast-settings','timeline','calendar','open-schedule','settlement','membership','campaigns'].includes(currentSubView)}
            onClick={() => setIsMobileMenuOpen(true)}
            badge={timelineUnread}
          />
        </div>
      </nav>

      {/* Mobile Sidebar Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[200] animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}></div>
          <aside className="absolute left-0 top-0 w-72 max-w-[85vw] h-full bg-[#0b1221] text-white p-6 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] flex flex-col animate-in slide-in-from-left duration-300 overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between mb-8">
              <div className="text-2xl font-black text-purple-500 tracking-tighter" onClick={() => { onNavigateDashboard(); setIsMobileMenuOpen(false); }}>
                PICKSFOLIO
              </div>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:bg-white/5 hover:text-white"
              >
                ✕
              </button>
            </div>
            <nav className="flex-1 space-y-1">
              <NavItem icon="🏠" label="대시보드" active={currentSubView === 'dashboard'} onClick={() => { onNavigateDashboard(); setIsMobileMenuOpen(false); }} />
              <NavItem
                icon="🔗"
                label="관리"
                active={currentSubView === 'links'}
                onClick={() => { onNavigateLinks(); setIsMobileMenuOpen(false); }}
                onMouseEnter={() => prefetchLinkData(userName)}
              />
              <NavItem icon="💼" label="소개" active={currentSubView === 'portfolio'} onClick={() => { onNavigatePortfolio(); setIsMobileMenuOpen(false); }} />
              <NavItem icon="🎥" label="라이브" active={currentSubView === 'live'} onClick={() => { onNavigateLive(); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📋" label="방송 설정" active={currentSubView === 'broadcast-settings'} onClick={() => { onNavigateBroadcastSettings(); setIsMobileMenuOpen(false); }} />
              <div className="my-2 border-t border-white/10" />
              <NavItem icon="📢" label="캠페인 협업" active={currentSubView === 'campaigns'} onClick={() => { onNavigateCampaigns(); setIsMobileMenuOpen(false); }} />
              <NavItem icon="📨" label="수신함" active={currentSubView === 'business'} onClick={() => { onNavigateBusiness(); setIsMobileMenuOpen(false); }} />
              <NavItem icon="💬" label="협업 타임라인" active={currentSubView === 'timeline'} onClick={() => { onNavigateTimeline(); setIsMobileMenuOpen(false); }} badge={timelineUnread} />
              <NavItem icon="📅" label="캘린더" active={currentSubView === 'calendar'} onClick={() => { onNavigateCalendar(); setIsMobileMenuOpen(false); }} />
              <NavItem icon="🗓️" label="오픈 일정" active={currentSubView === 'open-schedule'} onClick={() => { onNavigateOpenSchedule(); setIsMobileMenuOpen(false); }} />
              <NavItem icon="💰" label="정산 현황" active={currentSubView === 'settlement'} onClick={() => { onNavigateSettlement(); setIsMobileMenuOpen(false); }} />
            </nav>
            <div className="mt-auto pt-6 border-t border-white/5 space-y-2">
              <NavItem icon="💎" label="멤버십 플랜" active={currentSubView === 'membership'} onClick={() => { onNavigateMembership(); setIsMobileMenuOpen(false); }} />
              <button
                type="button"
                onClick={() => {
                  console.log('Mobile logout button clicked');
                  onLogout();
                }}
                className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-slate-400 font-bold hover:bg-white/5 hover:text-white transition-all text-sm cursor-pointer"
              >
                <span>👤</span>
                <span>로그아웃</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 md:ml-60 w-full min-h-screen pb-[calc(72px+env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="w-full page-scale-content">
        {children || (
          <ErrorBoundary>
            <main className="p-4 md:p-14 w-full animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-6 md:mb-10">
              <div className="flex items-center justify-between w-full md:w-auto">
                <h2 className="text-base md:text-3xl font-black text-slate-900 whitespace-nowrap">
                  반가워요, <span className="text-purple-600">{userName}</span>님!
                </h2>
                <button
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="p-1.5 text-slate-900 md:hidden"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl border border-slate-100 shadow-sm">
                  <span className="hidden md:inline text-[10px] font-black text-slate-400 uppercase tracking-widest">기간</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-transparent border-none font-bold text-[10px] md:text-sm focus:outline-none text-slate-700 w-[100px] md:w-auto"
                  />
                  <span className="text-slate-300 font-bold text-xs">~</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-transparent border-none font-bold text-[10px] md:text-sm focus:outline-none text-slate-700 w-[100px] md:w-auto"
                  />
                </div>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/${userName}`;
                    window.open(url, '_blank');
                  }}
                  className="bg-slate-900 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-black text-[10px] md:text-sm hover:bg-slate-800 transition-all shadow-lg flex items-center gap-2"
                >
                  <span className="hidden md:inline">내 페이지 보기</span>
                  <span className="md:hidden">내 링크</span>
                  <svg className="w-3 h-3 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                </button>
              </div>
            </header>

            <div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5 mb-6 md:mb-8">
              <StatCard
                label="방문자 수"
                value={stats.views.toLocaleString()}
                trend={startDate === endDate && startDate === new Date().toISOString().split('T')[0] ? '실시간' : undefined}
              />
              <StatCard
                label="링크 클릭률"
                value={`${stats.ctr}%`}
                trend={startDate === endDate && startDate === new Date().toISOString().split('T')[0] ? '실시간' : undefined}
              />

              <div className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm col-span-2 lg:col-span-1">
                <p className="text-slate-400 text-[9px] md:text-xs font-black uppercase tracking-widest mb-3">클릭 TOP 3</p>
                {displayTopItems.length === 0 ? (
                  <p className="text-xs text-slate-300 font-bold">데이터 수집 중</p>
                ) : (
                  <div className="space-y-2.5">
                    {displayTopItems.map((item) => (
                      <div key={item.rank} className="flex items-center gap-2.5">
                        <span className={`text-xs font-black w-4 ${item.rank === 1 ? 'text-purple-600' : 'text-slate-300'}`}>{item.rank}</span>
                        <p className="text-xs font-bold text-slate-900 truncate flex-1">{item.name}</p>
                        <span className="text-[10px] font-bold text-slate-400">{item.clicks}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={onNavigateLinks}
              className="w-full bg-purple-600 text-white py-3 md:py-5 rounded-2xl font-black text-xs md:text-lg mb-6 md:mb-8 shadow-[0_8px_30px_rgba(124,58,237,0.25)] hover:bg-purple-500 transition-all active:scale-[0.99]"
            >
              + 새로운 포스트 & 링크 등록
            </button>

            {/* AI Trend */}
            <section className="mb-6 md:mb-8">
              <AITrendAnalysis userName={userName} embedded />
            </section>

            {/* Campaign Collaboration CTA */}
            <button
              onClick={onNavigateCampaigns}
              className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-500 text-white py-4 md:py-5 rounded-2xl font-black text-sm md:text-lg mb-6 md:mb-8 shadow-[0_8px_30px_rgba(124,58,237,0.25)] hover:shadow-[0_12px_40px_rgba(124,58,237,0.35)] transition-all active:scale-[0.99] flex items-center justify-center gap-3"
            >
              <span className="text-xl">🤝</span>
              캠페인 협업하기
              <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
            </button>

            {/* Quick Access Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
              <QuickCard icon="💼" label="포트폴리오" onClick={onNavigatePortfolio} />
              <QuickCard icon="🎥" label="라이브 커머스" onClick={onNavigateLive} />
              <QuickCard icon="📨" label="비즈니스 수신함" onClick={onNavigateBusiness} />
              <QuickCard icon="📅" label="협업 캘린더" onClick={onNavigateCalendar} />
            </div>

            {/* Data Overview */}
            <div className="mb-6 md:mb-8">
              <h4 className="text-sm md:text-lg font-black text-slate-900 mb-3 md:mb-4">내 데이터 현황</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
                <DataCard icon="🔗" label="상품 블록" count={previewBlocks.length} onClick={onNavigateLinks} />
                <DataCard icon="💼" label="포트폴리오" count={previewPortfolio.length} onClick={onNavigatePortfolio} />
                <DataCard icon="🗓️" label="오픈 일정" count={previewSchedule.filter((s: any) => s.isActive).length} onClick={onNavigateOpenSchedule} />
                <DataCard icon="🎥" label="방송 자료" count={previewMaterials.length} onClick={onNavigateLive} />
              </div>
            </div>
            </div>
          </main>
        </ErrorBoundary>
        )}
        </div>
      </div>
    </div>
  );
};

const MobileNavItem: React.FC<{ icon: string; label: string; active?: boolean; onClick?: () => void; onMouseEnter?: () => void; badge?: number }> = ({ icon, label, active, onClick, onMouseEnter, badge }) => (
  <button
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all min-h-[44px] relative ${active ? 'text-purple-400' : 'text-slate-500'}`}
  >
    <span className="text-lg leading-none mb-0.5 relative">
      {icon}
      {badge != null && badge > 0 && (
        <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[8px] font-bold min-w-[14px] h-[14px] flex items-center justify-center px-0.5 rounded-full">{badge > 99 ? '99+' : badge}</span>
      )}
    </span>
    <span className="text-[11px] font-black tracking-tighter whitespace-nowrap">{label}</span>
  </button>
);

const NavItem: React.FC<{ icon: string; label: string; active?: boolean; onClick?: () => void; onMouseEnter?: () => void; badge?: number }> = ({ icon, label, active, onClick, onMouseEnter, badge }) => (
  <button
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-black text-sm transition-all text-left relative group ${
      active
      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-900/40'
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

const StatCard: React.FC<{ id?: string; label: string; value: string; trend?: string }> = ({ id, label, value, trend }) => (
  <div id={id} className="bg-white p-4 md:p-6 rounded-2xl border border-slate-100 shadow-sm">
    <p className="text-slate-400 text-[9px] md:text-xs font-black uppercase tracking-widest mb-2 md:mb-3">{label}</p>
    <div className="flex items-end gap-2">
      <span className="text-xl md:text-3xl font-black text-slate-900">{value}</span>
      {trend && <span className="text-[10px] md:text-sm font-black text-purple-600 mb-0.5">{trend}</span>}
    </div>
  </div>
);

const QuickCard: React.FC<{ icon: string; label: string; onClick?: () => void }> = ({ icon, label, onClick }) => (
  <button
    onClick={onClick}
    className="bg-white p-4 md:p-5 rounded-2xl border border-slate-100 shadow-sm hover:border-purple-300 hover:shadow-md transition-all text-left group"
  >
    <span className="text-xl md:text-2xl block mb-2 group-hover:scale-110 transition-transform">{icon}</span>
    <p className="text-xs md:text-sm font-black text-slate-900">{label}</p>
  </button>
);

const DataCard: React.FC<{ icon: string; label: string; count: number; onClick?: () => void }> = ({ icon, label, count, onClick }) => (
  <div onClick={onClick} className="bg-white p-3 md:p-5 rounded-xl md:rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-purple-300 transition-all">
    <span className="text-base md:text-xl block mb-1">{icon}</span>
    <p className="text-slate-400 text-[9px] md:text-[10px] font-black uppercase tracking-widest mb-0.5">{label}</p>
    <p className="text-lg md:text-xl font-black text-slate-900">{count}<span className="text-xs text-slate-400 ml-1">개</span></p>
  </div>
);

export default AdminDashboard;
