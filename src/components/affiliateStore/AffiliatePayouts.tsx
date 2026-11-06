import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Landmark, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import {
  affiliatePayoutService,
  scheduleText,
  withholdingPreview,
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_STYLE,
  type BrandPayoutAccount,
  type InfluencerPayoutAccount,
  type PartyPayoutData,
  type PayoutParty,
  type PayoutRequest,
} from '../../services/affiliatePayoutService';

/**
 * 어필리에이트 "정산" 메뉴(브랜드 · 인플루언서 공용).
 *
 *   상단: 지급 가능 · 정산 예정(구매확정 전) · 지급 신청 중 · 누적 지급
 *   지급 신청: 지급 가능 금액 전액(부분 신청 없음). 정산 정보가 없으면 버튼이 꺼진다.
 *   정산 정보: 인플루언서(실명 · 주민등록번호 · 은행 · 계좌 · 예금주 · 동의) / 브랜드(은행 · 계좌 · 예금주 · 통장 사본 · 세금계산서 이메일)
 *   지급 신청 내역: 포함 주문 · 차감 내역 · 금액 · 지급 예정일 · 상태 · 반려 사유
 *
 * 주민등록번호 · 계좌번호는 저장할 때만 보내고, 화면에는 서버가 준 가린 값만 보인다.
 */

const won = (n: number) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '');
const WITHHOLDING_NOTICE = '수수료는 3.3%(소득세 3% + 지방소득세 0.3%)를 원천징수한 뒤 지급돼요.';
const SCHEDULE_NOTICE = '이번 달 말일까지 신청한 금액은 다음 달 10일에 지급돼요.';

/** 통장 사본: 큰 사진은 긴 변 1600px JPEG 로 줄여 보낸다(서버 한도 3MB). */
async function compressImage(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('image'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const inputCls = 'w-full h-11 px-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500';
const labelCls = 'block text-[11px] font-black text-slate-500 mb-1';

// 주민등록번호 입력칸: 생년월일 6자리 + 뒷자리 첫 숫자까지(7자리)는 보이고, 나머지 6자리는 * 로 가린다.
// value 는 숫자만(최대 13자리) 담는다.
const RRN_VISIBLE = 7;
const formatRrn = (digits: string) => {
  const shown = digits.slice(0, RRN_VISIBLE) + '*'.repeat(Math.max(0, digits.length - RRN_VISIBLE));
  return shown.length > 6 ? `${shown.slice(0, 6)}-${shown.slice(6)}` : shown;
};
// 화면 문자열 위치 → 숫자 위치 (6번 자리의 '-' 를 건너뛴다)
const rrnIndex = (displayIdx: number, hasDash: boolean) => (hasDash && displayIdx > 6 ? displayIdx - 1 : displayIdx);

const RrnInput: React.FC<{ value: string; onChange: (digits: string) => void; className?: string }> = ({ value, onChange, className }) => {
  const display = formatRrn(value);
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    // 이전 화면 값과 비교해 바뀐 구간만 찾아서, 실제 숫자에 반영한다(가려진 * 는 원래 숫자를 유지).
    let p = 0;
    while (p < display.length && p < next.length && display[p] === next[p]) p++;
    let s = 0;
    while (s < display.length - p && s < next.length - p && display[display.length - 1 - s] === next[next.length - 1 - s]) s++;
    const hasDash = display.length > 6;
    const inserted = next.slice(p, next.length - s).replace(/\D/g, '');
    const start = rrnIndex(p, hasDash);
    const end = Math.max(start, rrnIndex(display.length - s, hasDash));
    onChange((value.slice(0, start) + inserted + value.slice(end)).slice(0, 13));
  };
  return (
    <input value={display} onChange={handleChange} className={`${className || ''} font-mono tracking-wider`}
      inputMode="numeric" type="text" autoComplete="off" autoCorrect="off" spellCheck={false} data-lpignore="true" data-1p-ignore
      placeholder="예: 900101-1******" maxLength={14} />
  );
};

// ─────────────────────────── 정산 정보 폼 ───────────────────────────

const InfluencerAccountForm: React.FC<{ banks: string[]; current: InfluencerPayoutAccount | null; onSaved: () => void; onCancel?: () => void }> = ({ banks, current, onSaved, onCancel }) => {
  const [form, setForm] = useState({
    legalName: current?.legalName || '', rrn: '', bankName: current?.bankName || '', accountNumber: '', accountHolder: current?.accountHolder || '',
  });
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const holderDiffers = !!form.accountHolder && !!form.legalName && form.accountHolder.replace(/\s/g, '') !== form.legalName.replace(/\s/g, '');

  const save = async () => {
    setError('');
    if (!consent) { setError('개인정보 수집 · 이용에 동의해 주세요.'); return; }
    if (holderDiffers) { setError('예금주는 실명과 같아야 해요.'); return; }
    setSaving(true);
    const res = await affiliatePayoutService.saveInfluencerAccount({
      ...form, rrn: form.rrn.replace(/\D/g, ''), accountNumber: form.accountNumber.replace(/\D/g, ''), privacyConsent: consent,
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setForm(f => ({ ...f, rrn: '', accountNumber: '' }));
    onSaved();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-blue-700 bg-blue-50 rounded-xl px-3 py-2.5 font-bold">{WITHHOLDING_NOTICE}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label><span className={labelCls}>실명</span><input value={form.legalName} onChange={set('legalName')} className={inputCls} maxLength={30} autoComplete="name" /></label>
        <label>
          <span className={labelCls}>주민등록번호{current ? ` (등록됨: ${current.rrnMasked} · 바꿀 때만 입력)` : ''}</span>
          <RrnInput value={form.rrn} onChange={rrn => setForm(f => ({ ...f, rrn }))} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}>은행</span>
          <select value={form.bankName} onChange={set('bankName')} className={inputCls}>
            <option value="">선택해 주세요</option>
            {banks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>계좌번호{current ? ` (등록됨: ${current.accountMasked} · 바꿀 때만 입력)` : ''}</span>
          <input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value.replace(/[^\d-]/g, '').slice(0, 30) }))} className={inputCls}
            inputMode="numeric" autoComplete="off" placeholder="숫자만" />
        </label>
        <label className="md:col-span-2">
          <span className={labelCls}>예금주 (실명과 같아야 해요)</span>
          <input value={form.accountHolder} onChange={set('accountHolder')} className={inputCls} maxLength={30} />
          {holderDiffers && <span className="block text-[11px] text-red-500 font-bold mt-1">예금주가 실명과 달라요. 본인 명의 계좌만 등록할 수 있어요.</span>}
        </label>
      </div>
      <div className="rounded-xl border border-slate-200 p-3 text-[11px] text-slate-600 space-y-1.5">
        <p className="font-black text-slate-800">개인정보 수집 · 이용 동의 (필수)</p>
        <p>· 수집 항목: 실명, 주민등록번호, 은행, 계좌번호, 예금주</p>
        <p>· 이용 목적: 수수료 지급 및 원천징수 신고</p>
        <p>· 보관 기간: 관계 법령(국세기본법 · 소득세법 등)에 따른 기간</p>
        <p>· 주민등록번호는 소득세법에 따른 원천징수 신고를 위해 수집하며, 암호화해 저장해요. 동의하지 않으면 수수료를 지급받을 수 없어요.</p>
        <label className="flex items-center gap-2 pt-1 font-black text-slate-800 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="w-4 h-4" />
          위 내용을 확인했고 개인정보 수집 · 이용에 동의해요
        </label>
      </div>
      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="h-11 px-5 rounded-xl bg-slate-900 text-white text-sm font-black disabled:opacity-50 flex items-center gap-1.5">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} 저장
        </button>
        {onCancel && <button onClick={onCancel} className="h-11 px-5 rounded-xl bg-slate-100 text-slate-600 text-sm font-black">취소</button>}
      </div>
    </div>
  );
};

const BrandAccountForm: React.FC<{
  account: string; banks: string[]; current: BrandPayoutAccount | null;
  brandNames: PartyPayoutData['brandNames']; onSaved: () => void; onCancel?: () => void;
}> = ({ account, banks, current, brandNames, onSaved, onCancel }) => {
  const [form, setForm] = useState({
    bankName: current?.bankName || '', accountNumber: '', accountHolder: current?.accountHolder || '', taxInvoiceEmail: current?.taxInvoiceEmail || '',
  });
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const key = (v: string) => (v || '').replace(/주식회사|유한회사|\(주\)|㈜|\(유\)|\s|[()（）.,·]/g, '').toLowerCase();
  const mismatch = !!form.accountHolder && !!brandNames
    && ![brandNames.businessName, brandNames.ceoName].filter(Boolean).map(key).includes(key(form.accountHolder));

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { setError('통장 사본은 이미지 파일로 올려 주세요.'); return; }
    try { setImage(await compressImage(f)); setError(''); } catch { setError('이미지를 읽지 못했어요. 다른 파일로 시도해 주세요.'); }
  };

  const save = async () => {
    setError('');
    setSaving(true);
    const res = await affiliatePayoutService.saveBrandAccount(account, {
      ...form, accountNumber: form.accountNumber.replace(/\D/g, ''), bankbookImage: image || undefined,
    });
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    setImage('');
    setForm(f => ({ ...f, accountNumber: '' }));
    onSaved();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label>
          <span className={labelCls}>은행</span>
          <select value={form.bankName} onChange={set('bankName')} className={inputCls}>
            <option value="">선택해 주세요</option>
            {banks.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>계좌번호{current ? ` (등록됨: ${current.accountMasked} · 바꿀 때만 입력)` : ''}</span>
          <input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value.replace(/[^\d-]/g, '').slice(0, 30) }))} className={inputCls} inputMode="numeric" autoComplete="off" placeholder="숫자만" />
        </label>
        <label>
          <span className={labelCls}>예금주</span>
          <input value={form.accountHolder} onChange={set('accountHolder')} className={inputCls} maxLength={60} />
        </label>
        <label>
          <span className={labelCls}>세금계산서 받을 이메일</span>
          <input value={form.taxInvoiceEmail} onChange={set('taxInvoiceEmail')} className={inputCls} type="email" maxLength={200} />
        </label>
      </div>
      {mismatch && (
        <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          예금주가 입점 신청서의 상호({brandNames?.businessName || '-'}) · 대표자명({brandNames?.ceoName || '-'})과 달라요. 저장은 할 수 있지만 운영팀 확인 뒤 지급돼요.
        </p>
      )}
      <div>
        <span className={labelCls}>통장 사본 이미지{current?.hasBankbook ? ' (등록됨 · 바꿀 때만 올려 주세요)' : ''}</span>
        <div className="flex items-center gap-3">
          <label className="h-10 px-4 rounded-xl border border-slate-200 text-xs font-black text-slate-700 flex items-center cursor-pointer hover:bg-slate-50">
            이미지 선택
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" />
          </label>
          {image && <img src={image} alt="통장 사본 미리 보기" className="h-14 rounded-lg border border-slate-200" />}
        </div>
      </div>
      {error && <p className="text-xs font-bold text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="h-11 px-5 rounded-xl bg-slate-900 text-white text-sm font-black disabled:opacity-50 flex items-center gap-1.5">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} 저장
        </button>
        {onCancel && <button onClick={onCancel} className="h-11 px-5 rounded-xl bg-slate-100 text-slate-600 text-sm font-black">취소</button>}
      </div>
    </div>
  );
};

// ─────────────────────────── 신청 내역 한 줄 ───────────────────────────

export const PayoutRequestCard: React.FC<{ r: PayoutRequest; actions?: React.ReactNode; showParty?: boolean }> = ({ r, actions, showParty }) => {
  const [open, setOpen] = useState(false);
  const isInf = r.partyType === 'influencer';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-1 rounded-md text-[10px] font-black ${PAYOUT_STATUS_STYLE[r.status]}`}>{PAYOUT_STATUS_LABEL[r.status]}</span>
            {showParty && <span className="text-sm font-black text-slate-900">{r.displayName || r.party} <span className="text-[11px] text-slate-400 font-bold">@{r.party}</span></span>}
            {r.holderMismatch && <span className="px-2 py-1 rounded-md text-[10px] font-black bg-amber-50 text-amber-700">예금주 확인 필요</span>}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            신청일 {dateText(r.requestedAt)} · 지급 예정일 {scheduleText(r.scheduledDate)}
            {r.status === 'paid' && r.paidDate && ` · 지급일 ${r.paidDate}`}
          </p>
          <p className="text-[11px] text-slate-500">{r.bankName} {r.accountMasked} · 예금주 {r.accountHolder}</p>
          {r.status === 'rejected' && r.rejectReason && <p className="text-[11px] font-bold text-red-500 mt-1">반려 사유: {r.rejectReason}</p>}
        </div>
        <div className="text-right">
          {isInf ? (
            <>
              <p className="text-[11px] text-slate-500">총액 {won(r.grossAmount)} · 원천징수 −{won(r.incomeTax + r.localTax)}</p>
              <p className="text-lg font-black text-slate-900">실지급 {won(r.netAmount)}</p>
            </>
          ) : (
            <p className="text-lg font-black text-slate-900">{won(r.netAmount)}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <button onClick={() => setOpen(o => !o)} className="text-[11px] font-black text-slate-500 flex items-center gap-1">
          포함 주문 {r.items.length}건{r.deductions.length > 0 ? ` · 차감 ${r.deductions.length}건` : ''}
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {actions && <div className="flex gap-1.5">{actions}</div>}
      </div>
      {open && (
        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-[11px] space-y-1">
          {r.items.map(i => (
            <div key={i.orderId} className="flex justify-between gap-3">
              <span className="text-slate-600 truncate">{i.productName} <span className="text-slate-400">· {i.orderId}</span></span>
              <span className="font-bold text-slate-800 shrink-0">{won(i.amount)}</span>
            </div>
          ))}
          {r.deductions.map((d, idx) => (
            <div key={`d${idx}`} className="flex justify-between gap-3 text-red-500">
              <span className="truncate">{d.amount < 0 ? '환원' : '차감'} · {d.reason} <span className="text-red-300">· {d.orderId}</span></span>
              <span className="font-bold shrink-0">{d.amount < 0 ? '+' : '−'}{won(Math.abs(d.amount))}</span>
            </div>
          ))}
          <div className="flex justify-between gap-3 pt-1 border-t border-slate-200 font-black text-slate-800">
            <span>주문 합계 {won(r.orderAmount)}{r.deductionAmount !== 0 ? ` − 차감 ${won(r.deductionAmount)}` : ''}</span>
            <span>{won(r.grossAmount)}</span>
          </div>
          {isInf && (
            <div className="text-slate-500">소득세(3%) {won(r.incomeTax)} · 지방소득세(소득세의 10%) {won(r.localTax)} · 실지급액 {won(r.netAmount)}</div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────── 화면 ───────────────────────────

const AffiliatePayouts: React.FC<{ as: PayoutParty; account?: string }> = ({ as, account }) => {
  const [data, setData] = useState<PartyPayoutData | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ scheduledDate: string } | null>(null);
  const [showOrders, setShowOrders] = useState(false);

  const load = useCallback(async () => {
    const res = await affiliatePayoutService.get(as, account);
    if (res.error) setError(res.error);
    else { setError(''); setData(res); }
  }, [as, account]);
  useEffect(() => { load(); }, [load]);

  if (error && !data) return <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>;
  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;

  const s = data.summary;
  const isInf = as === 'influencer';
  const hasAccount = !!data.account;
  const preview = withholdingPreview(Math.max(0, s.available));
  const belowMin = s.available > 0 && s.available < data.minAmount;
  const canRequest = hasAccount && s.available > 0 && !belowMin;

  const request = async () => {
    const text = isInf
      ? `지급 가능 금액 전액을 신청할까요?\n\n총 수수료 ${won(preview.gross)}\n소득세(3%) −${won(preview.incomeTax)}\n지방소득세 −${won(preview.localTax)}\n실지급액 ${won(preview.net)}\n\n지급 예정일: ${scheduleText(data.nextScheduledDate)}`
      : `지급 가능 금액 ${won(s.available)} 전액을 신청할까요?\n\n지급 예정일: ${scheduleText(data.nextScheduledDate)}`;
    if (!window.confirm(text)) return;
    setBusy('request');
    const res = await affiliatePayoutService.request(as, account);
    setBusy('');
    if (res.error) { window.alert(res.error); load(); return; }
    setNotice({ scheduledDate: res.request?.scheduledDate || data.nextScheduledDate });
    load();
  };

  const cancel = async (r: PayoutRequest) => {
    if (!window.confirm('이 지급 신청을 취소할까요? 금액은 지급 가능 금액으로 돌아가요.')) return;
    setBusy(r.id);
    const res = await affiliatePayoutService.cancel(as, r.id, account);
    setBusy('');
    if (res.error) window.alert(res.error);
    load();
  };

  const cards = [
    { label: '지급 가능 금액', value: s.available, strong: true },
    { label: '정산 예정 (구매확정 전)', value: s.pending },
    { label: '지급 신청 중', value: isInf ? s.requestedNet : s.requested, sub: isInf && s.requested ? `총액 ${won(s.requested)}` : '' },
    { label: '누적 지급액', value: s.paid, sub: isInf && s.paidGross ? `총액 ${won(s.paidGross)}` : '' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4">
        {cards.map(c => (
          <div key={c.label} className={`rounded-2xl border shadow-sm p-4 md:p-5 ${c.strong ? 'bg-slate-900 border-slate-900' : 'bg-white border-slate-100'}`}>
            <p className={`text-[10px] md:text-xs font-black ${c.strong ? 'text-slate-300' : 'text-slate-400'}`}>{c.label}</p>
            <p className={`text-lg md:text-2xl font-black mt-1 ${c.strong ? 'text-white' : 'text-slate-900'}`}>{won(c.value)}</p>
            {c.sub && <p className="text-[10px] text-slate-400 mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* 지급 신청 */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-600" />
          <h3 className="text-sm font-black text-slate-900">지급 신청</h3>
        </div>
        <p className="text-[11px] text-slate-500">
          구매확정된 주문의 {isInf ? '수수료' : '정산액'}이 지급 가능 금액에 쌓여요. 신청하지 않은 금액은 사라지지 않고 계속 쌓여요.
          신청하면 지급 가능 금액 전액이 한 번에 신청돼요. {SCHEDULE_NOTICE}
          {data.minAmount > 0 && ` 최소 신청 금액은 ${won(data.minAmount)}${isInf ? '(원천징수 전 기준)' : ''}이에요.`}
        </p>

        {isInf && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
            <p className="text-[11px] font-bold text-blue-700">{WITHHOLDING_NOTICE}</p>
            <div className="flex justify-between"><span className="text-slate-500">총 수수료</span><b className="text-slate-800">{won(preview.gross)}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">소득세 (3%, 원 미만 절사)</span><b className="text-slate-800">−{won(preview.incomeTax)}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">지방소득세 (소득세의 10%, 원 미만 절사)</span><b className="text-slate-800">−{won(preview.localTax)}</b></div>
            <div className="flex justify-between pt-1 border-t border-slate-200"><span className="font-black text-slate-800">실지급액</span><b className="text-blue-600 text-sm">{won(preview.net)}</b></div>
          </div>
        )}

        {(s.availableOrders.length > 0 || s.availableDeductions.length > 0) && (
          <div>
            <button onClick={() => setShowOrders(o => !o)} className="text-[11px] font-black text-slate-500 flex items-center gap-1">
              신청에 들어갈 주문 {s.availableOrders.length}건{s.availableDeductions.length ? ` · 차감 ${s.availableDeductions.length}건` : ''}
              {showOrders ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {showOrders && (
              <div className="mt-2 rounded-xl bg-slate-50 p-3 text-[11px] space-y-1 max-h-64 overflow-y-auto">
                {s.availableOrders.map(o => (
                  <div key={o.id} className="flex justify-between gap-3">
                    <span className="text-slate-600 truncate">{o.productName} <span className="text-slate-400">· {dateText(o.confirmedAt)} 확정</span></span>
                    <span className="font-bold text-slate-800 shrink-0">{won(o.amount)}</span>
                  </div>
                ))}
                {s.availableDeductions.map(d => (
                  <div key={d.id} className="flex justify-between gap-3 text-red-500">
                    <span className="truncate">{d.amount < 0 ? '환원' : '차감'} · {d.reason} · {d.orderId}</span>
                    <span className="font-bold shrink-0">{d.amount < 0 ? '+' : '−'}{won(Math.abs(d.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={request}
            disabled={!canRequest || busy === 'request'}
            className="h-11 px-6 rounded-xl bg-blue-600 text-white text-sm font-black disabled:bg-slate-200 disabled:text-slate-400 flex items-center gap-1.5"
          >
            {busy === 'request' && <Loader2 className="w-4 h-4 animate-spin" />}
            지급 신청{s.available > 0 ? ` (${won(s.available)})` : ''}
          </button>
          {!hasAccount && <span className="text-xs font-bold text-amber-600">정산 정보를 먼저 등록해 주세요</span>}
          {hasAccount && s.available <= 0 && <span className="text-xs font-bold text-slate-400">지금 신청할 수 있는 금액이 없어요</span>}
          {hasAccount && belowMin && <span className="text-xs font-bold text-amber-600">최소 신청 금액 {won(data.minAmount)} 이상부터 신청할 수 있어요</span>}
        </div>
        {notice && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-xs text-emerald-700 font-bold flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>지급 신청이 완료되었어요. {SCHEDULE_NOTICE}<br />지급 예정일: {scheduleText(notice.scheduledDate)}</span>
          </div>
        )}
      </section>

      {/* 정산 정보 */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-black text-slate-900">정산 정보</h3>
          </div>
          {hasAccount && !editing && <button onClick={() => setEditing(true)} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-black text-slate-600">수정</button>}
        </div>
        {hasAccount && !editing ? (
          isInf ? (
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {(() => { const a = data.account as InfluencerPayoutAccount; return [
                ['실명', a.legalName], ['주민등록번호', a.rrnMasked], ['계좌', `${a.bankName} ${a.accountMasked}`], ['예금주', a.accountHolder],
              ]; })().map(([k, v]) => (
                <div key={k}><dt className="text-[10px] font-black text-slate-400">{k}</dt><dd className="font-bold text-slate-800 mt-0.5">{v}</dd></div>
              ))}
            </dl>
          ) : (
            <>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {(() => { const a = data.account as BrandPayoutAccount; return [
                  ['계좌', `${a.bankName} ${a.accountMasked}`], ['예금주', a.accountHolder], ['세금계산서 이메일', a.taxInvoiceEmail], ['통장 사본', a.hasBankbook ? '등록됨' : '없음'],
                ]; })().map(([k, v]) => (
                  <div key={k}><dt className="text-[10px] font-black text-slate-400">{k}</dt><dd className="font-bold text-slate-800 mt-0.5 break-all">{v}</dd></div>
                ))}
              </dl>
              {(data.account as BrandPayoutAccount).holderMismatch && (
                <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  예금주가 입점 신청서의 상호 · 대표자명과 달라 운영팀이 확인한 뒤 지급해요.
                </p>
              )}
            </>
          )
        ) : isInf ? (
          <InfluencerAccountForm banks={data.banks} current={data.account as InfluencerPayoutAccount | null}
            onSaved={() => { setEditing(false); load(); }} onCancel={hasAccount ? () => setEditing(false) : undefined} />
        ) : (
          <BrandAccountForm account={account || ''} banks={data.banks} current={data.account as BrandPayoutAccount | null} brandNames={data.brandNames}
            onSaved={() => { setEditing(false); load(); }} onCancel={hasAccount ? () => setEditing(false) : undefined} />
        )}
        <p className="text-[10px] text-slate-400 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> {isInf ? '주민등록번호 · ' : ''}계좌번호는 암호화해 저장하고 화면에는 일부만 보여요.</p>
      </section>

      {/* 지급 신청 내역 */}
      <section className="space-y-2.5">
        <h3 className="text-sm font-black text-slate-900">지급 신청 내역</h3>
        {data.requests.length === 0 ? (
          <p className="text-xs text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center">아직 지급 신청 내역이 없어요.</p>
        ) : data.requests.map(r => (
          <PayoutRequestCard key={r.id} r={r} actions={r.status === 'requested' ? (
            <button disabled={busy === r.id} onClick={() => cancel(r)} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-black text-slate-600 disabled:opacity-50">신청 취소</button>
          ) : undefined} />
        ))}
      </section>
    </div>
  );
};

export default AffiliatePayouts;
