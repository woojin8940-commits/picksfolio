import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bell, CalendarDays, ChevronRight, Clock, Loader2, Package, Plus, RefreshCw, RotateCcw, Store, Truck, Users, Wallet } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  PRODUCT_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  MANAGER_STATUS_LABEL,
  MANAGER_STATUS_STYLE,
  SALE_STATE_LABEL,
  SALE_STATE_STYLE,
  SHIPPING_STATUS_LABEL,
  SHIPPING_STATUS_STYLE,
  DIRECT_DEAL_AGREEMENT_REQUIRED,
  UPLOAD_TONE_STYLE,
  uploadScheduleOf,
  salePeriodText,
  sellerInfoMissing,
  type CategoryNode,
  type BrandCounts,
  type FeeRates,
  type ListCursor,
  type StoreApplication,
  type StoreProduct,
  type StoreRequest,
} from '../../services/affiliateStoreService';
import AffiliateStoreApplication from './AffiliateStoreApplication';
import AffiliateProductEditor from './AffiliateProductEditor';
import BrandAffiliateOrders from './BrandAffiliateOrders';
import BrandSellerInfo from './BrandSellerInfo';
import AffiliatePayouts from './AffiliatePayouts';
import InfluencerCandidateCard from '../collab/InfluencerCandidateCard';
import DirectDealAgreement from './DirectDealAgreement';
import { AffiliateProgressBoard, AffiliateSalesBoard } from './BrandAffiliateProgress';

/**
 * 브랜드 어필리에이트 메뉴(ZVZO 방식).
 *
 *   신청서 없음 · 반려 → 입점 신청서
 *   검토 중            → 대기 안내
 *   승인               → 상품 관리 · 판매 신청 관리
 *
 * 진행관리(예전 '판매 신청')는 캠페인 협업처럼 진행 중인 어필리에이트(신청을 받은 상품)를 카드로 깔고,
 * 하나를 누르면 지원 현황 · 선정 인플루언서 · 진행 단계(배송 현황 · 업로드 일정 · 업로드 링크 · 파트너십 코드)
 * · 판매 현황 탭이 열린다(진행 단계 · 판매 현황은 BrandAffiliateProgress).
 *
 * 판매 신청은 상품별로 묶어 본다. 상품마다 대기 · 선정 · 반려 수와 "새 신청"(아직 확인 안 함) 알림을 보여 주고,
 * 상품을 누르면 광고비 지급형 캠페인 지원자처럼 인플루언서 카드(인스타 프로필 · 팔로워 · 최근 릴스)로 신청자를 본다.
 * 신청자 목록을 열면 그 상품의 새 신청 알림이 꺼진다.
 *
 * 선정하면 인플루언서에게 선정 알림이 가고, 인플루언서가 협찬 상품 배송정보를 입력하면 카드에 배송지가 보인다.
 * 브랜드는 상품을 보내고 송장번호를 입력한다. 인플루언서가 반려하면 협업은 진행되지 않는다.
 *
 * 상품 · 받은 신청은 30개씩(커서) 받는다. 상품 삭제 · 판매 상태 변경 · 수정 · 신청 선정/반려는
 * 바뀐 한 건만 고치고 숫자만 새로 받는다(펼쳐 둔 목록은 그대로). "더 보기"가 실패하면 목록 아래에만 오류가 나온다.
 */

interface Props {
  businessUsername: string;
}

const PRODUCT_STATUS_STYLE: Record<string, string> = {
  on_sale: 'bg-emerald-50 text-emerald-600',
  paused: 'bg-slate-100 text-slate-500',
  draft: 'bg-amber-50 text-amber-600',
};
const REQUEST_STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
  cancelled: 'bg-slate-100 text-slate-400',
};

const dateText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const BrandAffiliateStore: React.FC<Props> = ({ businessUsername }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [application, setApplication] = useState<StoreApplication | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [requests, setRequests] = useState<StoreRequest[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [onSaleTotal, setOnSaleTotal] = useState(0);
  const [pendingRequestCount, setPendingRequestCount] = useState(0);
  const [newRequestCount, setNewRequestCount] = useState(0);
  // 판매 신청 — 상품별 묶음 · 고른 상품의 신청자
  const [requestProducts, setRequestProducts] = useState<StoreProduct[]>([]);
  const [requestProductsLoaded, setRequestProductsLoaded] = useState(false);
  const [requestProductsLoading, setRequestProductsLoading] = useState(false);
  const [requestProductsError, setRequestProductsError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<StoreProduct | null>(null);
  const [requestFilter, setRequestFilter] = useState<'' | 'pending' | 'approved' | 'rejected'>('');
  /** 고른 상품 안의 탭: 지원 현황 · 선정 인플루언서 · 진행 단계 · 판매 현황. */
  const [productTab, setProductTab] = useState<'applicants' | 'selected' | 'progress' | 'sales'>('applicants');
  const [productCursor, setProductCursor] = useState<ListCursor | null>(null);
  const [productHasMore, setProductHasMore] = useState(false);
  const [productsMoreLoading, setProductsMoreLoading] = useState(false);
  const [productsMoreError, setProductsMoreError] = useState('');
  const [requestsCursor, setRequestsCursor] = useState<ListCursor | null>(null);
  const [requestsHasMore, setRequestsHasMore] = useState(false);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState('');
  const [requestsMoreError, setRequestsMoreError] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [taxonomy, setTaxonomy] = useState<CategoryNode[]>([]);
  const [feeRates, setFeeRates] = useState<FeeRates | null>(null);
  const [opsCounts, setOpsCounts] = useState({ newOrders: 0, claimsNeedAction: 0, unread: 0 });
  const onOpsCounts = useCallback((c: typeof opsCounts) => setOpsCounts(c), []);
  const [tab, setTab] = useState<'products' | 'requests' | 'orders' | 'claims' | 'seller' | 'payouts'>('products');
  const [editing, setEditing] = useState<StoreProduct | 'new' | null>(null);
  const [reapply, setReapply] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [shipPendingCount, setShipPendingCount] = useState(0);
  /** 직거래 금지 동의 전에 선정하려는 신청(동의 창). */
  const [agreeFor, setAgreeFor] = useState<StoreRequest | null>(null);
  const [agreeChecked, setAgreeChecked] = useState(false);

  const applyCounts = useCallback((c: Partial<BrandCounts>) => {
    if (c.productTotal !== undefined) setProductTotal(c.productTotal);
    if (c.onSaleTotal !== undefined) setOnSaleTotal(c.onSaleTotal);
    if (c.pendingRequestCount !== undefined) setPendingRequestCount(c.pendingRequestCount);
    if (c.newRequestCount !== undefined) setNewRequestCount(c.newRequestCount);
    if (c.shipPendingCount !== undefined) setShipPendingCount(c.shipPendingCount);
    if (c.opsCounts) setOpsCounts(c.opsCounts);
  }, []);

  /** 첫 화면: 신청서 · 숫자 · 상품 첫 페이지. */
  const load = useCallback(async () => {
    setError('');
    const res = await affiliateStoreService.getBrand(businessUsername);
    if (res.error) setError(res.error);
    else {
      setApplication(res.application ?? null);
      setProducts(res.products || []);
      setProductCursor(res.productNextCursor || null);
      setProductHasMore(!!res.productHasMore);
      setProductsMoreError('');
      applyCounts(res);
      setCategories(res.categories || []);
      setTaxonomy(res.taxonomy || []);
      setFeeRates(res.feeRates || null);
    }
    setLoading(false);
  }, [businessUsername, applyCounts]);

  useEffect(() => { load(); }, [load]);

  /** 숫자만 새로 받는다(실패해도 목록은 그대로 둔다). */
  const refreshCounts = useCallback(async () => {
    const res = await affiliateStoreService.getBrandCounts(businessUsername);
    if (!res.error) applyCounts(res);
  }, [businessUsername, applyCounts]);

  const loadRequestProducts = useCallback(async () => {
    setRequestProductsLoading(true);
    setRequestProductsError('');
    const res = await affiliateStoreService.getBrandRequestProducts(businessUsername);
    setRequestProductsLoading(false);
    if (res.error) { setRequestProductsError(res.error); return; }
    setRequestProducts(res.products || []);
    setRequestProductsLoaded(true);
  }, [businessUsername]);

  /** 고른 상품의 신청자(상태 칸으로 거른다). 늦게 온 이전 응답은 버린다. */
  const requestsSeq = React.useRef(0);
  const loadRequests = useCallback(async (cursor: ListCursor | null, productId: string, status: '' | 'pending' | 'approved' | 'rejected') => {
    const append = !!cursor;
    const seq = append ? requestsSeq.current : ++requestsSeq.current;
    setRequestsLoading(true);
    if (append) setRequestsMoreError(''); else setRequestsError('');
    const res = await affiliateStoreService.getBrandRequests(businessUsername, cursor, { productId, status });
    if (seq !== requestsSeq.current) return;
    setRequestsLoading(false);
    if (res.error) {
      if (append) setRequestsMoreError(res.error); else setRequestsError(res.error);
      return;
    }
    setRequests(prev => {
      if (!append) return res.requests || [];
      const seen = new Set(prev.map(r => r.id));
      return [...prev, ...(res.requests || []).filter(r => !seen.has(r.id))];
    });
    setRequestsCursor(res.requestNextCursor || null);
    setRequestsHasMore(!!res.requestHasMore);
    setRequestsLoaded(true);
  }, [businessUsername]);

  useEffect(() => {
    setRequests([]);
    setRequestsLoaded(false);
    setRequestsError('');
    setRequestsMoreError('');
    setRequestProducts([]);
    setRequestProductsLoaded(false);
    setRequestProductsError('');
    setSelectedProduct(null);
  }, [businessUsername]);

  useEffect(() => {
    if (tab === 'requests' && !selectedProduct && !requestProductsLoaded && !requestProductsLoading && !requestProductsError) void loadRequestProducts();
  }, [tab, selectedProduct, requestProductsLoaded, requestProductsLoading, requestProductsError, loadRequestProducts]);

  /** 상품의 신청자 보기 — 목록을 받고, 그 상품의 새 신청 알림을 끈다. */
  const openProductRequests = (p: StoreProduct) => {
    setTab('requests');
    setSelectedProduct(p);
    setRequestFilter('');
    setRequests([]);
    setRequestsLoaded(false);
    setRequestsHasMore(false);
    setRequestsCursor(null);
    // 보낼 협찬 상품이 있으면 진행 단계부터, 아니면 지원 현황부터 연다.
    const startTab = (p.requestCounts?.toShip || 0) > 0 && !(p.requestCounts?.unseen || 0) ? 'progress' : 'applicants';
    setProductTab(startTab);
    if (startTab === 'applicants') void loadRequests(null, p.id, '');
    window.scrollTo({ top: 0 });
    if ((p.requestCounts?.unseen || 0) > 0) {
      const clearUnseen = (x: StoreProduct) => x.id === p.id && x.requestCounts ? { ...x, requestCounts: { ...x.requestCounts, unseen: 0 } } : x;
      setRequestProducts(prev => prev.map(clearUnseen));
      setProducts(prev => prev.map(clearUnseen));
      void affiliateStoreService.markRequestsSeen(businessUsername, p.id).then(res => { if (!res.error) applyCounts(res); });
    }
  };
  const closeProductRequests = () => {
    requestsSeq.current += 1;
    setSelectedProduct(null);
    setRequests([]);
    setRequestsLoaded(false);
    setRequestsLoading(false);
    setRequestsError('');
    // 선정 · 반려한 결과가 상품별 숫자에 반영되도록 다시 받는다.
    setRequestProductsLoaded(false);
  };
  const changeRequestFilter = (f: typeof requestFilter) => {
    if (!selectedProduct) return;
    setRequestFilter(f);
    setRequests([]);
    setRequestsHasMore(false);
    void loadRequests(null, selectedProduct.id, f);
  };
  /** 상품 안의 탭을 바꾼다. 지원 현황 · 선정 인플루언서는 신청자 목록을 상태로 걸러 받는다. */
  const changeProductTab = (t: typeof productTab) => {
    if (!selectedProduct) return;
    setProductTab(t);
    if (t === 'applicants' || t === 'selected') {
      const f = t === 'selected' ? 'approved' : '';
      setRequestFilter(f);
      setRequests([]);
      setRequestsLoaded(false);
      setRequestsHasMore(false);
      void loadRequests(null, selectedProduct.id, f);
    }
  };

  /** 상품 "더 보기": 목록만 받아 뒤에 붙인다. 실패하면 목록은 두고 아래에 오류만 보여 준다. */
  const loadMoreProducts = async () => {
    if (!productCursor) return;
    setProductsMoreLoading(true);
    setProductsMoreError('');
    const res = await affiliateStoreService.getBrand(businessUsername, productCursor);
    setProductsMoreLoading(false);
    if (res.error) { setProductsMoreError(res.error); return; }
    setProducts(prev => {
      const seen = new Set(prev.map(p => p.id));
      return [...prev, ...(res.products || []).filter(p => !seen.has(p.id))];
    });
    setProductCursor(res.productNextCursor || null);
    setProductHasMore(!!res.productHasMore);
  };

  const loadMoreRequests = () => { if (selectedProduct) void loadRequests(requestsCursor, selectedProduct.id, requestFilter); };

  /** 저장된 상품 한 건을 목록에 반영한다(신청 수는 저장 응답에 없어 기존 값을 둔다). */
  const upsertProduct = (saved: StoreProduct) => {
    setProducts(prev => {
      const i = prev.findIndex(p => p.id === saved.id);
      if (i < 0) return [saved, ...prev];
      const next = [...prev];
      next[i] = { ...saved, requestCounts: prev[i].requestCounts };
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 md:p-14">
        <p className="text-sm font-bold text-red-500 mb-3">{error}</p>
        <button onClick={() => { setLoading(true); load(); }} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black">다시 시도</button>
      </div>
    );
  }

  // 1) 입점 신청 전 · 반려 후 재신청
  if (!application || (application.status === 'rejected' && reapply)) {
    return (
      <AffiliateStoreApplication
        businessUsername={businessUsername}
        categories={categories}
        previous={application}
        onSubmitted={app => { setApplication(app); setReapply(false); }}
      />
    );
  }

  // 2) 검토 중 · 반려
  if (application.status !== 'approved') {
    const rejected = application.status === 'rejected';
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <div className={`w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center ${rejected ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'}`}>
            <Clock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black text-slate-900 mb-2">{rejected ? '입점 신청이 반려되었어요' : '입점 심사 중이에요'}</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            {rejected
              ? '아래 사유를 확인하고 내용을 고쳐 다시 신청해 주세요.'
              : '운영팀이 신청 내용을 확인하고 있어요. 승인되면 이 메뉴에서 바로 상품을 등록할 수 있습니다.'}
          </p>
          {rejected && application.rejectReason && (
            <p className="mt-4 text-xs text-red-500 bg-red-50 rounded-xl p-3 text-left whitespace-pre-wrap">{application.rejectReason}</p>
          )}
          <dl className="mt-6 text-left text-xs bg-slate-50 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between gap-3"><dt className="text-slate-400 font-bold">사업자명</dt><dd className="font-bold text-slate-800 text-right">{application.businessName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400 font-bold">브랜드</dt><dd className="font-bold text-slate-800 text-right">{application.brandName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400 font-bold">담당자</dt><dd className="font-bold text-slate-800 text-right">{application.contactName}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400 font-bold">신청일</dt><dd className="font-bold text-slate-800 text-right">{dateText(application.createdAt)}</dd></div>
          </dl>
          {rejected ? (
            <button onClick={() => setReapply(true)} className="mt-6 w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-black">다시 신청하기</button>
          ) : (
            <button onClick={() => { setLoading(true); load(); }} className="mt-6 w-full h-12 rounded-xl bg-slate-100 text-slate-700 text-sm font-black flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4" /> 심사 상태 새로고침
            </button>
          )}
        </div>
      </div>
    );
  }

  // 3) 승인 — 상품 등록 화면
  if (editing) {
    return (
      <main className="p-4 md:p-14">
        <AffiliateProductEditor
          businessUsername={businessUsername}
          taxonomy={taxonomy}
          feeRates={feeRates}
          product={editing === 'new' ? null : editing}
          defaultDeliveryGuide={
            [...products]
              .filter(p => p.deliveryGuide?.trim())
              .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.deliveryGuide || ''
          }
          onClose={() => setEditing(null)}
          onSaved={saved => { setEditing(null); upsertProduct(saved); void refreshCounts(); }}
        />
      </main>
    );
  }

  const pendingRequests = pendingRequestCount;
  // 이미 승인된 브랜드는 고객 문의 링크 · 판매자 정보(통신판매업 신고번호 등)가 비어 있을 수 있다 → 상단 배너로 등록 요청.
  const sellerMissing = sellerInfoMissing(application);
  const onSale = onSaleTotal;

  const removeProduct = async (p: StoreProduct) => {
    if (!window.confirm(`'${p.name}' 상품을 삭제할까요? 인플루언서 목록에서도 사라집니다.`)) return;
    setBusyId(p.id);
    const res = await affiliateStoreService.deleteProduct(businessUsername, p.id);
    setBusyId('');
    if (res.error) window.alert(res.error);
    else {
      setProducts(prev => prev.filter(x => x.id !== p.id));
      void refreshCounts();
    }
  };

  const toggleSale = async (p: StoreProduct) => {
    setBusyId(p.id);
    const { id, name, category, subcategory, summary, description, imageUrls, detailImageUrls, sizeGuide, deliveryGuide, descriptionImageUrls, sizeGuideImageUrls, deliveryGuideImageUrls, options, retailPrice, salePrice, commissionRate, stock, shippingFee, productUrl, saleStartDate, saleEndDate } = p;
    const res = await affiliateStoreService.saveProduct(businessUsername, {
      id, name, category, subcategory, summary, description, imageUrls, detailImageUrls: detailImageUrls || [], sizeGuide: sizeGuide || '', deliveryGuide: deliveryGuide || '', descriptionImageUrls: descriptionImageUrls || [], sizeGuideImageUrls: sizeGuideImageUrls || [], deliveryGuideImageUrls: deliveryGuideImageUrls || [], options, retailPrice, salePrice, commissionRate, stock, shippingFee, productUrl,
      saleStartDate: saleStartDate || '', saleEndDate: saleEndDate || '',
      status: p.status === 'on_sale' ? 'paused' : 'on_sale',
    });
    setBusyId('');
    if (res.error) window.alert(res.error);
    else {
      upsertProduct(res.product);
      void refreshCounts();
    }
  };

  const review = async (r: StoreRequest, decision: 'approve' | 'reject', agreed = false) => {
    let note = '';
    if (decision === 'reject') {
      const input = window.prompt('반려 사유를 적어 주세요(인플루언서에게 보입니다).', '');
      if (input === null) return;
      note = input;
    } else if (!application?.directDealAgreedAt && !agreed) {
      // 이전에 입점한 브랜드는 처음 선정할 때 직거래 금지 안내에 한 번 동의한다.
      setAgreeChecked(false);
      setAgreeFor(r);
      return;
    } else if (!agreed && !window.confirm(`@${r.influencerUsername} 님을 선정할까요?\n인플루언서에게 선정 알림이 가고, 인플루언서가 협찬 상품 배송정보를 입력하면 협업이 진행됩니다.\n상품을 보내고 송장번호를 입력하면 인플루언서의 전용 판매 링크가 열립니다.`)) {
      return;
    }
    setBusyId(r.id);
    const res = await affiliateStoreService.reviewRequest(businessUsername, r.id, decision, note, agreed || undefined);
    setBusyId('');
    if (res.error) {
      if (res.code === DIRECT_DEAL_AGREEMENT_REQUIRED) {
        setApplication(a => (a ? { ...a, directDealAgreedAt: null } : a));
        setAgreeChecked(false);
        setAgreeFor(r);
        return;
      }
      window.alert(res.error);
    } else {
      if (agreed) setApplication(a => (a ? { ...a, directDealAgreedAt: new Date().toISOString() } : a));
      // 응답에는 상품 이름 · 인스타 정보가 없어 기존 카드 값에 상태만 덮는다.
      setRequests(prev => prev.map(x => x.id === r.id ? {
        ...x, status: res.request.status, brandNote: res.request.brandNote, managerStatus: res.request.managerStatus,
        linkCode: res.request.linkCode, updatedAt: res.request.updatedAt, unseen: false,
        shippingStatus: res.request.shippingStatus,
      } : x));
      // 고른 상품 머리의 숫자도 바로 고친다.
      setSelectedProduct(prev => {
        if (!prev?.requestCounts) return prev;
        const c = { ...prev.requestCounts };
        const dec = (k: 'pending' | 'approved' | 'rejected') => { c[k] = Math.max(0, (c[k] || 0) - 1); };
        const inc = (k: 'pending' | 'approved' | 'rejected') => { c[k] = (c[k] || 0) + 1; };
        if (r.status === 'pending' || r.status === 'approved' || r.status === 'rejected') dec(r.status);
        inc(res.request.status === 'approved' ? 'approved' : 'rejected');
        return { ...prev, requestCounts: c as typeof prev.requestCounts };
      });
      void refreshCounts();
    }
  };

  /** 선정 카드 아래 한 줄 — 배송 · 업로드 단계 요약(입력은 진행 단계 탭에서). */
  const progressSummary = (r: StoreRequest) => {
    if (r.status !== 'approved') return null;
    if (r.shippingStatus === 'declined') {
      return (
        <div className="rounded-xl bg-slate-50 text-slate-500 text-[11px] font-bold px-3 py-2.5">
          인플루언서가 협업을 반려했어요. 이 협업은 진행되지 않아요.
          {r.declinedReason && <span className="block text-slate-400 font-medium mt-0.5 whitespace-pre-wrap">사유: {r.declinedReason}</span>}
        </div>
      );
    }
    const schedule = uploadScheduleOf(r);
    return (
      <button
        type="button"
        onClick={() => changeProductTab('progress')}
        className="w-full text-left rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5 text-[11px] flex items-center gap-2"
      >
        <span className="flex-1 min-w-0">
          <span className="font-black text-slate-700">
            {r.shippingStatus === 'info_submitted' ? '배송정보 도착 · 협찬 상품을 보내고 송장을 입력해 주세요' : r.shippingStatus === 'awaiting_info' ? '인플루언서 배송정보 입력 대기' : r.contentUrl ? '콘텐츠 업로드 완료' : '콘텐츠 업로드 대기'}
          </span>
          <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded font-black text-[10px] ${UPLOAD_TONE_STYLE[schedule.tone]}`}>{schedule.label}</span>
        </span>
        <span className="text-blue-600 font-black shrink-0">진행 단계 <ChevronRight className="inline w-3 h-3" /></span>
      </button>
    );
  };

  return (
    <main className="p-4 md:p-14 w-full">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-6">
        <div>
          <p className="text-[10px] font-black tracking-[0.2em] text-blue-600 uppercase mb-1">Affiliate</p>
          <h2 className="text-xl md:text-3xl font-black text-slate-900">어필리에이트</h2>
          <p className="text-xs md:text-sm text-slate-500 mt-1">상품을 등록하면 인플루언서가 확인하고 판매 신청을 보냅니다.</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-black flex items-center gap-1.5 shadow-lg shadow-blue-600/20 w-fit"
        >
          <Plus className="w-4 h-4" /> 상품 등록
        </button>
      </header>

      {newRequestCount > 0 && !(tab === 'requests' && !selectedProduct) && (
        <button
          onClick={() => { setTab('requests'); setSelectedProduct(null); setRequestProductsLoaded(false); }}
          className="w-full text-left mb-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center gap-3"
        >
          <span className="relative shrink-0">
            <Bell className="w-5 h-5 text-blue-600" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-blue-50" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-blue-800">새 판매 신청이 {newRequestCount.toLocaleString('ko-KR')}건 도착했어요</span>
            <span className="block text-xs text-blue-700 mt-0.5">상품별로 신청한 인플루언서를 확인하고 선정해 주세요.</span>
          </span>
          <ChevronRight className="w-4 h-4 text-blue-500 shrink-0" />
        </button>
      )}

      {shipPendingCount > 0 && (
        <button
          onClick={() => { setTab('requests'); setSelectedProduct(null); setRequestProductsLoaded(false); }}
          className="w-full text-left mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3"
        >
          <Truck className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-emerald-800">협찬 상품을 보낼 협업이 {shipPendingCount.toLocaleString('ko-KR')}건 있어요</span>
            <span className="block text-xs text-emerald-700 mt-0.5">인플루언서가 배송정보를 입력했어요. 상품을 보내고 송장번호를 입력하면 인플루언서의 판매 링크가 열려요.</span>
          </span>
          <ChevronRight className="w-4 h-4 text-emerald-500 shrink-0" />
        </button>
      )}

      {sellerMissing.length > 0 && (
        <button
          onClick={() => setTab('seller')}
          className="w-full text-left mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <span className="min-w-0">
            <span className="block text-sm font-black text-amber-800">
              {sellerMissing.includes('고객 문의 링크') ? '고객 문의 링크를 등록해 주세요' : '판매자 정보를 등록해 주세요'}
            </span>
            <span className="block text-xs text-amber-700 mt-0.5">
              비어 있는 항목: {sellerMissing.join(', ')}. 구매자가 문의하기를 누르면 고객 문의 링크(자사몰 · 카카오톡 채널 등)로 이동하고, 판매자 정보는 상품 페이지에 표시돼요.
              <b className="underline ml-1">판매자 정보에서 등록하기</b>
            </span>
          </span>
        </button>
      )}

      <div className="grid grid-cols-3 gap-2.5 md:gap-4 mb-6">
        {[
          { label: '등록 상품', value: productTotal },
          { label: '판매중', value: onSale },
          { label: '검토 대기 신청', value: pendingRequests },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
            <p className="text-[10px] md:text-xs font-black text-slate-400">{s.label}</p>
            <p className="text-xl md:text-3xl font-black text-slate-900 mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {([
          { key: 'products', label: '상품 관리', icon: Package },
          { key: 'requests', label: '진행관리', icon: Users, badge: newRequestCount + shipPendingCount },
          { key: 'orders', label: '주문 관리', icon: Truck, badge: opsCounts.newOrders },
          { key: 'claims', label: '취소·반품 현황', icon: RotateCcw, badge: opsCounts.claimsNeedAction },
          { key: 'seller', label: '판매자 정보', icon: Store, badge: sellerMissing.length > 0 ? 1 : 0 },
          { key: 'payouts', label: '정산', icon: Wallet },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); if (t.key === 'requests' && selectedProduct) closeProductRequests(); }}
            className={`h-9 px-4 rounded-lg text-xs font-black whitespace-nowrap flex items-center gap-1.5 ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {'badge' in t && t.badge > 0 && <span className="bg-red-500 text-white text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">{t.badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        products.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <Package className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-black text-slate-700">아직 등록한 상품이 없어요</p>
            <p className="text-xs text-slate-400 mt-1">첫 상품을 등록하고 인플루언서의 판매 신청을 받아 보세요.</p>
            <button onClick={() => setEditing('new')} className="mt-5 h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-black">상품 등록하기</button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_110px_110px_80px_90px_90px_150px] gap-3 px-5 py-3 text-[10px] font-black text-slate-400 border-b border-slate-100">
              <span>상품</span><span className="text-right">판매가</span><span className="text-right">수수료</span><span className="text-right">재고</span><span className="text-center">상태</span><span className="text-center">신청</span><span />
            </div>
            {products.map(p => (
              <div key={p.id} className="grid grid-cols-1 md:grid-cols-[1fr_110px_110px_80px_90px_90px_150px] gap-3 px-4 md:px-5 py-4 border-b border-slate-50 last:border-0 items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <img src={p.imageUrls[0]} alt="" className="w-16 h-16 md:w-12 md:h-12 rounded-xl object-cover bg-slate-100 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{p.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{p.category}{p.subcategory ? ` > ${p.subcategory}` : ''}{p.summary ? ` · ${p.summary}` : ''}</p>
                    <p className="text-[10px] text-slate-500 font-bold flex items-center gap-1 mt-0.5">
                      <CalendarDays className="w-3 h-3 text-slate-400" /> {salePeriodText(p.saleStartDate, p.saleEndDate)}
                      {p.status === 'on_sale' && p.saleState && p.saleState !== 'on_sale' && (
                        <span className={`ml-1 px-1.5 py-0.5 rounded font-black text-[9px] ${SALE_STATE_STYLE[p.saleState]}`}>{SALE_STATE_LABEL[p.saleState]}</span>
                      )}
                    </p>
                    <div className="md:hidden flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px]">
                      <span className="font-black text-slate-800">{won(p.salePrice)}</span>
                      <span className="text-blue-600 font-bold">수수료 {p.commissionRate}%</span>
                      <span className="text-slate-500">재고 {p.stock.toLocaleString('ko-KR')}</span>
                      <span className={`px-1.5 py-0.5 rounded font-black text-[10px] ${PRODUCT_STATUS_STYLE[p.status]}`}>{PRODUCT_STATUS_LABEL[p.status]}</span>
                    </div>
                  </div>
                </div>
                <div className="hidden md:block text-right">
                  <p className="text-sm font-black text-slate-800">{won(p.salePrice)}</p>
                  {p.retailPrice > p.salePrice && <p className="text-[10px] text-slate-400 line-through">{won(p.retailPrice)}</p>}
                </div>
                <p className="hidden md:block text-right text-sm font-bold text-blue-600">{p.commissionRate}%</p>
                <p className={`hidden md:block text-right text-sm font-bold ${p.stock <= 0 ? 'text-red-500' : 'text-slate-700'}`}>{p.stock.toLocaleString('ko-KR')}</p>
                <div className="hidden md:flex justify-center">
                  <span className={`px-2 py-1 rounded-md text-[10px] font-black ${PRODUCT_STATUS_STYLE[p.status]}`}>{PRODUCT_STATUS_LABEL[p.status]}</span>
                </div>
                <button
                  type="button"
                  onClick={() => openProductRequests(p)}
                  className="hidden md:flex flex-col items-center text-xs font-bold text-slate-500 hover:text-blue-600"
                >
                  <span>
                    {p.requestCounts?.approved || 0}명
                    {(p.requestCounts?.pending || 0) > 0 && <span className="text-amber-600"> · 대기 {p.requestCounts?.pending}</span>}
                  </span>
                  {(p.requestCounts?.unseen || 0) > 0 && (
                    <span className="mt-0.5 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-black">새 신청 {p.requestCounts?.unseen}</span>
                  )}
                </button>
                <div className="flex gap-1.5 justify-end">
                  {(p.requestCounts?.unseen || 0) > 0 && (
                    <button onClick={() => openProductRequests(p)} className="md:hidden h-8 px-2.5 rounded-lg bg-red-500 text-[11px] font-black text-white mr-auto">새 신청 {p.requestCounts?.unseen}</button>
                  )}
                  <button disabled={busyId === p.id} onClick={() => toggleSale(p)} className="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    {p.status === 'on_sale' ? '판매중지' : '판매시작'}
                  </button>
                  <button onClick={() => setEditing(p)} className="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50">수정</button>
                  <button disabled={busyId === p.id} onClick={() => removeProduct(p)} className="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] font-bold text-red-500 hover:bg-red-50 disabled:opacity-50">삭제</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'products' && productHasMore && (
        <div className="flex flex-col items-center gap-2 mt-5">
          {productsMoreError && <p className="text-xs font-bold text-red-500">{productsMoreError}</p>}
          <button disabled={productsMoreLoading} onClick={loadMoreProducts} className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50 flex items-center gap-2">
            {productsMoreLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {productsMoreError ? '다시 시도' : `상품 더 보기 (${products.length}/${productTotal})`}
          </button>
        </div>
      )}

      {(tab === 'orders' || tab === 'claims') && (
        <BrandAffiliateOrders key={tab} businessUsername={businessUsername} view={tab} onCounts={onOpsCounts} />
      )}
      {tab === 'payouts' && <AffiliatePayouts as="brand" account={businessUsername} />}
      {tab === 'seller' && (
        <BrandSellerInfo
          businessUsername={businessUsername}
          application={application}
          onSaved={app => setApplication(app)}
        />
      )}

      {tab === 'requests' && !selectedProduct && (
        requestProductsLoading && requestProducts.length === 0 ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : requestProductsError ? (
          <div className="py-6 text-center">
            <p className="text-sm font-bold text-red-500 mb-3">{requestProductsError}</p>
            <button onClick={() => { void loadRequestProducts(); }} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>
          </div>
        ) : requestProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-black text-slate-700">아직 진행 중인 어필리에이트가 없어요</p>
            <p className="text-xs text-slate-400 mt-1">상품을 '판매중'으로 두면 인플루언서에게 노출됩니다.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 font-bold">
              진행 중인 어필리에이트예요. 상품을 누르면 인플루언서 지원 현황 · 선정된 인플루언서 · 진행 단계(배송 현황 · 업로드 일정 · 업로드 링크 · 파트너십 코드) · 판매 현황을 볼 수 있어요.
              선정하면 인플루언서가 배송정보를 입력하고, 협찬 상품을 보내 송장번호를 입력하면 전용 판매 링크가 열려요. 인플루언서는 상품 수령 후 10일 이내에 콘텐츠를 업로드하고 판매를 시작해요.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {requestProducts.map(p => {
                const c = p.requestCounts || { pending: 0, approved: 0, rejected: 0, unseen: 0 };
                const unseen = c.unseen || 0;
                const state = p.saleState || (p.status === 'on_sale' ? 'on_sale' : 'paused');
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openProductRequests(p)}
                    className={`relative text-left bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-3 hover:border-blue-300 transition-colors ${unseen > 0 ? 'border-red-200' : (c.toShip || 0) > 0 ? 'border-blue-200' : 'border-slate-100'}`}
                  >
                    {unseen > 0 && (
                      <span className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center shadow">{unseen}</span>
                    )}
                    <img src={p.imageUrls[0]} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-100 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${SALE_STATE_STYLE[state]}`}>{SALE_STATE_LABEL[state]}</span>
                        {unseen > 0 && <span className="text-[10px] font-black text-red-500 flex items-center gap-0.5"><Bell className="w-3 h-3" /> 새 신청 {unseen}명</span>}
                      </div>
                      <p className="text-sm font-black text-slate-900 truncate">{p.name}</p>
                      <p className="text-[10px] text-slate-400 font-bold truncate">{salePeriodText(p.saleStartDate, p.saleEndDate)} · 수수료 {p.commissionRate}%</p>
                      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1 text-[11px] font-bold">
                        <span className="text-amber-600">검토 대기 {c.pending || 0}</span>
                        <span className="text-emerald-600">선정 {c.approved || 0}</span>
                        <span className="text-slate-400">반려 {c.rejected || 0}</span>
                        {(c.toShip || 0) > 0 && <span className="text-blue-600 flex items-center gap-0.5"><Truck className="w-3 h-3" /> 발송 대기 {c.toShip}</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}

      {tab === 'requests' && selectedProduct && (
        <div className="space-y-3">
          <button onClick={closeProductRequests} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> 진행 중인 어필리에이트
          </button>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5 flex items-center gap-4">
            <img src={selectedProduct.imageUrls[0]} alt="" className="w-16 h-16 md:w-20 md:h-20 rounded-xl object-cover bg-slate-100 shrink-0" />
            <div className="flex-1 min-w-0">
              {selectedProduct.saleState && (
                <span className={`inline-block mb-1 px-1.5 py-0.5 rounded text-[9px] font-black ${SALE_STATE_STYLE[selectedProduct.saleState]}`}>{SALE_STATE_LABEL[selectedProduct.saleState]}</span>
              )}
              <p className="text-base md:text-lg font-black text-slate-900 truncate">{selectedProduct.name}</p>
              <p className="text-[11px] text-slate-500 font-bold">
                {won(selectedProduct.salePrice)} · 수수료 <span className="text-blue-600">{selectedProduct.commissionRate}%</span> · {salePeriodText(selectedProduct.saleStartDate, selectedProduct.saleEndDate)}
              </p>
            </div>
          </div>
          <div className="flex gap-4 border-b border-slate-200 overflow-x-auto">
            {([
              { key: 'applicants', label: `지원 현황 ${(selectedProduct.requestCounts?.pending || 0) + (selectedProduct.requestCounts?.approved || 0) + (selectedProduct.requestCounts?.rejected || 0)}`, badge: selectedProduct.requestCounts?.unseen || 0 },
              { key: 'selected', label: `선정 인플루언서 ${selectedProduct.requestCounts?.approved || 0}`, badge: 0 },
              { key: 'progress', label: '진행 단계', badge: selectedProduct.requestCounts?.toShip || 0 },
              { key: 'sales', label: '판매 현황', badge: 0 },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => changeProductTab(t.key)}
                className={`pb-2.5 text-sm font-black border-b-2 -mb-px whitespace-nowrap flex items-center gap-1 ${productTab === t.key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}
              >
                {t.label}
                {t.badge > 0 && <span className="bg-red-500 text-white text-[9px] min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">{t.badge}</span>}
              </button>
            ))}
          </div>
          {productTab === 'progress' && (
            <AffiliateProgressBoard key={selectedProduct.id} businessUsername={businessUsername} productId={selectedProduct.id} onShipped={() => { void refreshCounts(); }} />
          )}
          {productTab === 'sales' && <AffiliateSalesBoard key={selectedProduct.id} businessUsername={businessUsername} productId={selectedProduct.id} />}
          {productTab === 'applicants' && (
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
            {([
              { key: '', label: '전체', n: (selectedProduct.requestCounts?.pending || 0) + (selectedProduct.requestCounts?.approved || 0) + (selectedProduct.requestCounts?.rejected || 0) },
              { key: 'pending', label: '검토 대기', n: selectedProduct.requestCounts?.pending || 0 },
              { key: 'rejected', label: '반려', n: selectedProduct.requestCounts?.rejected || 0 },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => changeRequestFilter(f.key)}
                className={`h-8 px-3.5 rounded-lg text-xs font-black whitespace-nowrap ${requestFilter === f.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {f.label} {f.n}
              </button>
            ))}
          </div>
          )}
          {(productTab === 'applicants' || productTab === 'selected') && (<>
          {requestsLoading && requests.length === 0 ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : requestsError ? (
            <div className="py-6 text-center">
              <p className="text-sm font-bold text-red-500 mb-3">{requestsError}</p>
              <button onClick={() => { void loadRequests(null, selectedProduct.id, requestFilter); }} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>
            </div>
          ) : requestsLoaded && requests.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
              <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-black text-slate-700">이 조건의 신청자가 없어요</p>
            </div>
          ) : (
            <>
              {/* 지원자는 광고비 지급형 캠페인 지원자와 같은 카드로 본다 — 인스타 프로필 · 팔로워 · 최근 릴스 3편. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
              {requests.map(r => (
                <InfluencerCandidateCard
                  key={r.id}
                  data={{
                    ...(r.insights || {}),
                    username: r.influencerUsername,
                    instagramUrl: r.insights?.instagramUrl || r.channelUrl || '',
                  }}
                  mediaMode="reels"
                  hidePrice
                  badges={
                    <>
                      {r.unseen && <span className="px-2 py-1 rounded-md text-[10px] font-black bg-red-500 text-white">NEW</span>}
                      <span className={`px-2 py-1 rounded-md text-[10px] font-black ${REQUEST_STATUS_STYLE[r.status]}`}>{REQUEST_STATUS_LABEL[r.status]}</span>
                      {r.status === 'approved' && r.shippingStatus ? (
                        <span className={`px-2 py-1 rounded-md text-[10px] font-black ${SHIPPING_STATUS_STYLE[r.shippingStatus]}`}>{SHIPPING_STATUS_LABEL[r.shippingStatus]}</span>
                      ) : r.status === 'approved' && r.managerStatus && (
                        <span className={`px-2 py-1 rounded-md text-[10px] font-black ${MANAGER_STATUS_STYLE[r.managerStatus]}`}>{MANAGER_STATUS_LABEL[r.managerStatus]}</span>
                      )}
                      <span className="text-[11px] text-slate-300 font-bold">{dateText(r.createdAt)}</span>
                    </>
                  }
                >
                  {progressSummary(r)}
                  <div className="flex items-center gap-2 pt-1 justify-end">
                    {r.status !== 'approved' && (
                      <button disabled={busyId === r.id} onClick={() => review(r, 'approve')} className="h-9 flex-1 px-3 rounded-lg bg-blue-600 text-white text-xs font-black disabled:opacity-50">선정</button>
                    )}
                    {r.status !== 'rejected' && r.shippingStatus !== 'info_submitted' && r.shippingStatus !== 'shipped' && r.shippingStatus !== 'declined' && (
                      <button disabled={busyId === r.id} onClick={() => review(r, 'reject')} className="h-9 flex-1 px-3 rounded-lg border border-slate-200 text-slate-600 text-xs font-black disabled:opacity-50">반려</button>
                    )}
                  </div>
                </InfluencerCandidateCard>
              ))}
              </div>
              {requestsHasMore && (
                <div className="flex flex-col items-center gap-2 mt-5">
                  {requestsMoreError && <p className="text-xs font-bold text-red-500">{requestsMoreError}</p>}
                  <button disabled={requestsLoading} onClick={loadMoreRequests} className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50 flex items-center gap-2">
                    {requestsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {requestsMoreError ? '다시 시도' : `신청자 더 보기 (${requests.length})`}
                  </button>
                </div>
              )}
            </>
          )}
          </>)}
        </div>
      )}

      {agreeFor && (
        <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setAgreeFor(null)} />
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 space-y-4">
            <div>
              <h3 className="text-base font-black text-slate-900">@{agreeFor.influencerUsername} 님을 선정할까요?</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">인플루언서에게 선정 알림이 가고, 인플루언서가 협찬 상품 배송정보를 입력하면 협업이 진행되고, 송장번호를 입력하면 인플루언서의 전용 판매 링크가 열립니다. 처음 선정하기 전에 아래 안내에 동의해 주세요.</p>
            </div>
            <DirectDealAgreement checked={agreeChecked} onChange={setAgreeChecked} />
            <div className="flex gap-2">
              <button onClick={() => setAgreeFor(null)} className="h-11 px-5 rounded-xl bg-slate-100 text-sm font-black text-slate-600">취소</button>
              <button
                disabled={!agreeChecked}
                onClick={() => { const r = agreeFor; setAgreeFor(null); void review(r, 'approve', true); }}
                className="flex-1 h-11 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50"
              >
                동의하고 선정
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default BrandAffiliateStore;
