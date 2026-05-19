
import React, { useState, useEffect, useCallback } from 'react';
import { getStatsForRange, getTopClickedItemsForRange } from '../services/analyticsService';
import { getSiteSettings, getLinkGridItems } from '../services/settingsService';
import { prefetchLinkData } from '../services/prefetchService';
import { apiService } from '../services/apiService';
import { Block, DesignSettings, TemplateType } from '../types';
import { supabase } from '../services/supabase';
import SafeImage from './SafeImage';
import { DEFAULT_AVATAR } from '../utils/defaultAvatar';
import AITrendAnalysis from './AITrendAnalysis';
import PhoneFrame from './PhoneFrame';


import ErrorBoundary from './ErrorBoundary';

interface AdminDashboardProps {
  userName: string;
  onLogout: () => void;
  currentSubView: 'dashboard' | 'links' | 'portfolio' | 'live' | 'broadcast-settings' | 'broadcast-history' | 'business' | 'calendar' | 'membership' | 'open-schedule' | 'settlement' | 'timeline';
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
  children
}) => {
  const [stats, setStats] = useState({ views: 0, clicks: 0, ctr: 0 });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [topItemsData, setTopItemsData] = useState<{ id: string; count: number }[]>([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Phone preview state
  const [previewBlocks, setPreviewBlocks] = useState<Block[]>([]);
  const [previewDesign, setPreviewDesign] = useState<DesignSettings>({
    templateType: TemplateType.SHOPPABLE_GRID,
    theme: 'midnight',
    accentColor: '#7c3aed',
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
  const [previewProfile, setPreviewProfile] = useState<any>({ name: userName, bio: '', avatar_url: '' });
  const [previewPortfolio, setPreviewPortfolio] = useState<any[]>([]);
  const [previewSchedule, setPreviewSchedule] = useState<any[]>([]);
  const [previewMaterials, setPreviewMaterials] = useState<any[]>([]);

  const loadPreviewData = useCallback(() => {
    const u = (userName || '').toLowerCase();
    if (!u) return;

    // Load from localStorage for immediate display (optimistic UI)
    try {
      const savedBlocks = localStorage.getItem(`picks_blocks_${u}`);
      if (savedBlocks) setPreviewBlocks(JSON.parse(savedBlocks));

      const savedDesign = localStorage.getItem(`picks_design_${u}`);
      if (savedDesign) setPreviewDesign(prev => ({ ...prev, ...JSON.parse(savedDesign) }));

      const savedProfile = localStorage.getItem(`picks_profile_${u}`);
      if (savedProfile) setPreviewProfile(JSON.parse(savedProfile));

      const savedPortfolio = localStorage.getItem(`picks_portfolio_${u}`);
      if (savedPortfolio) setPreviewPortfolio(JSON.parse(savedPortfolio));

      const savedSchedule = localStorage.getItem(`picks_schedule_${u}`);
      if (savedSchedule) setPreviewSchedule(JSON.parse(savedSchedule));

      const savedMaterials = localStorage.getItem(`picks_materials_${u}`);
      if (savedMaterials) setPreviewMaterials(JSON.parse(savedMaterials));
    } catch (e) {
      console.error('Error loading preview data from localStorage:', e);
    }

    // Then fetch from API (Netlify Blobs) for authoritative data
    apiService.getSiteData(u).then(apiData => {
      if (!apiData) return;
      if (Array.isArray(apiData.blocks)) {
        setPreviewBlocks(apiData.blocks);
        localStorage.setItem(`picks_blocks_${u}`, JSON.stringify(apiData.blocks));
      }
      if (apiData.design) {
        setPreviewDesign(prev => ({ ...prev, ...(apiData.design as any) }));
        localStorage.setItem(`picks_design_${u}`, JSON.stringify(apiData.design));
      }
      if (apiData.profile) {
        setPreviewProfile(apiData.profile);
        localStorage.setItem(`picks_profile_${u}`, JSON.stringify(apiData.profile));
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
      console.warn('Error loading preview data from API:', e);
    });
  }, [userName]);

  // Load preview data and trend when returning to dashboard
  useEffect(() => {
    if (currentSubView === 'dashboard') {
      loadPreviewData();
    }
  }, [currentSubView, loadPreviewData]);

  // Listen for storage changes and visibility changes for real-time updates
  useEffect(() => {
    const handleStorageChange = () => loadPreviewData();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadPreviewData();
    };
    window.addEventListener('storage', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadPreviewData]);

  const fetchStats = async () => {
    if (!userName) return;
    try {
      console.log('Fetching stats for:', userName, startDate, endDate);
      const data = await getStatsForRange(userName, startDate, endDate);
      setStats(data || { views: 0, clicks: 0, ctr: 0 });
      
      // Fetch real blocks to show in "Top Items"
      const settings = await getSiteSettings(userName);
      if (settings && settings.blocks && settings.blocks.length > 0) {
        console.log('Fetched blocks:', settings.blocks.length);
        setBlocks(Array.isArray(settings.blocks) ? settings.blocks : []);
      } else {
        // Fallback: try link_grid_items
        const gridItems = await getLinkGridItems(userName);
        if (gridItems && gridItems.length > 0) {
          console.log('Fetched link_grid_items as fallback:', gridItems.length);
          setBlocks(gridItems);
        } else {
          setBlocks([]);
        }
      }

      // Fetch link_grid_items to map IDs to titles (for top items display)
      if (supabase) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', userName.toLowerCase())
          .maybeSingle();

        if (profileData) {
          try {
            const { data: linksData, error: linksError } = await supabase
              .from('link_grid_items')
              .select('id, title, price, image_url, link, display_order')
              .eq('user_id', profileData.id)
              .order('display_order', { ascending: true });
            if (!linksError) {
              setLinks((linksData || []).map((item: any) => ({
                id: item.id,
                title: item.title,
                image: item.image_url,
                url: item.link,
              })));
            } else {
              setLinks([]);
            }
          } catch {
            setLinks([]);
          }
        }
      }

      // Fetch real top clicked items for the selected range
      const topItems = await getTopClickedItemsForRange(userName, startDate, endDate);
      console.log('Fetched top items data:', topItems);
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

  // Map real click counts to blocks or links for the TOP 3 section
  const topItems = (Array.isArray(topItemsData) ? topItemsData.map((item, idx) => {
    if (!item || !item.id) return null;
    
    // Check blocks first
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

    // Check links if not found in blocks
    const link = Array.isArray(links) ? links.find(l => l && String(l.id) === String(item.id)) : null;
    if (link) {
      return {
        rank: idx + 1,
        name: link.title || 'Link',
        clicks: item.count || 0,
        image: link.image,
        products: []
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
        : (Array.isArray(links) && links.length > 0
            ? links.filter(Boolean).slice(0, 3).map((link, idx) => ({
                rank: idx + 1,
                name: link.title || 'Link',
                clicks: 0,
                image: link.image,
                products: []
              }))
            : []
          )
      );

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#f8fafc] text-slate-800 pb-20 md:pb-0">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-[#0b1221] text-white fixed h-full flex-col p-8 z-50">
        <div 
          className="text-2xl font-black text-purple-500 tracking-tighter mb-12 cursor-pointer hover:scale-105 transition-transform" 
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
            active={['portfolio','broadcast-settings','timeline','calendar','open-schedule','settlement','membership'].includes(currentSubView)}
            onClick={() => setIsMobileMenuOpen(true)}
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
              <NavItem icon="📨" label="수신함" active={currentSubView === 'business'} onClick={() => { onNavigateBusiness(); setIsMobileMenuOpen(false); }} />
              <NavItem icon="💬" label="협업 타임라인" active={currentSubView === 'timeline'} onClick={() => { onNavigateTimeline(); setIsMobileMenuOpen(false); }} />
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
      <div className="flex-1 md:ml-64 w-full min-h-screen pb-[calc(72px+env(safe-area-inset-bottom,0px))] md:pb-0">
        {children || (
          <ErrorBoundary>
            <main className="p-3 md:p-14 w-full animate-in fade-in duration-500">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 md:mb-12">
              <div className="flex items-center justify-between w-full md:w-auto">
                <h2 className="text-sm md:text-3xl font-black text-slate-900 whitespace-nowrap">
                  반가워요, <span className="text-purple-600">{userName}</span>님!
                </h2>
                <div className="flex flex-col gap-1 md:hidden">
                  <div className="flex items-center gap-1">
                    <input 
                      type="date" 
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-1 py-0.5 text-[8px] font-bold focus:outline-none focus:border-purple-600 w-24"
                    />
                    <span className="text-[8px] font-bold text-slate-400">~</span>
                    <input 
                      type="date" 
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-white border border-slate-200 rounded-lg px-1 py-0.5 text-[8px] font-bold focus:outline-none focus:border-purple-600 w-24"
                    />
                  </div>
                  <button 
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="p-1.5 text-slate-900 self-end"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                <div className="hidden md:flex items-center gap-3 mr-4 bg-white px-4 py-2 rounded-xl border border-slate-100 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">기간 선택</span>
                  <div className="flex items-center gap-2">
                    <input 
                      type="date" 
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-transparent border-none font-black text-sm focus:outline-none text-slate-700"
                    />
                    <span className="text-slate-300 font-black">~</span>
                    <input 
                      type="date" 
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="bg-transparent border-none font-black text-sm focus:outline-none text-slate-700"
                    />
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const url = `${window.location.origin}/${userName}`;
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-6 mb-6">
              <StatCard 
                label="방문자 수" 
                value={stats.views.toLocaleString()} 
                trend={startDate === endDate && startDate === new Date().toISOString().split('T')[0] ? '실시간' : `${startDate} ~ ${endDate}`} 
              />
              <StatCard 
                label="링크 클릭률 (CTR)" 
                value={`${stats.ctr}%`} 
                trend={startDate === endDate && startDate === new Date().toISOString().split('T')[0] ? '실시간' : undefined} 
              />
              
              <div className="bg-white p-3 md:p-8 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:col-span-2 lg:col-span-1">
                <div className="flex justify-between items-start mb-3">
                  <p className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest">
                    {startDate === endDate ? (startDate === new Date().toISOString().split('T')[0] ? '오늘' : startDate) : `${startDate} ~ ${endDate}`} 가장 많이 클릭된 아이템 TOP 3
                  </p>
                  <span className="text-[7px] md:text-[8px] font-bold text-slate-300 bg-slate-50 px-1.5 py-0.5 rounded-md">1시간마다 집계</span>
                </div>
                <div className="space-y-4 flex-1">
                  {displayTopItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-4 text-center">
                      <p className="text-[10px] md:text-xs font-bold text-slate-300">아직 클릭 데이터가 없습니다</p>
                      <p className="text-[8px] md:text-[10px] font-bold text-slate-300 mt-1">내 페이지에 방문자가 클릭하면 여기에 표시됩니다</p>
                    </div>
                  ) : displayTopItems.map((item) => (
                    <div key={item.rank} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black w-3 ${item.rank === 1 ? 'text-purple-600' : 'text-slate-300'}`}>{item.rank}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black text-slate-900 truncate">{item.name}</p>
                        </div>
                        <div className="text-[9px] font-bold text-slate-400 whitespace-nowrap">
                          {item.clicks} <span className="text-[7px] opacity-60">CLICKS</span>
                        </div>
                      </div>

                      {/* Product List for this Item (Text only) */}
                      <div className="ml-5 flex flex-wrap gap-1 pb-1">
                        {item.products && Array.isArray(item.products) && item.products.map((product: any, pIdx: number) => (
                          <div key={pIdx} className="px-2 py-0.5 rounded-md bg-slate-50 border border-slate-100 text-[8px] font-bold text-slate-500">
                            {product.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={onNavigateLinks}
              className="w-full bg-purple-600 text-white py-3 md:py-6 rounded-2xl font-black text-xs md:text-xl mb-6 md:mb-12 shadow-[0_10px_40px_rgba(124,58,237,0.3)] hover:bg-purple-500 transition-all active:scale-[0.99]"
            >
              + 새로운 포스트 & 링크 등록
            </button>

            <section className="mb-6 md:mb-12">
              <AITrendAnalysis userName={userName} embedded />
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-6 md:mb-12">
               <div className="bg-slate-900 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[360px] shadow-xl">
                  <div>
                    <h3 className="text-sm md:text-2xl font-black mb-1">포트폴리오 & 소개</h3>
                    <p className="opacity-80 font-bold text-[9px] md:text-base whitespace-nowrap">프로필과 포트폴리오를 관리하세요.</p>
                  </div>
                  <button onClick={onNavigatePortfolio} className="bg-purple-600 text-white px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">포트폴리오 관리</button>
               </div>
               <div className="bg-indigo-900 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[360px] shadow-xl">
                  <div>
                    <h3 className="text-sm md:text-2xl font-black mb-1">라이브 커머스</h3>
                    <p className="opacity-80 font-bold text-[9px] md:text-base whitespace-nowrap">실시간 소통으로 구매 전환율을 높여보세요.</p>
                  </div>
                  <button onClick={onNavigateLive} className="bg-indigo-500 text-white px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">스튜디오 입장</button>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-6 mb-6 md:mb-12">
               <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[300px] shadow-xl">
                  <div>
                    <h3 className="text-sm md:text-2xl font-black mb-1">📨 비즈니스 수신함</h3>
                    <p className="opacity-80 font-bold text-[9px] md:text-base">브랜드로부터 받은 협업 제안을 확인하세요.</p>
                  </div>
                  <button onClick={onNavigateBusiness} className="bg-white text-emerald-700 px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">수신함 보기</button>
               </div>
               <div className="bg-gradient-to-br from-amber-600 to-orange-700 rounded-[1rem] md:rounded-[2.5rem] p-4 md:p-10 text-white flex flex-col justify-between min-h-[210px] md:min-h-[300px] shadow-xl">
                  <div>
                    <h3 className="text-sm md:text-2xl font-black mb-1">📅 협업 캘린더</h3>
                    <p className="opacity-80 font-bold text-[9px] md:text-base">수락된 제안 일정을 캘린더로 관리하세요.</p>
                  </div>
                  <button onClick={onNavigateCalendar} className="bg-white text-amber-700 px-4 py-1.5 rounded-lg font-black text-[9px] md:text-sm w-fit mt-2">캘린더 보기</button>
               </div>
            </div>

            <div className="mb-6">
              <h4 className="text-base md:text-xl font-black text-slate-900 mb-4 md:mb-6">빠른 관리</h4>
              <div className="grid grid-cols-1 gap-6">
                <ActionCard icon="🎨" title="링크 & 테마 꾸미기" desc="내 페이지의 템플릿과 디자인을 자유롭게 변경합니다." onClick={onNavigateLinks} />
              </div>
            </div>

            {/* Personal Data Overview */}
            <div className="mb-6 md:mb-12">
              <h4 className="text-base md:text-xl font-black text-slate-900 mb-4 md:mb-6">내 데이터 현황</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                <div onClick={onNavigateLinks} className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-purple-300 transition-all">
                  <div className="text-lg md:text-2xl mb-1">🔗</div>
                  <p className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-0.5">상품 블록</p>
                  <p className="text-lg md:text-2xl font-black text-slate-900">{previewBlocks.length}<span className="text-xs md:text-sm text-slate-400 ml-1">개</span></p>
                </div>
                <div onClick={onNavigatePortfolio} className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-purple-300 transition-all">
                  <div className="text-lg md:text-2xl mb-1">💼</div>
                  <p className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-0.5">포트폴리오</p>
                  <p className="text-lg md:text-2xl font-black text-slate-900">{previewPortfolio.length}<span className="text-xs md:text-sm text-slate-400 ml-1">개</span></p>
                </div>
                <div onClick={onNavigateOpenSchedule} className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-purple-300 transition-all">
                  <div className="text-lg md:text-2xl mb-1">🗓️</div>
                  <p className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-0.5">오픈 일정</p>
                  <p className="text-lg md:text-2xl font-black text-slate-900">{previewSchedule.filter((s: any) => s.isActive).length}<span className="text-xs md:text-sm text-slate-400 ml-1">개</span></p>
                </div>
                <div onClick={onNavigateLive} className="bg-white p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-purple-300 transition-all">
                  <div className="text-lg md:text-2xl mb-1">🎥</div>
                  <p className="text-slate-400 text-[8px] md:text-[10px] font-black uppercase tracking-widest mb-0.5">방송 자료</p>
                  <p className="text-lg md:text-2xl font-black text-slate-900">{previewMaterials.length}<span className="text-xs md:text-sm text-slate-400 ml-1">개</span></p>
                </div>
              </div>
            </div>
              </div>

              {/* Phone Preview - Right Side */}
              <div className="hidden lg:block shrink-0 sticky top-6 self-start">
                <PhoneFrame
                  size="sm"
                  label="실시간 미리보기"
                  liveUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${userName}`}
                  contentClassName={previewDesign.theme === 'white' ? 'bg-[#F8FAFC] text-slate-900' : 'bg-[#1E1E2E] text-white'}
                >
                    {/* Profile Header */}
                    <div className="pt-8 pb-4 flex flex-col items-center">
                      <div className="w-14 h-14 rounded-full border-2 p-0.5 mb-2" style={{ borderColor: previewDesign.accentColor || '#7c3aed' }}>
                        <img
                          src={previewProfile.avatar_url || DEFAULT_AVATAR}
                          alt=""
                          className="w-full h-full rounded-full object-cover bg-slate-800"
                        />
                      </div>
                      <h3 className="text-sm font-black">{previewProfile.name || userName}</h3>
                      {previewProfile.bio && (
                        <p className="text-[8px] font-medium opacity-60 mt-0.5 px-4 text-center line-clamp-2">{previewProfile.bio}</p>
                      )}
                    </div>

                    {/* Content based on priority */}
                    {previewDesign.homePriority === 'portfolio' ? (
                      <>
                        {/* Portfolio First */}
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
                        {/* Then Blocks Grid */}
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
                        {/* Blocks Grid First */}
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
                        {/* Then Portfolio */}
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
        </ErrorBoundary>
        )}
      </div>
    </div>
  );
};

const MobileNavItem: React.FC<{ icon: string; label: string; active?: boolean; onClick?: () => void; onMouseEnter?: () => void }> = ({ icon, label, active, onClick, onMouseEnter }) => (
  <button
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all min-h-[44px] ${active ? 'text-purple-400' : 'text-slate-500'}`}
  >
    <span className="text-lg leading-none mb-0.5">{icon}</span>
    <span className="text-[11px] font-black tracking-tighter whitespace-nowrap">{label}</span>
  </button>
);

const NavItem: React.FC<{ icon: string; label: string; active?: boolean; onClick?: () => void; onMouseEnter?: () => void }> = ({ icon, label, active, onClick, onMouseEnter }) => (
  <button 
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    className={`w-full flex items-center space-x-3 px-5 py-4 rounded-2xl font-black text-sm transition-all text-left relative group ${
      active 
      ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-900/40' 
      : 'text-slate-400 hover:bg-white/5 hover:text-white'
    }`}
  >
    {active && (
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full"></div>
    )}
    <span className={`text-lg transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-110'}`}>{icon}</span>
    <span className={`transition-all duration-300 ${active ? 'translate-x-1' : 'group-hover:translate-x-1'}`}>{label}</span>
  </button>
);

const StatCard: React.FC<{ id?: string; label: string; value: string; trend?: string }> = ({ id, label, value, trend }) => (
  <div id={id} className="bg-white p-3 md:p-8 rounded-2xl border border-slate-100 shadow-sm">
    <p className="text-slate-400 text-[8px] md:text-xs font-black uppercase tracking-widest mb-1.5 md:mb-3 whitespace-nowrap">{label}</p>
    <div className="flex items-end space-x-2 md:space-x-3">
      <span className="text-base md:text-3xl font-black text-slate-900 whitespace-nowrap">{value}</span>
      {trend && <span className="text-[9px] md:text-sm font-black text-purple-600 mb-0.5 whitespace-nowrap">{trend}</span>}
    </div>
  </div>
);

const ActionCard: React.FC<{ icon: string; title: string; desc: string; onClick?: () => void }> = ({ icon, title, desc, onClick }) => (
  <div
    onClick={onClick}
    className="bg-white p-4 md:p-8 rounded-xl md:rounded-[2rem] border border-slate-100 flex items-center space-x-3 md:space-x-6 cursor-pointer hover:border-purple-600 hover:-translate-y-1 transition-all group shadow-sm"
  >
    <div className="w-10 h-10 md:w-16 md:h-16 bg-slate-50 rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-3xl group-hover:bg-purple-50 transition-all shrink-0">
      {icon}
    </div>
    <div>
      <h5 className="font-black text-sm md:text-lg text-slate-900 group-hover:text-purple-600 transition-all">{title}</h5>
      <p className="text-slate-500 text-xs md:text-sm font-medium leading-tight">{desc}</p>
    </div>
  </div>
);

export default AdminDashboard;
