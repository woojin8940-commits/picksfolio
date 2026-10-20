import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  Search,
  Store,
  X,
} from 'lucide-react';
import {
  affiliateService,
  won,
  type AffiliateCampaign,
  type AffiliateJoinMode,
  type CreateAffiliateCampaignInput,
  type ShopConnectionStatus,
  type ShopProduct,
} from '../../services/affiliateService';
import { CREATOR_CATEGORIES } from '../../utils/creatorCategories';
import { todayInSeoul } from '../../utils/formatters';

/**
 * 판매 캠페인 등록 마법사.
 *
 * ① 쇼핑몰 → ② 상품 → ③ 조건 → ④ 옵션 → ⑤ 확인.
 *
 * 순서는 "무엇을 파는가 → 얼마를 주는가 → 어떻게 홍보하는가"다. 상품은 연동한 몰에서만
 * 고른다 — 손으로 적은 상품은 주문을 몰 API 로 확인할 수 없어 수수료를 셀 근거가 없다.
 *
 * 수수료율은 브랜드가 내는 총액이고, 그중 플랫폼 수수료율만큼을 빼고 인플루언서에게
 * 간다. 플랫폼 수수료율은 등록하는 순간의 값이 캠페인에 고정되므로 화면에서도 지금 값을
 * 읽어 미리 나눠 보여 준다(getPlatformSettings). 실제 몫은 서버가 다시 계산한다.
 *
 * 반려된 캠페인을 고칠 때도 같은 마법사를 쓴다(editing). 그때는 등록 대신 재심사 요청
 * (updateCampaign 'resubmit')으로 보낸다.
 */

interface AffiliateCampaignWizardProps {
  companyName: string;
  /** 반려된 캠페인을 고쳐 다시 올릴 때. */
  editing?: AffiliateCampaign | null;
  onClose: () => void;
  onSaved: (campaign: AffiliateCampaign) => void;
  /** 연결된 몰이 없을 때 판매 캠페인의 '연동' 탭으로 보낸다. */
  onOpenShopSettings?: () => void;
}

/* 판매 캠페인은 브랜드가 콘텐츠 가이드를 따로 쓰지 않는다 — 상품 자료는 쇼핑몰 상품
   페이지에 있고, 광고 표기 문구는 픽스폴리오가 자동으로 붙인다. 그래서 '가이드' 단계를 뺐다.
   예전에 가이드를 적어 둔 캠페인을 고쳐 다시 올릴 때는 그 값을 그대로 보낸다. */
const STEPS = ['쇼핑몰', '상품', '조건', '옵션', '확인'] as const;
const MAX_COMMISSION = 90;

/** 서버가 실제 문구를 넣는다. 받기 전까지 보여 줄 미리보기. */
/** 설정을 아직 못 읽었을 때만 쓰는 대체 문구. 실제 문구는 서버가 정한다(getPlatformSettings). */
const DISCLOSURE_PREVIEW = "이 캠페인은 판매 수수료를 받는 광고입니다. 게시물·스토리·DM 등 상품을 소개하는 모든 곳에 '광고' 또는 '#광고'를 잘 보이게 표기해 주세요.";

const INPUT =
  'w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-slate-900';
const LABEL = 'block text-[11px] font-black text-slate-500 mb-1.5';
const HELP = 'text-[10px] text-slate-400 font-medium mt-1 leading-relaxed break-keep';

type PickedProduct = CreateAffiliateCampaignInput['products'][number];

const AffiliateCampaignWizard: React.FC<AffiliateCampaignWizardProps> = ({
  companyName,
  editing = null,
  onClose,
  onSaved,
  onOpenShopSettings,
}) => {
  const [step, setStep] = useState(0);

  // ── 쇼핑몰 ──
  const [shops, setShops] = useState<ShopConnectionStatus[]>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [trackingNotice, setTrackingNotice] = useState('');
  const [mallId, setMallId] = useState(editing?.mallId || '');

  // ── 상품 ──
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, PickedProduct>>(() => {
    const init: Record<string, PickedProduct> = {};
    (editing?.products || []).forEach(p => {
      init[p.shopProductId] = {
        shopProductId: p.shopProductId, name: p.name, price: p.price, imageUrl: p.imageUrl, productUrl: p.productUrl,
      };
    });
    return init;
  });

  // ── 기본 정보 · 조건 ──
  const [brandName, setBrandName] = useState(editing?.companyName || companyName || '');
  const [title, setTitle] = useState(editing?.title || '');
  const [category, setCategory] = useState(editing?.category || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [commission, setCommission] = useState(editing?.commissionRate != null ? String(editing.commissionRate) : '');
  const [startDate, setStartDate] = useState(String(editing?.startDate || '').slice(0, 10) || todayInSeoul());
  const [endDate, setEndDate] = useState(String(editing?.endDate || '').slice(0, 10));
  const [joinMode, setJoinMode] = useState<AffiliateJoinMode>(editing?.joinMode || 'approval');
  const [platformRate, setPlatformRate] = useState<number | null>(editing?.platformRate ?? null);
  const [disclosureText, setDisclosureText] = useState<string>(editing?.disclosureText || '');

  // ── 옵션 ──
  const [sampleOffered, setSampleOffered] = useState(!!editing?.sampleOffered);
  const [sampleNote, setSampleNote] = useState(editing?.sampleNote || '');
  const [followerDiscount, setFollowerDiscount] = useState(editing?.followerDiscount || '');
  // 입력 단계는 없다. 고쳐 다시 올리는 캠페인의 예전 값만 그대로 넘긴다.
  const contentGuide = editing?.contentGuide || '';
  const bannedPhrases = editing?.bannedPhrases || '';

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState<AffiliateCampaign | null>(null);

  // 연결 상태와 플랫폼 수수료율은 처음 한 번 읽는다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [conn, settings] = await Promise.all([
        affiliateService.getShopConnections(),
        // 고치는 중이면 등록 시점에 고정된 값을 그대로 쓴다.
        editing?.platformRate != null ? Promise.resolve(null) : affiliateService.getPlatformSettings(),
      ]);
      if (!alive) return;
      const list = Array.isArray(conn.connections) ? conn.connections : [];
      setShops(list);
      setTrackingNotice(conn.trackingNotice || '');
      setShopsLoading(false);
      // 연결된 몰이 하나뿐이면 미리 골라 둔다 — 대부분의 브랜드가 그렇다.
      const usable = list.filter(s => s.state === 'connected');
      if (!editing && usable.length === 1) setMallId(usable[0].mallId);
      if (settings && !settings.error && settings.settings) {
        setPlatformRate(Number(settings.settings.platformRate));
        if (settings.settings.disclosureText) setDisclosureText(prev => prev || String(settings.settings.disclosureText));
      }
      else if (settings) setPlatformRate(prev => prev ?? 5);
    })();
    return () => { alive = false; };
  }, [editing]);

  const connectedShops = shops.filter(s => s.state === 'connected');
  const selectedShop = shops.find(s => s.mallId === mallId) || null;

  // 상품 목록. 몰이나 검색어가 바뀌면 처음부터 다시 읽는다.
  const loadProducts = async (reset: boolean) => {
    if (!mallId) return;
    setProductsLoading(true);
    setProductsError('');
    const res = await affiliateService.listShopProducts(mallId, {
      q: appliedQuery || undefined,
      offset: reset ? 0 : products.length,
    });
    setProductsLoading(false);
    if (res.error) {
      setProductsError(res.error);
      return;
    }
    const next = Array.isArray(res.products) ? res.products : [];
    setProducts(prev => (reset ? next : [...prev, ...next]));
    setHasMore(!!res.hasMore);
  };

  useEffect(() => {
    if (step === 1 && mallId) loadProducts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step === 1, mallId, appliedQuery]);

  const togglePick = (p: ShopProduct) => {
    setPicked(prev => {
      const next = { ...prev };
      if (next[p.shopProductId]) delete next[p.shopProductId];
      else next[p.shopProductId] = {
        shopProductId: p.shopProductId, name: p.name, price: p.price, imageUrl: p.imageUrl, productUrl: p.productUrl,
      };
      return next;
    });
  };
  const pickedList = Object.values(picked);

  // ── 파생값 · 검사 ──
  const rate = Number(commission);
  const pRate = platformRate ?? 5;
  const creatorShare = Number.isFinite(rate) ? Math.round((rate - pRate) * 100) / 100 : 0;
  const commissionError = !commission
    ? '수수료율을 입력해 주세요.'
    : !Number.isFinite(rate)
      ? '숫자로 입력해 주세요.'
      : rate <= pRate
        ? `플랫폼 수수료율(${pRate}%)보다 높아야 인플루언서 몫이 생깁니다.`
        : rate > MAX_COMMISSION
          ? `수수료율은 ${MAX_COMMISSION}% 이하로 정해 주세요.`
          : '';
  const periodError = !startDate || !endDate
    ? '판매 기간을 정해 주세요.'
    : endDate < startDate
      ? '종료일이 시작일보다 빠릅니다.'
      : '';

  const stepError = useMemo(() => {
    switch (step) {
      case 0: return mallId ? '' : '쇼핑몰을 선택해 주세요.';
      case 1: return pickedList.length > 0 ? '' : '상품을 하나 이상 골라 주세요.';
      case 2:
        if (!brandName.trim()) return '브랜드명을 입력해 주세요.';
        if (!title.trim()) return '캠페인 제목을 입력해 주세요.';
        if (!category) return '카테고리를 골라 주세요.';
        return commissionError || periodError;
      default: return '';
    }
  }, [step, mallId, pickedList.length, brandName, title, category, commissionError, periodError]);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError('');
    const input: CreateAffiliateCampaignInput = {
      mallId,
      companyName: brandName.trim(),
      title: title.trim(),
      description: description.trim(),
      category,
      commissionRate: rate,
      startDate,
      endDate,
      joinMode,
      sampleOffered,
      sampleNote: sampleOffered ? sampleNote.trim() : '',
      followerDiscount: followerDiscount.trim(),
      contentGuide: contentGuide.trim(),
      bannedPhrases: bannedPhrases.trim(),
      products: pickedList,
    };
    const res = editing
      ? await affiliateService.updateCampaign(editing.id, { ...input, action: 'resubmit' })
      : await affiliateService.createCampaign(input);
    setSubmitting(false);
    if (res.error || !res.campaign) {
      setSubmitError(res.error || '등록하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setDone(res.campaign);
  };

  // ───────────────────────────── 완료 화면 ─────────────────────────────
  if (done) {
    return (
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 md:p-12 text-center">
        <span className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-7 h-7 text-emerald-600" />
        </span>
        <p className="text-lg md:text-xl font-black text-slate-900 mt-4">
          {editing ? '재심사를 요청했습니다' : '판매 캠페인을 등록했습니다'}
        </p>
        <p className="text-[13px] text-slate-500 font-bold mt-2 leading-relaxed">
          관리자 승인 후 공개됩니다. 승인되면 인플루언서가 캠페인을 보고 참여할 수 있습니다.
        </p>
        <button
          type="button"
          onClick={() => onSaved(done)}
          className="mt-6 px-6 py-3 rounded-xl bg-slate-900 text-white text-[13px] font-black hover:bg-slate-800"
        >
          판매 캠페인 목록으로
        </button>
      </div>
    );
  }

  // ───────────────────────────── 본문 ─────────────────────────────
  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm">
      {/* 머리 · 단계 표시 */}
      <div className="px-5 md:px-7 pt-5 md:pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] md:text-lg font-black text-slate-900">
            {editing ? '판매 캠페인 수정 · 재심사 요청' : '새 판매 캠페인'}
          </p>
          <button type="button" onClick={onClose} aria-label="닫기" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50">
            <X className="w-5 h-5" />
          </button>
        </div>
        <ol className="mt-3 flex gap-1 overflow-x-auto scrollbar-hide">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black whitespace-nowrap ${
                i === step ? 'bg-slate-900 text-white' : i < step ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i < step ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
              {label}
            </li>
          ))}
        </ol>
      </div>

      <div className="px-5 md:px-7 py-5 md:py-6 space-y-5">
        {/* ① 쇼핑몰 */}
        {step === 0 && (
          shopsLoading ? (
            <div className="py-10 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
              <span className="text-[12px] font-bold text-slate-400">연동한 쇼핑몰 확인 중...</span>
            </div>
          ) : connectedShops.length === 0 ? (
            <div className="text-center py-6">
              <span className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
                <Store className="w-6 h-6 text-blue-600" />
              </span>
              <p className="text-[15px] font-black text-slate-900 mt-3">먼저 쇼핑몰을 연동해 주세요</p>
              <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed">
                판매 캠페인은 연동한 자사몰의 상품으로 만들고, 주문도 그 몰에서 확인합니다.
                {shops.some(s => s.state === 'reconnect') && ' 연동이 만료된 몰은 다시 연동해야 합니다.'}
              </p>
              {onOpenShopSettings && (
                <button
                  type="button"
                  onClick={onOpenShopSettings}
                  className="mt-4 px-5 py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700"
                >
                  쇼핑몰 연동하러 가기
                </button>
              )}
            </div>
          ) : (
            <div>
              <label className={LABEL}>판매할 쇼핑몰</label>
              <div className="space-y-2">
                {connectedShops.map(s => {
                  const on = s.mallId === mallId;
                  return (
                    <button
                      key={s.mallId}
                      type="button"
                      onClick={() => {
                        if (s.mallId !== mallId) { setPicked({}); setProducts([]); }
                        setMallId(s.mallId);
                      }}
                      className={`w-full flex items-center gap-3 text-left px-4 py-3.5 rounded-2xl border-2 transition-colors ${
                        on ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300'
                      }`}
                    >
                      <Store className="w-5 h-5 text-slate-500 flex-shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-black text-slate-900 truncate">
                          카페24 · {s.shopName || s.mallId}
                        </span>
                        <span className="block text-[10px] text-slate-400 font-bold truncate">{s.shopDomain || s.mallId}</span>
                      </span>
                      {s.script.mode === 'none' && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-500 text-[9px] font-black flex-shrink-0">스크립트 미설치</span>
                      )}
                      {on && <Check className="w-4 h-4 text-slate-900 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              {/* 스크립트가 없으면 판매가 집계되지 않는다. 등록은 막지 않지만 미리 알린다. */}
              {selectedShop?.script.mode === 'none' && (
                <p className="mt-2 text-[11px] text-amber-600 font-bold leading-relaxed">
                  이 몰에는 추적 스크립트가 아직 없습니다. 공개 전에 '연동' 탭에서 설치해 주세요.
                </p>
              )}
            </div>
          )
        )}

        {/* ② 상품 */}
        {step === 1 && (
          <div>
            <form
              onSubmit={e => { e.preventDefault(); setAppliedQuery(query.trim()); }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="상품명 검색"
                  className={`${INPUT} pl-9`}
                />
              </div>
              <button type="submit" className="px-4 rounded-xl bg-slate-900 text-white text-[12px] font-black">검색</button>
            </form>
            <p className="text-[11px] font-black text-slate-500 mt-3">
              선택한 상품 {pickedList.length}개
            </p>

            {productsError && <p className="mt-2 text-[11px] text-rose-500 font-bold">{productsError}</p>}

            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {products.map(p => {
                const on = !!picked[p.shopProductId];
                return (
                  <button
                    key={p.shopProductId}
                    type="button"
                    onClick={() => togglePick(p)}
                    aria-pressed={on}
                    className={`relative text-left rounded-2xl border-2 overflow-hidden transition-colors ${
                      on ? 'border-blue-600' : 'border-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="aspect-square bg-slate-50">
                      {p.imageUrl && <img src={p.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    </div>
                    {on && (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                    )}
                    <div className="p-2.5">
                      <p className="text-[12px] font-black text-slate-900 line-clamp-2 leading-snug">{p.name}</p>
                      <p className="text-[11px] font-bold text-slate-500 mt-1">{won(p.price)}</p>
                      {(!p.selling || !p.display) && (
                        <p className="text-[9px] font-black text-amber-600 mt-0.5">
                          {!p.selling ? '판매 안 함' : '진열 안 함'}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {productsLoading ? (
              <div className="py-6 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
                <span className="text-[12px] font-bold text-slate-400">상품 불러오는 중...</span>
              </div>
            ) : products.length === 0 && !productsError ? (
              <p className="py-8 text-center text-[12px] text-slate-400 font-bold">
                {appliedQuery ? '검색 결과가 없습니다.' : '불러올 상품이 없습니다.'}
              </p>
            ) : hasMore ? (
              <button
                type="button"
                onClick={() => loadProducts(false)}
                className="mt-3 w-full py-3 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black hover:bg-slate-50"
              >
                더 보기
              </button>
            ) : null}

            {/* 이미 고른 상품 중 지금 목록에 없는 것(검색으로 가려진 것)도 빠지지 않았다는 걸 보여 준다. */}
            {pickedList.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {pickedList.map(p => (
                  <span key={p.shopProductId} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-blue-50 text-blue-700 text-[10px] font-black max-w-full">
                    <span className="truncate max-w-[160px]">{p.name}</span>
                    <button
                      type="button"
                      aria-label="선택 해제"
                      onClick={() => setPicked(prev => { const n = { ...prev }; delete n[p.shopProductId]; return n; })}
                      className="p-0.5 rounded-full hover:bg-blue-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ③ 기본 정보 · 조건 */}
        {step === 2 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>브랜드명 *</label>
                <input value={brandName} onChange={e => setBrandName(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className={LABEL}>카테고리 *</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className={INPUT}>
                  <option value="">카테고리 선택</option>
                  {CREATOR_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={LABEL}>캠페인 제목 *</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={60}
                placeholder="예) 가을 신상 니트 판매 파트너 모집"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>캠페인 소개</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="브랜드와 상품을 인플루언서에게 소개해 주세요."
                className={`${INPUT} resize-none`}
              />
            </div>

            <div>
              <label className={LABEL}>판매 수수료율 (%) *</label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={MAX_COMMISSION}
                  step="0.5"
                  value={commission}
                  onChange={e => setCommission(e.target.value)}
                  placeholder="예) 20"
                  className={`${INPUT} pr-10`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-black text-slate-400">%</span>
              </div>
              {/* 나눠 보이는 미리보기. 브랜드가 정하는 건 총액이고, 인플루언서가 보는 건 몫이다. */}
              <div className="mt-2 rounded-2xl bg-slate-50 border border-slate-100 px-3.5 py-3">
                <p className="text-[12px] font-black text-slate-900">
                  인플루언서 몫 <span className="text-blue-600">{rate > pRate ? `${creatorShare}%` : '-'}</span>
                  <span className="text-slate-300 mx-1.5">·</span>
                  플랫폼 <span className="text-slate-600">{pRate}%</span>
                </p>
                <p className={HELP}>
                  판매 금액(결제 금액 기준)에 수수료율을 곱한 금액을 브랜드가 부담합니다. 플랫폼 수수료율은 등록
                  시점 값으로 이 캠페인에 고정되고, 인플루언서에게는 몫만 보입니다.
                </p>
              </div>
              {commission && commissionError && (
                <p className="mt-1.5 text-[11px] text-rose-500 font-bold">{commissionError}</p>
              )}
            </div>

            <div>
              <label className={LABEL}>판매 기간 *</label>
              <div className="flex items-center gap-2">
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={INPUT} />
                <span className="text-slate-300 font-bold">~</span>
                <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className={INPUT} />
              </div>
              {startDate && endDate && periodError && (
                <p className="mt-1.5 text-[11px] text-rose-500 font-bold">{periodError}</p>
              )}
            </div>

            <div>
              <label className={LABEL}>참여 방식</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  { value: 'approval', label: '승인제', desc: '신청한 인플루언서를 브랜드가 확인하고 승인합니다.' },
                  { value: 'open', label: '누구나 바로', desc: '신청 즉시 판매 링크가 발급됩니다.' },
                ] as const).map(o => {
                  const on = joinMode === o.value;
                  return (
                    <label
                      key={o.value}
                      className={`flex items-start gap-2.5 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                        on ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="joinMode"
                        checked={on}
                        onChange={() => setJoinMode(o.value)}
                        className="mt-0.5 accent-slate-900"
                      />
                      <span>
                        <span className="block text-[13px] font-black text-slate-900">
                          {o.label}{o.value === 'approval' && <span className="text-[10px] text-slate-400"> (기본)</span>}
                        </span>
                        <span className="block text-[10px] text-slate-500 font-medium mt-0.5 leading-snug">{o.desc}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ④ 옵션 */}
        {step === 3 && (
          <>
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-black text-slate-900">샘플 제공</p>
                  <p className={HELP}>참여 인플루언서에게 상품 샘플을 보낼지 브랜드가 정합니다.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={sampleOffered}
                  onClick={() => setSampleOffered(v => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${sampleOffered ? 'bg-blue-600' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${sampleOffered ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
              {sampleOffered && (
                <textarea
                  value={sampleNote}
                  onChange={e => setSampleNote(e.target.value)}
                  rows={2}
                  placeholder="예) 승인된 분께 대표 상품 1개를 보내 드립니다. 배송지는 승인 후 따로 받습니다."
                  className={`${INPUT} resize-none mt-2`}
                />
              )}
            </div>
            <div>
              <label className={LABEL}>팔로워 전용 할인</label>
              <input
                value={followerDiscount}
                onChange={e => setFollowerDiscount(e.target.value)}
                placeholder="예) 링크로 구매 시 10% 할인 쿠폰 자동 적용"
                className={INPUT}
              />
              <p className={HELP}>
                참여한 인플루언서에게 그대로 안내됩니다. 할인 자체는 쇼핑몰에서 설정해 주세요.
              </p>
            </div>
          </>
        )}

        {/* ⑤ 확인 */}
        {step === 4 && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-100 divide-y divide-slate-100">
              {[
                ['쇼핑몰', selectedShop ? `카페24 · ${selectedShop.shopName || selectedShop.mallId}` : mallId],
                ['브랜드', brandName],
                ['제목', title],
                ['카테고리', category],
                ['상품', `${pickedList.length}개`],
                ['수수료율', `${rate}% (인플루언서 ${creatorShare}% · 플랫폼 ${pRate}%)`],
                ['판매 기간', `${startDate} ~ ${endDate}`],
                ['참여 방식', joinMode === 'approval' ? '승인제' : '누구나 바로'],
                ['샘플', sampleOffered ? (sampleNote || '제공') : '제공 안 함'],
                ['팔로워 할인', followerDiscount || '없음'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 px-4 py-2.5">
                  <span className="w-20 flex-shrink-0 text-[11px] font-black text-slate-400">{k}</span>
                  <span className="text-[12px] font-bold text-slate-800 break-all">{v}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
              {pickedList.map(p => (
                <div key={p.shopProductId} className="w-16 flex-shrink-0">
                  <div className="w-16 h-16 rounded-xl bg-slate-50 overflow-hidden">
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <p className="text-[9px] font-bold text-slate-500 mt-1 truncate">{p.name}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 px-3.5 py-3">
              <p className="text-[10px] font-black text-slate-400 mb-1">광고 표기 (자동 포함)</p>
              <p className="text-[12px] font-bold text-slate-700 leading-relaxed">{disclosureText || DISCLOSURE_PREVIEW}</p>
            </div>
            {trackingNotice && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-2xl px-3.5 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700 font-medium leading-relaxed whitespace-pre-line break-keep">
                  {trackingNotice}
                </p>
              </div>
            )}
            <p className="text-[11px] text-slate-500 font-bold leading-relaxed">
              {editing ? '재심사를 요청하면' : '등록하면'} 픽스폴리오 관리자가 내용을 확인합니다. 관리자 승인 후 공개됩니다.
            </p>
            {submitError && <p className="text-[11px] text-rose-500 font-bold">{submitError}</p>}
          </div>
        )}
      </div>

      {/* 아래 버튼 */}
      <div className="px-5 md:px-7 pb-5 md:pb-6 pt-1">
        {stepError && step <= 2 && !(step === 0 && connectedShops.length === 0) && (
          <p className="text-[11px] text-slate-400 font-bold mb-2">{stepError}</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : setStep(s => s - 1))}
            className="px-4 py-3 rounded-xl border border-slate-200 text-slate-600 text-[13px] font-black hover:bg-slate-50 flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> {step === 0 ? '취소' : '이전'}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!!stepError || (step === 0 && shopsLoading)}
              onClick={() => setStep(s => s + 1)}
              className="flex-1 py-3 rounded-xl bg-slate-900 text-white text-[13px] font-black hover:bg-slate-800 disabled:opacity-40"
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? '수정하고 재심사 요청' : '승인 요청하고 등록'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AffiliateCampaignWizard;
