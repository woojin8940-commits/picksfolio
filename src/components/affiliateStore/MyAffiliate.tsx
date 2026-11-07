import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2 } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  shopLink,
  ORDER_STATUS_LABEL,
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_STYLE,
  type MyAffiliateItem,
  type StoreOrder,
} from '../../services/affiliateStoreService';

/**
 * MY 어필리에이트 — 선정(승인)된 상품과 인플루언서 전용 링크.
 *
 * 링크(/shop/<코드>)를 개인페이지 · 콘텐츠에 올리면, 그 링크로 들어온 고객이 픽스폴리오에서
 * 결제한 주문이 이 인플루언서 판매로 잡힌다. 방문 · 주문 · 판매액 · 예상 수수료를 상품별로 본다.
 */

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

const MyAffiliate: React.FC<{ onBrowse: () => void }> = ({ onBrowse }) => {
  const [items, setItems] = useState<MyAffiliateItem[]>([]);
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
  const [view, setView] = useState<'products' | 'orders'>('products');

  const load = useCallback(async () => {
    const res = await affiliateStoreService.myAffiliate();
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    setItems(res.items || []);
    setOrderCount(res.orderCount || 0);
    setTotals(res.totals);
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

  const selectView = (next: 'products' | 'orders') => {
    setView(next);
    if (next === 'orders' && !ordersLoaded && !ordersLoading) void loadOrders();
  };

  const copy = async (code: string) => {
    if (await copyText(shopLink(code))) {
      setCopied(code);
      window.setTimeout(() => setCopied(c => (c === code ? '' : c)), 1800);
    }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (error) return <p className="text-sm font-bold text-red-500 py-6">{error}</p>;

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
        <Link2 className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-black text-slate-700">아직 선정된 상품이 없어요</p>
        <p className="text-xs text-slate-400 mt-1">상품에 판매 신청하고 브랜드가 승인하면, 여기서 내 전용 판매 링크를 받을 수 있어요.</p>
        <button onClick={onBrowse} className="mt-4 h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-black">상품 둘러보기</button>
      </div>
    );
  }

  return (
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

      <div className="flex gap-4 border-b border-slate-200 mb-4">
        {([['products', `진행 상품 ${items.length}`], ['orders', `판매 내역 ${orderCount}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => selectView(k)} className={`pb-2.5 text-sm font-black border-b-2 -mb-px ${view === k ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>{label}</button>
        ))}
      </div>

      {view === 'products' ? (
        <div className="space-y-2.5">
          {items.map(i => (
            <div key={i.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex gap-3">
                {i.productImage && <img src={i.productImage} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-100 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] font-bold text-slate-400 truncate">{i.brandName}</p>
                    {!i.live && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">판매 중지 · 품절</span>}
                  </div>
                  <p className="text-sm font-black text-slate-900 truncate">{i.productName}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {won(i.salePrice)} · 수수료 <b className="text-blue-600">{i.commissionRate}%</b> (개당 {won(Math.floor(i.salePrice * i.commissionRate / 100))})
                  </p>
                </div>
              </div>

              {/* 인플루언서 전용 링크 */}
              <div className="mt-3 flex items-center gap-2 bg-slate-50 rounded-xl p-2 pl-3">
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

              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
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
            </div>
          ))}
        </div>
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
