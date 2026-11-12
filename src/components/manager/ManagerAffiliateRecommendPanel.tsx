import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  SALE_STATE_LABEL,
  SALE_STATE_STYLE,
  type AffiliateRecommendation,
  type CategoryNode,
  type ListCursor,
  type RecommendCreator,
  type StoreProduct,
} from '../../services/affiliateStoreService';

/**
 * 담당자 대시보드 › 추천 어필리에이트.
 *
 * 담당자가 인플루언서를 고르고, 그 사람에게 어울리는 어필리에이트 상품을 골라 리스트업한다.
 * 인플루언서는 MY 어필리에이트 › 추천 어필리에이트 탭에서 이 목록을 보고 바로 판매 신청한다.
 * 상품마다 한마디(추천 이유)를 남길 수 있고, 같은 상품을 다시 추천하면 한 번만 남는다.
 */

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const REQUEST_LABEL: Record<string, string> = { pending: '신청함', approved: '선정됨', rejected: '미선정' };

const handleOf = (c: RecommendCreator) => {
  const m = c.instagramUrl.match(/instagram\.com\/([^/?#]+)/i);
  return m ? `@${m[1]}` : '';
};

interface Props {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const ManagerAffiliateRecommendPanel: React.FC<Props> = ({ onNotify }) => {
  // ── 인플루언서 ──
  const [creatorQuery, setCreatorQuery] = useState('');
  const cq = useDebounced(creatorQuery.trim());
  const [creators, setCreators] = useState<RecommendCreator[]>([]);
  const [creatorsLoading, setCreatorsLoading] = useState(true);
  const [creatorsError, setCreatorsError] = useState('');
  const [selected, setSelected] = useState<RecommendCreator | null>(null);

  useEffect(() => {
    let alive = true;
    setCreatorsLoading(true);
    affiliateStoreService.recommendCreators(cq).then(res => {
      if (!alive) return;
      setCreatorsLoading(false);
      if (res.error) { setCreatorsError(res.error); return; }
      setCreatorsError('');
      setCreators(res.creators || []);
    });
    return () => { alive = false; };
  }, [cq]);

  // ── 이 인플루언서에게 추천한 상품 ──
  const [recs, setRecs] = useState<AffiliateRecommendation[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editNote, setEditNote] = useState('');

  const syncCount = (username: string, count: number) =>
    setCreators(prev => prev.map(c => (c.username === username ? { ...c, recommendationCount: count } : c)));

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setRecsLoading(true);
    setRecs([]);
    affiliateStoreService.managerRecommendations(selected.username).then(res => {
      if (!alive) return;
      setRecsLoading(false);
      if (res.error) { onNotify(res.error, 'error'); return; }
      setRecs(res.items || []);
    });
    return () => { alive = false; };
  }, [selected, onNotify]);

  const removeRec = async (rec: AffiliateRecommendation) => {
    if (!selected) return;
    if (!window.confirm(`'${rec.product.name}' 추천을 뺄까요?`)) return;
    setBusyId(rec.id);
    const res = await affiliateStoreService.updateRecommendation(rec.id, { remove: true });
    setBusyId('');
    if (res.error) { onNotify(res.error, 'error'); return; }
    const next = recs.filter(r => r.id !== rec.id);
    setRecs(next);
    syncCount(selected.username, next.length);
    onNotify('추천에서 뺐어요.');
  };

  const saveNote = async (rec: AffiliateRecommendation) => {
    setBusyId(rec.id);
    const res = await affiliateStoreService.updateRecommendation(rec.id, { note: editNote });
    setBusyId('');
    if (res.error) { onNotify(res.error, 'error'); return; }
    setRecs(prev => prev.map(r => (r.id === rec.id ? { ...r, note: editNote.trim() } : r)));
    setEditingId('');
    onNotify('추천 메모를 저장했어요.');
  };

  // ── 상품 고르기 ──
  const [picking, setPicking] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const pq = useDebounced(productQuery.trim());
  const [category, setCategory] = useState('');
  const [taxonomy, setTaxonomy] = useState<CategoryNode[]>([]);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsCursor, setProductsCursor] = useState<ListCursor | null>(null);
  const [productsHasMore, setProductsHasMore] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const loadProducts = useCallback(async (cursor?: ListCursor | null) => {
    const my = ++seq.current;
    setProductsLoading(true);
    const res = await affiliateStoreService.recommendProducts({ q: pq, category }, cursor);
    if (my !== seq.current) return;
    setProductsLoading(false);
    if (res.error) { onNotify(res.error, 'error'); return; }
    if (res.taxonomy) setTaxonomy(res.taxonomy);
    setProducts(prev => (cursor ? [...prev, ...(res.products || []).filter(p => !prev.some(x => x.id === p.id))] : res.products || []));
    setProductsCursor(res.nextCursor || null);
    setProductsHasMore(!!res.hasMore);
  }, [pq, category, onNotify]);

  useEffect(() => { if (picking) void loadProducts(); }, [picking, loadProducts]);

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!selected || checked.size === 0) return;
    setSaving(true);
    const res = await affiliateStoreService.recommend(selected.username, Array.from(checked), note);
    setSaving(false);
    if (res.error) { onNotify(res.error, 'error'); return; }
    setRecs(res.items || []);
    syncCount(selected.username, (res.items || []).length);
    setChecked(new Set());
    setNote('');
    setPicking(false);
    onNotify(`${res.added}개 상품을 추천했어요.`);
  };

  const recommendedIds = new Set(recs.map(r => r.product.id));

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
      {/* 인플루언서 고르기 */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3 lg:sticky lg:top-24">
        <div className="relative mb-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={creatorQuery}
            onChange={e => setCreatorQuery(e.target.value)}
            placeholder="인플루언서 이름 · 아이디 · 인스타그램"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400"
          />
        </div>
        {creatorsLoading && creators.length === 0 ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : creatorsError ? (
          <p className="text-xs font-bold text-red-500 py-4 text-center">{creatorsError}</p>
        ) : creators.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">승인된 크리에이터를 찾지 못했어요.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto -mx-1">
            {creators.map(c => (
              <button
                key={c.username}
                onClick={() => { setSelected(c); setPicking(false); setChecked(new Set()); setEditingId(''); }}
                className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-2 ${selected?.username === c.username ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black truncate">{c.name || c.username}</p>
                  <p className={`text-[11px] truncate ${selected?.username === c.username ? 'text-white/60' : 'text-slate-400'}`}>
                    {c.username}{handleOf(c) ? ` · ${handleOf(c)}` : ''}
                  </p>
                </div>
                {c.recommendationCount > 0 && (
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${selected?.username === c.username ? 'bg-white/20 text-white' : 'bg-violet-50 text-violet-600'}`}>
                    추천 {c.recommendationCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 추천 목록 · 상품 고르기 */}
      <div className="min-w-0">
        {!selected ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-black text-slate-700">인플루언서를 먼저 골라 주세요</p>
            <p className="text-xs text-slate-400 mt-1">고른 인플루언서의 MY 어필리에이트 › 추천 어필리에이트 탭에 상품이 올라가요.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-base font-black text-slate-900 truncate">{selected.name || selected.username}님에게 추천한 상품 {recs.length}</p>
                <p className="text-[11px] text-slate-400">인플루언서는 MY 어필리에이트 › 추천 어필리에이트에서 이 상품들을 보고 판매 신청해요.</p>
              </div>
              <button
                onClick={() => setPicking(v => !v)}
                className={`h-10 px-4 rounded-xl text-xs font-black flex items-center gap-1.5 shrink-0 ${picking ? 'bg-white border border-slate-200 text-slate-600' : 'bg-slate-900 text-white'}`}
              >
                {picking ? <><X className="w-3.5 h-3.5" /> 닫기</> : <><Plus className="w-3.5 h-3.5" /> 상품 추천하기</>}
              </button>
            </div>

            {picking && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
                <div className="flex flex-col md:flex-row gap-2 mb-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={productQuery}
                      onChange={e => setProductQuery(e.target.value)}
                      placeholder="상품명 · 브랜드 검색"
                      className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400"
                    />
                  </div>
                  <select value={category} onChange={e => setCategory(e.target.value)} className="h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white">
                    <option value="">전체 카테고리</option>
                    {taxonomy.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
                {productsLoading && products.length === 0 ? (
                  <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
                ) : products.length === 0 ? (
                  <p className="text-xs text-slate-400 py-8 text-center">판매 중인 상품이 없어요.</p>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5 max-h-[55vh] overflow-y-auto">
                    {products.map(p => {
                      const already = recommendedIds.has(p.id);
                      const on = checked.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={already}
                          onClick={() => toggle(p.id)}
                          className={`text-left rounded-xl border overflow-hidden disabled:opacity-50 ${on ? 'border-violet-500 ring-2 ring-violet-200' : 'border-slate-100'}`}
                        >
                          <div className="relative aspect-square bg-slate-100">
                            {p.imageUrls[0] && <img src={p.imageUrls[0]} alt="" className="w-full h-full object-cover" loading="lazy" />}
                            <span className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-md flex items-center justify-center ${on || already ? 'bg-violet-600 text-white' : 'bg-white/90 border border-slate-200'}`}>
                              {(on || already) && <Check className="w-3.5 h-3.5" />}
                            </span>
                            {already && <span className="absolute bottom-1.5 left-1.5 text-[9px] font-black px-1.5 py-0.5 rounded bg-violet-600 text-white">추천함</span>}
                          </div>
                          <div className="p-2">
                            <p className="text-[9px] font-bold text-slate-400 truncate">{p.brandName}</p>
                            <p className="text-[11px] font-black text-slate-900 line-clamp-2 min-h-[2.5em]">{p.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">{won(p.salePrice)} · <b className="text-blue-600">{p.commissionRate}%</b></p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {productsHasMore && (
                  <div className="flex justify-center pt-3">
                    <button disabled={productsLoading} onClick={() => { void loadProducts(productsCursor); }} className="h-9 px-5 rounded-lg border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50 flex items-center gap-1.5">
                      {productsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} 더 보기
                    </button>
                  </div>
                )}
                <div className="flex flex-col md:flex-row gap-2 mt-4 pt-4 border-t border-slate-100">
                  <input
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    maxLength={500}
                    placeholder="추천 이유 한마디(선택) — 예: 피드 톤이랑 잘 어울려요"
                    className="flex-1 h-10 px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-slate-400"
                  />
                  <button
                    disabled={checked.size === 0 || saving}
                    onClick={submit}
                    className="h-10 px-5 rounded-xl bg-violet-600 text-white text-xs font-black disabled:opacity-40 flex items-center justify-center gap-1.5"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {checked.size > 0 ? `${checked.size}개 추천하기` : '상품을 골라 주세요'}
                  </button>
                </div>
              </div>
            )}

            {recsLoading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : recs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
                <p className="text-sm font-black text-slate-700">아직 추천한 상품이 없어요</p>
                <p className="text-xs text-slate-400 mt-1">'상품 추천하기'로 이 인플루언서에게 어울리는 상품을 골라 주세요.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {recs.map(rec => {
                  const p = rec.product;
                  const state = p.saleState || 'on_sale';
                  return (
                    <div key={rec.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                      <div className="relative aspect-square bg-slate-100">
                        {p.imageUrls[0] && <img src={p.imageUrls[0]} alt="" className="w-full h-full object-cover" loading="lazy" />}
                        {state !== 'on_sale' && (
                          <span className={`absolute top-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg ${SALE_STATE_STYLE[state]}`}>{SALE_STATE_LABEL[state]}</span>
                        )}
                        <span className={`absolute top-2 right-2 text-[10px] font-black px-2 py-1 rounded-lg ${rec.seen ? 'bg-white/90 text-slate-500' : 'bg-red-500 text-white'}`}>
                          {rec.seen ? '확인함' : '미확인'}
                        </span>
                        {rec.requestStatus && (
                          <span className="absolute bottom-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg bg-emerald-500 text-white">{REQUEST_LABEL[rec.requestStatus]}</span>
                        )}
                      </div>
                      <div className="p-3 flex-1 flex flex-col">
                        <p className="text-[10px] font-bold text-slate-400 truncate">{p.brandName}</p>
                        <p className="text-xs md:text-sm font-black text-slate-900 line-clamp-2 min-h-[2.5em]">{p.name}</p>
                        <p className="text-[11px] text-slate-500 mt-1 truncate">{won(p.salePrice)} · 수수료 <b className="text-blue-600">{p.commissionRate}%</b></p>
                        {editingId === rec.id ? (
                          <div className="mt-2 space-y-1.5">
                            <textarea
                              value={editNote}
                              onChange={e => setEditNote(e.target.value)}
                              maxLength={500}
                              rows={2}
                              className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] outline-none focus:border-slate-400 resize-none"
                            />
                            <div className="flex gap-1.5">
                              <button disabled={busyId === rec.id} onClick={() => saveNote(rec)} className="flex-1 h-7 rounded-lg bg-slate-900 text-white text-[10px] font-black disabled:opacity-50">저장</button>
                              <button onClick={() => setEditingId('')} className="flex-1 h-7 rounded-lg border border-slate-200 text-[10px] font-black text-slate-500">취소</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingId(rec.id); setEditNote(rec.note); }}
                            className={`mt-2 text-left text-[11px] rounded-lg px-2 py-1.5 leading-snug line-clamp-3 ${rec.note ? 'font-bold text-violet-700 bg-violet-50' : 'text-slate-400 border border-dashed border-slate-200'}`}
                          >
                            {rec.note ? `“${rec.note}”` : '+ 추천 이유 남기기'}
                          </button>
                        )}
                        <p className="text-[10px] text-slate-400 mt-auto pt-2">
                          {new Date(rec.recommendedAt).toLocaleDateString('ko-KR')} 추천{rec.managerUsername ? ` · ${rec.managerUsername}` : ''}
                        </p>
                      </div>
                      <button
                        disabled={busyId === rec.id}
                        onClick={() => removeRec(rec)}
                        className="h-9 border-t border-slate-100 text-[11px] font-black text-red-500 hover:bg-red-50 flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {busyId === rec.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        추천 빼기
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ManagerAffiliateRecommendPanel;
