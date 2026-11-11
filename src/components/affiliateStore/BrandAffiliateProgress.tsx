import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, Copy, ExternalLink, Loader2, Truck, Users } from 'lucide-react';
import {
  affiliateStoreService,
  won,
  shortDate,
  uploadScheduleOf,
  SHIPPING_COURIERS,
  SHIPPING_STATUS_LABEL,
  SHIPPING_STATUS_STYLE,
  UPLOAD_DAYS,
  UPLOAD_TONE_STYLE,
  type ProductSalesRow,
  type ProductSalesTotals,
  type StoreRequest,
} from '../../services/affiliateStoreService';
import { formatPhone } from '../../utils/formatters';
import { copyText } from '../../utils/clipboard';

/**
 * 브랜드 어필리에이트 › 진행관리 › 상품 › 진행 단계 · 판매 현황.
 *
 * 진행 단계는 광고비 지급형 캠페인의 진행사항처럼 선정된 인플루언서 한 명당 한 줄이다.
 * 어필리에이트라 단계는 셋이다.
 *   배송 현황      인플루언서가 입력한 배송지 → 브랜드가 협찬 상품을 보내고 송장번호 입력
 *   업로드 일정    상품 수령일 + 10일까지 콘텐츠 업로드 · 판매 시작
 *   업로드 링크    인플루언서가 MY 어필리에이트에 올린 콘텐츠 링크 · 파트너십 코드(캠페인 이력에서 2차 광고로 돌린다)
 *
 * 판매 현황은 이 상품이 픽스폴리오(인플루언서 전용 링크)를 통해 얼마나 팔렸는지와 인플루언서별 판매.
 */

const cellLabel = 'text-[10px] font-black text-slate-400 mb-1 md:hidden';

export const AffiliateProgressBoard: React.FC<{ businessUsername: string; productId: string; onShipped?: () => void }> = ({
  businessUsername, productId, onShipped,
}) => {
  const [rows, setRows] = useState<StoreRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [copied, setCopied] = useState('');
  const [draft, setDraft] = useState<Record<string, { company: string; number: string; editing?: boolean }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await affiliateStoreService.getBrandProgress(businessUsername, productId);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setRows(res.requests || []);
  }, [businessUsername, productId]);
  useEffect(() => { void load(); }, [load]);

  const ship = async (r: StoreRequest) => {
    const d = draft[r.id] || { company: r.trackingCompany || SHIPPING_COURIERS[0], number: r.trackingNumber || '' };
    if (!d.number.trim()) { window.alert('송장번호를 입력해 주세요.'); return; }
    setBusyId(r.id);
    const res = await affiliateStoreService.shipSelection(businessUsername, r.id, d.company || SHIPPING_COURIERS[0], d.number.trim());
    setBusyId('');
    if (res.error) { window.alert(res.error); return; }
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, ...res.request, productName: x.productName, productImage: x.productImage, brandName: x.brandName } : x)));
    setDraft(prev => { const n = { ...prev }; delete n[r.id]; return n; });
    onShipped?.();
  };

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied(c => (c === key ? '' : c)), 1600);
    }
  };

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
        <p className="text-xs text-slate-400 mt-1">지원 현황에서 인플루언서를 선정하면 여기서 배송 · 업로드 일정 · 업로드 링크를 관리해요.</p>
      </div>
    );
  }

  const shippingCell = (r: StoreRequest) => {
    const st = r.shippingStatus || '';
    if (!st) return <p className="text-[11px] text-slate-400 font-bold">예전 방식 선정(배송 단계 없음)</p>;
    if (st === 'awaiting_info') return <p className="text-[11px] text-amber-700 font-bold">인플루언서 배송정보 입력 대기</p>;
    if (st === 'declined') {
      return (
        <p className="text-[11px] text-slate-500 font-bold">
          인플루언서가 협업을 반려했어요.
          {r.declinedReason && <span className="block text-slate-400 font-medium">사유: {r.declinedReason}</span>}
        </p>
      );
    }
    const a = r.shipping;
    const d = draft[r.id];
    const editing = st === 'info_submitted' || !!d?.editing;
    return (
      <div className="space-y-1.5 text-[11px]">
        {a && (
          <div className="text-slate-700">
            <p className="font-black text-slate-900">{a.recipientName} · {formatPhone(a.recipientPhone)}</p>
            <p className="leading-snug">{a.postcode ? `(${a.postcode}) ` : ''}{a.address1} {a.address2}</p>
            {a.memo && <p className="text-slate-400">메모: {a.memo}</p>}
          </div>
        )}
        {editing ? (
          <div className="flex gap-1">
            <select
              value={d?.company || r.trackingCompany || SHIPPING_COURIERS[0]}
              onChange={e => setDraft(p => ({ ...p, [r.id]: { company: e.target.value, number: p[r.id]?.number ?? r.trackingNumber ?? '', editing: p[r.id]?.editing } }))}
              className="h-8 px-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold shrink-0 max-w-[110px]"
            >
              {SHIPPING_COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              value={d?.number ?? r.trackingNumber ?? ''}
              onChange={e => setDraft(p => ({ ...p, [r.id]: { company: p[r.id]?.company || r.trackingCompany || SHIPPING_COURIERS[0], number: e.target.value, editing: p[r.id]?.editing } }))}
              placeholder="송장번호"
              inputMode="numeric"
              className="h-8 min-w-0 flex-1 px-2 rounded-lg border border-slate-200 bg-white text-[11px] focus:outline-none focus:border-blue-600"
            />
            <button disabled={busyId === r.id} onClick={() => ship(r)} className="h-8 px-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-black shrink-0 disabled:opacity-50">
              {st === 'shipped' ? '저장' : '발송 완료'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="font-black text-emerald-600 truncate">
              {r.trackingCompany} {r.trackingNumber}
              {r.trackingUrl && <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="ml-1 text-blue-600 underline">조회</a>}
            </p>
            <button
              onClick={() => setDraft(p => ({ ...p, [r.id]: { company: r.trackingCompany || SHIPPING_COURIERS[0], number: r.trackingNumber || '', editing: true } }))}
              className="text-slate-400 font-bold hover:text-slate-700 shrink-0"
            >
              송장 수정
            </button>
          </div>
        )}
      </div>
    );
  };

  const shipCount = rows.filter(r => r.shippingStatus === 'info_submitted').length;
  const uploadedCount = rows.filter(r => r.contentUrl).length;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 font-bold leading-relaxed">
        배송정보를 확인하고 협찬 상품을 보낸 뒤 송장번호를 입력해 주세요. 인플루언서는 상품 수령 후 {UPLOAD_DAYS}일 이내에 콘텐츠를 업로드하고 판매를 시작해요.
        업로드한 콘텐츠 링크와 파트너십 코드는 여기와 캠페인 이력에서 확인하고, 캠페인 이력에서 2차 광고로 돌릴 수 있어요.
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] font-black">
        <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-100 text-slate-600">선정 {rows.length}명</span>
        <span className={`px-2.5 py-1 rounded-lg ${shipCount > 0 ? 'bg-blue-600 text-white' : 'bg-white border border-slate-100 text-slate-600'}`}>발송 대기 {shipCount}</span>
        <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-100 text-slate-600">업로드 완료 {uploadedCount}</span>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="hidden md:grid grid-cols-[170px_1.3fr_170px_1.2fr] gap-4 px-5 py-3 text-[10px] font-black text-slate-400 border-b border-slate-100">
          <span>인플루언서</span>
          <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> 배송 현황</span>
          <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> 업로드 일정</span>
          <span>업로드 링크 · 파트너십 코드</span>
        </div>
        {rows.map(r => {
          const schedule = uploadScheduleOf(r);
          return (
            <div key={r.id} className="grid grid-cols-1 md:grid-cols-[170px_1.3fr_170px_1.2fr] gap-3 md:gap-4 px-4 md:px-5 py-4 border-b border-slate-50 last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">@{r.influencerUsername}</p>
                {r.shippingStatus && (
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-black ${SHIPPING_STATUS_STYLE[r.shippingStatus]}`}>{SHIPPING_STATUS_LABEL[r.shippingStatus]}</span>
                )}
                {r.channelUrl && (
                  <a href={r.channelUrl} target="_blank" rel="noreferrer" className="block mt-1 text-[10px] font-bold text-blue-600 truncate">채널 보기</a>
                )}
              </div>
              <div className="min-w-0">
                <p className={cellLabel}>배송 현황</p>
                {shippingCell(r)}
              </div>
              <div className="min-w-0">
                <p className={cellLabel}>업로드 일정</p>
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-black ${UPLOAD_TONE_STYLE[schedule.tone]}`}>{schedule.label}</span>
                <p className="text-[10px] text-slate-400 font-bold mt-1 leading-snug">
                  {r.shippedAt && <>발송 {shortDate(r.shippedAt)}<br /></>}
                  {r.deliveredAt ? <>수령 {shortDate(r.deliveredAt)} · 마감 {shortDate(r.uploadDeadline)}</> : r.shippingStatus === 'shipped' ? '수령 확인 대기' : ''}
                  {r.contentSubmittedAt && <><br />업로드 {shortDate(r.contentSubmittedAt)}</>}
                </p>
              </div>
              <div className="min-w-0 text-[11px]">
                <p className={cellLabel}>업로드 링크 · 파트너십 코드</p>
                {r.contentUrl ? (
                  <div className="space-y-1">
                    <a href={r.contentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 font-bold min-w-0">
                      <ExternalLink className="w-3 h-3 shrink-0" /><span className="truncate">{r.contentUrl}</span>
                    </a>
                    {r.partnershipCode ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-slate-700 truncate">{r.partnershipCode}</span>
                        <button onClick={() => copy(r.id, r.partnershipCode || '')} className="shrink-0 text-slate-400 hover:text-slate-700" aria-label="파트너십 코드 복사">
                          {copied === r.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <p className="text-amber-600 font-bold">파트너십 코드 미입력</p>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-400 font-bold">아직 업로드 전</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
