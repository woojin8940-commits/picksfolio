import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2, Search, ShoppingBag, Store, X } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  REQUEST_STATUS_LABEL,
  type BrandInfo,
  type CategoryNode,
  type StoreBrand,
  type StoreProduct,
  type StoreRequest,
} from '../../services/affiliateStoreService';
import MyAffiliate from './MyAffiliate';

/**
 * 인플루언서 어필리에이트 메뉴.
 *
 *   상품    상위(뷰티 · 패션 · 스킨케어 · 라이프스타일) → 하위(TOP · BOTTOM · OUTER …)
 *           카테고리와 검색어(상품명 · 브랜드명)로 판매중인 상품을 찾는다.
 *   브랜드  입점한 브랜드 전체. 수천 개가 될 것이라 검색 + 더 보기로 나눠 읽는다.
 *           브랜드를 누르면 그 브랜드의 상품만 본다.
 *   내 신청 브랜드의 승인 · 반려 결과.
 *
 * 목록은 서버에서 거르고 페이지로 받는다(api-affiliate-store scope=creator · brands).
 */

const REQUEST_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
  cancelled: 'bg-slate-100 text-slate-400',
};

const commissionOf = (p: StoreProduct) => Math.floor((p.salePrice * p.commissionRate) / 100);

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

const MoreButton: React.FC<{ loading: boolean; onClick: () => void }> = ({ loading, onClick }) => (
  <div className="flex justify-center mt-6">
    <button onClick={onClick} disabled={loading} className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      더 보기
    </button>
  </div>
);

// ───────────────────────────── 상품 목록 ─────────────────────────────

interface ProductListProps {
  taxonomy: CategoryNode[];
  onTaxonomy: (t: CategoryNode[]) => void;
  requestByProduct: Map<string, StoreRequest>;
  onOpen: (p: StoreProduct) => void;
  /** 이 브랜드의 상품만 본다(브랜드 페이지). */
  brand?: string;
  onBrandInfo?: (b: BrandInfo | null) => void;
}

const ProductList: React.FC<ProductListProps> = ({ taxonomy, onTaxonomy, requestByProduct, onOpen, brand, onBrandInfo }) => {
  const [category, setCategory] = useState('');
  const [sub, setSub] = useState('');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (nextPage: number) => {
    const my = ++seq.current;
    setLoading(true);
    const res = await affiliateStoreService.listProducts({ category, sub, q, brand, page: nextPage });
    if (my !== seq.current) return; // 그사이 조건이 바뀌었다
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    setProducts(prev => (nextPage === 1 ? res.products : [...prev, ...res.products]));
    setTotal(res.total);
    setPage(nextPage);
    setHasMore(res.hasMore);
    if (res.taxonomy?.length) onTaxonomy(res.taxonomy);
    onBrandInfo?.(res.brand);
  }, [category, sub, q, brand, onTaxonomy, onBrandInfo]);

  useEffect(() => { load(1); }, [load]);

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
          <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4 ${loading ? 'opacity-60' : ''}`}>
            {products.map(p => {
              const r = requestByProduct.get(p.id);
              return (
                <button key={p.id} onClick={() => onOpen(p)} className="text-left bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden hover:-translate-y-0.5 hover:shadow-md transition-all">
                  <div className="relative aspect-square bg-slate-100">
                    {p.imageUrls[0] && <img src={p.imageUrls[0]} alt="" className="w-full h-full object-cover" loading="lazy" />}
                    <span className="absolute top-2 left-2 bg-blue-600 text-white text-[10px] font-black px-2 py-1 rounded-lg">수수료 {p.commissionRate}%</span>
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
                    <p className="text-[11px] font-bold text-blue-600 mt-1">개당 약 {won(commissionOf(p))} 수익</p>
                  </div>
                </button>
              );
            })}
          </div>
          {hasMore && <MoreButton loading={loading} onClick={() => load(page + 1)} />}
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

// ───────────────────────────── 화면 ─────────────────────────────

const CreatorAffiliateStore: React.FC<{ userName: string }> = ({ userName }) => {
  const [tab, setTab] = useState<'products' | 'brands' | 'my' | 'mine'>('products');
  const [taxonomy, setTaxonomy] = useState<CategoryNode[]>([]);
  const [requests, setRequests] = useState<StoreRequest[]>([]);
  const [brandPage, setBrandPage] = useState<StoreBrand | null>(null);
  const [brandInfo, setBrandInfo] = useState<BrandInfo | null>(null);
  const [detail, setDetail] = useState<StoreProduct | null>(null);
  const [message, setMessage] = useState('');
  const [channelUrl, setChannelUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const loadRequests = useCallback(async () => {
    const res = await affiliateStoreService.myRequests();
    if (!res.error) setRequests(res.requests || []);
  }, []);
  useEffect(() => { loadRequests(); }, [loadRequests, userName]);

  const requestByProduct = useMemo(() => {
    const m = new Map<string, StoreRequest>();
    for (const r of requests) if (r.status !== 'cancelled') m.set(r.productId, r);
    return m;
  }, [requests]);
  const activeRequests = requests.filter(r => r.status !== 'cancelled');

  const openDetail = (p: StoreProduct) => { setDetail(p); setMessage(''); setSendError(''); };

  const send = async () => {
    if (!detail) return;
    setSending(true);
    setSendError('');
    const res = await affiliateStoreService.request(detail.id, message, channelUrl);
    setSending(false);
    if (res.error) { setSendError(res.error); return; }
    setDetail(null);
    loadRequests();
  };

  const cancel = async (r: StoreRequest) => {
    if (!window.confirm('이 판매 신청을 취소할까요?')) return;
    const res = await affiliateStoreService.cancelRequest(r.id);
    if (res.error) window.alert(res.error);
    else loadRequests();
  };

  const switchTab = (t: typeof tab) => { setTab(t); setBrandPage(null); setBrandInfo(null); };
  const detailRequest = detail ? requestByProduct.get(detail.id) : undefined;

  return (
    <main className="p-4 md:p-14 w-full">
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
          { key: 'mine', label: `내 신청 ${activeRequests.length}` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)} className={`h-9 px-4 rounded-lg text-xs font-black whitespace-nowrap ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <ProductList taxonomy={taxonomy} onTaxonomy={setTaxonomy} requestByProduct={requestByProduct} onOpen={openDetail} />
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
          />
        </>
      )}

      {tab === 'my' && <MyAffiliate onBrowse={() => switchTab('products')} />}

      {tab === 'mine' && (
        activeRequests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <p className="text-sm font-black text-slate-700">아직 신청한 상품이 없어요</p>
            <button onClick={() => switchTab('products')} className="mt-4 h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-black">상품 둘러보기</button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {activeRequests.map(r => (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
                {r.productImage && <img src={r.productImage} alt="" className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 truncate">{r.brandName}</p>
                  <p className="text-sm font-black text-slate-900 truncate">{r.productName}</p>
                  {r.status === 'rejected' && r.brandNote && <p className="text-[11px] text-red-500 mt-0.5 line-clamp-2">반려 사유: {r.brandNote}</p>}
                  {r.status === 'approved' && <p className="text-[11px] text-emerald-600 font-bold mt-0.5">선정되었어요! MY 어필리에이트에서 전용 링크를 받아 판매를 시작하세요.</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`px-2 py-1 rounded-md text-[10px] font-black ${REQUEST_STATUS_STYLE[r.status]}`}>{REQUEST_STATUS_LABEL[r.status]}</span>
                  {r.status === 'pending' && <button onClick={() => cancel(r)} className="text-[11px] font-bold text-slate-400 hover:text-red-500">신청 취소</button>}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* 상품 상세 + 판매 신청 */}
      {detail && (
        <div className="fixed inset-0 z-[300] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetail(null)} />
          <div className="relative bg-white w-full md:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl md:rounded-3xl">
            <button onClick={() => setDetail(null)} className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/50 text-white flex items-center justify-center" aria-label="닫기">
              <X className="w-4 h-4" />
            </button>
            <div className="flex overflow-x-auto snap-x snap-mandatory bg-slate-100" style={{ scrollbarWidth: 'none' }}>
              {detail.imageUrls.map((u, i) => (
                <img key={i} src={u} alt="" className="w-full aspect-square md:aspect-[4/3] object-cover shrink-0 snap-center" />
              ))}
            </div>
            <div className="p-5 md:p-7">
              <p className="text-xs font-bold text-slate-400">
                {detail.brandName} · {detail.category}{detail.subcategory ? ` > ${detail.subcategory}` : ''}
              </p>
              <h3 className="text-lg md:text-xl font-black text-slate-900 mt-0.5">{detail.name}</h3>
              {detail.summary && <p className="text-sm text-slate-500 mt-1">{detail.summary}</p>}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-5">
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] font-bold text-slate-400">판매가</p><p className="text-sm font-black text-slate-900">{won(detail.salePrice)}</p>{detail.retailPrice > detail.salePrice && <p className="text-[10px] text-slate-400 line-through">{won(detail.retailPrice)}</p>}</div>
                <div className="bg-blue-50 rounded-xl p-3"><p className="text-[10px] font-bold text-blue-400">수수료</p><p className="text-sm font-black text-blue-700">{detail.commissionRate}%</p><p className="text-[10px] text-blue-500">개당 {won(commissionOf(detail))}</p></div>
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] font-bold text-slate-400">재고</p><p className="text-sm font-black text-slate-900">{detail.stock.toLocaleString('ko-KR')}개</p></div>
                <div className="bg-slate-50 rounded-xl p-3"><p className="text-[10px] font-bold text-slate-400">배송비</p><p className="text-sm font-black text-slate-900">{detail.shippingFee ? won(detail.shippingFee) : '무료'}</p></div>
              </div>

              {detail.options.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-black text-slate-700 mb-2">옵션</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.options.map((o, i) => (
                      <span key={i} className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${o.stock > 0 ? 'border-slate-200 text-slate-600' : 'border-slate-100 text-slate-300 line-through'}`}>
                        {o.name} · {o.stock}개
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.description && (
                <div className="mt-5">
                  <p className="text-xs font-black text-slate-700 mb-2">상세 설명</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{detail.description}</p>
                </div>
              )}
              {detail.productUrl && (
                <a href={detail.productUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-4 text-xs font-bold text-blue-600">
                  상품 페이지 보기 <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              <div className="border-t border-slate-100 mt-6 pt-5">
                {detailRequest ? (
                  <div className="flex items-center justify-between gap-3 bg-slate-50 rounded-xl p-4">
                    <p className="text-sm font-black text-slate-700">이미 판매 신청한 상품이에요</p>
                    <span className={`px-2 py-1 rounded-md text-[11px] font-black ${REQUEST_STATUS_STYLE[detailRequest.status]}`}>{REQUEST_STATUS_LABEL[detailRequest.status]}</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-black text-slate-900 mb-3">판매 신청</p>
                    <input
                      value={channelUrl}
                      onChange={e => setChannelUrl(e.target.value.trim())}
                      placeholder="판매할 채널 주소 (선택) https://instagram.com/..."
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 mb-2 focus:outline-none focus:border-blue-600"
                    />
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      maxLength={1000}
                      placeholder="브랜드에 전할 말 (선택) — 콘텐츠 계획, 판매 예정일 등"
                      className="w-full min-h-[90px] p-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                    {sendError && <p className="text-xs font-bold text-red-500 mt-2">{sendError}</p>}
                    <button onClick={send} disabled={sending} className="mt-3 w-full h-12 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50 flex items-center justify-center gap-2">
                      {sending && <Loader2 className="w-4 h-4 animate-spin" />}
                      판매 신청하기
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default CreatorAffiliateStore;
