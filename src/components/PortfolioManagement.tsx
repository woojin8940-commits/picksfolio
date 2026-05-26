import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Instagram, Youtube, Save, Trash2, Camera, Phone, MessageCircle, Image as ImageIcon, Type, GripVertical, Globe, Palette, User, Briefcase, Bell, Plus, X, Bold as BoldIcon, Italic as ItalicIcon, Underline as UnderlineIcon, Strikethrough as StrikethroughIcon, Highlighter, ChevronDown, ChevronUp, Lock, Hash } from 'lucide-react';
import ImageCropper from './ImageCropper';
import VideoCropper from './VideoCropper';
import ImagePositionEditor from './ImagePositionEditor';
import { supabase } from '../services/supabase';
import { getSiteSettings, updateSiteSettings } from '../services/settingsService';
import { apiService } from '../services/apiService';
import { DesignSettings, TemplateType, SellerVerification } from '../types';
import Toast from './Toast';
import MediaAuto, { isVideoSource } from './MediaAuto';
import PhoneFrame from './PhoneFrame';
import { normalizeContentToHtml, renderPortfolioHtml, sanitizeRichHtml } from './richText';

type BlockFontSize = 'sm' | 'md' | 'lg' | 'xl';
type BlockGridColumns = 1 | 2 | 3 | 4;

interface PortfolioBlock {
  id: string;
  type: 'text' | 'image' | 'category';
  content: string;
  images?: string[];
  imagePositions?: Record<number, { x: number; y: number }>;
  fontSize?: BlockFontSize;
  fontSizePx?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  highlight?: string;
  gridColumns?: BlockGridColumns;
  categoryImage?: string;
  categoryDescription?: string;
  // legacy fields (kept for backward-compat loading; no longer edited)
  title?: string;
  icon?: string;
}

const ALL_CATEGORY_LABEL = '전체';

interface PortfolioCategoryDescriptor {
  id: string;
  name: string;
  image?: string;
  description?: string;
}

const collectPortfolioCategories = (items: { id?: string; type?: string; content?: string; categoryImage?: string; categoryDescription?: string }[]): PortfolioCategoryDescriptor[] => {
  const out: PortfolioCategoryDescriptor[] = [];
  const seen = new Set<string>();
  for (const it of items || []) {
    if (!it || it.type !== 'category') continue;
    const name = (it.content || '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ id: it.id || name, name, image: it.categoryImage, description: it.categoryDescription });
  }
  return out;
};

const filterPortfolioByCategory = <T extends { type?: string; content?: string }>(items: T[], categoryName: string): T[] => {
  const out: T[] = [];
  let active: string | null = null;
  const isAll = !categoryName || categoryName === ALL_CATEGORY_LABEL;
  for (const it of items || []) {
    if (!it) continue;
    if (it.type === 'category') {
      active = (it.content || '').trim();
      continue;
    }
    if (isAll) {
      if (active === null) out.push(it);
    } else if (active === categoryName) {
      out.push(it);
    }
  }
  return out;
};

const getBlockImages = (block: PortfolioBlock): string[] => {
  const cols = (block.gridColumns || 1) as number;
  const source = Array.isArray(block.images) && block.images.length > 0
    ? block.images
    : [block.content || ''];
  const arr = source.slice(0, cols);
  while (arr.length < cols) arr.push('');
  return arr;
};

const resizeImages = (current: string[] | undefined, fallback: string, size: number): string[] => {
  const base = Array.isArray(current) && current.length > 0 ? current : [fallback];
  const arr = base.slice(0, size);
  while (arr.length < size) arr.push('');
  return arr;
};

const TEXT_COLOR_PRESETS = ['#37352f', '#0f172a', '#6b7280', '#7c3aed', '#2563eb', '#dc2626', '#059669', '#d97706'];
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

const legacyFontToPx = (size?: BlockFontSize): number => {
  switch (size) {
    case 'sm': return 13;
    case 'lg': return 17;
    case 'xl': return 20;
    default: return 14;
  }
};

const getBlockFontPx = (block: PortfolioBlock): number => {
  if (typeof block.fontSizePx === 'number' && block.fontSizePx > 0) return block.fontSizePx;
  return legacyFontToPx(block.fontSize);
};

const getTextDecoration = (block: { underline?: boolean; strikethrough?: boolean }): string | undefined => {
  const parts: string[] = [];
  if (block.underline) parts.push('underline');
  if (block.strikethrough) parts.push('line-through');
  return parts.length ? parts.join(' ') : undefined;
};

const chunkArray = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

type BlockGroup =
  | { kind: 'single'; block: PortfolioBlock }
  | { kind: 'imageGrid'; columns: BlockGridColumns; blocks: PortfolioBlock[] };

const groupBlocksForRender = (items: PortfolioBlock[]): BlockGroup[] => {
  const groups: BlockGroup[] = [];
  for (const b of items) {
    if (!b) continue;
    if (b.type === 'image') {
      const cols = (b.gridColumns || 1) as BlockGridColumns;
      const last = groups[groups.length - 1];
      if (last && last.kind === 'imageGrid' && last.columns === cols) {
        last.blocks.push(b);
      } else {
        groups.push({ kind: 'imageGrid', columns: cols, blocks: [b] });
      }
    } else {
      groups.push({ kind: 'single', block: b });
    }
  }
  return groups;
};

interface RichTextEditorHandle {
  element: HTMLDivElement | null;
  hasTextSelection: () => boolean;
  focus: () => void;
  syncFromDom: () => void;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  ({ value, onChange, onFocus, placeholder, className, style }, ref) => {
    const divRef = useRef<HTMLDivElement>(null);
    const initializedRef = useRef(false);

    useEffect(() => {
      const el = divRef.current;
      if (!el) return;
      const desired = normalizeContentToHtml(value || '');
      if (!initializedRef.current) {
        el.innerHTML = desired;
        initializedRef.current = true;
        return;
      }
      if (document.activeElement === el) return;
      if (el.innerHTML !== desired) el.innerHTML = desired;
    }, [value]);

    React.useImperativeHandle(ref, () => ({
      get element() {
        return divRef.current;
      },
      hasTextSelection: () => {
        const el = divRef.current;
        if (!el) return false;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        if (range.collapsed) return false;
        if (!el.contains(range.commonAncestorContainer)) return false;
        return (range.toString() || '').length > 0;
      },
      focus: () => {
        divRef.current?.focus();
      },
      syncFromDom: () => {
        const el = divRef.current;
        if (!el) return;
        onChange(sanitizeRichHtml(el.innerHTML));
      }
    }), [onChange]);

    return (
      <div
        ref={divRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onFocus={onFocus}
        onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
        onBlur={(e) => onChange(sanitizeRichHtml((e.currentTarget as HTMLDivElement).innerHTML))}
        className={className}
        style={style}
      />
    );
  }
);
RichTextEditor.displayName = 'RichTextEditor';

const wrapSelectionWithStyles = (
  editor: HTMLElement,
  styles: Record<string, string>
): boolean => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return false;
  if (!editor.contains(range.commonAncestorContainer)) return false;
  const span = document.createElement('span');
  for (const [k, v] of Object.entries(styles)) span.style.setProperty(k, v);
  try {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    return true;
  } catch {
    return false;
  }
};

const runExecCommand = (editor: HTMLElement, command: string, value?: string): boolean => {
  editor.focus();
  try {
    document.execCommand('styleWithCSS', false, 'true' as any);
  } catch {
    /* ignore */
  }
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
};

interface PortfolioManagementProps {
  userName: string;
  onNavigateMembership?: () => void;
}

interface AboutSection {
  id: string;
  title: string;
  content: string;
}

interface PortfolioProfile {
  name: string;
  bio: string;
  email: string;
  avatar_url: string;
  aboutSections?: AboutSection[];
  links: {
    phone: string;
    kakao: string;
    youtube: string;
    instagram: string;
    naver: string;
    tiktok: string;
    businessProposal?: boolean;
    liveNotify?: boolean;
  };
}

const PortfolioManagement: React.FC<PortfolioManagementProps> = ({ userName, onNavigateMembership }) => {
  const normalizedUsername = (userName || '').toLowerCase();

  const [verification, setVerification] = useState<SellerVerification | null>(null);
  const membershipActive = !!verification?.membership_active;

  const [profile, setProfile] = useState<PortfolioProfile>(() => {
    const defaultProfile: PortfolioProfile = {
      name: userName,
      bio: '패션과 뷰티를 사랑하는 크리에이터입니다. 매일 새로운 스타일을 제안합니다.',
      email: userName + '@picksfolio.com',
      avatar_url: '',
      aboutSections: [],
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
          aboutSections: Array.isArray(parsed.aboutSections) ? parsed.aboutSections : [],
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

  const [blocks, setBlocks] = useState<PortfolioBlock[]>(() => {
    try {
      const saved = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.error('Error parsing portfolio blocks:', e);
    }
    return [];
  });
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
  const [isUploading, setIsUploading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ type: 'profile' | 'block' | 'cover' | 'category'; id?: string; index?: number } | null>(null);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const [videoCropperSrc, setVideoCropperSrc] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [previewCategory, setPreviewCategory] = useState<string>(ALL_CATEGORY_LABEL);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [openColorPicker, setOpenColorPicker] = useState<string | null>(null);
  const [openHighlightPicker, setOpenHighlightPicker] = useState<string | null>(null);

  // Link grid blocks for combined preview
  const [linkGridBlocks, setLinkGridBlocks] = useState<any[]>([]);

  const editorRefs = useRef<Map<string, RichTextEditorHandle>>(new Map());
  const lastSelectionByEditorRef = useRef<Map<string, Range>>(new Map());
  const setEditorRef = useCallback((id: string) => (handle: RichTextEditorHandle | null) => {
    if (handle) editorRefs.current.set(id, handle);
    else {
      editorRefs.current.delete(id);
      lastSelectionByEditorRef.current.delete(id);
    }
  }, []);

  const tryRestoreEditorSelection = useCallback((blockId: string): boolean => {
    const handle = editorRefs.current.get(blockId);
    const editor = handle?.element || null;
    if (!editor) return false;
    if (handle?.hasTextSelection()) return true;
    const saved = lastSelectionByEditorRef.current.get(blockId);
    if (!saved) return false;
    if (saved.collapsed) return false;
    if (!editor.contains(saved.startContainer) || !editor.contains(saved.endContainer)) {
      lastSelectionByEditorRef.current.delete(blockId);
      return false;
    }
    if ((saved.toString() || '').length === 0) return false;
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    try {
      sel.addRange(saved);
    } catch {
      return false;
    }
    return true;
  }, []);

  const [selectionFormats, setSelectionFormats] = useState<{
    editorId: string | null;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    fontPx: number | null;
  }>({ editorId: null, bold: false, italic: false, underline: false, strikethrough: false, fontPx: null });

  const getSelectionFontPx = useCallback((editor: HTMLElement): number | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.startContainer;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || !(node instanceof Element)) return null;
    if (!editor.contains(node)) return null;
    const cs = window.getComputedStyle(node).fontSize;
    const px = parseFloat(cs);
    return Number.isFinite(px) ? Math.round(px) : null;
  }, []);

  useEffect(() => {
    const emptyState = { editorId: null, bold: false, italic: false, underline: false, strikethrough: false, fontPx: null };
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setSelectionFormats(prev => (prev.editorId ? emptyState : prev));
        return;
      }
      const anchor = sel.anchorNode;
      if (!anchor) {
        setSelectionFormats(prev => (prev.editorId ? emptyState : prev));
        return;
      }
      let editorId: string | null = null;
      let editorEl: HTMLElement | null = null;
      editorRefs.current.forEach((handle, id) => {
        if (!editorId && handle.element && handle.element.contains(anchor)) {
          editorId = id;
          editorEl = handle.element;
        }
      });
      if (!editorId) {
        setSelectionFormats(prev => (prev.editorId ? emptyState : prev));
        return;
      }
      try {
        const range = sel.getRangeAt(0);
        if (!range.collapsed && (range.toString() || '').length > 0) {
          lastSelectionByEditorRef.current.set(editorId, range.cloneRange());
        } else if (range.collapsed) {
          lastSelectionByEditorRef.current.delete(editorId);
        }
      } catch {
        /* ignore */
      }
      try {
        const fontPx = editorEl ? getSelectionFontPx(editorEl) : null;
        setSelectionFormats({
          editorId,
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strikethrough: document.queryCommandState('strikeThrough'),
          fontPx,
        });
      } catch {
        setSelectionFormats(emptyState);
      }
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [getSelectionFontPx]);

  const applySelectionOrBlock = useCallback(
    (blockId: string, applyToSelection: (editor: HTMLElement) => boolean, applyToBlock: () => void) => {
      const handle = editorRefs.current.get(blockId);
      const editor = handle?.element || null;
      if (editor && tryRestoreEditorSelection(blockId)) {
        const changed = applyToSelection(editor);
        if (changed) handle?.syncFromDom();
        return;
      }
      applyToBlock();
    },
    [tryRestoreEditorSelection]
  );

  const applyBlockFontSize = useCallback((blockId: string, nextPx: number) => {
    const handle = editorRefs.current.get(blockId);
    const editor = handle?.element || null;
    if (editor && tryRestoreEditorSelection(blockId)) {
      if (wrapSelectionWithStyles(editor, { 'font-size': `${nextPx}px` })) {
        handle?.syncFromDom();
        setSelectionFormats(prev => (prev.editorId === blockId ? { ...prev, fontPx: nextPx } : prev));
      }
      return;
    }
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, fontSizePx: nextPx, fontSize: undefined } : b));
  }, [tryRestoreEditorSelection]);

  useEffect(() => {
    if (!openColorPicker && !openHighlightPicker) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-picker-root]')) {
        setOpenColorPicker(null);
        setOpenHighlightPicker(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openColorPicker, openHighlightPicker]);

  useEffect(() => {
    if (!editingCategoryId) return;
    const exists = blocks.some(b => b?.id === editingCategoryId && b?.type === 'category');
    if (!exists) setEditingCategoryId(null);
  }, [blocks, editingCategoryId]);

  useEffect(() => {
    const loadData = async () => {
      let cloudLoaded = false;
      let apiSocials: any = null;
      let cloudProfile: any = null;

      try {
        // 1. Netlify Blobs API (최우선 클라우드 데이터 소스)
        try {
          const apiData = await apiService.getSiteData(normalizedUsername);
          if (apiData) {
            cloudLoaded = true;
            // Portfolio: trust cloud data even if empty array (admin cleared content)
            if (apiData.portfolio !== undefined && apiData.portfolio !== null) {
              const portfolioArr = Array.isArray(apiData.portfolio) ? apiData.portfolio : [];
              setBlocks(portfolioArr);
              localStorage.setItem(`picks_portfolio_${normalizedUsername}`, JSON.stringify(portfolioArr));
            }
            if (apiData.socials) {
              apiSocials = apiData.socials;
              localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(apiData.socials));
            }
            if (Array.isArray(apiData.blocks)) {
              setLinkGridBlocks(apiData.blocks);
            }
            if (apiData.design) {
              setDesign(prev => ({ ...prev, ...(apiData.design as any) }));
              localStorage.setItem(`picks_design_${normalizedUsername}`, JSON.stringify(apiData.design));
            }
            if (apiData.profile) {
              cloudProfile = apiData.profile;
              setProfile((prev: PortfolioProfile) => ({
                ...prev,
                name: apiData.profile!.name || prev.name,
                bio: apiData.profile!.bio || prev.bio,
                avatar_url: apiData.profile!.avatar_url || prev.avatar_url,
                aboutSections: Array.isArray(apiData.profile!.aboutSections)
                  ? apiData.profile!.aboutSections
                  : (prev.aboutSections || [])
              }));
            }
          }
        } catch (apiError) {
          console.warn('[PortfolioManagement] API load failed:', apiError);
        }

        // 2. Supabase 폴백 (API 실패 시에만 사용)
        if (!cloudLoaded) {
          try {
            const settings = await getSiteSettings(userName);
            if (settings) {
              if (settings.design) {
                setDesign(prev => ({ ...prev, ...settings.design }));
              }
              if (settings.portfolio && Array.isArray(settings.portfolio)) {
                setBlocks(settings.portfolio);
                localStorage.setItem(`picks_portfolio_${normalizedUsername}`, JSON.stringify(settings.portfolio));
                cloudLoaded = true;
              }
              if (settings.socials) {
                apiSocials = settings.socials;
              }
              if (settings.profile) {
                cloudProfile = settings.profile;
              }
              if (settings.blocks && Array.isArray(settings.blocks)) {
                setLinkGridBlocks(settings.blocks);
              }
            }
          } catch (e) {
            console.warn('[PortfolioManagement] Supabase load failed:', e);
          }
        }

        // 3. localStorage 폴백 (클라우드 데이터를 전혀 가져오지 못한 경우에만 사용)
        if (!cloudLoaded) {
          const savedPortfolio = localStorage.getItem(`picks_portfolio_${normalizedUsername}`);
          if (savedPortfolio) {
            try {
              const parsed = JSON.parse(savedPortfolio);
              setBlocks(Array.isArray(parsed) ? parsed : []);
            } catch (e) {
              console.error('Error parsing portfolio:', e);
            }
          }
        }

        // Profile: only use localStorage if cloud didn't provide profile
        if (!cloudProfile) {
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
        }

        // Sync socials into profile.links
        // Priority: API (Netlify Blobs) > Supabase > localStorage
        const savedSocials = localStorage.getItem(`picks_socials_${normalizedUsername}`);
        const socialsSource = apiSocials || (savedSocials ? JSON.parse(savedSocials) : null);
        if (socialsSource) {
          setProfile((prev: PortfolioProfile) => ({
            ...prev,
            links: {
              ...prev.links,
              phone: socialsSource.phone || prev.links.phone || '',
              kakao: socialsSource.kakao || prev.links.kakao || '',
              youtube: socialsSource.youtube || prev.links.youtube || '',
              instagram: socialsSource.instagram || prev.links.instagram || '',
              naver: socialsSource.naver || prev.links.naver || '',
              tiktok: socialsSource.tiktok || prev.links.tiktok || '',
              businessProposal: typeof socialsSource.businessProposal === 'boolean' ? socialsSource.businessProposal : (prev.links.businessProposal || false),
              liveNotify: typeof socialsSource.liveNotify === 'boolean' ? socialsSource.liveNotify : (prev.links.liveNotify || false)
            }
          }));
        }
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    loadData();
  }, [userName, normalizedUsername]);

  useEffect(() => {
    let cancelled = false;
    apiService.getSellerVerification(userName.replace(/^biz\//, '')).then((data) => {
      if (!cancelled) setVerification(data);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userName]);

  const processImageFile = (file: File): Promise<Blob> => {
    // For maximum quality, return the original file if it's already a supported format and within size limits
    const directUploadTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
    if (directUploadTypes.includes(file.type) && file.size <= 20 * 1024 * 1024) {
      return Promise.resolve(file);
    }

    // Only process (resize) if file is very large or needs format conversion
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

        // Try PNG first for lossless, then JPEG at max quality
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(imageUrl);
          if (blob) {
            resolve(blob);
          } else {
            canvas.toBlob((jpegBlob) => {
              if (jpegBlob) resolve(jpegBlob);
              else reject(new Error('이미지 변환에 실패했습니다'));
            }, 'image/jpeg', 1.0);
          }
        }, 'image/png', 1.0);
      };
      img.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('이미지 로드에 실패했습니다'));
      };
      img.src = imageUrl;
    });
  };

  const applyImageToState = (url: string, target: typeof uploadTarget) => {
    if (!target) return;
    if (target.type === 'block' && target.id) {
      const idx = target.index ?? 0;
      setBlocks(prev => prev.map(b => {
        if (b.id !== target.id) return b;
        const cols = (b.gridColumns || 1) as number;
        const next = resizeImages(b.images, b.content || '', cols);
        const safeIdx = Math.min(Math.max(0, idx), cols - 1);
        next[safeIdx] = url;
        return { ...b, images: next, content: next[0] || '' };
      }));
    } else if (target.type === 'cover') {
      setDesign(prev => ({ ...prev, portfolioHeaderImage: url }));
    } else if (target.type === 'category' && target.id) {
      setBlocks(prev => prev.map(b => b.id === target.id ? { ...b, categoryImage: url } : b));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;

    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)$/i.test(file.name);
    const allowedImageExts = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'];
    const isImage = file.type.startsWith('image/') || allowedImageExts.some(t => file.name.toLowerCase().endsWith(`.${t}`));

    // 카테고리 이미지는 이미지 파일만 허용
    if (uploadTarget.type === 'category' && !isImage) {
      setSaveMessage('카테고리 이미지는 이미지 파일만 업로드할 수 있습니다.');
      setSaveSuccess(false);
      setShowToast(true);
      return;
    }

    // 상단 커버 영상 업로드는 멤버십 전용 (이미지 커버는 무료)
    if (uploadTarget.type === 'cover' && isVideo && !membershipActive) {
      setSaveMessage('영상 커버는 스탠다드 멤버십(월 4,900원)부터 이용할 수 있습니다.');
      setSaveSuccess(false);
      setShowToast(true);
      return;
    }

    if (!isImage && !isVideo) {
      setSaveMessage('이미지 또는 영상 파일만 업로드할 수 있습니다.');
      setSaveSuccess(false);
      setShowToast(true);
      return;
    }

    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.size > MAX_FILE_SIZE) {
      setSaveMessage('파일 크기가 20MB를 초과합니다.');
      setSaveSuccess(false);
      setShowToast(true);
      return;
    }

    if (isImage) {
      pendingFileRef.current = file;
      const previewUrl = URL.createObjectURL(file);
      setCropperSrc(previewUrl);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (isVideo) {
      pendingFileRef.current = file;
      const previewUrl = URL.createObjectURL(file);
      setVideoCropperSrc(previewUrl);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    await doUpload(file, null);
  };

  const handleCropConfirm = async (croppedBlob: Blob) => {
    const file = pendingFileRef.current;
    setCropperSrc(null);
    pendingFileRef.current = null;
    if (!file || !uploadTarget) return;
    await doUpload(file, croppedBlob);
  };

  const handleCropCancel = () => {
    if (cropperSrc) URL.revokeObjectURL(cropperSrc);
    setCropperSrc(null);
    pendingFileRef.current = null;
    setUploadTarget(null);
  };

  const handleVideoCropConfirm = async (position: { x: number; y: number }) => {
    const file = pendingFileRef.current;
    if (videoCropperSrc) URL.revokeObjectURL(videoCropperSrc);
    setVideoCropperSrc(null);
    pendingFileRef.current = null;
    if (!file || !uploadTarget) return;
    const currentTarget = uploadTarget;
    await doUpload(file, null);
    if (currentTarget.type === 'block' && currentTarget.id) {
      const idx = currentTarget.index ?? 0;
      setBlocks(prev => prev.map(b =>
        b.id === currentTarget.id
          ? { ...b, imagePositions: { ...b.imagePositions, [idx]: position } }
          : b
      ));
    } else if (currentTarget.type === 'cover') {
      setDesign(prev => ({ ...prev, portfolioHeaderImagePosition: `${position.y}` }));
    }
  };

  const handleVideoCropCancel = () => {
    if (videoCropperSrc) URL.revokeObjectURL(videoCropperSrc);
    setVideoCropperSrc(null);
    pendingFileRef.current = null;
    setUploadTarget(null);
  };

  const doUpload = async (file: File, croppedBlob: Blob | null) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)$/i.test(file.name);

    setIsUploading(true);
    const currentTarget = uploadTarget;

    try {
      // 1. 이미지/영상 처리 (영상은 원본 그대로, 크롭된 이미지는 그대로 사용)
      const processedBlob: Blob = isVideo ? file : (croppedBlob || await processImageFile(file));

      // 2. 로컬 미리보기 즉시 표시 (영상은 로컬 blob 미리보기 생략하고 업로드 완료 후 표시)
      let blobUrl = '';
      if (!isVideo) {
        blobUrl = URL.createObjectURL(processedBlob);
        applyImageToState(blobUrl, currentTarget);
      }

      // 3. Netlify Blobs API 업로드 시도 (메인 스토리지) - 재시도 로직 포함
      let finalUrl = '';
      const fallbackExt = isVideo
        ? (processedBlob.type === 'video/webm' ? 'webm' : processedBlob.type === 'video/quicktime' ? 'mov' : 'mp4')
        : (processedBlob.type === 'image/png' ? 'png' : processedBlob.type === 'image/webp' ? 'webp' : 'jpg');
      const ext = file.name?.split('.').pop()?.toLowerCase() || fallbackExt;
      const fileName = `${Date.now()}-${file.name.replace(/\.[^/.]+$/, '')}.${ext}`;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const apiUrl = await apiService.uploadImage(normalizedUsername, processedBlob, fileName);
          if (apiUrl) {
            finalUrl = apiUrl;
            break;
          }
        } catch (apiError) {
          console.warn(`[Portfolio Upload] API 업로드 시도 ${attempt + 1}/3 실패:`, apiError);
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }

      // 4. API 실패 시 Supabase Storage 업로드 시도
      if (!finalUrl && supabase) {
        try {
          const filePath = `${normalizedUsername}/${fileName}`;

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
          console.warn('[Portfolio Upload] Supabase 업로드 실패:', storageError);
        }
      }

      // 5. 모든 업로드 실패 시 Base64 데이터 URL로 폴백
      if (!finalUrl) {
        finalUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(processedBlob);
        });
      }

      // 6. 최종 URL로 상태 업데이트
      applyImageToState(finalUrl, currentTarget);

      // 메모리 해제
      setTimeout(() => {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }, 1000);

      setSaveMessage(isVideo ? '영상이 업로드되었습니다!' : '이미지가 업로드되었습니다!');
      setSaveSuccess(true);
      setShowToast(true);
    } catch (error) {
      console.error('[Portfolio Upload] 에러:', error);
      setSaveMessage('파일 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
      setSaveSuccess(false);
      setShowToast(true);
    } finally {
      setIsUploading(false);
      setUploadTarget(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const triggerFileUpload = (target: { type: 'profile' | 'block' | 'cover' | 'category'; id?: string; index?: number }) => {
    if (isUploading) return;
    setUploadTarget(target);
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  };

  const handleSave = async () => {
    console.log('[PortfolioSave] 시작');
    setIsSaving(true);

    // 5초 후 강제 로딩 종료 안전장치
    const timeoutId = setTimeout(() => {
      console.warn('[PortfolioSave] 5초 타임아웃 발생 - 로딩 강제 종료');
      setIsSaving(false);
    }, 5000);

    try {
      console.log('[PortfolioSave] 데이터 정제 중...');

      const socials = {
        phone: (profile.links.phone || '').trim(),
        kakao: (profile.links.kakao || '').trim(),
        youtube: (profile.links.youtube || '').trim(),
        instagram: (profile.links.instagram || '').trim(),
        tiktok: (profile.links.tiktok || '').trim(),
        naver: (profile.links.naver || '').trim(),
        businessProposal: profile.links.businessProposal || false,
        liveNotify: profile.links.liveNotify || false
      };

      const savePayload = {
        portfolio: blocks,
        design: design ? {
          ...design,
          homePriority: design.homePriority || 'portfolio'
        } as any : undefined,
        profile: {
          name: profile.name,
          bio: profile.bio,
          avatar_url: profile.avatar_url,
          aboutSections: (profile.aboutSections || [])
            .map(s => ({ id: s.id, title: (s.title || '').trim(), content: (s.content || '').trim() }))
            .filter(s => s.title || s.content)
        },
        socials: socials
      };

      // 1. Netlify Blobs 저장 (최우선 클라우드 스토리지 - 반드시 성공해야 함)
      let cloudSaveSuccess = false;
      try {
        cloudSaveSuccess = await apiService.saveSiteData(userName, savePayload);
        if (cloudSaveSuccess) {
          console.log('[PortfolioSave] Netlify Blobs 동기화 완료');
        } else {
          console.warn('[PortfolioSave] Netlify Blobs 동기화 실패 (응답 오류)');
        }
      } catch (blobError) {
        console.warn('[PortfolioSave] Netlify Blobs 동기화 실패:', blobError);
      }

      // 2. localStorage 저장 (클라우드 성공 여부와 관계없이 로컬 캐시 업데이트)
      localStorage.setItem(`picks_profile_${normalizedUsername}`, JSON.stringify(profile));
      localStorage.setItem(`picks_portfolio_${normalizedUsername}`, JSON.stringify(blocks));
      localStorage.setItem(`picks_socials_${normalizedUsername}`, JSON.stringify(socials));
      if (design) {
        localStorage.setItem(`picks_design_${normalizedUsername}`, JSON.stringify(design));
      }
      console.log('[PortfolioSave] localStorage 저장 완료');

      // 3. Supabase 저장 (선택적 - 실패해도 전체 저장에 영향 없음)
      try {
        if (!supabase) {
          console.warn('[PortfolioSave] Supabase 클라이언트 없음 - Supabase 동기화 건너뜀');
        } else {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          console.log('[PortfolioSave] 세션 상태:', { session: sessionData.session, error: sessionError });

          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            console.warn('[PortfolioSave] 로그인 안 됨 - Supabase 동기화 건너뜀');
          } else {
            console.log('[PortfolioSave] Supabase 저장 시도...', { blocks, profile });
            const result = await updateSiteSettings(userName, {
              portfolio: blocks,
              design: savePayload.design,
              profile: profile,
              socials: socials
            });
            console.log('[PortfolioSave] Supabase 결과:', result);
          }
        }
      } catch (supabaseError) {
        console.warn('[PortfolioSave] Supabase 동기화 실패 (무시됨):', supabaseError);
      }

      // 4. 결과 피드백 - 클라우드 저장 성공 여부 확인
      if (cloudSaveSuccess) {
        setSaveMessage('저장이 완료되었습니다!');
        setSaveSuccess(true);

        // 5. 카카오 스크랩 캐시 갱신 (커버 사진 변경 시, 백그라운드 호출)
        if (design) {
          apiService.refreshKakaoCache(userName).catch(err =>
            console.warn('[PortfolioSave] 카카오 캐시 갱신 실패 (무시됨):', err)
          );
        }
      } else {
        setSaveMessage('클라우드 저장에 실패했습니다. 다시 시도해주세요.');
        setSaveSuccess(false);
      }
      setShowToast(true);
    } catch (error) {
      console.error('[PortfolioSave] 에러 발생:', error);
      setSaveMessage(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
      setSaveSuccess(false);
      setShowToast(true);
    } finally {
      clearTimeout(timeoutId);
      setIsSaving(false);
      setTimeout(() => setSaveMessage(''), 3000);
      console.log('[PortfolioSave] 종료');
    }
  };

  const addBlock = (type: 'text' | 'image' | 'category', targetCategoryId?: string) => {
    const newId = Date.now().toString();
    const newBlock: PortfolioBlock = {
      id: newId,
      type,
      content: type === 'text'
        ? '새로운 텍스트 내용을 입력하세요.'
        : type === 'category'
        ? '새 카테고리'
        : '',
      ...(type === 'image' ? { gridColumns: 1 as BlockGridColumns, images: [''] } : {})
    };
    if (type === 'category') {
      const prevScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
      const prevDocHeight = typeof document !== 'undefined' ? document.documentElement.scrollHeight : 0;
      setBlocks([...blocks, newBlock]);
      setEditingCategoryId(newId);
      if (typeof window !== 'undefined') {
        const restore = () => {
          const newDocHeight = document.documentElement.scrollHeight;
          const maxY = Math.max(0, newDocHeight - window.innerHeight);
          const delta = newDocHeight - prevDocHeight;
          const target = Math.min(maxY, Math.max(0, prevScrollY + (delta < 0 ? delta : 0)));
          window.scrollTo({ top: target, left: 0, behavior: 'auto' });
        };
        requestAnimationFrame(() => requestAnimationFrame(restore));
      }
      return;
    }
    const effectiveCategoryId = targetCategoryId ?? editingCategoryId;
    if (!effectiveCategoryId) {
      setBlocks([...blocks, newBlock]);
      return;
    }
    const startIdx = blocks.findIndex(b => b?.id === effectiveCategoryId);
    if (startIdx === -1) {
      setBlocks([...blocks, newBlock]);
      return;
    }
    let endIdx = blocks.length;
    for (let i = startIdx + 1; i < blocks.length; i++) {
      if (blocks[i]?.type === 'category') { endIdx = i; break; }
    }
    const next = [...blocks];
    next.splice(endIdx, 0, newBlock);
    setBlocks(next);
  };

  const removeBlock = (id: string) => {
    setBlocks(blocks.filter(b => b.id !== id));
    if (editingCategoryId === id) setEditingCategoryId(null);
  };

  const updateBlock = (id: string, content: string) => {
    setBlocks(blocks.map(b => b.id === id ? { ...b, content } : b));
  };

  const updateBlockField = (id: string, patch: Partial<PortfolioBlock>) => {
    setBlocks(blocks.map(b => b.id === id ? { ...b, ...patch } : b));
  };

  return (
    <div className="p-4 md:p-14 max-w-6xl mx-auto animate-in fade-in duration-500">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif,video/mp4,video/webm,video/quicktime,video/x-m4v,video/*"
      />
      {cropperSrc && (() => {
        let cropAspect: number | undefined = 1;
        if (uploadTarget?.type === 'cover') {
          cropAspect = 4 / 5;
        } else if (uploadTarget?.type === 'block' && uploadTarget.id) {
          const targetBlock = blocks.find(b => b.id === uploadTarget.id);
          cropAspect = (targetBlock?.gridColumns === 1) ? undefined : 1;
        }
        return (
          <ImageCropper
            src={cropperSrc}
            onCrop={handleCropConfirm}
            onCancel={handleCropCancel}
            aspectRatio={cropAspect}
          />
        );
      })()}
      {videoCropperSrc && (() => {
        let cropAspect: number | undefined = 1;
        if (uploadTarget?.type === 'cover') {
          cropAspect = 4 / 5;
        } else if (uploadTarget?.type === 'block' && uploadTarget.id) {
          const targetBlock = blocks.find(b => b.id === uploadTarget.id);
          cropAspect = (targetBlock?.gridColumns === 1) ? undefined : 1;
        }
        return (
          <VideoCropper
            src={videoCropperSrc}
            onConfirm={handleVideoCropConfirm}
            onCancel={handleVideoCropCancel}
            aspectRatio={cropAspect}
          />
        );
      })()}

      <header className="mb-6 md:mb-12 flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6">
        <div>
          <h2 className="text-lg md:text-4xl font-black text-slate-900 mb-1 md:mb-3">포트폴리오 설정</h2>
          <p className="text-slate-500 font-medium text-[9px] md:text-base">나만의 스타일로 포트폴리오를 구성하세요.</p>
        </div>
        {/* Mobile save button */}
        <div className="flex items-center gap-4 lg:hidden">
          {saveMessage && (
            <span className={`${saveSuccess ? 'text-emerald-500' : 'text-red-500'} font-black text-xs animate-in fade-in slide-in-from-right-2`}>
              {saveMessage}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-purple-600 text-white px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2 hover:bg-purple-700 transition-all shadow-xl shadow-purple-200 disabled:opacity-50 text-sm"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>저장하기</span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
        {/* Editor Side */}
        <div className="lg:col-span-8 space-y-6 md:space-y-10">
          {/* Profile Settings Section */}
          <section className="bg-white rounded-2xl md:rounded-[3rem] border border-slate-100 p-6 md:p-10 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg md:text-xl font-black text-slate-900">프로필 정보 설정</h3>
              <User size={20} className="text-purple-600" />
            </div>

            <div className="flex flex-col md:flex-row gap-6">
              {/* Name & Bio */}
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">이름</label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-black text-lg focus:ring-2 focus:ring-purple-100 focus:border-purple-300 transition-all"
                    placeholder="이름"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">소개</label>
                  <textarea
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 font-bold text-sm focus:ring-2 focus:ring-purple-100 focus:border-purple-300 transition-all"
                    placeholder="소개를 입력하세요"
                    rows={2}
                  />
                </div>
              </div>
            </div>

            {/* Social Links - Dynamic Add/Remove */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">소셜 링크 & 연락처</label>

              {/* Active (added) links */}
              <div className="space-y-2">
                {profile.links?.phone !== undefined && profile.links.phone !== '' && (
                  <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <Phone size={16} className="text-slate-400 shrink-0" />
                    <input
                      type="text"
                      value={profile.links.phone}
                      onChange={(e) => setProfile({ ...profile, links: { ...profile.links, phone: e.target.value } })}
                      className="flex-1 bg-transparent border-none font-bold text-sm focus:outline-none"
                      placeholder="전화번호 (예: 010-1234-5678)"
                    />
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, phone: '' } })}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {profile.links?.kakao !== undefined && profile.links.kakao !== '' && (
                  <div className="flex items-center gap-3 bg-yellow-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <MessageCircle size={16} className="text-yellow-500 shrink-0" />
                    <input
                      type="text"
                      value={profile.links.kakao}
                      onChange={(e) => setProfile({ ...profile, links: { ...profile.links, kakao: e.target.value } })}
                      className="flex-1 bg-transparent border-none font-bold text-sm focus:outline-none"
                      placeholder="카카오톡 채널 링크 또는 ID"
                    />
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, kakao: '' } })}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {profile.links?.youtube !== undefined && profile.links.youtube !== '' && (
                  <div className="flex items-center gap-3 bg-red-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <Youtube size={16} className="text-red-500 shrink-0" />
                    <input
                      type="text"
                      value={profile.links.youtube}
                      onChange={(e) => setProfile({ ...profile, links: { ...profile.links, youtube: e.target.value } })}
                      className="flex-1 bg-transparent border-none font-bold text-sm focus:outline-none"
                      placeholder="YouTube 채널 링크"
                    />
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, youtube: '' } })}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {profile.links?.instagram !== undefined && profile.links.instagram !== '' && (
                  <div className="flex items-center gap-3 bg-pink-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <Instagram size={16} className="text-pink-500 shrink-0" />
                    <input
                      type="text"
                      value={profile.links.instagram}
                      onChange={(e) => setProfile({ ...profile, links: { ...profile.links, instagram: e.target.value } })}
                      className="flex-1 bg-transparent border-none font-bold text-sm focus:outline-none"
                      placeholder="Instagram 사용자명 (예: @username)"
                    />
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, instagram: '' } })}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {profile.links?.naver !== undefined && profile.links.naver !== '' && (
                  <div className="flex items-center gap-3 bg-green-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <span className="text-[#03C75A] font-black text-sm shrink-0 w-4 text-center">N</span>
                    <input
                      type="text"
                      value={profile.links.naver}
                      onChange={(e) => setProfile({ ...profile, links: { ...profile.links, naver: e.target.value } })}
                      className="flex-1 bg-transparent border-none font-bold text-sm focus:outline-none"
                      placeholder="네이버 블로그 링크"
                    />
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, naver: '' } })}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {profile.links?.tiktok !== undefined && profile.links.tiktok !== '' && (
                  <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <Globe size={16} className="text-slate-900 shrink-0" />
                    <input
                      type="text"
                      value={profile.links.tiktok}
                      onChange={(e) => setProfile({ ...profile, links: { ...profile.links, tiktok: e.target.value } })}
                      className="flex-1 bg-transparent border-none font-bold text-sm focus:outline-none"
                      placeholder="TikTok 사용자명 (예: @username)"
                    />
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, tiktok: '' } })}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {profile.links?.businessProposal && (
                  <div className="flex items-center gap-3 bg-purple-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <Briefcase size={16} className="text-purple-600 shrink-0" />
                    <span className="flex-1 font-bold text-sm text-purple-700">비즈니스 제안 버튼 활성화됨</span>
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, businessProposal: false } })}
                      className="p-1 text-purple-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {profile.links?.liveNotify && (
                  <div className="flex items-center gap-3 bg-purple-50 rounded-xl px-4 py-3 animate-in slide-in-from-top-2 duration-300">
                    <Bell size={16} className="text-purple-primary shrink-0" />
                    <span className="flex-1 font-bold text-sm text-purple-700">라이브 알림 버튼 활성화됨</span>
                    <button
                      type="button"
                      onClick={() => setProfile({ ...profile, links: { ...profile.links, liveNotify: false } })}
                      className="p-1 text-purple-300 hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Add link buttons */}
              {(
                !profile.links?.phone ||
                !profile.links?.kakao ||
                !profile.links?.youtube ||
                !profile.links?.instagram ||
                !profile.links?.naver ||
                !profile.links?.tiktok ||
                !profile.links?.businessProposal ||
                !profile.links?.liveNotify
              ) && (
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-300 uppercase tracking-widest">추가하기</label>
                  <div className="flex flex-wrap gap-2">
                    {!profile.links?.phone && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, phone: ' ' } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-slate-300 text-slate-500 text-[10px] font-bold hover:border-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all"
                      >
                        <Plus size={12} />
                        <Phone size={12} />
                        전화
                      </button>
                    )}
                    {!profile.links?.kakao && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, kakao: ' ' } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-yellow-300 text-yellow-600 text-[10px] font-bold hover:border-yellow-400 hover:bg-yellow-50 transition-all"
                      >
                        <Plus size={12} />
                        <MessageCircle size={12} />
                        카카오톡
                      </button>
                    )}
                    {!profile.links?.youtube && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, youtube: ' ' } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-red-300 text-red-500 text-[10px] font-bold hover:border-red-400 hover:bg-red-50 transition-all"
                      >
                        <Plus size={12} />
                        <Youtube size={12} />
                        유튜브
                      </button>
                    )}
                    {!profile.links?.instagram && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, instagram: ' ' } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-pink-300 text-pink-500 text-[10px] font-bold hover:border-pink-400 hover:bg-pink-50 transition-all"
                      >
                        <Plus size={12} />
                        <Instagram size={12} />
                        인스타그램
                      </button>
                    )}
                    {!profile.links?.naver && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, naver: ' ' } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-green-300 text-green-600 text-[10px] font-bold hover:border-green-400 hover:bg-green-50 transition-all"
                      >
                        <Plus size={12} />
                        <span className="font-black text-xs">N</span>
                        네이버
                      </button>
                    )}
                    {!profile.links?.tiktok && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, tiktok: ' ' } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-slate-300 text-slate-500 text-[10px] font-bold hover:border-slate-400 hover:bg-slate-50 transition-all"
                      >
                        <Plus size={12} />
                        <Globe size={12} />
                        틱톡
                      </button>
                    )}
                    {!profile.links?.businessProposal && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, businessProposal: true } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-purple-300 text-purple-600 text-[10px] font-bold hover:border-purple-400 hover:bg-purple-50 transition-all"
                      >
                        <Plus size={12} />
                        <Briefcase size={12} />
                        비즈니스 제안
                      </button>
                    )}
                    {!profile.links?.liveNotify && (
                      <button
                        type="button"
                        onClick={() => setProfile({ ...profile, links: { ...profile.links, liveNotify: true } })}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-dashed border-purple-300 text-purple-600 text-[10px] font-bold hover:border-purple-400 hover:bg-purple-50 transition-all"
                      >
                        <Plus size={12} />
                        <Bell size={12} />
                        라이브 알림
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Portfolio Cover Section */}
          <section className="bg-white rounded-2xl md:rounded-[3rem] border border-slate-100 p-6 md:p-10 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg md:text-xl font-black text-slate-900">상단 커버 디자인</h3>
              <Palette size={20} className="text-purple-600" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  커버 미디어 (이미지 / 영상)
                  {!membershipActive && (
                    <span className="inline-flex items-center gap-0.5 text-[8px] font-black text-purple-700 bg-purple-100 border border-purple-200 px-1.5 py-0.5 rounded-full normal-case tracking-normal">
                      <Lock size={8} /> 영상은 멤버십
                    </span>
                  )}
                </label>
                <div className="flex items-start gap-3">
                  <div
                    onClick={() => !design?.portfolioHeaderImage && triggerFileUpload({ type: 'cover' })}
                    className="flex-1 aspect-[4/5] rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-all overflow-hidden relative"
                  >
                    {isUploading && uploadTarget?.type === 'cover' ? (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                        <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                      </div>
                    ) : null}
                    {design?.portfolioHeaderImage ? (
                      <MediaAuto
                        src={design.portfolioHeaderImage}
                        className="w-full h-full object-cover rounded-2xl"
                        style={design.portfolioHeaderImagePosition ? { objectPosition: `center ${design.portfolioHeaderImagePosition}%` } : undefined}
                      />
                    ) : (
                      <>
                        <ImageIcon size={32} className="text-slate-300 mb-2" />
                        <span className="text-xs font-black text-slate-400">이미지 업로드</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => triggerFileUpload({ type: 'cover' })}
                    disabled={isUploading}
                    className="p-3 bg-purple-50 text-purple-600 rounded-xl hover:bg-purple-100 transition-all flex flex-col items-center gap-1.5 shrink-0 disabled:opacity-50"
                  >
                    <Camera size={18} />
                    <span className="text-[9px] font-black whitespace-nowrap">{design?.portfolioHeaderImage ? '변경' : '업로드'}</span>
                  </button>
                </div>
                {design?.portfolioHeaderImage && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDesign(prev => ({ ...prev, portfolioHeaderImage: undefined, portfolioHeaderImagePosition: undefined }));
                      }}
                      className="text-[10px] font-black text-red-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <Trash2 size={12} /> 이미지 삭제
                    </button>
                  </>
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

          {/* Content Blocks Editor — locked behind 4,900원 standard membership */}
          <section className="space-y-4 md:space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4">
              <h3 className="text-lg md:text-xl font-black text-slate-900 flex items-center gap-2">
                콘텐츠 구성
                {!membershipActive && (
                  <span className="inline-flex items-center gap-1 text-[9px] md:text-[10px] font-black text-purple-700 bg-purple-100 border border-purple-200 px-2 py-0.5 rounded-full">
                    <Lock size={10} /> 멤버십 전용
                  </span>
                )}
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    if (!membershipActive) {
                      onNavigateMembership?.();
                      return;
                    }
                    addBlock('text');
                  }}
                  className={`px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-black flex items-center gap-1.5 md:gap-2 transition-all ${
                    membershipActive
                      ? 'bg-white border border-slate-200 hover:bg-slate-50'
                      : 'bg-slate-100 border border-slate-200 text-slate-400 cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  {membershipActive ? <Type size={12} className="md:w-3.5 md:h-3.5" /> : <Lock size={12} className="md:w-3.5 md:h-3.5" />}
                  텍스트 추가
                </button>
                <button
                  onClick={() => {
                    if (!membershipActive) {
                      onNavigateMembership?.();
                      return;
                    }
                    addBlock('image');
                  }}
                  className={`px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-black flex items-center gap-1.5 md:gap-2 transition-all ${
                    membershipActive
                      ? 'bg-white border border-slate-200 hover:bg-slate-50'
                      : 'bg-slate-100 border border-slate-200 text-slate-400 cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  {membershipActive ? <ImageIcon size={12} className="md:w-3.5 md:h-3.5" /> : <Lock size={12} className="md:w-3.5 md:h-3.5" />}
                  이미지 추가
                </button>
                <button
                  onClick={() => {
                    if (!membershipActive) {
                      onNavigateMembership?.();
                      return;
                    }
                    addBlock('category');
                  }}
                  className={`px-3 md:px-4 py-1.5 md:py-2 rounded-full text-[10px] md:text-xs font-black flex items-center gap-1.5 md:gap-2 transition-all ${
                    membershipActive
                      ? 'bg-white border border-slate-200 hover:bg-slate-50'
                      : 'bg-slate-100 border border-slate-200 text-slate-400 cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  {membershipActive ? <Hash size={12} className="md:w-3.5 md:h-3.5" /> : <Lock size={12} className="md:w-3.5 md:h-3.5" />}
                  카테고리 추가
                </button>
              </div>
            </div>

            {!membershipActive ? (
              <div className="bg-white border border-purple-100 rounded-2xl p-6 md:p-10 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-2xl shrink-0">🔒</div>
                  <div className="flex-1">
                    <h4 className="text-base md:text-lg font-black text-slate-900">콘텐츠 구성은 스탠다드 멤버십 전용입니다</h4>
                    <p className="text-slate-500 text-xs md:text-sm font-medium mt-1.5 leading-relaxed">
                      포트폴리오 본문(텍스트 · 이미지 블록)과 상단 커버 영상 업로드는 월 4,900원 스탠다드 멤버십에 포함됩니다. 라이브 커머스 송출까지 사용하시려면 월 13,900원 커머스 멤버십을 선택해 주세요.
                    </p>
                    <ul className="space-y-1.5 mt-4 text-xs md:text-sm text-slate-600 font-medium">
                      <li className="flex items-center gap-2"><span className="text-purple-500 font-black">✓</span>상단 커버 <strong>영상</strong> 업로드</li>
                      <li className="flex items-center gap-2"><span className="text-purple-500 font-black">✓</span>텍스트 · 이미지 블록 무제한 편집</li>
                    </ul>
                    <div className="flex flex-col sm:flex-row gap-2 mt-5">
                      <button
                        type="button"
                        onClick={() => onNavigateMembership?.()}
                        className="flex-1 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-purple-500 to-fuchsia-500 hover:from-purple-600 hover:to-fuchsia-600 transition-all shadow-md text-sm"
                      >
                        스탠다드 멤버십 4,900원으로 풀기
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateMembership?.()}
                        className="flex-1 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 transition-all shadow-md text-sm"
                      >
                        커머스 멤버십 13,900원
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const allBlocks = blocks.filter(Boolean);
                  const categoryList = allBlocks.filter(b => b.type === 'category');
                  if (categoryList.length === 0) return null;
                  return (
                    <div className="px-1 pb-2 overflow-x-auto scrollbar-hide flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingCategoryId(null)}
                        className={`px-3 py-1.5 rounded-full text-[10px] md:text-xs font-black whitespace-nowrap border transition-all ${
                          editingCategoryId === null
                            ? 'bg-slate-900 text-white border-transparent'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        전체
                      </button>
                      {categoryList.map(c => {
                        const name = (c.content || '').trim() || '카테고리';
                        const isActive = editingCategoryId === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setEditingCategoryId(c.id)}
                            className={`px-3 py-1.5 rounded-full text-[10px] md:text-xs font-black whitespace-nowrap border transition-all flex items-center gap-1 ${
                              isActive
                                ? 'bg-purple-600 text-white border-transparent'
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            <Hash size={10} />
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                {(() => {
                  const allBlocks = blocks.filter(Boolean);
                  let editorBlocks: PortfolioBlock[] = allBlocks;
                  if (editingCategoryId) {
                    const startIdx = allBlocks.findIndex(b => b.id === editingCategoryId);
                    if (startIdx === -1) {
                      editorBlocks = [];
                    } else {
                      const slice: PortfolioBlock[] = [allBlocks[startIdx]];
                      for (let i = startIdx + 1; i < allBlocks.length; i++) {
                        if (allBlocks[i].type === 'category') break;
                        slice.push(allBlocks[i]);
                      }
                      editorBlocks = slice;
                    }
                  }
                  if (editorBlocks.length === 0) {
                    return (
                      <div className="bg-white border border-dashed border-slate-200 rounded-2xl px-5 py-8 text-center text-[12px] font-bold text-slate-400">
                        이 카테고리에 콘텐츠가 없습니다. 위 버튼으로 텍스트나 이미지를 추가해 보세요.
                      </div>
                    );
                  }
                  return editorBlocks.map((block) => (
                <div key={block.id} className="bg-white rounded-[2rem] border border-slate-100 p-4 md:p-5 shadow-sm group relative animate-in slide-in-from-bottom-4">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-200 group-hover:text-slate-400 transition-colors cursor-grab">
                    <GripVertical size={20} />
                  </div>

                  <div className="pl-7 md:pl-8 pr-12 md:pr-14">
                    {block.type === 'category' ? (
                      <div className="space-y-3 py-1">
                        <div className="flex items-center gap-3">
                          <Hash size={18} className="text-purple-500 shrink-0" />
                          <input
                            type="text"
                            value={block.content}
                            onChange={(e) => updateBlock(block.id, e.target.value)}
                            className="flex-1 min-w-0 bg-transparent border-none font-black text-lg md:text-xl text-slate-900 focus:outline-none placeholder:text-slate-300"
                            placeholder="카테고리 제목 (예: 프로젝트, 리뷰, 협업)"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => addBlock('text', block.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white hover:bg-slate-700 text-[11px] font-black transition-all"
                          >
                            <Type size={12} />
                            텍스트 추가
                          </button>
                          <button
                            type="button"
                            onClick={() => addBlock('image', block.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-600 text-white hover:bg-purple-700 text-[11px] font-black transition-all"
                          >
                            <ImageIcon size={12} />
                            이미지 추가
                          </button>
                        </div>
                      </div>
                    ) : block.type === 'text' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 space-y-2">
                          <div
                            className="flex items-center gap-1 bg-white rounded-xl px-2 py-1.5 border border-slate-200 flex-wrap shadow-sm"
                            onMouseDown={(e) => {
                              const t = e.target as HTMLElement;
                              if (t.closest('input, [data-picker-root]')) return;
                              e.preventDefault();
                            }}
                          >
                            {/* Font size stepper */}
                            <div className="flex items-center bg-white rounded-md border border-slate-200 h-8">
                              {(() => {
                                const activeSelectionPx = selectionFormats.editorId === block.id ? selectionFormats.fontPx : null;
                                const displayPx = activeSelectionPx ?? getBlockFontPx(block);
                                return (
                                  <>
                                    <input
                                      type="number"
                                      min={8}
                                      max={96}
                                      value={displayPx}
                                      onChange={(e) => {
                                        const raw = Number(e.target.value);
                                        const next = Number.isFinite(raw) ? Math.min(96, Math.max(8, Math.round(raw))) : 14;
                                        applyBlockFontSize(block.id, next);
                                      }}
                                      className="w-9 text-[12px] font-bold text-slate-700 bg-transparent outline-none pl-2 py-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      aria-label="글자 크기(px)"
                                    />
                                    <span className="text-[10px] text-slate-400 font-bold pr-1 select-none">px</span>
                                    <div className="flex flex-col border-l border-slate-200 h-full">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const next = Math.min(96, displayPx + 1);
                                          applyBlockFontSize(block.id, next);
                                        }}
                                        className="flex-1 px-1 text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                                        aria-label="글자 키우기"
                                      >
                                        <ChevronUp size={10} strokeWidth={2.5} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const next = Math.max(8, displayPx - 1);
                                          applyBlockFontSize(block.id, next);
                                        }}
                                        className="flex-1 px-1 text-slate-500 hover:bg-slate-100 flex items-center justify-center border-t border-slate-200"
                                        aria-label="글자 줄이기"
                                      >
                                        <ChevronDown size={10} strokeWidth={2.5} />
                                      </button>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>

                            <div className="w-px h-5 bg-slate-200 mx-1" />

                            {/* Bold */}
                            <button
                              type="button"
                              onClick={() => applySelectionOrBlock(
                                block.id,
                                (editor) => runExecCommand(editor, 'bold'),
                                () => updateBlockField(block.id, { bold: !block.bold })
                              )}
                              className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${
                                (selectionFormats.editorId === block.id ? selectionFormats.bold : block.bold) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                              }`}
                              aria-pressed={selectionFormats.editorId === block.id ? selectionFormats.bold : !!block.bold}
                              aria-label="굵게"
                            >
                              <BoldIcon size={14} strokeWidth={3} />
                            </button>
                            {/* Italic */}
                            <button
                              type="button"
                              onClick={() => applySelectionOrBlock(
                                block.id,
                                (editor) => runExecCommand(editor, 'italic'),
                                () => updateBlockField(block.id, { italic: !block.italic })
                              )}
                              className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${
                                (selectionFormats.editorId === block.id ? selectionFormats.italic : block.italic) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                              }`}
                              aria-pressed={selectionFormats.editorId === block.id ? selectionFormats.italic : !!block.italic}
                              aria-label="기울임"
                            >
                              <ItalicIcon size={14} strokeWidth={2.5} />
                            </button>
                            {/* Underline */}
                            <button
                              type="button"
                              onClick={() => applySelectionOrBlock(
                                block.id,
                                (editor) => runExecCommand(editor, 'underline'),
                                () => updateBlockField(block.id, { underline: !block.underline })
                              )}
                              className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${
                                (selectionFormats.editorId === block.id ? selectionFormats.underline : block.underline) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                              }`}
                              aria-pressed={selectionFormats.editorId === block.id ? selectionFormats.underline : !!block.underline}
                              aria-label="밑줄"
                            >
                              <UnderlineIcon size={14} strokeWidth={2.5} />
                            </button>
                            {/* Strikethrough */}
                            <button
                              type="button"
                              onClick={() => applySelectionOrBlock(
                                block.id,
                                (editor) => runExecCommand(editor, 'strikeThrough'),
                                () => updateBlockField(block.id, { strikethrough: !block.strikethrough })
                              )}
                              className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${
                                (selectionFormats.editorId === block.id ? selectionFormats.strikethrough : block.strikethrough) ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                              }`}
                              aria-pressed={selectionFormats.editorId === block.id ? selectionFormats.strikethrough : !!block.strikethrough}
                              aria-label="취소선"
                            >
                              <StrikethroughIcon size={14} strokeWidth={2.5} />
                            </button>

                            <div className="w-px h-5 bg-slate-200 mx-1" />

                            {/* Text color picker */}
                            <div className="relative" data-picker-root>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenColorPicker(openColorPicker === block.id ? null : block.id);
                                  setOpenHighlightPicker(null);
                                }}
                                className="h-8 px-2 rounded-md flex items-center gap-1 text-slate-600 hover:bg-slate-100 transition-all"
                                aria-label="글자 색상"
                              >
                                <div className="flex flex-col items-center leading-none">
                                  <span className="text-[12px] font-black">T</span>
                                  <span
                                    className="block w-3.5 h-1 rounded-sm"
                                    style={{ backgroundColor: block.color || '#37352f' }}
                                  />
                                </div>
                                <ChevronDown size={10} strokeWidth={2.5} />
                              </button>
                              {openColorPicker === block.id && (
                                <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl p-2 w-48">
                                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1">글자 색상</div>
                                  <div className="grid grid-cols-8 gap-1">
                                    {TEXT_COLOR_PRESETS.map(c => (
                                      <button
                                        key={c}
                                        type="button"
                                        onClick={() => {
                                          applySelectionOrBlock(
                                            block.id,
                                            (editor) => runExecCommand(editor, 'foreColor', c),
                                            () => updateBlockField(block.id, { color: c })
                                          );
                                          setOpenColorPicker(null);
                                        }}
                                        className={`w-5 h-5 rounded-md transition-all ${
                                          (block.color || '#37352f') === c ? 'ring-2 ring-offset-1 ring-purple-400 scale-110' : 'hover:scale-110'
                                        }`}
                                        style={{ backgroundColor: c }}
                                        aria-label={`color ${c}`}
                                      />
                                    ))}
                                  </div>
                                  <label className="mt-2 flex items-center gap-2 cursor-pointer text-[10px] font-bold text-slate-500 px-1">
                                    <input
                                      type="color"
                                      value={block.color || '#37352f'}
                                      onChange={(e) => applySelectionOrBlock(
                                        block.id,
                                        (editor) => runExecCommand(editor, 'foreColor', e.target.value),
                                        () => updateBlockField(block.id, { color: e.target.value })
                                      )}
                                      className="w-5 h-5 rounded-md overflow-hidden border border-slate-200 cursor-pointer"
                                    />
                                    사용자 지정
                                  </label>
                                </div>
                              )}
                            </div>

                            {/* Highlight color picker */}
                            <div className="relative" data-picker-root>
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenHighlightPicker(openHighlightPicker === block.id ? null : block.id);
                                  setOpenColorPicker(null);
                                }}
                                className="h-8 px-2 rounded-md flex items-center gap-1 text-slate-600 hover:bg-slate-100 transition-all"
                                aria-label="형광펜"
                              >
                                <div
                                  className="flex items-center justify-center h-5 w-5 rounded-sm"
                                  style={{
                                    backgroundColor: block.highlight && block.highlight !== 'transparent' ? block.highlight : '#475569',
                                  }}
                                >
                                  <span
                                    className="text-[11px] font-black leading-none"
                                    style={{ color: block.highlight && block.highlight !== 'transparent' ? '#0f172a' : '#fff' }}
                                  >
                                    T
                                  </span>
                                </div>
                                <ChevronDown size={10} strokeWidth={2.5} />
                              </button>
                              {openHighlightPicker === block.id && (
                                <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl p-2 w-48">
                                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 px-1 flex items-center gap-1">
                                    <Highlighter size={10} /> 형광펜
                                  </div>
                                  <div className="grid grid-cols-4 gap-1.5">
                                    {HIGHLIGHT_COLOR_PRESETS.map(h => (
                                      <button
                                        key={h.value}
                                        type="button"
                                        onClick={() => {
                                          const color = h.value === 'transparent' ? undefined : h.value;
                                          applySelectionOrBlock(
                                            block.id,
                                            (editor) => {
                                              if (!color) return runExecCommand(editor, 'removeFormat');
                                              return wrapSelectionWithStyles(editor, { 'background-color': color });
                                            },
                                            () => updateBlockField(block.id, { highlight: color })
                                          );
                                          setOpenHighlightPicker(null);
                                        }}
                                        className={`h-7 rounded-md text-[10px] font-bold flex items-center justify-center transition-all ${
                                          (block.highlight || 'transparent') === h.value ? 'ring-2 ring-offset-1 ring-purple-400' : 'hover:scale-105'
                                        }`}
                                        style={{
                                          backgroundColor: h.value === 'transparent' ? '#fff' : h.value,
                                          border: h.value === 'transparent' ? '1px dashed #cbd5e1' : '1px solid rgba(0,0,0,0.04)',
                                          color: '#334155'
                                        }}
                                      >
                                        {h.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                          <RichTextEditor
                            ref={setEditorRef(block.id)}
                            value={block.content}
                            onChange={(html) => updateBlock(block.id, html)}
                            placeholder="내용을 자유롭게 입력하세요. 키보드 이모지를 사용해 꾸밀 수 있어요."
                            className={`portfolio-rt-editor w-full bg-white rounded-xl px-5 py-5 md:px-6 md:py-6 min-h-[96px] border border-transparent focus:border-purple-200 focus:ring-2 focus:ring-purple-100 outline-none transition-all whitespace-pre-wrap break-words ${block.bold ? 'font-bold' : 'font-medium'}`}
                            style={{
                              color: block.color || '#37352f',
                              backgroundColor: block.highlight || '#fff',
                              fontSize: `${getBlockFontPx(block)}px`,
                              lineHeight: 1.7,
                              fontStyle: block.italic ? 'italic' : undefined,
                              textDecoration: getTextDecoration(block)
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-black text-slate-500 uppercase tracking-wider">그리드</span>
                          <div className="flex items-center gap-1 bg-white rounded-lg p-1 border border-slate-200">
                            {([
                              { n: 1 as BlockGridColumns, label: '1' },
                              { n: 2 as BlockGridColumns, label: '2' },
                              { n: 3 as BlockGridColumns, label: '3' },
                              { n: 4 as BlockGridColumns, label: '4' }
                            ]).map(opt => (
                              <button
                                key={opt.n}
                                type="button"
                                onClick={() => {
                                  const nextImages = resizeImages(block.images, block.content || '', opt.n);
                                  updateBlockField(block.id, {
                                    gridColumns: opt.n,
                                    images: nextImages,
                                    content: nextImages[0] || ''
                                  });
                                }}
                                className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                                  (block.gridColumns || 1) === opt.n
                                    ? 'bg-purple-600 text-white'
                                    : 'text-slate-500 hover:bg-slate-50'
                                }`}
                                aria-pressed={(block.gridColumns || 1) === opt.n}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {(() => {
                          const cols = (block.gridColumns || 1) as number;
                          const imgs = getBlockImages(block);
                          const gridClass = cols === 1
                            ? 'grid-cols-1'
                            : cols === 2
                            ? 'grid-cols-2'
                            : cols === 3
                            ? 'grid-cols-3'
                            : 'grid-cols-2 md:grid-cols-4';
                          return (
                            <div className={`grid gap-2 ${gridClass}`}>
                              {imgs.map((imgUrl, i) => {
                                const isSlotUploading =
                                  isUploading &&
                                  uploadTarget?.type === 'block' &&
                                  uploadTarget?.id === block.id &&
                                  (uploadTarget?.index ?? 0) === i;
                                return (
                                  <div key={i} className="flex flex-col gap-1.5">
                                    <div className={`${cols === 1 ? (imgUrl ? '' : 'aspect-[4/5]') : 'aspect-square'} rounded-2xl overflow-hidden bg-slate-100 relative border-2 border-dashed border-slate-200`}>
                                      {isSlotUploading ? (
                                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                                          <div className="w-8 h-8 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                                        </div>
                                      ) : null}
                                      {imgUrl ? (
                                        cols > 1 ? (
                                          <ImagePositionEditor
                                            src={imgUrl}
                                            position={block.imagePositions?.[i] || { x: 50, y: 50 }}
                                            onChange={(pos) => updateBlockField(block.id, {
                                              imagePositions: { ...block.imagePositions, [i]: pos }
                                            })}
                                            aspectRatio="1/1"
                                            roundedClass="rounded-2xl"
                                            className="w-full h-full"
                                          />
                                        ) : isVideoSource(imgUrl) && block.imagePositions?.[i] ? (
                                          <div className="aspect-square relative">
                                            <MediaAuto
                                              src={imgUrl}
                                              className="absolute inset-0 w-full h-full object-cover rounded-2xl"
                                              style={{ objectPosition: `${block.imagePositions[i].x}% ${block.imagePositions[i].y}%` }}
                                            />
                                          </div>
                                        ) : (
                                          <MediaAuto
                                            src={imgUrl}
                                            className="w-full h-auto block rounded-2xl"
                                          />
                                        )
                                      ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-1">
                                          <ImageIcon size={cols === 1 ? 32 : 20} />
                                          <span className="text-[10px] font-black">{cols > 1 ? `${i + 1}번` : '이미지 업로드'}</span>
                                        </div>
                                      )}
                                      <button
                                        onClick={() => triggerFileUpload({ type: 'block', id: block.id, index: i })}
                                        disabled={isUploading}
                                        className="absolute bottom-1.5 right-1.5 p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-all flex items-center gap-1 shadow-lg disabled:opacity-50 z-10"
                                      >
                                        <Camera size={14} />
                                        <span className="text-[9px] font-black whitespace-nowrap">{imgUrl ? '변경' : '업로드'}</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => removeBlock(block.id)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ));
                })()}
              </div>
            )}
          </section>
        </div>

        {/* Preview Side */}
        <div className="hidden lg:block lg:col-span-4">
          <div className="sticky top-10">
            <div className="flex flex-col items-center justify-center gap-4">
            <PhoneFrame
              size="md"
              label="실시간 미리보기"
              liveUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${userName}`}
              contentClassName="bg-white text-slate-900"
            >
              {/* Header Image */}
                <div
                  className="h-40 relative overflow-hidden"
                  style={{
                    background: design.portfolioHeaderColor || 'linear-gradient(to br, #9333ea, #4f46e5)'
                  }}
                >
                  {design.portfolioHeaderImage && (
                    <MediaAuto
                      src={design.portfolioHeaderImage}
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ objectPosition: `center ${design.portfolioHeaderImagePosition || '50'}%` }}
                    />
                  )}
                  <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white via-white/40 to-transparent" />
                </div>

                <div className="pt-4 px-4 text-center space-y-4">
                  <div>
                    <h4 className="text-lg font-black text-slate-900 tracking-tighter">{profile.name}</h4>
                    <p className={`font-black uppercase tracking-[0.3em] ${
                      design.portfolioFontSize === 'small' ? 'text-[8px]' :
                      design.portfolioFontSize === 'large' ? 'text-sm' :
                      'text-[10px]'
                    }`} style={{ color: design.accentColor || '#a855f7' }}>{profile.bio || 'CREATOR & STYLIST'}</p>
                  </div>

                  <div className="flex justify-center gap-2 flex-wrap">
                    {profile.links?.phone?.trim() && <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-bold bg-[#3B82F6] text-white shadow-sm"><Phone size={12} /><span>전화</span></div>}
                    {profile.links?.kakao?.trim() && <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-bold bg-[#FEE500] text-[#3C1E1E] shadow-sm"><MessageCircle size={12} /><span>카카오</span></div>}
                    {profile.links?.youtube?.trim() && <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-bold bg-[#FF0000] text-white shadow-sm"><Youtube size={12} /><span>유튜브</span></div>}
                    {profile.links?.instagram?.trim() && <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-bold text-white shadow-sm" style={{ background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)' }}><Instagram size={12} /><span>인스타</span></div>}
                    {profile.links?.naver?.trim() && <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-bold bg-[#03C75A] text-white shadow-sm"><span className="text-[9px] font-black">N</span><span>네이버</span></div>}
                    {profile.links?.tiktok?.trim() && <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-bold bg-black text-white shadow-sm border border-white/10"><Globe size={12} /><span>틱톡</span></div>}
                    {profile.links?.businessProposal && <div className="flex items-center gap-1 px-3 py-2 rounded-xl text-[9px] font-bold text-white shadow-sm" style={{ backgroundColor: design.accentColor || '#a855f7' }}><Briefcase size={12} /><span>비즈니스 제안</span></div>}
                    {profile.links?.liveNotify && <div className="flex items-center gap-1 px-3 py-2 rounded-xl text-[9px] font-bold bg-emerald-500 text-white shadow-sm"><Bell size={12} /><span>라이브 알림</span></div>}
                  </div>

                  <div className="h-[1px] bg-slate-100 w-full" />

                  {/* Content sections ordered by homePriority */}
                  <div className="flex flex-col w-full">
                  <div style={{ order: design.homePriority === 'portfolio' ? 1 : 2 }}>
                  {/* Dynamic Blocks Preview */}
                  <div className="space-y-3 text-left">
                    {(() => {
                      const visibleBlocks = blocks.filter(Boolean);
                      const categoryDescriptors = collectPortfolioCategories(visibleBlocks);
                      const tabs = [ALL_CATEGORY_LABEL, ...categoryDescriptors.map(c => c.name)];
                      if (categoryDescriptors.length === 0) return null;
                      const activeName = tabs.includes(previewCategory) ? previewCategory : ALL_CATEGORY_LABEL;
                      return (
                        <div className="space-y-3">
                          <div className="overflow-x-auto scrollbar-hide flex gap-1.5">
                            {tabs.map(t => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setPreviewCategory(t)}
                                className={`px-3 py-1.5 rounded-full text-[10px] font-black whitespace-nowrap border transition-all ${
                                  activeName === t
                                    ? 'text-white border-transparent'
                                    : 'bg-white border-slate-200 text-slate-500'
                                }`}
                                style={activeName === t ? { backgroundColor: design.accentColor || '#a855f7' } : undefined}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {groupBlocksForRender(filterPortfolioByCategory(blocks.filter(Boolean), previewCategory)).map((group, gi) => {
                      if (group.kind === 'single') {
                        if (group.block.type === 'category') {
                          return (
                            <div key={group.block.id} className="pt-2 pb-1 space-y-2">
                              <div className="flex items-center gap-2">
                                <Hash size={14} className="text-purple-500 shrink-0" />
                                <h5 className="text-sm font-black text-slate-900 truncate">
                                  {group.block.content || '카테고리'}
                                </h5>
                              </div>
                            </div>
                          );
                        }
                        const pxOnPreview = Math.max(8, Math.round(getBlockFontPx(group.block) * 0.72));
                        return (
                          <div key={group.block.id}>
                            <div
                              className="rounded-2xl border px-3 py-3"
                              style={{
                                backgroundColor: (group.block.highlight && group.block.highlight !== 'transparent') ? group.block.highlight : '#f1f5f9',
                                borderColor: '#e2e8f0',
                              }}
                            >
                              <div
                                className={`whitespace-pre-wrap ${group.block.bold ? 'font-bold' : 'font-medium'}`}
                                style={{
                                  color: group.block.color || '#37352f',
                                  fontSize: `${pxOnPreview}px`,
                                  lineHeight: 1.75,
                                  fontStyle: group.block.italic ? 'italic' : undefined,
                                  textDecoration: getTextDecoration(group.block)
                                }}
                                dangerouslySetInnerHTML={{ __html: renderPortfolioHtml(group.block.content || '') }}
                              />
                            </div>
                          </div>
                        );
                      }

                      const flatImgs: { key: string; src: string; pos?: { x: number; y: number } }[] = group.blocks.flatMap(b =>
                        getBlockImages(b).map((src, i) => ({ key: `${b.id}-${i}`, src, pos: b.imagePositions?.[i] }))
                      );

                      const ImgTile: React.FC<{ src?: string; pos?: { x: number; y: number }; rounded?: string }> = ({ src, pos, rounded = 'rounded-xl' }) => (
                        <div className={`${rounded} overflow-hidden border border-slate-200 bg-slate-50 w-full h-full`}>
                          {src ? <MediaAuto src={src} alt="" className="w-full h-full object-cover" style={pos ? { objectPosition: `${pos.x}% ${pos.y}%` } : undefined} /> : null}
                        </div>
                      );

                      if (group.columns === 3) {
                        const chunks = chunkArray(flatImgs, 3);
                        return (
                          <div key={`grid-${gi}`} className="space-y-1.5">
                            {chunks.map((ck, ci) => (
                              ck.length === 3 ? (
                                <div key={`m-${ci}`} className="grid grid-cols-2 grid-rows-2 gap-1.5 aspect-[4/3]">
                                  <div className="row-span-2 h-full"><ImgTile src={ck[0].src} pos={ck[0].pos} /></div>
                                  <div className="h-full"><ImgTile src={ck[1].src} pos={ck[1].pos} /></div>
                                  <div className="h-full"><ImgTile src={ck[2].src} pos={ck[2].pos} /></div>
                                </div>
                              ) : (
                                <div key={`m-${ci}`} className={`grid gap-1.5 ${ck.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                  {ck.map(b => (
                                    <div key={b.key} className="aspect-square"><ImgTile src={b.src} pos={b.pos} /></div>
                                  ))}
                                </div>
                              )
                            ))}
                          </div>
                        );
                      }

                      if (group.columns === 4) {
                        return (
                          <div key={`grid-${gi}`} className="grid grid-cols-2 gap-1.5">
                            {flatImgs.map(img => (
                              <div key={img.key} className="aspect-square"><ImgTile src={img.src} pos={img.pos} /></div>
                            ))}
                          </div>
                        );
                      }

                      if (group.columns === 2) {
                        return (
                          <div key={`grid-${gi}`} className="grid grid-cols-2 gap-1.5">
                            {flatImgs.map(img => (
                              <div key={img.key} className="aspect-square"><ImgTile src={img.src} pos={img.pos} /></div>
                            ))}
                          </div>
                        );
                      }

                      return (
                        <div key={`grid-${gi}`} className="space-y-1.5">
                          {flatImgs.map(img => (
                            <div key={img.key} className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                              {img.src ? <MediaAuto src={img.src} alt="" className="w-full h-auto object-cover" style={img.pos ? { objectPosition: `${img.pos.x}% ${img.pos.y}%` } : undefined} /> : <div className="aspect-video" />}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  </div>

                  {linkGridBlocks.length > 0 && (
                  <div style={{ order: design.homePriority === 'portfolio' ? 2 : 1 }} className="space-y-2 text-left pt-3">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-[0.5px]" style={{ backgroundColor: design.accentColor || '#a855f7', opacity: 0.3 }}></div>
                      <h4 className="text-[8px] font-black uppercase tracking-[0.15em]" style={{ color: design.accentColor || '#a855f7' }}>My Curations</h4>
                      <div className="flex-1 h-[0.5px]" style={{ backgroundColor: design.accentColor || '#a855f7', opacity: 0.3 }}></div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {linkGridBlocks.map((block: any) => {
                        const pos = block.coverMediaPosition || { x: 50, y: 50 };
                        return (
                          <div key={block.id} className="relative overflow-hidden aspect-square rounded-xl border border-slate-200 bg-slate-50">
                            {block.coverMedia && <MediaAuto src={block.coverMedia} alt="" className="w-full h-full object-cover" style={{ objectPosition: `${pos.x}% ${pos.y}%` }} />}
                            <div className="absolute top-1 right-1">
                              <span className="bg-black/60 backdrop-blur-md text-[6px] font-black px-1 py-0.5 rounded text-white">{block.products?.length || 0}</span>
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                              <div className="text-[6px] font-black truncate text-white uppercase tracking-tight">{block.title}</div>
                              <div className="text-[5px] font-bold text-white/50 uppercase tracking-widest mt-0.5">{block.category}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}
                  </div>

                </div>
            </PhoneFrame>
            {/* Save Button - next to phone preview */}
            <div className="flex flex-row items-center gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="bg-purple-600 text-white px-6 py-3 rounded-2xl font-black flex flex-row items-center justify-center gap-2 hover:bg-purple-700 transition-all shadow-2xl shadow-purple-200 disabled:opacity-50 whitespace-nowrap"
              >
                {isSaving ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save className="w-5 h-5" />
                )}
                <span className="text-sm">저장하기</span>
              </button>
              {saveMessage && (
                <span className={`${saveSuccess ? 'text-emerald-500' : 'text-red-500'} font-black text-[10px] max-w-[120px] animate-in fade-in`}>
                  {saveMessage}
                </span>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>
      <Toast
        message={saveMessage}
        isVisible={showToast}
        onClose={() => setShowToast(false)}
        type={saveSuccess ? 'success' : 'error'}
      />
    </div>
  );
};

export default PortfolioManagement;
