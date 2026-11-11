import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import {
  SHIPPING_COURIERS,
  UPLOAD_DAYS,
  UPLOAD_TONE_STYLE,
  shortDate,
  uploadScheduleOf,
  type StoreRequest,
} from '../../services/affiliateStoreService';
import { formatPhone } from '../../utils/formatters';
import { copyText } from '../../utils/clipboard';

/**
 * 어필리에이트 진행 단계 — 캠페인 진행사항(CampaignProcessBoard)과 같은 모양의 한 화면.
 *
 *   1. 제품 배송                    인플루언서가 배송지를 적고, 브랜드가 보내고 송장을 입력한다
 *   2. 업로드 일정                  상품 수령 → 수령 후 10일 이내 콘텐츠 업로드 · 판매 시작
 *   3. 업로드 링크 · 파트너십 코드   인플루언서가 올린 콘텐츠 링크와 브랜디드 콘텐츠 파트너십 코드
 *
 * 브랜드(진행관리)와 인플루언서(MY 어필리에이트)가 같은 컴포넌트를 쓴다 — 같은 단계를
 * 같은 이름 · 같은 순서로 본다. 맨 위 줄은 "지금 내가 할 일"이거나 "누구를 기다리는 중인지"다.
 * 펼침은 한 번에 하나, 기본은 지금 단계.
 */

export type AffiliateStepKey = 'shipping' | 'schedule' | 'content';
type Role = 'brand' | 'influencer';

type StepState = {
  key: AffiliateStepKey;
  title: string;
  done: boolean;
  submitted: boolean;
  current: boolean;
  /** 지금 이 화면을 보는 사람이 손댈 차례. */
  action: boolean;
  /** 덜 채워진 채 넘어온 단계(링크는 있는데 파트너십 코드가 없다). */
  revision: boolean;
  /** 접힌 줄의 한 줄 설명. */
  status: string;
  /** 내 차례일 때 할 일 한 문장. */
  todo: string;
  /** 기다리는 쪽. */
  owner: Role;
  waitingNote: string;
};

export interface AffiliateStepHandlers {
  /** 브랜드: 송장 등록 · 수정. 실패하면 오류 문장을 돌려준다. */
  onShip?: (company: string, number: string) => Promise<string | void>;
  /** 인플루언서: 배송정보 입력 · 수정 창을 연다. */
  onEditShipping?: () => void;
  /** 인플루언서: 상품 수령 확인. */
  onConfirmReceived?: () => Promise<string | void>;
  /** 인플루언서: 콘텐츠 링크 · 파트너십 코드 올리기. */
  onSubmitContent?: (url: string, code: string) => Promise<string | void>;
}

const korDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/** 이 협업의 세 단계 상태. 보드(칸 배치)와 상세가 같은 계산을 쓴다. */
export function affiliateSteps(r: StoreRequest, role: Role): StepState[] {
  const st = r.shippingStatus || '';
  const legacy = !st; // 예전 흐름: 선정 즉시 링크 발급, 배송 단계 없음
  const declined = st === 'declined';
  const shipDone = legacy || st === 'shipped';
  const isInf = role === 'influencer';

  const shipping: StepState = {
    key: 'shipping',
    title: '제품 배송',
    done: shipDone,
    submitted: st === 'info_submitted' && isInf,
    current: !shipDone && !declined,
    action: !declined && ((isInf && st === 'awaiting_info') || (!isInf && st === 'info_submitted')),
    revision: false,
    owner: st === 'awaiting_info' ? 'influencer' : 'brand',
    status: declined
      ? '인플루언서가 협업을 반려했어요'
      : legacy
        ? '예전 방식 선정 · 배송 단계 없음'
        : st === 'shipped'
          ? `발송 완료${r.trackingCompany ? ` · ${r.trackingCompany} ${r.trackingNumber}` : ''}`
          : st === 'info_submitted'
            ? isInf ? '배송정보 제출 완료 · 브랜드 발송 대기' : '배송지가 들어왔어요 · 송장 입력 대기'
            : isInf ? '협찬 상품을 받을 배송정보를 입력해 주세요' : '인플루언서 배송정보 입력 대기',
    todo: isInf
      ? `협찬 상품을 받을 배송정보를 입력해 주세요. 상품 수령 후 ${UPLOAD_DAYS}일 이내에 콘텐츠를 업로드하고 판매를 시작해야 해요.`
      : '배송지를 확인하고 협찬 상품을 보낸 뒤 송장번호를 입력해 주세요.',
    waitingNote: st === 'awaiting_info'
      ? '인플루언서가 배송정보를 입력하면 배송지가 여기에 나와요.'
      : '브랜드가 송장번호를 입력하면 전용 판매 링크가 열려요.',
  };

  const received = !!r.deliveredAt;
  const scheduleDone = legacy || received || !!r.contentUrl;
  const sched = uploadScheduleOf(r);
  const schedule: StepState = {
    key: 'schedule',
    title: '업로드 일정',
    done: scheduleDone,
    submitted: false,
    current: shipDone && !scheduleDone && !declined,
    action: isInf && st === 'shipped' && !received && !r.contentUrl,
    revision: false,
    owner: 'influencer',
    status: legacy
      ? '예전 방식 선정 · 업로드 일정 없음'
      : r.contentUrl
        ? `업로드 완료${r.contentSubmittedAt ? ` · ${korDate(r.contentSubmittedAt)}` : ''}`
        : received
          ? `수령 ${korDate(r.deliveredAt)} · ${sched.label}`
          : shipDone
            ? `상품 수령 대기 · 수령 후 ${UPLOAD_DAYS}일 이내 업로드`
            : '협찬 상품이 발송되면 시작돼요',
    todo: `상품을 받으면 수령 확인을 눌러 주세요. 수령일로부터 ${UPLOAD_DAYS}일 이내에 콘텐츠를 업로드하고 판매를 시작해야 해요.`,
    waitingNote: `인플루언서가 상품을 받으면 수령일로부터 ${UPLOAD_DAYS}일 이내에 콘텐츠를 올려요. 수령 확인이 없으면 발송 5일 뒤를 수령일로 봐요.`,
  };

  const contentDone = !!r.contentUrl && !!r.partnershipCode;
  const content: StepState = {
    key: 'content',
    title: '업로드 링크 · 파트너십 코드',
    done: contentDone,
    submitted: false,
    current: shipDone && scheduleDone && !contentDone && !declined,
    action: isInf && shipDone && !declined && !contentDone,
    revision: !!r.contentUrl && !r.partnershipCode,
    owner: 'influencer',
    status: contentDone
      ? `업로드 완료 · 파트너십 코드 ${r.partnershipCode}`
      : r.contentUrl
        ? '링크 업로드 완료 · 파트너십 코드 미입력'
        : '아직 업로드 전',
    todo: r.contentUrl
      ? '파트너십 코드를 입력해 주세요. 코드가 있어야 브랜드가 이 콘텐츠를 2차 광고로 돌릴 수 있어요.'
      : '콘텐츠를 업로드한 뒤 콘텐츠 링크와 브랜디드 콘텐츠 파트너십 코드를 올려 주세요.',
    waitingNote: '인플루언서가 콘텐츠를 업로드하면 링크와 파트너십 코드가 여기에 나와요. 캠페인 이력에서 2차 광고로 돌릴 수 있어요.',
  };

  // 인플루언서는 상품 수령 확인 전에도 콘텐츠를 올릴 수 있다 — 그때는 지금 단계가 업로드 일정이고, 업로드 칸도 열려 있다.
  return [shipping, schedule, content];
}

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3">
    <p className="text-[11px] font-black text-slate-400 mb-1.5">{label}</p>
    {children}
  </div>
);

const AffiliateStepBoard: React.FC<{
  role: Role;
  request: StoreRequest;
  focusStep?: AffiliateStepKey;
} & AffiliateStepHandlers> = ({ role, request: r, focusStep, onShip, onEditShipping, onConfirmReceived, onSubmitContent }) => {
  const steps = affiliateSteps(r, role);
  const declined = r.shippingStatus === 'declined';
  const currentKey = (steps.find(s => s.current) || steps.find(s => !s.done) || steps[steps.length - 1]).key;
  const [open, setOpen] = useState<AffiliateStepKey | ''>(focusStep || currentKey);
  useEffect(() => { if (focusStep) setOpen(focusStep); }, [focusStep]);

  const [busy, setBusy] = useState<'' | 'ship' | 'receive' | 'content'>('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  // 송장
  const [shipEditing, setShipEditing] = useState(false);
  const [company, setCompany] = useState(r.trackingCompany || SHIPPING_COURIERS[0]);
  const [number, setNumber] = useState(r.trackingNumber || '');
  // 콘텐츠
  const [contentEditing, setContentEditing] = useState(!r.contentUrl);
  const [url, setUrl] = useState(r.contentUrl || '');
  const [code, setCode] = useState(r.partnershipCode || '');
  useEffect(() => { setCompany(r.trackingCompany || SHIPPING_COURIERS[0]); setNumber(r.trackingNumber || ''); }, [r.trackingCompany, r.trackingNumber]);
  useEffect(() => { setUrl(r.contentUrl || ''); setCode(r.partnershipCode || ''); setContentEditing(!r.contentUrl); }, [r.contentUrl, r.partnershipCode]);

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied(c => (c === key ? '' : c)), 1600);
    }
  };

  const run = async (kind: typeof busy, fn: () => Promise<string | void>) => {
    setBusy(kind); setError('');
    const e = await fn();
    setBusy('');
    if (e) { setError(e); return false; }
    return true;
  };

  const myAction = !declined ? steps.find(s => s.action) : undefined;
  const waiting = !declined && !myAction ? steps.find(s => s.current) : undefined;

  const copyBtn = (k: string, text: string, label: string) => (
    <button type="button" onClick={() => copy(k, text)} className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-black text-slate-600 hover:bg-slate-100" aria-label={label}>
      {copied === k ? <><Check className="w-3 h-3 text-emerald-500" /> 복사됨</> : <><Copy className="w-3 h-3" /> {label}</>}
    </button>
  );

  const addressBox = () => {
    const a = r.shipping;
    if (!a) return null;
    const line = `${a.postcode ? `(${a.postcode}) ` : ''}${a.address1} ${a.address2}`.trim();
    return (
      <div className="rounded-lg bg-emerald-50/70 border border-emerald-100 px-3 py-2.5">
        <p className="text-xs font-black text-emerald-700 break-words">{a.recipientName} · {formatPhone(a.recipientPhone)}</p>
        <p className="text-xs font-bold text-slate-600 break-words mt-0.5">{line}</p>
        {a.memo && <p className="text-[11px] font-bold text-slate-400 break-words mt-0.5">요청사항: {a.memo}</p>}
        {role === 'brand' && (
          <div className="mt-2">{copyBtn('addr', `${a.recipientName} ${a.recipientPhone} ${line}${a.memo ? ` / ${a.memo}` : ''}`, '주소 복사')}</div>
        )}
      </div>
    );
  };

  const trackingLine = () => (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs font-black text-emerald-600">{r.trackingCompany} {r.trackingNumber}</p>
      {r.trackingUrl && (
        <a href={r.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] font-black text-blue-600">
          배송 조회 <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {r.shippedAt && <span className="text-[11px] font-bold text-slate-400">발송 {korDate(r.shippedAt)}</span>}
    </div>
  );

  const renderShipping = () => {
    const st = r.shippingStatus || '';
    if (!st) return <p className="text-xs font-bold text-slate-400">예전 방식으로 선정된 협업이라 배송 단계가 없어요.</p>;
    if (st === 'declined') {
      return (
        <p className="text-xs font-bold text-slate-500">
          인플루언서가 협업을 반려했어요. 이 협업은 진행되지 않아요.
          {r.declinedReason && <span className="block text-slate-400 font-medium mt-0.5">사유: {r.declinedReason}</span>}
        </p>
      );
    }
    if (role === 'influencer') {
      if (st === 'awaiting_info') {
        return (
          <div className="space-y-2.5">
            <p className="rounded-lg bg-blue-50 px-3 py-2.5 text-xs font-bold text-blue-700 leading-relaxed">
              브랜드에 선정되었어요! 협찬 상품을 받을 배송정보를 입력하면 협업이 진행돼요.
              <span className="block text-amber-700 mt-1">상품 수령 후 {UPLOAD_DAYS}일 이내에 콘텐츠를 업로드하고 판매를 시작해야 해요.</span>
            </p>
            <button type="button" onClick={onEditShipping} className="w-full h-10 rounded-lg bg-blue-600 text-white text-xs font-black hover:bg-blue-500">배송정보 입력</button>
          </div>
        );
      }
      return (
        <div className="space-y-2.5">
          {addressBox()}
          {st === 'info_submitted' ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold text-slate-500">브랜드가 송장번호를 입력하면 전용 판매 링크가 열려요.</p>
              <button type="button" onClick={onEditShipping} className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-black text-slate-700">배송정보 수정</button>
            </div>
          ) : trackingLine()}
        </div>
      );
    }
    // 브랜드
    if (st === 'awaiting_info') return <p className="text-xs font-bold text-slate-400">인플루언서가 배송정보를 입력하면 배송지가 여기에 나와요.</p>;
    const editing = st === 'info_submitted' || shipEditing;
    return (
      <div className="space-y-2.5">
        {addressBox()}
        {editing ? (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <select value={company} onChange={e => setCompany(e.target.value)} className="h-10 px-2 rounded-lg border border-slate-200 bg-white text-xs font-bold shrink-0 max-w-[130px]">
                {SHIPPING_COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={number} onChange={e => setNumber(e.target.value)} placeholder="송장번호" inputMode="numeric" className="h-10 min-w-0 flex-1 px-3 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:border-blue-600" />
            </div>
            <div className="flex gap-1.5 justify-end">
              {st === 'shipped' && (
                <button type="button" onClick={() => { setShipEditing(false); setCompany(r.trackingCompany || SHIPPING_COURIERS[0]); setNumber(r.trackingNumber || ''); }} className="h-9 px-3 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-500">취소</button>
              )}
              <button
                type="button"
                disabled={busy === 'ship'}
                onClick={async () => {
                  if (!number.trim()) { setError('송장번호를 입력해 주세요.'); return; }
                  if (await run('ship', () => onShip ? onShip(company, number.trim()) : Promise.resolve())) setShipEditing(false);
                }}
                className="h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-50 inline-flex items-center gap-1"
              >
                {busy === 'ship' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {st === 'shipped' ? '송장 저장' : '발송 완료'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            {trackingLine()}
            <button type="button" onClick={() => setShipEditing(true)} className="shrink-0 text-[11px] font-black text-slate-400 hover:text-slate-700">송장 수정</button>
          </div>
        )}
      </div>
    );
  };

  const renderSchedule = () => {
    const sched = uploadScheduleOf(r);
    const awaitingReceipt = r.shippingStatus === 'shipped' && !r.deliveredAt && !r.contentUrl;
    return (
      <div className="space-y-2.5">
        <div className="grid grid-cols-3 gap-2">
          {[
            ['발송일', r.shippedAt ? korDate(r.shippedAt) : '-'],
            ['수령일', r.deliveredAt ? korDate(r.deliveredAt) : '-'],
            ['업로드 마감', r.uploadDeadline ? korDate(r.uploadDeadline) : '-'],
          ].map(([l, v]) => (
            <div key={l} className="rounded-xl bg-white border border-slate-100 px-3 py-2">
              <p className="text-[10px] font-black text-slate-400">{l}</p>
              <p className="text-sm font-black text-slate-900">{v}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-black ${UPLOAD_TONE_STYLE[sched.tone]}`}>{sched.label}</span>
          {r.contentSubmittedAt && <span className="text-[11px] font-bold text-slate-400">업로드 {shortDate(r.contentSubmittedAt)}</span>}
        </div>
        <p className="text-[11px] font-bold text-slate-400 leading-relaxed">
          상품 수령 후 {UPLOAD_DAYS}일 이내에 콘텐츠를 업로드하고 판매를 시작해요. 수령 확인이 없으면 송장 조회의 배송 완료나 발송 5일 뒤를 수령일로 봐요.
        </p>
        {role === 'influencer' && awaitingReceipt && (
          <button
            type="button"
            disabled={busy === 'receive'}
            onClick={() => { void run('receive', () => onConfirmReceived ? onConfirmReceived() : Promise.resolve()); }}
            className="w-full h-10 rounded-lg bg-blue-600 text-white text-xs font-black disabled:opacity-50 inline-flex items-center justify-center gap-1"
          >
            {busy === 'receive' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            상품 수령 확인
          </button>
        )}
      </div>
    );
  };

  const renderContent = () => {
    const shipDone = !r.shippingStatus || r.shippingStatus === 'shipped';
    const view = (
      <div className="space-y-2">
        <Section label="업로드 링크">
          {r.contentUrl ? (
            <a href={r.contentUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-bold text-blue-600 min-w-0">
              <ExternalLink className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{r.contentUrl}</span>
            </a>
          ) : <p className="text-xs font-bold text-slate-400">아직 업로드 전</p>}
        </Section>
        <Section label="파트너십 코드">
          {r.partnershipCode ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs text-slate-800 truncate flex-1">{r.partnershipCode}</span>
              {copyBtn('code', r.partnershipCode, '코드 복사')}
            </div>
          ) : <p className={`text-xs font-bold ${r.contentUrl ? 'text-amber-600' : 'text-slate-400'}`}>{r.contentUrl ? '파트너십 코드 미입력' : '아직 업로드 전'}</p>}
        </Section>
      </div>
    );
    if (role === 'brand') {
      return (
        <div className="space-y-2">
          {view}
          {r.contentUrl && <p className="text-[11px] font-bold text-slate-400">파트너십 코드가 있는 게시물은 캠페인 이력에서 2차 광고(메타 부스팅)로 돌릴 수 있어요.</p>}
        </div>
      );
    }
    if (!shipDone) return <p className="text-xs font-bold text-slate-400">협찬 상품이 발송되면 콘텐츠 링크와 파트너십 코드를 올릴 수 있어요.</p>;
    if (!contentEditing) {
      return (
        <div className="space-y-2">
          {view}
          <div className="flex justify-end">
            <button type="button" onClick={() => setContentEditing(true)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-black text-slate-700">수정</button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="업로드한 콘텐츠 링크 (https://www.instagram.com/reel/...)" maxLength={500} className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:border-blue-600" />
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="브랜디드 콘텐츠 파트너십 코드 (광고 코드)" maxLength={300} className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono focus:outline-none focus:border-blue-600" />
        <p className="text-[11px] text-slate-400">파트너십 코드를 올리면 브랜드가 이 콘텐츠를 2차 광고로 돌릴 수 있어요. 인스타그램 게시물 › 파트너십 광고 코드에서 복사해 주세요.</p>
        <div className="flex justify-end gap-1.5">
          {r.contentUrl && (
            <button type="button" onClick={() => { setContentEditing(false); setUrl(r.contentUrl || ''); setCode(r.partnershipCode || ''); setError(''); }} className="h-9 px-3 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-500">취소</button>
          )}
          <button
            type="button"
            disabled={busy === 'content'}
            onClick={async () => {
              if (!/^https:\/\/\S+\.\S+/i.test(url.trim())) { setError('콘텐츠 링크는 https:// 로 시작하는 주소로 입력해 주세요.'); return; }
              if (await run('content', () => onSubmitContent ? onSubmitContent(url.trim(), code.trim()) : Promise.resolve())) setContentEditing(false);
            }}
            className="h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-black disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy === 'content' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {r.contentUrl ? '저장' : '업로드 링크 올리기'}
          </button>
        </div>
      </div>
    );
  };

  const renderStep = (k: AffiliateStepKey) => (k === 'shipping' ? renderShipping() : k === 'schedule' ? renderSchedule() : renderContent());

  const banner = () => {
    if (declined) {
      return (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <p className="text-[11px] font-black text-slate-500">반려된 협업 · 진행되지 않아요</p>
          {r.declinedReason && <p className="text-[11px] font-bold text-slate-400 mt-0.5">사유: {r.declinedReason}</p>}
        </div>
      );
    }
    if (myAction) {
      const amber = myAction.revision;
      return (
        <div className={`px-4 py-3.5 border-b ${amber ? 'bg-amber-50 border-amber-100' : 'bg-blue-50 border-blue-100'}`}>
          <div className="flex items-start gap-3">
            <span className="relative flex h-2.5 w-2.5 mt-1 flex-shrink-0">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${amber ? 'bg-amber-400' : 'bg-blue-400'}`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${amber ? 'bg-amber-500' : 'bg-blue-600'}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-black ${amber ? 'text-amber-700' : 'text-blue-700'}`}>{amber ? '수정 요청' : '진행 요청'} · {myAction.title}</p>
              <p className="text-xs font-bold text-slate-700 mt-0.5 leading-relaxed break-keep">{myAction.todo}</p>
            </div>
            {open !== myAction.key && (
              <button
                type="button"
                onClick={() => setOpen(myAction.key)}
                className={`px-3 py-2 rounded-lg text-[11px] font-black text-white flex-shrink-0 transition-colors ${amber ? 'bg-amber-500 hover:bg-amber-400' : 'bg-blue-600 hover:bg-blue-500'}`}
              >
                바로 가기
              </button>
            )}
          </div>
        </div>
      );
    }
    if (waiting) {
      return (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80">
          <p className="text-[11px] font-black text-slate-500">지금은 {waiting.owner === 'brand' ? '브랜드' : '인플루언서'}를 기다리는 중입니다 · {waiting.title}</p>
          <p className="text-[11px] font-bold text-slate-400 mt-0.5 break-keep">{waiting.waitingNote}</p>
        </div>
      );
    }
    return (
      <div className="px-4 py-3 border-b border-emerald-100 bg-emerald-50/70">
        <p className="text-[11px] font-black text-emerald-700">모든 단계가 끝났습니다 · 더 입력할 것이 없습니다</p>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {banner()}
      {steps.map((s, i) => {
        const isOpen = open === s.key;
        const active = s.action || s.done || s.submitted || s.current || s.revision;
        return (
          <div key={s.key} className={i === 0 ? '' : 'border-t border-slate-100'}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? '' : s.key)}
              aria-expanded={isOpen}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                s.action
                  ? s.revision ? 'bg-amber-50 hover:bg-amber-100/70' : 'bg-blue-50 hover:bg-blue-100/70'
                  : isOpen
                    ? 'bg-slate-50'
                    : s.done
                      ? 'bg-emerald-50/60 hover:bg-emerald-50'
                      : s.submitted
                        ? 'bg-emerald-50/40 hover:bg-emerald-50'
                        : s.revision
                          ? 'bg-amber-50/50 hover:bg-amber-50'
                          : 'hover:bg-slate-50/60'
              }`}
            >
              <span className="relative flex-shrink-0">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                    s.action
                      ? s.revision ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
                      : s.done
                        ? 'bg-emerald-500 text-white'
                        : s.submitted
                          ? 'bg-emerald-100 text-emerald-600'
                          : s.revision
                            ? 'bg-amber-100 text-amber-700'
                            : s.current
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {s.done || s.submitted ? '✓' : i + 1}
                </span>
                {s.action && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-70 ${s.revision ? 'bg-amber-400' : 'bg-blue-400'}`} />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ring-2 ring-white ${s.revision ? 'bg-amber-500' : 'bg-blue-600'}`} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-sm font-black truncate ${active ? 'text-slate-900' : 'text-slate-400'}`}>{s.title}</span>
                  {s.action && (
                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black flex-shrink-0 ${s.revision ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'}`}>
                      {s.revision ? '수정 요청' : '진행 요청'}
                    </span>
                  )}
                </span>
                <span
                  className={`block text-[11px] font-bold truncate ${
                    s.action
                      ? s.revision ? 'text-amber-700' : 'text-blue-700'
                      : s.done || s.submitted
                        ? 'text-emerald-600'
                        : s.revision
                          ? 'text-amber-600'
                          : 'text-slate-400'
                  }`}
                >
                  {s.status}
                </span>
              </span>
              <span className={`text-slate-300 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {isOpen && <div className="px-4 pt-2 pb-4">{renderStep(s.key)}</div>}
          </div>
        );
      })}
      {error && <p className="px-4 pb-3 text-[11px] font-bold text-red-500">{error}</p>}
    </div>
  );
};

export default AffiliateStepBoard;
