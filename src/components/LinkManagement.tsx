import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronRight, Image as ImageIcon, Trash2, Loader2, CheckCircle2, AlertTriangle, Plus } from 'lucide-react';
import { supabase } from '../services/supabase';
import { getSiteSettings, updateSiteSettings, getLinkGridItems, updateLinkGridItems, SiteSettings } from '../services/settingsService';
import { getCachedLinkData } from '../services/prefetchService';
import { Block, Product, TemplateType, DesignSettings } from '../types';
import SafeImage from './SafeImage';

interface LinkManagementProps {
  userName: string;
}

// [시각적 확인] 새 코드가 적용되었음을 알리는 알림창
if (typeof window !== 'undefined') {
  (window as any)._picks_code_applied = true;
}

const LinkManagement: React.FC<LinkManagementProps> = ({ userName }) => {
  useEffect(() => {
    // window.alert('픽스폴리오 새 코드가 적용되었습니다!');
  }, []);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    try {
      const saved = localStorage.getItem(`picks_blocks_${(userName || '').toLowerCase()}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error parsing blocks:', e);
      return [];
    }
  });
  const [activeTab, setActiveTab] = useState<'posts' | 'design'>('posts');
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Block>>({});
  const [isLoading, setIsLoading] = useState(false);
  
  // UX 상태 관리
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastType, setToastType] = useState<'success' | 'warning' | 'error'>('success');

  // Design Settings
  const [homePriority, setHomePriority] = useState<'curation' | 'portfolio'>(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.homePriority === 'portfolio' ? 'portfolio' : 'curation';
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 'curation';
  });
  const [layoutTemplate, setLayoutTemplate] = useState<'grid' | 'list'>(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.templateType === TemplateType.LINK_LIST ? 'list' : 'grid';
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 'grid';
  });
  const [columns, setColumns] = useState<1 | 2 | 3>(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.gridColumns as 1 | 2 | 3 || 2;
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 2;
  });
  const [itemStyle, setItemStyle] = useState<'equal' | 'magazine'>(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.gridStyle === 'magazine' ? 'magazine' : 'equal';
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 'equal';
  });
  const [themePreset, setThemePreset] = useState<'midnight' | 'white'>(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.theme === 'white' ? 'white' : 'midnight';
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 'midnight';
  });
  const [accentColor, setAccentColor] = useState(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.accentColor || (design.theme === 'white' ? '#0f172a' : '#a855f7');
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return '#a855f7';
  });
  const [customGradient, setCustomGradient] = useState(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.customGradient || 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)';
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)';
  });
  const [portfolioFontSize, setPortfolioFontSize] = useState<'small' | 'medium' | 'large'>(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.portfolioFontSize || 'medium';
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 'medium';
  });
  const [profile, setProfile] = useState(() => {
    try {
      const saved = localStorage.getItem(`picks_profile_${(userName || '').toLowerCase()}`);
      return saved ? JSON.parse(saved) : { name: userName, bio: '패션과 뷰티를 사랑하는 크리에이터입니다.', avatar_url: '' };
    } catch (e) {
      console.error('Error parsing profile:', e);
      return { name: userName, bio: '패션과 뷰티를 사랑하는 크리에이터입니다.', avatar_url: '' };
    }
  });

  // Mobile Preview State
  const [showBottomSheet, setShowBottomSheet] = useState(false);
  const [previewSelectedBlock, setPreviewSelectedBlock] = useState<Block | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'product' | 'block', id: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ type: 'block' } | { type: 'product', productId: string } | null>(null);

  // [긴급: Supabase Storage 업로드 타입(Blob) 오류 완벽 수정 및 고화질 최적화]
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;

    setIsSaving(true);
    const tempUrl = URL.createObjectURL(file);

    // 이미지 처리 및 업로드 로직
    const processAndUpload = async () => {
      // [UI 피드백] 타임아웃 15초 설정
      const timeoutId = setTimeout(() => {
        setSaveMessage('이미지 업로드 권한이 없거나 네트워크가 불안정합니다. SQL 정책을 확인하세요.');
        setToastType('warning');
        setShowToast(true);
        setIsSaving(false);
      }, 15000);

      try {
        if (!supabase) throw new Error("서버에 연결할 수 없습니다.");
        
        // [범인 찾기] 로그 강화 - 세션 정보 확인
        const { data: { session } } = await supabase.auth.getSession();
        console.log('[Upload] 시작 - 세션 정보:', {
          userId: session?.user?.id || '세션 없음',
          email: session?.user?.email || '',
          expiresAt: session?.expires_at
        });

        // [고화질 다이어트] WebP 변환, 1600px, 0.85 압축
        // [해결 방법] canvas.toBlob 사용 (Base64 문자열 사용 금지)
        const processedBlob = await new Promise<Blob>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 1600;
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > MAX_SIZE) {
                height *= MAX_SIZE / width;
                width = MAX_SIZE;
              }
            } else {
              if (height > MAX_SIZE) {
                width *= MAX_SIZE / height;
                height = MAX_SIZE;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            
            // canvas.toDataURL 대신 toBlob 사용
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Canvas to Blob 변환 실패'));
            }, 'image/webp', 0.85);
          };
          img.onerror = () => reject(new Error('이미지 로드 실패'));
          img.src = tempUrl;
        });

        // [로컬 미리보기 (UX)] 변환된 Blob으로 즉시 화면 업데이트
        const blobUrl = URL.createObjectURL(processedBlob);
        if (uploadTarget.type === 'block') {
          setEditForm(prev => ({ ...prev, coverMedia: blobUrl }));
        } else if (uploadTarget.type === 'product') {
          const updatedProducts = (editForm.products || []).map(p => 
            p.id === uploadTarget.productId ? { ...p, image: blobUrl } : p
          );
          setEditForm(prev => ({ ...prev, products: updatedProducts }));
        }

        // [스토리지 직행] Supabase Storage 업로드
        const fileName = `${Date.now()}-${file.name.replace(/\.[^/.]+$/, "")}.webp`;
        const filePath = `${userName.toLowerCase()}/${fileName}`;
        
        // [범인 찾기] 로그 강화 - 업로드 직전 정보
        console.log(`[Upload] 업로드 시도 - 파일명: ${fileName}, 크기: ${(processedBlob.size / 1024).toFixed(2)}KB, 타입: ${processedBlob.type}, 경로: ${filePath}`);

        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(filePath, processedBlob, {
            contentType: 'image/webp',
            cacheControl: '3600',
            upsert: true
          });

        // [범인 찾기] 로그 강화 - 업로드 결과
        if (uploadError) {
          console.error('[Upload] 업로드 실패 상세:', {
            message: uploadError.message,
            name: uploadError.name,
            status: (uploadError as any).status
          });
          throw uploadError;
        }
        console.log('[Upload] 업로드 성공');

        // 공용 URL 가져오기 (예외 처리 강화)
        const { data: publicData } = supabase.storage
          .from('images')
          .getPublicUrl(filePath);

        if (!publicData || !publicData.publicUrl) {
          throw new Error('Public URL 생성 실패');
        }
        const publicUrl = publicData.publicUrl;

        // [최종 반영] 서버 URL로 업데이트
        if (uploadTarget.type === 'block') {
          setEditForm(prev => ({ ...prev, coverMedia: publicUrl }));
        } else if (uploadTarget.type === 'product') {
          const updatedProducts = (editForm.products || []).map(p => 
            p.id === uploadTarget.productId ? { ...p, image: publicUrl } : p
          );
          setEditForm(prev => ({ ...prev, products: updatedProducts }));
        }
        
        clearTimeout(timeoutId);
        console.log('[Upload] 최종 완료 - URL:', publicUrl);
        
        // 메모리 해제
        setTimeout(() => {
          URL.revokeObjectURL(tempUrl);
          URL.revokeObjectURL(blobUrl);
        }, 5000);

      } catch (error) {
        clearTimeout(timeoutId);
        console.error('[Upload] 치명적 에러:', error);
        setSaveMessage('이미지 업로드 권한이 없거나 네트워크가 불안정합니다. SQL 정책을 확인하세요.');
        setToastType('error');
        setShowToast(true);
      } finally {
        setIsSaving(false);
        setUploadTarget(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    processAndUpload();
  };

  const triggerFileUpload = (target: { type: 'block' } | { type: 'product', productId: string }) => {
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  useEffect(() => {
    const loadData = async () => {
      const cached = getCachedLinkData(userName);
      if (cached) {
        if (cached.gridItems) setBlocks(cached.gridItems);
        if (cached.settings) applySettings(cached.settings);
        setIsLoading(false);
        return;
      }

      const hasLocalDesign = localStorage.getItem(`picks_design_${userName.toLowerCase()}`);
      const hasLocalBlocks = localStorage.getItem(`picks_blocks_${userName.toLowerCase()}`);
      
      if (!hasLocalDesign && !hasLocalBlocks) {
        setIsLoading(true);
      }

      try {
        const [settings, gridItems] = await Promise.all([
          getSiteSettings(userName),
          getLinkGridItems(userName)
        ]);

        if (gridItems && gridItems.length > 0) {
          setBlocks(gridItems);
        } else if (settings && Array.isArray(settings.blocks)) {
          setBlocks(settings.blocks);
        }

        if (settings) {
          applySettings(settings);
        }
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const applySettings = (settings: SiteSettings) => {
      if (settings.design) {
        setHomePriority(settings.design.homePriority === 'portfolio' ? 'portfolio' : 'curation');
        setLayoutTemplate(settings.design.templateType === TemplateType.LINK_LIST ? 'list' : 'grid');
        setColumns(settings.design.gridColumns as 1 | 2 | 3 || 2);
        setItemStyle(settings.design.gridStyle === 'magazine' ? 'magazine' : 'equal');
        setThemePreset(settings.design.theme === 'white' ? 'white' : 'midnight');
        setAccentColor(settings.design.accentColor || (settings.design.theme === 'white' ? '#0f172a' : '#a855f7'));
        setCustomGradient(settings.design.customGradient || 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)');
        setPortfolioFontSize(settings.design.portfolioFontSize || 'medium');
      }
      if (settings.profile) {
        setProfile(settings.profile);
      }
    };

    loadData();
  }, [userName]);

  const handleThemeChange = (theme: 'midnight' | 'white') => {
    setThemePreset(theme);
    if (theme === 'white') {
      setAccentColor('#0f172a');
    } else {
      setAccentColor('#a855f7');
    }
  };

  const showSuccessFeedback = (message: string) => {
    setIsSaved(true);
    setSaveMessage(message);
    setToastType('success');
    setShowToast(true);
    setTimeout(() => setIsSaved(false), 1500);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleSaveDesign = async () => {
    setIsSaving(true);
    const timeoutId = setTimeout(() => {
      setIsSaving(false);
      setSaveMessage('서버 응답이 늦어 로딩을 종료합니다.');
      setToastType('warning');
      setShowToast(true);
    }, 15000);
    
    try {
      if (!supabase) throw new Error("서버에 연결할 수 없습니다.");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      const designUpdate: Partial<DesignSettings> = {
        templateType: layoutTemplate === 'list' ? TemplateType.LINK_LIST : TemplateType.SHOPPABLE_GRID,
        theme: themePreset,
        accentColor: accentColor,
        borderRadius: 'full',
        gridGap: 1,
        gridColumns: columns,
        gridStyle: itemStyle === 'magazine' ? 'magazine' : 'standard',
        fontFamily: 'Sans',
        buttonStyle: 'solid',
        backgroundType: 'solid',
        customGradient: customGradient,
        profileLayout: 'center',
        homePriority: homePriority === 'portfolio' ? 'portfolio' : 'products',
        portfolioFontSize: portfolioFontSize
      };
      
      localStorage.setItem(`picks_profile_${userName.toLowerCase()}`, JSON.stringify(profile));
      localStorage.setItem(`picks_design_${userName.toLowerCase()}`, JSON.stringify(designUpdate));
      
      await updateSiteSettings(userName, { design: designUpdate as any, profile });
      
      clearTimeout(timeoutId);
      showSuccessFeedback('디자인이 저장되었습니다! ✅');
    } catch (error) {
      console.error('[SaveDesign] 에러:', error);
      setSaveMessage(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsSaving(false);
    }
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const handleSaveBlocks = async () => {
    setIsSaving(true);
    const timeoutId = setTimeout(() => {
      setIsSaving(false);
      setSaveMessage('서버 응답이 늦어 로딩을 종료합니다.');
      setToastType('warning');
      setShowToast(true);
    }, 15000);
    
    try {
      if (!supabase) throw new Error("서버에 연결할 수 없습니다.");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      const sanitizedBlocks = blocks.map(block => ({
        ...block,
        products: block.products.map(p => ({
          ...p,
          link: p.link.replace(/#/g, '')
        }))
      }));

      const [success1, success2] = await Promise.all([
        updateLinkGridItems(sanitizedBlocks),
        updateSiteSettings(userName, { blocks: sanitizedBlocks })
      ]);
      
      if (success1 && success2) {
        setBlocks(sanitizedBlocks);
        clearTimeout(timeoutId);
        showSuccessFeedback('적용되었습니다! ✅');
      } else {
        throw new Error('DB 저장에 실패했습니다.');
      }
    } catch (error) {
      console.error('[SaveBlocks] 에러:', error);
      setSaveMessage(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddBlock = () => {
    const newBlock: Block = {
      id: generateId(),
      title: '새로운 포스트',
      category: 'TOP',
      coverMedia: '',
      mediaType: 'image',
      products: [{ id: generateId(), name: '새 상품', price: '0', image: '', link: '' }]
    };
    const updatedBlocks = [newBlock, ...blocks];
    setBlocks(updatedBlocks);
    localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(updatedBlocks));
    setIsEditing(newBlock.id);
    setEditForm(newBlock);
  };

  const handleSaveEdit = async () => {
    if (!isEditing) return;
    setIsSaving(true);
    const timeoutId = setTimeout(() => {
      setIsSaving(false);
      setSaveMessage('서버 응답이 늦어 로딩을 종료합니다.');
      setToastType('warning');
      setShowToast(true);
    }, 15000);
    
    try {
      if (!supabase) throw new Error("서버에 연결할 수 없습니다.");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      const sanitizedEditForm = { 
        ...editForm,
        products: (editForm.products || []).map(p => ({
          ...p,
          link: p.link.replace(/#/g, '')
        }))
      } as Block;

      const updatedBlocks = blocks.map(b => b.id === isEditing ? sanitizedEditForm : b);
      setBlocks(updatedBlocks);
      localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(updatedBlocks));
      
      await Promise.all([
        updateLinkGridItems(updatedBlocks),
        updateSiteSettings(userName, { blocks: updatedBlocks })
      ]);

      clearTimeout(timeoutId);
      showSuccessFeedback('포스트가 수정되었습니다! ✅');
      setTimeout(() => setIsEditing(null), 500);
    } catch (error) {
      console.error('[SaveEdit] 에러:', error);
      setSaveMessage(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteBlock = (id: string) => setConfirmDelete({ type: 'block', id });

  const executeDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'block') {
      const updatedBlocks = blocks.filter(b => b.id !== confirmDelete.id);
      setBlocks(updatedBlocks);
      localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(updatedBlocks));
      setIsEditing(null);
    } else if (confirmDelete.type === 'product') {
      const updatedProducts = (editForm.products || []).filter(p => p.id !== confirmDelete.id);
      setEditForm({ ...editForm, products: updatedProducts } as Block);
    }
    setConfirmDelete(null);
  };

  const handleAddProduct = () => {
    if (!isEditing) return;
    const newProduct: Product = { id: generateId(), name: '새 상품', link: '' };
    setEditForm({ ...editForm, products: [...(editForm.products || []), newProduct] } as Block);
  };

  const handleUpdateProduct = (pId: string, field: keyof Product, value: string) => {
    if (!isEditing) return;
    const sanitizedValue = field === 'link' ? value.replace(/#/g, '') : value;
    const updatedProducts = (editForm.products || []).map(p => p.id === pId ? { ...p, [field]: sanitizedValue } : p);
    setEditForm({ ...editForm, products: updatedProducts } as Block);
  };

  const handleDeleteProduct = (pId: string) => setConfirmDelete({ type: 'product', id: pId });

  const SaveButton = ({ onClick, disabled, label }: { onClick: () => void, disabled: boolean, label: string }) => (
    <button 
      onClick={onClick}
      disabled={disabled || isSaving}
      className={`px-8 py-4 rounded-2xl font-black text-sm transition-all flex items-center justify-center gap-2 shadow-xl ${
        isSaved 
          ? 'bg-emerald-500 text-white scale-105' 
          : 'bg-purple-600 text-white hover:bg-purple-700 active:scale-95 disabled:opacity-50'
      }`}
    >
      {isSaving ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isSaved ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : null}
      <span>{isSaving ? '저장 중...' : isSaved ? '적용 완료 ✅' : label}</span>
    </button>
  );

  return (
    <div className="flex h-full bg-[#F8FAFC]">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
      
      <div className="flex-1 overflow-y-auto p-4 md:p-14">
        <header className="mb-6 md:mb-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
            <div>
              <h1 className="text-lg md:text-3xl font-black text-[#1E1E2E] mb-1 md:mb-2">매니지먼트 데스크</h1>
              <p className="text-[#64748B] font-medium text-[9px] md:text-sm">포스트를 클릭하면 언제든 상품 정보를 수정할 수 있으며, 데이터는 자동 저장됩니다.</p>
            </div>
            
            <div className="flex bg-white p-1 rounded-2xl border border-[#E2E8F0] self-start md:self-auto">
              <button onClick={() => setActiveTab('posts')} className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === 'posts' ? 'bg-[#1E1E2E] text-white shadow-lg' : 'text-[#64748B] hover:bg-slate-50'}`}>포스트 관리</button>
              <button onClick={() => setActiveTab('design')} className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === 'design' ? 'bg-[#1E1E2E] text-white shadow-lg' : 'text-[#64748B] hover:bg-slate-50'}`}>디자인 설정</button>
            </div>
          </div>
        </header>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'posts' ? (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div className="flex gap-3">
                  <button className="px-5 py-2 bg-[#1E1E2E] text-white rounded-full text-xs font-black">전체</button>
                </div>
                <SaveButton onClick={handleSaveBlocks} disabled={isLoading} label="저장하기" />
              </div>

              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xs md:text-sm font-black text-[#64748B]">전체 리스트 ({blocks.length})</h2>
                <button onClick={handleAddBlock} className="text-purple-600 font-black text-[10px] md:text-xs flex items-center gap-1 hover:scale-105 transition-all">
                  <Plus size={14} /> 새 포스트 추가
                </button>
              </div>

              <div className="space-y-3 md:space-y-4">
                {blocks.map(block => (
                  <div key={block.id} onClick={() => { setIsEditing(block.id); setEditForm(block); }} className="bg-white p-4 md:p-6 rounded-[1.5rem] border border-[#E2E8F0] flex items-center gap-4 md:gap-6 cursor-pointer hover:border-purple-600 transition-all group shadow-sm">
                    <div className="w-16 h-16 md:w-24 md:h-24 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                      <SafeImage src={block.coverMedia} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1">
                      <span className="inline-block bg-[#F1F5F9] text-[#64748B] text-[7px] md:text-[10px] font-black px-1.5 py-0.5 rounded-md mb-1 uppercase tracking-wider">{block.category}</span>
                      <h3 className="text-xs md:text-lg font-black text-[#1E1E2E] mb-0.5">{block.title}</h3>
                      <p className="text-[7px] md:text-[10px] font-black text-[#94A3B8] uppercase tracking-widest">{(block.products || []).length} ITEMS LINKED</p>
                    </div>
                    <ChevronRight size={18} className="text-[#CBD5E1] group-hover:text-purple-600 transition-all" />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-12">
              <div className="flex justify-end">
                <SaveButton onClick={handleSaveDesign} disabled={false} label="저장하기" />
              </div>
              
              <section className="bg-white p-8 rounded-[2rem] border border-[#E2E8F0] space-y-6">
                <h3 className="text-sm font-black text-[#1E1E2E]">프로필 정보 설정</h3>
                <div className="space-y-4">
                  <input type="text" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-black text-lg" placeholder="이름" />
                  <textarea value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm" placeholder="소개" rows={2} />
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-sm font-black text-[#1E1E2E]">레이아웃 및 테마</h3>
                <div className="grid grid-cols-2 gap-6">
                  <button 
                    onClick={() => setLayoutTemplate('grid')} 
                    className={`p-10 rounded-[2rem] border-2 transition-all flex flex-col items-center gap-4 ${layoutTemplate === 'grid' ? 'border-purple-600 bg-purple-50' : 'border-[#E2E8F0] bg-white'}`}
                  >
                    <div className="w-full aspect-video bg-slate-100 rounded-xl grid grid-cols-3 gap-1 p-2">
                      {[1,2,3,4,5,6].map(i => <div key={i} className="bg-slate-300 rounded-sm"></div>)}
                    </div>
                    <span className="font-black text-xs">쇼퍼블 그리드</span>
                  </button>
                  <button 
                    onClick={() => setLayoutTemplate('list')} 
                    className={`p-10 rounded-[2rem] border-2 transition-all flex flex-col items-center gap-4 ${layoutTemplate === 'list' ? 'border-purple-600 bg-purple-50' : 'border-[#E2E8F0] bg-white'}`}
                  >
                    <div className="w-full aspect-video bg-slate-100 rounded-xl flex flex-col gap-1 p-2">
                      {[1,2,3].map(i => <div key={i} className="h-2 bg-slate-300 rounded-sm"></div>)}
                    </div>
                    <span className="font-black text-xs">미니멀 리스트</span>
                  </button>
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-sm font-black text-[#1E1E2E]">테마 프리셋</h3>
                <div className="grid grid-cols-2 gap-6">
                  <button 
                    onClick={() => handleThemeChange('midnight')} 
                    className={`p-10 rounded-[2rem] border-2 transition-all flex flex-col items-center gap-4 ${themePreset === 'midnight' ? 'border-purple-600 bg-purple-50' : 'border-[#E2E8F0] bg-white'}`}
                  >
                    <div className="w-12 h-12 rounded-full bg-[#1E1E2E] border-4 border-white shadow-lg"></div>
                    <span className="font-black text-xs">미드나잇 블랙</span>
                  </button>
                  <button 
                    onClick={() => handleThemeChange('white')} 
                    className={`p-10 rounded-[2rem] border-2 transition-all flex flex-col items-center gap-4 ${themePreset === 'white' ? 'border-purple-600 bg-purple-50' : 'border-[#E2E8F0] bg-white'}`}
                  >
                    <div className="w-12 h-12 rounded-full bg-white border-4 border-slate-100 shadow-lg"></div>
                    <span className="font-black text-xs">퓨어 화이트</span>
                  </button>
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-sm font-black text-[#1E1E2E]">그리드 상세 설정</h3>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">그리드 칸 수</label>
                    <div className="flex gap-2">
                      {[1, 2, 3].map((num) => (
                        <button
                          key={num}
                          onClick={() => setColumns(num as 1 | 2 | 3)}
                          className={`flex-1 py-3 rounded-xl font-black text-xs transition-all ${columns === num ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-400'}`}
                        >
                          {num}칸
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">아이템 스타일</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setItemStyle('equal')}
                        className={`flex-1 py-3 rounded-xl font-black text-xs transition-all ${itemStyle === 'equal' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-400'}`}
                      >
                        정사각형
                      </button>
                      <button
                        onClick={() => setItemStyle('magazine')}
                        className={`flex-1 py-3 rounded-xl font-black text-xs transition-all ${itemStyle === 'magazine' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-400'}`}
                      >
                        매거진
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Preview Area */}
      <div className="hidden xl:flex w-[480px] bg-[#EEF2F6] border-l border-[#E2E8F0] items-center justify-center p-12 sticky top-0 h-screen">
        <div className="relative w-full max-w-[320px] aspect-[9/19.5] bg-[#1E1E2E] rounded-[3.5rem] border-[12px] border-[#0F172A] shadow-2xl overflow-hidden flex flex-col">
          <div className={`flex-1 overflow-y-auto ${themePreset === 'white' ? 'bg-[#F8FAFC] text-slate-900' : 'bg-[#1E1E2E] text-white'}`}>
            <div className="pt-10 pb-6 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full border-2 p-1 mb-3" style={{ borderColor: accentColor }}>
                <img src={profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userName}`} alt="" className="w-full h-full rounded-full bg-slate-800" />
              </div>
              <h2 className="text-lg font-black uppercase">{profile.name}</h2>
            </div>

            <div className={`px-6 pb-10 ${layoutTemplate === 'grid' ? 'grid grid-cols-2 gap-3' : 'space-y-3'}`}>
              {blocks.map(block => (
                <div key={block.id} onClick={() => { setPreviewSelectedBlock(block); setShowBottomSheet(true); }} className="cursor-pointer">
                  <div className={`rounded-xl overflow-hidden border ${themePreset === 'white' ? 'bg-white border-slate-100' : 'bg-white/5 border-white/10'}`}>
                    <SafeImage src={block.coverMedia} alt="" className="w-full aspect-square object-cover" />
                    <div className="p-2"><p className="text-[8px] font-black truncate">{block.title}</p></div>
                  </div>
                </div>
              ))}
            </div>

            {showBottomSheet && previewSelectedBlock && (
              <div className="absolute inset-0 z-50 flex flex-col justify-end">
                <div className="absolute inset-0 bg-black/40" onClick={() => setShowBottomSheet(false)}></div>
                <div className={`relative rounded-t-[2rem] p-6 animate-in slide-in-from-bottom duration-300 ${themePreset === 'white' ? 'bg-white' : 'bg-[#1E1E2E]'}`}>
                  <h3 className="text-sm font-black mb-6">연결된 상품</h3>
                  <div className="space-y-3">
                    {(previewSelectedBlock.products || []).map(product => (
                      <a 
                        key={product.id} 
                        href={product.link.startsWith('http') ? product.link : `https://${product.link}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-100"
                      >
                        <span className="text-[10px] font-black text-slate-900">{product.name}</span>
                        <ChevronRight size={14} className="text-purple-600" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsEditing(null)}></div>
          <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[3rem] shadow-2xl relative z-10 overflow-hidden flex flex-col">
            <div className="p-10 pb-6 flex justify-between items-center">
              <h3 className="text-3xl font-black text-[#1E1E2E]">포스트 수정</h3>
              <button onClick={() => setIsEditing(null)} className="text-slate-400 hover:rotate-90 transition-all"><X size={24} /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-10 pt-0 space-y-10 custom-scrollbar">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="w-full md:w-1/2 space-y-4">
                  <div 
                    className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50 overflow-hidden relative group cursor-pointer" 
                    onClick={() => triggerFileUpload({ type: 'block' })}
                  >
                    {editForm.coverMedia ? (
                      <SafeImage src={editForm.coverMedia} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                        <ImageIcon size={48} />
                        <span className="text-xs font-black">이미지 업로드</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                      <ImageIcon size={32} />
                    </div>
                  </div>
                </div>
                <div className="w-full md:w-1/2 space-y-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">포스트 제목</label>
                    <input type="text" value={editForm.title || ''} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black focus:border-purple-600 transition-all" placeholder="제목" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">카테고리</label>
                    <input type="text" value={editForm.category || ''} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black uppercase focus:border-purple-600 transition-all" placeholder="카테고리" />
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h4 className="text-lg font-black text-purple-600">연결 상품</h4>
                  <button onClick={handleAddProduct} className="bg-purple-50 text-purple-600 px-4 py-2 rounded-full font-black text-xs hover:bg-purple-100 transition-all">+ 추가</button>
                </div>
                {editForm.products?.map(product => (
                  <div key={product.id} className="bg-[#F8FAFC] p-6 rounded-[2.5rem] border border-[#E2E8F0] space-y-4">
                    <input type="text" placeholder="상품명" value={product.name} onChange={e => handleUpdateProduct(product.id, 'name', e.target.value)} className="w-full bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black" />
                    <div className="flex gap-3">
                      <input type="text" placeholder="구매 링크 (URL)" value={product.link} onChange={e => handleUpdateProduct(product.id, 'link', e.target.value)} className="flex-1 bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black" />
                      <button onClick={() => handleDeleteProduct(product.id)} className="w-14 h-14 bg-white border border-red-100 text-red-400 rounded-2xl flex items-center justify-center hover:text-red-500 transition-all"><Trash2 size={20} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-10 bg-[#F8FAFC] border-t border-[#E2E8F0] flex gap-4">
              <button onClick={() => handleDeleteBlock(isEditing)} className="w-14 h-14 bg-white border border-red-100 text-red-500 rounded-[1.5rem] flex items-center justify-center hover:bg-red-50 transition-all"><Trash2 size={24} /></button>
              <div className="flex-1">
                <SaveButton onClick={handleSaveEdit} disabled={false} label="수정 완료" />
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmDelete(null)}></div>
          <div className="bg-white rounded-[2rem] p-8 w-full max-w-xs relative z-10 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-xl font-black text-center mb-8">정말 삭제하시겠습니까?</h3>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setConfirmDelete(null)} className="py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">취소</button>
              <button onClick={executeDelete} className="py-4 bg-red-500 text-white rounded-2xl font-black">삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* [UX 최적화] Toast 메시지 */}
      <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[500] pointer-events-none">
        {showToast && (
          <div className={`px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 ${
            toastType === 'success' ? 'bg-emerald-500 text-white' : 
            toastType === 'warning' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {toastType === 'success' ? <CheckCircle2 size={20} /> : toastType === 'warning' ? <AlertTriangle size={20} /> : <X size={20} />}
            <span className="font-black text-sm">{saveMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkManagement;
