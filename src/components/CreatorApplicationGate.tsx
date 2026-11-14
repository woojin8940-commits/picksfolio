import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Instagram, Loader2, Sparkles, XCircle } from 'lucide-react';
import {
  affiliateStoreService,
  type CreatorAccess,
  type CreatorApplication,
} from '../services/affiliateStoreService';
import DirectDealAgreement from './affiliateStore/DirectDealAgreement';
import { formatNumberWithCommas } from '../utils/formatters';
import { apiService } from '../services/apiService';
import { CREATOR_CATEGORIES, joinCategoryList, parseCategoryList } from '../utils/creatorCategories';

/**
 * 크리에이터 지원 카드.
 *
 * 새로 들어온 인플루언서는 자동 디엠 · 어필리에이트를 쓰기 전에 크리에이터 지원서를 내고
 * 운영자 승인을 받아야 한다(기존 계정은 자동 승인). 이 카드는 승인 상태를 스스로 읽어
 * 지원서 · 심사 중 · 반려(재지원) 화면을 그리고, 승인돼 있으면 children 을 그대로 보여 준다.
 *
 * 인스타그램은 주소를 적지 않고 지원할 때 이 자리에서 연동한다. 담당자가 그 계정의
 * 프로필과 최근 릴스 3편을 보고 심사한다. 연동은 자동 디엠 · 인사이트 · 브랜드 매칭받기가
 * 함께 쓰는 하나라서, 승인되는 순간 자동 디엠도 이미 연동된 상태로 열린다. 연동은
 * 메타로 나갔다 돌아오는 흐름이라 작성 중인 값을 잠깐 저장해 두었다가 돌아오면 되살린다.
 */

/** 연동하러 나갈 때 작성 중인 지원서를 남겨 두는 자리. */
const DRAFT_KEY = 'picks_creator_apply_draft_v1';
/** 연동 서명의 유효 시간과 맞춘다. 이보다 오래된 임시 저장은 다른 방문으로 본다. */
const DRAFT_TTL_MS = 30 * 60 * 1000;
/** 이 카드에서 시작한 연동이라는 표시. App 이 이 값을 보고 시작한 화면으로 돌려보낸다. */
export const CREATOR_APPLY_RETURN_FLAG = 'creator_apply';

const IG_ERROR_TEXT: Record<string, string> = {
  state_browser_mismatch: '연동하기를 누른 브라우저(또는 앱)와 다른 곳에서 동의가 끝나 연동하지 않았어요. 연동하기를 누른 곳에서 다시 시도해 주세요.',
  not_professional_account: '개인 계정이나 비공개 계정은 연동할 수 없어요. 인스타그램 앱의 설정 → 계정 유형 및 도구에서 프로페셔널 계정(크리에이터 또는 비즈니스)으로 전환한 뒤 다시 연동해 주세요.',
  missing_permissions: '인스타그램 동의 화면에서 일부 권한이 꺼진 채로 진행돼 연동하지 않았어요. 다시 연동하면서 모든 항목을 허용해 주세요.',
};

interface IgState { status: 'loading' | 'linked' | 'reauth' | 'none' | 'error'; handle: string; followers: number }

interface Draft { name: string; contact: string; shortPrice: string; categories?: string[]; editing: boolean; at: number }

interface Props {
  /** 막혀 있는 기능 이름(안내 문구에 쓴다). 예: '어필리에이트', '자동 디엠' */
  feature: string;
  /** 로그인한 사람의 아이디. 인스타그램 연동을 시작하고 연동 상태를 읽는 데 쓴다. */
  userName: string;
  /** 연동을 마치고 돌아올 화면. App 이 이 값으로 같은 화면을 다시 연다. */
  returnView: 'dm-automation' | 'affiliate-store';
  /** 승인된 사람에게 보여 줄 화면. 없으면 승인 시 아무것도 그리지 않는다. */
  children?: React.ReactNode;
  /** 승인 상태를 읽었을 때 알린다. */
  onAccess?: (access: CreatorAccess) => void;
}

const CreatorApplicationGate: React.FC<Props> = ({ feature, userName, returnView, children, onAccess }) => {
  const [access, setAccess] = useState<CreatorAccess | null>(null);
  const [application, setApplication] = useState<CreatorApplication | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [ig, setIg] = useState<IgState>({ status: 'loading', handle: '', followers: 0 });
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  // 릴스 광고 단가(원). 입력 중에는 숫자만 남겨 둔다.
  const [shortPrice, setShortPrice] = useState('');
  // 활동 카테고리. 여러 개 고를 수 있다(최대 5개).
  const [categories, setCategories] = useState<string[]>([]);
  const toggleCategory = (c: string) =>
    setCategories(prev => (prev.includes(c) ? prev.filter(x => x !== c) : prev.length >= 5 ? prev : [...prev, c]));
  const [consent, setConsent] = useState(false);
  const [directDeal, setDirectDeal] = useState(false);
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
      setName(a.name); setContact(a.contact);
      setShortPrice(a.shortPrice ? String(a.shortPrice) : '');
      setCategories(parseCategoryList(a.categories));
    }
    // 연동하러 나갔다 돌아왔다면 작성 중이던 값이 더 최신이다.
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        sessionStorage.removeItem(DRAFT_KEY);
        const d = JSON.parse(raw) as Draft;
        if (d && Date.now() - Number(d.at || 0) < DRAFT_TTL_MS) {
          setName(d.name || ''); setContact(d.contact || ''); setShortPrice(d.shortPrice || '');
          if (Array.isArray(d.categories)) setCategories(d.categories);
          if (d.editing) setEditing(true);
        }
      }
    } catch {
      // 임시 저장을 못 읽으면 처음부터 다시 적으면 된다.
    }
  }, [onAccess]);

  useEffect(() => { load(); }, [load]);

  // 연동 상태는 자동 디엠 · 인사이트 · 브랜드 매칭받기와 함께 쓰는 하나다.
  const loadIg = useCallback(async () => {
    if (!userName) { setIg({ status: 'none', handle: '', followers: 0 }); return; }
    const res = await apiService.getCreatorChannel(userName);
    if (res?.error) {
      setIg(prev => (prev.status === 'linked' ? prev : { status: 'error', handle: '', followers: 0 }));
      return;
    }
    const c = res?.channel || {};
    const handle = String(res?.igUsername || c.instagramHandle || '').replace(/^@/, '');
    const followers = Number(c.followers || 0);
    if (res?.metaLinked) setIg({ status: 'linked', handle, followers });
    else if (res?.needsReauth) setIg({ status: 'reauth', handle, followers });
    else setIg({ status: 'none', handle: '', followers: 0 });
  }, [userName]);

  useEffect(() => { loadIg(); }, [loadIg]);

  // 이 카드에서 시작한 연동의 결과. 자동 디엠 화면은 자기 배너로 결과를 알리고 주소도
  // 스스로 정리하므로, 여기서는 표시만 걷고 실패 사유는 카드 안에도 적는다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get(CREATOR_APPLY_RETURN_FLAG)) return;
    const igError = params.get('ig_error');
    if (igError) setLinkError(IG_ERROR_TEXT[igError] || '인스타그램 연동을 마치지 못했어요. 다시 연동해 주세요.');
    params.delete(CREATOR_APPLY_RETURN_FLAG);
    params.delete('from');
    if (returnView !== 'dm-automation') {
      ['ig_connected', 'ig_error', 'ig_metrics', 'ig_handle', 'ig_followers', 'ig_following', 'ig_views'].forEach(k => params.delete(k));
    }
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  }, [returnView]);

  const connect = async () => {
    setLinking(true);
    setLinkError('');
    try {
      const draft: Draft = { name, contact, shortPrice, categories, editing, at: Date.now() };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // 임시 저장이 막혀도 연동은 진행한다. 돌아와서 다시 적으면 된다.
    }
    const returnTo = `${window.location.pathname}?${CREATOR_APPLY_RETURN_FLAG}=1&from=${returnView}`;
    const res = await apiService.instagramConnectUrl(userName, returnTo);
    if (!res.url) {
      setLinking(false);
      setLinkError(res.error || '연동을 시작하지 못했습니다.');
      return;
    }
    window.location.href = res.url;
  };

  const igLinked = ig.status === 'linked';

  const submit = async () => {
    if (!igLinked) { setSendError('인스타그램 계정을 먼저 연동해 주세요.'); return; }
    if (categories.length === 0) { setSendError('활동 카테고리를 하나 이상 골라 주세요.'); return; }
    if (!Number(shortPrice)) { setSendError('릴스 광고 단가를 입력해 주세요.'); return; }
    if (!consent) { setSendError('개인정보 수집·이용에 동의해 주세요.'); return; }
    if (!directDeal) { setSendError('직거래 금지 안내에 동의해 주세요.'); return; }
    setSending(true);
    setSendError('');
    const res = await affiliateStoreService.applyCreator({
      name: name.trim(),
      contact: contact.trim(),
      shortPrice: Number(shortPrice),
      categories: joinCategoryList(categories),
      privacyConsent: true,
      directDealAgreement: true,
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
                인스타그램 계정을 연동하고 릴스 광고 단가를 적어 지원하면, 담당자가 연동한 계정의 프로필과 최근 릴스를 확인한 뒤 승인해 드려요.
                승인되면 결제 없이 자동 디엠과 어필리에이트를 함께 사용할 수 있어요. 브랜드 매칭받기는 따로 등록하지 않아도 되고, 여기서 연동한 계정이 자동 디엠에도 그대로 연동됩니다.
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
          <p><span className="font-black text-slate-800">카테고리</span> {application.categories || '미선택'}</p>
          <p><span className="font-black text-slate-800">릴스 광고 단가</span> {application.shortPrice ? `${formatNumberWithCommas(application.shortPrice)}원` : '미입력'}</p>
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
          <div className="block">
            <span className="text-xs font-black text-slate-700">인스타그램 계정 연동 *</span>
            {ig.status === 'loading' ? (
              <div className="mt-1 h-16 rounded-xl border border-slate-200 flex items-center justify-center gap-2 text-xs font-bold text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> 연동 상태를 확인하고 있어요
              </div>
            ) : igLinked ? (
              <div className="mt-1 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 flex items-center justify-center shrink-0">
                  <Instagram className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 truncate">{ig.handle ? `@${ig.handle}` : '연동된 계정'}</p>
                  <p className="text-[11px] text-slate-500 font-bold">
                    {ig.followers > 0 ? `팔로워 ${ig.followers.toLocaleString('ko-KR')}명 · ` : ''}이 계정으로 지원돼요 · 자동 디엠에도 함께 연동돼요
                  </p>
                </div>
                <span className="px-2 py-1 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-700 shrink-0">연동됨</span>
              </div>
            ) : (
              <div className="mt-1 rounded-xl border border-slate-200 p-3.5">
                <p className="text-xs text-slate-600 leading-relaxed">
                  {ig.status === 'reauth'
                    ? `${ig.handle ? `@${ig.handle} ` : ''}계정의 연동이 만료되었어요. 다시 연동해 주세요.`
                    : ig.status === 'error'
                      ? '연동 상태를 확인하지 못했어요. 다시 연동하거나 잠시 후 다시 시도해 주세요.'
                      : '지원할 인스타그램 계정을 연동해 주세요. 프로페셔널 계정(크리에이터 또는 비즈니스)이어야 해요.'}
                </p>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  담당자는 이 계정의 프로필과 최근 릴스를 보고 심사해요. 승인되면 자동 디엠도 따로 연동할 필요 없이 바로 사용할 수 있어요.
                </p>
                <button
                  type="button"
                  onClick={connect}
                  disabled={linking}
                  className="mt-3 h-10 px-4 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white text-xs font-black disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
                  {ig.status === 'reauth' ? '인스타그램 다시 연동하기' : '인스타그램 연동하기'}
                </button>
              </div>
            )}
            {linkError && <p className="mt-1.5 text-xs font-bold text-red-500">{linkError}</p>}
          </div>
          <div className="block">
            <span className="text-xs font-black text-slate-700">활동 카테고리 * <span className="font-bold text-slate-400">(최대 5개)</span></span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CREATOR_CATEGORIES.map(c => {
                const on = categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCategory(c)}
                    aria-pressed={on}
                    className={`h-8 px-3 rounded-full text-xs font-black border transition-colors ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <span className="mt-1 block text-[11px] text-slate-400">주로 올리는 콘텐츠 분야를 골라 주세요. 담당자가 맞는 브랜드 캠페인을 찾을 때 씁니다.</span>
          </div>
          <label className="block">
            <span className="text-xs font-black text-slate-700">릴스 광고 단가 *</span>
            <div className="mt-1 relative">
              <input
                value={shortPrice ? formatNumberWithCommas(shortPrice) : ''}
                onChange={e => setShortPrice(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                inputMode="numeric"
                className="w-full h-11 pl-3.5 pr-10 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-600"
                placeholder="500,000"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">원</span>
            </div>
            <span className="mt-1 block text-[11px] text-slate-400">릴스 1편을 제작해 올리는 광고 단가예요. 담당자가 캠페인을 제안할 때 참고합니다.</span>
          </label>
          <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-100 p-3.5 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0" />
            <span className="text-xs text-slate-600 leading-relaxed">
              <b className="text-slate-900">(필수) 개인정보 수집·이용 동의</b><br />
              수집 항목: 이름, 연락처, 연동한 인스타그램 계정, 활동 카테고리, 릴스 광고 단가 · 목적: 크리에이터 지원 검토 및 연락 · 보유 기간: 회원 탈퇴 또는 지원 철회 시까지.
              동의하지 않으면 지원할 수 없습니다. 자세한 내용은 <a href="/privacy" target="_blank" rel="noreferrer" className="text-blue-600 font-bold underline">개인정보처리방침</a>을 확인해 주세요.
            </span>
          </label>
          <DirectDealAgreement checked={directDeal} onChange={setDirectDeal} />
          {sendError && <p className="text-xs font-bold text-red-500">{sendError}</p>}
          <div className="flex gap-2">
            {editing && (
              <button onClick={() => setEditing(false)} className="h-12 px-5 rounded-xl border border-slate-200 text-sm font-black text-slate-600">취소</button>
            )}
            <button onClick={submit} disabled={sending || !igLinked || !consent || !directDeal || !Number(shortPrice) || categories.length === 0} className="flex-1 h-12 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50 flex items-center justify-center gap-2">
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
