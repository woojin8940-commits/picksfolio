
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShoppingBag, Check, Plus, X, Package, History as HistoryIcon, Trash2, Camera, Edit3, Search } from 'lucide-react';
import SafeImage from './SafeImage';
import ImageCropper from './ImageCropper';
import { apiService } from '../services/apiService';
import { LiveProductOption, LiveProductOptionValue } from '../types';
import BroadcastHistory from './BroadcastHistory';
import { formatNumberWithCommas, stripCommas } from '../utils/formatters';

interface BroadcastSettingsProps {
  userName: string;
  onNavigateLive?: () => void;
}

interface LiveProduct {
  id: string;
  name: string;
  price?: string;
  image?: string;
  fallbackImage?: string;
  blockTitle?: string;
  options?: LiveProductOption[];
}

const generateId = () => `lp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const blankProduct = (): LiveProduct => ({
  id: generateId(),
  name: '',
  price: '',
  image: '',
  options: [],
});

// Older saved products stored option values as plain strings; coerce them to
// the richer object form so the editor renders price/discount inputs.
const normaliseOptions = (raw: unknown): LiveProductOption[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map((opt: any) => ({
    id: String(opt?.id || generateId()),
    name: String(opt?.name || ''),
    values: Array.isArray(opt?.values)
      ? opt.values.map((v: any): LiveProductOptionValue => (
          typeof v === 'string' ? { value: v } : { value: String(v?.value ?? ''), price: v?.price, discount: v?.discount }
        ))
      : [],
  }));
};

const BroadcastSettings: React.FC<BroadcastSettingsProps> = ({ userName, onNavigateLive }) => {
  const [activeTab, setActiveTab] = useState<'products' | 'history'>('products');
  const [liveProducts, setLiveProducts] = useState<LiveProduct[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LiveProduct | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiService.getLiveProducts(userName).then((list) => {
      if (cancelled) return;
      const items = Array.isArray(list) ? list : [];
      setLiveProducts(items.map((p: any) => ({
        id: String(p?.id || generateId()),
        name: String(p?.name || ''),
        price: p?.price || '',
        image: p?.image || '',
        fallbackImage: p?.fallbackImage,
        blockTitle: p?.blockTitle,
        options: normaliseOptions(p?.options),
      })));
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [userName]);

  const persist = useCallback(async (next: LiveProduct[]) => {
    const ok = await apiService.saveLiveProducts(userName, next);
    if (ok) {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt((prev) => (prev && Date.now() - prev > 1800 ? null : prev)), 2000);
    }
  }, [userName]);

  const startNew = () => {
    setEditForm(blankProduct());
    setEditingId('new');
  };

  const startEdit = (product: LiveProduct) => {
    setEditForm({
      ...product,
      options: (product.options || []).map(o => ({
        ...o,
        values: o.values.map(v => ({ ...v })),
      })),
    });
    setEditingId(product.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const saveEdit = () => {
    if (!editForm) return;
    if (!editForm.name.trim()) {
      alert('상품명을 입력해주세요.');
      return;
    }
    const cleaned: LiveProduct = {
      ...editForm,
      name: editForm.name.trim(),
      price: editForm.price?.trim() || undefined,
      image: editForm.image?.trim() || undefined,
      options: (editForm.options || [])
        .filter(o => o.name.trim())
        .map(o => ({
          ...o,
          name: o.name.trim(),
          values: o.values
            .map(v => ({
              value: (v.value || '').trim(),
              price: typeof v.price === 'number' && v.price > 0 ? Math.round(v.price) : undefined,
              discount: typeof v.discount === 'number' && v.discount > 0
                ? Math.min(100, Math.round(v.discount))
                : undefined,
            }))
            .filter(v => v.value.length > 0),
        }))
        .filter(o => o.values.length > 0),
    };
    setLiveProducts((prev) => {
      const exists = prev.some(p => p.id === cleaned.id);
      const next = exists ? prev.map(p => (p.id === cleaned.id ? cleaned : p)) : [...prev, cleaned];
      persist(next);
      return next;
    });
    cancelEdit();
  };

  const removeLiveProduct = useCallback((productId: string) => {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return;
    setLiveProducts((prev) => {
      const updated = prev.filter((p) => p.id !== productId);
      persist(updated);
      return updated;
    });
  }, [persist]);

  const updateField = <K extends keyof LiveProduct>(key: K, value: LiveProduct[K]) => {
    setEditForm(prev => (prev ? { ...prev, [key]: value } : prev));
  };

  const addOption = () => {
    setEditForm(prev => prev ? {
      ...prev,
      options: [...(prev.options || []), { id: generateId(), name: '', values: [{ value: '' }] }]
    } : prev);
  };

  const updateOptionName = (optId: string, name: string) => {
    setEditForm(prev => prev ? {
      ...prev,
      options: (prev.options || []).map(o => o.id === optId ? { ...o, name } : o)
    } : prev);
  };

  const updateOptionValues = (optId: string, values: LiveProductOptionValue[]) => {
    setEditForm(prev => prev ? {
      ...prev,
      options: (prev.options || []).map(o => o.id === optId ? { ...o, values } : o)
    } : prev);
  };

  const deleteOption = (optId: string) => {
    setEditForm(prev => prev ? {
      ...prev,
      options: (prev.options || []).filter(o => o.id !== optId)
    } : prev);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('파일 크기는 20MB 이하로 업로드해주세요.');
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
    if (!file) return;
    setIsUploading(true);
    const objectUrl = URL.createObjectURL(croppedBlob);
    updateField('image', objectUrl);
    try {
      const ext = file.name?.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${Date.now()}-${file.name.replace(/\.[^/.]+$/, '')}.${ext}`;
      const apiUrl = await apiService.uploadImage(userName, croppedBlob, fileName);
      if (apiUrl) {
        updateField('image', apiUrl);
      }
    } catch (err) {
      console.error('[BroadcastSettings] image upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCropCancel = () => {
    if (cropperSrc) URL.revokeObjectURL(cropperSrc);
    setCropperSrc(null);
    pendingFileRef.current = null;
  };

  const renderEditor = () => {
    if (!editForm) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-6 animate-in fade-in duration-200">
        <div className="bg-white w-full md:max-w-2xl md:rounded-3xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between p-5 md:p-7 border-b border-slate-100 sticky top-0 bg-white z-10">
            <h3 className="text-lg md:text-xl font-black text-slate-900">
              {editingId === 'new' ? '방송 상품 추가' : '방송 상품 수정'}
            </h3>
            <button
              onClick={cancelEdit}
              className="p-2 rounded-full text-slate-400 hover:bg-slate-100"
              aria-label="닫기"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-5 md:p-7 space-y-5">
            {/* Image */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">상품 이미지</label>
              <div className="flex items-center gap-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:bg-slate-100 transition-all overflow-hidden relative"
                >
                  {isUploading && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                      <div className="w-5 h-5 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin" />
                    </div>
                  )}
                  {editForm.image ? (
                    <SafeImage src={editForm.image} className="w-full h-full object-cover" />
                  ) : (
                    <Camera size={22} className="text-slate-300" />
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="px-4 py-2 bg-purple-50 text-purple-600 rounded-xl text-xs font-black hover:bg-purple-100 transition-all disabled:opacity-50"
                  >
                    {editForm.image ? '이미지 변경' : '이미지 업로드'}
                  </button>
                  {editForm.image && (
                    <button
                      type="button"
                      onClick={() => updateField('image', '')}
                      className="px-4 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-black hover:bg-red-100 transition-all"
                    >
                      이미지 제거
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">상품명 *</label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="예: 시그니처 후드티"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-purple-500"
              />
            </div>

            {/* Price */}
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">기본 가격 (선택)</label>
              <input
                type="text"
                inputMode="numeric"
                value={editForm.price || ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  const digits = stripCommas(raw);
                  updateField('price', digits ? formatNumberWithCommas(digits) : '');
                }}
                placeholder="예: 29,000"
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:border-purple-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">옵션별 가격을 따로 설정하지 않으면 이 가격으로 결제됩니다.</p>
            </div>

            {/* Options */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">상품 옵션 (선택)</label>
                <button
                  type="button"
                  onClick={addOption}
                  className="text-purple-500 text-[10px] font-black hover:text-purple-700 transition-all"
                >
                  + 옵션 추가
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mb-2">옵션 값마다 가격이나 할인율을 따로 설정할 수 있습니다.</p>
              <div className="space-y-3">
                {(editForm.options || []).map((opt) => (
                  <div key={opt.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="옵션명 (예: 사이즈, 컬러)"
                        value={opt.name}
                        onChange={(e) => updateOptionName(opt.id, e.target.value)}
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold focus:outline-none focus:border-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => deleteOption(opt.id)}
                        className="w-9 h-9 bg-white border border-red-100 text-red-400 rounded-xl flex items-center justify-center hover:text-red-500 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {opt.values.map((val, vi) => (
                        <div key={vi} className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl p-2">
                          <input
                            type="text"
                            placeholder={`값 ${vi + 1}`}
                            value={val.value}
                            onChange={(e) => {
                              const next = opt.values.map((v, i) => i === vi ? { ...v, value: e.target.value } : v);
                              updateOptionValues(opt.id, next);
                            }}
                            className="flex-1 min-w-[100px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-purple-500"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="가격"
                              value={typeof val.price === 'number' ? formatNumberWithCommas(val.price) : ''}
                              onChange={(e) => {
                                const digits = stripCommas(e.target.value);
                                const num = digits === '' ? undefined : Number(digits);
                                const next = opt.values.map((v, i) => i === vi ? { ...v, price: num } : v);
                                updateOptionValues(opt.id, next);
                              }}
                              className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs font-bold focus:outline-none focus:border-purple-500"
                            />
                            <span className="text-[10px] font-bold text-slate-400">원</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              placeholder="할인"
                              value={typeof val.discount === 'number' ? val.discount : ''}
                              onChange={(e) => {
                                const num = e.target.value === '' ? undefined : Number(e.target.value);
                                const next = opt.values.map((v, i) => i === vi ? { ...v, discount: num } : v);
                                updateOptionValues(opt.id, next);
                              }}
                              className="w-16 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs font-bold focus:outline-none focus:border-purple-500"
                            />
                            <span className="text-[10px] font-bold text-slate-400">%</span>
                          </div>
                          {opt.values.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = opt.values.filter((_, i) => i !== vi);
                                updateOptionValues(opt.id, next);
                              }}
                              className="text-red-300 hover:text-red-500 transition-all"
                              aria-label="값 삭제"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateOptionValues(opt.id, [...opt.values, { value: '' }])}
                        className="text-purple-400 text-[10px] font-black bg-purple-50 px-3 py-2 rounded-lg hover:bg-purple-100 transition-all"
                      >
                        + 값 추가
                      </button>
                    </div>
                  </div>
                ))}
                {(editForm.options || []).length === 0 && (
                  <p className="text-slate-400 text-xs">옵션이 없습니다. 사이즈, 컬러 등 옵션을 추가할 수 있습니다.</p>
                )}
              </div>
            </div>
          </div>

          <div className="p-5 md:p-7 border-t border-slate-100 flex gap-3 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={cancelEdit}
              className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-black text-sm hover:bg-slate-200 transition-all"
            >
              취소
            </button>
            <button
              type="button"
              onClick={saveEdit}
              className="flex-[2] py-3 rounded-xl bg-purple-600 text-white font-black text-sm hover:bg-purple-700 transition-all"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      {cropperSrc && (
        <ImageCropper
          src={cropperSrc}
          onCrop={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-8">
        <div>
          <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-1 md:mb-2">방송 설정</h2>
          <p className="text-slate-500 font-medium text-[10px] md:text-base">방송에 노출할 상품을 직접 등록하고 방송 기록을 확인할 수 있습니다.</p>
        </div>
        {onNavigateLive && (
          <button
            type="button"
            onClick={onNavigateLive}
            className="text-xs md:text-sm font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1"
          >
            라이브 커머스로 이동 →
          </button>
        )}
      </header>

      {/* Tabs */}
      <div className="mb-5 md:mb-7 flex gap-2 bg-slate-100 p-1 rounded-2xl w-full md:w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('products')}
          className={`flex-1 md:flex-none px-5 md:px-8 py-2.5 rounded-xl text-xs md:text-sm font-black transition-all flex items-center justify-center gap-2 ${
            activeTab === 'products' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <ShoppingBag size={14} /> 상품
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex-1 md:flex-none px-5 md:px-8 py-2.5 rounded-xl text-xs md:text-sm font-black transition-all flex items-center justify-center gap-2 ${
            activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <HistoryIcon size={14} /> 방송 기록
        </button>
      </div>

      {activeTab === 'products' ? (
        <section className="bg-white p-5 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <ShoppingBag className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
              </div>
              <div>
                <h3 className="text-base md:text-xl font-black text-slate-900">방송 노출 상품</h3>
                <p className="text-[10px] md:text-xs text-slate-500 font-medium">방송에서 판매할 상품을 직접 등록하세요. 옵션도 함께 설정할 수 있어요.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {savedAt && (
                <span className="text-green-600 text-[10px] md:text-xs font-bold flex items-center gap-1">
                  <Check size={14} /> 저장됨
                </span>
              )}
              <span className="text-slate-400 text-[10px] md:text-xs font-bold">{liveProducts.length}개</span>
            </div>
          </div>

          {liveProducts.length > 0 && (
            <div className="relative mb-3 md:mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="상품명으로 검색"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-9 py-2.5 text-sm font-bold focus:outline-none focus:border-purple-500 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                  aria-label="검색어 지우기"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {liveProducts.length > 0 ? (() => {
            const q = searchQuery.trim().toLowerCase();
            const filtered = q
              ? liveProducts.filter((p) => p.name.toLowerCase().includes(q))
              : liveProducts;
            if (filtered.length === 0) {
              return (
                <div className="text-center py-8 md:py-10 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60 mb-4 md:mb-6">
                  <p className="text-slate-500 font-bold text-sm">검색 결과가 없습니다</p>
                  <p className="text-slate-400 text-xs mt-1">"{searchQuery}"와(과) 일치하는 상품이 없습니다</p>
                </div>
              );
            }
            return (
            <div className="space-y-2 mb-4 md:mb-6">
              {filtered.map((product) => {
                const index = liveProducts.indexOf(product);
                return (
                <div key={product.id} className="flex items-center gap-3 md:gap-4 bg-green-50 p-3 md:p-4 rounded-xl md:rounded-2xl border border-green-100">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-green-600 text-white rounded-lg md:rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0">
                    {index + 1}
                  </div>
                  {product.image ? (
                    <SafeImage src={product.image} className="w-12 h-12 md:w-16 md:h-16 rounded-xl object-cover flex-shrink-0 border border-green-200" />
                  ) : (
                    <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Package size={20} className="text-green-400" />
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
                  <button
                    onClick={() => startEdit(product)}
                    className="p-2 text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded-xl transition-all"
                    aria-label="수정"
                  >
                    <Edit3 size={18} />
                  </button>
                  <button
                    onClick={() => removeLiveProduct(product.id)}
                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                    aria-label="삭제"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                );
              })}
            </div>
            );
          })() : loaded ? (
            <div className="text-center py-8 md:py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/60 mb-4 md:mb-6">
              <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm">
                <Package size={24} className="text-slate-300" />
              </div>
              <p className="text-slate-500 font-bold text-sm">등록된 방송 상품이 없습니다</p>
              <p className="text-slate-400 text-xs mt-1">아래 버튼을 눌러 방송 상품을 직접 등록하세요</p>
            </div>
          ) : null}

          <button
            onClick={startNew}
            className="w-full flex items-center justify-center gap-2 bg-green-600 text-white rounded-xl py-3 md:py-4 px-4 text-sm font-bold hover:bg-green-700 transition-all active:scale-95"
          >
            <Plus size={16} /> 방송 상품 추가
          </button>
        </section>
      ) : (
        <BroadcastHistory userName={userName} embedded />
      )}

      {editForm && renderEditor()}
    </div>
  );
};

export default BroadcastSettings;
