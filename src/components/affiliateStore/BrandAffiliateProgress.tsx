import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, Loader2, Truck, Upload, Users } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  SHIPPING_COURIERS,
  type ProductSalesRow,
  type ProductSalesTotals,
  type StoreRequest,
} from '../../services/affiliateStoreService';
import { formatPhone } from '../../utils/formatters';
import { csvCell } from '../../utils/csv';
import AffiliateStepBoard, { type AffiliateStepKey } from './AffiliateStepBoard';

/**
 * 브랜드 어필리에이트 › 진행관리 › 상품 › 진행 단계 · 판매 현황.
 *
 * 진행 단계는 캠페인 진행사항 보드와 같은 모양이다 — 단계를 가로로 늘어놓은 칸에 인플루언서 카드가 들어가고,
 * 카드를 누르면 그 사람의 진행 단계(AffiliateStepBoard)가 그 단계가 펼쳐진 채로 열린다.
 * 어필리에이트라 단계는 둘이다(+ 진행 완료 칸). 업로드 일정은 운영 담당자가 양쪽 사이에서 조율한다.
 *   배송 현황      인플루언서가 입력한 배송지 → 브랜드가 협찬 상품을 보내고 송장번호 입력
 *   업로드 링크    인플루언서가 MY 어필리에이트에 올린 콘텐츠 링크 · 파트너십 코드(캠페인 이력에서 2차 광고로 돌린다)
 *
 * 판매 현황은 이 상품이 픽스폴리오(인플루언서 전용 링크)를 통해 얼마나 팔렸는지와 인플루언서별 판매.
 */

type ColumnKey = 'shipping' | 'content' | 'done';

type Column = {
  key: ColumnKey;
  title: string;
  focus: AffiliateStepKey;
  reviewLabel?: string;
  emptyLabel: string;
  icon: React.ReactNode;
};

/** 보드의 칸 — 캠페인 진행사항 보드와 같은 모양. 마지막 칸은 세 단계를 다 지난 사람이 서는 자리다. */
const COLUMNS: Column[] = [
  { key: 'shipping', title: '제품 배송', focus: 'shipping', reviewLabel: '발송 처리', emptyLabel: '배송을 기다리는 인플루언서가 없습니다.', icon: <Truck className="w-4 h-4" /> },
  { key: 'content', title: '업로드 링크 · 코드', focus: 'content', emptyLabel: '업로드 · 파트너십 코드를 기다리는 인플루언서가 없습니다.', icon: <Upload className="w-4 h-4" /> },
  { key: 'done', title: '진행 완료', focus: 'content', emptyLabel: '링크와 파트너십 코드가 모두 올라오면 이 칸으로 넘어옵니다.', icon: <CheckCircle2 className="w-4 h-4" /> },
];
const ORDER: ColumnKey[] = ['shipping', 'content', 'done'];

/** 이 협업이 지금 서 있는 칸. */
const columnOf = (r: StoreRequest): ColumnKey => {
  const st = r.shippingStatus || '';
  if (st === 'awaiting_info' || st === 'info_submitted') return 'shipping';
  if (!r.contentUrl || !r.partnershipCode) return 'content';
  return 'done';
};

const korDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

const InstagramMark: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const identityOf = (r: StoreRequest) => {
  const ins = (r.insights || {}) as { profileImage?: string; instagramHandle?: string; instagramUrl?: string; followers?: number };
  const handle = String(ins.instagramHandle || '').replace(/^@/, '');
  return {
    image: ins.profileImage || '',
    title: `@${handle || r.influencerUsername}`,
    sub: Number(ins.followers) > 0 ? `팔로워 ${Number(ins.followers).toLocaleString('ko-KR')}` : '',
    instagramUrl: ins.instagramUrl || r.channelUrl || '',
  };
};

const Avatar: React.FC<{ src: string; label: string; size: string }> = ({ src, label, size }) => (
  src
    ? <img src={src} alt="" className={`${size} rounded-full object-cover bg-slate-100 flex-shrink-0`} />
    : <span className={`${size} rounded-full bg-slate-100 text-slate-400 text-[11px] font-black flex items-center justify-center flex-shrink-0`}>{label.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
);

export const AffiliateProgressBoard: React.FC<{ businessUsername: string; productId: string; onShipped?: () => void }> = ({
  businessUsername, productId, onShipped,
}) => {
  const [rows, setRows] = useState<StoreRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<{ id: string; focus: AffiliateStepKey } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await affiliateStoreService.getBrandProgress(businessUsername, productId);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setRows(res.requests || []);
  }, [businessUsername, productId]);
  useEffect(() => { void load(); }, [load]);

  const ship = async (r: StoreRequest, company: string, number: string): Promise<string | void> => {
    const res = await affiliateStoreService.shipSelection(businessUsername, r.id, company || SHIPPING_COURIERS[0], number);
    if (res.error) return res.error;
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, ...res.request, productName: x.productName, productImage: x.productImage, brandName: x.brandName, insights: x.insights } : x)));
    onShipped?.();
  };

  const active = useMemo(() => rows.filter(r => r.shippingStatus !== 'declined'), [rows]);
  const declined = useMemo(() => rows.filter(r => r.shippingStatus === 'declined'), [rows]);
  const board = useMemo(() => COLUMNS.map(column => {
    const idx = ORDER.indexOf(column.key);
    const cards = active.filter(r => columnOf(r) === column.key);
    // 이 칸을 이미 지나간 사람은 아래쪽 '완료' 줄에 이름만 남긴다(마지막 칸 제외).
    const doneCards = column.key === 'done' ? [] : active.filter(r => ORDER.indexOf(columnOf(r)) > idx);
    const reviewCount = column.key === 'shipping' ? cards.filter(r => r.shippingStatus === 'info_submitted').length : 0;
    return { column, cards, doneCards, reviewCount };
  }), [active]);

  if (loading && rows.length === 0) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (error) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-bold text-red-500 mb-3">{error}</p>
        <button onClick={() => { void load(); }} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
        <Users className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-black text-slate-700">아직 선정된 인플루언서가 없어요</p>
        <p className="text-xs text-slate-400 mt-1">지원 · 선정 인플루언서에서 인플루언서를 선정하면 여기서 제품 배송 · 업로드 링크를 관리해요.</p>
      </div>
    );
  }

  // ── 한 사람의 진행 단계(캠페인 진행사항 상세와 같은 화면) ──
  const opened = detail ? rows.find(r => r.id === detail.id) : null;
  if (detail && opened) {
    const who = identityOf(opened);
    const col = opened.shippingStatus === 'declined' ? null : COLUMNS.find(c => c.key === columnOf(opened));
    return (
      <div className="space-y-3">
        <button
          onClick={() => setDetail(null)}
          className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> 진행 보드로
        </button>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:p-5">
          <div className="flex items-center gap-3 mb-4">
            <Avatar src={who.image} label={who.title} size="w-10 h-10" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-900 truncate flex items-center gap-1.5">
                {who.title}
                {who.instagramUrl && (
                  <a href={who.instagramUrl} target="_blank" rel="noreferrer" className="text-pink-500 hover:text-pink-600 flex-shrink-0" aria-label="인스타그램 열기">
                    <InstagramMark />
                  </a>
                )}
              </p>
              <p className="text-xs text-slate-400 font-bold truncate">{opened.productName}{who.sub ? ` · ${who.sub}` : ''}</p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-black flex-shrink-0">
              {col ? col.title : '반려'}
            </span>
          </div>
          <AffiliateStepBoard
            key={opened.id}
            role="brand"
            request={opened}
            focusStep={detail.focus}
            onShip={(company, number) => ship(opened, company, number)}
          />
        </div>
      </div>
    );
  }

  const shipWaiting = active.filter(r => r.shippingStatus === 'info_submitted');
  const uploadedCount = active.filter(r => r.contentUrl).length;
  const downloadAddresses = () => {
    if (shipWaiting.length === 0) return;
    const lines = [
      ['인스타 계정', '받는 분', '연락처', '우편번호', '주소', '상세주소', '요청사항'].map(csvCell).join(','),
      ...shipWaiting.map(r => [
        identityOf(r).title.replace(/^@/, ''),
        r.shipping?.recipientName || '',
        formatPhone(r.shipping?.recipientPhone),
        r.shipping?.postcode || '',
        r.shipping?.address1 || '',
        r.shipping?.address2 || '',
        r.shipping?.memo || '',
      ].map(csvCell).join(',')),
    ];
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `배송지_${shipWaiting.length}건.csv`;
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <p className="text-base md:text-lg font-black text-slate-900">진행 중 인플루언서 {active.length}명</p>
        <span className="text-slate-300 font-black">·</span>
        <p className="text-base md:text-lg font-black text-slate-900">업로드 완료 {uploadedCount}명</p>
        {shipWaiting.length > 0 && (
          <span className="px-2.5 py-1 rounded-md bg-slate-900 text-white text-[11px] font-black">확인 필요 {shipWaiting.length}건</span>
        )}
        {shipWaiting.length > 0 && (
          <button onClick={downloadAddresses} className="ml-auto px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-black text-slate-700 transition-colors flex-shrink-0">
            주소지 일괄 다운로드 {shipWaiting.length}건
          </button>
        )}
      </div>
      <p className="px-1 text-xs text-slate-400 font-medium">
        업로드 일정은 픽스폴리오 담당자가 브랜드 · 인플루언서와 조율해요. 카드를 누르면 그 인플루언서의 진행 단계가 열려요.
      </p>

      <div className="-mx-1 overflow-x-auto pb-2">
        <div className="flex gap-3 items-start px-1 min-w-max">
          {board.map(({ column, cards, doneCards, reviewCount }) => (
            <section key={column.key} className="w-[268px] flex-shrink-0 rounded-2xl border border-slate-100 bg-slate-50/80">
              <div className="px-3 py-2.5 flex items-center gap-2 border-b border-slate-100">
                <span className="text-slate-400 flex-shrink-0">{column.icon}</span>
                <p className="text-sm font-black text-slate-900 flex-shrink-0">{column.title}</p>
                <span className="px-1.5 py-0.5 rounded-md bg-white text-[11px] font-black text-slate-500 flex-shrink-0">{cards.length}</span>
                {doneCards.length > 0 && <span className="text-[11px] font-black text-emerald-600 flex-shrink-0">완료 {doneCards.length}</span>}
                {reviewCount > 0 && (
                  <span className="ml-auto px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-black flex-shrink-0">확인 {reviewCount}</span>
                )}
              </div>
              <div className="p-2 space-y-2 max-h-[520px] overflow-y-auto overscroll-contain">
                {cards.length === 0 && doneCards.length === 0 ? (
                  <p className="px-1.5 py-4 text-[11px] text-slate-400 font-bold leading-relaxed">{column.emptyLabel}</p>
                ) : cards.map(r => {
                  const who = identityOf(r);
                  const review = column.key === 'shipping' && r.shippingStatus === 'info_submitted';
                  const frame = 'border-slate-200/70';
                  const working = column.key === 'shipping'
                    ? (r.shippingStatus === 'awaiting_info' ? '배송정보 입력 대기' : '발송 대기')
                    : column.key === 'content'
                      ? (r.contentUrl ? '파트너십 코드 대기' : r.deliveredAt ? '콘텐츠 제작 중' : r.shippingStatus ? '상품 수령 대기' : '업로드 대기')
                      : '진행 완료';
                  return (
                    <div key={r.id} className={`rounded-xl border bg-white ${frame}`}>
                      <button type="button" onClick={() => setDetail({ id: r.id, focus: column.focus })} className="w-full text-left px-2.5 pt-2.5 pb-2">
                        <div className="flex items-center gap-2.5">
                          <Avatar src={who.image} label={who.title} size="w-9 h-9" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 min-w-0">
                              <p className="text-sm font-black text-slate-900 truncate">{who.title}</p>
                              {who.instagramUrl && <span className="text-pink-500 flex-shrink-0"><InstagramMark className="w-3 h-3" /></span>}
                            </div>
                            {who.sub && <p className="text-[11px] text-slate-400 font-bold truncate">{who.sub}</p>}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5">
                          {column.key === 'done' || column.key === 'content' ? (
                            <p className="text-[11px] font-bold text-slate-500 truncate">
                              {r.contentUrl
                                ? (r.contentSubmittedAt ? `업로드 ${korDate(r.contentSubmittedAt)}` : '업로드 완료')
                                : r.shippedAt ? `발송 ${korDate(r.shippedAt)} · 업로드 전` : '업로드 전'}
                            </p>
                          ) : (
                            <p className="text-[11px] font-bold text-slate-400 truncate">
                              {r.shippingStatus === 'info_submitted' && r.shipping?.submittedAt ? `배송정보 ${korDate(r.shipping.submittedAt)}` : `선정 ${korDate(r.updatedAt)}`}
                            </p>
                          )}
                        </div>
                        {(column.key === 'content' || column.key === 'done') && r.contentUrl && (
                          <p className={`mt-1.5 text-[11px] font-black truncate ${r.partnershipCode ? 'text-slate-600' : 'text-amber-600'}`}>
                            {r.partnershipCode ? `파트너십 코드 ${r.partnershipCode}` : '파트너십 코드 대기'}
                          </p>
                        )}
                      </button>
                      {review ? (
                        <div className="px-2.5 pb-2.5">
                          <button onClick={() => setDetail({ id: r.id, focus: column.focus })} className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black hover:bg-slate-700 transition-colors">
                            {column.reviewLabel}
                          </button>
                        </div>
                      ) : (
                        <p className="px-2.5 pb-2.5 text-[11px] font-bold text-slate-400 truncate">{working}</p>
                      )}
                      {review && r.shipping && (
                        <div className="mx-2 mb-2 rounded-lg bg-emerald-50/70 border border-emerald-100 px-2.5 py-2">
                          <p className="text-[11px] font-black text-emerald-700 break-words">{r.shipping.recipientName} · {formatPhone(r.shipping.recipientPhone)}</p>
                          <p className="text-[11px] font-bold text-slate-600 break-words mt-0.5">{r.shipping.postcode ? `(${r.shipping.postcode}) ` : ''}{r.shipping.address1} {r.shipping.address2}</p>
                          {r.shipping.memo && <p className="text-[10px] font-bold text-slate-400 break-words mt-0.5">요청사항: {r.shipping.memo}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {doneCards.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <div className="flex items-center gap-1.5 px-0.5 pb-0.5">
                      <span className="h-px flex-1 bg-slate-200" />
                      <span className="text-[10px] font-black text-slate-400 flex-shrink-0">완료 {doneCards.length}명</span>
                      <span className="h-px flex-1 bg-slate-200" />
                    </div>
                    {doneCards.map(r => {
                      const who = identityOf(r);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setDetail({ id: r.id, focus: column.focus })}
                          className="w-full flex items-center gap-2 rounded-lg border border-slate-100 bg-white/70 px-2 py-1.5 text-left hover:bg-white transition-colors"
                        >
                          <Avatar src={who.image} label={who.title} size="w-6 h-6" />
                          <p className="min-w-0 flex-1 text-[11px] font-black text-slate-500 truncate">{who.title}</p>
                          <span className="flex items-center gap-0.5 text-[10px] font-black text-emerald-600 flex-shrink-0">
                            <Check className="w-3 h-3" strokeWidth={3} /> 완료
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      {declined.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm p-4 md:p-5">
          <p className="text-sm font-black text-slate-900 mb-2.5">반려된 협업</p>
          <div className="space-y-1.5">
            {declined.map(r => {
              const who = identityOf(r);
              return (
                <button key={r.id} type="button" onClick={() => setDetail({ id: r.id, focus: 'shipping' })} className="w-full flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100 transition-colors">
                  <Avatar src={who.image} label={who.title} size="w-8 h-8" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-900 truncate">{who.title}</p>
                    {r.declinedReason && <p className="text-xs text-slate-400 font-bold truncate">사유: {r.declinedReason}</p>}
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-black flex-shrink-0 bg-red-50 text-red-500">인플루언서 반려</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const AffiliateSalesBoard: React.FC<{ businessUsername: string; productId: string }> = ({ businessUsername, productId }) => {
  const [rows, setRows] = useState<ProductSalesRow[]>([]);
  const [totals, setTotals] = useState<ProductSalesTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await affiliateStoreService.getBrandSales(businessUsername, productId);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setRows(res.influencers || []);
    setTotals(res.totals || null);
  }, [businessUsername, productId]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !totals) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (error) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm font-bold text-red-500 mb-3">{error}</p>
        <button onClick={() => { void load(); }} className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black">다시 시도</button>
      </div>
    );
  }
  const t = totals || { clicks: 0, orders: 0, units: 0, sales: 0, commission: 0, sellers: 0 };
  const maxSales = Math.max(1, ...rows.map(r => r.sales));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {[
          { label: '픽스폴리오 판매액', value: won(t.sales), accent: true },
          { label: '주문 · 판매 수량', value: `${t.orders.toLocaleString('ko-KR')}건 · ${t.units.toLocaleString('ko-KR')}개` },
          { label: '판매한 인플루언서', value: `${t.sellers.toLocaleString('ko-KR')}명 / ${rows.length.toLocaleString('ko-KR')}명` },
          { label: '링크 방문', value: `${t.clicks.toLocaleString('ko-KR')}회` },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border p-4 ${s.accent ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-100 shadow-sm'}`}>
            <p className={`text-[10px] font-black ${s.accent ? 'text-blue-100' : 'text-slate-400'}`}>{s.label}</p>
            <p className="text-base md:text-xl font-black mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">인플루언서 전용 링크로 결제된 주문 기준이에요(배송비 제외 · 취소 · 환불 제외). 인플루언서 수수료 합계 {won(t.commission)}.</p>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
          <p className="text-sm font-black text-slate-700">아직 판매 내역이 없어요</p>
          <p className="text-xs text-slate-400 mt-1">선정된 인플루언서의 전용 링크로 결제된 주문이 여기에 쌓입니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="hidden md:grid grid-cols-[40px_1fr_90px_90px_130px_110px] gap-3 px-5 py-3 text-[10px] font-black text-slate-400 border-b border-slate-100">
            <span>순위</span><span>인플루언서</span><span className="text-right">방문</span><span className="text-right">주문</span><span className="text-right">판매액</span><span className="text-right">수수료</span>
          </div>
          {rows.map((r, idx) => (
            <div key={r.influencerUsername} className="grid grid-cols-[32px_1fr_auto] md:grid-cols-[40px_1fr_90px_90px_130px_110px] gap-3 px-4 md:px-5 py-3.5 border-b border-slate-50 last:border-0 items-center">
              <span className={`text-sm font-black ${idx < 3 && r.sales > 0 ? 'text-blue-600' : 'text-slate-300'}`}>{idx + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">@{r.influencerUsername}</p>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.round((r.sales / maxSales) * 100)}%` }} />
                </div>
                <p className="md:hidden text-[11px] text-slate-500 mt-1">방문 {r.clicks.toLocaleString('ko-KR')} · 주문 {r.orders}건 · 수수료 {won(r.commission)}</p>
              </div>
              <p className="hidden md:block text-right text-xs font-bold text-slate-600">{r.clicks.toLocaleString('ko-KR')}</p>
              <p className="hidden md:block text-right text-xs font-bold text-slate-600">{r.orders.toLocaleString('ko-KR')}건</p>
              <p className="text-right text-sm font-black text-slate-900">{won(r.sales)}</p>
              <p className="hidden md:block text-right text-xs font-bold text-blue-600">{won(r.commission)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
