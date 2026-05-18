import React, { useEffect, useState, useMemo } from 'react';
import { Instagram, Youtube, Globe, ExternalLink, Share2, Radio, Users } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Block, DesignSettings, TemplateType } from '../types';
import { supabase } from '../services/supabase';
import { trackView, trackClick } from '../services/analyticsService';
import { getLinkGridItems } from '../services/settingsService';
import SafeImage from './SafeImage';
import LiveStream from './LiveStream';

interface UserPageProps {
  username: string;
}

interface ProfileData {
  full_name: string;
  bio: string;
  avatar_url?: string;
}

interface LinkData {
  id: string;
  title: string;
  url: string;
  image?: string;
  category?: string;
}

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800';

const UserPage: React.FC<UserPageProps> = ({ username }) => {
  const normalizedUsername = useMemo(() => (username || '').toLowerCase(), [username]);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_blocks_${normalizedUsername}`);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing blocks:', e);
    }
    return [];
  });

  const [design, setDesign] = useState<DesignSettings>(() => {
    const defaultDesign: DesignSettings = {
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
      customGradient: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      profileLayout: 'center',
      homePriority: 'products'
    };

    try {
      if (!normalizedUsername) return defaultDesign;
      const saved = localStorage.getItem(`picks_design_${normalizedUsername}`);
      if (saved) return { ...defaultDesign, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return defaultDesign;
  });

  const [portfolioSections, setPortfolioSections] = useState<any[]>(() => {
    try {
      if (!normalizedUsername) return [];
      const saved = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing portfolio:', e);
    }
    return [];
  });

  const [socials, setSocials] = useState(() => {
    const defaultSocials = { instagram: '', youtube: '', tiktok: '', phone: '', kakao: '', naver: '' };
    try {
      if (!normalizedUsername) return defaultSocials;
      const saved = localStorage.getItem(`picks_socials_${normalizedUsername}`);
      if (saved) return { ...defaultSocials, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Error parsing socials:', e);
    }
    return defaultSocials;
  });

  const [profile, setProfile] = useState<ProfileData | null>(() => {
    try {
      if (!normalizedUsername) return null;
      const saved = localStorage.getItem(`picks_profile_${normalizedUsername}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { full_name: parsed.name, bio: parsed.bio, avatar_url: parsed.avatar_url };
      }
    } catch (e) {
      console.error('Error parsing profile:', e);
    }
    return null;
  });
  const [links, setLinks] = useState<LinkData[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [showLiveModal, setShowLiveModal] = useState(false);
  const [liveState, setLiveState] = useState<{ isLive: boolean; currentProduct?: any; viewerCount: number }>({
    isLive: false,
    viewerCount: 0
  });

  useEffect(() => {
    const loadData = async () => {
      // Load from LocalStorage first for immediate UI update (Optimistic)
      const savedBlocks = localStorage.getItem(`picks_blocks_${normalizedUsername}`);
      const savedDesign = localStorage.getItem(`picks_design_${normalizedUsername}`);
      const savedPortfolio = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);
      const savedSocials = localStorage.getItem(`picks_socials_${normalizedUsername}`);
      const savedProfile = localStorage.getItem(`picks_profile_${normalizedUsername}`);
      const savedLive = localStorage.getItem(`picks_live_${normalizedUsername}`);
      
      if (savedBlocks) {
        try {
          const parsed = JSON.parse(savedBlocks);
          setBlocks(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.error('Error parsing blocks:', e);
        }
      }
      if (savedDesign) {
        try {
          setDesign(prev => ({ ...prev, ...JSON.parse(savedDesign) }));
        } catch (e) {
          console.error('Error parsing design:', e);
        }
      }
      if (savedPortfolio) {
        try {
          const parsed = JSON.parse(savedPortfolio);
          setPortfolioSections(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.error('Error parsing portfolio:', e);
        }
      }
      if (savedSocials) {
        try {
          setSocials(JSON.parse(savedSocials));
        } catch (e) {
          console.error('Error parsing socials:', e);
        }
      }
      if (savedLive) {
        try {
          const parsed = JSON.parse(savedLive);
          setLiveState({
            isLive: parsed.isLive,
            currentProduct: parsed.currentProduct,
            viewerCount: parsed.viewerCount || 0
          });
        } catch (e) {
          console.error('Error parsing live:', e);
        }
      }
      if (savedProfile) {
        try {
          const parsed = JSON.parse(savedProfile);
          setProfile({ full_name: parsed.name, bio: parsed.bio, avatar_url: parsed.avatar_url });
        } catch (e) {
          console.error('Error parsing profile:', e);
        }
      }

      try {
        // 1. Fetch Profile and Site Data from Supabase (Cloud Sync - Highest Priority)
        if (supabase) {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('full_name, bio, avatar_url, site_data')
            .eq('username', username)
            .maybeSingle();
          
          if (!profileError && profileData) {
            setProfile(profileData);
            
            // 2. Fetch Link Grid Items (New Source of Truth for Blocks)
            const cloudBlocks = await getLinkGridItems(username);
            if (cloudBlocks && cloudBlocks.length > 0) {
              setBlocks(cloudBlocks);
              localStorage.setItem(`picks_blocks_${normalizedUsername}`, JSON.stringify(cloudBlocks));
            }

            // Use site_data if available
            if (profileData.site_data) {
              const cloud = profileData.site_data;
              
              const hasCloudBlocks = cloud.blocks && cloud.blocks.length > 0;
              const hasLocalBlocks = savedBlocks && JSON.parse(savedBlocks).length > 0;
              
              // Only fallback to site_data.blocks if link_grid_items was empty
              if ((!cloudBlocks || cloudBlocks.length === 0) && (hasCloudBlocks || !hasLocalBlocks)) {
                if (cloud.blocks) setBlocks(Array.isArray(cloud.blocks) ? cloud.blocks : []);
                localStorage.setItem(`picks_blocks_${normalizedUsername}`, JSON.stringify(cloud.blocks || []));
              }

              if (cloud.design) setDesign(cloud.design);
              if (cloud.portfolio) setPortfolioSections(Array.isArray(cloud.portfolio) ? cloud.portfolio : []);
              if (cloud.socials) setSocials(cloud.socials);
              if (cloud.profile) {
                setProfile(prev => ({
                  ...prev,
                  full_name: cloud.profile.name || prev?.full_name,
                  bio: cloud.profile.bio || prev?.bio
                }));
                localStorage.setItem(`picks_profile_${normalizedUsername}`, JSON.stringify(cloud.profile));
              }
              
              // Sync to localStorage for offline/fast-load fallback
              localStorage.setItem(`picks_design_${normalizedUsername}`, JSON.stringify(cloud.design || {}));
              localStorage.setItem(`picks_portfolio_${normalizedUsername}`, JSON.stringify(cloud.portfolio || []));
              localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(cloud.socials || {}));
            }
          }

          // Fetch Links (Always fetch from Supabase)
          const { data: linksData, error: linksError } = await supabase
            .from('links')
            .select('*')
            .eq('username', username)
            .order('created_at', { ascending: false });

          if (!linksError && linksData) {
            setLinks(linksData.map((l: any) => ({
              ...l,
              image: l.image || l.image_url
            })));
          }

          // Fetch Live Status
          const { data: liveSessionData, error: liveError } = await supabase
            .from('live_sessions')
            .select('is_live, current_product, viewer_count')
            .eq('username', username)
            .maybeSingle();

          if (!liveError && liveSessionData) {
            setLiveState({
              isLive: liveSessionData.is_live,
              currentProduct: liveSessionData.current_product,
              viewerCount: liveSessionData.viewer_count || 0
            });
          }
        }
      } catch (e) {
        console.error("Error loading user data from Supabase:", e);
      }
    };

    loadData();
    trackView(username);

      // 4. Supabase Realtime Subscription
      // This ensures that when data changes on PC, the mobile browser updates immediately without cache issues.
      let profileChannel: any = null;
      let linksChannel: any = null;
      let liveChannel: any = null;
      let gridChannel: any = null;

      if (supabase) {
        // Listen to link grid items changes
        gridChannel = supabase
          .channel('public:link_grid_items')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'link_grid_items',
              filter: `username=eq.${username}`
            },
            () => {
              console.info('Realtime Sync: Link grid items updated for', username);
              loadData();
            }
          )
          .subscribe();

        // Listen to profile changes (includes site_data like blocks, design, portfolio)
        profileChannel = supabase
          .channel('public:profiles')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'profiles',
              filter: `username=eq.${username}`
            },
            () => {
              console.info('Realtime Sync: Profile updated for', username);
              loadData();
            }
          )
          .subscribe();

        // Listen to links changes
        linksChannel = supabase
          .channel('public:links')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'links',
              filter: `username=eq.${username}`
            },
            () => {
              console.info('Realtime Sync: Links updated for', username);
              loadData();
            }
          )
          .subscribe();

        // Listen to live sessions changes
        liveChannel = supabase
          .channel('public:live_sessions')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'live_sessions',
              filter: `username=eq.${username}`
            },
            (payload: any) => {
              console.info('Realtime Sync: Live session updated for', username);
              const data = payload.new;
              setLiveState({
                isLive: data.is_live,
                currentProduct: data.current_product,
                viewerCount: data.viewer_count || 0
              });
            }
          )
          .subscribe();
      }

      // Listen for changes from other tabs (Admin Dashboard)
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key?.toLowerCase().includes(normalizedUsername)) {
          loadData();
        }
      };

      window.addEventListener('storage', handleStorageChange);
      return () => {
        window.removeEventListener('storage', handleStorageChange);
        if (profileChannel && supabase) supabase.removeChannel(profileChannel);
        if (linksChannel && supabase) supabase.removeChannel(linksChannel);
        if (liveChannel && supabase) supabase.removeChannel(liveChannel);
        if (gridChannel && supabase) supabase.removeChannel(gridChannel);
      };
  }, [normalizedUsername, username]);

  const categories = useMemo(() => {
    const cats = ['전체', ...Array.from(new Set(blocks.map(b => b.category).filter(c => c)))];
    return cats;
  }, [blocks]);

  const filteredBlocks = useMemo(() => {
    if (selectedCategory === '전체') return blocks;
    return blocks.filter(b => b.category === selectedCategory);
  }, [blocks, selectedCategory]);

  const selectedBlock = useMemo(() => blocks.find(b => b.id === selectedBlockId), [blocks, selectedBlockId]);

  const ensureAbsoluteUrl = (url: string) => {
    if (!url || url === '#' || url.trim() === '') return '#';
    // Remove any stray # characters that might have been saved
    const trimmed = url.trim().replace(/#/g, '');
    if (trimmed === '') return '#';
    
    if (trimmed.startsWith('tel:') || trimmed.startsWith('mailto:')) return trimmed;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('//')) return `https:${trimmed}`;
    
    // Handle cases like naver.com or www.naver.com
    return `https://${trimmed}`;
  };

  const openLink = (url: string) => {
    const absoluteUrl = ensureAbsoluteUrl(url);
    if (absoluteUrl === '#') return;
    
    console.info('Opening link in new tab:', absoluteUrl);
    
    if (absoluteUrl.startsWith('tel:')) {
      window.location.href = absoluteUrl;
    } else {
      // Use window.open for programmatic opening, but prefer native <a> tags where possible
      const newWindow = window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
      if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        // Fallback if popup is blocked - open in same tab as last resort
        window.location.href = absoluteUrl;
      }
    }
  };

  const getFontStyle = () => {
    if (design.fontFamily === 'Serif') return 'font-serif tracking-tight';
    if (design.fontFamily === 'Mono') return 'font-mono uppercase tracking-tighter';
    return 'font-sans tracking-tight';
  };

  const themeBg = design.theme === 'custom' ? (design.customGradient || 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)') : 
                design.theme === 'midnight' ? '#050a15' : 
                design.theme === 'white' ? '#F8FAFC' : '#f3f0ff';
  
  const isDark = design.theme === 'midnight' || design.theme === 'custom';
  const textColor = isDark ? 'text-white' : 'text-slate-900';
  const subTextColor = isDark ? 'text-white/60' : 'text-slate-500';

  const backgroundStyle = (design.background_image) ? {
    backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url(${design.background_image})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'fixed'
  } : { background: themeBg };

  return (
    <div className={`min-h-screen transition-all duration-500 ${getFontStyle()} ${textColor}`} style={backgroundStyle}>
      <div className="max-w-md mx-auto min-h-screen flex flex-col relative">
        
        {design.homePriority === 'portfolio' ? (
          /* PORTFOLIO LAYOUT */
          <div className="flex-1 flex flex-col animate-in fade-in duration-700">
            <div 
              className="relative h-[35vh] flex-shrink-0"
              style={{ 
                background: design.portfolioHeaderColor || 'linear-gradient(to br, #9333ea, #4f46e5)'
              }}
            >
              {design.portfolioHeaderImage && (
                <SafeImage 
                  src={design.portfolioHeaderImage} 
                  className="w-full h-full object-cover opacity-90" 
                />
              )}
              {!design.portfolioHeaderImage && !design.portfolioHeaderColor && (
                <SafeImage 
                  src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80" 
                  className="w-full h-full object-cover opacity-90" 
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-inherit via-transparent to-transparent" style={{ background: `linear-gradient(to top, ${themeBg || '#ffffff'}, transparent)` }}></div>
              <div className="absolute bottom-8 left-8 right-8">
                 <h3 className={`text-4xl md:text-5xl font-black tracking-tighter mb-2 ${textColor}`}>{profile?.full_name || username}</h3>
                 <p className="text-xs font-black uppercase tracking-[0.3em]" style={{ color: design.accentColor }}>{profile?.bio || 'Visual Storyteller'}</p>
              </div>
            </div>

            <div className="px-8 pt-4 pb-20 space-y-12">
              {/* Social & Contact Links */}
              <div className="flex flex-wrap justify-center gap-4 py-4">
                {socials.phone && (
                  <button onClick={() => openLink(`tel:${socials.phone}`)} className={`flex items-center gap-2 px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${isDark ? 'bg-white/10 border-white/20 hover:bg-white/20' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'}`}>
                    📞 전화
                  </button>
                )}
                {socials.kakao && (
                  <button onClick={() => openLink(socials.kakao.startsWith('http') ? socials.kakao : `https://pf.kakao.com/${socials.kakao}`)} className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#FEE500] text-black text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all">
                    💬 카톡
                  </button>
                )}
                {socials.youtube && (
                  <button onClick={() => openLink(socials.youtube.startsWith('http') ? socials.youtube : `https://youtube.com/${socials.youtube}`)} className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all">
                    📺 유튜브
                  </button>
                )}
                {socials.instagram && (
                  <button onClick={() => openLink(`https://instagram.com/${socials.instagram.replace('@', '')}`)} className={`flex items-center gap-2 px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${isDark ? 'bg-white/10 border-white/20 hover:bg-white/20' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'}`}>
                    <Instagram size={12} /> 인스타
                  </button>
                )}
                {socials.naver && (
                  <button onClick={() => openLink(socials.naver)} className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#03C75A] text-white text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all">
                    N 네이버
                  </button>
                )}
                {socials.tiktok && (
                  <button onClick={() => openLink(`https://tiktok.com/@${socials.tiktok.replace('@', '')}`)} className={`flex items-center gap-2 px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${isDark ? 'bg-white/10 border-white/20 hover:bg-white/20' : 'bg-slate-100 border-slate-200 hover:bg-slate-200'}`}>
                    <Globe size={12} /> 틱톡
                  </button>
                )}
              </div>
              
              {/* Portfolio Sections in Portfolio Layout */}
              {portfolioSections.length > 0 && (
                <div className="space-y-16">
                  {portfolioSections.map((section, idx) => (
                    <div key={section.id} className="space-y-6 animate-in slide-in-from-bottom-4 duration-700" style={{ animationDelay: `${idx * 100}ms` }}>
                      {section.type === 'text' ? (
                        <div className="space-y-4">
                          {section.title && (
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-[1px]" style={{ backgroundColor: design.accentColor }}></div>
                              <h4 className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: design.accentColor }}>{section.title}</h4>
                            </div>
                          )}
                          <p className={`font-bold leading-[1.6] whitespace-pre-wrap ${textColor} ${
                            design.portfolioFontSize === 'small' ? 'text-sm md:text-base' : 
                            design.portfolioFontSize === 'large' ? 'text-2xl md:text-3xl' : 
                            'text-lg md:text-xl'
                          }`}>
                            {section.content}
                          </p>
                        </div>
                      ) : (
                        <div className="relative group">
                          <div className="absolute -inset-4 rounded-[2.5rem] scale-95 group-hover:scale-100 transition-transform duration-500" style={{ backgroundColor: `${design.accentColor}10` }}></div>
                          <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-white/10 aspect-[4/5]">
                            <SafeImage src={section.content} className="w-full h-full object-cover" />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button 
                onClick={() => {
                  const el = document.getElementById('curation-section');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="w-full py-5 rounded-[2rem] text-xs font-black uppercase tracking-widest transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-3"
                style={{ backgroundColor: design.accentColor, color: '#fff' }}
              >
                Explore My Picks
              </button>
            </div>
            
            <div id="curation-section" className="pt-20 px-4">
               <div className="flex justify-between items-end mb-8 px-4">
                 <div>
                   <h4 className="text-[10px] font-black uppercase tracking-[0.2em] mb-1" style={{ color: design.accentColor }}>My Curations</h4>
                   <h3 className="text-2xl font-black tracking-tighter">Explore My Picks</h3>
                 </div>
                 <div className="text-[10px] font-black opacity-30 uppercase tracking-widest">{filteredBlocks.length} Items</div>
               </div>

               <div className="mb-8 overflow-x-auto scrollbar-hide flex gap-2 px-4">
                 {categories.map(cat => (
                   <button 
                     key={cat}
                     onClick={() => setSelectedCategory(cat)}
                     className={`px-5 py-2 rounded-full text-[10px] font-black whitespace-nowrap transition-all border ${selectedCategory === cat ? 'shadow-lg' : 'bg-white/5 border-white/10'}`}
                     style={selectedCategory === cat ? { backgroundColor: design.accentColor, color: '#fff', borderColor: design.accentColor } : {}}
                   >
                     {cat}
                   </button>
                 ))}
               </div>

               {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                 <div 
                    className="grid grid-flow-dense transition-all duration-500" 
                    style={{ 
                      gridTemplateColumns: `repeat(${design.gridColumns}, 1fr)`,
                      gap: `${design.gridGap}px`,
                      paddingBottom: '100px'
                    }}
                  >
                    {filteredBlocks.length > 0 ? filteredBlocks.map((block, idx) => {
                      const isMagazineFeatured = design.gridStyle === 'magazine' && idx === 0 && design.gridColumns > 1;
                      const colSpan = isMagazineFeatured ? 2 : 1;
                      const rowSpan = isMagazineFeatured ? 2 : 1;
                      
                      let itemHeight = '200px';
                      if (isMagazineFeatured) itemHeight = '410px';
                      else if (design.gridColumns === 1) itemHeight = '300px';
                      else if (design.gridColumns === 3) itemHeight = '140px';

                      return (
                        <div 
                          key={block.id} 
                          onClick={() => {
                            setSelectedBlockId(block.id);
                            trackClick(username, block.id);
                          }} 
                          className="relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] shadow-sm"
                          style={{ 
                            gridColumn: `span ${colSpan}`,
                            gridRow: `span ${rowSpan}`,
                            height: itemHeight,
                            borderRadius: design.borderRadius === 'none' ? '0' : design.borderRadius === 'md' ? '1rem' : '2rem'
                          }}
                        >
                          <SafeImage src={block.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105" />
                          <div className="absolute top-3 right-3">
                            <span className="bg-black/60 backdrop-blur-md text-[10px] font-black px-2 py-1 rounded-lg text-white border border-white/10 shadow-lg">{block.products?.length || 0}</span>
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                            <div className="text-xs font-black truncate text-white uppercase tracking-tight">{block.title}</div>
                            <div className="text-[9px] font-bold text-white/50 uppercase tracking-widest mt-0.5">{block.category}</div>
                          </div>
                        </div>
                      );
                    }) : null}
                  </div>
               ) : (
                <div className="flex flex-col gap-3 pb-32">
                   {filteredBlocks.map((block) => (
                     (block.products || []).map(p => (
                       <a 
                         key={p.id}
                         href={ensureAbsoluteUrl(p.link)}
                         target="_blank"
                         rel="noopener noreferrer"
                         onClick={() => trackClick(username, block.id)}
                         className={`w-full flex items-center justify-between p-4 group cursor-pointer border transition-all hover:scale-[1.01] shadow-sm ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-slate-100 hover:border-purple-200'}`} 
                         style={{ borderRadius: design.borderRadius === 'none' ? '0' : design.borderRadius === 'md' ? '1rem' : '2rem' }}
                       >
                         <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
                           {/* Small Product Image */}
                           <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-slate-100 border border-slate-200 shadow-inner">
                             <SafeImage src={p.image || (p as any).imageUrl || (p as any).manual_image_url || block.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover" />
                           </div>
                           <div className="flex-1 min-w-0">
                             <h4 className="text-sm font-black truncate mb-1">{p.name}</h4>
                             <div className="flex items-center gap-2">
                               {p.price && <span className="text-[10px] font-black" style={{ color: design.accentColor }}>{Number(p.price).toLocaleString()}원</span>}
                               <p className={`text-[9px] font-bold uppercase tracking-widest truncate opacity-40 ${subTextColor}`}>{p.link.replace('https://', '').replace('http://', '').split('/')[0]}</p>
                             </div>
                           </div>
                         </div>
                         <div className="w-8 h-8 rounded-full flex items-center justify-center opacity-20 group-hover:opacity-100 transition-all shrink-0" style={{ backgroundColor: design.accentColor, color: '#fff' }}>
                           <ExternalLink size={12} />
                         </div>
                       </a>
                     ))
                   ))}
                 </div>
               )}
            </div>
          </div>
        ) : (
          /* CURATION LAYOUT */
          <div className="flex-1 flex flex-col animate-in fade-in duration-700">
            <header className="relative pt-24 pb-12 px-6 text-center shrink-0 overflow-hidden">
              {/* Background Image for Curation Layout */}
              <div 
                className="absolute inset-0 -z-10"
                style={{ 
                  background: design.portfolioHeaderColor || 'linear-gradient(to br, #9333ea, #4f46e5)'
                }}
              >
                {(design.portfolioHeaderImage || (!design.portfolioHeaderImage && !design.portfolioHeaderColor)) && (
                  <SafeImage 
                    src={design.portfolioHeaderImage || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80"} 
                    className="w-full h-full object-cover opacity-80" 
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-inherit" style={{ background: `linear-gradient(to bottom, transparent, ${themeBg}88)` }}></div>
              </div>

              <div className="w-24 h-24 rounded-full border-[4px] mx-auto mb-6 flex items-center justify-center overflow-hidden shadow-2xl relative" style={{ borderColor: design.accentColor }}>
                <SafeImage src={profile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`} alt="avatar" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/10"></div>
              </div>
              <h3 className="text-2xl font-black tracking-tight leading-none mb-3">@{profile?.full_name || username}</h3>
              <p className={`text-[11px] font-bold tracking-[0.2em] uppercase opacity-70 ${textColor}`}>{profile?.bio || 'Curated Collection'}</p>
              
              {liveState.isLive && (
                <div className="mt-6 animate-in zoom-in duration-500">
                  <button 
                    onClick={() => setShowLiveModal(true)}
                    className="group relative inline-flex items-center gap-3 bg-red-600 px-6 py-3 rounded-2xl text-white shadow-[0_0_30px_rgba(220,38,38,0.4)] hover:scale-105 transition-all active:scale-95"
                  >
                    <div className="flex items-center gap-2">
                      <Radio size={16} className="animate-pulse" />
                      <span className="text-xs font-black uppercase tracking-widest">LIVE NOW</span>
                    </div>
                    <div className="w-[1px] h-4 bg-white/20" />
                    <div className="flex items-center gap-1.5">
                      <Users size={14} />
                      <span className="text-[10px] font-bold">{liveState.viewerCount.toLocaleString()}</span>
                    </div>
                  </button>
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-3 mt-6">
                {socials.phone && (
                  <button onClick={() => openLink(`tel:${socials.phone}`)} className="p-2.5 rounded-full bg-slate-100 dark:bg-white/10 hover:scale-110 transition-all shadow-sm">
                    📞
                  </button>
                )}
                {socials.kakao && (
                  <button onClick={() => openLink(socials.kakao.startsWith('http') ? socials.kakao : `https://pf.kakao.com/${socials.kakao}`)} className="p-2.5 rounded-full bg-[#FEE500] hover:scale-110 transition-all shadow-sm">
                    💬
                  </button>
                )}
                {socials.youtube && (
                  <button onClick={() => openLink(socials.youtube.startsWith('http') ? socials.youtube : `https://youtube.com/${socials.youtube}`)} className="p-2.5 rounded-full bg-red-600 text-white hover:scale-110 transition-all shadow-sm">
                    <Youtube size={16} />
                  </button>
                )}
                {socials.instagram && (
                  <button onClick={() => openLink(`https://instagram.com/${socials.instagram.replace('@', '')}`)} className="p-2.5 rounded-full bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 text-white hover:scale-110 transition-all shadow-sm">
                    <Instagram size={16} />
                  </button>
                )}
                {socials.naver && (
                  <button onClick={() => openLink(socials.naver)} className="p-2.5 rounded-full bg-[#03C75A] text-white hover:scale-110 transition-all shadow-sm">
                    <span className="text-[10px] font-black">N</span>
                  </button>
                )}
                {socials.tiktok && (
                  <button onClick={() => openLink(`https://tiktok.com/@${socials.tiktok.replace('@', '')}`)} className="p-2.5 rounded-full bg-black text-white hover:scale-110 transition-all shadow-sm">
                    <Globe size={16} />
                  </button>
                )}
              </div>

              {/* Portfolio Sections in Curation Layout */}
              {portfolioSections.length > 0 && (
                <div className="mt-12 px-6 space-y-10 text-left p-8 rounded-[2rem] bg-white/5 border border-white/10">
                  {portfolioSections.map((section) => (
                    <div key={section.id} className="space-y-4 animate-in slide-in-from-bottom-4 duration-700">
                      {section.type === 'text' ? (
                        <div className="space-y-2">
                          {section.title && <h4 className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: design.accentColor }}>{section.title}</h4>}
                          <p className={`text-sm font-bold leading-relaxed whitespace-pre-wrap ${textColor}`}>
                            {section.content}
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-3xl overflow-hidden shadow-xl border border-white/10">
                          <SafeImage src={section.content} className="w-full h-auto object-cover" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </header>

            <div className="sticky top-0 z-30 py-4 overflow-x-auto scrollbar-hide flex gap-2 px-6 backdrop-blur-md">
              {categories.map(cat => (
                <button 
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-5 py-2 rounded-full text-[10px] font-black whitespace-nowrap transition-all border ${selectedCategory === cat ? 'shadow-lg' : 'bg-white/5 border-white/10'}`}
                  style={selectedCategory === cat ? { backgroundColor: design.accentColor, color: '#fff', borderColor: design.accentColor } : {}}
                >
                  {cat}
                </button>
              ))}
            </div>

            <main className="flex-1 px-4 py-6">
              {/* Supabase Links Grid */}
              {links.length > 0 && (
                <div className="grid grid-cols-1 gap-4 mb-10">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] px-2" style={{ color: design.accentColor }}>Featured Links</h4>
                  <div className={design.templateType === TemplateType.SHOPPABLE_GRID ? "grid grid-cols-2 gap-4" : "flex flex-col gap-3"}>
                    {links.map((link) => (
                      <a 
                        href={ensureAbsoluteUrl(link.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          trackClick(username, link.id);
                          openLink(link.url);
                        }}
                        className={`group relative overflow-hidden transition-all hover:scale-[1.02] shadow-xl ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-100'} ${design.templateType === TemplateType.SHOPPABLE_GRID ? 'rounded-[2rem] aspect-square border' : 'rounded-2xl p-4 flex items-center gap-4 border'}`}
                      >
                        {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                          <>
                            <SafeImage src={link.image || FALLBACK_IMAGE} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={link.title} />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-5">
                              <p className="text-white text-xs font-black truncate">{link.title}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-slate-100 dark:bg-slate-800 border border-white/10">
                              <SafeImage src={link.image || FALLBACK_IMAGE} className="w-full h-full object-cover" alt={link.title} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-black truncate">{link.title}</p>
                              <p className="text-[10px] opacity-40 font-bold truncate">{link.url.replace('https://', '').replace('http://', '')}</p>
                            </div>
                            <ExternalLink size={14} className="opacity-20 group-hover:opacity-100 transition-opacity" />
                          </>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {design.templateType === TemplateType.SHOPPABLE_GRID ? (
                <div 
                  className="grid grid-flow-dense" 
                  style={{ 
                    gridTemplateColumns: `repeat(${design.gridColumns}, 1fr)`,
                    gap: `${design.gridGap}px`,
                    paddingBottom: '100px'
                  }}
                >
                  {filteredBlocks.length > 0 ? filteredBlocks.map((block, idx) => {
                    const isMagazineFeatured = design.gridStyle === 'magazine' && design.gridColumns > 1 && (idx % 5 === 0);
                    const colSpan = isMagazineFeatured ? 2 : 1;
                    const rowSpan = isMagazineFeatured ? 2 : 1;
                    
                    let itemHeight = '200px';
                    if (isMagazineFeatured) itemHeight = '410px';
                    else if (design.gridColumns === 1) itemHeight = '300px';
                    else if (design.gridColumns === 3) itemHeight = '140px';

                    return (
                      <div 
                        key={block.id} 
                        onClick={() => {
                          setSelectedBlockId(block.id);
                          trackClick(username, block.id);
                        }} 
                        className={`relative overflow-hidden group cursor-pointer transition-all active:scale-[0.98] shadow-sm border ${isDark ? 'border-white/5' : 'border-slate-100'}`}
                        style={{ 
                          gridColumn: `span ${colSpan}`,
                          gridRow: `span ${rowSpan}`,
                          height: itemHeight,
                          borderRadius: design.borderRadius === 'none' ? '0' : design.borderRadius === 'md' ? '1rem' : '2rem'
                        }}
                      >
                        <SafeImage src={block.coverMedia || FALLBACK_IMAGE} className="w-full h-full object-cover opacity-90 transition-transform duration-1000 group-hover:scale-105" />
                        <div className="absolute top-3 right-3">
                          <span className="bg-black/60 backdrop-blur-md text-[10px] font-black px-2 py-1 rounded-lg text-white border border-white/10 shadow-lg">{block.products?.length || 0}</span>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                          <div className="text-xs font-black truncate text-white uppercase tracking-tight">{block.title}</div>
                          <div className="text-[9px] font-bold text-white/50 uppercase tracking-widest mt-0.5">{block.category}</div>
                        </div>
                      </div>
                    );
                  }) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-3 pb-32">
                  {filteredBlocks.map((block) => (
                    (block.products || []).map(p => (
                      <a 
                        key={p.id}
                        href={ensureAbsoluteUrl(p.link)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault();
                          trackClick(username, block.id);
                          openLink(p.link);
                        }}
                        className={`w-full flex items-center justify-between p-4 group cursor-pointer border transition-all hover:scale-[1.01] shadow-sm ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-white border-slate-100 hover:border-purple-200'}`} 
                        style={{ borderRadius: design.borderRadius === 'none' ? '0' : design.borderRadius === 'md' ? '1rem' : '2rem' }}
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-black truncate mb-1">{p.name}</h4>
                            <div className="flex items-center gap-2">
                              <p className={`text-[9px] font-bold uppercase tracking-widest truncate opacity-40 ${subTextColor}`}>{p.link.replace('https://', '').replace('http://', '').split('/')[0]}</p>
                            </div>
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center opacity-20 group-hover:opacity-100 transition-all shrink-0" style={{ backgroundColor: design.accentColor, color: '#fff' }}>
                          <ExternalLink size={12} />
                        </div>
                      </a>
                    ))
                  ))}
                </div>
              )}
            </main>
          </div>
        )}

        {/* Footer */}
        <footer className="py-12 flex flex-col items-center space-y-6 shrink-0">
          <button 
            onClick={() => {
              navigator.share({
                title: `${username}님의 픽스폴리오`,
                url: window.location.href
              }).catch(() => {
                navigator.clipboard.writeText(window.location.href);
                alert('링크가 복사되었습니다!');
              });
            }}
            className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-[2rem] font-black text-sm hover:scale-105 transition-all shadow-2xl"
          >
            <Share2 size={18} />
            페이지 공유하기
          </button>
          
          <div className="flex items-center gap-2 opacity-30 grayscale hover:grayscale-0 transition-all cursor-pointer">
            <span className="text-[10px] font-black tracking-tighter">POWERED BY</span>
            <span className="text-sm font-black text-purple-600 tracking-tighter">PICKSFOLIO</span>
          </div>
        </footer>

        {/* Product Detail Drawer */}
        <div className={`fixed bottom-0 left-0 right-0 max-w-md mx-auto p-8 md:p-10 rounded-t-[3rem] transition-transform duration-500 z-[110] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] ${selectedBlockId ? 'translate-y-0' : 'translate-y-full'} ${isDark ? 'bg-[#0f172a] text-white' : 'bg-white text-slate-900'}`}>
          <div className={`w-12 h-1 rounded-full mx-auto mb-8 cursor-pointer ${isDark ? 'bg-white/20' : 'bg-slate-200'}`} onClick={() => setSelectedBlockId(null)}></div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h4 className="font-black text-[10px] uppercase tracking-[0.2em] text-purple-600 mb-1">Shop the Selection</h4>
              <h3 className="text-lg font-black tracking-tight">{selectedBlock?.title}</h3>
            </div>
            <button onClick={() => setSelectedBlockId(null)} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isDark ? 'bg-white/10 text-white/40 hover:text-white' : 'bg-slate-100 text-slate-400 hover:text-slate-900'}`}>✕</button>
          </div>
          <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-2 scrollbar-hide pb-4">
            {selectedBlock?.products.map((p) => (
              <div 
                key={p.id} 
                className={`flex items-center justify-between p-5 rounded-2xl border group shadow-sm transition-all ${isDark ? 'bg-white/5 border-white/5 hover:bg-white/10' : 'bg-slate-50 border-slate-100 hover:border-purple-200'}`}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <a 
                        href={ensureAbsoluteUrl(p.link)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          trackClick(username, selectedBlockId || '');
                        }}
                        className={`text-sm font-black truncate hover:underline cursor-pointer ${isDark ? 'text-white' : 'text-slate-900'}`}
                      >
                        {p.name}
                      </a>
                    </div>
                    <span className={`text-[9px] font-bold truncate opacity-60 block ${isDark ? 'text-white/40' : 'text-slate-400'}`}>{p.link.replace('https://', '').replace('http://', '').split('/')[0]}</span>
                  </div>
                </div>
                <a 
                  href={ensureAbsoluteUrl(p.link)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    trackClick(username, selectedBlockId || '');
                  }}
                  className="px-5 py-2.5 rounded-xl text-[10px] font-black text-white shadow-md active:scale-90 transition-all shrink-0 flex items-center justify-center" 
                  style={{ backgroundColor: design.accentColor }}
                >
                  구매하기
                </a>
              </div>
            ))}
          </div>
        </div>
        {selectedBlockId && <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[90] transition-opacity" onClick={() => setSelectedBlockId(null)}></div>}
        
        {/* Live Commerce Modal */}
        <AnimatePresence>
          {showLiveModal && liveState.isLive && (
            <LiveStream 
              username={username}
              currentProduct={liveState.currentProduct}
              viewerCount={liveState.viewerCount}
              onClose={() => setShowLiveModal(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default UserPage;
