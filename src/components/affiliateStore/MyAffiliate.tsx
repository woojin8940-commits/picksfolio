import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink, History, Link2, Loader2, Trash2, Undo2 } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  shopLink,
  ORDER_STATUS_LABEL,
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_STYLE,
  SALE_STATE_LABEL,
  SALE_STATE_STYLE,
  type AffiliateRecommendation,
  type MyAffiliateItem,
  type StoreOrder,
  type StoreProduct,
  type StoreRequest,
} from '../../services/affiliateStoreService';
import AffiliateStepBoard, { affiliateSteps } from './AffiliateStepBoard';
import SelectionShippingSheet from './SelectionShippingSheet';
import RecommendedAffiliates from './RecommendedAffiliates';

/**
 * MY 어필리에이트 — 선정(승인)된 상품과 인플루언서 전용 링크.
 *
 * 링크(/shop/<코드>)를 개인페이지 · 콘텐츠에 올리면, 그 링크로 들어온 고객이 픽스폴리오에서
 * 결제한 주문이 이 인플루언서 판매로 잡힌다. 방문 · 주문 · 판매액 · 예상 수수료를 상품별로 본다.
 *
 * 진행 상품은 어필리에이트 상품 목록처럼 작은 카드로 늘어놓고(지금 단계 배지), 카드를 누르면 그 상품의
 * 진행 단계(제품 배송 · 업로드 일정 · 업로드 링크 · 파트너십 코드)와 전용 링크 · 판매 수치가 안에서 열린다.
 * 선정됐지만 아직 협찬 상품이 나가기 전인 협업(배송정보 입력 · 발송 대기)도 카드로 함께 보여, 상세에서 배송정보를 입력한다.
 *
 * 브랜드가 판매를 중지했거나 판매가 끝난 상품은 '진행 상품'에서 지울 수 있다(기록은 남는다).
 * '진행 이력' 탭에는 지금까지 진행한 협업이 지운 것까지 모두 남는다.
 * '추천 어필리에이트' 탭에는 담당자가 이 인플루언서에게 어울린다고 골라 둔 상품이 뜬다(담당자 대시보드에서 리스트업).
 */

type View = 'products' | 'recommended' | 'history' | 'orders';

/** 진행 상품에서 지울 수 있는 협업 — 지금 이 링크로 살 수 없는(판매 중지 · 기간 종료 · 삭제) 상품. */
function canHide(i: MyAffiliateItem): boolean {
  if (i.live) return false;
  return i.productState === 'paused' || i.productState === 'draft' || i.productState === 'deleted' || i.productState === 'ended';
}

const dateText = (v?: string | null) => (v ? new Date(v).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '');

const ORDER_STYLE: Record<string, string> = {
  paid: 'bg-blue-50 text-blue-600',
  preparing: 'bg-indigo-50 text-indigo-600',
  confirmed: 'bg-slate-900 text-white',
  return_requested: 'bg-orange-50 text-orange-600',
  shipped: 'bg-amber-50 text-amber-600',
  delivered: 'bg-emerald-50 text-emerald-600',
  cancelled: 'bg-slate-100 text-slate-400',
  pending_payment: 'bg-slate-100 text-slate-400',
};

/** 카드 · 상세에 붙는 지금 단계 표시. */
function stageOf(i: MyAffiliateItem, waiting: boolean): { label: string; style: string; action: boolean } {
  if (i.shippingStatus === 'declined') return { label: '반려', style: 'bg-slate-100 text-slate-500', action: false };
  const steps = affiliateSteps(i, 'influencer');
  const action = steps.some(s => s.action);
  const cur = steps.find(s => !s.done);
  if (!cur) return { label: '진행 완료', style: 'bg-emerald-500 text-white', action };
  if (waiting || cur.key === 'shipping') return { label: '제품 배송', style: 'bg-blue-600 text-white', action };
  return { label: '링크 · 코드', style: 'bg-slate-900 text-white', action };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const MyAffiliate: React.FC<{ onBrowse: () => void; onOpenProduct?: (p: StoreProduct) => void }> = ({ onBrowse, onOpenProduct }) => {
  const [items, setItems] = useState<MyAffiliateItem[]>([]);
  const [preparing, setPreparing] = useState<MyAffiliateItem[]>([]);
  const [shippingFor, setShippingFor] = useState<StoreRequest | null>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [totals, setTotals] = useState({ clicks: 0, orders: 0, sales: 0, commission: 0, pending: 0, confirmed: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [ordersCursor, setOrdersCursor] = useState<{ cursorAt: string; cursorId: string } | null>(null);
  const [copied, setCopied] = useState('');
  const [view, setView] = useState<View>('products');
  const [recs, setRecs] = useState<AffiliateRecommendation[]>([]);
  const [recUnseen, setRecUnseen] = useState(0);
  const [hidingId, setHidingId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, rec] = await Promise.all([affiliateStoreService.myAffiliate(), affiliateStoreService.myRecommendations()]);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    setItems(res.items || []);
    setPreparing(res.preparing || []);
    setOrderCount(res.orderCount || 0);
    setTotals(res.totals);
    // 추천은 부가 정보라 실패해도 나머지 화면은 그대로 보여 준다.
    const recItems = rec.error ? [] : rec.items || [];
    setRecs(recItems);
    setRecUnseen(rec.error ? 0 : rec.unseenCount || 0);
    // 아직 진행 중인 상품이 없으면 담당자 추천부터 보여 준다.
    if (!(res.items || []).length && !(res.preparing || []).length && recItems.length) setView('recommended');
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadOrders = useCallback(async (cursor?: { cursorAt: string; cursorId: string }, append = false) => {
    setOrdersLoading(true);
    setOrdersError('');
    const res = await affiliateStoreService.myAffiliateOrders(cursor);
    setOrdersLoading(false);
    if (res.error) { setOrdersError(res.error); return; }
    setOrders(prev => {
      if (!append) return res.orders || [];
      const seen = new Set(prev.map(o => o.id));
      return [...prev, ...(res.orders || []).filter(o => !seen.has(o.id))];
    });
    setOrdersCursor(res.nextCursor || null);
    setOrdersHasMore(!!res.hasMore);
    setOrdersLoaded(true);
  }, []);

  const selectView = (next: View) => {
    setView(next);
    if (next === 'orders' && !ordersLoaded && !ordersLoading) void loadOrders();
  };

  // 추천 탭을 열면 새 추천을 확인한 것으로 남긴다(카드의 NEW 표시는 이번 화면에서는 그대로 둔다).
  useEffect(() => {
    if (view !== 'recommended' || recUnseen === 0) return;
    setRecUnseen(0);
    void affiliateStoreService.markRecommendationsSeen();
  }, [view, recUnseen]);

  const copy = async (code: string) => {
    if (await copyText(shopLink(code))) {
      setCopied(code);
      window.setTimeout(() => setCopied(c => (c === code ? '' : c)), 1800);
    }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (error) return <p className="text-sm font-bold text-red-500 py-6">{error}</p>;

  const patchItem = (id: string, patch: Partial<MyAffiliateItem>) =>
    setItems(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)));

  /** 판매 중지 · 종료된 상품을 진행 상품에서 지운다(hidden=false 면 다시 보이게). 진행 이력에는 남는다. */
  const setHidden = async (i: MyAffiliateItem, hidden: boolean) => {
    if (hidden && !window.confirm(`'${i.productName || '이 상품'}'을(를) 진행 상품에서 삭제할까요?\n진행 이력 탭에서는 계속 볼 수 있어요.`)) return;
    setHidingId(i.id);
    const res = await affiliateStoreService.hideMyAffiliate(i.id, hidden);
    setHidingId('');
    if (res.error) { window.alert(res.error); return; }
    const patch = { hiddenAt: hidden ? res.hiddenAt || new Date().toISOString() : null };
    setItems(prev => prev.map(x => (x.id === i.id ? { ...x, ...patch } : x)));
    setPreparing(prev => prev.map(x => (x.id === i.id ? { ...x, ...patch } : x)));
    if (hidden) setOpenId(null);
  };

  const stepHandlers = (i: MyAffiliateItem) => ({
    onEditShipping: () => setShippingFor(i),
    onConfirmReceived: async () => {
      const res = await affiliateStoreService.confirmReceived(i.id);
      if (res.error || !res.request) return res.error || '수령 확인을 하지 못했어요.';
      patchItem(i.id, { deliveredAt: res.request.deliveredAt, uploadDeadline: res.request.uploadDeadline });
    },
    onSubmitContent: async (url: string, code: string) => {
      const res = await affiliateStoreService.submitContent(i.id, url, code);
      if (res.error || !res.request) return res.error || '저장하지 못했어요.';
      patchItem(i.id, {
        contentUrl: res.request.contentUrl, partnershipCode: res.request.partnershipCode, contentSubmittedAt: res.request.contentSubmittedAt,
        deliveredAt: res.request.deliveredAt, uploadDeadline: res.request.uploadDeadline,
      });
    },
  });

  const shippingSheet = shippingFor && (
    <SelectionShippingSheet
      request={shippingFor}
      onClose={() => setShippingFor(null)}
      onDone={r => {
        setShippingFor(null);
        if (r.shippingStatus === 'declined') setPreparing(prev => prev.filter(x => x.id !== r.id));
        else setPreparing(prev => prev.map(x => (x.id === r.id ? { ...x, ...r, productName: x.productName, productImage: x.productImage, brandName: x.brandName } : x)));
      }}
    />
  );

  const all: { item: MyAffiliateItem; waiting: boolean }[] = [
    ...preparing.map(item => ({ item, waiting: true })),
    ...items.map(item => ({ item, waiting: false })),
  ];
  // 진행 상품 = 지우지 않은 협업. 진행 이력 = 지금까지 진행한 협업 전부(지운 것 포함 · 최근 순).
  const active = all.filter(x => !x.item.hiddenAt);
  const history = [...all].sort((a, b) => String(b.item.updatedAt || b.item.createdAt).localeCompare(String(a.item.updatedAt || a.item.createdAt)));

  if (all.length === 0 && recs.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
        <Link2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-black text-slate-700">아직 선정된 상품이 없어요</p>
        <p className="text-xs text-slate-400 mt-1">상품에 판매 신청하고 브랜드가 승인하면, 여기서 내 전용 판매 링크를 받을 수 있어요.</p>
        <button onClick={onBrowse} className="mt-4 h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-black">상품 둘러보기</button>
      </div>
    );
  }

  // ── 상품 하나의 진행 상황(브랜드 진행관리에서 카드를 눌러 여는 화면과 같은 방식) ──
  const opened = openId ? all.find(x => x.item.id === openId) : null;
  if (opened) {
    const i = opened.item;
    const stage = stageOf(i, opened.waiting);
    return (
      <div className="space-y-3">
        {shippingSheet}
        <button
          onClick={() => setOpenId(null)}
          className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> MY 어필리에이트로
        </button>
        {(i.hiddenAt || canHide(i)) && (
          <div className="flex items-center justify-between gap-3 bg-white border border-slate-100 rounded-xl px-3 py-2.5">
            <p className="text-[11px] font-bold text-slate-500 leading-snug">
              {i.hiddenAt ? '진행 상품 목록에 다시 보이게 할 수 있어요.' : '판매가 중지된 상품이에요. 진행 상품에서 삭제해도 진행 이력 · 판매 내역은 남아요.'}
            </p>
            <button
              type="button"
              disabled={hidingId === i.id}
              onClick={() => setHidden(i, !i.hiddenAt)}
              className={`h-8 px-3 rounded-lg border text-[11px] font-black flex items-center gap-1 shrink-0 disabled:opacity-50 ${i.hiddenAt ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-red-200 text-red-500 hover:bg-red-50'}`}
            >
              {hidingId === i.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : i.hiddenAt ? <Undo2 className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
              {i.hiddenAt ? '다시 표시' : '목록에서 삭제'}
            </button>
          </div>
        )}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:p-5 space-y-3">
          <div className="flex gap-3">
            {i.productImage && <img src={i.productImage} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-100 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-bold text-slate-400 truncate">{i.brandName}</p>
                {!opened.waiting && !i.live && (
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${i.productState ? SALE_STATE_STYLE[i.productState] : 'bg-slate-100 text-slate-500'}`}>
                    {i.productState && i.productState !== 'on_sale' ? SALE_STATE_LABEL[i.productState] : '판매 중지 · 품절'}
                  </span>
                )}
              </div>
              <p className="text-sm font-black text-slate-900 truncate">{i.productName}</p>
              {!opened.waiting && !i.live && (i.productState === 'paused' || i.productState === 'draft' || i.productState === 'deleted' || i.productState === 'ended') && (
                <p className="text-[11px] text-red-500 font-bold mt-0.5">
                  {i.productState === 'ended' ? '판매기간이 끝나 지금은 이 링크로 구매할 수 없어요.' : '브랜드가 판매를 중지한 상품이에요. 지금은 이 링크로 구매할 수 없어요.'}
                </p>
              )}
              {i.hiddenAt && (
                <p className="text-[11px] text-slate-400 font-bold mt-0.5">진행 상품에서 삭제한 협업이에요. 진행 이력에서만 보여요.</p>
              )}
              <p className="text-[11px] text-slate-500 mt-0.5">
                {won(i.salePrice)} · 수수료 <b className="text-blue-600">{i.commissionRate}%</b> (개당 {won(Math.floor(i.salePrice * i.commissionRate / 100))})
              </p>
            </div>
            <span className={`self-start px-2.5 py-1 rounded-lg text-[11px] font-black shrink-0 ${stage.style}`}>{stage.label}</span>
          </div>

          {opened.waiting ? (
            <p className="text-[11px] font-bold text-blue-600 bg-blue-50 rounded-xl px-3 py-2">협찬 상품이 발송되면 전용 판매 링크가 열려요.</p>
          ) : (
            <>
              {/* 인플루언서 전용 링크 */}
              <div className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl p-2 pl-3">
                <Link2 className="w-4 h-4 text-slate-400 shrink-0" />
                <p className="flex-1 min-w-0 text-xs font-mono text-slate-700 truncate">{i.linkCode ? shopLink(i.linkCode) : '링크 준비 중'}</p>
                {i.linkCode && (
                  <>
                    <a href={shopLink(i.linkCode)} target="_blank" rel="noreferrer" className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 shrink-0" aria-label="링크 열기">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button onClick={() => copy(i.linkCode)} className={`h-8 px-3 rounded-lg text-[11px] font-black flex items-center gap-1 shrink-0 ${copied === i.linkCode ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white'}`}>
                      {copied === i.linkCode ? <><Check className="w-3.5 h-3.5" /> 복사됨</> : <><Copy className="w-3.5 h-3.5" /> 링크 복사</>}
                    </button>
                  </>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2 text-center bg-white border border-slate-100 rounded-xl py-2.5">
                {[
                  ['방문', `${i.clickCount.toLocaleString('ko-KR')}`],
                  ['주문', `${i.stats.orders}`],
                  ['판매액', won(i.stats.sales)],
                  ['수수료', won(i.stats.commission)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-[10px] font-bold text-slate-400">{l}</p>
                    <p className={`text-xs font-black ${l === '수수료' ? 'text-blue-600' : 'text-slate-800'}`}>{v}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 진행 단계 — 캠페인 진행사항과 같은 모양(제품 배송 · 업로드 일정 · 업로드 링크 · 파트너십 코드). */}
          <AffiliateStepBoard key={i.id} role="influencer" request={i} {...stepHandlers(i)} />
        </div>
      </div>
    );
  }

  return (
    <>
      {shippingSheet}
      {items.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
            {[
              { label: '링크 방문', value: `${totals.clicks.toLocaleString('ko-KR')}회` },
              { label: '주문', value: `${totals.orders.toLocaleString('ko-KR')}건` },
              { label: '판매액', value: won(totals.sales) },
              { label: '수수료 (예정 + 확정)', value: won(totals.commission), accent: true },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl border p-4 ${s.accent ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-100 shadow-sm'}`}>
                <p className={`text-[10px] font-black ${s.accent ? 'text-blue-100' : 'text-slate-400'}`}>{s.label}</p>
                <p className="text-lg md:text-2xl font-black mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>

          {/* 정산 상태(표시만 · 지급은 별도). 예정 = 구매확정 전, 확정 = 구매확정, 취소 = 취소 · 환불된 판매 */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {[
              ['pending', '정산 예정', totals.pending],
              ['confirmed', '정산 확정', totals.confirmed],
              ['cancelled', '정산 취소', totals.cancelled],
            ].map(([k, label, v]) => (
              <div key={k as string} className={`rounded-xl p-3 ${COMMISSION_STATUS_STYLE[k as string]}`}>
                <p className="text-[10px] font-black opacity-80">{label as string}</p>
                <p className="text-sm md:text-base font-black">{won(v as number)}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 -mt-3 mb-5">구매확정(배송 완료 7일 뒤 자동)되면 예정 → 확정으로 바뀌어요. 지급 일정은 별도로 안내됩니다.</p>

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-5 text-xs text-blue-700 leading-relaxed">
            <b>전용 링크를 개인페이지에 올려 주세요.</b> 링크 관리 메뉴에서 새 링크로 붙여 넣으면 돼요.
            이 링크로 들어온 고객이 결제하면 내 판매로 잡히고, 판매가 기준 수수료가 쌓입니다.
          </div>
        </>
      )}

      <div className="flex gap-6 md:gap-10 border-b border-slate-200 mb-4 overflow-x-auto">
        {([['products', `진행 상품 ${active.length}`], ['recommended', `추천 어필리에이트 ${recs.length}`], ['history', `진행 이력 ${history.length}`], ['orders', `판매 내역 ${orderCount}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => selectView(k)} className={`pb-2.5 text-sm font-black border-b-2 -mb-px whitespace-nowrap flex items-center gap-1 ${view === k ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>
            {label}
            {k === 'recommended' && recUnseen > 0 && <span className="px-1.5 py-0.5 rounded-md bg-red-500 text-white text-[9px] font-black">N</span>}
          </button>
        ))}
      </div>

      {view === 'recommended' ? (
        <RecommendedAffiliates items={recs} onOpen={onOpenProduct} />
      ) : view === 'products' ? (
        <>
          {active.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
              <p className="text-sm font-black text-slate-700">진행 중인 상품이 없어요</p>
              <p className="text-xs text-slate-400 mt-1">지금까지 진행한 협업은 진행 이력 탭에서 볼 수 있어요.</p>
              <button onClick={onBrowse} className="mt-4 h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-black">상품 둘러보기</button>
            </div>
          ) : (
          <>
          <p className="text-[11px] text-slate-400 mb-3">상품을 누르면 진행 단계와 전용 링크를 볼 수 있어요. 판매가 중지된 상품은 목록에서 삭제할 수 있어요.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
            {active.map(({ item: i, waiting }) => {
              const stage = stageOf(i, waiting);
              const stopped = canHide(i);
              return (
                <div key={i.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col ${stopped ? 'border-slate-200' : 'border-slate-100'}`}>
                <button
                  onClick={() => setOpenId(i.id)}
                  className="text-left flex-1 hover:bg-slate-50/60 transition-colors"
                >
                  <div className="relative aspect-square bg-slate-100">
                    {i.productImage && <img src={i.productImage} alt="" className="w-full h-full object-cover" loading="lazy" />}
                    {stopped && <div className="absolute inset-0 bg-white/40" />}
                    <span className={`absolute top-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg ${stage.style}`}>{stage.label}</span>
                    {stage.action && <span className="absolute top-2 right-2 text-[10px] font-black px-2 py-1 rounded-lg bg-red-500 text-white">내 차례</span>}
                    {stopped && i.productState && (
                      <span className={`absolute bottom-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg ${SALE_STATE_STYLE[i.productState]}`}>{SALE_STATE_LABEL[i.productState]}</span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-[10px] font-bold text-slate-400 truncate">{i.brandName}</p>
                    <p className="text-xs md:text-sm font-black text-slate-900 line-clamp-2 min-h-[2.5em]">{i.productName}</p>
                    <p className="text-[11px] text-slate-500 mt-1 truncate">
                      {won(i.salePrice)} · 수수료 <b className="text-blue-600">{i.commissionRate}%</b>
                    </p>
                    {!waiting && (
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5 truncate">
                        주문 {i.stats.orders}건 · <span className="text-blue-600">{won(i.stats.commission)}</span>
                      </p>
                    )}
                  </div>
                </button>
                {stopped && (
                  <button
                    type="button"
                    disabled={hidingId === i.id}
                    onClick={() => setHidden(i, true)}
                    className="h-9 border-t border-slate-100 text-[11px] font-black text-red-500 hover:bg-red-50 flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    {hidingId === i.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    목록에서 삭제
                  </button>
                )}
                </div>
              );
            })}
          </div>
          </>
          )}
        </>
      ) : view === 'history' ? (
        <>
          <p className="text-[11px] text-slate-400 mb-3">지금까지 진행한 어필리에이트예요. 진행 상품에서 삭제한 협업도 여기에 남아요.</p>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            {history.map(({ item: i, waiting }) => {
              const stage = stageOf(i, waiting);
              const saleLabel = waiting ? '발송 전' : i.live ? '판매중' : i.productState && i.productState !== 'on_sale' ? SALE_STATE_LABEL[i.productState] : '판매 중지 · 품절';
              const saleStyle = waiting ? 'bg-blue-50 text-blue-600' : i.live ? 'bg-emerald-50 text-emerald-600' : i.productState ? SALE_STATE_STYLE[i.productState] : 'bg-slate-100 text-slate-500';
              return (
                <div key={i.id} className="p-3 md:p-4 flex items-center gap-3">
                  <button onClick={() => setOpenId(i.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    {i.productImage
                      ? <img src={i.productImage} alt="" className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0" loading="lazy" />
                      : <div className="w-14 h-14 rounded-xl bg-slate-100 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[10px] font-bold text-slate-400 truncate">{i.brandName}</p>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${saleStyle}`}>{saleLabel}</span>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${stage.style}`}>{stage.label}</span>
                        {i.hiddenAt && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-400">삭제된 상품</span>}
                      </div>
                      <p className="text-sm font-black text-slate-900 truncate mt-0.5">{i.productName}</p>
                      <p className="text-[11px] text-slate-400 font-bold truncate">
                        {dateText(i.createdAt)} 신청
                        {i.contentUrl ? ' · 콘텐츠 업로드 완료' : ''}
                        {!waiting && <> · 주문 {i.stats.orders}건 · <span className="text-blue-600">수수료 {won(i.stats.commission)}</span></>}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {i.contentUrl && (
                      <a href={i.contentUrl} target="_blank" rel="noreferrer" className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50" aria-label="콘텐츠 열기">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {i.hiddenAt && (
                      <button
                        type="button"
                        disabled={hidingId === i.id}
                        onClick={() => setHidden(i, false)}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-50 flex items-center gap-1 disabled:opacity-50"
                      >
                        {hidingId === i.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">다시 표시</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {history.length === 0 && (
            <div className="py-10 text-center">
              <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-black text-slate-700">아직 진행한 어필리에이트가 없어요</p>
            </div>
          )}
        </>
      ) : ordersLoading && orders.length === 0 ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : ordersError && orders.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm font-bold text-red-500 mb-3">{ordersError}</p>
          <button onClick={() => { void loadOrders(); }} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm font-black text-slate-700">아직 판매 내역이 없어요</p>
          <p className="text-xs text-slate-400 mt-1">전용 링크로 결제된 주문이 여기에 쌓입니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-50">
          {orders.map(o => (
            <div key={o.id} className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">{o.productName}{o.optionName ? ` · ${o.optionName}` : ''}</p>
                <p className="text-[11px] text-slate-400">{new Date(o.paidAt || o.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })} · {o.quantity}개 · {won(o.totalAmount - o.shippingFee)}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-[10px] font-black px-2 py-0.5 rounded ${ORDER_STYLE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                <p className={`text-xs font-black mt-1 ${o.commissionStatus === 'cancelled' ? 'text-slate-300 line-through' : 'text-blue-600'}`}>+{won(o.commissionAmount)}</p>
                {o.commissionStatus && <span className={`inline-block mt-0.5 text-[9px] font-black px-1.5 py-0.5 rounded ${COMMISSION_STATUS_STYLE[o.commissionStatus]}`}>{COMMISSION_STATUS_LABEL[o.commissionStatus]}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {view === 'orders' && (ordersHasMore || ordersError) && (
        <div className="flex flex-col items-center gap-2 pt-4">
          {ordersError && <p className="text-xs font-bold text-red-500">{ordersError}</p>}
          {ordersError ? (
            <button disabled={ordersLoading} onClick={() => { void loadOrders(ordersCursor || undefined, !!ordersCursor); }} className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50">다시 시도</button>
          ) : (
            <button disabled={ordersLoading} onClick={() => { void loadOrders(ordersCursor || undefined, true); }} className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50 flex items-center gap-2">
              {ordersLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              더 보기
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default MyAffiliate;
