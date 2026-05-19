import React, { useState, useEffect } from 'react';
import { Instagram, Youtube, Save, Trash2, Camera, Phone, MessageCircle, Image as ImageIcon, Type, GripVertical, Globe, Palette } from 'lucide-react';
import { supabase } from '../services/supabase';
import { getSiteSettings, updateSiteSettings } from '../services/settingsService';
import { DesignSettings, TemplateType } from '../types';
import Toast from './Toast';

interface PortfolioBlock {
  id: string;
  type: 'text' | 'image';
  content: string;
}

interface PortfolioManagementProps {
  userName: string;
}

interface PortfolioProfile {
  name: string;
  bio: string;
  email: string;
  avatar_url: string;
  links: {
    phone: string;
    kakao: string;
    youtube: string;
    instagram: string;
    naver: string;
    tiktok: string;
  };
}

const PortfolioManagement: React.FC<PortfolioManagementProps> = ({ userName }) => {
  const normalizedUsername = (userName || '').toLowerCase();

  const [profile, setProfile] = useState<PortfolioProfile>(() => {
    const defaultProfile: PortfolioProfile = {
      name: userName,
      bio: '패션과 뷰티를 사랑하는 크리에이터입니다. 매일 새로운 스타일을 제안합니다.',
      email: userName + '@picksfolio.com',
      avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userName}`,
      links: {
        phone: '',
        kakao: '',
        youtube: '',
        instagram: '',
        naver: '',
        tiktok: ''
      }
    };

    try {
      const saved = localStorage.getItem(`picks_profile_${normalizedUsername}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...defaultProfile,
          ...parsed,
          links: {
            ...defaultProfile.links,
            ...(parsed.links || {})
          }
        };
      }
    } catch (e) {
      console.error('Error parsing profile:', e);
    }
    return defaultProfile;
  });

  const [blocks, setBlocks] = useState<PortfolioBlock[]>([]);
  const [design, setDesign] = useState<DesignSettings>(() => {
    const saved = localStorage.getItem(`picks_design_${normalizedUsername}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error parsing design:', e);
      }
    }
    return {
      templateType: TemplateType.PORTFOLIO,
      theme: 'white',
      accentColor: '#0f172a',
      borderRadius: 'full',
      gridGap: 1,
      gridColumns: 2,
      gridStyle: 'standard',
      fontFamily: 'Sans',
      buttonStyle: 'solid',
      backgroundType: 'solid',
      profileLayout: 'center',
      homePriority: 'portfolio'
    };
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ type: 'profile' | 'block' | 'cover'; id?: string } | null>(null);
  const [, setIsUploading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const settings = await getSiteSettings(userName);
        if (settings && settings.design) {
          setDesign(prev => ({ ...prev, ...settings.design }));
        }
        
        const savedPortfolio = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);
        if (savedPortfolio) {
          try {
            const parsed = JSON.parse(savedPortfolio);
            setBlocks(Array.isArray(parsed) ? parsed : []);
          } catch (e) {
            console.error('Error parsing portfolio:', e);
          }
        }
        
        const savedProfile = localStorage.getItem(`picks_profile_${normalizedUsername}`);
        if (savedProfile) {
          try {
            const parsed = JSON.parse(savedProfile);
            if (parsed) {
              setProfile((prev: PortfolioProfile) => ({
                ...prev,
                ...parsed,
                links: {
                  ...(prev.links || {}),
                  ...(parsed.links || {})
                }
              }));
            }
          } catch (e) {
            console.error('Error parsing profile:', e);
          }
        }
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    loadData();
  }, [userName, normalizedUsername]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('username', userName);
      formData.append('purpose', uploadTarget.type === 'profile' ? 'avatar' : uploadTarget.type === 'cover' ? 'cover' : 'block');

      const res = await fetch('/api/upload-image', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const { url } = await res.json();
        if (uploadTarget.type === 'profile') {
          setProfile({ ...profile, avatar_url: url });
        } else if (uploadTarget.type === 'block' && uploadTarget.id) {
          updateBlock(uploadTarget.id, url);
        } else if (uploadTarget.type === 'cover') {
          setDesign(prev => ({ ...prev, portfolioHeaderImage: url }));
        }
      } else {
        throw new Error('Upload failed');
      }
    } catch (err) {
      console.error('Blob upload failed, falling back to base64:', err);
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
          } else {
            if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const base64String = canvas.toDataURL('image/jpeg', 0.7);
          if (uploadTarget.type === 'profile') {
            setProfile({ ...profile, avatar_url: base64String });
          } else if (uploadTarget.type === 'block' && uploadTarget.id) {
            updateBlock(uploadTarget.id, base64String);
          } else if (uploadTarget.type === 'cover') {
            setDesign(prev => ({ ...prev, portfolioHeaderImage: base64String }));
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } finally {
      setIsUploading(false);
      setUploadTarget(null);
    }
  };

  const triggerFileUpload = (target: { type: 'profile' | 'block' | 'cover'; id?: string }) => {
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  const handleSave = async () => {
    console.log('[PortfolioSave] 시작');
    setIsSaving(true);
    
    // 3초 후 강제 로딩 종료 안전장치
    const timeoutId = setTimeout(() => {
      console.warn('[PortfolioSave] 3초 타임아웃 발생 - 로딩 강제 종료');
      setIsSaving(false);
    }, 3000);
    
    try {
      if (!supabase) throw new Error("서버에 연결할 수 없습니다.");
      
      // 세션 상태 강제 확인
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      console.log('[PortfolioSave] 세션 상태:', { session: sessionData.session, error: sessionError });
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      console.log('[PortfolioSave] 데이터 정제 중...');
      // Optimistic update to localStorage
      localStorage.setItem(`picks_profile_${normalizedUsername}`, JSON.stringify(profile));
      localStorage.setItem(`picks_portfolio_${normalizedUsername}`, JSON.stringify(blocks));
      
      const socials = {
        phone: profile.links.phone,
        kakao: profile.links.kakao,
        youtube: profile.links.youtube,
        instagram: profile.links.instagram,
        tiktok: profile.links.tiktok || '',
        naver: profile.links.naver || ''
      };
      localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(socials));
      
      console.log('[PortfolioSave] 저장 시도...', { blocks, profile });
      
      // Update site settings (portfolio, design, and profile)
      const result = await updateSiteSettings(userName, { 
        portfolio: blocks,
        design: design ? {
          portfolioHeaderImage: design.portfolioHeaderImage,
          portfolioHeaderColor: design.portfolioHeaderColor,
          portfolioFontSize: design.portfolioFontSize,
          profileLayout: design.profileLayout
        } as any : undefined,
        profile: profile
      });
      
      console.log('[PortfolioSave] 결과:', result);
      
      setSaveMessage('저장이 완료되었습니다!');
      setShowToast(true);
    } catch (error) {
      console.error('[PortfolioSave] 에러 발생:', error);
      setSaveMessage(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
      setShowToast(true);
    } finally {
      clearTimeout(timeoutId);
      setIsSaving(false);
      console.log('[PortfolioSave] 종료');
    }
  };

  const addBlock = (type: 'text' | 'image') => {
    const newId = Date.now().toString();
    const newBlock: PortfolioBlock = {
      id: newId,
      type,
      content: type === 'text' ? '새로운 텍스트 내용을 입력하세요.' : ''
    };
    setBlocks([...blocks, newBlock]);
  };

  const removeBlock = (id: string) => {
    setBlocks(blocks.filter(b => b.id !== id));
  };

  const updateBlock = (id: string, content: string) => {
    setBlocks(blocks.map(b => b.id === id ? { ...b, content } : b));
  };

  return (
    <div className="p-4 md:p-14 max-w-6xl mx-auto animate-in fade-in duration-500">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        className="hidden" 
        accept="image/*" 
      />

      <header className="mb-6 md:mb-12 flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6">
        <div>
          <h2 className="text-lg md:text-4xl font-black text-slate-900 mb-1 md:mb-3">포트폴리오 설정</h2>
          <p className="text-slate-500 font-medium text-[9px] md:text-base">나만의 스타일로 포트폴리오를 구성하세요.</p>
        </div>
        <div className="flex items-center gap-4">
          {saveMessage && (
            <span className="text-emerald-500 font-black text-xs animate-in fade-in slide-in-from-right-2">
              {saveMessage}
            </span>
          )}
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="bg-purple-600 text-white px-6 md:px-10 py-3 md:py-5 rounded-xl md:rounded-[2rem] font-black flex items-center justify-center gap-2 md:gap-3 hover:bg-purple-700 transition-all shadow-xl md:shadow-2xl shadow-purple-200 disabled:opacity-50 text-sm md:text-base"
          >
            {isSaving ? (
              <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4 md:w-5 md:h-5" />
            )}
            <span>저장하기</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-12">
        {/* Editor Side */}
        <div className="lg:col-span-7 space-y-6 md:space-y-10">
          {/* Portfolio Cover Section */}
          <section className="bg-white rounded-2xl md:rounded-[3rem] border border-slate-100 p-6 md:p-10 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg md:text-xl font-black text-slate-900">상단 커버 디자인</h3>
              <Palette size={20} className="text-purple-600" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">커버 이미지</label>
                <div 
                  onClick={() => triggerFileUpload({ type: 'cover' })}
                  className="aspect-video rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all overflow-hidden relative group"
                >
                  {design?.portfolioHeaderImage ? (
                    <>
                      <img src={design.portfolioHeaderImage} alt="Cover" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                        <Camera size={24} />
                      </div>
                    </>
                  ) : (
                    <>
                      <ImageIcon size={32} className="text-slate-300 mb-2" />
                      <span className="text-xs font-black text-slate-400">이미지 업로드</span>
                    </>
                  )}
                </div>
                {design?.portfolioHeaderImage && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setDesign(prev => ({ ...prev, portfolioHeaderImage: undefined }));
                    }}
                    className="text-[10px] font-black text-red-500 hover:text-red-600 flex items-center gap-1"
                  >
                    <Trash2 size={12} /> 이미지 삭제
                  </button>
                )}
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">커버 배경색</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '#7c3aed', // Violet
                      '#0f172a', // Midnight
                      '#ffffff', // White
                      'linear-gradient(to br, #9333ea, #4f46e5)', // Purple Gradient
                    ].map(color => (
                      <button 
                        key={color}
                        onClick={() => setDesign(prev => ({ ...prev, portfolioHeaderColor: color }))}
                        className={`w-10 h-10 rounded-xl border-2 transition-all ${design.portfolioHeaderColor === color ? 'border-purple-600 scale-110' : 'border-transparent hover:scale-105'}`}
                        style={{ background: color, border: color === '#ffffff' ? '1px solid #e2e8f0' : undefined }}
                      />
                    ))}
                    <div className="relative">
                      <input 
                        type="color" 
                        value={design.portfolioHeaderColor?.startsWith('#') ? design.portfolioHeaderColor : '#9333ea'} 
                        onChange={e => setDesign(prev => ({ ...prev, portfolioHeaderColor: e.target.value }))}
                        className="w-10 h-10 rounded-xl overflow-hidden border-none p-0 cursor-pointer"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">이미지가 없을 때 적용되는 배경색입니다.</p>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">포인트 컬러 (ACCENT COLOR)</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      '#a855f7', // Violet
                      '#0f172a', // Midnight Slate
                      '#2563eb', // Blue
                    ].map(color => (
                      <button 
                        key={color}
                        onClick={() => setDesign(prev => ({ ...prev, accentColor: color }))}
                        className={`w-10 h-10 rounded-full border-4 transition-all ${design.accentColor === color ? 'border-purple-600 scale-110' : 'border-transparent hover:scale-105'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <div className="relative">
                      <input 
                        type="color" 
                        value={design.accentColor || '#a855f7'} 
                        onChange={e => setDesign(prev => ({ ...prev, accentColor: e.target.value }))}
                        className="w-10 h-10 rounded-full overflow-hidden border-none p-0 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">소개 텍스트 크기</label>
                  <div className="flex gap-2">
                    {[
                      { id: 'small', label: '작게' },
                      { id: 'medium', label: '보통' },
                      { id: 'large', label: '크게' }
                    ].map(size => (
                      <button 
                        key={size.id}
                        onClick={() => setDesign(prev => ({ ...prev, portfolioFontSize: size.id as any }))}
                        className={`flex-1 py-2 rounded-xl font-black text-[10px] transition-all border-2 ${design.portfolioFontSize === size.id || (!design.portfolioFontSize && size.id === 'medium') ? 'bg-purple-50 border-purple-600 text-purple-600' : 'bg-slate-50 border-transparent text-slate-400 hover:bg-slate-100'}`}
                      >
                        {size.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Basic Info & Top Links */}
          <section className="bg-white rounded-2xl md:rounded-[3rem] border border-slate-100 p-6 md:p-10 shadow-sm space-y-6 md:space-y-8">
            <div className="flex items-center gap-4 md:gap-6">
              <div className="relative group">
                <div className="w-16 h-16 md:w-24 md:h-24 rounded-2xl md:rounded-[2.5rem] bg-slate-50 p-1 border-2 border-purple-100 overflow-hidden">
                  <img 
                    src={profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userName}`} 
                    alt="Profile" 
                    className="w-full h-full rounded-[2.2rem] object-cover"
                  />
                </div>
                <button 
                  onClick={() => triggerFileUpload({ type: 'profile' })}
                  className="absolute inset-0 bg-black/40 rounded-[2.5rem] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                >
                  <Camera size={20} />
                </button>
              </div>
              <div className="flex-1 space-y-4">
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">포트폴리오 이름</label>
                    <input 
                      type="text" 
                      value={profile.name} 
                      onChange={e => setProfile({ ...profile, name: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 md:px-6 py-3 md:py-4 font-black text-base md:text-xl focus:outline-none focus:border-purple-600 transition-all"
                      placeholder="이름을 입력하세요"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">소개 문구</label>
                    <textarea 
                      value={profile.bio} 
                      onChange={e => setProfile({ ...profile, bio: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 md:px-6 py-3 md:py-4 font-bold text-sm md:text-base focus:outline-none focus:border-purple-600 transition-all resize-none"
                      placeholder="나를 소개하는 한 줄 문구를 입력하세요"
                      rows={2}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">연락처 및 소셜 링크 (선택)</label>
                <div className="flex flex-wrap gap-2">
                  {!profile.links.phone && (
                    <button 
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, phone: ' ' } })}
                      className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-600 hover:bg-purple-50 hover:border-purple-200 transition-all flex items-center gap-1.5"
                    >
                      <Phone size={12} /> 전화 추가
                    </button>
                  )}
                  {!profile.links.kakao && (
                    <button 
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, kakao: ' ' } })}
                      className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-600 hover:bg-purple-50 hover:border-purple-200 transition-all flex items-center gap-1.5"
                    >
                      <MessageCircle size={12} /> 카톡 추가
                    </button>
                  )}
                  {!profile.links.youtube && (
                    <button 
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, youtube: ' ' } })}
                      className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-600 hover:bg-purple-50 hover:border-purple-200 transition-all flex items-center gap-1.5"
                    >
                      <Youtube size={12} /> 유튜브 추가
                    </button>
                  )}
                  {!profile.links.instagram && (
                    <button 
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, instagram: ' ' } })}
                      className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-600 hover:bg-purple-50 hover:border-purple-200 transition-all flex items-center gap-1.5"
                    >
                      <Instagram size={12} /> 인스타 추가
                    </button>
                  )}
                  {!profile.links.naver && (
                    <button 
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, naver: ' ' } })}
                      className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-600 hover:bg-purple-50 hover:border-purple-200 transition-all flex items-center gap-1.5"
                    >
                      <span className="w-3 h-3 bg-[#03C75A] text-white flex items-center justify-center rounded-[2px] text-[8px]">N</span> 네이버 추가
                    </button>
                  )}
                  {!profile.links.tiktok && (
                    <button 
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, tiktok: ' ' } })}
                      className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-600 hover:bg-purple-50 hover:border-purple-200 transition-all flex items-center gap-1.5"
                    >
                      <Globe size={12} /> 틱톡 추가
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {profile.links.phone !== undefined && profile.links.phone !== '' && (
                  <div className="space-y-2 relative group">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Phone size={12} /> 전화번호
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={profile.links.phone === ' ' ? '' : profile.links.phone} 
                        onChange={e => setProfile({ ...profile, links: { ...profile.links, phone: e.target.value } })}
                        placeholder="010-0000-0000"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3 font-bold text-sm focus:outline-none focus:border-purple-600"
                      />
                      <button 
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, phone: '' } })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {profile.links.kakao !== undefined && profile.links.kakao !== '' && (
                  <div className="space-y-2 relative group">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <MessageCircle size={12} className="text-yellow-500" /> 카카오톡
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={profile.links.kakao === ' ' ? '' : profile.links.kakao} 
                        onChange={e => setProfile({ ...profile, links: { ...profile.links, kakao: e.target.value } })}
                        placeholder="오픈채팅 URL"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3 font-bold text-sm focus:outline-none focus:border-purple-600"
                      />
                      <button 
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, kakao: '' } })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {profile.links.youtube !== undefined && profile.links.youtube !== '' && (
                  <div className="space-y-2 relative group">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Youtube size={12} className="text-red-500" /> 유튜브
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={profile.links.youtube === ' ' ? '' : profile.links.youtube} 
                        onChange={e => setProfile({ ...profile, links: { ...profile.links, youtube: e.target.value } })}
                        placeholder="채널 URL"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3 font-bold text-sm focus:outline-none focus:border-purple-600"
                      />
                      <button 
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, youtube: '' } })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {profile.links.instagram !== undefined && profile.links.instagram !== '' && (
                  <div className="space-y-2 relative group">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Instagram size={12} className="text-pink-500" /> 인스타그램
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={profile.links.instagram === ' ' ? '' : profile.links.instagram} 
                        onChange={e => setProfile({ ...profile, links: { ...profile.links, instagram: e.target.value } })}
                        placeholder="인스타그램 URL"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3 font-bold text-sm focus:outline-none focus:border-purple-600"
                      />
                      <button 
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, instagram: '' } })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {profile.links.naver !== undefined && profile.links.naver !== '' && (
                  <div className="space-y-2 relative group">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <span className="w-3 h-3 bg-[#03C75A] text-white flex items-center justify-center rounded-[2px] text-[8px]">N</span> 네이버
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={profile.links.naver === ' ' ? '' : profile.links.naver} 
                        onChange={e => setProfile({ ...profile, links: { ...profile.links, naver: e.target.value } })}
                        placeholder="네이버 링크 URL"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3 font-bold text-sm focus:outline-none focus:border-purple-600"
                      />
                      <button 
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, naver: '' } })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {profile.links.tiktok !== undefined && profile.links.tiktok !== '' && (
                  <div className="space-y-2 relative group">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Globe size={12} /> 틱톡
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={profile.links.tiktok === ' ' ? '' : profile.links.tiktok} 
                        onChange={e => setProfile({ ...profile, links: { ...profile.links, tiktok: e.target.value } })}
                        placeholder="틱톡 URL"
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3 font-bold text-sm focus:outline-none focus:border-purple-600"
                      />
                      <button 
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, tiktok: '' } })}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Content Blocks Editor */}
          <section className="space-y-4 md:space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4">
              <h3 className="text-lg md:text-xl font-black text-slate-900">콘텐츠 구성</h3>
              <div className="flex gap-2">
                <button 
                  onClick={() => addBlock('text')}
                  className="bg-white border border-slate-200 px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-black flex items-center gap-1.5 md:gap-2 hover:bg-slate-50 transition-all"
                >
                  <Type size={12} className="md:w-3.5 md:h-3.5" /> 텍스트 추가
                </button>
                <button 
                  onClick={() => addBlock('image')}
                  className="bg-white border border-slate-200 px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-black flex items-center gap-1.5 md:gap-2 hover:bg-slate-50 transition-all"
                >
                  <ImageIcon size={12} className="md:w-3.5 md:h-3.5" /> 이미지 추가
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {blocks.filter(Boolean).map((block) => (
                <div key={block.id} className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm group relative animate-in slide-in-from-bottom-4">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-200 group-hover:text-slate-400 transition-colors cursor-grab">
                    <GripVertical size={20} />
                  </div>
                  
                  <div className="pl-8 md:pl-10 pr-10 md:pr-12">
                    {block.type === 'text' ? (
                      <textarea 
                        value={block.content}
                        onChange={(e) => updateBlock(block.id, e.target.value)}
                        className="w-full bg-slate-50 border-none rounded-xl p-3 md:p-4 font-medium text-sm md:text-base text-slate-700 focus:ring-2 focus:ring-purple-100 transition-all resize-none"
                        rows={3}
                      />
                    ) : (
                      <div className="space-y-3">
                        <div className="aspect-video rounded-2xl overflow-hidden bg-slate-100 relative group border-2 border-dashed border-slate-200">
                          {block.content ? (
                            <img src={block.content} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                              <ImageIcon size={32} />
                              <span className="text-xs font-black">이미지를 업로드하세요</span>
                            </div>
                          )}
                          <button 
                            onClick={() => triggerFileUpload({ type: 'block', id: block.id })}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-2"
                          >
                            <Camera size={24} />
                            <span className="text-xs font-black">{block.content ? '이미지 변경' : '이미지 업로드'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={() => removeBlock(block.id)}
                    className="absolute right-6 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Preview Side */}
        <div className="lg:col-span-5">
          <div className="sticky top-10">
            <div className="bg-slate-900 rounded-[3.5rem] p-4 shadow-2xl border-8 border-slate-800 aspect-[9/19] max-w-[320px] mx-auto overflow-hidden relative">
              {/* Phone Status Bar */}
              <div className="h-6 flex justify-between items-center px-6 mb-4">
                <span className="text-[10px] font-black text-white/40">9:41</span>
                <div className="flex gap-1">
                  <div className="w-3 h-3 rounded-full bg-white/20" />
                  <div className="w-3 h-3 rounded-full bg-white/20" />
                </div>
              </div>

              {/* Portfolio Preview Content */}
              <div className="h-full overflow-y-auto scrollbar-hide bg-white rounded-[2.5rem] pb-20">
                {/* Header Image */}
                <div 
                  className="h-40 relative"
                  style={{ 
                    background: design.portfolioHeaderColor || 'linear-gradient(to br, #9333ea, #4f46e5)',
                    backgroundImage: design.portfolioHeaderImage ? `url(${design.portfolioHeaderImage})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  <div className="absolute -bottom-10 left-1/2 -translate-x-1/2">
                    <div className="w-20 h-20 rounded-[1.8rem] bg-white p-1 shadow-xl">
                      <img 
                        src={profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userName}`} 
                        alt="" 
                        className="w-full h-full rounded-[1.5rem] object-cover"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-14 px-6 text-center space-y-6">
                  <div>
                    <h4 className="text-xl font-black text-slate-900">{profile.name}</h4>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: design.accentColor || '#a855f7' }}>{profile.bio || 'CREATOR & STYLIST'}</p>
                  </div>

                  {/* Top Links Preview */}
                  <div className="flex justify-center gap-3">
                    {profile.links?.phone && <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-900 shadow-sm"><Phone size={18} /></div>}
                    {profile.links?.kakao && <div className="w-10 h-10 rounded-2xl bg-yellow-400 flex items-center justify-center text-slate-900 shadow-sm"><MessageCircle size={18} /></div>}
                    {profile.links?.youtube && <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center text-white shadow-sm"><Youtube size={18} /></div>}
                    {profile.links?.instagram && <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600 flex items-center justify-center text-white shadow-sm"><Instagram size={18} /></div>}
                    {profile.links?.naver && <div className="w-10 h-10 rounded-2xl bg-[#03C75A] flex items-center justify-center text-white shadow-sm"><span className="text-[10px] font-black">N</span></div>}
                    {profile.links?.tiktok && <div className="w-10 h-10 rounded-2xl bg-black flex items-center justify-center text-white shadow-sm"><Globe size={18} /></div>}
                  </div>

                  <div className="h-[1px] bg-slate-100 w-full" />

                  {/* Dynamic Blocks Preview */}
                  <div className="space-y-6 text-left">
                    {blocks.filter(Boolean).map((block) => (
                      <div key={block.id}>
                        {block.type === 'text' ? (
                          <p className={`text-slate-600 leading-relaxed font-medium whitespace-pre-wrap ${
                            design.portfolioFontSize === 'small' ? 'text-[10px]' : 
                            design.portfolioFontSize === 'large' ? 'text-base' : 
                            'text-sm'
                          }`}>{block.content}</p>
                        ) : (
                          <div className="rounded-2xl overflow-hidden shadow-md border border-slate-100">
                            <img src={block.content} alt="" className="w-full h-full object-cover" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Notch */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-24 h-1 bg-slate-200 rounded-full" />
            </div>
            <p className="text-center mt-6 text-slate-400 text-xs font-black uppercase tracking-widest">Mobile Preview</p>
          </div>
        </div>
      </div>
      <Toast 
        message={saveMessage} 
        isVisible={showToast} 
        onClose={() => setShowToast(false)} 
      />
    </div>
  );
};

export default PortfolioManagement;
