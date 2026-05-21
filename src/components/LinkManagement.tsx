import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronRight, Image as ImageIcon, Trash2, Loader2, CheckCircle2, AlertTriangle, Plus, Save } from 'lucide-react';
import { supabase } from '../services/supabase';
import { getSiteSettings, updateSiteSettings, getLinkGridItems, updateLinkGridItems, SiteSettings } from '../services/settingsService';
import { getCachedLinkData } from '../services/prefetchService';
import { DEFAULT_AVATAR } from '../utils/defaultAvatar';
import { apiService } from '../services/apiService';
import { Block, Product, ProductOption, TemplateType, DesignSettings, ProductFolder } from '../types';
import SafeImage from './SafeImage';
import PhoneFrame from './PhoneFrame';

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

  // 이미지를 Base64 데이터 URL로 변환하는 헬퍼
  const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // 이미지 처리 (리사이즈 + WebP 변환)
  const processImage = (file: File): Promise<Blob> => {
    // For maximum quality, return the original file if it's already a supported format
    const directUploadTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
    if (directUploadTypes.includes(file.type) && file.size <= 20 * 1024 * 1024) {
      return Promise.resolve(file);
    }

    return new Promise((resolve, reject) => {
      const imageUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 8192;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(imageUrl);
          if (blob) {
            resolve(blob);
          } else {
            canvas.toBlob((jpegBlob) => {
              if (jpegBlob) resolve(jpegBlob);
              else reject(new Error('Canvas to Blob 변환 실패'));
            }, 'image/jpeg', 1.0);
          }
        }, 'image/png', 1.0);
      };
      img.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('이미지 로드 실패'));
      };
      img.src = imageUrl;
    });
  };

  // editForm에 이미지 URL 적용하는 헬퍼
  const applyImageToForm = (url: string, target: typeof uploadTarget) => {
    if (!target) return;
    if (target.type === 'block') {
      setEditForm(prev => ({ ...prev, coverMedia: url }));
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

    // 파일 유효성 검사
    if (!file.type.startsWith('image/')) {
      setSaveMessage('이미지 파일만 업로드할 수 있습니다.');
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

    setIsUploading(true);
    const currentTarget = uploadTarget;

    try {
      // 1. 이미지 처리 (최고 화질 유지 - 원본 직접 업로드)
      const processedBlob = await processImage(file);

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

  const triggerFileUpload = (target: { type: 'block' } | { type: 'product', productId: string }) => {
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
      homePriority: homePriority === 'portfolio' ? 'portfolio' : 'curation',
      portfolioFontSize: portfolioFontSize
    };

    // 즉시 로컬 저장
    localStorage.setItem(`picks_profile_${userName.toLowerCase()}`, JSON.stringify(profile));
    localStorage.setItem(`picks_design_${userName.toLowerCase()}`, JSON.stringify(designUpdate));

    // 클라우드 동기화 완료 후 결과 표시
    try {
      const apiOk = await apiService.saveSiteData(userName, { design: designUpdate as any, profile });
      if (apiOk) {
        showSuccessFeedback('디자인이 저장되었습니다!');
      } else {
        setSaveMessage('로컬에 저장됨 (클라우드 동기화 실패)');
        setToastType('warning');
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
      }
      // Supabase 동기화 (백그라운드)
      updateSiteSettings(userName, { design: designUpdate as any, profile })
        .catch(err => console.warn('[SaveDesign] Supabase 동기화 실패:', err));
    } catch (error) {
      console.error('[SaveDesign] 클라우드 동기화 실패:', error);
      setSaveMessage('저장 실패 - 다시 시도해주세요');
      setToastType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const saveBlocksToCloud = async (blocksToSave: Block[]): Promise<boolean> => {
    try {
      const apiOk = await apiService.saveSiteData(userName, { blocks: blocksToSave });
      // Supabase 동기화도 시도 (백그라운드)
      Promise.all([
        updateLinkGridItems(blocksToSave),
        updateSiteSettings(userName, { blocks: blocksToSave })
      ]).catch(err => console.warn('[SaveBlocks] Supabase 동기화 실패:', err));
      return apiOk;
    } catch (error) {
      console.error('[SaveBlocks] 클라우드 동기화 실패:', error);
      return false;
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
    localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(sanitizedBlocks));

    // 클라우드 동기화 완료 후 결과 표시
    const apiOk = await saveBlocksToCloud(sanitizedBlocks);
    if (apiOk) {
      showSuccessFeedback('저장 완료!');
    } else {
      setSaveMessage('로컬에 저장됨 (클라우드 동기화 재시도 중...)');
      setToastType('warning');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      // 재시도
      const retryOk = await saveBlocksToCloud(sanitizedBlocks);
      if (retryOk) {
        showSuccessFeedback('클라우드 동기화 완료!');
      }
    }
    setIsSaving(false);
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
    // 클라우드 동기화 (백그라운드)
    saveBlocksToCloud(updatedBlocks).catch(err => console.warn('[AddBlock] 클라우드 동기화 실패:', err));
    setIsEditing(newBlock.id);
    setEditForm(newBlock);
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

  const displayedBlocks = selectedFolderId
    ? blocks.filter(b => b.category === selectedFolderId)
    : blocks;

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

    // 즉시 로컬 저장 및 UI 반영
    const updatedBlocks = blocks.map(b => b.id === isEditing ? sanitizedEditForm : b);
    setBlocks(updatedBlocks);
    localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(updatedBlocks));

    // 클라우드 동기화 완료 후 결과 표시
    const apiOk = await saveBlocksToCloud(updatedBlocks);
    if (apiOk) {
      showSuccessFeedback('포스트가 수정되었습니다!');
    } else {
      setSaveMessage('로컬에 저장됨 (클라우드 동기화 실패)');
      setToastType('warning');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
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
      localStorage.setItem(`picks_blocks_${userName.toLowerCase()}`, JSON.stringify(updatedBlocks));
      // 클라우드 동기화 (백그라운드)
      saveBlocksToCloud(updatedBlocks).catch(err => console.warn('[DeleteBlock] 클라우드 동기화 실패:', err));
      setIsEditing(null);
    } else if (confirmDelete.type === 'product') {
      const updatedProducts = (editForm.products || []).filter(p => p.id !== confirmDelete.id);
      setEditForm({ ...editForm, products: updatedProducts } as Block);
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
          : 'bg-purple-600 text-white hover:bg-purple-700 active:scale-95 disabled:opacity-50'
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
    <div className="flex h-full bg-[#F8FAFC]">
      <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif" />
      
      <div className="flex-1 overflow-y-auto p-4 md:p-14">
        <div className="max-w-[1200px] mx-auto w-full">
          <header className="mb-6 md:mb-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl md:text-4xl font-black text-[#1E1E2E] mb-1 md:mb-2">매니지먼트 데스크</h1>
              <p className="text-[#64748B] font-medium text-xs md:text-base">포스트를 클릭하면 언제든 상품 정보를 수정할 수 있으며, 데이터는 자동 저장됩니다.</p>
            </div>
            
            <div className="flex bg-white p-1 rounded-2xl border border-[#E2E8F0] self-start md:self-auto">
              <button onClick={() => setActiveTab('posts')} className={`px-7 py-3 rounded-xl text-sm font-black transition-all ${activeTab === 'posts' ? 'bg-[#1E1E2E] text-white shadow-lg' : 'text-[#64748B] hover:bg-slate-50'}`}>포스트 관리</button>
              <button onClick={() => setActiveTab('design')} className={`px-7 py-3 rounded-xl text-sm font-black transition-all ${activeTab === 'design' ? 'bg-[#1E1E2E] text-white shadow-lg' : 'text-[#64748B] hover:bg-slate-50'}`}>디자인 설정</button>
            </div>
          </div>
        </header>

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'posts' ? (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div className="flex gap-2 overflow-x-auto scrollbar-hide items-center">
                  {(() => {
                    const catSet = new Set<string>();
                    // Iterate oldest → newest so newly added blocks (prepended) contribute their category last
                    for (let i = blocks.length - 1; i >= 0; i--) {
                      const c = blocks[i].category;
                      if (c) catSet.add(c);
                    }
                    const cats = ['전체', ...Array.from(catSet)];
                    return cats.map(cat => (
                      <button key={cat} onClick={() => setSelectedFolderId(cat === '전체' ? null : cat)} className={`px-5 py-2 rounded-full text-xs font-black whitespace-nowrap transition-all ${(cat === '전체' && !selectedFolderId) || selectedFolderId === cat ? 'bg-[#1E1E2E] text-white shadow-lg' : 'bg-white text-[#64748B] border border-[#E2E8F0] hover:border-purple-300'}`}>
                        {cat}
                      </button>
                    ));
                  })()}
                </div>
                <SaveButton onClick={handleSaveBlocks} disabled={isLoading} label="저장하기" />
              </div>


              <div className="flex justify-between items-center mb-6">
                <h2 className="text-sm md:text-base font-black text-[#64748B]">
                  {selectedFolderId ? `${selectedFolderId} (${displayedBlocks.length})` : `전체 리스트 (${blocks.length})`}
                </h2>
                <button onClick={handleAddBlock} className="text-purple-600 font-black text-xs md:text-sm flex items-center gap-1 hover:scale-105 transition-all">
                  <Plus size={14} /> 새 포스트 추가
                </button>
              </div>

              <div className="space-y-3 md:space-y-4">
                {displayedBlocks.map(block => (
                  <div key={block.id} className="bg-white p-4 md:p-6 rounded-[1.5rem] border border-[#E2E8F0] flex items-center gap-4 md:gap-6 cursor-pointer hover:border-purple-600 transition-all group shadow-sm" onClick={() => { setIsEditing(block.id); setEditForm(block); }}>
                    <div className="w-16 h-16 md:w-24 md:h-24 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                      <SafeImage src={block.coverMedia} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="inline-block bg-[#F1F5F9] text-[#64748B] text-[9px] md:text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">{block.category}</span>
                      </div>
                      <h3 className="text-sm md:text-xl font-black text-[#1E1E2E] mb-0.5">{block.title}</h3>
                      <p className="text-[9px] md:text-xs font-black text-[#94A3B8] uppercase tracking-widest">{(block.products || []).length} ITEMS LINKED</p>
                    </div>
                    <ChevronRight size={18} className="text-[#CBD5E1] group-hover:text-purple-600 transition-all" />
                  </div>
                ))}
              </div>

            </>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-end">
                <SaveButton onClick={handleSaveDesign} disabled={false} label="저장하기" />
              </div>

              <section className="space-y-3">
                <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">홈 우선순위</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setHomePriority('curation')}
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${homePriority === 'curation' ? 'border-purple-600 bg-purple-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-purple-300'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-lg flex-shrink-0">🛍️</div>
                    <div className="text-left">
                      <span className="font-black text-sm block">큐레이션 우선</span>
                      <span className="text-xs text-slate-500 font-bold">상품 그리드 먼저</span>
                    </div>
                  </button>
                  <button
                    onClick={() => setHomePriority('portfolio')}
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${homePriority === 'portfolio' ? 'border-purple-600 bg-purple-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-purple-300'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-lg flex-shrink-0">💼</div>
                    <div className="text-left">
                      <span className="font-black text-sm block">포트폴리오 우선</span>
                      <span className="text-xs text-slate-500 font-bold">포트폴리오 먼저</span>
                    </div>
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">레이아웃</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setLayoutTemplate('grid')}
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${layoutTemplate === 'grid' ? 'border-purple-600 bg-purple-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-purple-300'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-100 grid grid-cols-3 gap-px p-1.5 flex-shrink-0">
                      {[1,2,3,4,5,6].map(i => <div key={i} className="bg-slate-300 rounded-[1px]"></div>)}
                    </div>
                    <div className="text-left">
                      <span className="font-black text-sm block">쇼퍼블 그리드</span>
                      <span className="text-xs text-slate-500 font-bold">이미지 중심 갤러리</span>
                    </div>
                  </button>
                  <button
                    onClick={() => setLayoutTemplate('list')}
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${layoutTemplate === 'list' ? 'border-purple-600 bg-purple-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-purple-300'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex flex-col gap-1 p-2 justify-center flex-shrink-0">
                      {[1,2,3].map(i => (
                        <div key={i} className="flex items-center gap-0.5">
                          <div className="w-1.5 h-1.5 bg-slate-300 rounded-[1px] flex-shrink-0"></div>
                          <div className="h-1 bg-slate-300 rounded-[1px] flex-1"></div>
                        </div>
                      ))}
                    </div>
                    <div className="text-left">
                      <span className="font-black text-sm block">미니멀 리스트</span>
                      <span className="text-xs text-slate-500 font-bold">텍스트 중심 목록</span>
                    </div>
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">테마 프리셋</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleThemeChange('midnight')}
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${themePreset === 'midnight' ? 'border-purple-600 bg-purple-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-purple-300'}`}
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
                    className={`p-5 rounded-2xl border-2 transition-all flex items-center gap-3 ${themePreset === 'white' ? 'border-purple-600 bg-purple-50 shadow-sm' : 'border-[#E2E8F0] bg-white hover:border-purple-300'}`}
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
              </section>

              <section className="space-y-3">
                <h3 className="text-[1.1rem] font-black text-[#1E1E2E] tracking-tight">그리드 상세 설정</h3>
                <div className="bg-white p-5 rounded-2xl border border-[#E2E8F0] space-y-5">
                  <div className="space-y-2.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">그리드 칸 수</label>
                    <div className="flex gap-2">
                      {[1, 2, 3].map((num) => (
                        <button
                          key={num}
                          onClick={() => setColumns(num as 1 | 2 | 3)}
                          className={`flex-1 py-4 rounded-xl font-black text-base transition-all ${columns === num ? 'bg-purple-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                        >
                          {num}칸
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">아이템 스타일</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setItemStyle('equal')}
                        className={`flex-1 py-4 rounded-xl font-black text-base transition-all ${itemStyle === 'equal' ? 'bg-purple-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                      >
                        정사각형
                      </button>
                      <button
                        onClick={() => setItemStyle('magazine')}
                        className={`flex-1 py-4 rounded-xl font-black text-base transition-all ${itemStyle === 'magazine' ? 'bg-purple-600 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
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
      </div>

      {/* Mobile Preview Area */}
      <div className="hidden lg:flex flex-col w-[300px] xl:w-[340px] bg-[#EEF2F6] border-l border-[#E2E8F0] items-center justify-start p-6 xl:p-8 sticky top-0 h-screen flex-shrink-0 gap-4 pt-20">
        <PhoneFrame
          size="md"
          label="실시간 미리보기"
          liveUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${userName}`}
          contentClassName={themePreset === 'white' ? 'bg-[#F8FAFC] text-slate-900' : 'bg-[#1E1E2E] text-white'}
        >
            <div className="pt-8 pb-4 flex flex-col items-center">
              <div className="w-14 h-14 rounded-full border-2 p-0.5 mb-2" style={{ borderColor: accentColor }}>
                <img src={profile.avatar_url || DEFAULT_AVATAR} alt="" className="w-full h-full rounded-full bg-slate-800 object-cover" />
              </div>
              <h2 className="text-sm font-black">{profile.name}</h2>
            </div>

            <div className={`px-4 pb-10 ${layoutTemplate === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}`}>
              {blocks.map(block => (
                <div key={block.id} onClick={() => { setPreviewSelectedBlock(block); setShowBottomSheet(true); }} className="cursor-pointer">
                  <div className={`rounded-xl overflow-hidden border ${themePreset === 'white' ? 'bg-white border-slate-100' : 'bg-white/5 border-white/10'}`}>
                    <SafeImage src={block.coverMedia} alt="" className="w-full aspect-square object-cover" />
                    <div className="p-1.5"><p className="text-[8px] font-black truncate">{block.title}</p></div>
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
        </PhoneFrame>
        {/* Save Button - next to phone preview */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={activeTab === 'posts' ? handleSaveBlocks : handleSaveDesign}
            disabled={isSaving}
            className="bg-purple-600 text-white px-5 py-4 rounded-2xl font-black flex flex-col items-center justify-center gap-2 hover:bg-purple-700 transition-all shadow-2xl shadow-purple-200 disabled:opacity-50"
          >
            {isSaving ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-5 h-5" />
            )}
            <span className="text-xs">저장하기</span>
          </button>
          {saveMessage && (
            <span className={`${isSaved ? 'text-emerald-500' : 'text-red-500'} font-black text-[10px] text-center max-w-[80px] animate-in fade-in`}>
              {saveMessage}
            </span>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsEditing(null)}></div>
          <div className="bg-white w-full max-w-2xl max-h-[92vh] sm:max-h-[90vh] rounded-t-[2rem] sm:rounded-[3rem] shadow-2xl relative z-10 overflow-hidden flex flex-col">
            <div className="p-5 sm:p-10 pb-4 sm:pb-6 flex justify-between items-center">
              <h3 className="text-xl sm:text-3xl font-black text-[#1E1E2E]">포스트 수정</h3>
              <button onClick={() => setIsEditing(null)} className="text-slate-400 hover:rotate-90 transition-all p-2 -m-2"><X size={24} /></button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-5 sm:p-10 pt-0 space-y-6 sm:space-y-10 custom-scrollbar">
              <div className="flex flex-col md:flex-row gap-8">
                <div className="w-full md:w-1/2 space-y-4">
                  <div
                    className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-200 bg-slate-50 overflow-hidden relative cursor-pointer"
                    onClick={() => !isUploading && triggerFileUpload({ type: 'block' })}
                  >
                    {editForm.coverMedia ? (
                      <SafeImage src={editForm.coverMedia} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                        <ImageIcon size={48} />
                        <span className="text-xs font-black">이미지 업로드</span>
                      </div>
                    )}
                    {isUploading && uploadTarget?.type === 'block' ? (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white gap-2">
                        <Loader2 size={32} className="animate-spin" />
                        <span className="text-xs font-black">업로드 중...</span>
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => !isUploading && triggerFileUpload({ type: 'block' })}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-4 py-2.5 bg-purple-50 text-purple-600 rounded-xl font-black text-xs hover:bg-purple-100 transition-all disabled:opacity-50 w-full justify-center"
                  >
                    <ImageIcon size={14} />
                    <span>{editForm.coverMedia ? '이미지 변경' : '이미지 업로드'}</span>
                  </button>
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
                    <input type="text" placeholder="가격 (선택사항, 예: 29,000원)" value={product.price || ''} onChange={e => handleUpdateProduct(product.id, 'price', e.target.value)} className="w-full bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black" />
                    <div className="flex gap-3">
                      <input type="text" placeholder="구매 링크 (URL)" value={product.link} onChange={e => handleUpdateProduct(product.id, 'link', e.target.value)} className="flex-1 bg-white border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black" />
                      <button onClick={() => handleDeleteProduct(product.id)} className="w-14 h-14 bg-white border border-red-100 text-red-400 rounded-2xl flex items-center justify-center hover:text-red-500 transition-all"><Trash2 size={20} /></button>
                    </div>

                    {/* Product Options */}
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">상품 옵션 (선택사항)</span>
                        <button onClick={() => handleAddOption(product.id)} className="text-purple-500 text-[10px] font-black hover:text-purple-700 transition-all">+ 옵션 추가</button>
                      </div>
                      {(product.options || []).map(opt => (
                        <div key={opt.id} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 space-y-3">
                          <div className="flex gap-3 items-center">
                            <input
                              type="text"
                              placeholder="옵션명 (예: 사이즈, 컬러)"
                              value={opt.name}
                              onChange={e => handleUpdateOption(product.id, opt.id, 'name', e.target.value)}
                              className="flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-3 text-sm font-black"
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
                              className="text-purple-400 text-[10px] font-black bg-purple-50 px-3 py-2 rounded-lg hover:bg-purple-100 transition-all"
                            >+ 값</button>
                          </div>
                        </div>
                      ))}
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
