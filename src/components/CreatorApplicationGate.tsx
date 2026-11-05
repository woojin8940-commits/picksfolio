import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Sparkles, XCircle } from 'lucide-react';
import {
  affiliateStoreService,
  type CreatorAccess,
  type CreatorApplication,
} from '../services/affiliateStoreService';

/**
 * 크리에이터 지원 카드.
 *
 * 새로 들어온 인플루언서는 자동 디엠 · 어필리에이트를 쓰기 전에 크리에이터 지원서를 내고
 * 운영자 승인을 받아야 한다(기존 계정은 자동 승인). 이 카드는 승인 상태를 스스로 읽어
 * 지원서 · 심사 중 · 반려(재지원) 화면을 그리고, 승인돼 있으면 children 을 그대로 보여 준다.
 */

interface Props {
  /** 막혀 있는 기능 이름(안내 문구에 쓴다). 예: '어필리에이트', '자동 디엠' */
  feature: string;
  /** 승인된 사람에게 보여 줄 화면. 없으면 승인 시 아무것도 그리지 않는다. */
  children?: React.ReactNode;
  /** 승인 상태를 읽었을 때 알린다. */
  onAccess?: (access: CreatorAccess) => void;
}

const CreatorApplicationGate: React.FC<Props> = ({ feature, children, onAccess }) => {
  const [access, setAccess] = useState<CreatorAccess | null>(null);
  const [application, setApplication] = useState<CreatorApplication | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const load = useCallback(async () => {
    const res = await affiliateStoreService.creatorAccess();
    if (res.error || !res.access) { setLoadError(res.error || '승인 상태를 확인하지 못했어요.'); return; }
    setLoadError('');
    setAccess(res.access);
    setApplication(res.application);
    onAccess?.(res.access);
    const a = res.application;
    if (a) {
      setName(a.name); setContact(a.contact); setInstagramUrl(a.instagramUrl);
    }
  }, [onAccess]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!consent) { setSendError('개인정보 수집·이용에 동의해 주세요.'); return; }
    setSending(true);
    setSendError('');
    const res = await affiliateStoreService.applyCreator({
      name: name.trim(),
      contact: contact.trim(),
      instagramUrl: instagramUrl.trim(),
      privacyConsent: true,
    });
    setSending(false);
    if (res.error) { setSendError(res.error); return; }
    setEditing(false);
    load();
  };

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
        <p className="text-sm font-bold text-red-500">{loadError}</p>
        <button onClick={load} className="mt-3 h-9 px-4 rounded-lg bg-slate-100 text-xs font-black text-slate-600">다시 시도</button>
      </div>
    );
  }
  if (!access) {
    return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }
  if (access.approved) return <>{children}</>;

  const showForm = access.status === 'none' || editing;

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 md:p-8 max-w-2xl">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-500 text-white flex items-center justify-center shrink-0 shadow-md">
          {access.status === 'pending' && !editing ? <Clock className="w-5 h-5" /> : access.status === 'rejected' && !editing ? <XCircle className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black tracking-[0.2em] text-blue-500 uppercase">Creator</p>
          {access.status === 'pending' && !editing ? (
            <>
              <h3 className="text-base md:text-lg font-black text-slate-900">크리에이터 지원서를 검토하고 있어요</h3>
              <p className="text-xs md:text-sm text-slate-500 mt-1 leading-relaxed">
                담당자가 채널을 확인한 뒤 승인해 드려요. 승인되면 {feature}를 바로 사용할 수 있습니다.
              </p>
            </>
          ) : access.status === 'rejected' && !editing ? (
            <>
              <h3 className="text-base md:text-lg font-black text-slate-900">크리에이터 지원이 반려되었어요</h3>
              {access.rejectReason && <p className="text-xs md:text-sm text-rose-600 font-bold mt-1">사유: {access.rejectReason}</p>}
              <p className="text-xs md:text-sm text-slate-500 mt-1">내용을 보완해 다시 지원할 수 있어요.</p>
            </>
          ) : (
            <>
              <h3 className="text-base md:text-lg font-black text-slate-900">{feature}는 크리에이터 승인 후 사용할 수 있어요</h3>
              <p className="text-xs md:text-sm text-slate-500 mt-1 leading-relaxed">
                크리에이터 지원서를 내면 담당자가 확인 후 승인해 드려요. 승인되면 자동 디엠과 어필리에이트를 함께 사용할 수 있습니다.
              </p>
            </>
          )}
        </div>
      </div>

      {access.status === 'pending' && !editing && application && (
        <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
          <p><span className="font-black text-slate-800">이름</span> {application.name}</p>
          <p><span className="font-black text-slate-800">연락처</span> {application.contact}</p>
          <p><span className="font-black text-slate-800">인스타그램</span> {application.instagramUrl}</p>
          <button onClick={() => setEditing(true)} className="mt-2 text-[11px] font-black text-blue-600">지원서 수정</button>
        </div>
      )}
      {access.status === 'rejected' && !editing && (
        <button onClick={() => setEditing(true)} className="mt-5 h-11 px-5 rounded-xl bg-blue-600 text-white text-sm font-black">다시 지원하기</button>
      )}

      {showForm && (
        <div className="mt-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-black text-slate-700">이름 *</span>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={50} className="mt-1 w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-600" placeholder="홍길동" />
            </label>
            <label className="block">
              <span className="text-xs font-black text-slate-700">연락처 *</span>
              <input value={contact} onChange={e => setContact(e.target.value)} maxLength={20} inputMode="tel" className="mt-1 w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-600" placeholder="010-0000-0000" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-black text-slate-700">인스타그램 프로필 링크 *</span>
            <input value={instagramUrl} onChange={e => setInstagramUrl(e.target.value.trim())} maxLength={300} className="mt-1 w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-600" placeholder="https://instagram.com/내계정" />
          </label>
          <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-100 p-3.5 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
            <span className="text-xs text-slate-600 leading-relaxed">
              <b className="text-slate-900">(필수) 개인정보 수집·이용 동의</b><br />
              수집 항목: 이름, 연락처, 인스타그램 프로필 링크 · 목적: 크리에이터 지원 검토 및 연락 · 보유 기간: 회원 탈퇴 또는 지원 철회 시까지.
              동의하지 않으면 지원할 수 없습니다. 자세한 내용은 <a href="/privacy" target="_blank" rel="noreferrer" className="text-blue-600 font-bold underline">개인정보처리방침</a>을 확인해 주세요.
            </span>
          </label>
          {sendError && <p className="text-xs font-bold text-red-500">{sendError}</p>}
          <div className="flex gap-2">
            {editing && (
              <button onClick={() => setEditing(false)} className="h-12 px-5 rounded-xl border border-slate-200 text-sm font-black text-slate-600">취소</button>
            )}
            <button onClick={submit} disabled={sending || !consent} className="flex-1 h-12 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50 flex items-center justify-center gap-2">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              크리에이터 지원하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreatorApplicationGate;
