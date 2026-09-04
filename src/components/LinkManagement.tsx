import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronRight, ChevronUp, ChevronDown, Image as ImageIcon, Trash2, Loader2, CheckCircle2, AlertTriangle, Plus, Bold as BoldIcon, Italic as ItalicIcon, Underline as UnderlineIcon, Strikethrough as StrikethroughIcon, GripVertical, ArrowUp, ArrowDown, Move, Lock, Camera, Globe, Briefcase, User, Eye } from 'lucide-react';
import ImageCropper from './ImageCropper';
import { supabase } from '../services/supabase';
import { getSiteSettings, updateSiteSettings, getLinkGridItems, updateLinkGridItems, SiteSettings } from '../services/settingsService';
import { getCachedLinkData, clearLinkCache } from '../services/prefetchService';
import { apiService, type SaveResult } from '../services/apiService';
import { Block, BlockDisplayType, Product, ProductOption, TemplateType, DesignSettings, ProductFolder, SellerVerification } from '../types';
import MediaAuto from './MediaAuto';
import PhoneFrame from './PhoneFrame';
import PagePreview from './PagePreview';
import ColorPicker from './ColorPicker';
import { DEFAULT_BUTTONS, type DefaultButtonKey } from '../utils/pageButtons';
import {
  type ThemePreset,
  THEME_BG_PRESETS,
  PRESET_BACKGROUND,
  DEFAULT_CUSTOM_BACKGROUND,
  isLightBackground,
  normalizeHexColor,
} from '../utils/themeColor';
import { useLanguage } from '../contexts/LanguageContext';

const TEXT_COLOR_PRESETS = ['#37352f', '#0f172a', '#6b7280', '#2563EB', '#2563eb', '#dc2626', '#059669', '#d97706'];
const HIGHLIGHT_COLOR_PRESETS: { value: string; label: string }[] = [
  { value: 'transparent', label: '없음' },
  { value: '#FEF3C7', label: '노랑' },
  { value: '#FEE2E2', label: '빨강' },
  { value: '#DBEAFE', label: '파랑' },
  { value: '#D1FAE5', label: '초록' },
  { value: '#FCE7F3', label: '분홍' },
  { value: '#E0E7FF', label: '보라' },
  { value: '#F1F5F9', label: '회색' }
];

// 테마 프리셋의 기본 포인트 색상 외에, 자주 쓰는 색을 한 번에 고를 수 있게 하는
// 빠른 선택용 팔레트. 여기 없는 색은 ColorPicker 로 직접 지정한다.
const ACCENT_COLOR_PRESETS: { value: string; label: string }[] = [
  { value: '#3B82F6', label: '블루' },
  { value: '#0f172a', label: '잉크 블랙' },
  { value: '#6366F1', label: '인디고' },
  { value: '#8B5CF6', label: '바이올렛' },
  { value: '#EC4899', label: '핑크' },
  { value: '#EF4444', label: '레드' },
  { value: '#F97316', label: '오렌지' },
  { value: '#F59E0B', label: '앰버' },
  { value: '#10B981', label: '에메랄드' },
  { value: '#14B8A6', label: '틸' },
  { value: '#0EA5E9', label: '스카이' },
  { value: '#64748B', label: '슬레이트' }
];

interface LinkManagementProps {
  userName: string;
  onNavigateMembership?: () => void;
}

// [시각적 확인] 새 코드가 적용되었음을 알리는 알림창
if (typeof window !== 'undefined') {
  (window as any)._picks_code_applied = true;
}

const LinkManagement: React.FC<LinkManagementProps> = ({ userName, onNavigateMembership }) => {
  const { language, t } = useLanguage();
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

  const [verification, setVerification] = useState<SellerVerification | null>(
    () => apiService.getCachedSellerVerification(userName.replace(/^biz\//, ''))
  );
  const membershipActive = !!verification?.membership_active;

  useEffect(() => {
    let cancelled = false;
    apiService.getSellerVerification(userName.replace(/^biz\//, '')).then((data) => {
      if (!cancelled) setVerification(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userName]);

  // Product Folder (InfoClink-style) state
  const [productFolders, setProductFolders] = useState<ProductFolder[]>(() => {
    try {
      const saved = localStorage.getItem(`picks_folders_${(userName || '').toLowerCase()}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [linkGridCategories, setLinkGridCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`picks_categories_${(userName || '').toLowerCase()}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [_showFolderModal, setShowFolderModal] = useState(false);
  const [folderEditName, setFolderEditName] = useState('');
  const [folderEditIcon, setFolderEditIcon] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  
  // UX 상태 관리
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
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
  // 저장된 테마 읽기. 'custom' 은 팔레트에서 배경색을 직접 고른 상태다.
  // 값이 비었을 때의 기본값은 호출하는 쪽이 정한다 — 예전 동작을 그대로 둔다.
  const readTheme = (value: unknown, fallback: ThemePreset): ThemePreset =>
    value === 'midnight' || value === 'white' || value === 'custom' ? value : fallback;
  const [themePreset, setThemePreset] = useState<ThemePreset>(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return readTheme(design.theme, 'white');
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return 'white';
  });
  /** 팔레트에서 직접 고른 배경색. 프리셋을 쓰는 동안에도 골라 둔 값은 남는다. */
  const [customBg, setCustomBg] = useState(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return normalizeHexColor(design.customBackground)
          || normalizeHexColor(design.customGradient)
          || DEFAULT_CUSTOM_BACKGROUND;
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return DEFAULT_CUSTOM_BACKGROUND;
  });
  const [accentColor, setAccentColor] = useState(() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      if (saved) {
        const design = JSON.parse(saved);
        return design.accentColor || (design.theme === 'white' ? '#0f172a' : '#3B82F6');
      }
    } catch (e) {
      console.error('Error parsing design:', e);
    }
    return '#3B82F6';
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

  // Social links for preview
  const [socials, setSocials] = useState<any>(() => {
    try {
      const saved = localStorage.getItem(`picks_socials_${(userName || '').toLowerCase()}`);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  /**
   * 편집 화면에서 펼쳐 둔 기본 버튼 칸.
   *
   * 저장되는 값은 주소(socials.kakao 등)뿐이다. 이 목록은 "주소를 아직 안 넣었지만
   * 입력칸은 열어 둔" 상태만 담는다 — 저장하지 않는 이유는, 주소가 비어 있는 버튼은
   * 공개 페이지에 나오지 않으므로 저장할 내용이 없기 때문이다.
   */
  const [openDefaultButtons, setOpenDefaultButtons] = useState<DefaultButtonKey[]>([]);

  // Mobile Preview State
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'product' | 'block' | 'category', id: string } | null>(null);
  const [showBlockTypeModal, setShowBlockTypeModal] = useState(false);
  const [newBlockColSpan, setNewBlockColSpan] = useState<1 | 2 | 3>(1);
  const [newBlockDisplayType, setNewBlockDisplayType] = useState<BlockDisplayType>('grid');
  const [pendingNewBlockId, setPendingNewBlockId] = useState<string | null>(null);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [showTextHighlightPicker, setShowTextHighlightPicker] = useState(false);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(null);
  const [categoryEditValue, setCategoryEditValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textEditorRef = useRef<HTMLDivElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ type: 'block' } | { type: 'product', productId: string } | { type: 'cover' } | null>(null);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const fullDesignRef = useRef<Record<string, any>>((() => {
    try {
      const saved = localStorage.getItem(`picks_design_${(userName || '').toLowerCase()}`);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  })());

  // 상단 커버 (개인페이지 맨 위 이미지/영상) — design.portfolioHeaderImage 에 저장된다.
  // 별도 메뉴(포트폴리오)로 분리돼 있던 커버/이름/버튼 편집을 이 화면으로 통합했다.
  const [coverImage, setCoverImage] = useState<string | undefined>(() => fullDesignRef.current.portfolioHeaderImage);
  const [coverPosition, setCoverPosition] = useState<string | undefined>(() => fullDesignRef.current.portfolioHeaderImagePosition);
  // 모바일에서 실제 개인페이지를 실시간으로 확인할 수 있는 미리보기 시트.
  const [showMobilePreview, setShowMobilePreview] = useState(false);

  // 이미지를 Base64 데이터 URL로 변환하는 헬퍼
  const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // editForm에 이미지 URL 적용하는 헬퍼
  const applyImageToForm = (url: string, target: typeof uploadTarget) => {
    if (!target) return;
    if (target.type === 'block') {
      setEditForm(prev => ({ ...prev, coverMedia: url }));
    } else if (target.type === 'cover') {
      setCoverImage(url);
      fullDesignRef.current = { ...fullDesignRef.current, portfolioHeaderImage: url };
    } else if (target.type === 'product') {
      setEditForm(prev => ({
        ...prev,
        products: (prev.products || []).map(p =>
          p.id === target.productId ? { ...p, image: url } : p
        )
      }));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      setSaveMessage('이미지 또는 영상 파일만 업로드할 수 있습니다.');
      setToastType('error');
      setShowToast(true);
      return;
    }

    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.size > MAX_FILE_SIZE) {
      setSaveMessage('파일 크기가 20MB를 초과합니다.');
      setToastType('error');
      setShowToast(true);
      return;
    }

    if (isVideo && !membershipActive) {
      setSaveMessage('영상 업로드는 스탠다드 멤버십(월 4,900원)부터 이용할 수 있습니다.');
      setToastType('error');
      setShowToast(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (isVideo) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setIsUploading(true);
      const currentTarget = uploadTarget;
      try {
        const blobUrl = URL.createObjectURL(file);
        applyImageToForm(blobUrl, currentTarget);

        let finalUrl = '';
        const ext = file.name?.split('.').pop()?.toLowerCase() || 'mp4';
        const fileName = `${Date.now()}-${file.name.replace(/\.[^/.]+$/, "")}.${ext}`;

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const apiUrl = await apiService.uploadImage(userName, file, fileName);
            if (apiUrl) { finalUrl = apiUrl; break; }
          } catch (apiError) {
            console.warn(`[Upload] API 업로드 시도 ${attempt + 1}/3 실패:`, apiError);
            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }

        if (!finalUrl && supabase) {
          try {
            const filePath = `${userName.toLowerCase()}/${fileName}`;
            const { error: uploadError } = await supabase.storage
              .from('images')
              .upload(filePath, file, { contentType: file.type, cacheControl: '3600', upsert: true });
            if (uploadError) throw uploadError;
            const { data: publicData } = supabase.storage.from('images').getPublicUrl(filePath);
            if (publicData?.publicUrl) finalUrl = publicData.publicUrl;
          } catch (storageError) {
            console.warn('[Upload] Supabase 업로드 실패, Base64로 전환:', storageError);
          }
        }

        if (!finalUrl) {
          finalUrl = await blobToDataUrl(file);
        }

        applyImageToForm(finalUrl, currentTarget);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        showSuccessFeedback('영상이 업로드되었습니다!');
      } catch (error) {
        console.error('[Upload] 에러:', error);
        setSaveMessage('영상 업로드 중 오류가 발생했습니다. 다시 시도해주세요.');
        setToastType('error');
        setShowToast(true);
      } finally {
        setIsUploading(false);
        setUploadTarget(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      return;
    }

    pendingFileRef.current = file;
    const previewUrl = URL.createObjectURL(file);
    setCropperSrc(previewUrl);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropConfirm = async (croppedBlob: Blob) => {
    const file = pendingFileRef.current;
    setCropperSrc(null);
    pendingFileRef.current = null;
    if (!file || !uploadTarget) return;

    setIsUploading(true);
    const currentTarget = uploadTarget;

    try {
      // 1. 크롭된 이미지 사용 (이미 크롭 완료됨)
      const processedBlob = croppedBlob;

      // 2. 로컬 미리보기 즉시 표시
      const blobUrl = URL.createObjectURL(processedBlob);
      applyImageToForm(blobUrl, currentTarget);

      // 3. Netlify Blobs API 업로드 시도 (메인 스토리지) - 재시도 로직
      let finalUrl = '';
      const ext = file.name?.split('.').pop()?.toLowerCase() || (processedBlob.type === 'image/png' ? 'png' : processedBlob.type === 'image/webp' ? 'webp' : 'jpg');
      const fileName = `${Date.now()}-${file.name.replace(/\.[^/.]+$/, "")}.${ext}`;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const apiUrl = await apiService.uploadImage(userName, processedBlob, fileName);
          if (apiUrl) {
            finalUrl = apiUrl;
            break;
          }
        } catch (apiError) {
          console.warn(`[Upload] API 업로드 시도 ${attempt + 1}/3 실패:`, apiError);
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }

      // 4. API 실패 시 Supabase Storage 업로드 시도
      if (!finalUrl && supabase) {
        try {
          const filePath = `${userName.toLowerCase()}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('images')
            .upload(filePath, processedBlob, {
              contentType: processedBlob.type || file.type || 'image/jpeg',
              cacheControl: '3600',
              upsert: true
            });

          if (uploadError) throw uploadError;

          const { data: publicData } = supabase.storage
            .from('images')
            .getPublicUrl(filePath);

          if (publicData?.publicUrl) {
            finalUrl = publicData.publicUrl;
          }
        } catch (storageError) {
          console.warn('[Upload] Supabase 업로드 실패, Base64로 전환:', storageError);
        }
      }

      // 5. Supabase도 실패 시 Base64 데이터 URL로 폴백
      if (!finalUrl) {
        finalUrl = await blobToDataUrl(processedBlob);
      }

      // 6. 최종 URL로 업데이트
      applyImageToForm(finalUrl, currentTarget);

      // 메모리 해제
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 1000);

      showSuccessFeedback('이미지가 업로드되었습니다!');
    } catch (error) {
      console.error('[Upload] 에러:', error);
      setSaveMessage('이미지 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
      setToastType('error');
      setShowToast(true);
    } finally {
      setIsUploading(false);
      setUploadTarget(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCropCancel = () => {
    if (cropperSrc) URL.revokeObjectURL(cropperSrc);
    setCropperSrc(null);
    pendingFileRef.current = null;
    setUploadTarget(null);
  };

  const coverPosContainerRef = useRef<HTMLDivElement>(null);
  const [coverPosDragging, setCoverPosDragging] = useState(false);
  const coverPosDragStart = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  const handleCoverPosDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCoverPosDragging(true);
    const pos = editForm.coverMediaPosition || { x: 50, y: 50 };
    coverPosDragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [editForm.coverMediaPosition]);

  const handleCoverPosMove = useCallback((e: React.PointerEvent) => {
    if (!coverPosDragging || !coverPosDragStart.current || !coverPosContainerRef.current) return;
    const rect = coverPosContainerRef.current.getBoundingClientRect();
    const dx = ((e.clientX - coverPosDragStart.current.x) / rect.width) * -100;
    const dy = ((e.clientY - coverPosDragStart.current.y) / rect.height) * -100;
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    setEditForm(prev => ({
      ...prev,
      coverMediaPosition: {
        x: clamp(coverPosDragStart.current!.posX + dx),
        y: clamp(coverPosDragStart.current!.posY + dy),
      }
    }));
  }, [coverPosDragging]);

  const handleCoverPosUp = useCallback(() => {
    setCoverPosDragging(false);
    coverPosDragStart.current = null;
  }, []);

  useEffect(() => {
    if (!coverPosDragging) return;
    const up = () => { setCoverPosDragging(false); coverPosDragStart.current = null; };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [coverPosDragging]);

  const triggerFileUpload = (target: { type: 'block' } | { type: 'product', productId: string } | { type: 'cover' }) => {
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  useEffect(() => {
    const loadData = async () => {
      const cached = getCachedLinkData(userName);
      if (cached) {
        if (cached.gridItems && cached.gridItems.length > 0) setBlocks(cached.gridItems);
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
        // API (Netlify Blobs) 먼저 시도
        const apiData = await apiService.getSiteData(userName);
        if (apiData) {
          // API is the source of truth — always apply its data, even if empty
          if (Array.isArray(apiData.blocks)) {
            setBlocks(apiData.blocks);
            localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(apiData.blocks));
          }
          if (apiData.productFolders) {
            setProductFolders(apiData.productFolders);
            localStorage.setItem(`picks_folders_${userName.toLowerCase()}`, JSON.stringify(apiData.productFolders));
          }
          if (apiData.design) {
            applySettings({ userName, templateType: TemplateType.SHOPPABLE_GRID, blocks: apiData.blocks || [], design: apiData.design as any, profile: apiData.profile });
          }
          if (apiData.socials) {
            setSocials(apiData.socials);
            localStorage.setItem(`picks_socials_${userName.toLowerCase()}`, JSON.stringify(apiData.socials));
          }
          if (Array.isArray(apiData.linkGridCategories)) {
            setLinkGridCategories(apiData.linkGridCategories);
            localStorage.setItem(`picks_categories_${userName.toLowerCase()}`, JSON.stringify(apiData.linkGridCategories));
          }
          // API에 블록 데이터가 없으면 Supabase 폴백
          if ((!apiData.blocks || apiData.blocks.length === 0)) {
            const [settings, gridItems] = await Promise.all([
              getSiteSettings(userName),
              getLinkGridItems(userName)
            ]);

            if (gridItems && gridItems.length > 0) {
              setBlocks(gridItems);
              localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(gridItems));
              // Netlify Blobs에도 동기화
              apiService.saveSiteData(userName, { blocks: gridItems }).catch(() => {});
            } else if (settings && Array.isArray(settings.blocks) && settings.blocks.length > 0) {
              setBlocks(settings.blocks);
              localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(settings.blocks));
              apiService.saveSiteData(userName, { blocks: settings.blocks }).catch(() => {});
            }

            if (settings) {
              applySettings(settings);
            }
          }
        } else {
          // API 실패 시 Supabase 폴백
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
        }
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const applySettings = (settings: SiteSettings) => {
      if (settings.design) {
        fullDesignRef.current = { ...fullDesignRef.current, ...settings.design };
        setHomePriority(settings.design.homePriority === 'portfolio' ? 'portfolio' : 'curation');
        setLayoutTemplate(settings.design.templateType === TemplateType.LINK_LIST ? 'list' : 'grid');
        setColumns(settings.design.gridColumns as 1 | 2 | 3 || 2);
        setThemePreset(readTheme(settings.design.theme, 'midnight'));
        setAccentColor(settings.design.accentColor || (settings.design.theme === 'white' ? '#0f172a' : '#3B82F6'));
        setCustomGradient(settings.design.customGradient || 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)');
        setCustomBg(
          normalizeHexColor(settings.design.customBackground)
            || normalizeHexColor(settings.design.customGradient)
            || DEFAULT_CUSTOM_BACKGROUND,
        );
        setPortfolioFontSize(settings.design.portfolioFontSize || 'medium');
        if (settings.design.portfolioHeaderImage !== undefined) setCoverImage(settings.design.portfolioHeaderImage);
        if (settings.design.portfolioHeaderImagePosition !== undefined) setCoverPosition(settings.design.portfolioHeaderImagePosition);
      }
      if (settings.profile) {
        setProfile(settings.profile);
      }
    };

    loadData();
  }, [userName]);

  useEffect(() => {
    if (textEditorRef.current && isEditing && editForm.displayType === 'text') {
      textEditorRef.current.innerHTML = editForm.textContent || '';
    }
  }, [isEditing]);

  // --- 텍스트 블록 부분 서식 -------------------------------------------------
  // 볼드·밑줄·색상 버튼을 누르는 순간 contentEditable 의 포커스가 버튼으로 넘어가
  // 선택 영역이 사라진다. 그래서 마지막 선택 위치를 따로 기억해 두고, 버튼을
  // 눌렀을 때 그 영역을 되살려서 선택한 글자에만 서식을 넣는다.
  // 선택한 글자가 없으면 예전처럼 블록 전체 설정을 바꾼다.
  const textSelectionRangeRef = useRef<Range | null>(null);

  const rememberTextSelection = () => {
    const el = textEditorRef.current;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;
    textSelectionRangeRef.current = range.cloneRange();
  };

  // 기억해 둔 선택 영역을 복원한다. 실제로 고른 글자가 있을 때만 true.
  const restoreTextSelection = (): boolean => {
    const el = textEditorRef.current;
    const range = textSelectionRangeRef.current;
    if (!el || !range) return false;
    if (!el.contains(range.commonAncestorContainer)) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    el.focus();
    sel.removeAllRanges();
    sel.addRange(range);
    return !sel.isCollapsed && sel.toString().length > 0;
  };

  const syncTextContentFromEditor = () => {
    const el = textEditorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    setEditForm(prev => ({ ...prev, textContent: html }));
  };

  // execCommand 는 구식이지만 contentEditable 의 부분 서식에 대해서는 여전히
  // 모든 주요 브라우저가 지원하는 유일한 방법이다. styleWithCSS 를 켜 두면
  // <font> 대신 style 이 붙은 <span> 이 생겨서 저장·렌더링 경로(sanitizeRichHtml)와
  // 그대로 맞는다.
  const runEditorCommand = (command: string, value?: string): boolean => {
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch { /* 지원하지 않는 브라우저는 <font> 로 떨어진다 (sanitizer 가 허용) */ }
    try {
      return document.execCommand(command, false, value);
    } catch {
      return false;
    }
  };

  type TextToggleField = 'bold' | 'italic' | 'underline' | 'strikethrough';

  const applyTextToggle = (command: string, field: TextToggleField) => {
    if (!restoreTextSelection()) {
      setEditForm(prev => ({ ...prev, [field]: !prev[field] }));
      return;
    }
    runEditorCommand(command);
    rememberTextSelection();
    syncTextContentFromEditor();
  };

  const applyTextColor = (color: string) => {
    if (!restoreTextSelection()) {
      setEditForm(prev => ({ ...prev, color }));
      return;
    }
    runEditorCommand('foreColor', color);
    rememberTextSelection();
    syncTextContentFromEditor();
  };

  const applyTextHighlight = (color: string) => {
    if (!restoreTextSelection()) {
      setEditForm(prev => ({ ...prev, highlight: color }));
      return;
    }
    // hiliteColor 를 지원하지 않는 브라우저(구형 Edge 등)는 backColor 로 대체된다.
    if (!runEditorCommand('hiliteColor', color)) runEditorCommand('backColor', color);
    rememberTextSelection();
    syncTextContentFromEditor();
  };

  // 선택한 글자에 들어간 부분 서식만 걷어낸다. 블록 전체 설정은 그대로 둔다.
  const clearSelectionFormatting = () => {
    if (!restoreTextSelection()) return;
    runEditorCommand('removeFormat');
    rememberTextSelection();
    syncTextContentFromEditor();
  };

  const DARK_BG_ACCENT = '#3B82F6';
  const LIGHT_BG_ACCENT = '#0f172a';
  /** 지금 미리보기에 깔리는 배경색. 프리셋은 고정색, 자유 배경은 고른 색. */
  const themeBackground = themePreset === 'custom'
    ? customBg
    : PRESET_BACKGROUND[themePreset === 'white' ? 'white' : 'midnight'];
  /** 배경이 밝으면 글자가 어두워진다 — 공개 페이지와 같은 기준으로 판단한다. */
  const themeIsLight = themePreset === 'custom' ? isLightBackground(customBg) : themePreset === 'white';

  /** 이 배경 위에서 기본값으로 쓸 포인트 색. */
  const defaultAccentFor = (light: boolean) => (light ? LIGHT_BG_ACCENT : DARK_BG_ACCENT);

  /**
   * 포인트 색을 아직 손대지 않았는지. 두 기본색 중 하나를 그대로 쓰고 있으면
   * 배경을 바꿀 때 새 배경에 맞는 기본색으로 따라 옮겨 준다. 팔레트나 색상
   * 선택기로 직접 고른 색은 배경을 바꿔도 건드리지 않는다.
   */
  const usingDefaultAccent = () =>
    [DARK_BG_ACCENT, LIGHT_BG_ACCENT].some(c => c.toLowerCase() === (accentColor || '').toLowerCase());

  const handleThemeChange = (theme: ThemePreset) => {
    setThemePreset(theme);
    if (usingDefaultAccent()) {
      setAccentColor(defaultAccentFor(theme === 'custom' ? isLightBackground(customBg) : theme === 'white'));
    }
  };

  /** 팔레트나 색상 선택기로 배경색을 고름. 고르는 순간 자유 배경 테마로 넘어간다. */
  const handleCustomBackground = (hex: string) => {
    const next = normalizeHexColor(hex) || DEFAULT_CUSTOM_BACKGROUND;
    setCustomBg(next);
    setThemePreset('custom');
    if (usingDefaultAccent()) setAccentColor(defaultAccentFor(isLightBackground(next)));
  };

  const showSuccessFeedback = (message: string) => {
    setIsSaved(true);
    setSaveMessage(message);
    setToastType('success');
    setShowToast(true);
    setTimeout(() => setIsSaved(false), 1500);
    setTimeout(() => setShowToast(false), 3000);
  };

  const showFailureFeedback = (message: string, type: 'warning' | 'error' = 'error') => {
    setSaveMessage(message);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 5000);
  };

  /**
   * 저장이 실패한 이유를 화면에 띄울 한 줄로 바꾼다.
   *
   * 예전에는 어떤 실패든 "로컬에 저장됨 (클라우드 동기화 재시도 중...)" 하나만
   * 띄웠다. 그래서 다시 로그인해야 하는 건지, 이미지가 너무 큰 건지, 잠깐 끊긴
   * 건지 알 수 없었고 — 되지 않는 재시도만 반복됐다.
   */
  const saveFailureMessage = (result: { status: number; error: string }): string => {
    if (result.status === 401) return '로컬에만 저장됨 — 로그인이 만료되었습니다. 다시 로그인해 주세요.';
    if (result.status === 403) return '로컬에만 저장됨 — 이 계정을 수정할 권한이 없습니다.';
    if (result.status === 413) return '로컬에만 저장됨 — 저장할 내용이 너무 큽니다. 이미지를 줄여 주세요.';
    if (!result.error) return '로컬에만 저장됨 — 저장에 실패했습니다. 잠시 후 다시 시도해주세요.';
    return `로컬에만 저장됨 — ${result.error}`;
  };

  /**
   * 로컬 저장. 용량이 꽉 차면 예외가 나는데(base64 이미지가 섞인 문서가 특히 그렇다)
   * 그대로 던지면 저장 핸들러가 중간에 끊겨 버튼이 "저장 중" 에서 멈춘다.
   */
  const writeLocal = (key: string, value: unknown): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[Save] 로컬 저장 실패(저장 공간 부족일 수 있습니다):', err);
    }
  };

  const handleSaveDesign = async () => {
    setIsSaving(true);
    const designUpdate: Partial<DesignSettings> = {
      ...fullDesignRef.current,
      templateType: layoutTemplate === 'list' ? TemplateType.LINK_LIST : TemplateType.SHOPPABLE_GRID,
      theme: themePreset,
      accentColor: accentColor,
      borderRadius: 'full',
      gridGap: 1,
      gridColumns: columns,
      gridStyle: 'standard',
      fontFamily: 'Sans',
      buttonStyle: 'solid',
      backgroundType: 'solid',
      customGradient: customGradient,
      customBackground: customBg,
      profileLayout: 'center',
      homePriority: homePriority === 'portfolio' ? 'portfolio' : 'curation',
      portfolioFontSize: portfolioFontSize,
      portfolioHeaderImage: coverImage,
      portfolioHeaderImagePosition: coverPosition,
    };

    // 버튼(비즈니스 제안 · 기본 버튼 · 커스텀 버튼)은 모두 socials 에 저장된다. 빈 버튼은 제외.
    const cleanedSocials = {
      ...socials,
      customButtons: (socials.customButtons || []).filter((b: any) => (b.label || '').trim() && (b.url || '').trim()),
    };

    // 즉시 로컬 저장
    fullDesignRef.current = designUpdate as Record<string, any>;
    writeLocal(`picks_profile_${userName.toLowerCase()}`, profile);
    writeLocal(`picks_design_${userName.toLowerCase()}`, designUpdate);
    writeLocal(`picks_socials_${userName.toLowerCase()}`, cleanedSocials);
    setSocials(cleanedSocials);

    // 클라우드 동기화 완료 후 결과 표시
    try {
      const result = await apiService.saveSiteDataResult(userName, { design: designUpdate as any, profile, socials: cleanedSocials });
      if (result.ok) {
        clearLinkCache(userName);
        showSuccessFeedback('저장되었습니다!');
      } else {
        showFailureFeedback(saveFailureMessage(result), 'warning');
      }
      // Supabase 동기화 (백그라운드)
      updateSiteSettings(userName, { design: designUpdate as any, profile, socials: cleanedSocials })
        .catch(err => console.warn('[SaveDesign] Supabase 동기화 실패:', err));
    } catch (error) {
      console.error('[SaveDesign] 클라우드 동기화 실패:', error);
      showFailureFeedback('저장 실패 - 다시 시도해주세요');
    } finally {
      setIsSaving(false);
    }
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const saveBlocksToCloud = async (blocksToSave: Block[]): Promise<SaveResult> => {
    try {
      const result = await apiService.saveSiteDataResult(userName, { blocks: blocksToSave });
      // 저장이 성공하면 프리페치 캐시를 비워, 편집 화면을 다시 열어도
      // 방금 저장한 내용이 즉시 반영되도록 한다(오래된 캐시가 덮어쓰지 않게).
      if (result.ok) clearLinkCache(userName);
      // Supabase 동기화도 시도 (백그라운드)
      Promise.all([
        updateLinkGridItems(blocksToSave),
        updateSiteSettings(userName, { blocks: blocksToSave })
      ]).catch(err => console.warn('[SaveBlocks] Supabase 동기화 실패:', err));
      return result;
    } catch (error) {
      console.error('[SaveBlocks] 클라우드 동기화 실패:', error);
      return { ok: false, status: 0, error: '저장에 실패했습니다. 잠시 후 다시 시도해주세요.', retryable: true };
    }
  };

  const handleSaveBlocks = async () => {
    setIsSaving(true);
    const sanitizedBlocks = blocks.map(block => ({
      ...block,
      products: (block.products || []).map(p => ({
        ...p,
        link: (p.link || '').replace(/#/g, '')
      }))
    }));

    // 즉시 로컬 저장 및 UI 반영
    setBlocks(sanitizedBlocks);
    writeLocal(`picks_blocks_${userName.toLowerCase()}`, sanitizedBlocks);

    // 클라우드 동기화 완료 후 결과 표시
    const result = await saveBlocksToCloud(sanitizedBlocks);
    if (result.ok) {
      showSuccessFeedback('저장 완료!');
    } else if (!result.retryable) {
      // 같은 요청을 다시 보내도 같은 응답이 온다. 무엇을 해야 하는지 바로 알린다.
      showFailureFeedback(saveFailureMessage(result), 'warning');
    } else {
      showFailureFeedback('로컬에 저장됨 (클라우드 동기화 재시도 중...)', 'warning');
      const retry = await saveBlocksToCloud(sanitizedBlocks);
      if (retry.ok) {
        showSuccessFeedback('클라우드 동기화 완료!');
      } else {
        showFailureFeedback(saveFailureMessage(retry), 'warning');
      }
    }
    setIsSaving(false);
  };

  const handleAddBlock = () => {
    setNewBlockColSpan(1);
    setNewBlockDisplayType('grid');
    setShowBlockTypeModal(true);
  };

  const handleMoveBlock = (blockId: string, direction: 'up' | 'down') => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    const cat = block.category || '';
    const sameCategory = blocks.filter(b => (b.category || '') === cat);
    const idxInCat = sameCategory.findIndex(b => b.id === blockId);
    if (idxInCat < 0) return;
    if (direction === 'up' && idxInCat === 0) return;
    if (direction === 'down' && idxInCat === sameCategory.length - 1) return;
    const swapTarget = direction === 'up' ? sameCategory[idxInCat - 1] : sameCategory[idxInCat + 1];
    const idxA = blocks.findIndex(b => b.id === blockId);
    const idxB = blocks.findIndex(b => b.id === swapTarget.id);
    const updated = [...blocks];
    [updated[idxA], updated[idxB]] = [updated[idxB], updated[idxA]];
    setBlocks(updated);
    writeLocal(`picks_blocks_${userName.toLowerCase()}`, updated);
    saveBlocksToCloud(updated).catch(() => {});
  };

  const handleDragStart = (e: React.DragEvent, blockId: string) => {
    setDraggedBlockId(blockId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetBlockId: string) => {
    e.preventDefault();
    if (!draggedBlockId || draggedBlockId === targetBlockId) {
      setDraggedBlockId(null);
      return;
    }
    const fromIdx = blocks.findIndex(b => b.id === draggedBlockId);
    const toIdx = blocks.findIndex(b => b.id === targetBlockId);
    if (fromIdx < 0 || toIdx < 0) { setDraggedBlockId(null); return; }
    const updated = [...blocks];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    setBlocks(updated);
    writeLocal(`picks_blocks_${userName.toLowerCase()}`, updated);
    saveBlocksToCloud(updated).catch(() => {});
    setDraggedBlockId(null);
  };

  const handleDragEnd = () => {
    setDraggedBlockId(null);
  };

  const handleConfirmAddBlock = () => {
    const effectiveColSpan = newBlockDisplayType === 'grid' ? newBlockColSpan : 1;
    const assignedCategory = selectedFolderId || '';
    const newBlock: Block = {
      id: generateId(),
      title: newBlockDisplayType === 'text' ? '새로운 텍스트' : '새로운 포스트',
      category: assignedCategory,
      coverMedia: '',
      mediaType: 'image',
      products: newBlockDisplayType === 'text' ? [] : [{ id: generateId(), name: '새 상품', image: '', link: '' }],
      colSpan: effectiveColSpan,
      displayType: newBlockDisplayType,
      ...(newBlockDisplayType === 'text' ? { textContent: '', fontSizePx: 14, color: '#37352f' } : {}),
    };
    setPendingNewBlockId(newBlock.id);
    setShowBlockTypeModal(false);
    setIsEditing(newBlock.id);
    setEditForm(newBlock);
  };

  const handleCancelEdit = () => {
    if (pendingNewBlockId && isEditing === pendingNewBlockId) {
      setPendingNewBlockId(null);
    }
    setIsEditing(null);
  };

  // Product Folder Management Functions
  const saveFoldersToCloud = async (foldersToSave: ProductFolder[]) => {
    localStorage.setItem(`picks_folders_${userName.toLowerCase()}`, JSON.stringify(foldersToSave));
    apiService.saveSiteData(userName, { productFolders: foldersToSave }).catch(err => console.warn('[SaveFolders] 클라우드 동기화 실패:', err));
  };

  const _handleAddFolder = () => {
    setEditingFolderId(null);
    setFolderEditName('');
    setFolderEditIcon('');
    setShowFolderModal(true);
  };

  const _handleEditFolder = (folder: ProductFolder) => {
    setEditingFolderId(folder.id);
    setFolderEditName(folder.name);
    setFolderEditIcon(folder.icon || '');
    setShowFolderModal(true);
  };

  const _handleSaveFolder = () => {
    if (!folderEditName.trim()) return;
    let updatedFolders: ProductFolder[];
    if (editingFolderId) {
      updatedFolders = productFolders.map(f => f.id === editingFolderId ? { ...f, name: folderEditName.trim(), icon: folderEditIcon.trim() } : f);
    } else {
      const newFolder: ProductFolder = {
        id: generateId(),
        name: folderEditName.trim(),
        icon: folderEditIcon.trim(),
        order: productFolders.length,
        blockIds: []
      };
      updatedFolders = [...productFolders, newFolder];
    }
    setProductFolders(updatedFolders);
    saveFoldersToCloud(updatedFolders);
    setShowFolderModal(false);
    showSuccessFeedback(editingFolderId ? '폴더가 수정되었습니다!' : '새 폴더가 추가되었습니다!');
  };

  const _handleDeleteFolder = (folderId: string) => {
    const updatedFolders = productFolders.filter(f => f.id !== folderId);
    setProductFolders(updatedFolders);
    saveFoldersToCloud(updatedFolders);
    if (selectedFolderId === folderId) setSelectedFolderId(null);
    showSuccessFeedback('폴더가 삭제되었습니다!');
  };

  const _handleToggleBlockInFolder = (folderId: string, blockId: string) => {
    const updatedFolders = productFolders.map(f => {
      if (f.id !== folderId) return f;
      const hasBlock = f.blockIds.includes(blockId);
      return { ...f, blockIds: hasBlock ? f.blockIds.filter(id => id !== blockId) : [...f.blockIds, blockId] };
    });
    setProductFolders(updatedFolders);
    saveFoldersToCloud(updatedFolders);
  };

  // Folder management functions - reserved for future folder UI
  void _handleAddFolder; void _handleEditFolder; void _handleSaveFolder; void _handleDeleteFolder; void _handleToggleBlockInFolder;

  const managedCategories = (() => {
    const catSet = new Set<string>();
    for (const b of blocks) {
      const c = b.category;
      if (c) catSet.add(c);
    }
    for (const c of linkGridCategories) {
      catSet.add(c);
    }
    return Array.from(catSet);
  })();

  const saveCategoriesToCloud = (cats: string[]) => {
    localStorage.setItem(`picks_categories_${userName.toLowerCase()}`, JSON.stringify(cats));
    apiService.saveSiteData(userName, { linkGridCategories: cats }).catch(err => console.warn('[SaveCategories] 클라우드 동기화 실패:', err));
  };

  const handleAddCategory = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    if (managedCategories.includes(trimmed)) {
      showSuccessFeedback('이미 존재하는 카테고리입니다!');
      return;
    }
    const updatedCats = [...linkGridCategories, trimmed];
    setLinkGridCategories(updatedCats);
    saveCategoriesToCloud(updatedCats);
    setNewCategoryName('');
    setSelectedFolderId(trimmed);
    showSuccessFeedback(`'${trimmed}' 카테고리가 추가되었습니다!`);
  };

  const handleRenameCategory = (oldName: string) => {
    const trimmed = categoryEditValue.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingCategoryName(null);
      return;
    }
    if (managedCategories.includes(trimmed)) {
      showSuccessFeedback('이미 존재하는 카테고리입니다!');
      return;
    }
    const updatedBlocks = blocks.map(b => b.category === oldName ? { ...b, category: trimmed } : b);
    setBlocks(updatedBlocks);
    writeLocal(`picks_blocks_${userName.toLowerCase()}`, updatedBlocks);
    saveBlocksToCloud(updatedBlocks).catch(() => {});
    const updatedCats = linkGridCategories.map(c => c === oldName ? trimmed : c);
    setLinkGridCategories(updatedCats);
    saveCategoriesToCloud(updatedCats);
    if (selectedFolderId === oldName) setSelectedFolderId(trimmed);
    setEditingCategoryName(null);
    showSuccessFeedback(`카테고리가 '${trimmed}'(으)로 변경되었습니다!`);
  };

  // 카테고리는 안에 들어 있는 포스트까지 함께 지우기 때문에, 휴지통을 누르면
  // 바로 지우지 않고 블록·상품 삭제와 같은 확인창을 한 번 띄운다.
  const handleDeleteCategory = (catName: string) => setConfirmDelete({ type: 'category', id: catName });

  const executeDeleteCategory = (catName: string) => {
    const updatedBlocks = blocks.filter(b => b.category !== catName);
    setBlocks(updatedBlocks);
    writeLocal(`picks_blocks_${userName.toLowerCase()}`, updatedBlocks);
    saveBlocksToCloud(updatedBlocks).catch(() => {});
    const updatedCats = linkGridCategories.filter(c => c !== catName);
    setLinkGridCategories(updatedCats);
    saveCategoriesToCloud(updatedCats);
    if (selectedFolderId === catName) setSelectedFolderId(null);
    showSuccessFeedback(`'${catName}' 카테고리가 삭제되었습니다!`);
  };

  const displayedBlocks = selectedFolderId
    ? blocks.filter(b => b.category === selectedFolderId)
    : blocks;

  const orderedCategoryGroups = (() => {
    if (selectedFolderId) return [];
    const seen = new Set<string>();
    const order: string[] = [];
    for (const b of blocks) {
      const cat = b.category || '';
      if (!seen.has(cat)) {
        seen.add(cat);
        order.push(cat);
      }
    }
    return order.map(cat => ({
      category: cat,
      blocks: blocks.filter(b => (b.category || '') === cat),
    }));
  })();

  const handleMoveCategoryGroup = (category: string, direction: 'up' | 'down') => {
    const catOrder: string[] = [];
    const seen = new Set<string>();
    for (const b of blocks) {
      const cat = b.category || '';
      if (!seen.has(cat)) { seen.add(cat); catOrder.push(cat); }
    }
    const idx = catOrder.indexOf(category);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === catOrder.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [catOrder[idx], catOrder[swapIdx]] = [catOrder[swapIdx], catOrder[idx]];
    const reordered: Block[] = [];
    for (const cat of catOrder) {
      reordered.push(...blocks.filter(b => (b.category || '') === cat));
    }
    setBlocks(reordered);
    writeLocal(`picks_blocks_${userName.toLowerCase()}`, reordered);
    saveBlocksToCloud(reordered).catch(() => {});
  };

  const handleSaveEdit = async () => {
    if (!isEditing) return;

    setIsSaving(true);
    const sanitizedEditForm = {
      ...editForm,
      products: (editForm.products || []).map(p => ({
        ...p,
        link: p.link.replace(/#/g, '')
      }))
    } as Block;

    let updatedBlocks: Block[];
    if (pendingNewBlockId && isEditing === pendingNewBlockId) {
      updatedBlocks = [...blocks, sanitizedEditForm];
      setPendingNewBlockId(null);
    } else {
      updatedBlocks = blocks.map(b => b.id === isEditing ? sanitizedEditForm : b);
    }
    setBlocks(updatedBlocks);
    writeLocal(`picks_blocks_${userName.toLowerCase()}`, updatedBlocks);

    // 클라우드 동기화 완료 후 결과 표시
    const result = await saveBlocksToCloud(updatedBlocks);
    if (result.ok) {
      showSuccessFeedback('포스트가 수정되었습니다!');
    } else {
      showFailureFeedback(saveFailureMessage(result), 'warning');
    }
    setIsEditing(null);
    setIsSaving(false);
  };

  const handleDeleteBlock = (id: string) => setConfirmDelete({ type: 'block', id });

  const executeDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === 'block') {
      const updatedBlocks = blocks.filter(b => b.id !== confirmDelete.id);
      setBlocks(updatedBlocks);
      writeLocal(`picks_blocks_${userName.toLowerCase()}`, updatedBlocks);
      // 클라우드 동기화 (백그라운드)
      saveBlocksToCloud(updatedBlocks).catch(err => console.warn('[DeleteBlock] 클라우드 동기화 실패:', err));
      setIsEditing(null);
    } else if (confirmDelete.type === 'product') {
      const updatedProducts = (editForm.products || []).filter(p => p.id !== confirmDelete.id);
      setEditForm({ ...editForm, products: updatedProducts } as Block);
    } else if (confirmDelete.type === 'category') {
      executeDeleteCategory(confirmDelete.id);
    }
    setConfirmDelete(null);
  };

  const handleAddProduct = () => {
    if (!isEditing) return;
    const newProduct: Product = { id: generateId(), name: '새 상품', link: '', options: [] };
    setEditForm({ ...editForm, products: [...(editForm.products || []), newProduct] } as Block);
  };

  const handleUpdateProduct = (pId: string, field: keyof Product, value: string) => {
    if (!isEditing) return;
    const sanitizedValue = field === 'link' ? value.replace(/#/g, '') : value;
    const updatedProducts = (editForm.products || []).map(p => p.id === pId ? { ...p, [field]: sanitizedValue } : p);
    setEditForm({ ...editForm, products: updatedProducts } as Block);
  };

  const handleAddOption = (pId: string) => {
    if (!isEditing) return;
    const newOption: ProductOption = { id: generateId(), name: '', values: [''] };
    const updatedProducts = (editForm.products || []).map(p =>
      p.id === pId ? { ...p, options: [...(p.options || []), newOption] } : p
    );
    setEditForm({ ...editForm, products: updatedProducts } as Block);
  };

  const handleUpdateOption = (pId: string, optId: string, field: 'name' | 'values', value: string | string[]) => {
    if (!isEditing) return;
    const updatedProducts = (editForm.products || []).map(p =>
      p.id === pId ? {
        ...p,
        options: (p.options || []).map(opt =>
          opt.id === optId ? { ...opt, [field]: value } : opt
        )
      } : p
    );
    setEditForm({ ...editForm, products: updatedProducts } as Block);
  };

  const handleDeleteOption = (pId: string, optId: string) => {
    if (!isEditing) return;
    const updatedProducts = (editForm.products || []).map(p =>
      p.id === pId ? { ...p, options: (p.options || []).filter(opt => opt.id !== optId) } : p
    );
    setEditForm({ ...editForm, products: updatedProducts } as Block);
  };

  const handleDeleteProduct = (pId: string) => setConfirmDelete({ type: 'product', id: pId });

  const SaveButton = ({ onClick, disabled, label }: { onClick: () => void, disabled: boolean, label: string }) => (
    <button
      onClick={onClick}
      disabled={disabled || isSaving || isUploading}
      className={`px-10 py-5 rounded-2xl font-black text-base transition-all flex items-center justify-center gap-2 shadow-2xl ${
        isSaved
          ? 'bg-emerald-500 text-white scale-105'
          : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 disabled:opacity-50'
      }`}
    >
      {isSaving ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isSaved ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : null}
      <span>{isSaving ? '저장 중...' : isSaved ? '적용 완료' : label}</span>
    </button>
  );

  return (
    <div className="flex h-full bg-[#F8FAFC] justify-center">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,video/mp4,video/webm,video/ogg,video/quicktime" />
      {cropperSrc && (
        <ImageCropper
          src={cropperSrc}
          onCrop={handleCropConfirm}
          onCancel={handleCropCancel}
          aspectRatio={uploadTarget?.type === 'cover' ? 4 / 5 : 1}
        />
      )}
      
      <div className="flex-1 xl:flex-none xl:w-[760px] min-w-0 overflow-y-auto p-4 md:p-10">
        <div className="max-w-[680px] mx-auto w-full">
          <header className="mb-6 md:mb-10">
          <div className="flex flex-col gap-4 mb-6">
            <div>
              <h1 className="text-xl md:text-4xl font-black text-[#1E1E2E] mb-1 md:mb-2">{t('nav.links', '링크 관리', 'Link Management')}</h1>
              <p className="text-[#64748B] font-medium text-xs md:text-base">
                {language === 'en'
                  ? 'Manage products, images, videos, text, profile, cover, and buttons in one place with real-time preview.'
                  : '상품·이미지·영상·텍스트와 프로필·커버·버튼을 한 곳에서 관리하고, 개인페이지에 보이는 그대로 미리볼 수 있어요.'}
              </p>
            </div>

            <div className="flex w-full bg-white p-1 rounded-2xl border border-[#E2E8F0]">
              <button onClick={() => setActiveTab('posts')} className={`flex-1 px-4 py-3 rounded-xl text-sm font-black transition-all ${activeTab === 'posts' ? 'bg-[#1E1E2E] text-white shadow-lg' : 'text-[#64748B] hover:bg-slate-50'}`}>
                {language === 'en' ? 'Post Management' : '포스트 관리'}
              </button>
              <button onClick={() => setActiveTab('design')} className={`flex-1 px-4 py-3 rounded-xl text-sm font-black transition-all ${activeTab === 'design' ? 'bg-[#1E1E2E] text-white shadow-lg' : 'text-[#64748B] hover:bg-slate-50'}`}>
                {language === 'en' ? 'Profile · Design' : '프로필 · 디자인'}
              </button>
            </div>
          </div>
        </header>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'posts' ? (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div className="flex gap-2 overflow-x-auto scrollbar-hide items-center">
                  {(() => {
                    const cats = ['전체', ...managedCategories];
                    return cats.map(cat => {
                      const displayCat = cat === '전체' ? (language === 'en' ? 'ALL' : '전체') : cat;
                      return (
                        <button key={cat} onClick={() => setSelectedFolderId(cat === '전체' ? null : cat)} className={`px-5 py-2 rounded-full text-xs font-black whitespace-nowrap transition-all ${(cat === '전체' && !selectedFolderId) || selectedFolderId === cat ? 'bg-[#1E1E2E] text-white shadow-lg' : 'bg-white text-[#64748B] border border-[#E2E8F0] hover:border-blue-300'}`}>
                          {displayCat}
                        </button>
                      );
                    });
                  })()}
                </div>
                <SaveButton onClick={handleSaveBlocks} disabled={isLoading} label={t('common.save', '저장하기', 'Save Changes')} />
              </div>


              <div className="flex justify-between items-center mb-6">
                <h2 className="text-sm md:text-base font-black text-[#64748B]">
                  {selectedFolderId ? `${selectedFolderId} (${displayedBlocks.length})` : (language === 'en' ? `All Items (${blocks.length})` : `전체 리스트 (${blocks.length})`)}
                </h2>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowCategoryModal(true)} className="text-slate-500 font-black text-xs md:text-sm flex items-center gap-1 hover:scale-105 transition-all border border-[#E2E8F0] px-3 py-1.5 rounded-full hover:border-blue-300">
                    <Plus size={14} /> {language === 'en' ? 'Manage Categories' : '카테고리 관리'}
                  </button>
                  <button onClick={handleAddBlock} className="text-white bg-blue-600 font-black text-xs md:text-sm flex items-center gap-1 hover:bg-blue-700 transition-all px-3.5 py-1.5 rounded-full shadow-sm">
                    <Plus size={14} /> {language === 'en' ? 'Add Content' : '콘텐츠 추가'}
                  </button>
                </div>
              </div>

              <div className="space-y-3 md:space-y-4">
                {!selectedFolderId ? (
                  orderedCategoryGroups.map((group, groupIndex) => (
                    <div key={group.category || '__uncategorized'} className="rounded-2xl border border-[#E2E8F0] overflow-hidden bg-slate-50/50">
                      <div className="flex items-center justify-between px-4 md:px-6 py-3 bg-white border-b border-[#E2E8F0]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs md:text-sm font-black text-[#1E1E2E] uppercase tracking-wider">{group.category || (language === 'en' ? 'Uncategorized' : '미분류')}</span>
                          <span className="text-[10px] md:text-xs font-bold text-[#94A3B8]">{group.blocks.length}{language === 'en' ? ' items' : '개'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl px-1.5 py-1 border border-slate-200">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider px-1 hidden md:inline">{language === 'en' ? 'ORDER' : '순서'}</span>
                          <button
                            onClick={() => handleMoveCategoryGroup(group.category, 'up')}
                            disabled={groupIndex === 0}
                            className="p-1.5 rounded-lg bg-white hover:bg-blue-50 disabled:opacity-30 disabled:bg-transparent transition-all text-slate-500 hover:text-blue-600 shadow-sm disabled:shadow-none border border-slate-200 disabled:border-transparent"
                            title={language === 'en' ? 'Move Category Up' : '카테고리 위로 이동'}
                          >
                            <ChevronUp size={16} strokeWidth={2.5} />
                          </button>
                          <button
                            onClick={() => handleMoveCategoryGroup(group.category, 'down')}
                            disabled={groupIndex === orderedCategoryGroups.length - 1}
                            className="p-1.5 rounded-lg bg-white hover:bg-blue-50 disabled:opacity-30 disabled:bg-transparent transition-all text-slate-500 hover:text-blue-600 shadow-sm disabled:shadow-none border border-slate-200 disabled:border-transparent"
                            title="카테고리 아래로 이동"
                          >
                            <ChevronDown size={16} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2 p-2 md:p-3">
                        {group.blocks.map((block, blockIndex) => (
                          <div
                            key={block.id}
                            className={`bg-white p-4 md:p-5 rounded-xl border border-[#E2E8F0] flex items-center gap-3 md:gap-6 hover:border-blue-600 transition-all group shadow-sm ${draggedBlockId === block.id ? 'opacity-50' : ''}`}
                            draggable
                            onDragStart={e => handleDragStart(e, block.id)}
                            onDragOver={handleDragOver}
                            onDrop={e => handleDrop(e, block.id)}
                            onDragEnd={handleDragEnd}
                          >
                            <div className="flex flex-col items-center gap-1 flex-shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleMoveBlock(block.id, 'up'); }}
                                disabled={blockIndex === 0}
                                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-20 transition-all text-slate-400"
                              >
                                <ArrowUp size={14} />
                              </button>
                              <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-all">
                                <GripVertical size={16} />
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleMoveBlock(block.id, 'down'); }}
                                disabled={blockIndex === group.blocks.length - 1}
                                className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-20 transition-all text-slate-400"
                              >
                                <ArrowDown size={14} />
                              </button>
                            </div>
                            <div className="flex items-center gap-4 md:gap-6 cursor-pointer flex-1 min-w-0" onClick={() => { setIsEditing(block.id); setEditForm(block); }}>
                              <div className="w-16 h-16 md:w-24 md:h-24 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                                {block.displayType === 'text' ? (
                                  <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400">
                                    <span className="text-2xl font-black">T</span>
                                  </div>
                                ) : (
                                  <MediaAuto src={block.coverMedia} alt="" className="w-full h-full object-cover" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  <span className="inline-block bg-blue-50 text-blue-600 text-[9px] md:text-xs font-black px-2 py-0.5 rounded-md">
                                    {block.colSpan || 1}칸 · {block.displayType === 'minimal' ? '미니멀' : block.displayType === 'text' ? '텍스트' : '그리드'}
                                  </span>
                                </div>
                                {block.displayType === 'text' ? (
                                  <h3 className="text-sm md:text-xl font-black text-[#1E1E2E] mb-0.5 truncate">
                                    {block.textContent ? block.textContent.replace(/<[^>]*>/g, '').substring(0, 50) || '텍스트' : '텍스트를 입력하세요'}
                                  </h3>
                                ) : (
                                  <>
                                    <h3 className="text-sm md:text-xl font-black text-[#1E1E2E] mb-0.5">{block.title}</h3>
                                    <p className="text-[9px] md:text-xs font-black text-[#94A3B8] uppercase tracking-widest">{(block.products || []).length} ITEMS LINKED</p>
                                  </>
                                )}
                              </div>
                              <ChevronRight size={18} className="text-[#CBD5E1] group-hover:text-blue-600 transition-all" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  displayedBlocks.map((block, blockIndex) => (
                  <div
                    key={block.id}
                    className={`bg-white p-4 md:p-6 rounded-[1.5rem] border border-[#E2E8F0] flex items-center gap-3 md:gap-6 hover:border-blue-600 transition-all group shadow-sm ${draggedBlockId === block.id ? 'opacity-50' : ''}`}
                    draggable
                    onDragStart={e => handleDragStart(e, block.id)}
                    onDragOver={handleDragOver}
                    onDrop={e => handleDrop(e, block.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoveBlock(block.id, 'up'); }}
                        disabled={blockIndex === 0}
                        className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-20 transition-all text-slate-400"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-all">
                        <GripVertical size={16} />
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoveBlock(block.id, 'down'); }}
                        disabled={blockIndex === displayedBlocks.length - 1}
                        className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-20 transition-all text-slate-400"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-4 md:gap-6 cursor-pointer flex-1 min-w-0" onClick={() => { setIsEditing(block.id); setEditForm(block); }}>
                    <div className="w-16 h-16 md:w-24 md:h-24 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                      {block.displayType === 'text' ? (
                        <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-400">
                          <span className="text-2xl font-black">T</span>
                        </div>
                      ) : (
                        <MediaAuto src={block.coverMedia} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="inline-block bg-[#F1F5F9] text-[#64748B] text-[9px] md:text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">{block.category}</span>
                        <span className="inline-block bg-blue-50 text-blue-600 text-[9px] md:text-xs font-black px-2 py-0.5 rounded-md">
                          {block.colSpan || 1}칸 · {block.displayType === 'minimal' ? '미니멀' : block.displayType === 'text' ? '텍스트' : '그리드'}
                        </span>
                      </div>
                      {block.displayType === 'text' ? (
                        <h3 className="text-sm md:text-xl font-black text-[#1E1E2E] mb-0.5 truncate">
                          {block.textContent ? block.textContent.replace(/<[^>]*>/g, '').substring(0, 50) || '텍스트' : '텍스트를 입력하세요'}
                        </h3>
                      ) : (
                        <>
                          <h3 className="text-sm md:text-xl font-black text-[#1E1E2E] mb-0.5">{block.title}</h3>
                          <p className="text-[9px] md:text-xs font-black text-[#94A3B8] uppercase tracking-widest">{(block.products || []).length} ITEMS LINKED</p>
                        </>
                      )}
                    </div>
                    <ChevronRight size={18} className="text-[#CBD5E1] group-hover:text-blue-600 transition-all" />
                    </div>
                  </div>
                  ))
                )}
              </div>

            </>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-end">
                <SaveButton onClick={handleSaveDesign} disabled={false} label="저장하기" />
              </div>

              {/* 프로필 — 개인페이지에 노출되는 이름/소개. 링크 주소(@아이디)는 그대로 유지된다. */}
              <section className="space-y-4 bg-white rounded-2xl border border-[#E2E8F0] p-5 md:p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">프로필</h3>
                  <User size={18} className="text-blue-600" />
                </div>
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                  <Lock size={13} className="text-blue-500 shrink-0" />
                  <p className="text-[11px] font-bold text-blue-700">
                    내 링크 주소는 <span className="font-black">@{userName}</span> 로 항상 고정돼요. 아래 이름을 바꿔도 주소는 변하지 않습니다.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">표시 이름</label>
                  <input
                    type="text"
                    value={profile.name || ''}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-black text-base focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all"
                    placeholder="개인페이지에 보일 이름"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">소개</label>
                  <textarea
                    value={profile.bio || ''}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 font-bold text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition-all"
                    placeholder="한 줄 소개를 입력하세요"
                    rows={2}
                  />
                </div>
              </section>

              {/* 상단 커버 — 개인페이지 맨 위에 노출되는 이미지/영상. */}
              <section className="space-y-4 bg-white rounded-2xl border border-[#E2E8F0] p-5 md:p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">상단 커버</h3>
                  <ImageIcon size={18} className="text-blue-600" />
                </div>
                <div className="flex items-start gap-3">
                  <div
                    onClick={() => !coverImage && !isUploading && triggerFileUpload({ type: 'cover' })}
                    className="w-32 aspect-[4/5] rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all overflow-hidden relative shrink-0"
                  >
                    {isUploading && uploadTarget?.type === 'cover' && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                        <div className="w-7 h-7 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                      </div>
                    )}
                    {coverImage ? (
                      <MediaAuto
                        src={coverImage}
                        className="w-full h-full object-cover rounded-2xl"
                        style={coverPosition ? { objectPosition: `center ${coverPosition}%` } : undefined}
                      />
                    ) : (
                      <>
                        <ImageIcon size={28} className="text-slate-300 mb-1.5" />
                        <span className="text-[11px] font-black text-slate-400">커버 업로드</span>
                      </>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <button
                      onClick={() => triggerFileUpload({ type: 'cover' })}
                      disabled={isUploading}
                      className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-all font-black text-xs disabled:opacity-50"
                    >
                      <Camera size={15} /> {coverImage ? '커버 변경' : '커버 업로드'}
                    </button>
                    {!membershipActive && (
                      <p className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                        <Lock size={10} /> 영상 커버는 멤버십에서 이용할 수 있어요
                      </p>
                    )}
                    {coverImage && (
                      <button
                        onClick={() => { setCoverImage(undefined); setCoverPosition(undefined); fullDesignRef.current = { ...fullDesignRef.current, portfolioHeaderImage: undefined, portfolioHeaderImagePosition: undefined }; }}
                        className="flex items-center gap-1 text-[11px] font-black text-red-500 hover:text-red-600"
                      >
                        <Trash2 size={12} /> 커버 삭제
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {/* 버튼 — 개인페이지 상단에 노출되는 비즈니스 제안 / 기본 버튼 / 커스텀 버튼.
                  기본 버튼(카카오톡 · 유튜브 · 틱톡 · 네이버)은 주소만 넣으면 나온다.
                  이름과 디자인은 플랫폼이 정해 두었다 — utils/pageButtons.ts 주석 참고. */}
              <section className="space-y-3 bg-white rounded-2xl border border-[#E2E8F0] p-5 md:p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">버튼</h3>
                  <Globe size={18} className="text-blue-600" />
                </div>

                {socials.businessProposal && (
                  <div className="flex items-center gap-3 bg-blue-50 rounded-xl px-4 py-3">
                    <Briefcase size={16} className="text-blue-600 shrink-0" />
                    <span className="flex-1 font-bold text-sm text-blue-700">비즈니스 제안 버튼</span>
                    <button onClick={() => setSocials({ ...socials, businessProposal: false })} className="p-1 text-blue-300 hover:text-red-500 transition-colors"><X size={14} /></button>
                  </div>
                )}

                {/* 기본 버튼. 주소가 들어 있으면(= 공개 페이지에 나오면) 늘 펼쳐 두고,
                    비어 있는 것은 아래 추가 버튼을 눌렀을 때만 입력칸을 낸다 — 네 개를
                    항상 펼쳐 두면 쓰지 않는 칸이 편집 화면을 채운다.
                    지우기는 값을 비우는 것이다. 값이 없으면 버튼도 사라지므로 별도의
                    on/off 상태를 두지 않는다. */}
                {DEFAULT_BUTTONS.filter(def => (socials[def.key] || '').trim() || openDefaultButtons.includes(def.key)).map(def => (
                  <div key={def.key} className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-slate-400 shrink-0" />
                      <span className="flex-1 font-bold text-sm text-slate-700">{def.label}</span>
                      <button
                        onClick={() => {
                          setSocials({ ...socials, [def.key]: '' });
                          setOpenDefaultButtons(openDefaultButtons.filter(k => k !== def.key));
                        }}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={socials[def.key] || ''}
                      onChange={(e) => setSocials({ ...socials, [def.key]: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                      placeholder={def.placeholder}
                    />
                  </div>
                ))}

                {(socials.customButtons || []).map((btn: any, idx: number) => (
                  <div key={btn.id || idx} className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full shrink-0 border border-slate-200" style={{ backgroundColor: btn.color || '#2563EB' }} />
                      <input
                        type="text"
                        value={btn.label || ''}
                        onChange={(e) => {
                          const updated = [...(socials.customButtons || [])];
                          updated[idx] = { ...updated[idx], label: e.target.value };
                          setSocials({ ...socials, customButtons: updated });
                        }}
                        className="flex-1 bg-transparent border-none font-bold text-sm focus:outline-none"
                        placeholder="버튼 이름"
                      />
                      <button
                        onClick={() => setSocials({ ...socials, customButtons: (socials.customButtons || []).filter((_: any, i: number) => i !== idx) })}
                        className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-slate-400 shrink-0" />
                      <input
                        type="url"
                        value={btn.url || ''}
                        onChange={(e) => {
                          const updated = [...(socials.customButtons || [])];
                          updated[idx] = { ...updated[idx], url: e.target.value };
                          setSocials({ ...socials, customButtons: updated });
                        }}
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                        placeholder="https://example.com"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400">색상</span>
                      <ColorPicker
                        value={btn.color || '#2563EB'}
                        onChange={(c) => {
                          const updated = [...(socials.customButtons || [])];
                          updated[idx] = { ...updated[idx], color: c };
                          setSocials({ ...socials, customButtons: updated });
                        }}
                        triggerClassName="w-7 h-7 rounded-full"
                        aria-label="버튼 색상 선택"
                      />
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2 pt-1">
                  {!socials.businessProposal && (
                    <button onClick={() => setSocials({ ...socials, businessProposal: true })} className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-blue-300 text-blue-600 text-[11px] font-bold hover:bg-blue-50 transition-all">
                      <Plus size={12} /> <Briefcase size={12} /> 비즈니스 제안
                    </button>
                  )}
                  {DEFAULT_BUTTONS.filter(def => !(socials[def.key] || '').trim() && !openDefaultButtons.includes(def.key)).map(def => (
                    <button
                      key={def.key}
                      onClick={() => setOpenDefaultButtons([...openDefaultButtons, def.key])}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-slate-300 text-slate-500 text-[11px] font-bold hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                    >
                      <Plus size={12} /> {def.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setSocials({ ...socials, customButtons: [...(socials.customButtons || []), { id: Date.now().toString(), label: '', url: '', color: '#2563EB' }] })}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-slate-300 text-slate-500 text-[11px] font-bold hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                  >
                    <Plus size={12} /> <Globe size={12} /> 버튼 추가
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">테마 프리셋</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleThemeChange('midnight')}
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${themePreset === 'midnight' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-blue-300'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#1E1E2E] border-2 border-slate-700 shadow-inner flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-black">Aa</span>
                    </div>
                    <div className="text-left">
                      <span className="font-black text-sm block">미드나잇 블랙</span>
                      <span className="text-xs text-slate-500 font-bold">어두운 배경, 고급스러운 톤</span>
                    </div>
                  </button>
                  <button
                    onClick={() => handleThemeChange('white')}
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${themePreset === 'white' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-blue-300'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-white border-2 border-slate-200 shadow-inner flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-800 text-xs font-black">Aa</span>
                    </div>
                    <div className="text-left">
                      <span className="font-black text-sm block">퓨어 화이트</span>
                      <span className="text-xs text-slate-500 font-bold">밝고 깨끗한 미니멀</span>
                    </div>
                  </button>
                </div>

                {/* 프리셋 두 개로 끝내지 않는다. 배경색을 팔레트에서 자유롭게 고를 수
                    있고, 고른 색이 밝으면 글자·카드가 알아서 어두워진다(공개 페이지도
                    같은 기준으로 그린다). 그래서 어떤 색을 골라도 글씨가 배경에
                    묻히지 않는다. */}
                <div className={`p-5 rounded-2xl border-2 space-y-3 transition-all ${themePreset === 'custom' ? 'border-blue-600 bg-blue-50/60 shadow-sm' : 'border-[#E2E8F0] bg-white'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-xl border-2 border-slate-200 shadow-inner flex items-center justify-center flex-shrink-0"
                        style={{ background: customBg }}
                      >
                        <span className={`text-xs font-black ${isLightBackground(customBg) ? 'text-slate-800' : 'text-white'}`}>Aa</span>
                      </div>
                      <div className="text-left min-w-0">
                        <span className="font-black text-sm block">배경색 직접 선택</span>
                        <span className="text-xs text-slate-500 font-bold">팔레트에서 고르면 글자 색은 자동으로 맞춰집니다</span>
                      </div>
                    </div>
                    <ColorPicker
                      value={customBg}
                      onChange={handleCustomBackground}
                      triggerClassName="w-11 h-11 rounded-2xl flex-shrink-0"
                      aria-label="배경색 직접 지정"
                    />
                  </div>

                  <div className="grid grid-cols-8 gap-2">
                    {THEME_BG_PRESETS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => handleCustomBackground(c.value)}
                        title={c.label}
                        aria-label={`배경색 ${c.label}`}
                        className={`aspect-square w-full rounded-xl border-2 transition-all ${
                          themePreset === 'custom' && customBg.toLowerCase() === c.value.toLowerCase()
                            ? 'border-blue-600 scale-110 shadow-md'
                            : 'border-slate-200 hover:scale-105'
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">배경</span>
                    <span className="text-xs font-black text-slate-600">
                      {themePreset === 'custom' ? customBg.toUpperCase() : '프리셋 사용 중'}
                    </span>
                    {themePreset === 'custom' ? (
                      <button
                        onClick={() => handleThemeChange(isLightBackground(customBg) ? 'white' : 'midnight')}
                        className="ml-auto text-[11px] font-bold text-slate-400 hover:text-blue-600 transition-colors"
                      >
                        프리셋으로 되돌리기
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCustomBackground(customBg)}
                        className="ml-auto text-[11px] font-bold text-slate-400 hover:text-blue-600 transition-colors"
                      >
                        이 배경색 쓰기
                      </button>
                    )}
                  </div>
                </div>

                {/* 프리셋의 기본 포인트 색상을 그대로 쓰거나, 팔레트로 원하는 색을
                    직접 골라 쓸 수 있다. 프리셋 자체(밝은/어두운 배경)는 유지된다. */}
                <div className="p-5 rounded-2xl border-2 border-[#E2E8F0] bg-white space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-black text-sm block">포인트 색상</span>
                      <span className="text-xs text-slate-500 font-bold">버튼·강조 요소에 쓰이는 색을 자유롭게 정하세요</span>
                    </div>
                    <ColorPicker
                      value={accentColor}
                      onChange={setAccentColor}
                      triggerClassName="w-11 h-11 rounded-2xl flex-shrink-0"
                      aria-label="포인트 색상 직접 지정"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ACCENT_COLOR_PRESETS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setAccentColor(c.value)}
                        title={c.label}
                        aria-label={c.label}
                        className={`w-8 h-8 rounded-xl border-2 transition-all ${accentColor.toLowerCase() === c.value.toLowerCase() ? 'border-blue-600 scale-110 shadow-md' : 'border-slate-200 hover:scale-105'}`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">현재</span>
                    <span className="text-xs font-black text-slate-600">{accentColor.toUpperCase()}</span>
                    <button
                      onClick={() => setAccentColor(defaultAccentFor(themeIsLight))}
                      className="ml-auto text-[11px] font-bold text-slate-400 hover:text-blue-600 transition-colors"
                    >
                      프리셋 기본색으로
                    </button>
                  </div>
                </div>
              </section>


            </div>
          )}
        </div>
        </div>
      </div>

      {/* Mobile Preview Area — 리스트 바로 옆 고정 너비 칼럼. 기기는 화면 높이에 맞춰 크기가 정해지므로
          항상 한눈에 들어온다. 큰 화면에서는 칼럼을 넓혀 기기가 세로 여백까지 더 크게 채운다.
          별도의 세로 스크롤은 두지 않는다 */}
      <div className="hidden xl:block flex-none w-[600px] 2xl:w-[720px] bg-[#F8FAFC] sticky top-0 h-screen overflow-hidden">
        <div className="min-h-full flex items-center justify-center px-4 py-2">
        <PhoneFrame
          size="xl"
          label="실시간 미리보기"
          liveUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${userName}`}
          contentClassName={themeIsLight ? 'text-slate-900' : 'text-white'}
          contentStyle={{ background: themePreset === 'white' ? '#F8FAFC' : themeBackground }}
        >
            <PagePreview
              theme={themePreset}
              backgroundColor={customBg}
              accentColor={accentColor}
              header={{
                color: fullDesignRef.current.portfolioHeaderColor,
                image: coverImage,
                imagePosition: coverPosition,
              }}
              profile={profile}
              userName={userName}
              portfolioFontSize={portfolioFontSize}
              socials={socials}
              homePriority={homePriority}
              layoutTemplate={layoutTemplate}
              curationBlocks={blocks}
              managedCategories={managedCategories}
            />
        </PhoneFrame>
        </div>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleCancelEdit}></div>
          <div className="bg-white w-full max-w-2xl max-h-[92vh] sm:max-h-[90vh] rounded-t-[2rem] sm:rounded-[3rem] shadow-2xl relative z-10 overflow-hidden flex flex-col">
            <div className="p-5 sm:p-10 pb-4 sm:pb-6 flex justify-between items-center">
              <h3 className="text-xl sm:text-3xl font-black text-[#1E1E2E]">{editForm.displayType === 'text' ? '텍스트 수정' : '포스트 수정'}</h3>
              <button onClick={handleCancelEdit} className="text-slate-400 hover:rotate-90 transition-all p-2 -m-2"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-5 sm:p-10 pt-0 space-y-6 sm:space-y-10 custom-scrollbar">
              <div className="flex flex-col md:flex-row gap-8">
                {editForm.displayType !== 'text' && (
                <div className="w-full md:w-1/2 space-y-4">
                  {editForm.coverMedia ? (
                    <>
                      <div
                        ref={coverPosContainerRef}
                        className="relative overflow-hidden rounded-[2rem] border-2 border-blue-200 bg-slate-50 select-none"
                        style={{ aspectRatio: editForm.displayType === 'minimal' ? '16/10' : '1/1' }}
                      >
                        <MediaAuto
                          src={editForm.coverMedia}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          style={{ objectPosition: `${(editForm.coverMediaPosition?.x ?? 50)}% ${(editForm.coverMediaPosition?.y ?? 50)}%` }}
                        />
                        <div
                          className={`absolute inset-0 flex items-center justify-center transition-colors ${coverPosDragging ? 'bg-black/30 cursor-grabbing' : 'bg-black/10 hover:bg-black/20 cursor-grab'}`}
                          onPointerDown={handleCoverPosDown}
                          onPointerMove={handleCoverPosMove}
                          onPointerUp={handleCoverPosUp}
                        >
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-black/50 backdrop-blur-sm rounded-full text-white text-[10px] font-bold pointer-events-none">
                            <Move size={12} />
                            <span>드래그하여 노출 영역 조정</span>
                          </div>
                        </div>
                        {isUploading && uploadTarget?.type === 'block' && (
                          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white gap-2 z-10">
                            <Loader2 size={32} className="animate-spin" />
                            <span className="text-xs font-black">업로드 중...</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold text-center">
                        개인페이지에 {editForm.displayType === 'minimal' ? '미니멀(16:10)' : '정사각형(1:1)'} 비율로 표시됩니다
                      </p>
                    </>
                  ) : (
                    <div
                      className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50 overflow-hidden relative cursor-pointer"
                      onClick={() => !isUploading && triggerFileUpload({ type: 'block' })}
                    >
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                        <ImageIcon size={48} />
                        <span className="text-xs font-black">이미지/영상 업로드</span>
                      </div>
                      {isUploading && uploadTarget?.type === 'block' && (
                        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white gap-2">
                          <Loader2 size={32} className="animate-spin" />
                          <span className="text-xs font-black">업로드 중...</span>
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => !isUploading && triggerFileUpload({ type: 'block' })}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 text-blue-600 rounded-xl font-black text-xs hover:bg-blue-100 transition-all disabled:opacity-50 w-full justify-center"
                  >
                    <ImageIcon size={14} />
                    <span>{editForm.coverMedia ? '이미지/영상 변경' : '이미지/영상 업로드'}</span>
                  </button>
                  {!membershipActive && (
                    <button
                      onClick={() => onNavigateMembership?.()}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-600 rounded-xl text-[11px] font-bold w-full justify-center hover:bg-blue-100 transition-all"
                    >
                      <Lock size={12} />
                      <span>영상 업로드는 멤버십 전용</span>
                    </button>
                  )}
                </div>
                )}
                <div className={`w-full ${editForm.displayType !== 'text' ? 'md:w-1/2' : ''} space-y-6`}>
                  {editForm.displayType !== 'text' && (
                  <>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">포스트 제목</label>
                    <input type="text" value={editForm.title || ''} onChange={e => setEditForm({ ...editForm, title: e.target.value })} className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black focus:border-blue-600 transition-all" placeholder="제목" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">카테고리</label>
                    {/* 카테고리는 직접 입력하지 않고 이미 만들어 둔 목록에서 고른다.
                        오타로 비슷한 카테고리가 여러 개 생기는 일을 막는다. */}
                    <select
                      value={editForm.category || ''}
                      onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                      className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black focus:border-blue-600 transition-all appearance-none cursor-pointer"
                    >
                      <option value="">카테고리 없음</option>
                      {managedCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400 font-bold mt-1">
                      {managedCategories.length === 0
                        ? '아직 카테고리가 없습니다. 포스트 목록 위의 카테고리 관리에서 먼저 추가해 주세요.'
                        : '카테고리 관리에서 추가한 목록에서 선택합니다.'}
                    </p>
                  </div>
                  </>
                  )}
                  {editForm.displayType === 'grid' && (
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">레이아웃</label>
                    <div className="flex gap-2">
                      {([1, 2, 3] as const).map(num => (
                        <button key={num} onClick={() => setEditForm({ ...editForm, colSpan: num })} className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${(editForm.colSpan || 1) === num ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                          {num}칸
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold mt-1">1칸: 크게 표시 / 2,3칸: 동일 크기로 나열</p>
                  </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">표시 형식</label>
                    <div className="flex gap-2">
                      {([{ key: 'grid' as const, label: '그리드' }, { key: 'minimal' as const, label: '미니멀' }, { key: 'text' as const, label: '텍스트' }]).map(opt => (
                        <button key={opt.key} onClick={() => setEditForm({ ...editForm, displayType: opt.key })} className={`flex-1 py-3 rounded-xl font-black text-sm transition-all ${(editForm.displayType || 'grid') === opt.key ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Text Design Settings - only for text display type */}
              {editForm.displayType === 'text' && (
                <div className="space-y-4">
                  <h4 className="text-lg font-black text-blue-600">텍스트 디자인</h4>
                  <div className="bg-[#F8FAFC] p-5 rounded-2xl border border-[#E2E8F0] space-y-4">
                    {/* 서식 도구는 입력창 위에 둔다. 글자를 고른 뒤 바로 위 버튼을
                        누르는 흐름이 아래에 있을 때보다 훨씬 자연스럽다. */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">텍스트 옵션</label>
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={clearSelectionFormatting}
                          className="text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors"
                        >
                          선택 서식 지우기
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                      {/* Font Size */}
                      <div className="flex items-center gap-1 bg-white rounded-xl border border-[#E2E8F0] px-2 py-1">
                        <button onClick={() => setEditForm({ ...editForm, fontSizePx: Math.max(8, (editForm.fontSizePx || 14) - 1) })} className="p-1 hover:bg-slate-100 rounded"><ChevronDown size={14} /></button>
                        <span className="text-xs font-black w-8 text-center">{editForm.fontSizePx || 14}</span>
                        <button onClick={() => setEditForm({ ...editForm, fontSizePx: Math.min(96, (editForm.fontSizePx || 14) + 1) })} className="p-1 hover:bg-slate-100 rounded"><ChevronUp size={14} /></button>
                      </div>

                      {/* Bold */}
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => applyTextToggle('bold', 'bold')}
                        className={`p-2 rounded-xl transition-all ${editForm.bold ? 'bg-slate-900 text-white' : 'bg-white border border-[#E2E8F0] text-slate-500 hover:bg-slate-50'}`}
                        title="굵게 (글자를 선택하면 선택한 부분만)"
                      ><BoldIcon size={16} /></button>

                      {/* Italic */}
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => applyTextToggle('italic', 'italic')}
                        className={`p-2 rounded-xl transition-all ${editForm.italic ? 'bg-slate-900 text-white' : 'bg-white border border-[#E2E8F0] text-slate-500 hover:bg-slate-50'}`}
                        title="기울임 (글자를 선택하면 선택한 부분만)"
                      ><ItalicIcon size={16} /></button>

                      {/* Underline */}
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => applyTextToggle('underline', 'underline')}
                        className={`p-2 rounded-xl transition-all ${editForm.underline ? 'bg-slate-900 text-white' : 'bg-white border border-[#E2E8F0] text-slate-500 hover:bg-slate-50'}`}
                        title="밑줄 (글자를 선택하면 선택한 부분만)"
                      ><UnderlineIcon size={16} /></button>

                      {/* Strikethrough */}
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => applyTextToggle('strikeThrough', 'strikethrough')}
                        className={`p-2 rounded-xl transition-all ${editForm.strikethrough ? 'bg-slate-900 text-white' : 'bg-white border border-[#E2E8F0] text-slate-500 hover:bg-slate-50'}`}
                        title="취소선 (글자를 선택하면 선택한 부분만)"
                      ><StrikethroughIcon size={16} /></button>

                      {/* Text Color */}
                      <div className="relative">
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setShowTextColorPicker(!showTextColorPicker); setShowTextHighlightPicker(false); }}
                          className="p-2 rounded-xl bg-white border border-[#E2E8F0] text-slate-500 hover:bg-slate-50 transition-all flex items-center gap-1"
                          title="글씨색"
                        >
                          <span className="text-xs font-black">A</span>
                          <div className="w-4 h-1 rounded-full" style={{ backgroundColor: editForm.color || '#37352f' }}></div>
                        </button>
                        {showTextColorPicker && (
                          <div className="absolute top-full mt-2 left-0 z-50 bg-white rounded-xl border border-[#E2E8F0] shadow-xl p-3 space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">글씨색</p>
                            <div className="flex gap-1.5 flex-wrap max-w-[200px]">
                              {TEXT_COLOR_PRESETS.map(c => (
                                <button key={c}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => { applyTextColor(c); setShowTextColorPicker(false); }}
                                  className={`w-7 h-7 rounded-lg border-2 transition-all ${editForm.color === c ? 'border-blue-600 scale-110' : 'border-slate-200 hover:scale-105'}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                              <ColorPicker
                                value={editForm.color || '#37352f'}
                                onChange={applyTextColor}
                                triggerClassName="w-7 h-7 rounded-lg"
                                aria-label="글씨색 직접 지정"
                              />
                              팔레트에서 직접 선택
                            </label>
                          </div>
                        )}
                      </div>

                      {/* Highlight Color */}
                      <div className="relative">
                        <button
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => { setShowTextHighlightPicker(!showTextHighlightPicker); setShowTextColorPicker(false); }}
                          className="p-2 rounded-xl bg-white border border-[#E2E8F0] text-slate-500 hover:bg-slate-50 transition-all flex items-center gap-1"
                          title="배경색"
                        >
                          <span className="text-xs font-black px-0.5 rounded" style={{ backgroundColor: (editForm.highlight && editForm.highlight !== 'transparent') ? editForm.highlight : '#FEF3C7' }}>H</span>
                        </button>
                        {showTextHighlightPicker && (
                          <div className="absolute top-full mt-2 right-0 z-50 bg-white rounded-xl border border-[#E2E8F0] shadow-xl p-3 space-y-2">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">배경색</p>
                            <div className="flex gap-1.5 flex-wrap max-w-[200px]">
                              {HIGHLIGHT_COLOR_PRESETS.map(c => (
                                <button key={c.value}
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => { applyTextHighlight(c.value); setShowTextHighlightPicker(false); }}
                                  className={`w-7 h-7 rounded-lg border-2 transition-all flex items-center justify-center text-[8px] font-bold ${editForm.highlight === c.value ? 'border-blue-600 scale-110' : 'border-slate-200 hover:scale-105'}`}
                                  style={{ backgroundColor: c.value === 'transparent' ? '#fff' : c.value }}
                                >
                                  {c.value === 'transparent' ? '✕' : ''}
                                </button>
                              ))}
                            </div>
                            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                              <ColorPicker
                                value={(editForm.highlight && editForm.highlight !== 'transparent') ? editForm.highlight : '#FEF3C7'}
                                onChange={applyTextHighlight}
                                triggerClassName="w-7 h-7 rounded-lg"
                                aria-label="배경색 직접 지정"
                              />
                              팔레트에서 직접 선택
                            </label>
                          </div>
                        )}
                      </div>
                      </div>
                      <p className="text-[10px] text-blue-500 font-bold">
                        글자를 선택한 뒤 버튼을 누르면 선택한 부분만 바뀝니다. 아무것도 선택하지 않으면 블록 전체에 적용됩니다.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">텍스트 내용</label>
                      <div
                        ref={textEditorRef}
                        contentEditable
                        suppressContentEditableWarning
                        className="w-full bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 font-medium min-h-[100px] focus:border-blue-600 transition-all outline-none whitespace-pre-wrap"
                        style={{
                          fontSize: `${editForm.fontSizePx || 14}px`,
                          fontWeight: editForm.bold ? 'bold' : undefined,
                          fontStyle: editForm.italic ? 'italic' : undefined,
                          textDecoration: [editForm.underline ? 'underline' : '', editForm.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
                          color: editForm.color || '#37352f',
                          backgroundColor: (editForm.highlight && editForm.highlight !== 'transparent') ? editForm.highlight : undefined,
                        }}
                        onInput={(e) => { setEditForm(prev => ({ ...prev, textContent: (e.target as HTMLDivElement).innerHTML })); rememberTextSelection(); }}
                        onKeyUp={rememberTextSelection}
                        onMouseUp={rememberTextSelection}
                        onSelect={rememberTextSelection}
                        onBlur={rememberTextSelection}
                        data-placeholder="내용을 자유롭게 입력하세요. 키보드 이모지를 사용해 꾸밀 수 있어요."
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold">키보드 이모지를 사용해 꾸밀 수 있어요</p>
                  </div>
                </div>
              )}

              {editForm.displayType !== 'text' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h4 className="text-lg font-black text-blue-600">연결 상품</h4>
                  <button onClick={handleAddProduct} className="bg-blue-50 text-blue-600 px-4 py-2 rounded-full font-black text-xs hover:bg-blue-100 transition-all">+ 추가</button>
                </div>
                {editForm.products?.map(product => (
                  <div key={product.id} className="bg-[#F8FAFC] p-6 rounded-[2.5rem] border border-[#E2E8F0] space-y-4">
                    <input type="text" placeholder="상품명" value={product.name} onChange={e => handleUpdateProduct(product.id, 'name', e.target.value)} className="w-full bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black" />
                    <div className="flex gap-3 min-w-0">
                      <input type="text" placeholder="구매 링크 (URL)" value={product.link} onChange={e => handleUpdateProduct(product.id, 'link', e.target.value)} className="flex-1 min-w-0 bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black" />
                      <button onClick={() => handleDeleteProduct(product.id)} className="w-14 h-14 bg-white border border-red-100 text-red-400 rounded-2xl flex items-center justify-center hover:text-red-500 transition-all"><Trash2 size={20} /></button>
                    </div>

                    {/* Product Options */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">상품 옵션 (선택사항)</span>
                        <button onClick={() => handleAddOption(product.id)} className="text-blue-500 text-[10px] font-black hover:text-blue-700 transition-all">+ 옵션 추가</button>
                      </div>
                      {(product.options || []).map(opt => (
                        <div key={opt.id} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 space-y-3">
                          <div className="flex gap-3 items-center min-w-0">
                            <input
                              type="text"
                              placeholder="옵션명 (예: 사이즈, 컬러)"
                              value={opt.name}
                              onChange={e => handleUpdateOption(product.id, opt.id, 'name', e.target.value)}
                              className="flex-1 min-w-0 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3 text-sm font-black"
                            />
                            <button onClick={() => handleDeleteOption(product.id, opt.id)} className="w-10 h-10 bg-white border border-red-100 text-red-400 rounded-xl flex items-center justify-center hover:text-red-500 transition-all"><Trash2 size={14} /></button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(opt.values || []).map((val, vi) => (
                              <div key={vi} className="flex items-center gap-1">
                                <input
                                  type="text"
                                  placeholder={`값 ${vi + 1}`}
                                  value={val}
                                  onChange={e => {
                                    const newValues = [...opt.values];
                                    newValues[vi] = e.target.value;
                                    handleUpdateOption(product.id, opt.id, 'values', newValues);
                                  }}
                                  className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2 text-xs font-bold w-24"
                                />
                                {opt.values.length > 1 && (
                                  <button
                                    onClick={() => {
                                      const newValues = opt.values.filter((_, i) => i !== vi);
                                      handleUpdateOption(product.id, opt.id, 'values', newValues);
                                    }}
                                    className="text-red-300 hover:text-red-500 transition-all"
                                  ><X size={12} /></button>
                                )}
                              </div>
                            ))}
                            <button
                              onClick={() => handleUpdateOption(product.id, opt.id, 'values', [...opt.values, ''])}
                              className="text-blue-400 text-[10px] font-black bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 transition-all"
                            >+ 값</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              )}
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
            <h3 className="text-xl font-black text-center mb-3">삭제 하시겠습니까?</h3>
            <p className="text-xs font-bold text-slate-400 text-center mb-8">
              {confirmDelete.type === 'category'
                ? `'${confirmDelete.id}' 카테고리와 이 카테고리에 속한 포스트가 함께 삭제됩니다.`
                : '삭제하면 되돌릴 수 없습니다.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setConfirmDelete(null)} className="py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">취소</button>
              <button onClick={executeDelete} className="py-4 bg-red-500 text-white rounded-2xl font-black">삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile live-preview — the desktop sidebar preview is hidden on phones,
          so a floating button opens the real personal page in a bottom sheet,
          letting mobile users edit "as it shows on the phone". */}
      <button
        onClick={() => setShowMobilePreview(true)}
        className="lg:hidden fixed bottom-24 right-4 z-[150] flex items-center gap-2 px-4 py-3 bg-[#1E1E2E] text-white rounded-full shadow-2xl font-black text-xs active:scale-95 transition-all"
      >
        <Eye size={16} /> 미리보기
      </button>

      {showMobilePreview && (
        <div className="lg:hidden fixed inset-0 z-[320] flex flex-col">
          <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={() => setShowMobilePreview(false)} />
          <div className="relative z-10 mt-auto bg-[#EEF2F6] rounded-t-[2rem] p-4 pb-6 max-h-[94vh] flex flex-col items-center gap-3 animate-in slide-in-from-bottom duration-300">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
            <div className="flex items-center justify-between w-full px-1">
              <h3 className="font-black text-sm text-[#1E1E2E]">실시간 미리보기</h3>
              <button onClick={() => setShowMobilePreview(false)} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto w-full flex justify-center pb-2">
              <PhoneFrame
                size="lg"
                label="실시간 미리보기"
                liveUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${userName}`}
                contentClassName={themeIsLight ? 'text-slate-900' : 'text-white'}
                contentStyle={{ background: themePreset === 'white' ? '#F8FAFC' : themeBackground }}
              >
                <PagePreview
                  theme={themePreset}
                  backgroundColor={customBg}
                  accentColor={accentColor}
                  header={{ color: fullDesignRef.current.portfolioHeaderColor, image: coverImage, imagePosition: coverPosition }}
                  profile={profile}
                  userName={userName}
                  portfolioFontSize={portfolioFontSize}
                  socials={socials}
                  homePriority={homePriority}
                  layoutTemplate={layoutTemplate}
                  curationBlocks={blocks}
                  managedCategories={managedCategories}
                />
              </PhoneFrame>
            </div>
          </div>
        </div>
      )}

      {/* Block Type Selection Modal */}
      {showBlockTypeModal && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowBlockTypeModal(false)}></div>
          <div className="bg-white w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] rounded-t-[2rem] sm:rounded-[3rem] shadow-2xl relative z-10 overflow-hidden flex flex-col">
            <div className="p-6 sm:p-8 pb-4 flex justify-between items-center">
              <h3 className="text-xl sm:text-2xl font-black text-[#1E1E2E]">콘텐츠 추가</h3>
              <button onClick={() => setShowBlockTypeModal(false)} className="text-slate-400 hover:rotate-90 transition-all p-2 -m-2"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 sm:p-8 pt-0 space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">표시 형식</label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setNewBlockDisplayType('grid')}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${newBlockDisplayType === 'grid' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-blue-300'}`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-slate-100 grid grid-cols-2 gap-px p-2">
                      {[1,2,3,4].map(i => <div key={i} className="bg-slate-300 rounded-sm"></div>)}
                    </div>
                    <span className="font-black text-xs">그리드</span>
                    <span className="text-[10px] text-slate-400 font-bold">상품·이미지·영상</span>
                  </button>
                  <button
                    onClick={() => setNewBlockDisplayType('minimal')}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${newBlockDisplayType === 'minimal' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-blue-300'}`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex flex-col gap-1 p-2 justify-center">
                      <div className="h-1.5 bg-slate-300 rounded-sm w-full"></div>
                      <div className="h-1 bg-slate-200 rounded-sm w-3/4"></div>
                      <div className="h-1 bg-slate-200 rounded-sm w-1/2"></div>
                    </div>
                    <span className="font-black text-xs">미니멀</span>
                    <span className="text-[10px] text-slate-400 font-bold">깔끔한 카드</span>
                  </button>
                  <button
                    onClick={() => setNewBlockDisplayType('text')}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${newBlockDisplayType === 'text' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-blue-300'}`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex flex-col gap-1 p-2.5 justify-center">
                      <div className="h-1 bg-slate-400 rounded-sm w-full"></div>
                      <div className="h-1 bg-slate-300 rounded-sm w-4/5"></div>
                      <div className="h-1 bg-slate-300 rounded-sm w-3/5"></div>
                    </div>
                    <span className="font-black text-xs">텍스트</span>
                    <span className="text-[10px] text-slate-400 font-bold">텍스트 전용</span>
                  </button>
                </div>
              </div>

              {newBlockDisplayType === 'grid' && (
              <div className="space-y-3">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">칸 수 (너비)</label>
                <div className="grid grid-cols-3 gap-3">
                  {([1, 2, 3] as const).map(num => (
                    <button
                      key={num}
                      onClick={() => setNewBlockColSpan(num)}
                      className={`py-4 rounded-xl font-black text-base transition-all ${newBlockColSpan === num ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                    >
                      {num}칸
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 font-bold text-center">1칸: 크게 표시 / 2,3칸: 동일 크기로 나열</p>
              </div>
              )}
            </div>

            <div className="p-6 sm:p-8 bg-[#F8FAFC] border-t border-[#E2E8F0] flex gap-3">
              <button onClick={() => setShowBlockTypeModal(false)} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">취소</button>
              <button onClick={handleConfirmAddBlock} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black hover:bg-blue-700 transition-all shadow-lg">
                추가하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Management Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setShowCategoryModal(false); setEditingCategoryName(null); }}></div>
          <div className="bg-white w-full max-w-lg max-h-[92vh] sm:max-h-[90vh] rounded-t-[2rem] sm:rounded-[3rem] shadow-2xl relative z-10 overflow-hidden flex flex-col">
            <div className="p-6 sm:p-8 pb-4 flex justify-between items-center">
              <h3 className="text-xl sm:text-2xl font-black text-[#1E1E2E]">카테고리 관리</h3>
              <button onClick={() => { setShowCategoryModal(false); setEditingCategoryName(null); }} className="text-slate-400 hover:rotate-90 transition-all p-2 -m-2"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 sm:p-8 pt-0 space-y-6">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                  className="flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-5 py-3 font-black text-sm focus:border-blue-600 transition-all"
                  placeholder="새 카테고리 이름"
                />
                <button
                  onClick={handleAddCategory}
                  disabled={!newCategoryName.trim()}
                  className="px-5 py-3 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 transition-all disabled:opacity-50"
                >
                  추가
                </button>
              </div>

              <div className="space-y-2">
                {managedCategories.length === 0 ? (
                  <p className="text-center text-slate-400 font-bold text-sm py-8">카테고리가 없습니다. 위에서 추가해주세요.</p>
                ) : (
                  managedCategories.map(cat => (
                    <div key={cat} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-4 flex items-center justify-between gap-3">
                      {editingCategoryName === cat ? (
                        <div className="flex-1 flex gap-2">
                          <input
                            type="text"
                            value={categoryEditValue}
                            onChange={e => setCategoryEditValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleRenameCategory(cat)}
                            className="flex-1 bg-white border border-[#E2E8F0] rounded-xl px-4 py-2 font-black text-sm focus:border-blue-600 transition-all"
                            autoFocus
                          />
                          <button onClick={() => handleRenameCategory(cat)} className="px-3 py-2 bg-blue-600 text-white rounded-xl font-black text-xs">확인</button>
                          <button onClick={() => setEditingCategoryName(null)} className="px-3 py-2 bg-slate-100 text-slate-500 rounded-xl font-black text-xs">취소</button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="font-black text-sm text-[#1E1E2E] truncate">{cat}</span>
                            <span className="text-xs text-slate-400 font-bold whitespace-nowrap">{blocks.filter(b => b.category === cat).length}개</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={() => { setEditingCategoryName(cat); setCategoryEditValue(cat); }} className="px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-xl text-xs font-black text-slate-500 hover:border-blue-300 transition-all">수정</button>
                            <button onClick={() => handleDeleteCategory(cat)} className="p-1.5 bg-white border border-red-100 text-red-400 rounded-xl hover:text-red-500 transition-all"><Trash2 size={14} /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="p-6 sm:p-8 bg-[#F8FAFC] border-t border-[#E2E8F0]">
              <button onClick={() => { setShowCategoryModal(false); setEditingCategoryName(null); }} className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black">닫기</button>
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
