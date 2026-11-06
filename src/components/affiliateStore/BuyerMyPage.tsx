import React, { useCallback, useEffect, useState } from 'react';
import { Bell, ChevronLeft, ChevronRight, ImagePlus, Loader2, Package, X } from 'lucide-react';
import {
  BUYER_STATUS_LABEL,
  BUYER_STATUS_STYLE,
  CANCEL_REASONS,
  RETURN_REASONS,
  buyerService,
  isSignedIn,
  loginWithKakao,
  safeBuyerReturnTo,
  type BuyerOrderDetail,
  type BuyerOrderListItem,
  type OrderEvent,
  type ReturnRequestInfo,
} from '../../services/affiliateBuyerService';
import { KakaoLoginButton, PlatformLegalFooter, SellerInquiry } from './ShopCommon';

/**
 * 구매자 마이페이지. 대시보드 메뉴 없이 따로 뜨는 화면이다(main.tsx 가 /my/* 에서 그린다).
 *
 *   /my/orders          주문 내역(최신순)
 *   /my/orders/<주문ID>  주문 상세 · 주문취소 · 반품 요청 · 문의하기(브랜드 자사몰로 연결)
 *
 * 구매자 신청은 "주문취소"(발송 전) · "반품 요청"(송장 입력 후 ~ 구매확정 전) 두 가지뿐이다(교환 기능 없음).
 * 예전의 픽스폴리오 안 문의(/my/inquiries)는 화면에서 숨겼다 — 주소로 들어오면 주문 내역을 보여 준다.
 */

const won = (n: number) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '');
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const bizNo = (v: string) => (v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : v);

const EVENT_LABEL: Record<string, string> = {
  paid: '결제 완료', preparing: '배송 준비', shipped: '발송', delivered: '배송 완료', confirmed: '구매확정',
  cancelled: '취소 · 환불 완료', return_requested: '반품 요청', return_approved: '반품 승인',
  return_rejected: '반품 거절',
};
const ACTOR_LABEL: Record<string, string> = { buyer: '구매자', brand: '판매자', operator: '픽스폴리오', system: '자동' };
const RETURN_STATUS_LABEL: Record<string, string> = { requested: '판매자 확인 중', approved: '반품 승인 · 회수 예정', rejected: '반품 거절', refunded: '환불 완료' };

type Route = { view: 'orders' } | { view: 'order'; id: string };

function parseRoute(path: string): Route {
  const m = path.match(/^\/my\/orders\/([^/]+)\/?$/);
  if (m) return { view: 'order', id: decodeURIComponent(m[1]) };
  return { view: 'orders' };
}

/** 반품 진행 단계: 반품 신청 → 승인(판매자가 주문 배송지로 회수) → 환불 완료 (또는 거절). */
/** 반품 환불 금액 = 상품 금액(판매가 × 수량). 주문 배송비는 환불되지 않는다. */
const ReturnProgress: React.FC<{ ret: ReturnRequestInfo; totalAmount: number; productAmount: number }> = ({ ret, totalAmount, productAmount }) => {
  const rejected = ret.status === 'rejected';
  const steps = [
    { key: 'requested', label: '반품 신청', at: ret.requestedAt },
    { key: 'approved', label: rejected ? '거절' : '승인', at: ret.decidedAt },
    ...(rejected ? [] : [{ key: 'refunded', label: '환불 완료', at: ret.refundedAt }]),
  ];
  const idx = rejected ? 1 : ret.status === 'refunded' ? 2 : ret.status === 'approved' ? 1 : 0;
  const refund = Number(ret.refundAmount) || 0;
  return (
    <section className={`rounded-2xl border p-4 text-xs space-y-3 ${rejected ? 'border-red-100 bg-red-50/40' : 'border-orange-100 bg-orange-50/50'}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-black text-slate-900">반품 진행</p>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded bg-white ${rejected ? 'text-red-500' : 'text-orange-600'}`}>{RETURN_STATUS_LABEL[ret.status]}</span>
      </div>
      <div className="flex items-center">
        {steps.map((st, i) => (
          <React.Fragment key={st.key}>
            <div className="flex flex-col items-center gap-1 shrink-0 max-w-[30%] text-center">
              <div className={`w-2.5 h-2.5 rounded-full ${i <= idx ? (rejected && i === 1 ? 'bg-red-500' : 'bg-orange-500') : 'bg-slate-200'}`} />
              <span className={`text-[10px] font-bold leading-tight ${i <= idx ? 'text-slate-900' : 'text-slate-300'}`}>{st.label}</span>
              {i <= idx && st.at && <span className="text-[9px] text-slate-400">{date(st.at)}</span>}
            </div>
            {i < steps.length - 1 && <div className={`flex-1 h-0.5 mb-6 ${i < idx ? (rejected ? 'bg-red-300' : 'bg-orange-400') : 'bg-slate-200'}`} />}
          </React.Fragment>
        ))}
      </div>
      <p className="text-slate-600">사유: {ret.reason}{ret.memo ? ` · ${ret.memo}` : ''}</p>
      {ret.photoUrls.length > 0 && (
        <div className="flex gap-1.5">{ret.photoUrls.map(u => <img key={u} src={u} alt="" className="w-12 h-12 rounded-lg object-cover" />)}</div>
      )}
      {ret.status === 'requested' && <p className="text-slate-500">판매자가 요청을 확인하고 있어요. 승인되면 판매자가 주문하신 주소로 상품을 회수해요.</p>}
      {(ret.status === 'requested' || ret.status === 'approved') && (
        <p className="font-bold text-slate-700">상품 금액 {won(productAmount)}이 환불돼요. 배송비는 판매자와 협의해 주세요.</p>
      )}
      {ret.status === 'approved' && (
        <div className="bg-white rounded-xl p-3 space-y-1">
          <p className="font-black text-slate-800">판매자가 주문하신 주소로 회수할 예정이에요</p>
          <p className="text-slate-400 pt-1">
            회수 일정은 판매자가 따로 연락드려요. 회수가 끝나면 환불됩니다.
          </p>
        </div>
      )}
      {ret.status === 'refunded' && (
        <p className="font-bold text-slate-700">
          환불 금액(상품 금액) {won(refund || Math.min(productAmount, totalAmount))}
          {(ret.shippingDeduction || 0) > 0 && <span className="text-slate-500 font-normal"> · 배송비는 판매자와 협의해 주세요</span>}
        </p>
      )}
      {rejected && (
        <div className="text-red-500">
          <p className="font-bold">반품이 거절되었어요. 판매자가 따로 연락드릴 거예요.</p>
          {ret.rejectReason && <p className="mt-0.5">사유: {ret.rejectReason}</p>}
        </div>
      )}
    </section>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-[300] flex items-end md:items-center justify-center">
    <div className="absolute inset-0 bg-black/50" onClick={onClose} />
    <div className="relative bg-white w-full md:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl md:rounded-3xl p-6">
      <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center" aria-label="닫기"><X className="w-4 h-4" /></button>
      <p className="text-base font-black text-slate-900 pr-8">{title}</p>
      <div className="mt-4">{children}</div>
    </div>
  </div>
);

// ─────────────────────────── 주문 목록 ───────────────────────────

const OrderList: React.FC<{ go: (r: Route, path: string) => void }> = ({ go }) => {
  const [orders, setOrders] = useState<BuyerOrderListItem[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    buyerService.orders().then(res => (res.error ? setError(res.error) : setOrders(res.orders || [])));
  }, []);
  if (error) return <p className="text-sm font-bold text-red-500 py-10 text-center">{error}</p>;
  if (!orders) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>;
  if (orders.length === 0) {
    return (
      <div className="py-16 text-center">
        <Package className="w-9 h-9 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-black text-slate-700">아직 주문 내역이 없어요</p>
        <p className="text-xs text-slate-400 mt-1">크리에이터가 추천한 상품을 구매하면 여기에 쌓여요.</p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-slate-100">
      {orders.map(o => (
        <button key={o.id} onClick={() => go({ view: 'order', id: o.id }, `/my/orders/${encodeURIComponent(o.id)}`)} className="w-full text-left py-4 flex gap-3 items-center">
          {o.productImage ? <img src={o.productImage} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-100 shrink-0" /> : <div className="w-16 h-16 rounded-xl bg-slate-100 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-slate-400">{date(o.paidAt || o.createdAt)}</p>
            <p className="text-sm font-black text-slate-900 truncate">{o.productName}</p>
            <p className="text-xs text-slate-500 truncate">{o.optionName ? `${o.optionName} · ` : ''}{o.quantity}개 · {won(o.totalAmount)}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`text-[10px] font-black px-2 py-1 rounded-md ${BUYER_STATUS_STYLE[o.status]}`}>{BUYER_STATUS_LABEL[o.status]}</span>
            <ChevronRight className="w-4 h-4 text-slate-300" />
          </div>
        </button>
      ))}
    </div>
  );
};

// ─────────────────────────── 주문 상세 ───────────────────────────

const STEPS: { key: string; label: string }[] = [
  { key: 'paid', label: '결제 완료' },
  { key: 'preparing', label: '배송 준비' },
  { key: 'shipped', label: '배송 중' },
  { key: 'delivered', label: '배송 완료' },
  { key: 'confirmed', label: '구매확정' },
];

const OrderDetail: React.FC<{ id: string; go: (r: Route, path: string) => void }> = ({ id, go }) => {
  const [data, setData] = useState<{ order: BuyerOrderDetail; events: OrderEvent[]; returnRequest: ReturnRequestInfo | null } | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<null | 'cancel' | 'return'>(null);
  const [reason, setReason] = useState('');
  const [memo, setMemo] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    const res = await buyerService.order(id);
    if (res.error) setError(res.status === 404 ? '주문을 찾을 수 없어요.' : res.error);
    else setData(res);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const open = (m: 'cancel' | 'return') => { setModal(m); setReason(''); setMemo(''); setPhotos([]); setActionError(''); };

  const submit = async () => {
    if (!data) return;
    setBusy(true);
    setActionError('');
    const res = modal === 'cancel'
      ? await buyerService.cancel(id, reason, memo)
      : await buyerService.requestReturn(id, reason, memo, photos);
    setBusy(false);
    if (res.error) { setActionError(res.error); return; }
    setModal(null);
    setToast(modal === 'cancel' ? '주문이 취소되고 전액 환불되었어요.' : '반품을 요청했어요. 판매자가 확인 후 안내해 드려요.');
    load();
  };

  const confirm = async () => {
    if (!window.confirm('구매확정하면 주문취소 · 반품을 요청할 수 없어요. 구매확정할까요?')) return;
    const res = await buyerService.confirm(id);
    if (res.error) window.alert(res.error);
    else load();
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = 5 - photos.length;
    const picked = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, room);
    setUploading(true);
    for (const f of picked) {
      const r = await buyerService.uploadPhoto(f);
      if (r.url) setPhotos(p => [...p, r.url!].slice(0, 5));
      else setActionError(r.error || '사진을 올리지 못했습니다.');
    }
    setUploading(false);
  };

  if (error) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm font-black text-slate-700">{error}</p>
        <button onClick={() => go({ view: 'orders' }, '/my/orders')} className="mt-4 h-10 px-5 rounded-xl bg-slate-900 text-white text-xs font-black">주문 내역으로</button>
      </div>
    );
  }
  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>;

  const { order: o, events, returnRequest: ret } = data;
  const stepIdx = STEPS.findIndex(s => s.key === o.status);

  return (
    <div className="space-y-5 pb-6">
      <button onClick={() => go({ view: 'orders' }, '/my/orders')} className="flex items-center gap-1 text-xs font-bold text-slate-500"><ChevronLeft className="w-4 h-4" /> 주문 내역</button>

      {toast && <p className="text-xs font-bold text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">{toast}</p>}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-slate-400">{dateTime(o.paidAt || o.createdAt)} 주문</p>
          <p className="text-[10px] font-mono text-slate-300 break-all">{o.id}</p>
        </div>
        <span className={`text-[11px] font-black px-2.5 py-1 rounded-md ${BUYER_STATUS_STYLE[o.status]}`}>{BUYER_STATUS_LABEL[o.status]}</span>
      </div>

      {stepIdx >= 0 && (
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div className={`w-2.5 h-2.5 rounded-full ${i <= stepIdx ? 'bg-slate-900' : 'bg-slate-200'}`} />
                <span className={`text-[10px] font-bold ${i <= stepIdx ? 'text-slate-900' : 'text-slate-300'}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mb-4 ${i < stepIdx ? 'bg-slate-900' : 'bg-slate-200'}`} />}
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="flex gap-3 items-center bg-slate-50 rounded-2xl p-3">
        {o.productImage && <img src={o.productImage} alt="" className="w-16 h-16 rounded-xl object-cover" />}
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400">{o.seller.brandName}</p>
          <p className="text-sm font-black truncate">{o.productName}</p>
          <p className="text-xs text-slate-500">{o.optionName ? `${o.optionName} · ` : ''}{o.quantity}개</p>
          <p className="text-[11px] text-blue-600 font-bold mt-0.5">@{o.influencer}님 추천</p>
        </div>
      </div>

      {/* 구매자 신청: 주문취소(발송 전) · 반품 요청(송장 입력 후 ~ 구매확정 전). 구매확정 뒤에는 둘 다 없다. */}
      <div className="space-y-2">
        {o.canCancel && (
          <button onClick={() => open('cancel')} className="w-full h-12 rounded-xl border border-slate-300 text-sm font-black text-slate-700">주문취소</button>
        )}
        {o.canReturn && (
          <>
            <button onClick={() => open('return')} className="w-full h-12 rounded-xl border border-slate-300 text-sm font-black text-slate-700">반품 요청</button>
            {o.status === 'delivered' && o.returnWindowEndsAt && (
              <p className="text-[11px] text-slate-400 text-center">반품은 {date(o.returnWindowEndsAt)}까지 요청할 수 있어요.</p>
            )}
          </>
        )}
        {o.returnExpired && (
          <p className="rounded-xl bg-slate-50 p-4 text-xs font-bold text-slate-600">반품 가능 기간이 지났어요. 아래 문의하기로 판매자에게 문의해 주세요.</p>
        )}
        {o.canConfirm && (
          <button onClick={confirm} className="w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-black">구매확정</button>
        )}
      </div>

      {/* 반품 진행 */}
      {ret && <ReturnProgress ret={ret} totalAmount={o.totalAmount} productAmount={o.productAmount} />}

      {/* 문의하기: 모든 상태에서 보인다. 브랜드 자사몰 · 고객센터로 새 창 연결. */}
      <section className="rounded-2xl border border-slate-100 p-4">
        <p className="text-sm font-black mb-2">문의하기</p>
        <SellerInquiry inquiryUrl={o.seller.inquiryUrl} orderId={o.id} />
      </section>

      <section className="rounded-2xl border border-slate-100 p-4 text-sm space-y-1.5">
        <p className="text-sm font-black mb-1">결제 정보</p>
        <div className="flex justify-between"><span className="text-slate-500">결제 수단</span><span className="font-bold">{o.payMethod}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">상품 금액</span><span className="font-bold">{won(o.productAmount)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">배송비</span><span className="font-bold">{o.shippingFee ? won(o.shippingFee) : '무료'}</span></div>
        <div className="flex justify-between pt-2 border-t border-slate-100"><span className="font-black">결제 금액</span><span className="font-black">{won(o.totalAmount)}</span></div>
        {o.status === 'cancelled' && (
          <div className="flex justify-between text-red-500"><span className="font-bold">환불 금액</span><span className="font-black">{won(o.refundAmount)}{o.refundAmount < o.totalAmount ? ' (상품 금액 · 배송비 제외)' : ''}</span></div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-100 p-4 text-sm space-y-1">
        <p className="text-sm font-black mb-1">배송지</p>
        <p className="font-bold">{o.recipientName} · {o.recipientPhone}</p>
        <p className="text-slate-600">{o.postcode ? `(${o.postcode}) ` : ''}{o.address1} {o.address2}</p>
        {o.deliveryMemo && <p className="text-slate-500 text-xs">메모: {o.deliveryMemo}</p>}
        {o.trackingNumber && (
          <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-600">{o.trackingCompany} <b>{o.trackingNumber}</b></p>
            {o.trackingUrl && <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg bg-slate-900 text-white text-[11px] font-black flex items-center">배송 조회</a>}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-100 p-4 text-xs space-y-1">
        <p className="text-sm font-black mb-1">판매자 정보</p>
        {[
          ['상호', o.seller.businessName], ['사업자등록번호', bizNo(o.seller.businessNumber)], ['대표자', o.seller.ceoName],
          ['사업장 주소', o.seller.address], ['고객센터', o.seller.phone], ['통신판매업 신고번호', o.seller.mailOrderNumber || ''],
          ['추천 크리에이터', `@${o.influencer}`],
        ].map(([k, v]) => <div key={k} className="flex gap-3"><span className="w-28 shrink-0 text-slate-400">{k}</span><span className="text-slate-700 break-all">{v || '-'}</span></div>)}
      </section>

      {events.length > 0 && (
        <section className="rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-black mb-2">진행 내역</p>
          <ol className="space-y-2">
            {events.map((e, i) => (
              <li key={i} className="text-xs flex gap-3">
                <span className="text-slate-400 w-28 shrink-0">{dateTime(e.createdAt)}</span>
                <span className="text-slate-700"><b>{EVENT_LABEL[e.action] || e.action}</b> <span className="text-slate-400">({ACTOR_LABEL[e.actorType] || e.actorType})</span>{e.note && e.action !== 'paid' ? ` · ${e.note}` : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {modal && (
        <Modal
          title={modal === 'cancel' ? '주문취소' : '반품 요청'}
          onClose={() => setModal(null)}
        >
          <p className="text-xs font-bold text-slate-500 mb-2">사유를 골라 주세요</p>
          <div className="grid grid-cols-2 gap-2">
            {(modal === 'cancel' ? CANCEL_REASONS : RETURN_REASONS).map(r => (
              <button key={r} onClick={() => setReason(r)} className={`h-11 rounded-xl border text-xs font-bold ${reason === r ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`}>
                {r}{r === '기타' && modal === 'cancel' ? ' (메모)' : ''}
              </button>
            ))}
          </div>
          <textarea
            value={memo}
            onChange={e => setMemo(e.target.value)}
            maxLength={1000}
            placeholder="메모 (선택)"
            className="mt-3 w-full min-h-[90px] p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-900"
          />
          {modal === 'return' && (
            <>
              <p className="text-xs font-bold text-slate-500 mt-3 mb-2">사진 (선택, 최대 5장)</p>
              <div className="flex gap-2 flex-wrap">
                {photos.map(u => (
                  <div key={u} className="relative">
                    <img src={u} alt="" className="w-16 h-16 rounded-lg object-cover" />
                    <button onClick={() => setPhotos(p => p.filter(x => x !== u))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center" aria-label="사진 삭제"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                {photos.length < 5 && (
                  <label className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 flex items-center justify-center cursor-pointer">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
                    <input type="file" accept="image/*" multiple className="hidden" onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} />
                  </label>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-3">반품 시 상품 금액 {won(o.productAmount)}이 환불돼요. 배송비는 판매자와 협의해 주세요.</p>
            </>
          )}
          {modal === 'cancel' && <p className="text-[11px] text-slate-400 mt-3">확인을 누르면 결제가 즉시 전액 취소됩니다.</p>}
          {actionError && <p className="text-xs font-bold text-red-500 mt-3">{actionError}</p>}
          <button
            onClick={submit}
            disabled={busy || uploading || !reason || (modal === 'cancel' && reason === '기타' && !memo.trim())}
            className="mt-4 w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-black disabled:bg-slate-300 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {modal === 'cancel' ? '주문취소하기' : '반품 요청하기'}
          </button>
        </Modal>
      )}
    </div>
  );
};

// ─────────────────────────── 화면 ───────────────────────────

const BuyerMyPage: React.FC = () => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [returnTo, setReturnTo] = useState('');
  const [unread, setUnread] = useState(0);
  const [notiOpen, setNotiOpen] = useState(false);
  const [notis, setNotis] = useState<{ id: number; title: string; body: string; link: string; read_at: string | null; created_at: string }[]>([]);

  useEffect(() => {
    // ?returnTo= 는 구매 경로 안쪽 주소만 받는다(외부 주소는 버린다). 로그인 버튼의 복귀 주소로 쓰고,
    // 이미 로그인돼 있으면 바로 그리로 보낸다.
    const rawReturn = new URLSearchParams(window.location.search).get('returnTo');
    const target = rawReturn ? safeBuyerReturnTo(rawReturn, '') : '';
    if (target) setReturnTo(target);
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    isSignedIn().then(async ok => {
      setSignedIn(ok);
      if (ok && target && target !== window.location.pathname) {
        window.location.replace(target);
        return;
      }
      if (ok) {
        const me = await buyerService.me(); // 처음이면 여기서 구매자 계정이 만들어진다
        setUnread(me.unreadNotifications || 0);
      }
    });
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (r: Route, path: string) => {
    window.history.pushState(null, '', path);
    setRoute(r);
    window.scrollTo({ top: 0 });
  };

  const openNotis = async () => {
    setNotiOpen(true);
    const res = await buyerService.notifications();
    setNotis(res.notifications || []);
    if (unread) { buyerService.readNotifications(); setUnread(0); }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-[560px] mx-auto px-5">
        <header className="h-14 flex items-center justify-between border-b border-slate-100">
          <a href="/" className="text-sm font-black tracking-tighter">PICKSFOLIO</a>
          <div className="flex items-center gap-1">
            <p className="text-xs font-black text-slate-500 mr-2">마이페이지</p>
            {signedIn && (
              <button onClick={openNotis} className="relative w-9 h-9 rounded-full hover:bg-slate-50 flex items-center justify-center" aria-label="알림">
                <Bell className="w-4 h-4 text-slate-600" />
                {unread > 0 && <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center">{unread}</span>}
              </button>
            )}
          </div>
        </header>

        {signedIn === null ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div>
        ) : !signedIn ? (
          <div className="py-16 text-center">
            <p className="text-lg font-black">로그인하고 주문 내역을 확인하세요</p>
            <p className="text-xs text-slate-500 mt-1.5">픽스폴리오에서 구매한 주문 · 취소 · 반품을 한곳에서 볼 수 있어요.</p>
            <KakaoLoginButton className="mt-6 max-w-xs mx-auto" onClick={() => loginWithKakao(returnTo || window.location.pathname)} />
          </div>
        ) : (
          <>
            {/* "내 문의" 메뉴는 숨겼다(문의는 주문 상세의 문의하기 → 브랜드 자사몰). */}
            <nav className="flex gap-5 border-b border-slate-100 mt-2">
              <button
                onClick={() => go({ view: 'orders' }, '/my/orders')}
                className="py-3 text-sm font-black border-b-2 -mb-px border-slate-900 text-slate-900"
              >
                주문 내역
              </button>
            </nav>
            <main className="pt-4">
              {route.view === 'orders' && <OrderList go={go} />}
              {route.view === 'order' && <OrderDetail key={route.id} id={route.id} go={go} />}
            </main>
          </>
        )}
        <PlatformLegalFooter />
      </div>

      {notiOpen && (
        <Modal title="알림" onClose={() => setNotiOpen(false)}>
          {notis.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">새 알림이 없어요</p> : (
            <div className="divide-y divide-slate-100">
              {notis.map(n => (
                <a key={n.id} href={n.link || '#'} className="block py-3">
                  <p className={`text-sm ${n.read_at ? 'text-slate-600' : 'font-black text-slate-900'}`}>{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>}
                  <p className="text-[10px] text-slate-300 mt-0.5">{dateTime(n.created_at)}</p>
                </a>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};

export default BuyerMyPage;
