import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Loader2, Minus, Plus, User, X } from 'lucide-react';
import { loadPortOne } from '../../utils/externalScripts';
import { openPostcodeSearch } from '../../utils/daumPostcode';
import {
  PORTONE_STORE_ID,
  cardParam,
  channelKeyFor,
  easyPayParam,
  isNiceCardConfigured,
  NICE_NOT_CONFIGURED_MESSAGE,
  portonePayMethod,
  type PortOnePayMethod,
} from '../../utils/portonePayments';
import { buyerHeaders, buyerService, isSignedIn, loginWithKakao } from '../../services/affiliateBuyerService';
import { KakaoLoginButton, PlatformLegalFooter } from './ShopCommon';

/**
 * 인플루언서 전용 상품 링크(/shop/<코드>). 상품은 로그인 없이 보고, 구매 · 문의 · 마이페이지는
 * 카카오 로그인한 구매자 계정으로 한다.
 *
 * 로그인하러 나갔다 돌아와도 보던 상품 · 고른 옵션 · 수량 · 링크 코드가 그대로 남도록
 * 로그인 전에 그 상태를 저장해 두고(RESUME_KEY), 돌아온 뒤 이어서 주문서를 연다.
 * 결제가 서버에서 확인되면 링크 코드의 인플루언서 판매로 잡힌다(api-affiliate-shop).
 */

interface ShopProduct {
  code: string;
  influencer: string;
  brandName: string;
  name: string;
  category: string;
  subcategory: string;
  summary: string;
  description: string;
  imageUrls: string[];
  detailImageUrls?: string[];
  sizeGuide?: string;
  deliveryGuide?: string;
  descriptionImageUrls?: string[];
  sizeGuideImageUrls?: string[];
  deliveryGuideImageUrls?: string[];
  options: { name: string; soldOut: boolean }[];
  retailPrice: number;
  salePrice: number;
  shippingFee: number;
  onSale: boolean;
  maxQuantity: number;
  seller: { businessName: string; businessNumber: string; ceoName: string; phone: string; address: string };
}

interface ShopOrder {
  id: string;
  status: string;
  productName: string;
  optionName: string;
  quantity: number;
  totalAmount: number;
}

type ResumeIntent = { code: string; option: string; quantity: number; next: 'checkout' | 'inquiry'; savedAt: number };
const RESUME_KEY = 'picks_shop_resume';

function saveResume(intent: Omit<ResumeIntent, 'savedAt'>) {
  const v = JSON.stringify({ ...intent, savedAt: Date.now() });
  try { sessionStorage.setItem(RESUME_KEY, v); } catch { /* 저장 불가 */ }
  try { localStorage.setItem(RESUME_KEY, v); } catch { /* 저장 불가 */ }
}
function takeResume(code: string): ResumeIntent | null {
  let raw = '';
  try { raw = sessionStorage.getItem(RESUME_KEY) || localStorage.getItem(RESUME_KEY) || ''; } catch { /* 저장 불가 */ }
  try { sessionStorage.removeItem(RESUME_KEY); localStorage.removeItem(RESUME_KEY); } catch { /* 저장 불가 */ }
  try {
    const v = JSON.parse(raw) as ResumeIntent;
    if (v?.code === code && Date.now() - v.savedAt < 30 * 60_000) return v;
  } catch { /* 없음 */ }
  return null;
}

const won = (n: number) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const phoneFmt = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
};
const bizNo = (v: string) => (v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : v);

async function api<T>(method: 'GET' | 'POST', query: string, body?: unknown, auth = false): Promise<T & { error?: string; status?: number }> {
  try {
    const headers: Record<string, string> = auth ? await buyerHeaders() : body ? { 'Content-Type': 'application/json' } : {};
    const res = await fetch(`/api/affiliate-shop${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ...(json || {}), status: res.status, error: json?.error || '요청을 처리하지 못했습니다.' };
    return json;
  } catch {
    return { error: '네트워크 오류가 발생했습니다.' } as T & { error?: string };
  }
}

const inputCls = 'w-full h-12 px-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900';

/** 상품 설명 · 사이즈 가이드 · 배송 안내를 접었다 펴는 칸. 글 아래에 이미지를 이어 붙인다. 내용이 없는 칸은 숨기고, 첫 칸은 펴 둔다. */
const InfoAccordion: React.FC<{ items: { key: string; title: string; body: string; images?: string[] }[] }> = ({ items }) => {
  const shown = items.filter(i => i.body.trim() || (i.images?.length || 0) > 0);
  const [open, setOpen] = useState<string[]>(() => (shown[0] ? [shown[0].key] : []));
  if (shown.length === 0) return null;
  const toggle = (k: string) => setOpen(o => (o.includes(k) ? o.filter(x => x !== k) : [...o, k]));
  return (
    <section className="px-5 mt-6 border-t border-slate-200">
      {shown.map(i => {
        const isOpen = open.includes(i.key);
        return (
          <div key={i.key} className="border-b border-slate-200">
            <button
              type="button"
              onClick={() => toggle(i.key)}
              aria-expanded={isOpen}
              className="w-full h-12 flex items-center justify-between text-[12px] font-bold tracking-wider text-slate-700"
            >
              {i.title}
              {isOpen ? <Minus className="w-4 h-4 text-slate-500" /> : <Plus className="w-4 h-4 text-slate-500" />}
            </button>
            {isOpen && (
              <div className="pb-5">
                {i.body.trim() && <p className="text-[13px] text-slate-600 whitespace-pre-wrap leading-relaxed break-words">{i.body}</p>}
                {(i.images?.length || 0) > 0 && (
                  <div className={i.body.trim() ? 'mt-4' : ''}>
                    {i.images!.map((u, n) => (
                      <img key={u + n} src={u} alt={`${i.title} ${n + 1}`} className="block w-full h-auto" loading="lazy" />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};

const AffiliateShopPage: React.FC<{ code: string }> = ({ code }) => {
  const [product, setProduct] = useState<ShopProduct | null>(null);
  const [loadError, setLoadError] = useState('');
  const [imageIdx, setImageIdx] = useState(0);
  const [option, setOption] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [checkout, setCheckout] = useState(false);
  const [form, setForm] = useState({
    buyerName: '', buyerPhone: '', buyerEmail: '',
    sameRecipient: true, recipientName: '', recipientPhone: '',
    postcode: '', address1: '', address2: '', deliveryMemo: '',
  });
  const [payMethod, setPayMethod] = useState<PortOnePayMethod>('CARD');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeProvide, setAgreeProvide] = useState(false);
  const [paying, setPaying] = useState(false);
  const [postcodeFailed, setPostcodeFailed] = useState(false);
  const [payError, setPayError] = useState('');
  const [done, setDone] = useState<ShopOrder | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState<null | 'checkout' | 'inquiry' | 'mypage'>(null);
  const [loginNotice, setLoginNotice] = useState('');
  const [sellerOpen, setSellerOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryText, setInquiryText] = useState('');
  const [inquirySending, setInquirySending] = useState(false);
  const [inquiryMsg, setInquiryMsg] = useState('');
  const clicked = useRef(false);

  const set = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  /** 주소 검색으로 우편번호·기본 주소를 채우고, 남은 상세 주소 칸으로 커서를 옮긴다. */
  const searchAddress = async () => {
    const ok = await openPostcodeSearch(({ postcode, address }) => {
      setForm(f => ({ ...f, postcode, address1: address }));
      setPostcodeFailed(false);
      setTimeout(() => document.getElementById('shop-address-detail')?.focus(), 100);
    });
    if (!ok) setPostcodeFailed(true);
  };

  /** 로그인 뒤 저장된 배송지를 주문서에 채운다. */
  const prefill = async () => {
    const me = await buyerService.me();
    if (me.error || !me.saved) return;
    const s = me.saved;
    setForm(f => ({
      ...f,
      buyerName: f.buyerName || s.buyerName,
      buyerPhone: f.buyerPhone || phoneFmt(s.buyerPhone),
      buyerEmail: f.buyerEmail || s.buyerEmail,
      sameRecipient: !s.recipientName || (s.recipientName === s.buyerName && s.recipientPhone === s.buyerPhone),
      recipientName: f.recipientName || s.recipientName,
      recipientPhone: f.recipientPhone || phoneFmt(s.recipientPhone),
      postcode: f.postcode || s.postcode,
      address1: f.address1 || s.address1,
      address2: f.address2 || s.address2,
      deliveryMemo: f.deliveryMemo || s.deliveryMemo,
    }));
  };

  // 로그인 상태 · 로그인 후 복귀 · 결제창 복귀
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    const kakao = params.get('kakao_login');
    window.history.replaceState(null, '', window.location.pathname);

    isSignedIn().then(async ok => {
      setSignedIn(ok);
      if (kakao === 'fail') setLoginNotice('카카오 로그인을 마치지 못했어요. 다시 시도해 주세요.');
      const resume = takeResume(code);
      if (ok && resume) {
        setOption(resume.option);
        setQuantity(Math.max(1, resume.quantity || 1));
        if (resume.next === 'checkout') setCheckout(true);
        if (resume.next === 'inquiry') setInquiryOpen(true);
      }
      if (ok) prefill();
    });

    if (!orderId) return;
    const failCode = params.get('code');
    if (failCode) {
      setPayError(params.get('message') || '결제가 완료되지 않았습니다.');
      setCheckout(true);
      return;
    }
    setFinishing(true);
    api<{ order: ShopOrder }>('POST', '', { action: 'complete', orderId }, true).then(res => {
      setFinishing(false);
      if (res.error || !res.order) { setPayError(res.error || '결제를 확인하지 못했습니다.'); setCheckout(true); }
      else setDone(res.order);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    api<{ product: ShopProduct }>('GET', `?code=${encodeURIComponent(code)}`).then(res => {
      if (res.error || !res.product) { setLoadError(res.error || '상품을 불러오지 못했습니다.'); return; }
      setProduct(res.product);
      document.title = `${res.product.name} | ${res.product.brandName}`;
      if (!clicked.current) {
        clicked.current = true;
        try {
          const key = `picks_shop_click_${code}`;
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            api('POST', '', { action: 'click', code });
          }
        } catch {
          api('POST', '', { action: 'click', code });
        }
      }
    });
  }, [code]);

  const needsOption = (product?.options.length || 0) > 0;
  const total = useMemo(() => (product ? product.salePrice * quantity + product.shippingFee : 0), [product, quantity]);
  const discount = product && product.retailPrice > product.salePrice ? Math.round((1 - product.salePrice / product.retailPrice) * 100) : 0;

  const formValid =
    !!form.buyerName.trim() &&
    form.buyerPhone.replace(/\D/g, '').length >= 9 &&
    (form.sameRecipient || (!!form.recipientName.trim() && form.recipientPhone.replace(/\D/g, '').length >= 9)) &&
    !!form.address1.trim() &&
    agreeTerms && agreeProvide;

  const goLogin = (next: 'checkout' | 'inquiry' | 'mypage') => {
    if (next === 'mypage') {
      loginWithKakao('/my/orders');
      return;
    }
    saveResume({ code, option, quantity, next });
    loginWithKakao(`/shop/${code}`);
  };

  const startCheckout = () => {
    if (!signedIn) { setLoginPrompt('checkout'); return; }
    setCheckout(true);
    setPayError('');
    window.scrollTo({ top: 0 });
  };

  const openMyPage = () => {
    if (!signedIn) { setLoginPrompt('mypage'); return; }
    window.location.href = '/my/orders';
  };

  const sendInquiry = async () => {
    setInquirySending(true);
    const res = await buyerService.inquire({ code, body: inquiryText });
    setInquirySending(false);
    if (res.error) { setInquiryMsg(res.error); return; }
    setInquiryText('');
    setInquiryMsg('문의를 보냈어요. 답변은 마이페이지 "내 문의"에서 확인할 수 있어요.');
  };

  const pay = async () => {
    if (!product || !formValid) return;
    setPayError('');
    if (payMethod === 'CARD' && !isNiceCardConfigured()) { setPayError(NICE_NOT_CONFIGURED_MESSAGE); return; }
    setPaying(true);
    const created = await api<{ orderId: string; orderName: string; totalAmount: number; customer: any }>('POST', '', {
      action: 'create_order',
      code,
      option,
      quantity,
      buyerName: form.buyerName,
      buyerPhone: form.buyerPhone,
      buyerEmail: form.buyerEmail,
      recipientName: form.sameRecipient ? form.buyerName : form.recipientName,
      recipientPhone: form.sameRecipient ? form.buyerPhone : form.recipientPhone,
      postcode: form.postcode,
      address1: form.address1,
      address2: form.address2,
      deliveryMemo: form.deliveryMemo,
      payMethod,
      agreeTerms: true,
      agreeProvide: true,
    }, true);
    if (created.status === 401) {
      setPaying(false);
      setSignedIn(false);
      setLoginPrompt('checkout');
      return;
    }
    if (created.error || !created.orderId) {
      setPaying(false);
      setPayError(created.error || '주문서를 만들지 못했습니다.');
      return;
    }
    try {
      const PortOne = await loadPortOne();
      const response = await PortOne.requestPayment({
        storeId: PORTONE_STORE_ID,
        channelKey: channelKeyFor(payMethod),
        paymentId: created.orderId,
        orderName: created.orderName,
        totalAmount: created.totalAmount,
        currency: 'KRW',
        payMethod: portonePayMethod(payMethod),
        ...easyPayParam(payMethod),
        ...cardParam(payMethod),
        customer: created.customer,
        redirectUrl: `${window.location.origin}/shop/${code}?order=${encodeURIComponent(created.orderId)}`,
      });
      if (response?.code) {
        setPaying(false);
        setPayError(response.message || '결제가 취소되었습니다.');
        return;
      }
      const res = await api<{ order: ShopOrder }>('POST', '', { action: 'complete', orderId: created.orderId }, true);
      setPaying(false);
      if (res.error || !res.order) setPayError(res.error || '결제를 확인하지 못했습니다.');
      else setDone(res.order);
    } catch (e: any) {
      setPaying(false);
      setPayError(e?.message || '결제창을 열지 못했습니다.');
    }
  };

  // ─── 화면 ───

  if (finishing) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-slate-400" />
        <p className="text-sm font-bold text-slate-500">결제를 확인하고 있어요</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#f8f9fb] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-100 p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h1 className="text-xl font-black text-slate-900">주문이 완료되었어요</h1>
          <p className="text-sm text-slate-500 mt-1">판매자가 확인 후 상품을 보내 드립니다.</p>
          <dl className="mt-6 text-left text-sm bg-slate-50 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between gap-3"><dt className="text-slate-400">상품</dt><dd className="font-bold text-slate-800 text-right">{done.productName}{done.optionName ? ` · ${done.optionName}` : ''}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">수량</dt><dd className="font-bold text-slate-800">{done.quantity}개</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">결제 금액</dt><dd className="font-black text-slate-900">{won(done.totalAmount)}</dd></div>
          </dl>
          <a href={`/my/orders/${encodeURIComponent(done.id)}`} className="mt-6 w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-black flex items-center justify-center">주문 내역 보기</a>
          <button onClick={() => { setDone(null); setCheckout(false); }} className="mt-2 w-full h-12 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">상품 페이지로</button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
        <p className="text-lg font-black text-slate-900">상품을 찾을 수 없어요</p>
        <p className="text-sm text-slate-500 mt-1">{loadError}</p>
        <a href="/my/orders" className="mt-6 h-11 px-5 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 flex items-center">마이페이지</a>
      </div>
    );
  }

  if (!product) {
    return <div className="min-h-screen bg-white flex items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-slate-300" /></div>;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-[560px] mx-auto pb-44">
        <header className="h-14 px-5 flex items-center justify-between border-b border-slate-100 sticky top-0 bg-white/95 backdrop-blur z-10">
          <p className="text-sm font-black truncate">{product.brandName}</p>
          <p className="text-[10px] font-black tracking-widest text-slate-400">PICKSFOLIO</p>
        </header>
        {loginNotice && <p className="px-5 py-2 text-xs font-bold text-red-500 bg-red-50">{loginNotice}</p>}

        {!checkout ? (
          <>
            <div className="relative aspect-square bg-slate-100">
              {product.imageUrls[imageIdx] && <img src={product.imageUrls[imageIdx]} alt="" className="w-full h-full object-cover" />}
              {product.imageUrls.length > 1 && (
                <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5">
                  {product.imageUrls.map((_, i) => (
                    <button key={i} onClick={() => setImageIdx(i)} className={`w-2 h-2 rounded-full ${i === imageIdx ? 'bg-white' : 'bg-white/50'}`} aria-label={`이미지 ${i + 1}`} />
                  ))}
                </div>
              )}
            </div>
            {product.imageUrls.length > 1 && (
              <div className="flex gap-2 px-5 pt-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {product.imageUrls.map((u, i) => (
                  <button key={i} onClick={() => setImageIdx(i)} className={`w-14 h-14 rounded-lg overflow-hidden shrink-0 border-2 ${i === imageIdx ? 'border-slate-900' : 'border-transparent'}`}>
                    <img src={u} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <section className="px-5 pt-5">
              <p className="text-xs font-bold text-slate-400">{product.brandName}</p>
              <h1 className="text-xl font-black mt-0.5 leading-snug">{product.name}</h1>
              {product.summary && <p className="text-sm text-slate-500 mt-1">{product.summary}</p>}
              <div className="mt-3">
                {discount > 0 && <p className="text-sm text-slate-400 line-through">{won(product.retailPrice)}</p>}
                <p className="text-2xl font-black">
                  {discount > 0 && <span className="text-red-500 mr-2">{discount}%</span>}
                  {won(product.salePrice)}
                </p>
              </div>
              <p className="text-xs text-slate-500 mt-2">배송비 {product.shippingFee ? won(product.shippingFee) : '무료'}</p>
            </section>

            <InfoAccordion
              items={[
                { key: 'description', title: 'DESCRIPTION', body: product.description, images: product.descriptionImageUrls },
                { key: 'size', title: 'SIZE GUIDE', body: product.sizeGuide || '', images: product.sizeGuideImageUrls },
                { key: 'delivery', title: 'DELIVERY GUIDE', body: product.deliveryGuide || '', images: product.deliveryGuideImageUrls },
              ]}
            />

            {(product.detailImageUrls?.length || 0) > 0 && (
              <section className="mt-8 pt-6 border-t border-slate-100">
                {product.detailImageUrls!.map((u, i) => (
                  <img key={u + i} src={u} alt={`${product.name} 상세 ${i + 1}`} className="block w-full h-auto" loading="lazy" />
                ))}
              </section>
            )}

            {/* 교환·반품 안내 */}
            <section className="px-5 mt-8 pt-6 border-t border-slate-100">
              <h2 className="text-sm font-black mb-2">교환·반품 안내</h2>
              <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4 leading-relaxed">
                <li>배송 완료 후 7일 이내에 마이페이지에서 교환·반품을 요청할 수 있어요.</li>
                <li>단순 변심에 의한 반품은 반품 배송비를 구매자가 부담합니다.</li>
                <li>상품 불량 · 오배송은 판매자가 반품 배송비를 부담합니다.</li>
                <li>송장 입력 전에는 마이페이지에서 바로 주문을 취소할 수 있어요.</li>
              </ul>
            </section>

            {/* 판매자 정보 */}
            <section className="px-5 mt-6 pt-5 border-t border-slate-100">
              <button onClick={() => setSellerOpen(o => !o)} className="w-full flex items-center justify-between text-sm font-black">
                판매자 정보 보기 <ChevronDown className={`w-4 h-4 transition-transform ${sellerOpen ? 'rotate-180' : ''}`} />
              </button>
              {sellerOpen && (
                <dl className="mt-3 text-xs space-y-1.5 bg-slate-50 rounded-xl p-4">
                  {[
                    ['상호', product.seller.businessName],
                    ['사업자등록번호', bizNo(product.seller.businessNumber)],
                    ['대표자', product.seller.ceoName],
                    ['연락처', product.seller.phone],
                    ['주소', product.seller.address],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-3"><dt className="w-24 shrink-0 text-slate-400">{k}</dt><dd className="text-slate-700">{v || '-'}</dd></div>
                  ))}
                </dl>
              )}
            </section>

            <div className="px-5 mt-6">
              <p className="text-[11px] text-slate-400">상품 구매 시 크리에이터는 일정액의 수수료를 받을 수 있습니다.</p>
            </div>
            <PlatformLegalFooter />
          </>
        ) : (
          <section className="px-5 pt-6 space-y-7">
            <button onClick={() => setCheckout(false)} className="text-xs font-bold text-slate-500">← 상품으로 돌아가기</button>
            <div className="flex gap-3 items-center bg-slate-50 rounded-2xl p-3">
              {product.imageUrls[0] && <img src={product.imageUrls[0]} alt="" className="w-16 h-16 rounded-xl object-cover" />}
              <div className="min-w-0">
                <p className="text-sm font-black truncate">{product.name}</p>
                <p className="text-xs text-slate-500">{option ? `${option} · ` : ''}{quantity}개 · {won(product.salePrice * quantity)}</p>
              </div>
            </div>

            <div className="space-y-2.5">
              <h2 className="text-sm font-black">주문자 정보</h2>
              <input className={inputCls} placeholder="이름" value={form.buyerName} onChange={e => set('buyerName', e.target.value)} maxLength={50} />
              <input className={inputCls} placeholder="휴대폰 번호" inputMode="tel" value={form.buyerPhone} onChange={e => set('buyerPhone', phoneFmt(e.target.value))} />
              <input className={inputCls} placeholder="이메일 (선택)" inputMode="email" value={form.buyerEmail} onChange={e => set('buyerEmail', e.target.value.trim())} maxLength={200} />
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black">배송지</h2>
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                  <input type="checkbox" className="accent-slate-900" checked={form.sameRecipient} onChange={e => set('sameRecipient', e.target.checked)} />
                  주문자와 같아요
                </label>
              </div>
              {!form.sameRecipient && (
                <>
                  <input className={inputCls} placeholder="받는 분 이름" value={form.recipientName} onChange={e => set('recipientName', e.target.value)} maxLength={50} />
                  <input className={inputCls} placeholder="받는 분 휴대폰 번호" inputMode="tel" value={form.recipientPhone} onChange={e => set('recipientPhone', phoneFmt(e.target.value))} />
                </>
              )}
              <div className="flex gap-2">
                <input
                  className={`${inputCls} ${postcodeFailed ? '' : 'cursor-pointer bg-slate-50'}`}
                  placeholder="우편번호"
                  inputMode="numeric"
                  value={form.postcode}
                  readOnly={!postcodeFailed}
                  onClick={postcodeFailed ? undefined : searchAddress}
                  onChange={postcodeFailed ? e => set('postcode', e.target.value.replace(/\D/g, '').slice(0, 5)) : undefined}
                />
                <button type="button" onClick={searchAddress} className="shrink-0 h-12 px-4 rounded-xl bg-slate-900 text-white text-sm font-black">
                  주소 검색
                </button>
              </div>
              <input
                className={`${inputCls} ${postcodeFailed ? '' : 'cursor-pointer bg-slate-50'}`}
                placeholder={postcodeFailed ? '주소' : '주소 검색을 눌러 주소를 선택해 주세요'}
                value={form.address1}
                readOnly={!postcodeFailed}
                onClick={postcodeFailed ? undefined : searchAddress}
                onChange={postcodeFailed ? e => set('address1', e.target.value) : undefined}
                maxLength={300}
              />
              <input id="shop-address-detail" className={inputCls} placeholder="상세 주소 (동·호수)" value={form.address2} onChange={e => set('address2', e.target.value)} maxLength={200} />
              {postcodeFailed && (
                <p className="text-[11px] font-bold text-amber-600">주소 검색을 열지 못했어요. 우편번호와 주소를 직접 입력해 주세요.</p>
              )}
              <input className={inputCls} placeholder="배송 메모 (선택)" value={form.deliveryMemo} onChange={e => set('deliveryMemo', e.target.value)} maxLength={200} />
              <p className="text-[11px] text-slate-400">입력한 배송지는 계정에 저장되어 다음 구매 때 불러와요.</p>
            </div>

            <div className="space-y-2.5">
              <h2 className="text-sm font-black">결제 수단</h2>
              <div className="grid grid-cols-2 gap-2">
                {([['CARD', '신용·체크카드'], ['KAKAOPAY', '카카오페이']] as [PortOnePayMethod, string][]).map(([m, label]) => (
                  <button key={m} onClick={() => setPayMethod(m)} className={`h-12 rounded-xl border text-sm font-bold ${payMethod === m ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`}>{label}</button>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-slate-500">상품 금액</span><span className="font-bold">{won(product.salePrice * quantity)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">배송비</span><span className="font-bold">{product.shippingFee ? won(product.shippingFee) : '무료'}</span></div>
              <div className="flex justify-between pt-2 border-t border-slate-200"><span className="font-black">총 결제 금액</span><span className="font-black text-lg">{won(total)}</span></div>
            </div>

            {/* 결제 전 필수 동의 */}
            <div className="space-y-2.5 rounded-2xl border border-slate-200 p-4">
              <label className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-slate-900" checked={agreeTerms && agreeProvide} onChange={e => { setAgreeTerms(e.target.checked); setAgreeProvide(e.target.checked); }} />
                <b className="text-slate-900">전체 동의</b>
              </label>
              <div className="border-t border-slate-100" />
              <label className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-slate-900" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} />
                <span>[필수] 주문 상품 · 금액 · 배송 및 교환·반품 조건을 확인했으며 구매에 동의합니다.</span>
              </label>
              <label className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
                <input type="checkbox" className="mt-0.5 w-4 h-4 accent-slate-900" checked={agreeProvide} onChange={e => setAgreeProvide(e.target.checked)} />
                <span>[필수] 배송을 위해 주문자 · 받는 분 이름, 연락처, 주소, 배송 메모를 판매자({product.seller.businessName || product.brandName})에게 제공하는 것에 동의합니다. 제공 정보는 배송 · 교환·반품 처리 후 관계 법령에 따라 보관 후 파기됩니다.</span>
              </label>
            </div>
            {payError && <p className="text-xs font-bold text-red-500">{payError}</p>}
            <PlatformLegalFooter />
          </section>
        )}
      </div>

      {/* 하단 고정: 마이페이지 + 구매 */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-100 z-20">
        <div className="max-w-[560px] mx-auto p-4 space-y-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}>
          {!checkout && product.onSale && (
            <div className="flex gap-2">
              {needsOption && (
                <select className={`${inputCls} flex-1`} value={option} onChange={e => setOption(e.target.value)}>
                  <option value="">옵션 선택</option>
                  {product.options.map(o => <option key={o.name} value={o.name} disabled={o.soldOut}>{o.name}{o.soldOut ? ' (품절)' : ''}</option>)}
                </select>
              )}
              <div className={`flex items-center border border-slate-200 rounded-xl h-12 ${needsOption ? '' : 'flex-1 justify-between'}`}>
                <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-11 h-full flex items-center justify-center text-slate-500" aria-label="수량 줄이기"><Minus className="w-4 h-4" /></button>
                <span className="w-8 text-center text-sm font-black">{quantity}</span>
                <button onClick={() => setQuantity(q => Math.min(product.maxQuantity || 1, q + 1))} className="w-11 h-full flex items-center justify-center text-slate-500" aria-label="수량 늘리기"><Plus className="w-4 h-4" /></button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={openMyPage} className="h-14 w-16 shrink-0 rounded-2xl border border-slate-200 text-slate-700 flex flex-col items-center justify-center gap-0.5" aria-label="마이페이지">
              <User className="w-5 h-5" />
              <span className="text-[9px] font-black">마이페이지</span>
            </button>
            {!product.onSale ? (
              <button disabled className="flex-1 h-14 rounded-2xl bg-slate-200 text-slate-500 text-base font-black">품절 · 판매 중지</button>
            ) : !checkout ? (
              <button
                disabled={needsOption && !option}
                onClick={startCheckout}
                className="flex-1 h-14 rounded-2xl bg-slate-900 text-white text-base font-black disabled:bg-slate-300"
              >
                {needsOption && !option ? '옵션을 선택해 주세요' : `${won(total)} 구매하기`}
              </button>
            ) : (
              <button onClick={pay} disabled={!formValid || paying} className="flex-1 h-14 rounded-2xl bg-slate-900 text-white text-base font-black disabled:bg-slate-300 flex items-center justify-center gap-2">
                {paying && <Loader2 className="w-5 h-5 animate-spin" />}
                {won(total)} 결제하기
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 로그인 안내 */}
      {loginPrompt && (
        <div className="fixed inset-0 z-[300] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setLoginPrompt(null)} />
          <div className="relative bg-white w-full md:max-w-sm rounded-t-3xl md:rounded-3xl p-6 text-center">
            <button onClick={() => setLoginPrompt(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center" aria-label="닫기"><X className="w-4 h-4" /></button>
            <p className="text-lg font-black text-slate-900 mt-2">
              {loginPrompt === 'checkout' ? '간편한 구매를 위해 로그인해 주세요' : loginPrompt === 'inquiry' ? '문의하려면 로그인해 주세요' : '마이페이지는 로그인 후 볼 수 있어요'}
            </p>
            <p className="text-xs text-slate-500 mt-1.5">
              {loginPrompt === 'checkout' ? '로그인 후 고른 옵션과 수량 그대로 주문을 이어갈 수 있어요.' : '카카오로 3초 만에 로그인할 수 있어요.'}
            </p>
            <KakaoLoginButton className="mt-5" onClick={() => goLogin(loginPrompt)} />
          </div>
        </div>
      )}

      {/* 문의하기 */}
      {inquiryOpen && (
        <div className="fixed inset-0 z-[300] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setInquiryOpen(false)} />
          <div className="relative bg-white w-full md:max-w-md rounded-t-3xl md:rounded-3xl p-6">
            <p className="text-base font-black text-slate-900">판매자에게 문의하기</p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{product.brandName} · {product.name}</p>
            <textarea
              value={inquiryText}
              onChange={e => setInquiryText(e.target.value)}
              maxLength={2000}
              placeholder="사이즈, 배송, 재입고 등 궁금한 점을 적어 주세요."
              className="mt-4 w-full min-h-[120px] p-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-900"
            />
            {inquiryMsg && <p className="text-xs font-bold text-blue-600 mt-2">{inquiryMsg}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setInquiryOpen(false)} className="flex-1 h-12 rounded-xl bg-slate-100 text-sm font-bold text-slate-600">닫기</button>
              <button onClick={sendInquiry} disabled={inquirySending || inquiryText.trim().length < 2} className="flex-1 h-12 rounded-xl bg-slate-900 text-white text-sm font-black disabled:bg-slate-300">
                {inquirySending ? '보내는 중' : '문의 보내기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AffiliateShopPage;
