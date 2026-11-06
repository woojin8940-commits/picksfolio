import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, Loader2, Package, Plus, RefreshCw, RotateCcw, Store, Truck, Users, Wallet } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  PRODUCT_STATUS_LABEL,
  REQUEST_STATUS_LABEL,
  MANAGER_STATUS_LABEL,
  MANAGER_STATUS_STYLE,
  sellerInfoMissing,
  type CategoryNode,
  type FeeRates,
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

/**
 * 브랜드 어필리에이트 메뉴(ZVZO 방식).
 *
 *   신청서 없음 · 반려 → 입점 신청서
 *   검토 중            → 대기 안내
 *   승인               → 상품 관리 · 판매 신청 관리
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
  const [categories, setCategories] = useState<string[]>([]);
  const [taxonomy, setTaxonomy] = useState<CategoryNode[]>([]);
  const [feeRates, setFeeRates] = useState<FeeRates | null>(null);
  const [opsCounts, setOpsCounts] = useState({ newOrders: 0, claimsNeedAction: 0, unread: 0 });
  const onOpsCounts = useCallback((c: typeof opsCounts) => setOpsCounts(c), []);
  const [tab, setTab] = useState<'products' | 'requests' | 'orders' | 'claims' | 'seller' | 'payouts'>('products');
  const [editing, setEditing] = useState<StoreProduct | 'new' | null>(null);
  const [reapply, setReapply] = useState(false);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setError('');
    const res = await affiliateStoreService.getBrand(businessUsername);
    if (res.error) setError(res.error);
    else {
      setApplication(res.application);
      setProducts(res.products || []);
      setRequests(res.requests || []);
      setCategories(res.categories || []);
      setTaxonomy(res.taxonomy || []);
      setFeeRates(res.feeRates || null);
    }
    setLoading(false);
  }, [businessUsername]);

  useEffect(() => { load(); }, [load]);

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
          onSaved={() => { setEditing(null); load(); }}
        />
      </main>
    );
  }

  const pendingRequests = requests.filter(r => r.status === 'pending').length;
  // 이미 승인된 브랜드는 고객 문의 링크 · 판매자 정보(통신판매업 신고번호 등)가 비어 있을 수 있다 → 상단 배너로 등록 요청.
  const sellerMissing = sellerInfoMissing(application);
  const onSale = products.filter(p => p.status === 'on_sale').length;

  const removeProduct = async (p: StoreProduct) => {
    if (!window.confirm(`'${p.name}' 상품을 삭제할까요? 인플루언서 목록에서도 사라집니다.`)) return;
    setBusyId(p.id);
    const res = await affiliateStoreService.deleteProduct(businessUsername, p.id);
    setBusyId('');
    if (res.error) window.alert(res.error);
    else load();
  };

  const toggleSale = async (p: StoreProduct) => {
    setBusyId(p.id);
    const { id, name, category, subcategory, summary, description, imageUrls, detailImageUrls, sizeGuide, deliveryGuide, descriptionImageUrls, sizeGuideImageUrls, deliveryGuideImageUrls, options, retailPrice, salePrice, commissionRate, stock, shippingFee, productUrl } = p;
    const res = await affiliateStoreService.saveProduct(businessUsername, {
      id, name, category, subcategory, summary, description, imageUrls, detailImageUrls: detailImageUrls || [], sizeGuide: sizeGuide || '', deliveryGuide: deliveryGuide || '', descriptionImageUrls: descriptionImageUrls || [], sizeGuideImageUrls: sizeGuideImageUrls || [], deliveryGuideImageUrls: deliveryGuideImageUrls || [], options, retailPrice, salePrice, commissionRate, stock, shippingFee, productUrl,
      status: p.status === 'on_sale' ? 'paused' : 'on_sale',
    });
    setBusyId('');
    if (res.error) window.alert(res.error);
    else load();
  };

  const review = async (r: StoreRequest, decision: 'approve' | 'reject') => {
    let note = '';
    if (decision === 'reject') {
      const input = window.prompt('반려 사유를 적어 주세요(인플루언서에게 보입니다).', '');
      if (input === null) return;
      note = input;
    } else if (!window.confirm(`@${r.influencerUsername} 님을 선정할까요?\n선정하면 인플루언서에게 바로 전용 판매 링크가 열립니다.`)) {
      return;
    }
    setBusyId(r.id);
    const res = await affiliateStoreService.reviewRequest(businessUsername, r.id, decision, note);
    setBusyId('');
    if (res.error) window.alert(res.error);
    else load();
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
          { label: '등록 상품', value: products.length },
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
          { key: 'requests', label: '판매 신청', icon: Users, badge: pendingRequests },
          { key: 'orders', label: '주문 관리', icon: Truck, badge: opsCounts.newOrders },
          { key: 'claims', label: '취소·반품 현황', icon: RotateCcw, badge: opsCounts.claimsNeedAction },
          { key: 'seller', label: '판매자 정보', icon: Store, badge: sellerMissing.length > 0 ? 1 : 0 },
          { key: 'payouts', label: '정산', icon: Wallet },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
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
                <p className="hidden md:block text-center text-xs font-bold text-slate-500">
                  {p.requestCounts?.approved || 0}명
                  {(p.requestCounts?.pending || 0) > 0 && <span className="text-amber-600"> · 대기 {p.requestCounts?.pending}</span>}
                </p>
                <div className="flex gap-1.5 justify-end">
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

      {(tab === 'orders' || tab === 'claims') && (
        <BrandAffiliateOrders key={tab} businessUsername={businessUsername} view={tab} onCounts={onOpsCounts} />
      )}
      {/* 주문 관리 탭을 열기 전에도 배지가 보이도록 숨겨서 한 번 읽는다. */}
      {tab !== 'orders' && tab !== 'claims' && (
        <div className="hidden"><BrandAffiliateOrders businessUsername={businessUsername} view="orders" onCounts={onOpsCounts} /></div>
      )}
      {tab === 'payouts' && <AffiliatePayouts as="brand" account={businessUsername} />}
      {tab === 'seller' && (
        <BrandSellerInfo
          businessUsername={businessUsername}
          application={application}
          onSaved={app => setApplication(app)}
        />
      )}

      {tab === 'requests' && (
        requests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-black text-slate-700">아직 받은 판매 신청이 없어요</p>
            <p className="text-xs text-slate-400 mt-1">상품을 '판매중'으로 두면 인플루언서에게 노출됩니다.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 font-bold">
              함께할 인플루언서를 선정하면 바로 인플루언서의 전용 판매 링크가 열려 판매를 시작할 수 있습니다.
            </div>
            {/* 지원자는 캠페인 지원자와 같은 카드로 본다 — 인스타 프로필 · 팔로워 · 최근 릴스 3편. */}
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
                    <span className={`px-2 py-1 rounded-md text-[10px] font-black ${REQUEST_STATUS_STYLE[r.status]}`}>{REQUEST_STATUS_LABEL[r.status]}</span>
                    {r.status === 'approved' && r.managerStatus && (
                      <span className={`px-2 py-1 rounded-md text-[10px] font-black ${MANAGER_STATUS_STYLE[r.managerStatus]}`}>{MANAGER_STATUS_LABEL[r.managerStatus]}</span>
                    )}
                    <span className="text-[11px] text-slate-300 font-bold">{dateText(r.createdAt)}</span>
                  </>
                }
              >
                <div className="flex items-center gap-2 pt-1">
                  {r.productImage && <img src={r.productImage} alt="" className="w-9 h-9 rounded-lg object-cover bg-slate-100 shrink-0" />}
                  <p className="text-xs font-bold text-slate-600 truncate flex-1 min-w-0">{r.productName}</p>
                  {r.status !== 'approved' && (
                    <button disabled={busyId === r.id} onClick={() => review(r, 'approve')} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-[11px] font-black disabled:opacity-50 shrink-0">선정</button>
                  )}
                  {r.status !== 'rejected' && (
                    <button disabled={busyId === r.id} onClick={() => review(r, 'reject')} className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-black disabled:opacity-50 shrink-0">반려</button>
                  )}
                </div>
              </InfluencerCandidateCard>
            ))}
            </div>
          </div>
        )
      )}
    </main>
  );
};

export default BrandAffiliateStore;
