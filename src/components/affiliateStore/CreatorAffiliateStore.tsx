import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Instagram, Loader2, Search, ShoppingBag, Store, X } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  MANAGER_STATUS_LABEL,
  MANAGER_STATUS_STYLE,
  REQUEST_STATUS_LABEL,
  type BrandInfo,
  type CategoryNode,
  type ListCursor,
  type StoreBrand,
  type StoreProduct,
  type StoreRequest,
} from '../../services/affiliateStoreService';
import MyAffiliate from './MyAffiliate';
import CreatorApplicationGate from '../CreatorApplicationGate';
import { apiService } from '../../services/apiService';
import { useCloseOnBack } from '../../hooks/useCloseOnBack';
import AffiliatePayouts from './AffiliatePayouts';

/**
 * 인플루언서 어필리에이트 메뉴.
 *
 *   상품    상위(뷰티 · 패션 · 스킨케어 · 라이프스타일) → 하위(TOP · BOTTOM · OUTER …)
 *           카테고리와 검색어(상품명 · 브랜드명)로 판매중인 상품을 찾는다.
 *   브랜드  입점한 브랜드 전체. 수천 개가 될 것이라 검색 + 더 보기로 나눠 읽는다.
 *           브랜드를 누르면 그 브랜드의 상품만 본다.
 *   내 신청 브랜드의 선정 · 반려 결과. 선정되면 바로 전용 링크가 열린다.
 *
 * 상품을 누르면 캠페인처럼 큰 상세 화면으로 들어간다. 수수료율 · 개당 수수료는 상세 화면에서 보인다
 * (목록에는 보이지 않는다). 선정되면 MY 어필리에이트에서 전용 링크와 판매 성과를 확인한다.
 * 새로 들어온 인플루언서는 크리에이터 승인을 받아야 이 메뉴를 쓴다(기존 계정은 그대로).
 *
 * 목록은 서버에서 거르고 페이지로 받는다(api-affiliate-store scope=creator · brands).
 */

const REQUEST_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
  cancelled: 'bg-slate-100 text-slate-400',
};

/** 입력이 멈춘 뒤에 검색한다 — 한 글자마다 서버를 부르지 않게. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <div className="relative mb-3">
    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 pl-10 pr-10 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:border-blue-600"
    />
    {value && (
      <button onClick={() => onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center" aria-label="검색어 지우기">
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

const Empty: React.FC<{ title: string; desc?: string; icon?: React.ReactNode }> = ({ title, desc, icon }) => (
  <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
    {icon || <ShoppingBag className="w-8 h-8 text-slate-300 mx-auto mb-3" />}
    <p className="text-sm font-black text-slate-700">{title}</p>
    {desc && <p className="text-xs text-slate-400 mt-1">{desc}</p>}
  </div>
);

const MoreButton: React.FC<{ loading: boolean; onClick: () => void; label?: string }> = ({ loading, onClick, label }) => (
  <div className="flex justify-center mt-6">
    <button onClick={onClick} disabled={loading} className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {label || '더 보기'}
    </button>
  </div>
);

// ───────────────────────────── 상품 목록 ─────────────────────────────

interface ProductListProps {
  taxonomy: CategoryNode[];
  onTaxonomy: (t: CategoryNode[]) => void;
  requestByProduct: Map<string, Pick<StoreRequest, 'productId' | 'status' | 'managerStatus'>>;
  onOpen: (p: StoreProduct) => void;
  /** 이 브랜드의 상품만 본다(브랜드 페이지). */
  brand?: string;
  onBrandInfo?: (b: BrandInfo | null) => void;
  /** 새로 불러온 상품들 — 이 상품들의 내 신청 상태만 따로 조회한다. */
  onProductsLoaded?: (ids: string[]) => void;
}

const ProductList: React.FC<ProductListProps> = ({ taxonomy, onTaxonomy, requestByProduct, onOpen, brand, onBrandInfo, onProductsLoaded }) => {
  const [category, setCategory] = useState('');
  const [sub, setSub] = useState('');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<ListCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreError, setMoreError] = useState('');
  const seq = useRef(0);

  /** next 가 없으면 첫 페이지(조건이 바뀌었을 때), 있으면 "더 보기". */
  const load = useCallback(async (next?: ListCursor | null) => {
    const my = ++seq.current;
    const append = !!next;
    setLoading(true);
    if (append) setMoreError(''); else setError('');
    const res = await affiliateStoreService.listProducts({ category, sub, q, brand }, next);
    if (my !== seq.current) return; // 그사이 조건이 바뀌었다
    setLoading(false);
    if (res.error) {
      // "더 보기" 실패는 보던 목록을 두고 아래에만 알린다.
      if (append) setMoreError(res.error); else setError(res.error);
      return;
    }
    setProducts(prev => {
      if (!append) return res.products;
      const seen = new Set(prev.map(p => p.id));
      return [...prev, ...res.products.filter(p => !seen.has(p.id))];
    });
    if (res.total !== undefined) setTotal(res.total);
    setCursor(res.nextCursor || null);
    setHasMore(res.hasMore);
    if (res.taxonomy?.length) onTaxonomy(res.taxonomy);
    if (!append) onBrandInfo?.(res.brand);
    onProductsLoaded?.(res.products.map(p => p.id));
  }, [category, sub, q, brand, onTaxonomy, onBrandInfo, onProductsLoaded]);

  useEffect(() => { load(); }, [load]);

  const subs = taxonomy.find(t => t.name === category)?.subs || [];

  return (
    <>
      <SearchBox value={query} onChange={setQuery} placeholder={brand ? '이 브랜드의 상품명 검색' : '브랜드 · 상품명 검색'} />

      {/* 상위 카테고리 */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {[{ name: '' }, ...taxonomy].map(c => (
          <button
            key={c.name || 'all'}
            onClick={() => { setCategory(c.name); setSub(''); }}
            className={`h-9 px-4 rounded-full text-xs font-black whitespace-nowrap border transition-colors ${
              category === c.name ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            {c.name || '전체'}
          </button>
        ))}
      </div>

      {/* 하위 카테고리 — 상위를 고르면 열린다 */}
      {category && subs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto mt-2 pb-1 border-b border-slate-200" style={{ scrollbarWidth: 'none' }}>
          {['', ...subs].map(s => (
            <button
              key={s || 'all'}
              onClick={() => setSub(s)}
              className={`h-9 px-3 text-xs font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                sub === s ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              {s || `${category} 전체`}
            </button>
          ))}
        </div>
      )}

      <p className="text-[11px] font-bold text-slate-400 mt-3 mb-3">
        {category ? `${category}${sub ? ` > ${sub}` : ''} · ` : ''}상품 {total.toLocaleString('ko-KR')}개
      </p>

      {error ? (
        <p className="text-sm font-bold text-red-500 py-6">{error}</p>
      ) : loading && products.length === 0 ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : products.length === 0 ? (
        <Empty
          title={q || category ? '조건에 맞는 상품이 없어요' : '아직 판매중인 상품이 없어요'}
          desc={q || category ? '검색어나 카테고리를 바꿔 보세요.' : '브랜드가 상품을 올리면 여기에 표시됩니다.'}
        />
      ) : (
        <>
          <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 ${loading ? 'opacity-60' : ''}`}>
            {products.map(p => {
              const r = requestByProduct.get(p.id);
              return (
                <button key={p.id} onClick={() => onOpen(p)} className="text-left bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:-translate-y-0.5 hover:shadow-md transition-all">
                  <div className="relative aspect-square bg-slate-100">
                    {p.imageUrls[0] && <img src={p.imageUrls[0]} alt="" className="w-full h-full object-cover" loading="lazy" />}
                    {r && <span className={`absolute top-2 right-2 text-[10px] font-black px-2 py-1 rounded-lg ${REQUEST_STATUS_STYLE[r.status]}`}>{REQUEST_STATUS_LABEL[r.status]}</span>}
                  </div>
                  <div className="p-3">
                    <p className="text-[10px] font-bold text-slate-400 truncate">
                      {p.brandName}
                      {p.subcategory && <span className="text-slate-300"> · {p.subcategory}</span>}
                    </p>
                    <p className="text-xs md:text-sm font-black text-slate-900 line-clamp-2 min-h-[2.5em]">{p.name}</p>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      {p.retailPrice > p.salePrice && <span className="text-xs font-black text-red-500">{Math.round((1 - p.salePrice / p.retailPrice) * 100)}%</span>}
                      <span className="text-sm font-black text-slate-900">{won(p.salePrice)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {moreError && <p className="text-sm font-bold text-red-500 text-center pt-4">{moreError}</p>}
          {hasMore && <MoreButton loading={loading} label={moreError ? '다시 시도' : undefined} onClick={() => load(cursor)} />}
        </>
      )}
    </>
  );
};

// ───────────────────────────── 브랜드 목록 ─────────────────────────────

const BrandList: React.FC<{ onOpen: (b: StoreBrand) => void }> = ({ onOpen }) => {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const [brands, setBrands] = useState<StoreBrand[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (nextPage: number) => {
    const my = ++seq.current;
    setLoading(true);
    const res = await affiliateStoreService.listBrands(q, nextPage);
    if (my !== seq.current) return;
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    setBrands(prev => (nextPage === 1 ? res.brands : [...prev, ...res.brands]));
    setTotal(res.total);
    setPage(nextPage);
    setHasMore(res.hasMore);
  }, [q]);

  useEffect(() => { load(1); }, [load]);

  return (
    <>
      <SearchBox value={query} onChange={setQuery} placeholder="브랜드명 검색" />
      <p className="text-[11px] font-bold text-slate-400 mb-3">{q ? `'${q}' 검색 결과 ` : '입점 브랜드 '}{total.toLocaleString('ko-KR')}개</p>
      {error ? (
        <p className="text-sm font-bold text-red-500 py-6">{error}</p>
      ) : loading && brands.length === 0 ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : brands.length === 0 ? (
        <Empty icon={<Store className="w-8 h-8 text-slate-300 mx-auto mb-3" />} title={q ? '검색된 브랜드가 없어요' : '아직 입점한 브랜드가 없어요'} />
      ) : (
        <>
          <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 ${loading ? 'opacity-60' : ''}`}>
            {brands.map(b => (
              <button key={b.username} onClick={() => onOpen(b)} className="text-left bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3 hover:border-blue-300 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center text-base font-black shrink-0">
                  {b.brandName.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{b.brandName}</p>
                  <p className="text-[11px] text-slate-400 truncate">{b.categories.slice(0, 3).join(' · ') || '카테고리 미지정'}</p>
                  <p className="text-[11px] font-bold text-blue-600 mt-0.5">판매중 상품 {b.productCount.toLocaleString('ko-KR')}개</p>
                </div>
                <div className="flex -space-x-2 shrink-0">
                  {b.thumbs.slice(0, 3).map((t, i) => (
                    <img key={i} src={t} alt="" className="w-9 h-9 rounded-lg object-cover border-2 border-white bg-slate-100" loading="lazy" />
                  ))}
                </div>
              </button>
            ))}
          </div>
          {hasMore && <MoreButton loading={loading} onClick={() => load(page + 1)} />}
        </>
      )}
    </>
  );
};

// ───────────────────────────── 상품 상세(큰 화면) ─────────────────────────────

/** 판매 신청 이후 흐름. 상세 화면에 그대로 보여 준다. */
const FLOW_STEPS = [
  { title: '판매 신청', desc: '상품을 보고 판매 신청을 보내요.' },
  { title: '브랜드 선정', desc: '브랜드가 신청을 확인하고 함께할 크리에이터를 선정해요.' },
  { title: '판매 시작', desc: '선정되면 바로 MY 어필리에이트에서 전용 링크가 열려요.' },
];

interface DetailProps {
  product: StoreProduct;
  request?: Pick<StoreRequest, 'productId' | 'status' | 'managerStatus'>;
  onBack: () => void;
  onApply: () => void;
  onMine: () => void;
  loading: boolean;
  loadError: string;
  onRetry: () => void;
}

const ProductDetailPage: React.FC<DetailProps> = ({
  product: detail, request, onBack, onApply, onMine, loading, loadError, onRetry,
}) => {
  const [imageIndex, setImageIndex] = useState(0);
  const images = detail.imageUrls;
  const discount = detail.retailPrice > detail.salePrice ? Math.round((1 - detail.salePrice / detail.retailPrice) * 100) : 0;

  if (loading || loadError) {
    return (
      <div className="w-full min-h-[60vh]">
        <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-lg border-b border-slate-100 rounded-2xl">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <button onClick={onBack} className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors" aria-label="목록으로">
              <ArrowLeft className="w-5 h-5 text-slate-700" />
            </button>
            <h3 className="text-sm font-black text-slate-900 truncate flex-1">{detail.name}</h3>
          </div>
        </div>
        <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 text-center">
          {loading ? <Loader2 className="w-6 h-6 animate-spin text-slate-400" /> : <p className="text-sm font-bold text-red-500">{loadError}</p>}
          {loadError && <button onClick={onRetry} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in duration-300">
      {/* 상단 바 */}
      <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-lg border-b border-slate-100 rounded-2xl">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors" aria-label="목록으로">
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
          <h3 className="text-sm font-black text-slate-900 truncate flex-1">{detail.name}</h3>
          {request && (
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-black shrink-0 ${REQUEST_STATUS_STYLE[request.status]}`}>{REQUEST_STATUS_LABEL[request.status]}</span>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        {/* 이미지 — 하단 판매 신청하기 버튼과 같은 너비로, 정사각 비율을 유지한다. */}
        <div className="w-full md:px-4 md:mt-4">
          <div className="relative aspect-square bg-slate-100 overflow-hidden md:rounded-3xl md:shadow-[0_20px_44px_-20px_rgba(15,23,42,0.5)]">
            {images[imageIndex] ? (
              <img src={images[imageIndex]} alt={detail.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><ShoppingBag className="w-14 h-14 text-slate-300" /></div>
            )}
            {images.length > 1 && (
              <>
                <button
                  onClick={() => setImageIndex(i => (i - 1 + images.length) % images.length)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center"
                  aria-label="이전 이미지"
                >
                  <ChevronLeft className="w-5 h-5 text-slate-700" />
                </button>
                <button
                  onClick={() => setImageIndex(i => (i + 1) % images.length)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 shadow flex items-center justify-center"
                  aria-label="다음 이미지"
                >
                  <ChevronRight className="w-5 h-5 text-slate-700" />
                </button>
                <span className="absolute bottom-3 right-3 bg-black/55 text-white text-[10px] font-black px-2 py-1 rounded-full">{imageIndex + 1} / {images.length}</span>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto px-4 md:px-0 mt-3" style={{ scrollbarWidth: 'none' }}>
              {images.map((u, i) => (
                <button key={i} onClick={() => setImageIndex(i)} className={`w-16 h-16 rounded-xl overflow-hidden shrink-0 border-2 ${i === imageIndex ? 'border-blue-600' : 'border-transparent opacity-70'}`}>
                  <img src={u} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 md:px-8">
          {/* 기본 정보 */}
          <div className="pt-6 pb-5 border-b border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-full bg-slate-900 flex items-center justify-center shrink-0">
                <span className="text-[9px] font-black text-white">{(detail.brandName || '?').charAt(0).toUpperCase()}</span>
              </div>
              <span className="text-sm text-slate-500 font-bold">{detail.brandName}</span>
              <span className="text-xs text-slate-300">·</span>
              <span className="text-xs text-slate-400 font-bold">{detail.category}{detail.subcategory ? ` > ${detail.subcategory}` : ''}</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">{detail.name}</h1>
            {detail.summary && <p className="text-sm text-slate-500 mt-2">{detail.summary}</p>}
            <div className="flex items-baseline gap-2 mt-4">
              {discount > 0 && <span className="text-lg font-black text-red-500">{discount}%</span>}
              <span className="text-2xl font-black text-slate-900">{won(detail.salePrice)}</span>
              {discount > 0 && <span className="text-sm text-slate-400 line-through">{won(detail.retailPrice)}</span>}
            </div>
            {detail.commissionRate > 0 && (
              <div className="mt-4 rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-black text-blue-600">인플루언서 수수료</p>
                  <p className="text-[11px] text-blue-500/80 mt-0.5">판매가 {won(detail.salePrice)} 기준</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xl font-black text-blue-600">{detail.commissionRate}%</span>
                  <p className="text-xs font-black text-slate-700">1개당 {won(Math.floor(detail.salePrice * detail.commissionRate / 100))}</p>
                </div>
              </div>
            )}
          </div>

          {/* 옵션 — 재고 · 배송비는 브랜드만 관리해 여기서는 보여 주지 않는다. */}
          {detail.options.length > 0 && (
            <div className="py-5 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 mb-3">옵션</h3>
              <div className="flex flex-wrap gap-1.5">
                {detail.options.map((o, i) => (
                  <span key={i} className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${o.soldOut ? 'border-slate-100 text-slate-300' : 'border-slate-200 text-slate-600'}`}>
                    {o.name}{o.soldOut ? ' (품절)' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {[
            { title: '상품 설명', body: detail.description || '', images: detail.descriptionImageUrls || [] },
            { title: '사이즈 가이드', body: detail.sizeGuide || '', images: detail.sizeGuideImageUrls || [] },
            { title: '배송 · 반품 안내', body: detail.deliveryGuide || '', images: detail.deliveryGuideImageUrls || [] },
          ].filter(b => b.body.trim() || b.images.length > 0).map(b => (
            <div key={b.title} className="py-5 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 mb-3">{b.title}</h3>
              {b.body.trim() && (
                <div className="bg-slate-50 rounded-2xl p-5 md:p-6 border border-slate-100">
                  <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-[1.8] break-words">{b.body}</p>
                </div>
              )}
              {b.images.length > 0 && (
                <div className={`-mx-4 md:mx-0 md:rounded-2xl overflow-hidden border-y md:border border-slate-100 bg-white ${b.body.trim() ? 'mt-3' : ''}`}>
                  {b.images.map((u, i) => (
                    <img key={u + i} src={u} alt={`${b.title} ${i + 1}`} className="block w-full h-auto" loading="lazy" />
                  ))}
                </div>
              )}
            </div>
          ))}

          {(detail.detailImageUrls?.length || 0) > 0 && (
            <div className="py-5 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 mb-3">상세페이지</h3>
              <div className="-mx-4 md:mx-0 md:rounded-2xl overflow-hidden border-y md:border border-slate-100 bg-white">
                {detail.detailImageUrls.map((u, i) => (
                  <img key={u + i} src={u} alt={`${detail.name} 상세 ${i + 1}`} className="block w-full h-auto" loading="lazy" />
                ))}
              </div>
            </div>
          )}

          {detail.productUrl && (
            <div className="py-4 border-b border-slate-100">
              <a href={detail.productUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-blue-600">
                브랜드 상품 페이지 보기 <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}

          {/* 진행 방식 */}
          <div className="py-5 border-b border-slate-100">
            <h3 className="text-sm font-black text-slate-900 mb-4">진행 방식</h3>
            <ol className="relative pl-6 space-y-4">
              <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-slate-200" />
              {FLOW_STEPS.map((step, i) => (
                <li key={step.title} className="relative">
                  <div className="absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full border-2 border-blue-500 bg-white flex items-center justify-center text-[9px] font-black text-blue-600">{i + 1}</div>
                  <p className="text-xs font-black text-slate-900">{step.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{step.desc}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* 판매 신청 */}
          <div className="py-6">
            {request ? (
              <div className="bg-slate-50 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-slate-700">이미 판매 신청한 상품이에요</p>
                  <div className="flex gap-1.5">
                    <span className={`px-2 py-1 rounded-md text-[11px] font-black ${REQUEST_STATUS_STYLE[request.status]}`}>{REQUEST_STATUS_LABEL[request.status]}</span>
                    {request.status === 'approved' && request.managerStatus && (
                      <span className={`px-2 py-1 rounded-md text-[11px] font-black ${MANAGER_STATUS_STYLE[request.managerStatus]}`}>{MANAGER_STATUS_LABEL[request.managerStatus]}</span>
                    )}
                  </div>
                </div>
                {request.status === 'approved' && request.managerStatus !== 'done' && (
                  <p className="text-xs text-blue-600 font-bold mt-2">브랜드에 선정되었어요. MY 어필리에이트에서 전용 링크를 확인하세요.</p>
                )}
                <button onClick={onMine} className="mt-3 text-xs font-black text-slate-600 underline">내 신청 보기</button>
              </div>
            ) : (
              <>
                <h3 className="text-base font-black text-slate-900 mb-1">판매 신청</h3>
                <p className="text-xs text-slate-500">아래 지원하기를 누르면 연동한 인스타그램 계정으로 바로 지원돼요. 브랜드가 선정하면 바로 전용 판매 링크가 열려요.</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 하단 고정 버튼 */}
      {!request && (
        <div className="sticky bottom-0 z-20 bg-white/95 backdrop-blur border-t border-slate-100">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <button
              onClick={onApply}
              className="w-full h-12 rounded-xl bg-blue-600 text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
            >
              지원하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ───────────────────────────── 지원하기 시트 ─────────────────────────────

/**
 * 인스타그램 연동을 마치고 돌아올 때 쓰는 표시와 임시 저장.
 * 연동은 메타로 나갔다 돌아오는 흐름이라 페이지가 새로 뜨므로, 보고 있던 상품을
 * 적어 두었다가 돌아오면 같은 상품의 지원하기 창을 다시 연다.
 */
const IG_RETURN_FLAG = 'ig_affiliate';
const APPLY_DRAFT_KEY = 'picks_affiliate_apply_draft_v1';

interface ApplyDraft { product: StoreProduct }

const IG_ERROR_TEXT: Record<string, string> = {
  state_browser_mismatch: '연동하기를 누른 브라우저(또는 앱)와 다른 곳에서 동의가 끝나 연동하지 않았어요. 연동하기를 누른 곳에서 다시 시도해 주세요.',
  not_professional_account: '개인 계정이나 비공개 계정은 연동할 수 없어요. 인스타그램 앱의 설정 → 계정 유형 및 도구에서 프로페셔널 계정(크리에이터 또는 비즈니스)으로 전환한 뒤 다시 연동해 주세요.',
  missing_permissions: '인스타그램 동의 화면에서 일부 권한이 꺼진 채로 진행돼 연동하지 않았어요. 다시 연동하면서 모든 항목을 허용해 주세요.',
};

interface IgState { status: 'loading' | 'linked' | 'reauth' | 'none' | 'error'; handle: string; followers: number }

interface ApplySheetProps {
  userName: string;
  product: StoreProduct;
  sending: boolean;
  sendError: string;
  notice: string;
  /** 연동 직후 돌아왔을 때 콜백이 실어 보낸 아이디. 서버 응답 전 첫 화면을 채운다. */
  initialHandle?: string;
  onClose: () => void;
  onSubmit: (channelUrl: string) => void;
}

const ApplySheet: React.FC<ApplySheetProps> = ({
  userName, product, sending, sendError, notice, initialHandle, onClose, onSubmit,
}) => {
  const [ig, setIg] = useState<IgState>(
    initialHandle ? { status: 'linked', handle: initialHandle, followers: 0 } : { status: 'loading', handle: '', followers: 0 },
  );
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  useCloseOnBack(true, onClose);

  // 연동 상태는 자동 디엠 · 인사이트 · 브랜드 매칭받기와 함께 쓰는 하나다. 창을 열 때마다 서버에 묻는다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await apiService.getCreatorChannel(userName);
      if (!alive) return;
      if (res?.error) {
        setIg(prev => (prev.status === 'linked' ? prev : { status: 'error', handle: '', followers: 0 }));
        return;
      }
      const c = res?.channel || {};
      const handle = String(res?.igUsername || c.instagramHandle || '');
      const followers = Number(c.followers || 0);
      if (res?.metaLinked) setIg({ status: 'linked', handle, followers });
      else if (res?.needsReauth) setIg({ status: 'reauth', handle, followers });
      else setIg({ status: 'none', handle: '', followers: 0 });
    })();
    return () => { alive = false; };
  }, [userName]);

  const connect = async () => {
    setLinking(true);
    setLinkError('');
    try {
      sessionStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify({ product } satisfies ApplyDraft));
    } catch {
      // 임시 저장이 막혀도 연동은 진행한다. 돌아와서 상품을 다시 고르면 된다.
    }
    const returnTo = `${window.location.pathname}?${IG_RETURN_FLAG}=1`;
    const res = await apiService.instagramConnectUrl(userName, returnTo);
    if (!res.url) {
      setLinking(false);
      setLinkError(res.error || '연동을 시작하지 못했습니다.');
      return;
    }
    window.location.href = res.url;
  };

  const linked = ig.status === 'linked';
  const channelUrl = ig.handle ? `https://www.instagram.com/${ig.handle.replace(/^@/, '')}` : '';

  return (
    <div className="fixed inset-0 z-[190] flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="modal-card relative w-full md:max-w-lg bg-white rounded-t-3xl md:rounded-3xl shadow-[0_-18px_44px_-16px_rgba(15,23,42,0.55)] max-h-[85vh] modal-maxh-85 overflow-hidden sheet-rise flex flex-col">
        <div className="shrink-0 px-5 pt-3 pb-4 border-b border-slate-100">
          <div className="md:hidden w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-3" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900">{linked ? '판매 지원하기' : '인스타그램 연동하기'}</h3>
              <p className="text-xs text-slate-400 font-medium mt-1 truncate">{product.brandName} · {product.name}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="shrink-0 w-11 h-11 md:w-9 md:h-9 -mt-1.5 -mr-2 md:mt-0 md:mr-0 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="modal-body flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {notice && (
            <p className={`text-xs font-bold rounded-xl px-3.5 py-2.5 ${notice.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{notice.replace(/^✓\s*/, '')}</p>
          )}

          {ig.status === 'loading' && (
            <div className="py-10 flex flex-col items-center gap-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-xs font-bold">인스타그램 연동 상태를 확인하고 있어요</p>
            </div>
          )}

          {linked && (
            <>
              <div className="flex items-center gap-3 bg-slate-50 rounded-2xl p-4">
                <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 flex items-center justify-center shrink-0">
                  <Instagram className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 truncate">{ig.handle ? `@${ig.handle.replace(/^@/, '')}` : '연동된 계정'}</p>
                  <p className="text-[11px] text-slate-500 font-bold">
                    {ig.followers > 0 ? `팔로워 ${ig.followers.toLocaleString('ko-KR')}명 · ` : ''}이 계정으로 지원돼요
                  </p>
                </div>
                <span className="px-2 py-1 rounded-md text-[10px] font-black bg-emerald-50 text-emerald-600 shrink-0">연동됨</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">브랜드는 이 계정의 프로필과 최근 릴스 3편을 보고 함께할 크리에이터를 선정해요.</p>
              <p className="text-[11px] text-slate-400">브랜드가 선정하면 바로 전용 판매 링크가 열려요.</p>
              {sendError && <p className="text-xs font-bold text-red-500">{sendError}</p>}
            </>
          )}

          {(ig.status === 'none' || ig.status === 'reauth' || ig.status === 'error') && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-pink-500/20">
                <Instagram className="w-7 h-7 text-white" />
              </div>
              <p className="text-sm font-black text-slate-900">
                {ig.status === 'reauth' ? '인스타그램 연동이 만료되었어요' : ig.status === 'error' ? '연동 상태를 확인하지 못했어요' : '인스타그램 연동이 필요해요'}
              </p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed whitespace-pre-line">
                {ig.status === 'reauth'
                  ? `${ig.handle ? `@${ig.handle.replace(/^@/, '')} ` : ''}계정을 다시 연동하면 바로 지원할 수 있어요.`
                  : '어필리에이트는 연동한 인스타그램 계정으로 지원해요.\n한 번 연동하면 다음부터는 바로 지원돼요.'}
              </p>
              {linkError && <p className="text-xs font-bold text-red-500 mt-3">{linkError}</p>}
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-slate-100 flex gap-2">
          <button onClick={onClose} className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 shrink-0">취소</button>
          {linked ? (
            <button
              onClick={() => onSubmit(channelUrl)}
              disabled={sending}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_10px_24px_-10px_rgba(37,99,235,0.75)]"
            >
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}
              {sending ? '지원 중...' : '지원하기'}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={linking || ig.status === 'loading'}
              className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 text-white py-3.5 rounded-xl font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
              {ig.status === 'reauth' ? '인스타 다시 연동하기' : '인스타 연동하기'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ───────────────────────────── 화면 ─────────────────────────────

const CreatorAffiliateStore: React.FC<{ userName: string }> = ({ userName }) => (
  <main className="p-4 md:p-14 w-full">
    <CreatorApplicationGate feature="어필리에이트">
      <AffiliateStoreBody userName={userName} />
    </CreatorApplicationGate>
  </main>
);

const AffiliateStoreBody: React.FC<{ userName: string }> = ({ userName }) => {
  const [tab, setTab] = useState<'products' | 'brands' | 'my' | 'mine' | 'payouts'>('products');
  const [taxonomy, setTaxonomy] = useState<CategoryNode[]>([]);
  // 화면에 나온 상품의 내 신청 상태(상품 id → 상태)와 "내 신청" 전체 건수(서버가 센 값).
  const [requestStatusMap, setRequestStatusMap] = useState<Map<string, Pick<StoreRequest, 'productId' | 'status' | 'managerStatus'>>>(new Map());
  const [requestTotal, setRequestTotal] = useState(0);
  const [mineRequests, setMineRequests] = useState<StoreRequest[]>([]);
  const [mineCursor, setMineCursor] = useState<ListCursor | null>(null);
  const [mineHasMore, setMineHasMore] = useState(false);
  const [mineLoaded, setMineLoaded] = useState(false);
  const [mineLoading, setMineLoading] = useState(false);
  const [mineError, setMineError] = useState('');
  const [brandPage, setBrandPage] = useState<StoreBrand | null>(null);
  const [brandInfo, setBrandInfo] = useState<BrandInfo | null>(null);
  const [detail, setDetail] = useState<StoreProduct | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailLoadSeq = useRef(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyNotice, setApplyNotice] = useState('');
  const [returnedHandle, setReturnedHandle] = useState('');

  // 인스타그램 연동을 마치고 돌아온 경우 — 보던 상품의 지원하기 창을 다시 연다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get(IG_RETURN_FLAG)) return;
    let draft: ApplyDraft | null = null;
    try {
      const raw = sessionStorage.getItem(APPLY_DRAFT_KEY);
      draft = raw ? (JSON.parse(raw) as ApplyDraft) : null;
      sessionStorage.removeItem(APPLY_DRAFT_KEY);
    } catch {
      draft = null;
    }
    const failed = params.get('ig_error');
    if (draft?.product?.id) {
      setDetail(draft.product);
      setApplyNotice(
        failed
          ? IG_ERROR_TEXT[failed] || '인스타그램 연동에 실패했어요. 다시 시도해 주세요.'
          : params.get('ig_connected') ? '✓ 인스타그램 계정이 연동되었어요. 이제 바로 지원할 수 있어요.' : '',
      );
      if (!failed && params.get('ig_connected')) setReturnedHandle(params.get('ig_handle') || '');
      setApplyOpen(true);
    }
    [IG_RETURN_FLAG, 'ig_connected', 'ig_error', 'ig_metrics', 'ig_handle', 'ig_followers', 'ig_following', 'ig_views']
      .forEach(k => params.delete(k));
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);

  /** 지정한 상품들의 내 신청 상태 + 전체 건수를 받아 합친다(한 번에 최대 100개씩). */
  const loadRequestStatuses = useCallback(async (productIds: string[] = []) => {
    const chunks: string[][] = [];
    for (let i = 0; i < productIds.length; i += 100) chunks.push(productIds.slice(i, i + 100));
    if (chunks.length === 0) chunks.push([]);
    for (const ids of chunks) {
      const res = await affiliateStoreService.myRequestStatuses(ids);
      if (res.error) continue;
      setRequestTotal(res.total);
      if (ids.length === 0) continue;
      setRequestStatusMap(prev => {
        const next = new Map(prev);
        for (const id of ids) next.delete(id);
        for (const r of res.requests || []) next.set(r.productId, r);
        return next;
      });
    }
  }, []);
  useEffect(() => {
    setRequestStatusMap(new Map());
    setRequestTotal(0);
    setMineRequests([]);
    setMineLoaded(false);
    setMineError('');
    void loadRequestStatuses();
  }, [loadRequestStatuses, userName]);

  const loadMineRequests = useCallback(async (cursor?: ListCursor | null) => {
    const append = !!cursor;
    setMineLoading(true);
    setMineError('');
    const res = await affiliateStoreService.myRequests(cursor);
    setMineLoading(false);
    if (res.error) { setMineError(res.error); return; }
    setMineRequests(prev => {
      if (!append) return res.requests || [];
      const seen = new Set(prev.map(r => r.id));
      return [...prev, ...(res.requests || []).filter(r => !seen.has(r.id))];
    });
    setMineCursor(res.nextCursor || null);
    setMineHasMore(res.hasMore);
    setMineLoaded(true);
  }, []);

  useEffect(() => {
    if (tab === 'mine' && !mineLoaded && !mineLoading && !mineError) void loadMineRequests();
  }, [tab, mineLoaded, mineLoading, mineError, loadMineRequests]);

  const requestByProduct = requestStatusMap;
  // 상세를 열면(인스타 연동 뒤 돌아온 경우 포함) 그 상품의 신청 상태를 확인한다.
  const detailId = detail?.id || '';
  useEffect(() => { if (detailId) void loadRequestStatuses([detailId]); }, [detailId, loadRequestStatuses]);

  const openDetail = async (p: StoreProduct) => {
    const seq = ++detailLoadSeq.current;
    setDetail(p); setDetailLoading(true); setDetailError(''); setSendError(''); setApplyOpen(false); setApplyNotice(''); setReturnedHandle('');
    window.scrollTo({ top: 0 });
    const res = await affiliateStoreService.productDetail(p.id);
    if (seq !== detailLoadSeq.current) return;
    setDetailLoading(false);
    if (res.error || !res.product) { setDetailError(res.error || '상품 정보를 불러오지 못했습니다.'); return; }
    setDetail(res.product);
  };
  const closeDetail = () => {
    detailLoadSeq.current += 1;
    setDetail(null);
    setDetailLoading(false);
    setDetailError('');
  };

  const send = async (channelUrl: string) => {
    if (!detail) return;
    setSending(true);
    setSendError('');
    const res = await affiliateStoreService.request(detail.id, '', channelUrl);
    setSending(false);
    if (res.error) { setSendError(res.error); return; }
    setApplyOpen(false);
    setApplyNotice('');
    await loadRequestStatuses([detail.id]);
    if (mineLoaded) await loadMineRequests();
  };
  const openApply = () => { setSendError(''); setApplyNotice(''); setApplyOpen(true); };
  const closeApply = () => setApplyOpen(false);

  const cancel = async (r: StoreRequest) => {
    if (!window.confirm('이 판매 신청을 취소할까요?')) return;
    const res = await affiliateStoreService.cancelRequest(r.id);
    if (res.error) window.alert(res.error);
    else {
      // 취소한 신청만 목록에서 빼고, 그 상품의 상태와 건수만 새로 받는다.
      setMineRequests(prev => prev.filter(x => x.id !== r.id));
      await loadRequestStatuses([r.productId]);
    }
  };

  const switchTab = (t: typeof tab) => { setTab(t); setBrandPage(null); setBrandInfo(null); };
  const detailRequest = detail ? requestByProduct.get(detail.id) : undefined;

  return (
    <>
      {detail && (
        <ProductDetailPage
          product={detail}
          request={detailRequest}
          loading={detailLoading}
          loadError={detailError}
          onRetry={() => { void openDetail(detail); }}
          onBack={closeDetail}
          onApply={openApply}
          onMine={() => { closeDetail(); switchTab('mine'); }}
        />
      )}
      {detail && applyOpen && !detailRequest && (
        <ApplySheet
          userName={userName}
          product={detail}
          sending={sending}
          sendError={sendError}
          notice={applyNotice}
          initialHandle={returnedHandle}
          onClose={closeApply}
          onSubmit={send}
        />
      )}
      {/* 상세를 보는 동안 목록은 숨겨 두기만 한다 — 돌아왔을 때 검색어 · 카테고리 · 더 보기가 그대로 남게. */}
      <div className={detail ? 'hidden' : ''}>
      <header className="mb-5">
        <p className="text-[10px] font-black tracking-[0.2em] text-blue-500 uppercase mb-1">Affiliate</p>
        <h2 className="text-xl md:text-3xl font-black text-slate-900">어필리에이트</h2>
        <p className="text-xs md:text-sm text-slate-500 mt-1">브랜드 상품을 골라 판매 신청하고, 판매한 만큼 수수료를 받으세요.</p>
      </header>

      <div className="flex gap-1 mb-5 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {([
          { key: 'products', label: '상품' },
          { key: 'brands', label: '브랜드' },
          { key: 'my', label: 'MY 어필리에이트' },
          { key: 'mine', label: `내 신청 ${requestTotal.toLocaleString('ko-KR')}` },
          { key: 'payouts', label: '정산' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)} className={`h-9 px-4 rounded-lg text-xs font-black whitespace-nowrap ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <ProductList taxonomy={taxonomy} onTaxonomy={setTaxonomy} requestByProduct={requestByProduct} onOpen={openDetail} onProductsLoaded={loadRequestStatuses} />
      )}

      {tab === 'brands' && !brandPage && <BrandList onOpen={setBrandPage} />}

      {tab === 'brands' && brandPage && (
        <>
          <button onClick={() => { setBrandPage(null); setBrandInfo(null); }} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4" /> 브랜드 목록
          </button>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mb-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl font-black shrink-0">
              {brandPage.brandName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-black text-slate-900 truncate">{brandPage.brandName}</p>
              <p className="text-xs text-slate-400 truncate">{(brandInfo?.categories || brandPage.categories).join(' · ')}</p>
              {brandInfo?.channelUrl && (
                <a href={brandInfo.channelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 mt-1">
                  판매 채널 보기 <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
          <ProductList
            key={brandPage.username}
            taxonomy={taxonomy}
            onTaxonomy={setTaxonomy}
            requestByProduct={requestByProduct}
            onOpen={openDetail}
            brand={brandPage.username}
            onBrandInfo={setBrandInfo}
            onProductsLoaded={loadRequestStatuses}
          />
        </>
      )}

      {tab === 'my' && <MyAffiliate onBrowse={() => switchTab('products')} />}
      {tab === 'payouts' && <AffiliatePayouts as="influencer" />}

      {tab === 'mine' && (
        mineLoading && mineRequests.length === 0 ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : mineError && mineRequests.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm font-bold text-red-500 mb-3">{mineError}</p>
            <button onClick={() => { void loadMineRequests(); }} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>
          </div>
        ) : mineRequests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <p className="text-sm font-black text-slate-700">아직 신청한 상품이 없어요</p>
            <button onClick={() => switchTab('products')} className="mt-4 h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-black">상품 둘러보기</button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {mineRequests.map(r => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
                {r.productImage && <img src={r.productImage} alt="" className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 truncate">{r.brandName}</p>
                  <p className="text-sm font-black text-slate-900 truncate">{r.productName}</p>
                  {r.status === 'rejected' && r.brandNote && <p className="text-[11px] text-red-500 mt-0.5 line-clamp-2">반려 사유: {r.brandNote}</p>}
                  {r.status === 'approved' && (
                    r.managerStatus === 'done'
                      ? <p className="text-[11px] text-emerald-600 font-bold mt-0.5">브랜드에 선정되었어요! MY 어필리에이트에서 전용 링크를 받아 판매를 시작하세요.</p>
                      : <p className="text-[11px] text-blue-600 font-bold mt-0.5">브랜드에 선정되었어요! 전용 링크를 준비하고 있어요.</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`px-2 py-1 rounded-md text-[10px] font-black ${REQUEST_STATUS_STYLE[r.status]}`}>{REQUEST_STATUS_LABEL[r.status]}</span>
                  {r.status === 'approved' && r.managerStatus && (
                    <span className={`px-2 py-1 rounded-md text-[10px] font-black ${MANAGER_STATUS_STYLE[r.managerStatus]}`}>{MANAGER_STATUS_LABEL[r.managerStatus]}</span>
                  )}
                  {r.status === 'pending' && <button onClick={() => cancel(r)} className="text-[11px] font-bold text-slate-400 hover:text-red-500">신청 취소</button>}
                </div>
              </div>
            ))}
            {mineError && <p className="text-sm font-bold text-red-500 text-center py-2">{mineError}</p>}
            {mineHasMore && <MoreButton loading={mineLoading} label={mineError ? '다시 시도' : undefined} onClick={() => { void loadMineRequests(mineCursor); }} />}
          </div>
        )
      )}

      </div>
    </>
  );
};

export default CreatorAffiliateStore;
