import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Download, FileSpreadsheet, List, Loader2, Rows3, RotateCcw, Truck } from 'lucide-react';
import BulkShipDialog from './BulkShipDialog';
import { downloadOrdersExcel } from './orderExcel';
import {
  affiliateStoreService,
  won,
  ORDER_STATUS_LABEL,
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_STYLE,
  type BrandOpsSummary,
  type ListCursor,
  type StoreNotification,
  type StoreOrder,
} from '../../services/affiliateStoreService';

/**
 * 브랜드 주문 관리 · 취소·반품 현황.
 *
 * 주문 관리: 결제 완료 → 배송 준비 → 송장 입력(배송 중) → 배송 완료 순서로 처리한다.
 *   '배송 완료'는 송장 입력 후 하루가 지나야 누를 수 있다.
 * 취소·반품 현황: 주문취소(구매자 · 판매자 · 운영자 · 자동)와 반품을 한곳에서 본다. 거절한 반품도 이력으로 남는다.
 *   반품: 승인(입력 없음) → 브랜드가 주문 배송지로 직접 회수 → "환불 처리", 또는 승인 전 거절(사유 선택).
 *   회수 방법 · 일정 연락은 브랜드가 진행한다. 승인 뒤에는 "환불 처리"만 있고 거절로 바꿀 수 없다.
 *   반품 환불은 사유와 관계없이 상품 금액(판매가 × 수량) 전액만 환불한다. 주문 배송비는 환불하지 않고
 *   PG 수수료만 떼고 브랜드에 정산된다(왕복 배송비는 구매자와 직접 협의). 배송비가 0원이면 전액 취소와 같다.
 * 구매자 문의는 브랜드 자사몰(고객 문의 링크)로 연결되므로 이 화면에는 없다.
 *
 * 목록은 고른 필터로 서버에서 걸러 40건씩(커서) 받는다. 필터 숫자 · 정산 합계는 서버가 브랜드 전체 주문으로 센다.
 * 필터를 바꾸면 목록만 다시 받고, 주문을 처리하면 그 주문 한 줄과 숫자만 새로 받는다.
 *
 * 주문이 많을 때를 위해 '간단히 보기'(한 줄씩 · 누르면 펼침)와 '자세히 보기'(카드)를 고를 수 있다(브라우저에 기억).
 * 엑셀: 지금 필터의 주문을 내려받거나(선택한 주문만도 가능), 송장을 채운 엑셀을 올려 일괄 발송한다(BulkShipDialog).
 * 간단히 보기에서 여러 주문을 골라 '배송 준비'로 한 번에 바꿀 수 있다.
 */
const DENSITY_KEY = 'picks.brandOrders.density';
type Density = 'compact' | 'detail';
const readDensity = (): Density => {
  try { return localStorage.getItem(DENSITY_KEY) === 'detail' ? 'detail' : 'compact'; } catch { return 'compact'; }
};
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

const STYLE: Record<string, string> = {
  paid: 'bg-blue-50 text-blue-600',
  preparing: 'bg-indigo-50 text-indigo-600',
  shipped: 'bg-amber-50 text-amber-600',
  delivered: 'bg-emerald-50 text-emerald-600',
  confirmed: 'bg-slate-900 text-white',
  return_requested: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-500',
  pending_payment: 'bg-slate-100 text-slate-400',
};
const RETURN_LABEL: Record<string, string> = { requested: '반품 요청 · 확인 필요', approved: '반품 승인 · 회수 · 환불 대기', rejected: '반품 거절', refunded: '반품 환불 완료' };
const CANCEL_BY: Record<string, string> = { buyer: '구매자 취소', brand: '판매자 취소', operator: '운영자 환불', system: '자동 취소' };
const CANCEL_BY_STYLE: Record<string, string> = {
  buyer: 'bg-red-50 text-red-600', brand: 'bg-slate-100 text-slate-600', operator: 'bg-violet-50 text-violet-600', system: 'bg-slate-100 text-slate-500',
};
const COURIERS = ['CJ대한통운', '한진택배', '롯데택배', '우체국택배', '로젠택배', '경동택배', '기타'];

type Filter = 'new' | 'preparing' | 'shipped' | 'delivered' | 'all';
const FILTERS: { key: Filter; label: string; match: (o: StoreOrder) => boolean }[] = [
  { key: 'new', label: '신규 주문', match: o => o.status === 'paid' },
  { key: 'preparing', label: '배송 준비', match: o => o.status === 'preparing' },
  { key: 'shipped', label: '배송 중', match: o => o.status === 'shipped' },
  { key: 'delivered', label: '배송 완료 · 확정', match: o => o.status === 'delivered' || o.status === 'confirmed' },
  { key: 'all', label: '전체', match: () => true },
];

/** 취소·반품 현황에 들어가는 주문: 취소된 주문 + 반품 요청이 있었던 주문(거절 포함). */
export const isClaim = (o: StoreOrder) => o.status === 'cancelled' || !!o.returnRequest;
/** 처리 필요: 승인 · 거절하지 않은 반품, 승인 뒤 환불하지 않은 반품. */
export const claimNeedsAction = (o: StoreOrder) =>
  o.returnRequest?.status === 'requested' || (o.returnRequest?.status === 'approved' && o.status === 'return_requested');

type ClaimFilter = 'all' | 'cancel' | 'return' | 'action';
const CLAIM_FILTERS: { key: ClaimFilter; label: string; match: (o: StoreOrder) => boolean }[] = [
  { key: 'all', label: '전체', match: () => true },
  { key: 'cancel', label: '주문취소', match: o => !o.returnRequest },
  { key: 'return', label: '반품', match: o => !!o.returnRequest },
  { key: 'action', label: '처리 필요', match: claimNeedsAction },
];
const RETURN_STEPS = ['요청', '승인 · 회수', '환불 완료'];

const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

interface Props {
  businessUsername: string;
  view: 'orders' | 'claims';
  onCounts?: (c: { newOrders: number; claimsNeedAction: number; unread: number }) => void;
}

const BrandAffiliateOrders: React.FC<Props> = ({ businessUsername, view, onCounts }) => {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [notifications, setNotifications] = useState<StoreNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [summary, setSummary] = useState<BrandOpsSummary | null>(null);
  const [nextCursor, setNextCursor] = useState<ListCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [failedRequest, setFailedRequest] = useState<{ cursor?: ListCursor; append: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>('new');
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>('all');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<null | { kind: 'ship' | 'approve' | 'reject' | 'cancel' | 'refund'; order: StoreOrder }>(null);
  const [f1, setF1] = useState('');
  const [f2, setF2] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [notiOpen, setNotiOpen] = useState(false);
  const [density, setDensityState] = useState<Density>(readDensity);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const setDensity = (d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* 기억만 못 한다 */ }
  };
  // 숫자 · 정산 합계는 처음 한 번(과 주문 처리 뒤)만 받는다. 필터를 바꿀 때는 목록만.
  const summaryLoaded = useRef(false);
  // 필터를 빠르게 바꿀 때 늦게 도착한 예전 응답이 목록을 덮지 않게 한다.
  const loadSeq = useRef(0);

  const applySummary = useCallback((next?: BrandOpsSummary, notis?: StoreNotification[]) => {
    if (notis) setNotifications(notis);
    if (!next) return;
    summaryLoaded.current = true;
    setSummary(next);
    onCounts?.(next.opsCounts);
  }, [onCounts]);

  const load = useCallback(async (cursor?: ListCursor, append = false) => {
    const seq = ++loadSeq.current;
    if (append) setMoreLoading(true);
    else { setLoading(true); setOrders([]); setHasMore(false); setNextCursor(null); }
    setLoadError('');
    setFailedRequest(null);
    const res = await affiliateStoreService.brandOps(businessUsername, {
      view,
      filter: view === 'orders' ? filter : undefined,
      claim: view === 'claims' ? claimFilter : undefined,
      cursor,
      summary: !summaryLoaded.current,
    });
    if (seq !== loadSeq.current) return;
    setLoading(false);
    setMoreLoading(false);
    if (res.error) { setLoadError(res.error); setFailedRequest({ cursor, append }); return; }
    setOrders(prev => {
      if (!append) return res.orders || [];
      const seen = new Set(prev.map(o => o.id));
      return [...prev, ...(res.orders || []).filter(o => !seen.has(o.id))];
    });
    applySummary(res.summary, res.notifications);
    setNextCursor(res.nextCursor || null);
    setHasMore(!!res.hasMore);
  }, [businessUsername, view, filter, claimFilter, applySummary]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected(new Set()); setExpanded(new Set()); }, [filter, view]);

  /** 일괄 처리 뒤: 숫자까지 새로 받고 목록을 처음부터 다시 받는다. */
  const reloadAll = () => {
    summaryLoaded.current = false;
    setSelected(new Set());
    void load();
  };

  const exportExcel = async (only?: StoreOrder[]) => {
    setExporting(true);
    try {
      let list = only;
      if (!list) {
        const res = await affiliateStoreService.brandOrdersExport(businessUsername, filter);
        if (res.error) { window.alert(res.error); return; }
        list = res.orders || [];
        if (res.hasMore) window.alert('주문이 많아 최근 3,000건만 내려받아요. 필터를 나눠 받아 주세요.');
      }
      if (!list.length) { window.alert('내려받을 주문이 없어요.'); return; }
      const label = FILTERS.find(f => f.key === filter)?.label.replace(/\s*·\s*/g, '_') || '주문';
      await downloadOrdersExcel(list, `주문목록_${only ? '선택' : label}_${stamp()}.xlsx`);
    } catch {
      window.alert('엑셀 파일을 만들지 못했어요.');
    } finally {
      setExporting(false);
    }
  };

  const bulkPrepare = async (ids: string[]) => {
    if (!ids.length) return;
    if (!window.confirm(`결제 완료 주문 ${ids.length}건을 배송 준비로 바꿀까요? 구매자에게 알림이 가요.`)) return;
    setBulkBusy(true);
    let failed = 0;
    let lastError = '';
    for (let i = 0; i < ids.length; i += 100) {
      const res = await affiliateStoreService.bulkOrderAction(businessUsername, 'bulk_prepare', { ids: ids.slice(i, i + 100) });
      if (res.error) { failed += Math.min(100, ids.length - i); lastError = res.error; continue; }
      (res.results || []).forEach(r => { if (!r.ok) { failed++; lastError = r.error || ''; } });
    }
    setBulkBusy(false);
    if (failed) window.alert(`${ids.length - failed}건 처리 · ${failed}건 실패${lastError ? `(${lastError})` : ''}`);
    reloadAll();
  };

  /** 처리한 주문 한 줄만 새로 받는다. 지금 필터에 더는 맞지 않으면 목록에서 뺀다. 숫자도 함께 새로 받는다. */
  const refreshOrder = async (id: string) => {
    const refreshed = await affiliateStoreService.brandOps(businessUsername, { view, orderId: id, summary: true });
    if (refreshed.error) { await load(); return; }
    const row = refreshed.orders?.[0];
    const stillMatches = !!row && (view === 'orders'
      ? FILTERS.find(f => f.key === filter)!.match(row)
      : isClaim(row) && CLAIM_FILTERS.find(f => f.key === claimFilter)!.match(row));
    setOrders(prev => stillMatches && row ? prev.map(o => o.id === row.id ? row : o) : prev.filter(o => o.id !== id));
    applySummary(refreshed.summary, refreshed.notifications);
  };

  const act = async (action: string, payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    const res = await affiliateStoreService.orderAction(businessUsername, action, payload);
    setBusy('');
    if (res.error) return res.error;
    await refreshOrder(String(payload.id || ''));
    return '';
  };

  const quick = async (action: string, o: StoreOrder) => {
    const e = await act(action, { id: o.id }, o.id);
    if (e) window.alert(e);
  };

  const openDialog = (kind: 'ship' | 'approve' | 'reject' | 'cancel' | 'refund', order: StoreOrder) => {
    setDialog({ kind, order });
    setDialogError('');
    setF1(kind === 'ship' ? order.trackingCompany || COURIERS[0] : '');
    setF2(kind === 'ship' ? order.trackingNumber || '' : '');
  };

  // 반품 환불 금액 = 상품 금액(판매가 × 수량). 서버도 같은 값으로 다시 계산한다.
  const productAmount = (o: StoreOrder) => Math.min(Number(o.totalAmount) || 0, (Number(o.unitPrice) || 0) * (Number(o.quantity) || 0));

  const submitDialog = async () => {
    if (!dialog) return;
    const id = dialog.order.id;
    const map: Record<string, [string, Record<string, unknown>]> = {
      ship: ['ship', { id, trackingCompany: f1, trackingNumber: f2 }],
      approve: ['return_approve', { id }],
      reject: ['return_reject', { id, rejectReason: f1 }],
      cancel: ['cancel', { id, reason: f1 || '판매자 취소', memo: f2 }],
      refund: ['return_refund', { id }],
    };
    const [action, payload] = map[dialog.kind];
    const e = await act(action, payload, id);
    if (e) { setDialogError(e); return; }
    setDialog(null);
  };

  const openNotis = async () => {
    setNotiOpen(o => !o);
    if (notifications.some(n => !n.read_at)) {
      const res = await affiliateStoreService.orderAction(businessUsername, 'read_notifications', {});
      if (!res.error) {
        const readAt = new Date().toISOString();
        setNotifications(prev => prev.map(n => n.read_at ? n : { ...n, read_at: readAt }));
        if (summary) applySummary({ ...summary, opsCounts: { ...summary.opsCounts, unread: 0 } });
      }
    }
  };

  if (!summary && loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!summary && loadError) return (
    <div className="py-6 text-center">
      <p className="text-sm font-bold text-red-500 mb-3">{loadError}</p>
      <button onClick={() => { void load(); }} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>
    </div>
  );

  const unread = summary?.opsCounts.unread ?? notifications.filter(n => !n.read_at).length;
  // 목록은 서버가 고른 필터로 걸러서 준다.
  const visible = orders;
  const visibleClaims = orders;
  const listSpinner = <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  const sum = summary?.settlement || { payment: 0, commission: 0, pgFee: 0, platformFee: 0, amount: 0, confirmedAmount: 0 };
  const orderCounts = summary?.orderCounts || { new: 0, preparing: 0, shipped: 0, delivered: 0, all: 0 };
  const claimCounts = summary?.claimCounts || { all: 0, cancel: 0, return: 0, action: 0 };

  const now = Date.now();
  const actions = (o: StoreOrder) => {
    const ret = o.returnRequest;
    const deliverLocked = !!o.deliverableAt && new Date(o.deliverableAt).getTime() > now;
    return (
      <div className="flex justify-end items-center gap-1.5 mt-3 flex-wrap">
        {o.status === 'paid' && <button disabled={busy === o.id} onClick={() => quick('prepare', o)} className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-black">배송 준비</button>}
        {(o.status === 'paid' || o.status === 'preparing') && (
          <>
            <button onClick={() => openDialog('cancel', o)} className="h-8 px-3 rounded-lg border border-slate-200 text-red-500 text-[11px] font-black">주문 취소</button>
            <button onClick={() => openDialog('ship', o)} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-[11px] font-black">송장 입력 · 발송</button>
          </>
        )}
        {o.status === 'shipped' && (
          <>
            <button onClick={() => openDialog('ship', o)} className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-black">송장 수정</button>
            {deliverLocked && <span className="text-[10px] text-slate-400">송장 입력 후 하루가 지나면 배송 완료로 바꿀 수 있어요({dt(o.deliverableAt)}부터)</span>}
            <button disabled={busy === o.id || deliverLocked} onClick={() => quick('deliver', o)} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-black disabled:opacity-40">배송 완료</button>
          </>
        )}
        {ret?.status === 'requested' && o.status === 'return_requested' && (
          <>
            <button onClick={() => openDialog('reject', o)} className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-black">반품 거절</button>
            <button onClick={() => openDialog('approve', o)} className="h-8 px-3 rounded-lg bg-orange-500 text-white text-[11px] font-black">반품 승인</button>
          </>
        )}
        {ret?.status === 'approved' && o.status === 'return_requested' && (
          <button disabled={busy === o.id} onClick={() => openDialog('refund', o)} className="h-8 px-3 rounded-lg bg-red-500 text-white text-[11px] font-black">환불 처리</button>
        )}
      </div>
    );
  };

  const orderCard = (o: StoreOrder) => (
                <div key={o.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${o.status === 'return_requested' ? 'border-orange-200' : 'border-slate-100'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded ${STYLE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                        {o.status === 'cancelled' && o.cancelledBy && (
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded ${CANCEL_BY_STYLE[o.cancelledBy] || 'bg-slate-100 text-slate-500'}`}>{CANCEL_BY[o.cancelledBy] || o.cancelledBy}</span>
                        )}
                        {o.returnRequest && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-orange-50 text-orange-600">{RETURN_LABEL[o.returnRequest.status]}</span>}
                        {o.isNew && <span className="text-[9px] font-black text-red-500">NEW</span>}
                      </div>
                      <p className="text-sm font-black text-slate-900 mt-1 truncate">{o.productName}{o.optionName ? ` · ${o.optionName}` : ''} × {o.quantity}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{dt(o.paidAt || o.createdAt)} · {o.id}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">{won(o.totalAmount)}</p>
                      <p className="text-[11px] text-slate-400">
                        <a href={`/${o.influencerUsername}`} target="_blank" rel="noreferrer" className="font-bold text-blue-600">@{o.influencerUsername}</a>{' '}
                        수수료 {o.commissionStatus === 'cancelled' ? <s>{won(o.commissionAmount)}</s> : won(o.commissionAmount)}
                      </p>
                      {o.commissionStatus && (
                        <p className="text-[10px] mt-0.5">
                          <span className={`font-black px-1.5 py-0.5 rounded ${COMMISSION_STATUS_STYLE[o.commissionStatus]}`}>{COMMISSION_STATUS_LABEL[o.commissionStatus]}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 주문별 정산 내역. 수수료율은 주문 시점에 고정된 값이다. */}
                  {o.settlement && (
                    <div className={`mt-3 grid grid-cols-2 md:grid-cols-5 gap-1.5 text-[11px] rounded-xl p-2.5 ${o.settlement.included ? 'bg-blue-50/50' : 'bg-slate-50 text-slate-400'}`}>
                      <div><p className="text-slate-400">결제 금액</p><p className="font-black">{won(o.settlement.payment)}</p><p className="text-[10px] text-slate-400">상품 {won(o.settlement.product)} + 배송 {won(o.settlement.shipping)}</p></div>
                      <div><p className="text-slate-400">인플루언서 수수료</p><p className="font-black">−{won(o.settlement.commission)}</p><p className="text-[10px] text-slate-400">상품 금액의 {o.commissionRate}%</p></div>
                      <div><p className="text-slate-400">PG 수수료(결제 금액 기준, 배송비 포함)</p><p className="font-black">−{won(o.settlement.pgFee)}</p><p className="text-[10px] text-slate-400">{o.payMethod === 'KAKAOPAY' ? '카카오페이' : '카드'} {o.pgRate}% · 배송비 포함</p></div>
                      <div><p className="text-slate-400">플랫폼 수수료</p><p className="font-black">−{won(o.settlement.platformFee)}</p><p className="text-[10px] text-slate-400">상품 금액의 {o.platformRate}%</p></div>
                      <div><p className="text-slate-400">정산 예정액</p><p className={`font-black ${o.settlement.included ? 'text-blue-700' : ''}`}>{won(o.settlement.amount)}</p><p className="text-[10px] text-slate-400">{!o.settlement.included ? '취소 · 환불로 정산 제외' : o.settlement.partialRefund ? `반품 환불 ${won(o.settlement.partialRefund)} 제외 · 남은 배송비 정산` : ''}</p></div>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-2 mt-3 text-xs">
                    <div className="bg-slate-50 rounded-xl p-3 space-y-0.5">
                      <p className="text-[10px] font-black text-slate-400">받는 분</p>
                      <p className="font-bold text-slate-800">{o.recipientName} · {o.recipientPhone}</p>
                      <p className="text-slate-600">{o.postcode ? `(${o.postcode}) ` : ''}{o.address1} {o.address2}</p>
                      {o.deliveryMemo && <p className="text-slate-500">메모: {o.deliveryMemo}</p>}
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 space-y-0.5">
                      <p className="text-[10px] font-black text-slate-400">주문자</p>
                      <p className="font-bold text-slate-800">{o.buyerName} · {o.buyerPhone}</p>
                      {o.trackingNumber && (
                        <p className="text-slate-600 pt-1">송장 {o.trackingCompany} {o.trackingNumber} {o.trackingUrl && <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="text-blue-600 font-bold">조회</a>}</p>
                      )}
                      {o.status === 'cancelled' && <p className="text-red-500 pt-1">취소 사유: {o.cancelReason}{o.cancelMemo ? ` · ${o.cancelMemo}` : ''} · 환불 {won(o.refundAmount || 0)}</p>}
                    </div>
                  </div>
                  {o.returnRequest && <p className="mt-2 text-[11px] font-bold text-orange-600">반품 내용과 처리는 '취소·반품 현황' 탭에서 확인해 주세요.</p>}
                  {actions(o)}
                </div>
  );

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        {/* 정산 요약(표시만 · 지급/세금계산서는 별도). 취소 · 환불 주문은 정산 대상이 아니라 합계에서 빠진다.
            정산 예정액 = 결제 금액(상품 + 배송비) − 인플루언서 수수료 − PG 수수료(결제 금액 기준, 배송비 포함) − 플랫폼 수수료(상품 금액 기준) */}
        {view === 'orders' ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 flex-1">
            {[
              { label: '결제 금액', value: sum.payment, cls: 'text-slate-900' },
              { label: '인플루언서 수수료', value: -sum.commission, cls: 'text-blue-600' },
              { label: 'PG 수수료(결제 금액 기준, 배송비 포함)', value: -sum.pgFee, cls: 'text-slate-600' },
              { label: '플랫폼 수수료', value: -sum.platformFee, cls: 'text-slate-600' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                <p className="text-[10px] font-black text-slate-400">{c.label}</p>
                <p className={`text-base md:text-lg font-black ${c.cls}`}>{c.value < 0 ? `−${won(-c.value)}` : won(c.value)}</p>
              </div>
            ))}
            <div className="bg-slate-900 rounded-2xl shadow-sm p-4 text-white col-span-2 md:col-span-1">
              <p className="text-[10px] font-black text-slate-300">정산 예정액</p>
              <p className="text-base md:text-lg font-black">{won(sum.amount)}</p>
              <p className="text-[9px] text-slate-400 mt-0.5">구매확정분 {won(sum.confirmedAmount)} · 취소 제외</p>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5 flex-wrap flex-1">
            {CLAIM_FILTERS.map(f => {
              const n = claimCounts[f.key];
              return (
                <button key={f.key} onClick={() => setClaimFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${claimFilter === f.key ? 'bg-slate-900 text-white' : f.key === 'action' && n > 0 ? 'bg-orange-50 border border-orange-200 text-orange-600' : 'bg-white border border-slate-200 text-slate-500'}`}>
                  {f.label} {n}
                </button>
              );
            })}
          </div>
        )}
        <div className="relative">
          <button onClick={openNotis} className="relative w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center" aria-label="알림">
            <Bell className="w-4 h-4 text-slate-600" />
            {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">{unread}</span>}
          </button>
          {notiOpen && (
            <div className="absolute right-0 top-12 w-72 max-h-80 overflow-y-auto bg-white rounded-2xl border border-slate-100 shadow-xl z-30 divide-y divide-slate-50">
              {notifications.length === 0 ? <p className="p-4 text-xs text-slate-400">알림이 없어요</p> : notifications.map(n => (
                <div key={n.id} className="p-3">
                  <p className={`text-xs ${n.read_at ? 'text-slate-600' : 'font-black text-slate-900'}`}>{n.title}</p>
                  {n.body && <p className="text-[11px] text-slate-500 mt-0.5">{n.body}</p>}
                  <p className="text-[10px] text-slate-300 mt-0.5">{dt(n.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {view === 'orders' && (
        <>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {FILTERS.map(f => {
              const n = orderCounts[f.key];
              return (
                <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${filter === f.key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>
                  {f.label} {n}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button onClick={() => setDensity('compact')} className={`h-7 px-2.5 rounded-md text-[11px] font-black flex items-center gap-1 ${density === 'compact' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}><List className="w-3.5 h-3.5" />간단히</button>
              <button onClick={() => setDensity('detail')} className={`h-7 px-2.5 rounded-md text-[11px] font-black flex items-center gap-1 ${density === 'detail' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}><Rows3 className="w-3.5 h-3.5" />자세히</button>
            </div>
            <div className="flex gap-1.5">
              <button disabled={exporting} onClick={() => { void exportExcel(); }} className="h-8 px-3 rounded-lg bg-white border border-slate-200 text-[11px] font-black text-slate-600 flex items-center gap-1.5 disabled:opacity-50">
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}엑셀 다운로드
              </button>
              <button onClick={() => setBulkOpen(true)} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-black flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5" />엑셀로 송장 일괄 등록
              </button>
            </div>
          </div>

          {density === 'compact' && selected.size > 0 && (() => {
            const picked = visible.filter(o => selected.has(o.id));
            const payable = picked.filter(o => o.status === 'paid').map(o => o.id);
            return (
              <div className="sticky top-2 z-20 mb-2 flex items-center gap-2 flex-wrap rounded-xl bg-slate-900 text-white px-3 py-2 text-[11px] shadow-lg">
                <span className="font-black">{picked.length}건 선택</span>
                <button disabled={bulkBusy || payable.length === 0} onClick={() => { void bulkPrepare(payable); }} className="h-7 px-2.5 rounded-md bg-white text-slate-900 font-black disabled:opacity-40 flex items-center gap-1">
                  {bulkBusy && <Loader2 className="w-3 h-3 animate-spin" />}배송 준비로 변경{payable.length ? ` ${payable.length}건` : ''}
                </button>
                <button disabled={exporting} onClick={() => { void exportExcel(picked); }} className="h-7 px-2.5 rounded-md bg-white/10 font-black disabled:opacity-40">선택 엑셀 다운로드</button>
                <button onClick={() => setSelected(new Set())} className="ml-auto text-slate-300 font-bold">선택 해제</button>
              </div>
            );
          })()}

          {loading ? listSpinner : visible.length === 0 ? (
            !loadError && (
              <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
                <Truck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-black text-slate-700">해당하는 주문이 없어요</p>
              </div>
            )
          ) : (
            <>
              {density === 'compact' && (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="hidden md:grid grid-cols-[28px_minmax(0,1fr)_110px_90px_120px_130px_20px] gap-2 items-center px-3 py-2 bg-slate-50 text-[10px] font-black text-slate-400">
                    <input type="checkbox" aria-label="전체 선택" checked={visible.length > 0 && visible.every(o => selected.has(o.id))} onChange={e => setSelected(e.target.checked ? new Set(visible.map(o => o.id)) : new Set())} className="w-3.5 h-3.5" />
                    <span>상품 · 주문번호</span><span>받는 분</span><span className="text-right">결제 금액</span><span>주문일시</span><span className="text-right">처리</span><span />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {visible.map(o => {
                      const open = expanded.has(o.id);
                      const toggle = () => setExpanded(prev => { const n = new Set(prev); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; });
                      return (
                        <div key={o.id} className={o.status === 'return_requested' ? 'bg-orange-50/40' : ''}>
                          <div className="grid grid-cols-[28px_minmax(0,1fr)_auto_20px] md:grid-cols-[28px_minmax(0,1fr)_110px_90px_120px_130px_20px] gap-2 items-center px-3 py-2 hover:bg-slate-50/70">
                            <input
                              type="checkbox"
                              aria-label="주문 선택"
                              checked={selected.has(o.id)}
                              onChange={e => setSelected(prev => { const n = new Set(prev); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })}
                              className="w-3.5 h-3.5"
                            />
                            <button onClick={toggle} className="min-w-0 text-left">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded ${STYLE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                                {o.isNew && <span className="shrink-0 text-[9px] font-black text-red-500">NEW</span>}
                                {o.returnRequest && <span className="shrink-0 text-[9px] font-black text-orange-600">반품</span>}
                                <span className="text-xs font-black text-slate-900 truncate">{o.productName}{o.optionName ? ` · ${o.optionName}` : ''} × {o.quantity}</span>
                              </div>
                              <p className="text-[10px] text-slate-400 truncate">
                                {o.id}
                                <span className="md:hidden"> · {o.recipientName} · {won(o.totalAmount)}</span>
                                {o.trackingNumber ? ` · ${o.trackingCompany} ${o.trackingNumber}` : ''}
                              </p>
                            </button>
                            <span className="hidden md:block text-xs text-slate-700 truncate">{o.recipientName}</span>
                            <span className="hidden md:block text-xs font-black text-slate-900 text-right">{won(o.totalAmount)}</span>
                            <span className="hidden md:block text-[11px] text-slate-400">{dt(o.paidAt || o.createdAt)}</span>
                            <div className="flex justify-end">
                              {o.status === 'paid' && <button disabled={busy === o.id} onClick={() => quick('prepare', o)} className="h-7 px-2.5 rounded-md border border-slate-200 text-slate-600 text-[10px] font-black whitespace-nowrap">배송 준비</button>}
                              {o.status === 'preparing' && <button onClick={() => openDialog('ship', o)} className="h-7 px-2.5 rounded-md bg-blue-600 text-white text-[10px] font-black whitespace-nowrap">송장 입력</button>}
                              {o.status === 'shipped' && <button disabled={busy === o.id || (!!o.deliverableAt && new Date(o.deliverableAt).getTime() > now)} onClick={() => quick('deliver', o)} className="h-7 px-2.5 rounded-md bg-emerald-600 text-white text-[10px] font-black whitespace-nowrap disabled:opacity-40">배송 완료</button>}
                            </div>
                            <button onClick={toggle} aria-label={open ? '접기' : '펼치기'} className="text-slate-400"><ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
                          </div>
                          {open && <div className="px-3 pb-3">{orderCard(o)}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {density === 'detail' && <div className="space-y-2.5">{visible.map(o => orderCard(o))}</div>}
            </>
          )}
        </>
      )}

      {view === 'claims' && (
        loading ? listSpinner : visibleClaims.length === 0 ? (
          !loadError && (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
              <RotateCcw className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-black text-slate-700">해당하는 취소 · 반품이 없어요</p>
            </div>
          )
        ) : (
          <div className="space-y-2.5">
            {visibleClaims.map(o => {
              const ret = o.returnRequest;
              const needs = claimNeedsAction(o);
              const stepIdx = ret ? (ret.status === 'refunded' ? 2 : ret.status === 'approved' ? 1 : ret.status === 'rejected' ? 1 : 0) : -1;
              return (
                <div key={o.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${needs ? 'border-orange-300' : 'border-slate-100'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {ret
                          ? <span className="text-[10px] font-black px-2 py-0.5 rounded bg-orange-50 text-orange-600">반품</span>
                          : <span className={`text-[10px] font-black px-2 py-0.5 rounded ${CANCEL_BY_STYLE[o.cancelledBy || ''] || 'bg-slate-100 text-slate-500'}`}>{CANCEL_BY[o.cancelledBy || ''] || '주문취소'}</span>}
                        {ret && <span className={`text-[10px] font-black px-2 py-0.5 rounded ${ret.status === 'rejected' ? 'bg-red-50 text-red-500' : 'bg-white border border-orange-200 text-orange-600'}`}>{RETURN_LABEL[ret.status]}</span>}
                        {ret && o.status === 'cancelled' && o.cancelledBy === 'operator' && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-violet-50 text-violet-600">운영자 환불</span>}
                        {needs && <span className="text-[9px] font-black text-red-500">처리 필요</span>}
                      </div>
                      <p className="text-sm font-black text-slate-900 mt-1 truncate">{o.productName}{o.optionName ? ` · ${o.optionName}` : ''} × {o.quantity}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">구매자 {o.buyerName} · 신청일 {dt(claimDate(o))} · {o.id}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">{won(o.totalAmount)}</p>
                      {o.status === 'cancelled' && (
                        <p className="text-[11px] text-red-500 font-bold">환불 {won(o.refundAmount || 0)}{(o.refundAmount || 0) < o.totalAmount ? ' (부분)' : ''}</p>
                      )}
                    </div>
                  </div>

                  {ret ? (
                    <div className="mt-3 rounded-xl bg-orange-50/50 border border-orange-100 p-3 text-xs space-y-2">
                      <div className="flex items-center">
                        {RETURN_STEPS.map((label, i) => {
                          const rejectedHere = ret.status === 'rejected' && i === 1;
                          const on = i <= stepIdx;
                          return (
                            <React.Fragment key={label}>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded ${rejectedHere ? 'bg-red-500 text-white' : on ? 'bg-orange-500 text-white' : 'bg-white text-slate-300 border border-slate-100'}`}>{rejectedHere ? '거절' : label}</span>
                              {i < RETURN_STEPS.length - 1 && !(ret.status === 'rejected' && i >= 1) && <span className={`flex-1 h-0.5 mx-1 ${i < stepIdx ? 'bg-orange-400' : 'bg-slate-200'}`} />}
                            </React.Fragment>
                          );
                        })}
                      </div>
                      <p className="text-slate-700">사유: <b>{ret.reason}</b>{ret.memo ? ` · ${ret.memo}` : ''}</p>
                      {ret.photoUrls.length > 0 && (
                        <div className="flex gap-1.5">{ret.photoUrls.map(u => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-14 h-14 rounded-lg object-cover" /></a>)}</div>
                      )}
                      {ret.status === 'approved' && <p className="text-slate-600">주문 배송지({o.recipientName} · {o.address1} {o.address2})로 상품을 회수한 뒤 "환불 처리"를 눌러 주세요.</p>}
                      {ret.status === 'refunded' && <p className="text-slate-600">환불 {won(ret.refundAmount || o.refundAmount || 0)}{(ret.shippingDeduction || 0) > 0 ? ` · 배송비 ${won(ret.shippingDeduction || 0)} 환불 안 함(PG 수수료 뺀 금액 정산)` : ''} · {dt(ret.refundedAt)}</p>}
                      {ret.status === 'rejected' && <p className="text-red-500">반품 거절{ret.rejectReason ? ` · 사유: ${ret.rejectReason}` : ''} · {dt(ret.decidedAt)}</p>}
                      {ret.status === 'approved' && <p className="text-[11px] text-slate-400">승인한 반품은 거절로 바꿀 수 없어요. 회수에 문제가 있으면 구매자에게 직접 연락하거나 픽스폴리오 고객센터로 문의해 주세요.</p>}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                      사유: <b>{o.cancelReason || '-'}</b>{o.cancelMemo ? ` · ${o.cancelMemo}` : ''} · 취소일 {dt(o.cancelledAt)}
                    </div>
                  )}
                  {actions(o)}
                </div>
              );
            })}
          </div>
        )
      )}

      {(hasMore || loadError) && (
        <div className="flex flex-col items-center gap-2 pt-4">
          {loadError && <p className="text-xs font-bold text-red-500">{loadError}</p>}
          {loadError ? (
            <button
              disabled={moreLoading || loading}
              onClick={() => { void load(failedRequest?.cursor, failedRequest?.append ?? false); }}
              className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50"
            >다시 시도</button>
          ) : hasMore && (
            <button
              disabled={moreLoading}
              onClick={() => { void load(nextCursor || undefined, true); }}
              className="h-10 px-6 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 disabled:opacity-50 flex items-center gap-2"
            >
              {moreLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              더 보기
            </button>
          )}
        </div>
      )}

      {bulkOpen && <BulkShipDialog businessUsername={businessUsername} onClose={() => setBulkOpen(false)} onDone={reloadAll} />}

      {dialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDialog(null)} />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-black text-slate-900">
              {{ ship: '송장 입력', approve: '반품 승인', reject: '반품 거절', cancel: '주문 취소(전액 환불)', refund: '환불 처리' }[dialog.kind]}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{dialog.order.productName}</p>
            {dialog.kind === 'ship' && (
              <>
                <select value={f1} onChange={e => setF1(e.target.value)} className="mt-4 w-full h-11 px-3 rounded-xl border border-slate-200 text-sm">
                  {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={f2} onChange={e => setF2(e.target.value)} placeholder="송장번호" className="mt-2 w-full h-11 px-3 rounded-xl border border-slate-200 text-sm" maxLength={60} />
                <p className="text-[11px] text-slate-400 mt-2">송장을 입력하면 구매자는 주문취소 대신 반품을 요청할 수 있어요. '배송 완료'는 송장 입력 후 하루가 지나야 누를 수 있어요.</p>
              </>
            )}
            {dialog.kind === 'approve' && (
              <>
                <p className="mt-4 text-sm text-slate-700 leading-relaxed">승인하면 주문 배송지로 상품을 회수해 주세요. 회수 후 환불 처리를 눌러야 구매자에게 환불돼요.</p>
                <p className="text-[11px] text-slate-400 mt-2">승인한 뒤에는 거절로 바꿀 수 없어요.</p>
              </>
            )}
            {dialog.kind === 'reject' && (
              <>
                <textarea value={f1} onChange={e => setF1(e.target.value)} placeholder="거절 사유 (선택, 적으면 구매자에게 보입니다)" className="mt-4 w-full min-h-[90px] p-3 rounded-xl border border-slate-200 text-sm" maxLength={500} />
                <p className="text-[11px] text-slate-400 mt-2">거절하면 반품 가능 기간과 구매확정 기준일이 거절 시점부터 다시 계산돼요.</p>
              </>
            )}
            {dialog.kind === 'cancel' && (
              <>
                <select value={f1} onChange={e => setF1(e.target.value)} className="mt-4 w-full h-11 px-3 rounded-xl border border-slate-200 text-sm">
                  <option value="">취소 사유 선택</option>
                  {['재고 부족', '배송 불가 지역', '구매자 요청', '기타'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <input value={f2} onChange={e => setF2(e.target.value)} placeholder="메모 (선택)" className="mt-2 w-full h-11 px-3 rounded-xl border border-slate-200 text-sm" maxLength={500} />
                <p className="text-[11px] text-slate-400 mt-2">결제가 즉시 전액 취소되고 재고가 복구되며 인플루언서 수수료도 취소됩니다.</p>
              </>
            )}
            {dialog.kind === 'refund' && (
              <div className="mt-4 space-y-2 text-xs">
                <p className="text-slate-600">반품 사유: <b>{dialog.order.returnRequest?.reason}</b></p>
                <p className="text-sm text-slate-700 leading-relaxed">상품 금액 {won(productAmount(dialog.order))}을 환불해요. 배송비는 환불되지 않고 카드 수수료({dialog.order.pgRate ?? 4}%)를 뺀 금액이 정산돼요. 필요하면 구매자와 직접 협의해 주세요.</p>
                <div className="rounded-xl bg-slate-50 p-3 flex justify-between font-black">
                  <span>환불 금액(상품 금액)</span>
                  <span className="text-slate-900">{won(productAmount(dialog.order))}</span>
                </div>
                <p className="text-[11px] text-slate-400">인플루언서 수수료 · 이용료는 0원이 되고, 환불하지 않은 배송비에서 PG 수수료만 빼고 정산돼요.</p>
                <p className="text-[11px] text-slate-400">상품 회수를 마친 뒤 눌러 주세요. 결제가 바로 취소(환불)되고 재고가 복구됩니다.</p>
              </div>
            )}
            {dialogError && <p className="text-xs font-bold text-red-500 mt-2">{dialogError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setDialog(null)} className="flex-1 h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-600">닫기</button>
              <button
                onClick={submitDialog}
                disabled={!!busy || (dialog.kind === 'ship' ? !f2.trim() : dialog.kind === 'cancel' ? !f1 : dialog.kind === 'refund' ? productAmount(dialog.order) <= 0 : false)}
                className="flex-1 h-11 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/** 취소·반품 현황의 신청일: 반품은 요청 시각, 취소는 취소 시각. */
function claimDate(o: StoreOrder) {
  return o.returnRequest?.requestedAt || o.cancelledAt || o.createdAt;
}

export default BrandAffiliateOrders;
