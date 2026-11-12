import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  affiliateStoreService,
  won,
  MANAGER_STATUS_LABEL,
  MANAGER_STATUS_STYLE,
  SHIPPING_STATUS_LABEL,
  SHIPPING_STATUS_STYLE,
  type ManagerSelection,
  type ManagerStatus,
} from '../../services/affiliateStoreService';
import { formatPhone } from '../../utils/formatters';
import { copyText } from '../../utils/clipboard';

/**
 * 어필리에이트 협업 진행 — 브랜드가 선정한 판매 신청. 선정되는 순간부터 여기에 보인다.
 *
 * 브랜드가 선정하면 인플루언서에게 알림이 가고, 인플루언서가 협찬 상품 배송정보를 입력하면 협업이 진행된다
 * (브랜드가 송장번호를 입력하면 전용 판매 링크가 열린다). 담당자는 "협업 진행" 건을 보고 양쪽 사이에서 조율한다.
 * 인플루언서가 반려한 건은 진행되지 않는다. 문제가 있는 건은 링크를 잠시 닫을 수 있다.
 */

type Filter = 'active' | 'new' | 'awaiting_info' | 'info_submitted' | 'shipped' | 'declined' | 'all';
const FILTER_LABEL: Record<Filter, string> = {
  active: '진행 중 전체',
  new: '새 선정',
  awaiting_info: '배송정보 입력 대기',
  info_submitted: '발송 대기',
  shipped: '발송 완료',
  declined: '인플루언서 반려',
  all: '전체',
};
/** 진행 중 = 브랜드가 선정한 뒤 인플루언서가 반려하지 않은 건(배송정보 대기 · 발송 대기 · 발송 완료 · 예전 흐름). */
const isActive = (r: ManagerSelection) => r.shippingStatus !== 'declined';
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const digits = (v: string) => v.replace(/[^0-9+]/g, '');

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { if (await copyText(text)) { setDone(true); window.setTimeout(() => setDone(false), 1500); } }}
      className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-black text-slate-500 hover:bg-slate-100"
    >
      {done ? '복사됨' : '복사'}
    </button>
  );
};

/** 전화번호 한 줄 — 누르면 바로 전화 · 문자, 복사. */
const ContactPhone: React.FC<{ label: string; phone: string }> = ({ label, phone }) => {
  if (!phone) return null;
  const tel = digits(phone);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-slate-400 w-14 shrink-0 truncate">{label}</span>
      <a href={`tel:${tel}`} className="font-black text-slate-900 hover:text-blue-600">{formatPhone(phone)}</a>
      <a href={`tel:${tel}`} className="px-2 py-1 rounded-md bg-blue-600 text-white text-[10px] font-black hover:bg-blue-500">전화</a>
      <a href={`sms:${tel}`} className="px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-black text-slate-600 hover:bg-slate-100">문자</a>
      <CopyButton text={formatPhone(phone)} />
    </div>
  );
};

const ContactEmail: React.FC<{ email: string }> = ({ email }) => {
  if (!email) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-black text-slate-400 w-14 shrink-0">이메일</span>
      <a href={`mailto:${email}`} className="font-bold text-slate-700 hover:text-blue-600 break-all">{email}</a>
      <CopyButton text={email} />
    </div>
  );
};

const AdminAffiliateSelections: React.FC<{ token: string; onNewCountChange?: (n: number) => void }> = ({ token, onNewCountChange }) => {
  const [rows, setRows] = useState<ManagerSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateStoreService.listSelections(token);
    if (res.error) setError(res.error);
    else {
      setError('');
      setRows(res.selections || []);
      setNotes(Object.fromEntries((res.selections || []).map(r => [r.id, r.managerNote || ''])));
      // 목록을 열어 본 새 선정은 확인한 것으로 둔다(이번 화면에서는 NEW 표시를 남겨 둔다).
      const unseen = (res.selections || []).filter(r => r.operatorUnseen).map(r => r.id);
      if (unseen.length) {
        const seen = await affiliateStoreService.markSelectionsSeen(token, unseen);
        if (!seen.error) onNewCountChange?.(seen.newCount);
      } else {
        onNewCountChange?.(0);
      }
    }
    setLoading(false);
  }, [token, onNewCountChange]);
  useEffect(() => { load(); }, [load]);

  const matches = (r: ManagerSelection, f: Filter) =>
    f === 'all' ? true : f === 'active' ? isActive(r) : f === 'new' ? !!r.operatorUnseen : r.shippingStatus === f;
  const counts = useMemo(() => Object.fromEntries(
    (Object.keys(FILTER_LABEL) as Filter[]).map(f => [f, rows.filter(r => matches(r, f)).length]),
  ) as Record<Filter, number>, [rows]);
  const visible = rows.filter(r => matches(r, filter));
  const opened = openId ? rows.find(r => r.id === openId) || null : null;

  const update = async (r: ManagerSelection, next: ManagerStatus) => {
    if (next === 'done' && !window.confirm('링크를 다시 열까요? 인플루언서의 전용 판매 링크로 다시 주문을 받을 수 있습니다.')) return;
    if (next !== 'done' && !window.confirm('링크를 잠시 닫을까요? 닫는 동안 이 인플루언서 링크로는 주문할 수 없습니다.')) return;
    setBusy(r.id);
    const res = await affiliateStoreService.updateSelection(token, r.id, next, notes[r.id] ?? '');
    setBusy('');
    if (res.error) window.alert(res.error);
    else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-black text-slate-900">어필리에이트 협업 진행</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">브랜드가 선정한 협업이 선정 즉시 여기에 올라옵니다. 브랜드 · 인플루언서 연락처를 바로 눌러 전화 · 문자로 연락하고, 배송 · 업로드 일정을 중간에서 조율해 주세요. 문제가 있으면 링크를 잠시 닫을 수 있습니다.</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-black text-slate-600 hover:bg-slate-200">새로고침</button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(Object.keys(FILTER_LABEL) as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setOpenId(null); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${filter === f ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
          >
            {FILTER_LABEL[f]} {counts[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center bg-white rounded-2xl border border-slate-100">해당하는 건이 없습니다.</p>
      ) : !opened ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          {visible.map(r => {
            const status = (r.managerStatus || 'waiting') as ManagerStatus;
            const canToggleLink = r.shippingStatus === 'shipped' || !r.shippingStatus;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setOpenId(r.id)}
                className={`text-left bg-white rounded-2xl border shadow-sm overflow-hidden hover:-translate-y-0.5 hover:shadow-md transition-all ${r.operatorUnseen ? 'border-red-200' : 'border-slate-100'}`}
              >
                <div className="relative aspect-square bg-slate-100">
                  {r.productImage && <img src={r.productImage} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  {r.shippingStatus && (
                    <span className={`absolute top-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg ${SHIPPING_STATUS_STYLE[r.shippingStatus]}`}>{SHIPPING_STATUS_LABEL[r.shippingStatus]}</span>
                  )}
                  {r.operatorUnseen ? (
                    <span className="absolute top-2 right-2 text-[10px] font-black px-2 py-1 rounded-lg bg-red-500 text-white">NEW</span>
                  ) : canToggleLink ? (
                    <span className={`absolute top-2 right-2 text-[10px] font-black px-2 py-1 rounded-lg ${MANAGER_STATUS_STYLE[status]}`}>{MANAGER_STATUS_LABEL[status]}</span>
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="text-[10px] font-bold text-slate-400 truncate">{r.brandName}</p>
                  <p className="text-xs md:text-sm font-black text-slate-900 line-clamp-2 min-h-[2.5em]">{r.productName}</p>
                  <p className="text-[11px] text-slate-500 mt-1 truncate">
                    {won(r.salePrice)} · 수수료 <b className="text-blue-600">{r.commissionRate}%</b>
                  </p>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5 truncate">@{r.influencerUsername} · {dateTime(r.updatedAt)}</p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <button onClick={() => setOpenId(null)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-100">← 목록으로</button>
          {[opened].map(r => {
            const status = (r.managerStatus || 'waiting') as ManagerStatus;
            // 배송정보 입력 전 · 반려된 건은 링크를 열지 않는다(협업이 진행되지 않음).
            // 송장 입력 전 링크는 브랜드가 발송해야 열린다.
            const canToggleLink = r.shippingStatus === 'shipped' || !r.shippingStatus;
            return (
              <div key={r.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${r.operatorUnseen ? 'border-red-200' : 'border-slate-100'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    {r.productImage && <img src={r.productImage} alt="" className="w-12 h-12 rounded-xl object-cover bg-slate-100 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.operatorUnseen && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-red-500 text-white">NEW</span>}
                        <p className="text-sm font-black text-slate-900 truncate">{r.brandName} · {r.productName}</p>
                        {r.shippingStatus && (
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${SHIPPING_STATUS_STYLE[r.shippingStatus]}`}>{SHIPPING_STATUS_LABEL[r.shippingStatus]}</span>
                        )}
                        {canToggleLink && (
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${MANAGER_STATUS_STYLE[status]}`}>{MANAGER_STATUS_LABEL[status]}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        판매가 {won(r.salePrice)} · 인플루언서 수수료 {r.commissionRate}% · 선정 {dateTime(r.updatedAt)}
                        {r.managerUsername ? ` · 담당 ${r.managerUsername}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {canToggleLink && status !== 'done' && (
                      <button disabled={busy === r.id} onClick={() => update(r, 'done')} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black disabled:opacity-50">링크 다시 열기</button>
                    )}
                    {canToggleLink && status === 'done' && (
                      <button disabled={busy === r.id} onClick={() => update(r, 'contacting')} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black disabled:opacity-50">링크 잠시 닫기</button>
                    )}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3 mt-4 text-xs">
                  <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                    <p className="text-[10px] font-black text-slate-400">브랜드 연락처</p>
                    <p className="font-bold text-slate-800">
                      {r.brandName || '-'}{r.brandContact.name ? ` · ${r.brandContact.name}` : ''}
                      <span className="ml-1 text-slate-400 font-bold">biz/{r.businessUsername}</span>
                    </p>
                    <ContactPhone label="담당자" phone={r.brandContact.phone} />
                    {r.brandContact.csPhone && r.brandContact.csPhone.replace(/\D/g, '') !== r.brandContact.phone.replace(/\D/g, '') && (
                      <ContactPhone label="고객센터" phone={r.brandContact.csPhone} />
                    )}
                    <ContactEmail email={r.brandContact.email} />
                    {!r.brandContact.phone && !r.brandContact.csPhone && !r.brandContact.email && (
                      <p className="text-[11px] font-bold text-amber-600">입점 신청서에 등록된 연락처가 없습니다.</p>
                    )}
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                    <p className="text-[10px] font-black text-slate-400">인플루언서 연락처</p>
                    <p className="font-bold text-slate-800">
                      <a href={`/${r.influencerUsername}`} target="_blank" rel="noreferrer" className="hover:text-blue-600">@{r.influencerUsername}</a>
                      {r.creatorContact.name ? ` · ${r.creatorContact.name}` : ''}
                    </p>
                    <ContactPhone label="연락처" phone={r.creatorContact.phone} />
                    {r.shipping?.recipientPhone && r.shipping.recipientPhone.replace(/\D/g, '') !== r.creatorContact.phone.replace(/\D/g, '') && (
                      <ContactPhone label={`배송지${r.shipping.recipientName ? ` (${r.shipping.recipientName})` : ''}`} phone={r.shipping.recipientPhone} />
                    )}
                    {(r.channelUrl || r.creatorContact.instagramUrl) && (
                      <a href={r.channelUrl || r.creatorContact.instagramUrl} target="_blank" rel="noreferrer" className="block text-blue-600 font-bold truncate">{r.channelUrl || r.creatorContact.instagramUrl}</a>
                    )}
                    {!r.creatorContact.phone && !r.shipping?.recipientPhone && (
                      <p className="text-[11px] font-bold text-amber-600">등록된 연락처가 없습니다. 배송정보를 입력하면 배송지 연락처가 표시됩니다 — 그 전에는 인스타그램 DM으로 연락해 주세요.</p>
                    )}
                    {r.message && <p className="text-slate-500 whitespace-pre-wrap line-clamp-3">"{r.message}"</p>}
                  </div>
                </div>

                {(r.shipping || r.trackingNumber || r.declinedAt) && (
                  <div className="mt-3 bg-blue-50/60 border border-blue-100 rounded-xl p-3 text-xs space-y-1">
                    <p className="text-[10px] font-black text-slate-400">협찬 상품 배송</p>
                    {r.shipping && (
                      <>
                        <p className="font-bold text-slate-800">{r.shipping.recipientName} · {formatPhone(r.shipping.recipientPhone)}</p>
                        <p className="text-slate-600">{r.shipping.postcode ? `(${r.shipping.postcode}) ` : ''}{r.shipping.address1} {r.shipping.address2}</p>
                        {r.shipping.memo && <p className="text-slate-500">메모: {r.shipping.memo}</p>}
                        <p className="text-[10px] text-slate-400">배송정보 입력 {dateTime(r.shipping.submittedAt)}</p>
                      </>
                    )}
                    {r.trackingNumber ? (
                      <p className="font-bold text-emerald-600">
                        송장 {r.trackingCompany} {r.trackingNumber} · 발송 {dateTime(r.shippedAt || null)}
                        {r.trackingUrl && <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="ml-1.5 text-blue-600 underline">배송 조회</a>}
                      </p>
                    ) : r.shippingStatus === 'info_submitted' && (
                      <p className="font-bold text-amber-600">브랜드 발송 대기 중(송장 미입력 · 판매 링크는 송장 입력 뒤 열림)</p>
                    )}
                    {r.shippingStatus === 'declined' && (
                      <p className="font-bold text-slate-500">인플루언서가 협업을 반려했어요 · {dateTime(r.declinedAt || null)}{r.declinedReason ? ` · 사유: ${r.declinedReason}` : ''}</p>
                    )}
                  </div>
                )}

                {(r.shippingStatus === 'shipped' || !r.shippingStatus) && (
                  <div className="mt-3 bg-slate-50 rounded-xl p-3 text-xs space-y-1">
                    <p className="text-[10px] font-black text-slate-400">콘텐츠 업로드</p>
                    {r.contentUrl ? (
                      <>
                        <a href={r.contentUrl} target="_blank" rel="noreferrer" className="block text-blue-600 font-bold truncate">{r.contentUrl}</a>
                        <p className={`font-bold ${r.partnershipCode ? 'text-slate-600' : 'text-amber-600'}`}>
                          {r.partnershipCode ? `파트너십 코드 ${r.partnershipCode}` : '파트너십 코드 미입력'}
                          {r.contentSubmittedAt ? ` · 업로드 ${dateTime(r.contentSubmittedAt)}` : ''}
                        </p>
                      </>
                    ) : (
                      <p className="font-bold text-slate-400">아직 업로드 전 · 업로드 일정은 담당자가 양쪽과 조율해 주세요.</p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <input
                    value={notes[r.id] ?? ''}
                    onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="연락 메모 (내부용 · 상태를 바꿀 때 함께 저장)"
                    className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-600"
                  />
                  <button disabled={busy === r.id} onClick={() => update(r, status)} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-50">메모 저장</button>
                </div>
                {status === 'done' && r.linkCode && (
                  <p className="mt-2 text-[11px] text-emerald-600 font-bold">판매 링크: /shop/{r.linkCode}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAffiliateSelections;
