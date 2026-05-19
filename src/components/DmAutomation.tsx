import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  MessageSquare, Bot, Zap, Settings, CheckCircle2, AlertCircle,
  Save, Plus, Search, ChevronDown, ChevronRight,
  Send, Image, Type, MessageCircle, BarChart3, Eye, Clock,
  Trash2, Edit3, Copy, Smartphone, Users,
  TrendingUp, RefreshCw,
  Play, Pause, Layers, Upload, X, Grid3X3,
  Instagram, Unlink, Loader2, Shield
} from 'lucide-react';
import Toast from './Toast';
import { supabase } from '../services/supabase';

interface DMAutomationProps {
  userName: string;
}

interface InstagramAccount {
  connected: boolean;
  instagram_username?: string;
  instagram_user_id?: string;
  connected_at?: string;
}

// Simplified navigation - only 3 tabs
type DMTab = 'post-reels' | 'story' | 'data';
type MaterialView = 'list' | 'add';

interface Material {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'draft';
  keywords: string[];
  excludeKeywords: string[];
  postCondition: string;
  scheduledSend: boolean;
  createdAt: string;
  updatedAt: string;
  // DB fields (optional for backward compat)
  message_type?: string;
  message_content?: string;
  dm_keyword?: string;
  dm_body_template?: string;
  send_condition?: string;
}

// Default stats (used as fallback when DB returns nothing)
const DEFAULT_STATS = {
  totalSent: 1247,
  todaySent: 42,
  clickRate: 34.5,
  responseRate: 98,
  savedHours: 12.5,
  conversionRate: 8.2,
  weeklyData: [
    { day: '월', sent: 156, clicks: 52 },
    { day: '화', sent: 189, clicks: 68 },
    { day: '수', sent: 201, clicks: 74 },
    { day: '목', sent: 178, clicks: 61 },
    { day: '금', sent: 223, clicks: 89 },
    { day: '토', sent: 145, clicks: 48 },
    { day: '일', sent: 155, clicks: 53 },
  ],
};

const INITIAL_FORM_DATA = {
  materialName: '',
  sendCondition: 'all',
  keywordFilterEnabled: true,
  includeKeywords: '',
  excludeKeywords: '',
  dmKeywordEnabled: true,
  dmKeyword: '',
  dmBodyTemplate: 'DM을 받지 못하신 분들은 "{DM 키워드}" 키워드를 저에게 직접 DM으로 보내주세요!',
  followerDistinction: false,
  commentReply: false,
  defaultMessageEnabled: false,
  messageType: 'text' as 'text' | 'image' | 'carousel' | 'question',
  messageContent: '',
  scheduledSend: false,
  scheduledDate: '',
  selectedPosts: [] as { id: string; imageUrl: string; caption: string }[],
  uploadedImages: [] as { id: string; name: string; url: string }[],
};

// Dummy Instagram posts for "선택된 게시물"
const DUMMY_INSTAGRAM_POSTS = [
  { id: 'post-1', imageUrl: '', caption: '봄 신상 코디 추천! 🌸 #패션 #봄코디', likes: 342, comments: 28 },
  { id: 'post-2', imageUrl: '', caption: '오늘의 OOTD 💫 데일리룩 공유', likes: 518, comments: 45 },
  { id: 'post-3', imageUrl: '', caption: '신상 가방 리뷰 👜 #가방추천', likes: 267, comments: 19 },
  { id: 'post-4', imageUrl: '', caption: '여름 준비! 선크림 TOP3 ☀️', likes: 891, comments: 72 },
  { id: 'post-5', imageUrl: '', caption: '주말 브런치 카페 추천 🥐', likes: 445, comments: 33 },
  { id: 'post-6', imageUrl: '', caption: '네일아트 디자인 모음 💅', likes: 623, comments: 51 },
];

// Recommended templates by industry
const RECOMMENDED_TEMPLATES = [
  {
    id: 'template-fashion',
    name: '패션/의류 쇼핑몰',
    description: '패션 상품 링크 및 구매 안내',
    materialName: '패션 상품 자동 안내',
    keywords: ['구매', '링크', '가격', '사이즈', '착샷'],
    excludeKeywords: ['환불', '교환'],
    sendCondition: 'all',
    messageContent: '안녕하세요! 😊 관심 가져주셔서 감사합니다.\n\n상품 상세 정보와 구매 링크를 보내드릴게요!\n👇 아래 링크를 확인해주세요.',
    dmKeyword: '구매',
  },
  {
    id: 'template-beauty',
    name: '뷰티/화장품',
    description: '뷰티 제품 추천 및 리뷰 안내',
    materialName: '뷰티 제품 자동 안내',
    keywords: ['추천', '리뷰', '성분', '가격', '구매'],
    excludeKeywords: ['부작용'],
    sendCondition: 'all',
    messageContent: '안녕하세요! 💄 문의해 주셔서 감사합니다.\n\n해당 제품의 상세 리뷰와 구매 링크를 보내드릴게요!\n사용 후기도 함께 확인해보세요 ✨',
    dmKeyword: '추천',
  },
  {
    id: 'template-food',
    name: '맛집/카페/음식',
    description: '맛집 위치 및 예약 안내',
    materialName: '맛집 정보 자동 안내',
    keywords: ['위치', '예약', '메뉴', '가격', '영업시간'],
    excludeKeywords: [],
    sendCondition: 'all',
    messageContent: '안녕하세요! 🍽️ 관심 가져주셔서 감사합니다.\n\n매장 위치와 메뉴 정보를 안내해드릴게요!\n예약은 아래 링크에서 가능합니다 😊',
    dmKeyword: '예약',
  },
  {
    id: 'template-education',
    name: '교육/강의/클래스',
    description: '강의 및 클래스 수강 안내',
    materialName: '클래스 수강 자동 안내',
    keywords: ['수강', '신청', '가격', '커리큘럼', '후기'],
    excludeKeywords: ['환불'],
    sendCondition: 'all',
    messageContent: '안녕하세요! 📚 관심 가져주셔서 감사합니다.\n\n수강 안내와 커리큘럼 상세 정보를 보내드릴게요!\n지금 등록하시면 특별 혜택이 있습니다 🎁',
    dmKeyword: '수강',
  },
];

const DMAutomation: React.FC<DMAutomationProps> = ({ userName }) => {
  const [activeTab, setActiveTab] = useState<DMTab>('post-reels');
  const [materialView, setMaterialView] = useState<MaterialView>('list');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState<(() => void) | null>(null);

  // Instagram connection state
  const [igAccount, setIgAccount] = useState<InstagramAccount>({ connected: false });
  const [igLoading, _setIgLoading] = useState(false);
  const [igConnecting, setIgConnecting] = useState(false);

  // Real stats from DB
  const [realStats, setRealStats] = useState(DEFAULT_STATS);

  const [formData, setFormData] = useState({ ...INITIAL_FORM_DATA });

  const [expandedSections, setExpandedSections] = useState({
    sendCondition: true,
    keywordFilter: true,
    dmKeyword: true,
    follower: false,
    commentReply: false,
  });

  // Get Supabase auth user id
  const [authUserId, setAuthUserId] = useState<string>('');

  useEffect(() => {
    if (!supabase) {
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setAuthUserId(data.user.id);
      }
    }).catch(() => {});
  }, []);

  // Load materials from DB
  useEffect(() => {
    if (!authUserId) return;
    fetch(`/api/dm-materials?user_id=${authUserId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const mapped: Material[] = data.map((d: any) => ({
            id: d.id,
            name: d.name,
            status: d.status || 'draft',
            keywords: d.keywords || [],
            excludeKeywords: d.exclude_keywords || [],
            postCondition: d.post_condition || '모든 게시물과 릴스',
            scheduledSend: d.scheduled_send || false,
            createdAt: d.created_at ? new Date(d.created_at).toLocaleString('ko-KR') : '',
            updatedAt: d.updated_at ? new Date(d.updated_at).toLocaleString('ko-KR') : '',
            message_type: d.message_type,
            message_content: d.message_content,
            dm_keyword: d.dm_keyword,
            dm_body_template: d.dm_body_template,
            send_condition: d.send_condition,
          }));
          setMaterials(mapped);
        }
      })
      .catch(err => console.error('Failed to load materials:', err));
  }, [authUserId]);

  // Load stats from DB
  useEffect(() => {
    if (!authUserId) return;
    fetch(`/api/dm-stats?user_id=${authUserId}`)
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setRealStats(data);
        }
      })
      .catch(() => {});
  }, [authUserId]);

  // Listen for Instagram OAuth callback (popup window)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'instagram-auth') {
        setIgConnecting(false);
        if (event.data.status === 'success') {
          toast(event.data.message || 'Instagram 연동 성공!');
          // Refresh connection status
          if (authUserId) {
            fetch(`/api/instagram-auth?action=status&user_id=${authUserId}`)
              .then(res => res.json())
              .then(data => setIgAccount(data));
          }
        } else {
          toast(event.data.message || 'Instagram 연동에 실패했습니다.');
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [authUserId]);

  // Also check URL params for non-popup callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const igStatus = params.get('ig_status');
    const igMessage = params.get('ig_message');
    if (igStatus) {
      toast(igMessage ? decodeURIComponent(igMessage) : (igStatus === 'success' ? '연동 성공!' : '연동 실패'));
      window.history.replaceState({}, '', window.location.pathname);
      if (igStatus === 'success' && authUserId) {
        fetch(`/api/instagram-auth?action=status&user_id=${authUserId}`)
          .then(res => res.json())
          .then(data => setIgAccount(data));
      }
    }
  }, [authUserId]);

  const handleInstagramLogin = () => {
    if (!authUserId) {
      toast('먼저 로그인해주세요.');
      return;
    }
    setIgConnecting(true);
    const authUrl = `/api/instagram-auth?action=login&user_id=${authUserId}`;
    const w = 600, h = 700;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(authUrl, 'instagram-auth', `width=${w},height=${h},left=${left},top=${top}`);

    // Fallback: if popup blocked, redirect in same window
    if (!popup || popup.closed) {
      window.location.href = authUrl;
    }
  };

  const handleInstagramDisconnect = async () => {
    if (!authUserId) return;
    if (!confirm('Instagram 계정 연동을 해제하시겠습니까?')) return;

    const res = await fetch(`/api/instagram-auth?action=disconnect&user_id=${authUserId}`);
    const data = await res.json();
    if (data.success) {
      setIgAccount({ connected: false });
      toast('Instagram 연동이 해제되었습니다.');
    }
  };

  const toast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
  };

  // Track form changes for dirty check
  const handleFormDataChange = useCallback((updater: any) => {
    setFormData(updater);
    setIsFormDirty(true);
  }, []);

  // Confirm navigation away from editing
  const confirmLeave = useCallback((action: () => void) => {
    if (isFormDirty && materialView === 'add') {
      setShowLeaveConfirm(() => action);
    } else {
      action();
    }
  }, [isFormDirty, materialView]);

  const handleTabClick = (tab: DMTab) => {
    const doSwitch = () => {
      setActiveTab(tab);
      setMaterialView('list');
      setEditingMaterialId(null);
      setIsFormDirty(false);
    };
    confirmLeave(doSwitch);
  };

  // Browser beforeunload warning
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isFormDirty && materialView === 'add') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isFormDirty, materialView]);

  const handleDeleteMaterial = async (id: string) => {
    // Delete from DB
    if (authUserId) {
      try {
        await fetch(`/api/dm-materials?id=${id}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
    setMaterials(prev => prev.filter(m => m.id !== id));
    setShowDeleteConfirm(null);
    toast('소재가 삭제되었습니다.');
  };

  const handleEditMaterial = (material: Material) => {
    setEditingMaterialId(material.id);
    setFormData({
      ...INITIAL_FORM_DATA,
      materialName: material.name,
      includeKeywords: material.keywords.join(', '),
      excludeKeywords: material.excludeKeywords.join(', '),
      sendCondition: material.postCondition === '모든 게시물과 릴스' ? 'all' :
        material.postCondition === '선택된 게시물' ? 'selected' :
        material.postCondition === '최근 릴스만' ? 'reels-only' : 'all',
      scheduledSend: material.scheduledSend,
    });
    setMaterialView('add');
  };

  const handleSaveMaterial = async () => {
    if (!formData.materialName.trim()) {
      toast('소재명을 입력해주세요.');
      return;
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const postConditionMap: Record<string, string> = {
      'all': '모든 게시물과 릴스',
      'posts-only': '게시물만',
      'reels-only': '최근 릴스만',
      'selected': '선택된 게시물',
    };

    const keywordsArr = formData.includeKeywords ? formData.includeKeywords.split(',').map(k => k.trim()).filter(Boolean) : [];
    const excludeArr = formData.excludeKeywords ? formData.excludeKeywords.split(',').map(k => k.trim()).filter(Boolean) : [];

    // Save to DB
    if (authUserId) {
      try {
        const payload: any = {
          user_id: authUserId,
          name: formData.materialName,
          status: editingMaterialId ? undefined : 'draft',
          keywords: keywordsArr,
          exclude_keywords: excludeArr,
          post_condition: postConditionMap[formData.sendCondition] || '모든 게시물과 릴스',
          send_condition: formData.sendCondition,
          scheduled_send: formData.scheduledSend,
          message_type: formData.messageType,
          message_content: formData.messageContent,
          dm_keyword: formData.dmKeyword,
          dm_body_template: formData.dmBodyTemplate,
        };
        if (editingMaterialId) {
          payload.id = editingMaterialId;
          // Remove undefined status
          delete payload.status;
        }

        const res = await fetch('/api/dm-materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();

        if (Array.isArray(result) && result.length > 0) {
          const saved = result[0];
          const mapped: Material = {
            id: saved.id,
            name: saved.name,
            status: saved.status || 'draft',
            keywords: saved.keywords || [],
            excludeKeywords: saved.exclude_keywords || [],
            postCondition: saved.post_condition || '모든 게시물과 릴스',
            scheduledSend: saved.scheduled_send || false,
            createdAt: saved.created_at ? new Date(saved.created_at).toLocaleString('ko-KR') : dateStr,
            updatedAt: saved.updated_at ? new Date(saved.updated_at).toLocaleString('ko-KR') : dateStr,
            message_type: saved.message_type,
            message_content: saved.message_content,
            dm_keyword: saved.dm_keyword,
            dm_body_template: saved.dm_body_template,
            send_condition: saved.send_condition,
          };

          if (editingMaterialId) {
            setMaterials(prev => prev.map(m => m.id === editingMaterialId ? mapped : m));
            toast('소재가 수정되었습니다!');
          } else {
            setMaterials(prev => [...prev, mapped]);
            toast('소재가 성공적으로 저장되었습니다!');
          }
        }
      } catch (err) {
        console.error('Save error:', err);
        toast('저장 중 오류가 발생했습니다.');
      }
    } else {
      // Fallback: local-only save
      if (editingMaterialId) {
        setMaterials(prev => prev.map(m => m.id === editingMaterialId ? {
          ...m,
          name: formData.materialName,
          keywords: keywordsArr.length ? keywordsArr : m.keywords,
          excludeKeywords: excludeArr,
          postCondition: postConditionMap[formData.sendCondition] || '모든 게시물과 릴스',
          scheduledSend: formData.scheduledSend,
          updatedAt: dateStr,
        } : m));
        toast('소재가 수정되었습니다!');
      } else {
        const newId = `MAT-${String(materials.length + 1).padStart(3, '0')}`;
        const newMaterial: Material = {
          id: newId,
          name: formData.materialName,
          status: 'draft',
          keywords: keywordsArr,
          excludeKeywords: excludeArr,
          postCondition: postConditionMap[formData.sendCondition] || '모든 게시물과 릴스',
          scheduledSend: formData.scheduledSend,
          createdAt: dateStr,
          updatedAt: dateStr,
        };
        setMaterials(prev => [...prev, newMaterial]);
        toast('소재가 성공적으로 저장되었습니다!');
      }
    }

    setEditingMaterialId(null);
    setMaterialView('list');
    setFormData({ ...INITIAL_FORM_DATA });
    setIsFormDirty(false);
  };

  const handleApplyTemplate = (template: typeof RECOMMENDED_TEMPLATES[0]) => {
    setFormData({
      ...INITIAL_FORM_DATA,
      materialName: template.materialName,
      includeKeywords: template.keywords.join(', '),
      excludeKeywords: template.excludeKeywords.join(', '),
      sendCondition: template.sendCondition,
      messageContent: template.messageContent,
      dmKeyword: template.dmKeyword,
    });
    setShowTemplateModal(false);
    setMaterialView('add');
    toast(`"${template.name}" 템플릿이 적용되었습니다!`);
  };

  const handleToggleMaterialStatus = async (id: string) => {
    const material = materials.find(m => m.id === id);
    if (!material) return;
    const nextStatus = material.status === 'active' ? 'paused' : 'active';

    // Update in DB
    if (authUserId) {
      try {
        await fetch('/api/dm-materials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            user_id: authUserId,
            name: material.name,
            status: nextStatus,
          }),
        });
      } catch (err) {
        console.error('Status toggle error:', err);
      }
    }

    setMaterials(prev => prev.map(m => {
      if (m.id !== id) return m;
      return { ...m, status: nextStatus };
    }));
    toast('상태가 변경되었습니다.');
  };

  const handleDuplicateMaterial = (material: Material) => {
    const newId = `MAT-${String(materials.length + 1).padStart(3, '0')}`;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const duplicate: Material = {
      ...material,
      id: newId,
      name: `${material.name} (복사)`,
      status: 'draft',
      createdAt: dateStr,
      updatedAt: dateStr,
    };
    setMaterials(prev => [...prev, duplicate]);
    toast('소재가 복사되었습니다.');
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section as keyof typeof prev] }));
  };

  const tabs = [
    { id: 'post-reels' as DMTab, label: '게시물/릴스 댓글 답장', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'story' as DMTab, label: '스토리 답장', icon: <Layers className="w-4 h-4" /> },
    { id: 'data' as DMTab, label: '데이터 인사이트', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  // Show full-screen connection gate when Instagram is not connected
  if (igLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-[#f8fafc] animate-in fade-in duration-500 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500 mb-4" />
        <span className="text-sm font-medium text-slate-500">연동 확인 중...</span>
      </div>
    );
  }

  if (!igAccount.connected) {
    return (
      <div className="flex flex-col min-h-screen bg-[#f8fafc] animate-in fade-in duration-500">
        <InstagramConnectScreen
          igConnecting={igConnecting}
          onLogin={handleInstagramLogin}
        />
        <Toast message={toastMessage} isVisible={showToast} onClose={() => setShowToast(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#f8fafc] animate-in fade-in duration-500">
      {/* Instagram Connection Banner (connected state) */}
      <InstagramConnectionBanner
        igAccount={igAccount}
        igLoading={igLoading}
        igConnecting={igConnecting}
        onLogin={handleInstagramLogin}
        onDisconnect={handleInstagramDisconnect}
      />

      {/* Top Header Bar */}
      <div className="bg-white border-b border-slate-100 px-4 md:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-black text-slate-900">인스타그램 자동 DM</h1>
              <p className="text-[10px] md:text-xs text-slate-400 font-medium">
                <span className="text-emerald-500">@{igAccount.instagram_username} 계정 연동됨</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              isEnabled
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                : 'bg-slate-100 text-slate-400 border border-slate-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              <span className="hidden md:inline">{isEnabled ? '자동화 활성화됨' : '자동화 비활성'}</span>
            </div>
            <button
              onClick={() => setIsEnabled(!isEnabled)}
              className={`p-2 rounded-xl transition-all ${
                isEnabled ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' : 'bg-slate-200 text-slate-500'
              }`}
            >
              {isEnabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Horizontal Tab Navigation */}
      <div className="bg-white border-b border-slate-100 px-4 md:px-8">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                activeTab === tab.id
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-200'
              }`}
            >
              <span className={activeTab === tab.id ? 'text-purple-600' : 'text-slate-400'}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content - Full Width */}
      <main className="flex-1 min-w-0">
        {activeTab === 'data' ? (
          <DataAnalysisView stats={realStats} />
        ) : activeTab === 'story' ? (
          <StoryReplyView userName={userName} onToast={toast} />
        ) : materialView === 'add' ? (
          <MaterialAddView
            formData={formData}
            setFormData={handleFormDataChange}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            onSave={handleSaveMaterial}
            onCancel={() => {
              confirmLeave(() => {
                setMaterialView('list');
                setEditingMaterialId(null);
                setFormData({ ...INITIAL_FORM_DATA });
                setIsFormDirty(false);
              });
            }}
            userName={userName}
            isEditing={!!editingMaterialId}
          />
        ) : (
          <MaterialListView
            materials={materials}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onAddMaterial={() => { setEditingMaterialId(null); setFormData({ ...INITIAL_FORM_DATA }); setMaterialView('add'); }}
            onToast={toast}
            onDeleteMaterial={(id) => setShowDeleteConfirm(id)}
            onEditMaterial={handleEditMaterial}
            onToggleStatus={handleToggleMaterialStatus}
            onDuplicateMaterial={handleDuplicateMaterial}
            onShowTemplates={() => setShowTemplateModal(true)}
          />
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(null)} />
          <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6 text-red-500" />
            </div>
            <h3 className="text-lg font-black text-slate-900 text-center mb-2">소재 삭제</h3>
            <p className="text-sm text-slate-500 text-center mb-6">이 소재를 삭제하시겠습니까?<br />삭제된 소재는 복구할 수 없습니다.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-all"
              >
                취소
              </button>
              <button
                onClick={() => handleDeleteMaterial(showDeleteConfirm)}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition-all"
              >
                삭제하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Confirmation Modal */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowLeaveConfirm(null)} />
          <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6 text-amber-500" />
            </div>
            <h3 className="text-lg font-black text-slate-900 text-center mb-2">페이지를 나가시겠습니까?</h3>
            <p className="text-sm text-slate-500 text-center mb-6">작성 중인 내용이 저장되지 않았습니다.<br />저장하지 않고 나가시겠습니까?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLeaveConfirm(null)}
                className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm hover:bg-slate-200 transition-all"
              >
                계속 편집
              </button>
              <button
                onClick={() => {
                  const action = showLeaveConfirm;
                  setShowLeaveConfirm(null);
                  setIsFormDirty(false);
                  action();
                }}
                className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-bold text-sm hover:bg-amber-600 transition-all"
              >
                나가기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowTemplateModal(false)} />
          <div className="relative bg-white rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-black text-slate-900">추천 템플릿</h3>
                <p className="text-xs text-slate-400 font-medium mt-1">업종에 맞는 템플릿을 선택하여 빠르게 시작하세요.</p>
              </div>
              <button onClick={() => setShowTemplateModal(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 transition-all">
                <span className="text-lg">&times;</span>
              </button>
            </div>
            <div className="space-y-3">
              {RECOMMENDED_TEMPLATES.map((template) => (
                <div key={template.id} className="border border-slate-100 rounded-xl p-4 hover:border-purple-300 hover:bg-purple-50/30 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-black text-slate-900">{template.name}</h4>
                    <button
                      onClick={() => handleApplyTemplate(template)}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black hover:bg-purple-700 transition-all"
                    >
                      사용하기
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mb-2">{template.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {template.keywords.map(k => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[9px] font-bold">{k}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Toast message={toastMessage} isVisible={showToast} onClose={() => setShowToast(false)} />
    </div>
  );
};

// ============================================================
// Instagram Connect Screen (Full-page gate when not connected)
// ============================================================

const InstagramConnectScreen: React.FC<{
  igConnecting: boolean;
  onLogin: () => void;
}> = ({ igConnecting, onLogin }) => {
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full text-center">
        {/* Instagram Gradient Icon */}
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-purple-300/50">
          <Instagram className="w-12 h-12 text-white" />
        </div>

        {/* Title */}
        <h2 className="text-2xl md:text-3xl font-black text-slate-900 mb-3">
          인스타그램 연동
        </h2>
        <p className="text-sm md:text-base text-slate-500 font-medium mb-8">
          인스타그램 계정을 연동하여 자동 DM 기능을 사용하세요.
        </p>

        {/* Instagram Login Button */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600 font-medium text-center">
              아래 버튼을 누르면 Instagram 공식 로그인 페이지가 열립니다.<br />
              Instagram에 직접 로그인하여 안전하게 계정을 연동할 수 있습니다.
            </p>

            <button
              onClick={onLogin}
              disabled={igConnecting}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500 text-white text-sm font-black hover:scale-[1.02] hover:shadow-xl transition-all shadow-lg shadow-purple-300/40 disabled:opacity-50 disabled:hover:scale-100"
            >
              {igConnecting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  연동 중...
                </>
              ) : (
                <>
                  <Instagram className="w-5 h-5" />
                  Instagram으로 로그인하여 연동하기
                </>
              )}
            </button>

            <div className="flex items-center gap-2 justify-center">
              <Shield className="w-3.5 h-3.5 text-green-500" />
              <p className="text-[10px] text-slate-400">
                Instagram 공식 인증 페이지에서 직접 로그인하므로 비밀번호가 안전하게 보호됩니다.
              </p>
            </div>
          </div>
        </div>

        {/* Feature Preview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="w-5 h-5 text-purple-600" />
            </div>
            <h4 className="text-xs font-black text-slate-800 mb-1">댓글 자동 DM</h4>
            <p className="text-[10px] text-slate-500">게시물/릴스 댓글에 자동으로 DM을 발송합니다</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center mx-auto mb-3">
              <Zap className="w-5 h-5 text-pink-600" />
            </div>
            <h4 className="text-xs font-black text-slate-800 mb-1">키워드 자동 응답</h4>
            <p className="text-[10px] text-slate-500">특정 키워드가 포함된 DM에 자동 응답합니다</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center mx-auto mb-3">
              <BarChart3 className="w-5 h-5 text-orange-600" />
            </div>
            <h4 className="text-xs font-black text-slate-800 mb-1">데이터 인사이트</h4>
            <p className="text-[10px] text-slate-500">DM 발송 현황과 클릭률을 분석합니다</p>
          </div>
        </div>

        {/* Prerequisites */}
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-6 text-left">
          <h4 className="text-xs font-black text-amber-800 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            연동 전 확인사항
          </h4>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">1</span>
              <span className="text-[11px] text-amber-700 font-medium">Instagram 계정이 <strong>비즈니스</strong> 또는 <strong>크리에이터</strong> 계정이어야 합니다</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">2</span>
              <span className="text-[11px] text-amber-700 font-medium"><strong>Facebook 페이지</strong>가 필요하며, Instagram 계정과 연결되어 있어야 합니다</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-800 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">3</span>
              <span className="text-[11px] text-amber-700 font-medium">Meta Developer 앱 설정이 완료되어 있어야 합니다</span>
            </li>
          </ul>
        </div>

        {/* Setup Guide Toggle */}
        <button
          onClick={() => setShowSetupGuide(!showSetupGuide)}
          className="inline-flex items-center gap-2 text-xs font-bold text-purple-600 hover:text-purple-700 transition-colors mb-4"
        >
          <Settings className="w-4 h-4" />
          {showSetupGuide ? '설정 가이드 닫기' : 'Meta Developer 설정 가이드 보기'}
          {showSetupGuide ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {/* Setup Guide Content */}
        {showSetupGuide && (
          <div className="bg-white rounded-2xl border border-purple-100 p-5 text-left shadow-sm">
            <h4 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4 text-purple-600" />
              Meta Developer 설정 가이드
            </h4>

            {/* Step 1 */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center">1</span>
                <h5 className="text-xs font-black text-slate-800">Meta Developer 계정 및 앱 생성</h5>
              </div>
              <div className="ml-8 space-y-1">
                <p className="text-[11px] text-slate-600">
                  <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 underline font-bold">developers.facebook.com</a> 접속 → 로그인
                </p>
                <p className="text-[11px] text-slate-600">"내 앱" → "앱 만들기" 클릭</p>
                <p className="text-[11px] text-slate-600">앱 유형: <strong>"비즈니스"</strong> 선택</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-pink-500 text-white text-[10px] font-black flex items-center justify-center">2</span>
                <h5 className="text-xs font-black text-slate-800">제품 추가 (3개 필수)</h5>
              </div>
              <div className="ml-8 space-y-1">
                <p className="text-[11px] text-slate-600">앱 대시보드 왼쪽 메뉴에서 <strong>"제품 추가"</strong> 클릭 후 아래 3개 모두 설정:</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-[10px] font-bold text-blue-700">Facebook 로그인</span>
                  <span className="px-2 py-0.5 bg-purple-50 border border-purple-200 rounded text-[10px] font-bold text-purple-700">Instagram</span>
                  <span className="px-2 py-0.5 bg-pink-50 border border-pink-200 rounded text-[10px] font-bold text-pink-700">Messenger</span>
                </div>
                <p className="text-[10px] text-red-500 font-bold mt-1">* "Facebook 로그인" 제품이 반드시 추가되어야 OAuth가 작동합니다!</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-[10px] font-black flex items-center justify-center">3</span>
                <h5 className="text-xs font-black text-slate-800">앱 기본 설정 (Settings → Basic)</h5>
              </div>
              <div className="ml-8 space-y-1.5">
                <p className="text-[11px] text-slate-600">왼쪽 메뉴 <strong>"설정"</strong> → <strong>"기본"</strong>에서:</p>
                <p className="text-[11px] text-slate-600">1. <strong>"앱 도메인"</strong>에 추가:</p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 mt-0.5">
                  <code className="text-[11px] text-purple-700 font-mono">picks-folio.com</code>
                </div>
                <p className="text-[11px] text-slate-600">2. 페이지 하단 <strong>"+ 플랫폼 추가"</strong> → <strong>"웹사이트"</strong> 선택 후 사이트 URL 입력:</p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 mt-0.5">
                  <code className="text-[11px] text-purple-700 font-mono">https://picks-folio.com</code>
                </div>
                <p className="text-[11px] text-slate-600">3. <strong>"변경 내용 저장"</strong> 클릭</p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-indigo-500 text-white text-[10px] font-black flex items-center justify-center">4</span>
                <h5 className="text-xs font-black text-slate-800">Facebook 로그인 → OAuth 리디렉션 URI 등록</h5>
              </div>
              <div className="ml-8 space-y-1.5">
                <p className="text-[11px] text-slate-600">왼쪽 메뉴 <strong>"Facebook 로그인"</strong> → <strong>"설정"</strong>에서:</p>
                <p className="text-[11px] text-slate-600">1. <strong>"유효한 OAuth 리디렉션 URI"</strong>에 아래 주소 추가:</p>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-0.5">
                  <code className="text-[11px] text-purple-700 font-mono break-all">
                    https://picks-folio.com/api/instagram-callback
                  </code>
                </div>
                <p className="text-[11px] text-slate-600">2. <strong>"변경 내용 저장"</strong> 클릭</p>
                <p className="text-[10px] text-red-500 font-bold mt-1">* URI가 정확히 일치해야 합니다. 끝에 / 를 넣지 마세요!</p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-teal-500 text-white text-[10px] font-black flex items-center justify-center">5</span>
                <h5 className="text-xs font-black text-slate-800">권한(Permissions) 설정</h5>
              </div>
              <div className="ml-8 space-y-1">
                <p className="text-[11px] text-slate-600">"앱 검수" → "권한 및 기능"에서 아래 권한 요청:</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <span className="px-2 py-0.5 bg-purple-50 border border-purple-200 rounded text-[10px] font-bold text-purple-700">instagram_basic</span>
                  <span className="px-2 py-0.5 bg-purple-50 border border-purple-200 rounded text-[10px] font-bold text-purple-700">instagram_manage_messages</span>
                  <span className="px-2 py-0.5 bg-purple-50 border border-purple-200 rounded text-[10px] font-bold text-purple-700">instagram_manage_comments</span>
                </div>
                <p className="text-[10px] text-amber-600 font-bold mt-1">* 개발 모드에서는 앱에 등록된 테스터만 로그인 가능합니다. "역할" 메뉴에서 테스터를 추가하세요.</p>
              </div>
            </div>

            {/* Step 6 - Test User */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">6</span>
                <h5 className="text-xs font-black text-slate-800">테스터 추가 (개발 모드인 경우)</h5>
              </div>
              <div className="ml-8 space-y-1">
                <p className="text-[11px] text-slate-600">왼쪽 메뉴 <strong>"앱 역할"</strong> → <strong>"역할"</strong>에서:</p>
                <p className="text-[11px] text-slate-600"><strong>"테스터 추가"</strong> → 로그인할 Facebook 계정 추가</p>
                <p className="text-[11px] text-slate-600">초대받은 사용자가 Facebook 알림에서 수락해야 합니다.</p>
              </div>
            </div>

            {/* Final Note */}
            <div className="mt-4 p-3 bg-purple-50 border border-purple-100 rounded-xl space-y-2">
              <p className="text-[11px] text-purple-700 font-bold">모든 설정을 완료한 후 위의 "Instagram으로 로그인하여 연동하기" 버튼을 클릭하세요!</p>
              <p className="text-[10px] text-purple-600">"URL이 차단됨" 또는 "유효하지 않음" 오류가 나오면: 3단계(앱 도메인)와 4단계(리디렉션 URI) 설정을 다시 확인해주세요.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Instagram Connection Banner (shown when already connected)
// ============================================================

const InstagramConnectionBanner: React.FC<{
  igAccount: InstagramAccount;
  igLoading: boolean;
  igConnecting: boolean;
  onLogin: () => void;
  onDisconnect: () => void;
}> = ({ igAccount, onDisconnect }) => {
  // This banner is only rendered when connected (loading/not-connected are handled by parent)
  return (
    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 px-4 md:px-8 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
            <Instagram className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-emerald-700">Instagram 연동됨</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <p className="text-[10px] text-emerald-600 font-medium">
              @{igAccount.instagram_username} · 연동일: {igAccount.connected_at ? new Date(igAccount.connected_at).toLocaleDateString('ko-KR') : '-'}
            </p>
          </div>
        </div>
        <button
          onClick={onDisconnect}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 text-[10px] font-bold hover:border-red-300 hover:text-red-500 transition-all"
        >
          <Unlink className="w-3 h-3" />
          연동 해제
        </button>
      </div>
    </div>
  );
};

// ============================================================
// (Sidebar and MobileTab components removed - using horizontal tabs now)
// ============================================================

// ============================================================
// Material List View
// ============================================================

const MaterialListView: React.FC<{
  materials: Material[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onAddMaterial: () => void;
  onToast: (msg: string) => void;
  onDeleteMaterial: (id: string) => void;
  onEditMaterial: (material: Material) => void;
  onToggleStatus: (id: string) => void;
  onDuplicateMaterial: (material: Material) => void;
  onShowTemplates: () => void;
}> = ({ materials, searchQuery, setSearchQuery, onAddMaterial, onDeleteMaterial, onEditMaterial, onToggleStatus, onDuplicateMaterial, onShowTemplates }) => {
  const getTitle = () => {
    return '게시물/릴스 댓글 답장';
  };

  const filteredMaterials = materials.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8">
      {/* Page Title */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-6 bg-purple-600 rounded-full" />
        <h2 className="text-lg md:text-2xl font-black text-slate-900">{getTitle()}</h2>
        <button className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-black">?</button>
      </div>
      <p className="text-xs text-slate-400 font-medium mb-6 ml-3">
        인스타그램 게시물과 릴스에 댓글을 남긴 고객에게 자동 응답 메시지를 보내보세요.
      </p>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-xl p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-purple-600" />
          <span className="text-xs font-bold text-purple-700">메시지 설정이 어려우신가요? 업종 별 추천 템플릿을 사용해보세요!</span>
        </div>
        <button onClick={onShowTemplates} className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black hover:bg-purple-700 transition-all whitespace-nowrap">
          추천 템플릿 사용하기
        </button>
      </div>

      {/* Tab & Actions Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex gap-2">
          <button
            onClick={onAddMaterial}
            className="px-5 py-2.5 rounded-xl bg-purple-600 text-white text-xs font-black hover:bg-purple-700 transition-all shadow-md shadow-purple-200 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> 소재 추가
          </button>
          <button className="px-5 py-2.5 rounded-xl bg-purple-50 text-purple-600 text-xs font-bold border border-purple-200 transition-all cursor-default">
            소재 목록
          </button>
        </div>
        <div className="flex items-center gap-2">
          <select className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 bg-white focus:outline-none focus:border-purple-400">
            <option>소재명</option>
            <option>소재ID</option>
            <option>키워드</option>
          </select>
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Materials Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Table Header */}
        <div className="hidden md:grid grid-cols-[40px_80px_100px_1fr_160px_120px_100px_130px_130px_80px] gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-wider">
          <div className="flex items-center"><input type="checkbox" className="w-3.5 h-3.5 rounded" /></div>
          <div>게시 상태</div>
          <div>소재ID</div>
          <div>소재명</div>
          <div>키워드 (포함/제외)</div>
          <div>게시물 조건</div>
          <div>예약발송</div>
          <div>등록일시</div>
          <div>업데이트 일시</div>
          <div>소재편집</div>
        </div>

        {/* Table Body */}
        {filteredMaterials.length > 0 ? (
          filteredMaterials.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              onDelete={onDeleteMaterial}
              onEdit={onEditMaterial}
              onToggleStatus={onToggleStatus}
              onDuplicate={onDuplicateMaterial}
            />
          ))
        ) : (
          <div className="py-16 text-center">
            <div className="w-12 h-12 md:w-16 md:h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-sm font-bold text-slate-400 mb-1">등록된 소재가 없습니다.</p>
            <p className="text-xs text-slate-300 font-medium">소재를 추가하고 인스타그램에 게시해보세요!</p>
            <button
              onClick={onAddMaterial}
              className="mt-4 px-6 py-2.5 rounded-xl bg-purple-600 text-white text-xs font-black hover:bg-purple-700 transition-all"
            >
              <Plus className="w-3.5 h-3.5 inline mr-1" /> 첫 소재 만들기
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const MaterialRow: React.FC<{
  material: Material;
  onDelete: (id: string) => void;
  onEdit: (material: Material) => void;
  onToggleStatus: (id: string) => void;
  onDuplicate: (material: Material) => void;
}> = ({ material, onDelete, onEdit, onToggleStatus, onDuplicate }) => (
  <>
    {/* Desktop Row */}
    <div className="hidden md:grid grid-cols-[40px_80px_100px_1fr_160px_120px_100px_130px_130px_80px] gap-2 px-4 py-3.5 border-b border-slate-50 hover:bg-purple-50/30 transition-all items-center text-xs">
      <div><input type="checkbox" className="w-3.5 h-3.5 rounded" /></div>
      <div>
        <button
          onClick={() => onToggleStatus(material.id)}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black cursor-pointer hover:opacity-80 transition-all ${
          material.status === 'active' ? 'bg-emerald-50 text-emerald-600' :
          material.status === 'paused' ? 'bg-amber-50 text-amber-600' :
          'bg-slate-50 text-slate-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            material.status === 'active' ? 'bg-emerald-500' :
            material.status === 'paused' ? 'bg-amber-500' :
            'bg-slate-300'
          }`} />
          {material.status === 'active' ? '활성' : material.status === 'paused' ? '일시정지' : '초안'}
        </button>
      </div>
      <div className="text-slate-400 font-mono text-[10px]">{material.id}</div>
      <div className="font-bold text-slate-900 truncate">{material.name}</div>
      <div className="flex gap-1 flex-wrap">
        {material.keywords.slice(0, 2).map(k => (
          <span key={k} className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[9px] font-bold">{k}</span>
        ))}
        {material.keywords.length > 2 && (
          <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-400 text-[9px] font-bold">+{material.keywords.length - 2}</span>
        )}
      </div>
      <div className="text-slate-500 text-[10px] font-medium">{material.postCondition}</div>
      <div className="text-slate-500 text-[10px] font-medium">{material.scheduledSend ? '예약됨' : '-'}</div>
      <div className="text-slate-400 text-[10px] font-medium">{material.createdAt}</div>
      <div className="text-slate-400 text-[10px] font-medium">{material.updatedAt}</div>
      <div className="flex gap-1">
        <button onClick={() => onEdit(material)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-purple-600 transition-all" title="수정"><Edit3 className="w-3.5 h-3.5" /></button>
        <button onClick={() => onDelete(material.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-all" title="삭제"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>

    {/* Mobile Row */}
    <div className="md:hidden px-4 py-4 border-b border-slate-50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleStatus(material.id)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black cursor-pointer hover:opacity-80 transition-all ${
            material.status === 'active' ? 'bg-emerald-50 text-emerald-600' :
            material.status === 'paused' ? 'bg-amber-50 text-amber-600' :
            'bg-slate-50 text-slate-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              material.status === 'active' ? 'bg-emerald-500' :
              material.status === 'paused' ? 'bg-amber-500' :
              'bg-slate-300'
            }`} />
            {material.status === 'active' ? '활성' : material.status === 'paused' ? '일시정지' : '초안'}
          </button>
          <span className="text-[10px] font-mono text-slate-300">{material.id}</span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onDuplicate(material)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400" title="복사"><Copy className="w-3.5 h-3.5" /></button>
          <button onClick={() => onEdit(material)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-purple-600" title="수정"><Edit3 className="w-3.5 h-3.5" /></button>
          <button onClick={() => onDelete(material.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-500" title="삭제"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
      <p className="font-bold text-sm text-slate-900 mb-2">{material.name}</p>
      <div className="flex gap-1 flex-wrap mb-2">
        {material.keywords.map(k => (
          <span key={k} className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[9px] font-bold">{k}</span>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 font-medium">등록: {material.createdAt}</p>
    </div>
  </>
);

// ============================================================
// Material Add View (소재 추가)
// ============================================================

const MaterialAddView: React.FC<{
  formData: any;
  setFormData: (fn: any) => void;
  expandedSections: any;
  toggleSection: (section: string) => void;
  onSave: () => void;
  onCancel: () => void;
  userName: string;
  isEditing?: boolean;
}> = ({ formData, setFormData, onSave, onCancel, userName, isEditing }) => {

  const updateForm = (key: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-4 md:p-8">
      {/* Page Title */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-6 bg-purple-600 rounded-full" />
        <h2 className="text-lg md:text-2xl font-black text-slate-900">{isEditing ? '소재 수정' : '게시물/릴스 댓글 답장'}</h2>
        <button className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-black">?</button>
      </div>

      <div className="flex gap-8 mt-6">
        {/* Left: Form */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Material Name */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <label className="text-sm font-black text-slate-900 mb-3 block">소재명</label>
            <input
              type="text"
              placeholder="소재명 (공백 포함 최대 80자)"
              value={formData.materialName}
              onChange={(e) => updateForm('materialName', e.target.value)}
              maxLength={80}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all"
            />
          </div>

          {/* Message Sending Conditions */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-black text-slate-900">메시지 발송 조건</h3>

            <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-500 font-medium flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <span>발송 조건을 추가할 수 있습니다.</span>
            </div>

            {/* Send Schedule */}
            <CollapsibleSection
              icon={<Clock className="w-4 h-4 text-purple-500" />}
              title="발송 예약"
              badge={formData.scheduledSend ? '설정' : '설정안함'}
              badgeColor={formData.scheduledSend ? 'purple' : 'slate'}
            >
              <div className="pl-6 py-3 space-y-3">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={formData.scheduledSend}
                    onChange={(e) => updateForm('scheduledSend', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  예약 발송 사용
                </label>
                {formData.scheduledSend && (
                  <input
                    type="datetime-local"
                    value={formData.scheduledDate}
                    onChange={(e) => updateForm('scheduledDate', e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400"
                  />
                )}
              </div>
            </CollapsibleSection>

            {/* Post/Reels Selection */}
            <CollapsibleSection
              icon={<Image className="w-4 h-4 text-blue-500" />}
              title="게시물 또는 릴스 선택"
              badge={formData.sendCondition === 'selected' ? '선택된 게시물' : '모든 게시물과 릴스'}
              badgeColor={formData.sendCondition === 'selected' ? 'purple' : 'slate'}
            >
              <div className="pl-6 py-3 space-y-4">
                <select
                  value={formData.sendCondition}
                  onChange={(e) => updateForm('sendCondition', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400"
                >
                  <option value="all">모든 게시물과 릴스</option>
                  <option value="posts-only">게시물만</option>
                  <option value="reels-only">릴스만</option>
                  <option value="selected">선택된 게시물</option>
                </select>

                {/* Instagram Post Selector - shown when "선택된 게시물" is selected */}
                {formData.sendCondition === 'selected' && (
                  <SelectedPostsSection formData={formData} updateForm={updateForm} />
                )}
              </div>
            </CollapsibleSection>

            {/* Keyword Filtering */}
            <CollapsibleSection
              icon={<span className="text-xs font-black text-amber-600 bg-amber-100 w-5 h-5 rounded flex items-center justify-center">Aa</span>}
              title="키워드 필터링"
              badge="설정"
              badgeColor="purple"
            >
              <div className="pl-6 py-3 space-y-4">
                {/* Info */}
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[11px] text-amber-700 font-medium leading-relaxed">
                  <p>사용자가 남긴 댓글에 키워드가 하나라도 포함될 경우 발송됩니다. 단, 발송안함 키워드가 하나라도 포함되면 발송되지 않습니다.</p>
                  <p className="mt-1">다른 소재와 키워드가 중복될 경우 최근 업데이트된 소재가 발송됩니다.</p>
                </div>

                {/* Include Keywords */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <select className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 bg-white">
                      <option>다음 키워드를 포함할 때 발송</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="키워드 입력 (쉼표로 구분)"
                      value={formData.includeKeywords}
                      onChange={(e) => updateForm('includeKeywords', e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400"
                    />
                    <button
                      onClick={() => {
                        if (formData.includeKeywords.trim()) {
                          const keywords = formData.includeKeywords.split(',').map((k: string) => k.trim()).filter(Boolean);
                          updateForm('includeKeywords', keywords.join(', '));
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-black hover:bg-purple-700 transition-all"
                    >추가</button>
                  </div>
                  {formData.includeKeywords && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {formData.includeKeywords.split(',').map((k: string) => k.trim()).filter(Boolean).map((k: string, i: number) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-50 text-purple-600 text-[10px] font-bold">
                          {k}
                          <button
                            onClick={() => {
                              const keywords = formData.includeKeywords.split(',').map((kw: string) => kw.trim()).filter(Boolean).filter((_: string, idx: number) => idx !== i);
                              updateForm('includeKeywords', keywords.join(', '));
                            }}
                            className="ml-0.5 text-purple-400 hover:text-purple-700"
                          >&times;</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-amber-600 font-medium">여러개 키워드를 추가하시는 경우 키워드 조건은 "or"조건으로 적용됩니다. 댓글에 아래 키워드 중 하나라도 포함되면 메시지가 발송됩니다.</p>
                </div>

                {/* Exclude Keywords */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <select className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 bg-white">
                      <option>다음 키워드를 포함할 때 발송안함</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="키워드 입력 (쉼표로 구분)"
                      value={formData.excludeKeywords}
                      onChange={(e) => updateForm('excludeKeywords', e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400"
                    />
                    <button
                      onClick={() => {
                        if (formData.excludeKeywords.trim()) {
                          const keywords = formData.excludeKeywords.split(',').map((k: string) => k.trim()).filter(Boolean);
                          updateForm('excludeKeywords', keywords.join(', '));
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-black hover:bg-purple-700 transition-all"
                    >추가</button>
                  </div>
                  {formData.excludeKeywords && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {formData.excludeKeywords.split(',').map((k: string) => k.trim()).filter(Boolean).map((k: string, i: number) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-bold">
                          {k}
                          <button
                            onClick={() => {
                              const keywords = formData.excludeKeywords.split(',').map((kw: string) => kw.trim()).filter(Boolean).filter((_: string, idx: number) => idx !== i);
                              updateForm('excludeKeywords', keywords.join(', '));
                            }}
                            className="ml-0.5 text-red-400 hover:text-red-700"
                          >&times;</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-amber-600 font-medium">키워드 발송 조건을 만족하더라도 댓글에 아래 키워드 중 하나라도 포함되면 메시지가 발송되지 않습니다.</p>
                </div>
              </div>
            </CollapsibleSection>

            {/* DM Keyword Auto Reply */}
            <CollapsibleSection
              icon={<MessageCircle className="w-4 h-4 text-indigo-500" />}
              title="DM 키워드 자동 답장"
              badge="설정"
              badgeColor="purple"
            >
              <div className="pl-6 py-3 space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-700 font-medium leading-relaxed">
                  <p>인스타그램 사용자가 메시지를 받지 못한 경우 대화 창에 <strong>DM 키워드</strong>를 직접 보내면 아래 본문 메시지가 발송됩니다.</p>
                  <p className="mt-1">댓글 답장을 받지 못한 사람은 DM 키워드를 직접 보내 설명알이 메시지를 만아보도록 본문에서 안내하고 유도해주세요.</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-bold text-slate-600 whitespace-nowrap flex items-center gap-1">
                      DM 키워드 선택
                      <span className="w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[8px] font-black">?</span>
                    </label>
                    <select
                      value={formData.dmKeyword}
                      onChange={(e) => updateForm('dmKeyword', e.target.value)}
                      className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400"
                    >
                      <option value="">키워드 선택</option>
                      <option value="구매">구매</option>
                      <option value="링크">링크</option>
                      <option value="정보요">정보요</option>
                      <option value="가격">가격</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-600 flex items-center gap-1">
                      본문 작성 가이드
                      <span className="w-3.5 h-3.5 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[8px] font-black">?</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={formData.dmBodyTemplate}
                        onChange={(e) => updateForm('dmBodyTemplate', e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400 pr-8"
                      />
                      <button
                        onClick={() => { navigator.clipboard.writeText(formData.dmBodyTemplate); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-purple-500 transition-all"
                        title="복사"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            {/* Follower/Non-follower Distinction */}
            <CollapsibleSection
              icon={<Users className="w-4 h-4 text-emerald-500" />}
              title="팔로워/논팔로워 구분 발송"
              badge="설정안함"
              badgeColor="slate"
            >
              <div className="pl-6 py-3 space-y-3">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <ToggleButton
                    checked={formData.defaultMessageEnabled}
                    onChange={(v) => updateForm('defaultMessageEnabled', v)}
                  />
                  기본 메시지 사용
                </label>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[11px] text-amber-700 font-medium leading-relaxed">
                  <p>댓글을 남긴 사용자에게 1개의 메시지만 보내는 경우 기본 메시지를 생략하는 기능을 Beta로 제공하고 있습니다.</p>
                  <p className="mt-1">단, 추후 META의 정책 변경 등에 따라 메시지 발송이 실패할 경우, 기본 메시지 생략 기능은 제공되지 않을 수 있습니다.</p>
                </div>
              </div>
            </CollapsibleSection>

            {/* Comment Reply */}
            <CollapsibleSection
              icon={<MessageSquare className="w-4 h-4 text-pink-500" />}
              title="댓글에 답글 남기기"
              badge="설정안함"
              badgeColor="slate"
            >
              <div className="pl-6 py-3">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <ToggleButton
                    checked={formData.commentReply}
                    onChange={(v) => updateForm('commentReply', v)}
                  />
                  댓글에 자동 답글 남기기
                </label>
              </div>
            </CollapsibleSection>
          </div>

          {/* Message Settings */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-black text-slate-900">메시지 설정</h3>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-[11px] text-amber-700 font-medium flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>DM은 댓글을 남긴 사용자의 요청 동의로 수신되며, 요청을 '수락'하지 않을 경우 다음 번 댓글을 남겨을 때 메시지를 받지 못할 수 있습니다.</span>
            </div>

            <p className="text-xs text-slate-500 font-medium">메시지 유형을 선택해주세요.</p>

            {/* Message Type Selector */}
            <div className="flex justify-center gap-8 py-4">
              <MessageTypeButton
                icon={<Type className="w-6 h-6" />}
                label="텍스트"
                active={formData.messageType === 'text'}
                onClick={() => updateForm('messageType', 'text')}
              />
              <MessageTypeButton
                icon={<Image className="w-6 h-6" />}
                label="이미지"
                active={formData.messageType === 'image'}
                onClick={() => updateForm('messageType', 'image')}
              />
              <MessageTypeButton
                icon={<Smartphone className="w-6 h-6" />}
                label="캐러셀"
                active={formData.messageType === 'carousel'}
                onClick={() => updateForm('messageType', 'carousel')}
              />
              <MessageTypeButton
                icon={<MessageCircle className="w-6 h-6" />}
                label="대화요청"
                active={formData.messageType === 'question'}
                onClick={() => updateForm('messageType', 'question')}
              />
            </div>

            {/* Message Content Input */}
            {formData.messageType === 'text' && (
              <textarea
                placeholder="DM으로 전송할 메시지를 입력하세요..."
                value={formData.messageContent}
                onChange={(e) => updateForm('messageContent', e.target.value)}
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 resize-none transition-all"
              />
            )}
            {formData.messageType === 'image' && (
              <div className="flex gap-2 items-stretch">
                <div className="flex-1 border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-purple-400 transition-all cursor-pointer">
                  <Image className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-bold text-slate-400">이미지를 드래그하거나 클릭하여 업로드</p>
                  <p className="text-[10px] text-slate-300 mt-1">PNG, JPG, GIF (최대 5MB)</p>
                </div>
                <button
                  onClick={onSave}
                  className="px-4 rounded-xl bg-purple-600 text-white font-black text-xs hover:bg-purple-700 transition-all shadow-lg shadow-purple-200 flex flex-col items-center justify-center gap-1.5 shrink-0"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>{isEditing ? '수정' : '저장'}</span>
                </button>
              </div>
            )}
            {formData.messageType === 'carousel' && (
              <div className="flex gap-2 items-stretch">
                <div className="flex-1 space-y-3">
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-purple-400 transition-all cursor-pointer">
                    <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-400">캐러셀 카드를 추가하세요 (최대 10장)</p>
                  </div>
                  <button className="w-full py-2.5 rounded-xl border border-dashed border-purple-300 text-purple-600 text-xs font-bold hover:bg-purple-50 transition-all flex items-center justify-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> 카드 추가
                  </button>
                </div>
                <button
                  onClick={onSave}
                  className="px-4 rounded-xl bg-purple-600 text-white font-black text-xs hover:bg-purple-700 transition-all shadow-lg shadow-purple-200 flex flex-col items-center justify-center gap-1.5 shrink-0"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>{isEditing ? '수정' : '저장'}</span>
                </button>
              </div>
            )}
            {formData.messageType === 'question' && (
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="질문 내용을 입력하세요..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-all"
                />
                <div className="space-y-2">
                  <input type="text" placeholder="답변 옵션 1" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400" />
                  <input type="text" placeholder="답변 옵션 2" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400" />
                  <button className="text-xs text-purple-600 font-bold flex items-center gap-1 hover:underline">
                    <Plus className="w-3 h-3" /> 옵션 추가
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pb-8">
            <button
              onClick={onSave}
              className="flex-1 py-4 rounded-2xl bg-purple-600 text-white font-black text-sm hover:bg-purple-700 transition-all shadow-lg shadow-purple-200 flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> {isEditing ? '수정 완료' : '저장하기'}
            </button>
            <button
              onClick={onCancel}
              className="px-8 py-4 rounded-2xl bg-white text-slate-600 font-black text-sm border border-slate-200 hover:border-slate-300 transition-all"
            >
              취소
            </button>
          </div>
        </div>

        {/* Right: Phone Preview (Desktop only) */}
        <div className="hidden xl:block w-[320px] shrink-0">
          <div className="sticky top-6">
            <PhonePreview userName={userName} formData={formData} />
            <button
              onClick={() => {/* Preview auto-updates from formData */}}
              className="w-full mt-4 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-500 flex items-center justify-center gap-2 hover:border-purple-300 hover:text-purple-600 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" /> 미리보기 새로고침
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Phone Preview Component
// ============================================================

const PhonePreview: React.FC<{ userName: string; formData: any }> = ({ userName, formData }) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
    {/* Preview Header */}
    <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">미리보기</span>
      <div className="flex items-center gap-1.5">
        <BarChart3 className="w-3 h-3 text-slate-400" />
        <Zap className="w-3 h-3 text-slate-400" />
      </div>
    </div>

    {/* Phone Frame */}
    <div className="p-4">
      <div className="bg-slate-900 rounded-[2rem] p-2.5 shadow-2xl border-[6px] border-slate-800 overflow-hidden" style={{ aspectRatio: '9/16' }}>
        {/* Status Bar */}
        <div className="h-4 flex justify-between items-center px-4">
          <span className="text-[8px] font-bold text-white/40">9:41</span>
          <div className="flex gap-0.5">
            <div className="w-2 h-2 rounded-full bg-white/20" />
            <div className="w-2 h-2 rounded-full bg-white/20" />
          </div>
        </div>

        {/* Chat Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <button className="text-white/60 text-xs">&lt;</button>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <span className="text-[9px] font-black text-white">{userName.charAt(0).toUpperCase()}</span>
          </div>
          <span className="text-[10px] font-bold text-white">{userName}</span>
          <div className="ml-auto"><Settings className="w-3 h-3 text-white/40" /></div>
        </div>

        {/* Chat Content */}
        <div className="flex-1 p-3 space-y-3 overflow-y-auto" style={{ height: 'calc(100% - 4rem)' }}>
          {/* Profile Card */}
          <div className="flex flex-col items-center py-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center mb-2 ring-2 ring-white/20 ring-offset-2 ring-offset-slate-900">
              <span className="text-lg font-black text-white">{userName.charAt(0).toUpperCase()}</span>
            </div>
            <span className="text-[10px] font-bold text-white">{userName}</span>
            <span className="text-[8px] text-white/40 mt-0.5">인스타그램</span>
          </div>

          {/* Message Bubbles */}
          <div className="space-y-2">
            {/* Received Message */}
            <div className="flex gap-2">
              <div className="w-5 h-5 rounded-full bg-slate-700 shrink-0" />
              <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                <p className="text-[9px] text-white/80 font-medium">이 상품 정보 알 수 있을까요? 😊</p>
              </div>
            </div>

            {/* Auto Reply */}
            <div className="flex justify-end">
              <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                <p className="text-[9px] text-white font-medium leading-relaxed">
                  {formData.messageContent || '안녕하세요! 문의하신 상품 정보입니다 ✨\n\n링크를 통해 확인해보세요!'}
                </p>
              </div>
            </div>

            {/* Button Card */}
            <div className="flex justify-end">
              <div className="bg-white rounded-2xl rounded-tr-sm overflow-hidden max-w-[85%] shadow-lg">
                <div className="h-24 bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
                  <Image className="w-8 h-8 text-purple-300" />
                </div>
                <div className="p-2.5">
                  <p className="text-[9px] font-bold text-slate-900">상품 상세보기</p>
                  <p className="text-[8px] text-slate-400 mt-0.5">picks-folio.com</p>
                </div>
                <button className="w-full py-2 border-t border-slate-100 text-[9px] font-bold text-purple-600">
                  링크 열기 →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ============================================================
// Story Reply View
// ============================================================

const StoryReplyView: React.FC<{ userName: string; onToast: (msg: string) => void }> = ({ onToast }) => {
  const [storyEnabled, setStoryEnabled] = useState(true);
  const [triggerCondition, setTriggerCondition] = useState('all');
  const [replyMessage, setReplyMessage] = useState('스토리에 반응해 주셔서 감사합니다! ❤️ 더 자세한 정보가 필요하시면 말씀해주세요!');
  const [sendLimit, setSendLimit] = useState('daily');

  const handleSave = () => {
    onToast('설정이 저장되었습니다!');
  };

  return (
    <div className="p-4 md:p-8">
      {/* Page Title */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-6 bg-purple-600 rounded-full" />
        <h2 className="text-lg md:text-2xl font-black text-slate-900">
          스토리 답장
        </h2>
        <button className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-black">?</button>
      </div>
      <p className="text-xs text-slate-400 font-medium mb-6 ml-3">
        스토리에 반응한 사용자에게 자동으로 DM을 발송합니다.
      </p>

      {/* Data Insights - moved to top */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">오늘 발송</p>
          <p className="text-xl font-black text-slate-900">18건</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">응답률</p>
          <p className="text-xl font-black text-purple-600">92%</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">이번 주 발송</p>
          <p className="text-xl font-black text-slate-900">127건</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">클릭률</p>
          <p className="text-xl font-black text-emerald-600">38.5%</p>
        </div>
      </div>

      {/* Settings Card - full width */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-600" />
            스토리 반응 자동 답장
          </h3>
          <ToggleButton checked={storyEnabled} onChange={setStoryEnabled} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-600 mb-2 block">트리거 조건</label>
              <select
                value={triggerCondition}
                onChange={(e) => setTriggerCondition(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400"
              >
                <option value="all">모든 스토리 반응에 답장</option>
                <option value="emoji">특정 이모지 반응에만 답장</option>
                <option value="message">스토리 답장 메시지에만 답장</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 mb-2 block">발송 제한</label>
              <select
                value={sendLimit}
                onChange={(e) => setSendLimit(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400"
              >
                <option value="daily">동일 사용자 1일 1회</option>
                <option value="weekly">동일 사용자 1주 1회</option>
                <option value="none">제한 없음</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-600 mb-2 block">자동 답장 메시지</label>
            <textarea
              rows={5}
              value={replyMessage}
              onChange={(e) => setReplyMessage(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-purple-400 resize-none"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          className="w-full py-3.5 rounded-2xl bg-purple-600 text-white font-black text-sm hover:bg-purple-700 transition-all shadow-lg shadow-purple-200 flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" /> 저장하기
        </button>
      </div>
    </div>
  );
};

// ============================================================
// Data Analysis View
// ============================================================

const DataAnalysisView: React.FC<{ stats: typeof DEFAULT_STATS }> = ({ stats }) => (
  <div className="p-4 md:p-8">
    {/* Page Title */}
    <div className="flex items-center gap-2 mb-2">
      <div className="w-1 h-6 bg-purple-600 rounded-full" />
      <h2 className="text-lg md:text-2xl font-black text-slate-900">
        데이터 인사이트
      </h2>
    </div>
    <p className="text-xs text-slate-400 font-medium mb-6 ml-3">자동 DM 발송 현황과 성과를 한눈에 확인하세요.</p>

    {/* Stats Grid */}
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-5 mb-8">
      <DataStatCard
        label="총 발송 수"
        value={stats.totalSent.toLocaleString()}
        suffix="건"
        icon={<Send className="w-5 h-5" />}
        color="purple"
      />
      <DataStatCard
        label="오늘 발송"
        value={stats.todaySent.toString()}
        suffix="건"
        icon={<MessageSquare className="w-5 h-5" />}
        color="blue"
      />
      <DataStatCard
        label="클릭률 (CTR)"
        value={stats.clickRate.toString()}
        suffix="%"
        icon={<Eye className="w-5 h-5" />}
        color="emerald"
      />
      <DataStatCard
        label="응답 성공률"
        value={stats.responseRate.toString()}
        suffix="%"
        icon={<CheckCircle2 className="w-5 h-5" />}
        color="indigo"
      />
      <DataStatCard
        label="절약된 시간"
        value={stats.savedHours.toString()}
        suffix="시간"
        icon={<Clock className="w-5 h-5" />}
        color="amber"
      />
      <DataStatCard
        label="전환율"
        value={stats.conversionRate.toString()}
        suffix="%"
        icon={<TrendingUp className="w-5 h-5" />}
        color="pink"
      />
    </div>

    {/* Charts */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      {/* Weekly Bar Chart */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h3 className="text-sm font-black text-slate-900 mb-6">주간 발송 현황</h3>
        <div className="flex items-end justify-between gap-2 h-48">
          {stats.weeklyData.map((d, i) => {
            const maxSent = Math.max(...stats.weeklyData.map(w => w.sent));
            const height = (d.sent / maxSent) * 100;
            const clickHeight = (d.clicks / maxSent) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[9px] font-bold text-slate-400">{d.sent}</span>
                <div className="w-full flex gap-0.5 items-end" style={{ height: '160px' }}>
                  <div
                    className="flex-1 bg-gradient-to-t from-purple-600 to-purple-400 rounded-t-lg transition-all hover:opacity-80"
                    style={{ height: `${height}%` }}
                  />
                  <div
                    className="flex-1 bg-gradient-to-t from-indigo-400 to-indigo-300 rounded-t-lg transition-all hover:opacity-80"
                    style={{ height: `${clickHeight}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-slate-500">{d.day}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-6 mt-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-500" />
            <span className="text-[10px] font-bold text-slate-500">발송 수</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-indigo-400" />
            <span className="text-[10px] font-bold text-slate-500">클릭 수</span>
          </div>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h3 className="text-sm font-black text-slate-900 mb-6">전환 퍼널</h3>
        <div className="space-y-4">
          <FunnelStep label="댓글 수신" value={1247} percentage={100} color="from-purple-500 to-purple-400" />
          <FunnelStep label="DM 발송 성공" value={1222} percentage={98} color="from-indigo-500 to-indigo-400" />
          <FunnelStep label="링크 클릭" value={430} percentage={34.5} color="from-blue-500 to-blue-400" />
          <FunnelStep label="구매 전환" value={102} percentage={8.2} color="from-emerald-500 to-emerald-400" />
        </div>
      </div>
    </div>

    {/* Top Performing Keywords */}
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <h3 className="text-sm font-black text-slate-900 mb-6">인기 키워드 TOP 5</h3>
      <div className="space-y-3">
        {[
          { keyword: '구매', count: 423, rate: 42.3 },
          { keyword: '정보요', count: 312, rate: 28.1 },
          { keyword: '링크', count: 245, rate: 22.5 },
          { keyword: '가격', count: 167, rate: 15.8 },
          { keyword: '배송', count: 100, rate: 9.3 },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-4">
            <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${
              i === 0 ? 'bg-purple-100 text-purple-700' :
              i === 1 ? 'bg-indigo-100 text-indigo-700' :
              'bg-slate-100 text-slate-500'
            }`}>{i + 1}</span>
            <span className="text-xs font-bold text-slate-900 w-20">{item.keyword}</span>
            <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${
                  i === 0 ? 'from-purple-500 to-purple-400' :
                  i === 1 ? 'from-indigo-500 to-indigo-400' :
                  'from-slate-400 to-slate-300'
                }`}
                style={{ width: `${item.rate}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-slate-400 w-16 text-right">{item.count}건</span>
            <span className="text-[10px] font-bold text-purple-600 w-12 text-right">{item.rate}%</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ============================================================
// Shared UI Components
// ============================================================

const DataStatCard: React.FC<{
  label: string;
  value: string;
  suffix: string;
  icon: React.ReactNode;
  color: 'purple' | 'blue' | 'emerald' | 'indigo' | 'amber' | 'pink';
}> = ({ label, value, suffix, icon, color }) => {
  const colorMap = {
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    pink: 'bg-pink-50 text-pink-600 border-pink-100',
  };
  const iconBg = {
    purple: 'bg-purple-100 text-purple-600',
    blue: 'bg-blue-100 text-blue-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    indigo: 'bg-indigo-100 text-indigo-600',
    amber: 'bg-amber-100 text-amber-600',
    pink: 'bg-pink-100 text-pink-600',
  };

  return (
    <div className={`rounded-2xl border p-4 md:p-6 ${colorMap[color]}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${iconBg[color]}`}>
        {icon}
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-70">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl md:text-3xl font-black">{value}</span>
        <span className="text-xs font-bold opacity-60">{suffix}</span>
      </div>
    </div>
  );
};

const FunnelStep: React.FC<{ label: string; value: number; percentage: number; color: string }> = ({ label, value, percentage, color }) => (
  <div className="space-y-1.5">
    <div className="flex justify-between items-center">
      <span className="text-xs font-bold text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-black text-slate-900">{value.toLocaleString()}건</span>
        <span className="text-[10px] font-bold text-purple-600">{percentage}%</span>
      </div>
    </div>
    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-1000`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  </div>
);

// ============================================================
// Selected Posts Section (선택된 게시물 콘텐츠 설정)
// ============================================================

const SelectedPostsSection: React.FC<{
  formData: any;
  updateForm: (key: string, value: any) => void;
}> = ({ formData, updateForm }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>(
    formData.selectedPosts?.map((p: any) => p.id) || []
  );

  const handleTogglePost = (post: typeof DUMMY_INSTAGRAM_POSTS[0]) => {
    setSelectedPostIds(prev => {
      const newIds = prev.includes(post.id)
        ? prev.filter(id => id !== post.id)
        : [...prev, post.id];
      updateForm('selectedPosts', DUMMY_INSTAGRAM_POSTS.filter(p => newIds.includes(p.id)).map(p => ({ id: p.id, imageUrl: p.imageUrl, caption: p.caption })));
      return newIds;
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages = Array.from(files).map((file, idx) => ({
      id: `upload-${Date.now()}-${idx}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));

    updateForm('uploadedImages', [...(formData.uploadedImages || []), ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveImage = (id: string) => {
    updateForm('uploadedImages', (formData.uploadedImages || []).filter((img: any) => img.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Instagram Account Info */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl p-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
          <Grid3X3 className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-[11px] font-black text-purple-700">연동된 인스타그램 계정에서 게시물 선택</p>
          <p className="text-[10px] text-purple-500 font-medium">게시물을 선택하면 해당 게시물에 댓글을 남긴 사용자에게만 DM이 발송됩니다.</p>
        </div>
      </div>

      {/* Post Selection Grid */}
      <div>
        <label className="text-xs font-bold text-slate-600 mb-2 block">게시물 선택</label>
        <div className="grid grid-cols-3 gap-2">
          {DUMMY_INSTAGRAM_POSTS.map((post) => {
            const isSelected = selectedPostIds.includes(post.id);
            return (
              <button
                key={post.id}
                onClick={() => handleTogglePost(post)}
                className={`relative rounded-xl overflow-hidden border-2 transition-all aspect-square ${
                  isSelected
                    ? 'border-purple-500 ring-2 ring-purple-200'
                    : 'border-slate-100 hover:border-slate-300'
                }`}
              >
                <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                  <Image className="w-6 h-6 text-slate-300" />
                </div>
                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-purple-600 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                  <p className="text-[8px] text-white font-medium truncate">{post.caption}</p>
                  <div className="flex gap-2 mt-0.5">
                    <span className="text-[7px] text-white/70">♥ {post.likes}</span>
                    <span className="text-[7px] text-white/70">💬 {post.comments}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {selectedPostIds.length > 0 && (
          <p className="text-[10px] text-purple-600 font-bold mt-2">{selectedPostIds.length}개 게시물 선택됨</p>
        )}
      </div>

      {/* Content Template */}
      <div>
        <label className="text-xs font-bold text-slate-600 mb-2 block">콘텐츠 템플릿</label>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Type className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-500">선택된 게시물에 맞춤 메시지를 설정하세요</span>
          </div>
          <textarea
            placeholder="선택된 게시물에 대한 자동 답장 메시지를 입력하세요...&#10;예: 관심 가져주셔서 감사합니다! 상품 정보를 보내드릴게요 😊"
            value={formData.messageContent}
            onChange={(e) => updateForm('messageContent', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium focus:outline-none focus:border-purple-400 resize-none"
          />
        </div>
      </div>

      {/* Image Upload */}
      <div>
        <label className="text-xs font-bold text-slate-600 mb-2 block">이미지 첨부</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={handleImageUpload}
          className="hidden"
        />

        {/* Uploaded Images Preview */}
        {formData.uploadedImages && formData.uploadedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {formData.uploadedImages.map((img: any) => (
              <div key={img.id} className="relative group">
                <div className="w-20 h-20 rounded-xl overflow-hidden border border-slate-200">
                  <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                </div>
                <button
                  onClick={() => handleRemoveImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
                <p className="text-[8px] text-slate-400 font-medium mt-0.5 truncate w-20">{img.name}</p>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-purple-400 text-slate-400 hover:text-purple-600 transition-all flex items-center justify-center gap-2"
        >
          <Upload className="w-4 h-4" />
          <span className="text-xs font-bold">이미지 추가</span>
        </button>
        <p className="text-[10px] text-slate-400 font-medium mt-1">PNG, JPG, GIF, WEBP (최대 5MB)</p>
      </div>
    </div>
  );
};

const CollapsibleSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  badge: string;
  badgeColor: 'purple' | 'slate';
  children: React.ReactNode;
}> = ({ icon, title, badge, badgeColor, children }) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-all text-left"
      >
        {icon}
        <span className="text-xs font-bold text-slate-700 flex-1">{title}</span>
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
          badgeColor === 'purple'
            ? 'bg-purple-50 text-purple-600 border border-purple-100'
            : 'bg-slate-50 text-slate-400 border border-slate-100'
        }`}>{badge}</span>
        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>
      {isOpen && <div className="border-t border-slate-100">{children}</div>}
    </div>
  );
};

const ToggleButton: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`relative w-10 h-5 rounded-full transition-all ${
      checked ? 'bg-purple-600' : 'bg-slate-200'
    }`}
  >
    <span
      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
        checked ? 'left-5.5' : 'left-0.5'
      }`}
      style={{ left: checked ? '22px' : '2px' }}
    />
  </button>
);

const MessageTypeButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${
      active
        ? 'bg-purple-50 text-purple-600 border-2 border-purple-200'
        : 'text-slate-400 border-2 border-transparent hover:bg-slate-50'
    }`}
  >
    {icon}
    <span className="text-[10px] font-bold">{label}</span>
  </button>
);

export default DMAutomation;
