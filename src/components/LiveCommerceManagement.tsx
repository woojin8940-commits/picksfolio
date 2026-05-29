
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Settings, Info, Camera, Upload, Trash2, Image as ImageIcon, ShoppingBag, Check, Package, Plus, Clock } from 'lucide-react';
import LiveStreaming from './LiveStreaming';
import MediaAuto from './MediaAuto';
import { SellerVerification } from '../types';
import { apiService } from '../services/apiService';

interface LiveCommerceManagementProps {
  userName: string;
  onNavigateMembership?: () => void;
  onNavigateBroadcastSettings?: () => void;
}

interface MaterialItem {
  id: string;
  name: string;
  type: 'banner' | 'product' | 'image';
  url: string;
  width: number;
  opacity: number;
}

interface BroadcastProduct {
  id: string;
  name: string;
  price?: string;
  image?: string;
  options?: { id: string; name: string; values: any[] }[];
}

const LiveCommerceManagement: React.FC<LiveCommerceManagementProps> = ({ userName, onNavigateMembership, onNavigateBroadcastSettings }) => {
  const [showLiveStream, setShowLiveStream] = useState(false);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'banner' | 'product' | 'image'>('banner');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Broadcast products linked from BroadcastSettings menu.
  // Selection is ephemeral per broadcast — it is intentionally not persisted to
  // site data so each new broadcast starts with a blank slate and the seller
  // can pick fresh products for that 회차.
  const [broadcastProducts, setBroadcastProducts] = useState<BroadcastProduct[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);

  // Seller verification gate
  const [verification, setVerification] = useState<SellerVerification | null>(null);
  const [verificationLoaded, setVerificationLoaded] = useState(false);

  // Live notification subscriber count (people who opted in to be alerted when live starts)
  const [notifySubscriberCount, setNotifySubscriberCount] = useState<number>(0);

  // Monthly live broadcast usage (remaining included time, overage)
  const [liveUsage, setLiveUsage] = useState<{
    totalMinutes: number;
    includedMinutesRemaining: number;
    overageMinutes: number;
    overageAmountKrw: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiService.getLiveUsage(userName).then((result) => {
      if (cancelled || !result?.usage) return;
      setLiveUsage({
        totalMinutes: result.usage.totalMinutes,
        includedMinutesRemaining: result.usage.includedMinutesRemaining,
        overageMinutes: result.usage.overageMinutes,
        overageAmountKrw: result.usage.overageAmountKrw,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userName]);

  // Broadcast title (saved per user, used for live-start alimtalk variable 라이브 제목)
  const [broadcastTitle, setBroadcastTitle] = useState<string>('');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`picks_broadcast_title_${userName.toLowerCase()}`);
      if (saved) setBroadcastTitle(saved);
    } catch {}
  }, [userName]);
  const handleBroadcastTitleChange = (value: string) => {
    setBroadcastTitle(value);
    try {
      localStorage.setItem(`picks_broadcast_title_${userName.toLowerCase()}`, value);
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    const loadSubscribers = async () => {
      try {
        const res = await fetch(`/api/alimtalk-settings?user=${encodeURIComponent(userName.toLowerCase())}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.subscriberCount === 'number') setNotifySubscriberCount(data.subscriberCount);
      } catch {}
    };
    loadSubscribers();
    return () => { cancelled = true; };
  }, [userName]);

  useEffect(() => {
    let cancelled = false;
    apiService.getSellerVerification(userName.replace(/^biz\//, '')).then((data) => {
      if (cancelled) return;
      setVerification(data);
      setVerificationLoaded(true);
    });
    return () => { cancelled = true; };
  }, [userName]);

  // Load saved materials from localStorage first, then cloud
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`picks_materials_${userName.toLowerCase()}`);
      if (saved) setMaterials(JSON.parse(saved));
    } catch {}

    // Load from cloud API (authoritative source)
    apiService.getSiteData(userName).then(apiData => {
      if (!apiData) return;
      if (Array.isArray(apiData.materials) && apiData.materials.length > 0) {
        setMaterials(apiData.materials);
        localStorage.setItem(`picks_materials_${userName.toLowerCase()}`, JSON.stringify(apiData.materials));
      }
    }).catch(e => console.warn('[LiveCommerce] Failed to load cloud data:', e));
  }, [userName]);

  // Save materials to both localStorage and cloud
  const saveMaterialsToCloud = useCallback(async (updatedMaterials: MaterialItem[]) => {
    localStorage.setItem(`picks_materials_${userName.toLowerCase()}`, JSON.stringify(updatedMaterials));
    try {
      await apiService.saveSiteData(userName, { materials: updatedMaterials });
    } catch (e) {
      console.warn('[LiveCommerce] Failed to save materials to cloud:', e);
    }
  }, [userName]);

  // Load broadcast products (from BroadcastSettings). Selection is intentionally
  // not loaded from saved data — every visit starts with no products selected
  // so each broadcast 회차 picks its own lineup.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const products = await apiService.getLiveProducts(userName);
        if (cancelled) return;
        setBroadcastProducts(Array.isArray(products) ? (products as BroadcastProduct[]) : []);
        setProductsLoaded(true);
      } catch (e) {
        console.warn('[LiveCommerce] Failed to load broadcast products:', e);
        if (!cancelled) setProductsLoaded(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userName]);

  // Drop stale selections if their products have been removed in BroadcastSettings
  useEffect(() => {
    if (!productsLoaded) return;
    const valid = new Set(broadcastProducts.map(p => p.id));
    setSelectedProductIds(prev => {
      const next = prev.filter(id => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [broadcastProducts, productsLoaded]);

  const toggleProductSelection = useCallback((productId: string) => {
    setSelectedProductIds(prev =>
      prev.includes(productId)
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
  }, []);

  const selectAllProducts = useCallback(() => {
    setSelectedProductIds(broadcastProducts.map(p => p.id));
  }, [broadcastProducts]);

  const clearProductSelection = useCallback(() => {
    setSelectedProductIds([]);
  }, []);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      const item: MaterialItem = {
        id: Date.now().toString(),
        name: newName || file.name.replace(/\.[^.]+$/, ''),
        type: newType,
        url,
        width: newType === 'banner' ? 90 : 50,
        opacity: 100,
      };
      setMaterials(prev => {
        const updated = [...prev, item];
        saveMaterialsToCloud(updated);
        return updated;
      });
      setNewName('');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [newName, newType, saveMaterialsToCloud]);

  const removeMaterial = useCallback((id: string) => {
    setMaterials(prev => {
      const updated = prev.filter(m => m.id !== id);
      saveMaterialsToCloud(updated);
      return updated;
    });
  }, [saveMaterialsToCloud]);

  const updateSize = useCallback((id: string, width: number) => {
    setMaterials(prev => {
      const updated = prev.map(m => m.id === id ? { ...m, width: Math.max(10, Math.min(100, width)) } : m);
      saveMaterialsToCloud(updated);
      return updated;
    });
  }, [saveMaterialsToCloud]);

  const businessVerified = !!verification?.business_verified;
  const settlementRegistered = !!verification?.settlement_registered;
  const membershipPlan = verification?.membership_plan || null;
  // Live broadcasting requires the commerce tier specifically — the standard tier
  // (4,900원) unlocks portfolio video cover + content composition only.
  // 'live' is the legacy plan label from prior installs; treat it as commerce.
  const commerceMembershipActive =
    !!verification?.membership_active && (membershipPlan === 'commerce' || membershipPlan === 'live');
  const gateBlocked = verificationLoaded && !(businessVerified && settlementRegistered && commerceMembershipActive);

  if (gateBlocked) {
    const steps: { label: string; done: boolean; desc: string }[] = [
      { label: '사업자 인증', done: businessVerified, desc: '사업자등록번호와 대표자 정보를 등록합니다' },
      { label: '정산 계좌 등록', done: settlementRegistered, desc: '판매 수익이 입금될 계좌 정보를 등록합니다' },
      { label: '커머스 멤버십 구독', done: commerceMembershipActive, desc: '월 13,900원 커머스 멤버십(라이브 커머스 송출)을 구독합니다' },
    ];

    return (
      <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <header className="mb-6 md:mb-10">
          <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-1 md:mb-2">라이브 커머스</h2>
          <p className="text-slate-500 font-medium text-[10px] md:text-base">실시간 방송으로 팬들과 소통하세요.</p>
        </header>

        <div className="max-w-2xl bg-white border border-blue-100 rounded-2xl p-6 md:p-8 shadow-sm">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-xl">🔒</div>
            <div>
              <h3 className="text-base md:text-lg font-black text-slate-900">라이브 방송을 이용하려면 인증이 필요합니다</h3>
              <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">
                전자상거래법에 따라 사업자 인증과 정산 계좌 등록이 완료된 셀러만 라이브를 송출할 수 있습니다.
              </p>
            </div>
          </div>

          <ul className="space-y-3 mb-6">
            {steps.map((s, i) => (
              <li key={s.label} className={`flex items-start gap-3 rounded-xl p-3 border ${s.done ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black ${s.done ? 'bg-green-500 text-white' : 'bg-slate-300 text-white'}`}>
                  {s.done ? '✓' : i + 1}
                </span>
                <div className="flex-1">
                  <p className={`text-sm font-black ${s.done ? 'text-green-700' : 'text-slate-700'}`}>{s.label}</p>
                  <p className="text-[11px] text-slate-500 font-medium">{s.desc}</p>
                </div>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${s.done ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {s.done ? '완료' : '필요'}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => onNavigateMembership?.()}
            className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-700 hover:to-pink-600 transition-all shadow-md hover:shadow-lg"
          >
            멤버십 플랜에서 인증 진행하기
          </button>
          <p className="text-[11px] text-slate-400 font-medium mt-3 text-center">
            월 13,900원 · 언제든 해지 가능 · 구독 후 즉시 방송 가능
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-10">
        <div>
          <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-1 md:mb-2">라이브 커머스</h2>
          <p className="text-slate-500 font-medium text-[10px] md:text-base">실시간 방송으로 팬들과 소통하세요.</p>
        </div>
        <button 
          onClick={() => setShowLiveStream(true)}
          className="bg-slate-900 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl md:rounded-2xl font-black text-sm md:text-lg hover:bg-slate-800 transition-all shadow-xl shadow-slate-500/20 flex items-center gap-2 md:gap-3 active:scale-95"
        >
          <Settings className="w-4 h-4 md:w-6 md:h-6" />
          방송 설정
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-8 mb-6 md:mb-10">
        {/* Camera Preview Card - Now Static until started */}
        <div className="lg:col-span-2 bg-slate-900 rounded-2xl md:rounded-[2.5rem] overflow-hidden relative group aspect-video lg:aspect-auto flex items-center justify-center">
          <div className="absolute inset-0">
            <img 
              src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=3840&q=100" 
              alt="Studio" 
              className="w-full h-full object-cover opacity-40"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />
          
          <div className="relative z-10 text-center space-y-4">
            <div className="w-20 h-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center mx-auto text-white/40">
              <Camera size={40} />
            </div>
            <p className="text-white/60 font-black uppercase tracking-widest text-xs">방송 시작 시 카메라가 활성화됩니다</p>
          </div>

          <div className="absolute bottom-4 md:bottom-8 left-4 md:left-8 right-4 md:right-8 flex items-center justify-between">
            <div>
              <h4 className="text-white text-sm md:text-xl font-black mb-0.5 md:mb-1">방송 준비</h4>
              <p className="text-white/60 text-[10px] md:text-sm font-medium">상단의 '방송 설정' 버튼을 눌러주세요.</p>
            </div>
          </div>
        </div>

        {/* Stats Column - 구독자 현황 & 라이브 잔여 시간 */}
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 md:gap-6">
          <div className="bg-white p-4 md:p-6 rounded-xl md:rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-emerald-50 rounded-xl md:rounded-2xl flex items-center justify-center text-emerald-600 mb-2 md:mb-3">
              <Bell size={16} className="md:hidden" />
              <Bell size={20} className="hidden md:block" />
            </div>
            <p className="text-slate-400 text-[9px] md:text-xs font-black uppercase tracking-widest mb-1">구독자 현황</p>
            <h3 className="text-xl md:text-3xl font-black text-slate-900">{notifySubscriberCount.toLocaleString()}<span className="text-sm md:text-base font-bold text-slate-400 ml-0.5">명</span></h3>
            <p className="text-slate-400 text-[9px] md:text-[11px] font-medium mt-1 md:mt-2">알림톡 수신 시청자</p>
          </div>

          <div className="bg-white p-4 md:p-6 rounded-xl md:rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-50 rounded-xl md:rounded-2xl flex items-center justify-center text-blue-600 mb-2 md:mb-3">
              <Clock size={16} className="md:hidden" />
              <Clock size={20} className="hidden md:block" />
            </div>
            <p className="text-slate-400 text-[9px] md:text-xs font-black uppercase tracking-widest mb-1">라이브 잔여 시간</p>
            {liveUsage ? (
              <>
                <h3 className="text-xl md:text-3xl font-black text-slate-900">
                  {Math.floor(liveUsage.includedMinutesRemaining / 60)}<span className="text-sm md:text-base font-bold text-slate-400">시간</span> {liveUsage.includedMinutesRemaining % 60}<span className="text-sm md:text-base font-bold text-slate-400">분</span>
                </h3>
                <p className="text-slate-400 text-[9px] md:text-[11px] font-medium mt-1 md:mt-2">
                  월 3시간 중 {Math.floor(liveUsage.totalMinutes / 60)}시간 {liveUsage.totalMinutes % 60}분 사용
                </p>
                {liveUsage.overageMinutes > 0 && (
                  <p className="text-amber-600 text-[9px] md:text-[11px] font-bold mt-1">
                    초과 {Math.floor(liveUsage.overageMinutes / 60)}시간 {liveUsage.overageMinutes % 60}분 · {liveUsage.overageAmountKrw.toLocaleString()}원
                  </p>
                )}
              </>
            ) : (
              <>
                <h3 className="text-xl md:text-3xl font-black text-slate-400">—</h3>
                <p className="text-slate-400 text-[9px] md:text-[11px] font-medium mt-1 md:mt-2">데이터 없음</p>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <section className="bg-white p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4 md:mb-8">
            <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
              <Settings className="w-4 h-4 md:w-5 md:h-5 text-slate-400" /> 방송 설정
            </h4>
          </div>

          <div className="space-y-4 md:space-y-6">
            <div>
              <label className="block text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 md:mb-2">방송 제목</label>
              <input
                type="text"
                value={broadcastTitle}
                onChange={(e) => handleBroadcastTitleChange(e.target.value)}
                placeholder="제목을 입력하세요"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 md:py-4 px-4 md:px-6 text-sm md:text-slate-900 font-bold outline-none focus:border-blue-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 md:mb-2">방송 카테고리</label>
              <select className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 md:py-4 px-4 md:px-6 text-sm md:text-slate-900 font-bold outline-none focus:border-blue-500/50 transition-all appearance-none">
                <option>패션/스타일</option>
                <option>뷰티/메이크업</option>
                <option>라이프스타일</option>
                <option>기타</option>
              </select>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 md:mt-10 bg-white p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between mb-4 md:mb-6 flex-wrap gap-2">
          <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
            <ShoppingBag className="w-4 h-4 md:w-5 md:h-5 text-green-500" /> 방송 상품 설정
          </h4>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-[10px] md:text-xs font-bold">
              {selectedProductIds.length}/{broadcastProducts.length} 선택
            </span>
          </div>
        </div>
        <p className="text-slate-500 text-xs md:text-sm font-medium mb-4 md:mb-6">
          방송 회차마다 새로 선택해 주세요. <span className="font-bold text-slate-700">방송 설정 메뉴의 방송 노출 상품 리스트</span>에 등록된 상품 중 이번 방송에 노출할 상품만 선택하면 됩니다.
        </p>

        {productsLoaded && broadcastProducts.length > 0 && (
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <button
              type="button"
              onClick={selectAllProducts}
              className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-[10px] md:text-xs font-black hover:bg-green-100 transition-all"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={clearProductSelection}
              className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[10px] md:text-xs font-black hover:bg-slate-200 transition-all"
            >
              선택 해제
            </button>
          </div>
        )}

        {!productsLoaded ? (
          <div className="flex items-center justify-center py-8 md:py-12">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : broadcastProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 md:py-12 text-center border border-dashed border-slate-200 rounded-2xl bg-slate-50/60">
            <div className="w-14 h-14 md:w-20 md:h-20 bg-white rounded-full flex items-center justify-center mb-3 md:mb-4 shadow-sm">
              <Package size={28} className="text-slate-300 md:hidden" />
              <Package size={36} className="text-slate-300 hidden md:block" />
            </div>
            <p className="text-slate-500 font-bold text-xs md:text-sm">아직 등록된 방송 상품이 없습니다</p>
            <p className="text-slate-400 font-medium text-[10px] md:text-xs mt-1">방송 설정 메뉴에서 방송 노출 상품을 먼저 등록해 주세요</p>
            {onNavigateBroadcastSettings && (
              <button
                type="button"
                onClick={onNavigateBroadcastSettings}
                className="mt-4 inline-flex items-center gap-1.5 bg-green-600 text-white rounded-xl py-2.5 px-4 text-xs font-bold hover:bg-green-700 transition-all active:scale-95"
              >
                <Plus size={14} /> 방송 상품 등록하러 가기
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {broadcastProducts.map((product, index) => {
              const isSelected = selectedProductIds.includes(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => toggleProductSelection(product.id)}
                  className={`w-full flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl md:rounded-2xl border transition-all text-left ${
                    isSelected
                      ? 'bg-green-50 border-green-300 shadow-sm'
                      : 'bg-slate-50 border-slate-100 hover:border-slate-200'
                  }`}
                >
                  <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
                    isSelected ? 'bg-green-600 text-white' : 'bg-white text-slate-400 border border-slate-200'
                  }`}>
                    {isSelected ? <Check size={16} /> : index + 1}
                  </div>
                  {product.image ? (
                    <MediaAuto src={product.image} className="w-12 h-12 md:w-16 md:h-16 rounded-xl object-cover flex-shrink-0 border border-slate-200" />
                  ) : (
                    <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                      <Package size={20} className="text-slate-300" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm md:text-base text-slate-900 truncate">{product.name}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {product.price && <span className="text-green-700 text-xs font-bold">{product.price}</span>}
                      {(product.options || []).length > 0 && (
                        <span className="text-slate-400 text-[10px] font-medium">· 옵션 {(product.options || []).length}개</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-[10px] md:text-xs font-black px-2 py-1 rounded-md ${
                    isSelected ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-500'
                  }`}>
                    {isSelected ? '선택됨' : '선택'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {productsLoaded && broadcastProducts.length > 0 && onNavigateBroadcastSettings && (
          <button
            type="button"
            onClick={onNavigateBroadcastSettings}
            className="mt-4 md:mt-6 w-full flex items-center justify-center gap-2 bg-slate-100 text-slate-700 rounded-xl py-3 px-4 text-xs md:text-sm font-bold hover:bg-slate-200 transition-all"
          >
            방송 설정에서 상품 추가/수정 →
          </button>
        )}
      </div>

      <div className="mt-6 md:mt-10 bg-white p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between mb-4 md:mb-8">
          <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
            <ImageIcon className="w-4 h-4 md:w-5 md:h-5 text-blue-500" /> 방송 자료 관리
          </h4>
          <span className="text-slate-400 text-[10px] md:text-xs font-bold">{materials.length}개 등록</span>
        </div>
        <p className="text-slate-500 text-xs md:text-sm font-medium mb-4 md:mb-6">방송 중 화면에 띄울 배너, 상품 이미지를 미리 등록하세요. 방송 화면에서 원클릭으로 바로 표시할 수 있습니다.</p>

        {/* Add material form */}
        <div className="bg-slate-50 p-4 md:p-6 rounded-xl md:rounded-2xl mb-4 md:mb-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="자료 이름 (예: 신상품 배너)"
              className="bg-white border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold outline-none focus:border-blue-500/50 transition-all"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as any)}
              className="bg-white border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold outline-none focus:border-blue-500/50 transition-all appearance-none"
            >
              <option value="banner">배너 (상단 가로)</option>
              <option value="product">상품 이미지 (우측 하단)</option>
              <option value="image">이미지 (중앙)</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-xl py-3 px-4 text-sm font-bold hover:bg-blue-700 transition-all active:scale-95"
              >
                <Upload size={16} /> 파일 업로드
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          </div>

        {/* Material list */}
        {materials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 md:py-12 text-center">
            <div className="w-14 h-14 md:w-20 md:h-20 bg-slate-50 rounded-full flex items-center justify-center mb-3 md:mb-4">
              <ImageIcon size={28} className="text-slate-300 md:hidden" />
              <ImageIcon size={36} className="text-slate-300 hidden md:block" />
            </div>
            <p className="text-slate-400 font-bold text-xs md:text-sm">등록된 방송 자료가 없습니다</p>
            <p className="text-slate-300 font-medium text-[10px] md:text-xs mt-1">위에서 파일을 업로드해 추가하세요</p>
          </div>
        ) : (
          <div className="space-y-3">
            {materials.map(item => (
              <div key={item.id} className="flex items-center gap-3 md:gap-4 bg-slate-50 p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-100 hover:border-slate-200 transition-all">
                <img src={item.url} alt={item.name} className="w-14 h-14 md:w-20 md:h-20 rounded-xl object-cover flex-shrink-0 border border-slate-200" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm md:text-base text-slate-900 truncate">{item.name}</p>
                  <span className="text-slate-400 text-[10px] md:text-xs font-bold uppercase tracking-widest">
                    {item.type === 'banner' ? '배너' : item.type === 'product' ? '상품' : '이미지'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateSize(item.id, 30)}
                    className={`px-2 py-1 rounded-lg text-[10px] md:text-xs font-bold transition-all ${item.width === 30 ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-900'}`}
                    title="작은 크기"
                  >
                    S
                  </button>
                  <button
                    onClick={() => updateSize(item.id, 50)}
                    className={`px-2 py-1 rounded-lg text-[10px] md:text-xs font-bold transition-all ${item.width === 50 ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-900'}`}
                    title="중간 크기"
                  >
                    M
                  </button>
                  <button
                    onClick={() => updateSize(item.id, 90)}
                    className={`px-2 py-1 rounded-lg text-[10px] md:text-xs font-bold transition-all ${item.width === 90 ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:text-slate-900'}`}
                    title="큰 크기"
                  >
                    L
                  </button>
                </div>
                <button
                  onClick={() => removeMaterial(item.id)}
                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* Live Commerce Tips */}
      <div className="mt-6 md:mt-10 bg-blue-50 p-4 md:p-8 rounded-xl md:rounded-[2rem] border border-blue-100 flex items-start gap-3 md:gap-6">
        <div className="w-8 h-8 md:w-12 md:h-12 bg-white rounded-xl md:rounded-2xl flex items-center justify-center text-blue-600 shadow-sm shrink-0">
          <Info size={16} className="md:hidden" />
          <Info size={24} className="hidden md:block" />
        </div>
        <div>
          <h5 className="font-black text-blue-900 mb-1 text-sm md:text-base">라이브 커머스 팁</h5>
          <p className="text-blue-700 text-xs md:text-sm font-medium leading-relaxed">
            방송 시작 전 조명과 마이크 상태를 꼭 확인해 주세요. 시청자들과 활발하게 소통할수록 판매 전환율이 높아집니다!
          </p>
        </div>
      </div>

      {/* Live Stream Overlay */}
      {showLiveStream && (
        <LiveStreaming
          userName={userName}
          selectedProductIds={selectedProductIds}
          onClose={() => {
            setShowLiveStream(false);
          }}
        />
      )}
    </div>
  );
};

export default LiveCommerceManagement;
