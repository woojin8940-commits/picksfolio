import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, MessageCircle, Truck } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  ORDER_STATUS_LABEL,
  COMMISSION_STATUS_LABEL,
  COMMISSION_STATUS_STYLE,
  type BrandInquiry,
  type StoreNotification,
  type StoreOrder,
} from '../../services/affiliateStoreService';

/**
 * 브랜드 주문 관리 · 구매자 문의.
 *
 * 결제 완료 → 배송 준비 → 송장 입력(배송 중) → 배송 완료 순서로 처리한다. 구매자가 송장 입력
 * 전에 취소하면 "구매자 취소"로 표시된다(환불 · 재고 복구 · 수수료 취소는 이미 끝난 상태).
 * 교환·반품 요청은 승인(반품 주소 · 회수 안내) → 회수 확인 후 환불 완료, 또는 거절(사유)로 처리한다.
 */

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
const RETURN_LABEL: Record<string, string> = { requested: '반품 요청 · 확인 필요', approved: '반품 승인 · 회수 대기', rejected: '반품 거절', refunded: '반품 환불 완료' };
const CANCEL_BY: Record<string, string> = { buyer: '구매자 취소', brand: '판매자 취소', operator: '운영자 환불' };
const COURIERS = ['CJ대한통운', '한진택배', '롯데택배', '우체국택배', '로젠택배', '경동택배', '기타'];

type Filter = 'new' | 'preparing' | 'shipped' | 'delivered' | 'returns' | 'cancelled' | 'all';
const FILTERS: { key: Filter; label: string; match: (o: StoreOrder) => boolean }[] = [
  { key: 'new', label: '신규 주문', match: o => o.status === 'paid' },
  { key: 'preparing', label: '배송 준비', match: o => o.status === 'preparing' },
  { key: 'shipped', label: '배송 중', match: o => o.status === 'shipped' },
  { key: 'delivered', label: '배송 완료 · 확정', match: o => o.status === 'delivered' || o.status === 'confirmed' },
  { key: 'returns', label: '반품 요청', match: o => o.status === 'return_requested' },
  { key: 'cancelled', label: '취소 · 환불', match: o => o.status === 'cancelled' },
  { key: 'all', label: '전체', match: () => true },
];

const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

interface Props {
  businessUsername: string;
  view: 'orders' | 'inquiries';
  onCounts?: (c: { newOrders: number; returns: number; inquiries: number; unread: number }) => void;
}

const BrandAffiliateOrders: React.FC<Props> = ({ businessUsername, view, onCounts }) => {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [inquiries, setInquiries] = useState<BrandInquiry[]>([]);
  const [notifications, setNotifications] = useState<StoreNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('new');
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState<null | { kind: 'ship' | 'approve' | 'reject' | 'cancel' | 'answer'; order?: StoreOrder; inquiry?: BrandInquiry }>(null);
  const [f1, setF1] = useState('');
  const [f2, setF2] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [notiOpen, setNotiOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await affiliateStoreService.brandOps(businessUsername);
    setLoading(false);
    if (res.error) { setLoadError(res.error); return; }
    setLoadError('');
    setOrders(res.orders || []);
    setInquiries(res.inquiries || []);
    setNotifications(res.notifications || []);
    onCounts?.({
      newOrders: (res.orders || []).filter(o => o.status === 'paid').length,
      returns: (res.orders || []).filter(o => o.returnRequest?.status === 'requested').length,
      inquiries: (res.inquiries || []).filter(q => !q.answer).length,
      unread: (res.notifications || []).filter(n => !n.read_at).length,
    });
  }, [businessUsername, onCounts]);
  useEffect(() => { load(); }, [load]);

  const act = async (action: string, payload: Record<string, unknown>, key: string) => {
    setBusy(key);
    const res = await affiliateStoreService.orderAction(businessUsername, action, payload);
    setBusy('');
    if (res.error) return res.error;
    await load();
    return '';
  };

  const quick = async (action: string, o: StoreOrder) => {
    const e = await act(action, { id: o.id }, o.id);
    if (e) window.alert(e);
  };

  const openDialog = (kind: 'ship' | 'approve' | 'reject' | 'cancel' | 'answer', order?: StoreOrder, inquiry?: BrandInquiry) => {
    setDialog({ kind, order, inquiry });
    setDialogError('');
    setF1(kind === 'ship' ? order?.trackingCompany || COURIERS[0] : '');
    setF2(kind === 'ship' ? order?.trackingNumber || '' : '');
  };

  const submitDialog = async () => {
    if (!dialog) return;
    const id = dialog.order?.id || dialog.inquiry?.id || '';
    const map: Record<string, [string, Record<string, unknown>]> = {
      ship: ['ship', { id, trackingCompany: f1, trackingNumber: f2 }],
      approve: ['return_approve', { id, returnAddress: f1, pickupMessage: f2 }],
      reject: ['return_reject', { id, rejectReason: f1 }],
      cancel: ['cancel', { id, reason: f1 || '판매자 취소', memo: f2 }],
      answer: ['answer_inquiry', { id, answer: f1 }],
    };
    const [action, payload] = map[dialog.kind];
    const e = await act(action, payload, id);
    if (e) { setDialogError(e); return; }
    setDialog(null);
  };

  const refund = async (o: StoreOrder) => {
    if (!window.confirm(`상품 회수를 확인했나요? ${won(o.totalAmount)}을 전액 환불합니다.`)) return;
    const e = await act('return_refund', { id: o.id }, o.id);
    if (e) window.alert(e);
  };

  const openNotis = async () => {
    setNotiOpen(o => !o);
    if (notifications.some(n => !n.read_at)) {
      await affiliateStoreService.orderAction(businessUsername, 'read_notifications', {});
      load();
    }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (loadError) return <p className="text-sm font-bold text-red-500 py-6">{loadError}</p>;

  const unread = notifications.filter(n => !n.read_at).length;
  const visible = orders.filter(FILTERS.find(f => f.key === filter)!.match);
  // 정산 대상(취소 · 환불 제외) 합계. 주문마다 고정된 수수료율로 서버가 계산한 값을 더한다.
  const sum = orders.reduce((t, o) => {
    const st = o.settlement;
    if (!st || !st.included) return t;
    return {
      payment: t.payment + st.payment, commission: t.commission + st.commission, pgFee: t.pgFee + st.pgFee,
      platformFee: t.platformFee + st.platformFee, amount: t.amount + st.amount,
      confirmedAmount: t.confirmedAmount + (o.commissionStatus === 'confirmed' ? st.amount : 0),
    };
  }, { payment: 0, commission: 0, pgFee: 0, platformFee: 0, amount: 0, confirmedAmount: 0 });

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-4">
        {/* 정산 요약(표시만 · 지급/세금계산서는 별도). 취소 · 환불 주문은 정산 대상이 아니라 합계에서 빠진다.
            정산 예정액 = 결제 금액(상품 + 배송비) − 인플루언서 수수료 − PG 수수료 − 플랫폼 수수료 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 flex-1">
          {[
            { label: '결제 금액', value: sum.payment, cls: 'text-slate-900' },
            { label: '인플루언서 수수료', value: -sum.commission, cls: 'text-blue-600' },
            { label: 'PG 수수료', value: -sum.pgFee, cls: 'text-slate-600' },
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
              const n = orders.filter(f.match).length;
              return (
                <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${filter === f.key ? 'bg-slate-900 text-white' : f.key === 'returns' && n > 0 ? 'bg-orange-50 border border-orange-200 text-orange-600' : 'bg-white border border-slate-200 text-slate-500'}`}>
                  {f.label} {n}
                </button>
              );
            })}
          </div>

          {visible.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
              <Truck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-black text-slate-700">해당하는 주문이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visible.map(o => {
                const ret = o.returnRequest;
                return (
                  <div key={o.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${o.status === 'return_requested' ? 'border-orange-200' : 'border-slate-100'}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded ${STYLE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                          {o.status === 'cancelled' && o.cancelledBy && (
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded ${o.cancelledBy === 'buyer' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'}`}>{CANCEL_BY[o.cancelledBy] || o.cancelledBy}</span>
                          )}
                          {ret && <span className="text-[10px] font-black px-2 py-0.5 rounded bg-orange-50 text-orange-600">{RETURN_LABEL[ret.status]}</span>}
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
                        <div><p className="text-slate-400">PG 수수료</p><p className="font-black">−{won(o.settlement.pgFee)}</p><p className="text-[10px] text-slate-400">{o.payMethod === 'KAKAOPAY' ? '카카오페이' : '카드'} {o.pgRate}% · 배송비 포함</p></div>
                        <div><p className="text-slate-400">플랫폼 수수료</p><p className="font-black">−{won(o.settlement.platformFee)}</p><p className="text-[10px] text-slate-400">상품 금액의 {o.platformRate}%</p></div>
                        <div><p className="text-slate-400">정산 예정액</p><p className={`font-black ${o.settlement.included ? 'text-blue-700' : ''}`}>{won(o.settlement.amount)}</p><p className="text-[10px] text-slate-400">{o.settlement.included ? '' : '취소 · 환불로 정산 제외'}</p></div>
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

                    {ret && (
                      <div className="mt-2 rounded-xl bg-orange-50/60 border border-orange-100 p-3 text-xs space-y-1">
                        <p className="font-black text-orange-700">교환·반품 요청 · {dt(ret.requestedAt)}</p>
                        <p className="text-slate-700">사유: {ret.reason}{ret.memo ? ` · ${ret.memo}` : ''}</p>
                        {ret.photoUrls.length > 0 && (
                          <div className="flex gap-1.5">{ret.photoUrls.map(u => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-14 h-14 rounded-lg object-cover" /></a>)}</div>
                        )}
                        {ret.status === 'approved' && <p className="text-slate-600">반품 주소: {ret.returnAddress}{ret.pickupMessage ? ` · ${ret.pickupMessage}` : ''}</p>}
                        {ret.status === 'rejected' && <p className="text-red-500">거절 사유: {ret.rejectReason}</p>}
                      </div>
                    )}

                    <div className="flex justify-end gap-1.5 mt-3 flex-wrap">
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
                          <button disabled={busy === o.id} onClick={() => quick('deliver', o)} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[11px] font-black">배송 완료</button>
                        </>
                      )}
                      {ret?.status === 'requested' && (
                        <>
                          <button onClick={() => openDialog('reject', o)} className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-black">거절</button>
                          <button onClick={() => openDialog('approve', o)} className="h-8 px-3 rounded-lg bg-orange-500 text-white text-[11px] font-black">반품 승인</button>
                        </>
                      )}
                      {ret?.status === 'approved' && o.status === 'return_requested' && (
                        <>
                          <button onClick={() => openDialog('reject', o)} className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-black">거절</button>
                          <button disabled={busy === o.id} onClick={() => refund(o)} className="h-8 px-3 rounded-lg bg-red-500 text-white text-[11px] font-black">회수 확인 · 환불 완료</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {view === 'inquiries' && (
        inquiries.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <MessageCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-black text-slate-700">아직 받은 문의가 없어요</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {inquiries.map(q => (
              <div key={q.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${q.answer ? 'border-slate-100' : 'border-blue-200'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-400 truncate">{q.buyerName} · {q.productName}{q.orderId ? ` · 주문 ${q.orderId}` : ''}</p>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded shrink-0 ${q.answer ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'}`}>{q.answer ? '답변 완료' : '답변 필요'}</span>
                </div>
                <p className="text-sm text-slate-800 mt-1.5 whitespace-pre-wrap">{q.body}</p>
                <p className="text-[10px] text-slate-300 mt-1">{dt(q.createdAt)}</p>
                {q.answer && <p className="mt-2 text-xs bg-slate-50 rounded-xl p-3 text-slate-700 whitespace-pre-wrap">{q.answer}</p>}
                <div className="flex justify-end mt-2">
                  <button onClick={() => { openDialog('answer', undefined, q); setF1(q.answer || ''); }} className="h-8 px-3 rounded-lg bg-slate-900 text-white text-[11px] font-black">{q.answer ? '답변 수정' : '답변하기'}</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {dialog && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDialog(null)} />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-black text-slate-900">
              {{ ship: '송장 입력', approve: '반품 승인', reject: '반품 거절', cancel: '주문 취소(전액 환불)', answer: '문의 답변' }[dialog.kind]}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{dialog.order?.productName || dialog.inquiry?.productName}</p>
            {dialog.kind === 'ship' && (
              <>
                <select value={f1} onChange={e => setF1(e.target.value)} className="mt-4 w-full h-11 px-3 rounded-xl border border-slate-200 text-sm">
                  {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={f2} onChange={e => setF2(e.target.value)} placeholder="송장번호" className="mt-2 w-full h-11 px-3 rounded-xl border border-slate-200 text-sm" maxLength={60} />
                <p className="text-[11px] text-slate-400 mt-2">송장을 입력하면 구매자는 바로 취소할 수 없고 문의로 안내됩니다.</p>
              </>
            )}
            {dialog.kind === 'approve' && (
              <>
                <textarea value={f1} onChange={e => setF1(e.target.value)} placeholder="반품 받을 주소 (받는 사람 · 연락처 포함)" className="mt-4 w-full min-h-[70px] p-3 rounded-xl border border-slate-200 text-sm" maxLength={300} />
                <textarea value={f2} onChange={e => setF2(e.target.value)} placeholder="회수 안내 메시지 (택배 접수 방법, 반품 배송비 등)" className="mt-2 w-full min-h-[90px] p-3 rounded-xl border border-slate-200 text-sm" maxLength={1000} />
                <p className="text-[11px] text-slate-400 mt-2">구매자 주문 상세에 그대로 보입니다. 상품 회수를 확인한 뒤 "환불 완료"를 눌러 주세요.</p>
              </>
            )}
            {dialog.kind === 'reject' && (
              <textarea value={f1} onChange={e => setF1(e.target.value)} placeholder="거절 사유 (필수, 구매자에게 보입니다)" className="mt-4 w-full min-h-[90px] p-3 rounded-xl border border-slate-200 text-sm" maxLength={500} />
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
            {dialog.kind === 'answer' && (
              <textarea value={f1} onChange={e => setF1(e.target.value)} placeholder="답변을 입력해 주세요" className="mt-4 w-full min-h-[120px] p-3 rounded-xl border border-slate-200 text-sm" maxLength={2000} />
            )}
            {dialogError && <p className="text-xs font-bold text-red-500 mt-2">{dialogError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setDialog(null)} className="flex-1 h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-600">닫기</button>
              <button
                onClick={submitDialog}
                disabled={!!busy || (dialog.kind === 'ship' ? !f2.trim() : dialog.kind === 'cancel' ? !f1 : !f1.trim())}
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

export default BrandAffiliateOrders;
