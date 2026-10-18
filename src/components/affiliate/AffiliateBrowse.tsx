import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  affiliateService,
  won,
  PARTICIPATION_STATUS_LABEL,
  CHANNEL_LINK_LABEL,
  type ChannelLinkType,
  type AffiliateCampaign,
  type AffiliateEligibility,
  type AffiliateProduct,
  type ParticipationStatus,
} from '../../services/affiliateService';
import { useCloseOnBack } from '../../hooks/useCloseOnBack';
import Toast from '../Toast';
import { externalLinkProps } from '../../utils/externalLink';
import { digitsOnly, formatContact, formatCountKo } from '../../utils/formatters';
import CollabMatchRegister from '../CollabMatchRegister';

/**
 * 캠페인 찾기 › 어필리에이트.
 *
 * 판매 연동형 캠페인은 "캠페인 한 장"이 아니라 "상품 여러 개"로 고른다 — 인플루언서가
 * 실제로 비교하는 것은 어떤 상품을 얼마에 팔고 몇 %를 받는가이기 때문이다. 그래서
 * 목록은 캠페인마다 상품을 펼쳐 상품 카드로 깔고, 카드를 누르면 그 상품을 크게 보여
 * 주는 상세 페이지(제품 협찬 상세와 같은 모양)가 열린다. 참여는 캠페인 단위다.
 *
 * 수수료율은 인플루언서 몫(creatorRate)만 보인다. 브랜드가 내는 총 수수료율과 플랫폼
 * 몫은 이 응답에 실리지 않는다.
 *
 * 참여 방식은 둘이다. 승인제(approval)는 브랜드가 신청을 보고 승인해야 링크가 나오고,
 * 즉시 참여(open)는 신청과 동시에 링크가 나온다. 링크는 협업 캠페인 › 어필리에이트
 * 탭에서 확인한다 — 여기는 찾고 신청하는 자리만 한다.
 *
 * 신청은 브랜드 매칭받기에 등록한(인스타그램을 연동한) 인플루언서만 할 수 있다.
 * 신청하면 연동한 인스타 프로필과 신청서에 적은 성함 · 연락처가 브랜드에게 간다.
 * 등록하지 않은 사람은 신청 시트 안에서 바로 매칭받기 등록을 시작할 수 있다.
 */

interface AffiliateBrowseProps {
  /** 로그인한 인플루언서 계정. 신청 시트의 매칭받기 등록에 쓴다. */
  userName: string;
  /** 캠페인 찾기 화면의 카테고리 칩 값. 빈 문자열이면 전체. */
  category: string;
  /** 검색어(디바운스된 값). */
  q: string;
  /** 카테고리 키 → 표시 이름. */
  categoryLabels: Record<string, string>;
  /** 목록 개수를 바깥 칩 줄 끝 "N개"에 올린다. */
  onCount?: (count: number) => void;
  /** 상세가 열리고 닫힐 때. 바깥 화면은 열려 있는 동안 제목 · 검색 · 칩 줄을 숨긴다. */
  onDetailChange?: (open: boolean) => void;
}

type ProductCard = { campaign: AffiliateCampaign; product: AffiliateProduct };

/** 다시 신청할 수 있는 상태. 취소한 참여는 다시 신청할 수 있다. */
const canApply = (status?: ParticipationStatus | null) => !status || status === 'cancelled';

const statusBadgeCls = (status: ParticipationStatus): string => {
  if (status === 'approved') return 'bg-emerald-500 text-white';
  if (status === 'pending') return 'bg-amber-500 text-white';
  return 'bg-slate-500 text-white';
};

const formatDate = (value: string) => {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const AffiliateBrowse: React.FC<AffiliateBrowseProps> = ({ userName, category, q, categoryLabels, onCount, onDetailChange }) => {
  const [campaigns, setCampaigns] = useState<AffiliateCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selectedId, setSelectedId] = useState('');
  /** 상세에서 크게 보여 줄 상품. 목록에서 누른 카드의 상품으로 시작한다. */
  const [selectedProductId, setSelectedProductId] = useState('');
  const [showApplySheet, setShowApplySheet] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');
  const [applying, setApplying] = useState(false);
  /** 신청 자격. 시트를 열 때 읽는다(null = 읽는 중). */
  const [eligibility, setEligibility] = useState<AffiliateEligibility | null>(null);
  const [eligibilityError, setEligibilityError] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantContact, setApplicantContact] = useState('');
  const [consent, setConsent] = useState(false);
  /** 인스타그램 말고 다른 채널 링크(선택). */
  const [channelLinks, setChannelLinks] = useState<Record<ChannelLinkType, string>>({ tiktok: '', youtube: '', other: '' });
  /** 방금 신청한 결과 안내. 승인제/즉시 참여에 따라 문장이 다르다. */
  const [applyResult, setApplyResult] = useState<'pending' | 'approved' | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const close = useCallback(() => {
    setSelectedId('');
    setSelectedProductId('');
    setShowApplySheet(false);
    setMessage('');
    setApplyResult(null);
  }, []);
  useCloseOnBack(!!selectedId, close);
  useCloseOnBack(!!selectedId && showApplySheet, () => setShowApplySheet(false));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const res = await affiliateService.browseCampaigns({ category: category || undefined, q: q || undefined });
    if (res.error) {
      setLoadError(res.error);
      setCampaigns([]);
    } else {
      setCampaigns(Array.isArray(res.campaigns) ? res.campaigns : []);
    }
    setLoading(false);
  }, [category, q]);

  useEffect(() => { void load(); }, [load]);

  const loadEligibility = useCallback(async () => {
    setEligibilityError('');
    const res = await affiliateService.eligibility();
    if (res.error) {
      setEligibilityError(res.error);
      return;
    }
    setEligibility(res);
    // 매칭받기 등록서에 적어 둔 값으로 채운다. 이미 고쳐 적은 값은 덮지 않는다.
    setApplicantName(prev => prev || res.name || '');
    setApplicantContact(prev => prev || formatContact(res.contact || ''));
    setChannelLinks(prev => {
      const next = { ...prev };
      for (const l of res.links || []) if (!next[l.type]) next[l.type] = l.url;
      return next;
    });
  }, []);

  useEffect(() => {
    if (showApplySheet) void loadEligibility();
  }, [showApplySheet, loadEligibility]);

  /** 캠페인마다 활성 상품을 펼친 카드 목록. */
  const cards = useMemo<ProductCard[]>(
    () =>
      campaigns.flatMap(c =>
        (c.products || []).filter(p => p.active !== false).map(product => ({ campaign: c, product })),
      ),
    [campaigns],
  );

  useEffect(() => { onCount?.(cards.length); }, [cards.length, onCount]);

  const selected = campaigns.find(c => c.id === selectedId) || null;

  const detailOpen = !!selected;
  useEffect(() => {
    onDetailChange?.(detailOpen);
    return () => onDetailChange?.(false);
  }, [detailOpen, onDetailChange]);
  // 목록 아래쪽 카드를 눌러도 상세는 맨 위(대표 이미지)부터 보이게 한다.
  useEffect(() => {
    if (selectedId) detailRef.current?.scrollIntoView({ block: 'start' });
  }, [selectedId]);

  const contactDigits = digitsOnly(applicantContact);
  const formReady = !!applicantName.trim() && contactDigits.length >= 9 && consent;

  const handleApply = async () => {
    if (!selected || !eligibility?.eligible) return;
    if (!applicantName.trim()) {
      setToast({ message: '성함을 입력해 주세요.', type: 'error' });
      return;
    }
    if (contactDigits.length < 9) {
      setToast({ message: '연락처를 정확히 입력해 주세요.', type: 'error' });
      return;
    }
    if (!consent) {
      setToast({ message: '브랜드에게 정보를 전달하는 데 동의해 주세요.', type: 'error' });
      return;
    }
    setApplying(true);
    const res = await affiliateService.apply(selected.id, {
      message: message.trim(),
      name: applicantName.trim(),
      contact: applicantContact.trim(),
      links: (Object.keys(channelLinks) as ChannelLinkType[])
        .map(type => ({ type, url: channelLinks[type].trim() }))
        .filter(l => l.url),
    });
    setApplying(false);
    if (res.error || !res.participation) {
      setToast({ message: res.error || '참여 신청에 실패했습니다.', type: 'error' });
      return;
    }
    const p = res.participation;
    setCampaigns(prev =>
      prev.map(c => (c.id === selected.id ? { ...c, myParticipation: { id: p.id, status: p.status } } : c)),
    );
    setApplyResult(p.status === 'approved' ? 'approved' : 'pending');
    setShowApplySheet(false);
    setMessage('');
    setConsent(false);
  };

  // ------------------------------------------------------------------ 목록
  const list = loading ? (
    <div className="text-center py-16">
      <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-sm text-slate-400 font-bold">판매 상품 불러오는 중...</p>
    </div>
  ) : loadError ? (
    <div className="text-center py-16">
      <p className="text-sm text-slate-500 font-bold mb-3">{loadError}</p>
      <button onClick={load} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-700">
        다시 시도
      </button>
    </div>
  ) : cards.length === 0 ? (
    <div className="text-center py-16">
      <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
        <span className="text-2xl">🛍️</span>
      </div>
      <h3 className="text-base font-black text-slate-900 mb-1">
        {category || q ? '조건에 맞는 판매 상품이 없습니다' : '모집 중인 판매 캠페인이 없습니다'}
      </h3>
      <p className="text-sm text-slate-400 font-medium">
        {category || q ? '카테고리나 검색어를 바꿔 보세요' : '브랜드가 상품을 올리면 여기에 표시됩니다'}
      </p>
    </div>
  ) : (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 md:gap-5 py-1">
      {cards.map(({ campaign: c, product: p }) => {
        const my = c.myParticipation?.status || null;
        return (
          <button
            key={`${c.id}_${p.id}`}
            type="button"
            onClick={() => { setSelectedId(c.id); setSelectedProductId(p.id); }}
            className="text-left bg-white rounded-2xl border border-slate-100 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.12)] hover:border-blue-200 hover:shadow-[0_12px_28px_-6px_rgba(37,99,235,0.25)] hover:-translate-y-1 transition-all duration-300 group overflow-hidden"
          >
            <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
              {p.imageUrl ? (
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50">
                  <span className="text-3xl opacity-40">🛍️</span>
                </div>
              )}
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1 flex-wrap pr-2">
                <span className="bg-violet-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm">
                  수수료 {c.creatorRate}%
                </span>
              </div>
              {my && (
                <span className={`absolute top-2.5 right-2.5 px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm ${statusBadgeCls(my)}`}>
                  {PARTICIPATION_STATUS_LABEL[my]}
                </span>
              )}
              <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1 flex-wrap">
                <span className="bg-white/90 backdrop-blur-sm text-slate-700 px-1.5 py-0.5 rounded-md text-[9px] font-black">
                  {c.joinMode === 'open' ? '즉시 참여' : '승인제'}
                </span>
                {c.sampleOffered && (
                  <span className="bg-white/90 backdrop-blur-sm text-emerald-700 px-1.5 py-0.5 rounded-md text-[9px] font-black">샘플 제공</span>
                )}
                {c.followerDiscount && (
                  <span className="bg-white/90 backdrop-blur-sm text-rose-600 px-1.5 py-0.5 rounded-md text-[9px] font-black">팔로워 할인</span>
                )}
              </div>
            </div>
            <div className="p-2.5 md:p-3">
              <div className="flex items-center gap-1.5 mb-1 min-w-0">
                {c.companyName && <span className="text-[10px] text-slate-400 font-bold truncate">{c.companyName}</span>}
                {c.category && (
                  <>
                    <span className="text-slate-200">·</span>
                    <span className="text-[10px] text-slate-400 font-medium truncate">{categoryLabels[c.category] || c.category}</span>
                  </>
                )}
              </div>
              <h3 className="font-black text-xs md:text-sm text-slate-900 line-clamp-2 leading-snug group-hover:text-blue-600 transition-colors mb-1">
                {p.name}
              </h3>
              <p className="text-xs font-black text-slate-900">{won(p.price)}</p>
            </div>
          </button>
        );
      })}
    </div>
  );

  // ------------------------------------------------------------------ 상세
  // 제품 협찬 캠페인 상세와 같은 모양의 한 페이지로 연다. 예전에는 작은 창에 상품
  // 썸네일 한 줄만 보여서, 인플루언서가 팔지 말지 정하는 데 필요한 사진 · 사이즈 ·
  // 상세 설명을 볼 수 없었다. 그 자료는 브랜드 쇼핑몰 상품 페이지에 이미 다 있으니
  // 크게 보여 줄 대표 이미지와 함께 그 페이지로 바로 가는 버튼을 둔다.
  // 상품 페이지 링크는 추적 링크(/go)가 아니라 원래 주소다 — 둘러보기는 판매 클릭이 아니다.
  const detail = selected && (() => {
    const products = selected.products.filter(p => p.active !== false);
    const product = products.find(p => p.id === selectedProductId) || products[0] || null;
    const my = selected.myParticipation?.status || null;
    const applicable = !applyResult && canApply(my);

    return (
      <div ref={detailRef} className="w-full animate-in fade-in duration-300 pb-28">
        <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-lg border-b border-slate-100">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              type="button"
              onClick={close}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors"
              aria-label="뒤로"
            >
              <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h3 className="text-sm font-black text-slate-900 truncate flex-1">{selected.title}</h3>
            <span className="bg-violet-600 text-white px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0">
              수수료 {selected.creatorRate}%
            </span>
          </div>
        </div>

        <div className="max-w-3xl mx-auto">
          <div className="w-full max-w-[420px] md:max-w-[460px] mx-auto md:mt-4 aspect-square bg-slate-100 overflow-hidden relative md:rounded-3xl md:shadow-[0_20px_44px_-20px_rgba(15,23,42,0.5)]">
            {product?.imageUrl ? (
              <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50">
                <span className="text-5xl opacity-40">🛍️</span>
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />
            <div className="absolute top-4 left-4 flex items-center gap-2 flex-wrap">
              <span className="bg-violet-600 text-white px-3 py-1 rounded-full text-[11px] font-black shadow-lg">
                수수료 {selected.creatorRate}%
              </span>
              <span className="bg-white/90 backdrop-blur-sm text-slate-700 px-3 py-1 rounded-full text-[11px] font-bold shadow-sm">
                {selected.joinMode === 'open' ? '즉시 참여' : '승인제'}
              </span>
              {selected.category && (
                <span className="bg-white/90 backdrop-blur-sm text-slate-700 px-3 py-1 rounded-full text-[11px] font-bold shadow-sm">
                  {categoryLabels[selected.category] || selected.category}
                </span>
              )}
            </div>
            {my && (
              <span className={`absolute top-4 right-4 px-3 py-1 rounded-full text-[11px] font-black shadow-lg ${statusBadgeCls(my)}`}>
                {PARTICIPATION_STATUS_LABEL[my]}
              </span>
            )}
          </div>

          {/* 판매 상품이 여럿이면 썸네일로 바꿔 본다. 위 대표 이미지와 아래 상품 정보가 함께 바뀐다. */}
          {products.length > 1 && (
            <div className="max-w-[460px] mx-auto px-4 md:px-0 mt-3 flex gap-2 overflow-x-auto scrollbar-hide">
              {products.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProductId(p.id)}
                  className={`w-16 h-16 rounded-xl overflow-hidden bg-slate-50 flex-shrink-0 border-2 transition-colors ${
                    p.id === product?.id ? 'border-violet-600' : 'border-transparent hover:border-slate-200'
                  }`}
                  aria-label={p.name}
                >
                  {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : null}
                </button>
              ))}
            </div>
          )}

          <div className="px-4 md:px-8">
            <div className="pt-5 pb-4 border-b border-slate-100">
              {selected.companyName && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-black text-white">{selected.companyName.charAt(0)}</span>
                  </div>
                  <span className="text-sm text-slate-500 font-bold">{selected.companyName}</span>
                </div>
              )}
              <h1 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">{product?.name || selected.title}</h1>
              {product && (
                <p className="mt-2 text-lg font-black text-slate-900">
                  {won(product.price)}
                  <span className="text-sm text-violet-600 ml-2">1개 팔면 약 {won((product.price * selected.creatorRate) / 100)}</span>
                </p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap mt-3">
                {selected.sampleOffered && <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg text-[10px] font-black">샘플 제공</span>}
                {selected.followerDiscount && <span className="bg-rose-50 text-rose-600 px-2 py-0.5 rounded-lg text-[10px] font-black">팔로워 할인</span>}
                {products.length > 1 && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg text-[10px] font-black">판매 상품 {products.length}개</span>}
              </div>

              {product?.productUrl && (
                <>
                  <a
                    {...externalLinkProps(product.productUrl)}
                    className="mt-4 w-full flex items-center justify-center gap-2 bg-white border-2 border-slate-900 text-slate-900 py-3.5 rounded-2xl font-black text-sm hover:bg-slate-900 hover:text-white transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    쇼핑몰에서 상품 상세 보기
                  </a>
                  <p className="text-[11px] text-slate-400 font-bold text-center mt-1.5">
                    상세 이미지 · 사이즈 · 옵션은 브랜드 쇼핑몰 상품 페이지에서 확인할 수 있어요
                  </p>
                </>
              )}
            </div>

            <div className="py-5 border-b border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-100 rounded-2xl p-4 md:p-5 shadow-[0_10px_26px_-12px_rgba(124,58,237,0.45)]">
                  <span className="text-xs text-violet-500 font-black">내 수수료</span>
                  <p className="text-2xl font-black text-violet-700 mt-1">판매액의 {selected.creatorRate}%</p>
                  <span className="text-xs font-bold text-violet-400 mt-1 inline-block">
                    구매가 확정된 판매액 기준 · 링크 클릭 후 7일 안의 구매가 내 판매로 집계돼요
                  </span>
                </div>
                <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[0_6px_18px_-8px_rgba(15,23,42,0.22)]">
                  <p className="text-[10px] text-slate-400 font-black">판매 기간</p>
                  <p className="text-sm font-black text-slate-900 mt-1">{formatDate(selected.startDate) || '시작일 미정'}</p>
                  <p className="text-sm font-black text-slate-900">~ {formatDate(selected.endDate) || '상시'}</p>
                </div>
                <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[0_6px_18px_-8px_rgba(15,23,42,0.22)]">
                  <p className="text-[10px] text-slate-400 font-black">참여 방식</p>
                  <p className="text-sm font-black text-slate-900 mt-1">{selected.joinMode === 'open' ? '즉시 참여' : '승인제'}</p>
                  <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                    {selected.joinMode === 'open' ? '신청하면 바로 링크가 생겨요' : '브랜드 승인 후 링크가 생겨요'}
                  </p>
                </div>
              </div>
            </div>

            {selected.description && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3">캠페인 소개</h3>
                <div className="bg-slate-50 rounded-2xl p-5 md:p-6 border border-slate-100 text-sm text-slate-700 font-medium whitespace-pre-wrap leading-[1.8]">
                  {selected.description}
                </div>
              </div>
            )}

            {(selected.followerDiscount || (selected.sampleOffered && selected.sampleNote)) && (
              <div className="py-5 border-b border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-3">
                {selected.followerDiscount && (
                  <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-rose-500 mb-1">팔로워 할인</p>
                    <p className="text-xs font-bold text-rose-900 whitespace-pre-wrap">{selected.followerDiscount}</p>
                  </div>
                )}
                {selected.sampleOffered && selected.sampleNote && (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-emerald-600 mb-1">샘플 안내</p>
                    <p className="text-xs font-bold text-emerald-900 whitespace-pre-wrap">{selected.sampleNote}</p>
                  </div>
                )}
              </div>
            )}

            {products.length > 1 && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3">판매 상품 {products.length}개</h3>
                <div className="space-y-2">
                  {products.map(p => (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 rounded-xl p-2.5 border ${
                        p.id === product?.id ? 'bg-violet-50/60 border-violet-200' : 'bg-slate-50 border-slate-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => { setSelectedProductId(p.id); detailRef.current?.scrollIntoView({ block: 'start' }); }}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <div className="w-14 h-14 rounded-lg overflow-hidden bg-white flex-shrink-0">
                          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-slate-900 line-clamp-2">{p.name}</p>
                          <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                            {won(p.price)}
                            <span className="text-violet-600 ml-1.5">· 1개당 약 {won((p.price * selected.creatorRate) / 100)}</span>
                          </p>
                        </div>
                      </button>
                      {p.productUrl && (
                        <a
                          {...externalLinkProps(p.productUrl)}
                          className="text-[10px] font-black text-blue-600 hover:text-blue-700 flex-shrink-0 px-1"
                        >
                          상품 상세
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 새로 올리는 캠페인에는 가이드 단계가 없다. 예전에 가이드를 적어 올린
                캠페인만 그대로 보여 준다. */}
            {selected.contentGuide && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3">콘텐츠 가이드</h3>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-sm text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                  {selected.contentGuide}
                </div>
              </div>
            )}
            {selected.bannedPhrases && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3">금지 표현</h3>
                <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 text-sm text-amber-900 font-medium whitespace-pre-wrap leading-relaxed">
                  {selected.bannedPhrases}
                </div>
              </div>
            )}

            {/* 광고 표기는 선택이 아니다. 콘텐츠마다 이 문구(또는 같은 뜻)를 함께 올려야 한다. */}
            <div className="py-5">
              <div className="bg-slate-900 text-white rounded-2xl p-4">
                <p className="text-[10px] font-black text-white/60 mb-1">광고 표기 안내</p>
                <p className="text-xs font-bold whitespace-pre-wrap leading-relaxed">
                  {selected.disclosureText || '이 콘텐츠에는 판매 수수료를 받는 링크가 포함되어 있습니다. (광고)'}
                </p>
                <p className="text-[10px] font-medium text-white/50 mt-2 leading-relaxed">
                  스토리 · 게시물 · DM 등 링크를 공유하는 모든 곳에 광고임을 표시해 주세요.
                  클릭 후 7일 안의 구매가 내 판매로 집계됩니다(마지막 클릭 기준).
                </p>
              </div>
            </div>

            {/* 참여 결과 · 현재 상태 */}
            {applyResult ? (
              <div
                className={`mb-5 rounded-2xl p-5 border text-center ${
                  applyResult === 'approved' ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'
                }`}
              >
                <p className={`text-base font-black ${applyResult === 'approved' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {applyResult === 'approved' ? '바로 판매할 수 있어요' : '승인 대기 중이에요'}
                </p>
                <p className={`text-xs font-bold mt-1 leading-relaxed ${applyResult === 'approved' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {applyResult === 'approved'
                    ? '협업 캠페인 › 어필리에이트 탭에서 링크를 확인하세요.'
                    : '브랜드가 신청을 확인하고 승인하면 협업 캠페인 › 어필리에이트 탭에 판매 링크가 생깁니다.'}
                </p>
              </div>
            ) : !applicable && my ? (
              <div className="mb-5 rounded-2xl p-5 bg-slate-50 border border-slate-100 text-center">
                <p className="text-base font-black text-slate-700">{PARTICIPATION_STATUS_LABEL[my]}</p>
                <p className="text-xs font-bold text-slate-400 mt-1">
                  {my === 'approved'
                    ? '협업 캠페인 › 어필리에이트 탭에서 링크를 확인하세요.'
                    : my === 'pending'
                      ? '브랜드가 신청을 확인하고 있어요.'
                      : '이 캠페인에는 지금 참여할 수 없어요.'}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* 아래 고정 막대 — 제품 협찬 상세와 같은 자리. */}
        {applicable && !showApplySheet && (
          <div className="fixed bottom-[calc(68px+env(safe-area-inset-bottom,0px))] md:bottom-0 left-0 right-0 z-[110] bg-white/90 backdrop-blur-lg border-t border-slate-100 shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.35)]">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-black text-violet-700 truncate">수수료 {selected.creatorRate}%</p>
                <p className="text-[11px] text-slate-400 font-bold truncate">
                  {selected.joinMode === 'open' ? '즉시 참여 · 신청하면 바로 링크' : '승인제 · 브랜드 승인 후 링크'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowApplySheet(true)}
                className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-3.5 rounded-2xl font-black text-sm transition-all shadow-[0_12px_28px_-10px_rgba(15,23,42,0.75)] hover:-translate-y-0.5 active:translate-y-0 flex-shrink-0"
              >
                참여하기
              </button>
            </div>
          </div>
        )}

        {/* 참여 신청 시트. z-[190]: 대시보드 아래 막대(z-[100])와 이 화면의 고정 막대(z-[110])보다 위. */}
        {applicable && showApplySheet && (
          <div className="fixed inset-0 z-[190] flex items-end md:items-center justify-center p-0 md:p-6">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={() => setShowApplySheet(false)} />
            <div className="modal-card relative w-full md:max-w-lg bg-white rounded-t-3xl md:rounded-3xl shadow-[0_-18px_44px_-16px_rgba(15,23,42,0.55)] max-h-[85vh] modal-maxh-85 overflow-hidden sheet-rise">
              <div className="shrink-0 px-5 pt-3 pb-4 border-b border-slate-100">
                <div className="md:hidden w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-3" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-slate-900">판매 캠페인 참여하기</h3>
                    <p className="text-xs text-slate-400 font-medium mt-1 truncate">{selected.title}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowApplySheet(false)}
                    aria-label="닫기"
                    className="shrink-0 w-11 h-11 md:w-9 md:h-9 -mt-1.5 -mr-2 md:mt-0 md:mr-0 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 text-2xl md:text-xl"
                  >
                    ×
                  </button>
                </div>
              </div>
              {!eligibility ? (
                <div className="modal-body px-5 py-10 text-center">
                  {eligibilityError ? (
                    <>
                      <p className="text-sm font-bold text-slate-500">{eligibilityError}</p>
                      <button type="button" onClick={() => void loadEligibility()} className="mt-3 text-xs font-black text-blue-600 hover:underline">
                        다시 시도
                      </button>
                    </>
                  ) : (
                    <div className="w-7 h-7 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
                  )}
                </div>
              ) : !eligibility.eligible ? (
                /* 매칭받기 미등록 · 인스타 연동 해제. 여기서 바로 등록(또는 재연동)을 시작한다. */
                <div className="modal-body px-5 py-5 space-y-3">
                  <div className="rounded-2xl bg-violet-50 border border-violet-100 px-4 py-4">
                    <p className="text-sm font-black text-violet-800">
                      {eligibility.registered ? '인스타그램을 다시 연동해 주세요' : '브랜드 매칭받기에 등록해야 참여할 수 있어요'}
                    </p>
                    <p className="text-xs font-bold text-violet-600 mt-1.5 leading-relaxed break-keep">
                      {eligibility.registered
                        ? '판매 캠페인은 연동한 인스타그램 프로필이 브랜드에게 전달돼요. 브랜드 매칭받기에서 인스타그램을 다시 연동한 뒤 신청해 주세요.'
                        : '판매 캠페인에 신청하면 연동한 인스타그램 프로필(아이디 · 팔로워)이 브랜드에게 전달돼요. 브랜드 매칭받기에 등록하고 인스타그램을 연동하면 바로 신청할 수 있어요.'}
                    </p>
                  </div>
                  <CollabMatchRegister
                    variant="influencer"
                    applicantUsername={userName}
                    onRegisteredChange={() => void loadEligibility()}
                  />
                </div>
              ) : (
                <div className="modal-body px-5 py-4 space-y-4">
                  {/* 브랜드에게 전달되는 인스타 프로필 */}
                  {eligibility.instagram && (
                    <div>
                      <p className="text-[11px] font-black text-slate-500 mb-1.5">브랜드에게 전달되는 인스타그램 프로필</p>
                      <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3.5 py-3">
                        <div className="w-11 h-11 rounded-full bg-slate-200 overflow-hidden flex-shrink-0">
                          {eligibility.instagram.profileImage && (
                            <img src={eligibility.instagram.profileImage} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-slate-900 truncate">
                            @{eligibility.instagram.handle || userName}
                          </p>
                          <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                            팔로워 {formatCountKo(eligibility.instagram.followers)}
                          </p>
                        </div>
                        {eligibility.instagram.url && (
                          <a href={eligibility.instagram.url} {...externalLinkProps} className="text-[11px] font-black text-blue-600 hover:underline flex-shrink-0">
                            보기
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label className="block">
                      <span className="text-[11px] font-black text-slate-500">성함 <span className="text-rose-500">*</span></span>
                      <input
                        type="text"
                        value={applicantName}
                        onChange={e => setApplicantName(e.target.value.slice(0, 50))}
                        placeholder="홍길동"
                        autoComplete="name"
                        className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-black text-slate-500">연락처 <span className="text-rose-500">*</span></span>
                      <input
                        type="tel"
                        inputMode="tel"
                        value={applicantContact}
                        onChange={e => setApplicantContact(formatContact(e.target.value).slice(0, 20))}
                        placeholder="010-0000-0000"
                        autoComplete="tel"
                        className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                      />
                    </label>
                  </div>

                  <div>
                    <span className="text-[11px] font-black text-slate-500">다른 채널 링크 (선택)</span>
                    <div className="mt-1 space-y-1.5">
                      {(['tiktok', 'youtube', 'other'] as ChannelLinkType[]).map(type => (
                        <div key={type} className="flex items-center gap-2">
                          <span className="w-12 flex-shrink-0 text-[11px] font-black text-slate-500">{CHANNEL_LINK_LABEL[type]}</span>
                          <input
                            type="url"
                            inputMode="url"
                            value={channelLinks[type]}
                            onChange={e => setChannelLinks(prev => ({ ...prev, [type]: e.target.value.slice(0, 300) }))}
                            placeholder={
                              type === 'tiktok' ? 'https://www.tiktok.com/@아이디'
                                : type === 'youtube' ? 'https://www.youtube.com/@채널'
                                : '블로그 · 스레드 등 주소'
                            }
                            className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-black text-slate-500">브랜드에게 남길 말 (선택)</span>
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value.slice(0, 500))}
                      rows={3}
                      placeholder={selected.joinMode === 'open' ? '브랜드에게 남길 말' : '채널 소개나 판매 계획을 적으면 승인에 도움이 돼요'}
                      className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
                    />
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={e => setConsent(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 flex-shrink-0"
                    />
                    <span className="text-[11px] font-bold text-slate-500 leading-relaxed break-keep">
                      이 캠페인의 브랜드에게 인스타그램 프로필 · 채널 링크와 성함 · 연락처를 전달하는 데 동의합니다. (참여 심사 · 샘플 발송 · 판매 안내 목적)
                    </span>
                  </label>

                  <p className="text-[11px] text-slate-400 font-bold">
                    {selected.joinMode === 'open' ? '즉시 참여 캠페인이라 신청과 동시에 판매 링크가 생겨요.' : '승인제 캠페인이에요. 브랜드가 승인하면 판매 링크가 생겨요.'}
                  </p>
                </div>
              )}
              <div className="shrink-0 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowApplySheet(false)}
                  className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 transition-colors flex-shrink-0"
                >
                  {eligibility && !eligibility.eligible ? '닫기' : '취소'}
                </button>
                {eligibility?.eligible && (
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={applying || !formReady}
                    className="flex-1 bg-slate-900 hover:bg-slate-800 text-white py-3.5 rounded-xl font-black text-sm transition-all disabled:opacity-60"
                  >
                    {applying ? '신청하는 중...' : selected.joinMode === 'open' ? '참여하기 · 바로 링크 받기' : '참여 신청하기'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  })();

  return (
    <>
      {detail || list}
      <Toast
        message={toast?.message || ''}
        isVisible={!!toast}
        onClose={() => setToast(null)}
        type={toast?.type || 'success'}
      />
    </>
  );
};

export default AffiliateBrowse;
