import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  affiliateService,
  won,
  PARTICIPATION_STATUS_LABEL,
  type AffiliateCampaign,
  type AffiliateProduct,
  type ParticipationStatus,
} from '../../services/affiliateService';
import { useCloseOnBack } from '../../hooks/useCloseOnBack';
import Toast from '../Toast';

/**
 * 캠페인 찾기 › 어필리에이트.
 *
 * 판매 연동형 캠페인은 "캠페인 한 장"이 아니라 "상품 여러 개"로 고른다 — 인플루언서가
 * 실제로 비교하는 것은 어떤 상품을 얼마에 팔고 몇 %를 받는가이기 때문이다. 그래서
 * 목록은 캠페인마다 상품을 펼쳐 상품 카드로 깔고, 카드를 누르면 그 상품이 속한
 * 캠페인의 상세(기간 · 가이드 · 금지 표현 · 광고 표기)가 열린다. 참여는 캠페인 단위다.
 *
 * 수수료율은 인플루언서 몫(creatorRate)만 보인다. 브랜드가 내는 총 수수료율과 플랫폼
 * 몫은 이 응답에 실리지 않는다.
 *
 * 참여 방식은 둘이다. 승인제(approval)는 브랜드가 신청을 보고 승인해야 링크가 나오고,
 * 즉시 참여(open)는 신청과 동시에 링크가 나온다. 링크는 협업 캠페인 › 어필리에이트
 * 탭에서 확인한다 — 여기는 찾고 신청하는 자리만 한다.
 */

interface AffiliateBrowseProps {
  /** 캠페인 찾기 화면의 카테고리 칩 값. 빈 문자열이면 전체. */
  category: string;
  /** 검색어(디바운스된 값). */
  q: string;
  /** 카테고리 키 → 표시 이름. */
  categoryLabels: Record<string, string>;
  /** 목록 개수를 바깥 칩 줄 끝 "N개"에 올린다. */
  onCount?: (count: number) => void;
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

const AffiliateBrowse: React.FC<AffiliateBrowseProps> = ({ category, q, categoryLabels, onCount }) => {
  const [campaigns, setCampaigns] = useState<AffiliateCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('');
  const [applying, setApplying] = useState(false);
  /** 방금 신청한 결과 안내. 승인제/즉시 참여에 따라 문장이 다르다. */
  const [applyResult, setApplyResult] = useState<'pending' | 'approved' | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const close = useCallback(() => {
    setSelectedId('');
    setMessage('');
    setApplyResult(null);
  }, []);
  useCloseOnBack(!!selectedId, close);

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

  const handleApply = async () => {
    if (!selected) return;
    setApplying(true);
    const res = await affiliateService.apply(selected.id, message.trim());
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
    setMessage('');
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
            onClick={() => setSelectedId(c.id)}
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
  const detail = selected && (
    <div className="fixed inset-0 z-[300] bg-slate-900/50 flex items-end md:items-center justify-center" onClick={close}>
      <div
        className="bg-white w-full md:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl md:rounded-3xl shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-lg border-b border-slate-100 px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={close}
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="닫기"
          >
            <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h3 className="text-sm font-black text-slate-900 truncate flex-1">{selected.title}</h3>
          <span className="bg-violet-600 text-white px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0">
            수수료 {selected.creatorRate}%
          </span>
        </div>

        <div className="p-4 md:p-6 space-y-5">
          <div>
            {selected.companyName && <p className="text-sm text-slate-500 font-bold mb-1">{selected.companyName}</p>}
            <h2 className="text-xl font-black text-slate-900 leading-tight">{selected.title}</h2>
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg text-[10px] font-black">
                {selected.joinMode === 'open' ? '즉시 참여' : '승인제'}
              </span>
              {selected.category && (
                <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                  {categoryLabels[selected.category] || selected.category}
                </span>
              )}
              {selected.sampleOffered && <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg text-[10px] font-black">샘플 제공</span>}
              {selected.followerDiscount && <span className="bg-rose-50 text-rose-600 px-2 py-0.5 rounded-lg text-[10px] font-black">팔로워 할인</span>}
            </div>
            {selected.description && (
              <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap leading-relaxed mt-3">{selected.description}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-r from-violet-50 to-blue-50 border border-violet-100 rounded-2xl p-4">
              <p className="text-[10px] text-violet-500 font-black">내 수수료</p>
              <p className="text-2xl font-black text-violet-700">{selected.creatorRate}%</p>
              <p className="text-[10px] text-violet-400 font-bold mt-0.5">확정된 판매액 기준</p>
            </div>
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[0_6px_18px_-8px_rgba(15,23,42,0.22)]">
              <p className="text-[10px] text-slate-400 font-black">기간</p>
              <p className="text-sm font-black text-slate-900 mt-1">{formatDate(selected.startDate) || '시작일 미정'}</p>
              <p className="text-sm font-black text-slate-900">~ {formatDate(selected.endDate) || '상시'}</p>
            </div>
          </div>

          <section>
            <h4 className="text-sm font-black text-slate-900 mb-2">판매 상품 {selected.products.filter(p => p.active !== false).length}개</h4>
            <div className="space-y-2">
              {selected.products.filter(p => p.active !== false).map(p => (
                <div key={p.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-2.5 border border-slate-100">
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-white flex-shrink-0">
                    {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-slate-900 line-clamp-2">{p.name}</p>
                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                      {won(p.price)}
                      <span className="text-violet-600 ml-1.5">
                        · 1개당 약 {won((p.price * selected.creatorRate) / 100)}
                      </span>
                    </p>
                  </div>
                  {p.productUrl && (
                    <a
                      href={p.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-black text-blue-600 hover:text-blue-700 flex-shrink-0"
                    >
                      상품 보기
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          {(selected.followerDiscount || (selected.sampleOffered && selected.sampleNote)) && (
            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            </section>
          )}

          {selected.contentGuide && (
            <section>
              <h4 className="text-sm font-black text-slate-900 mb-2">콘텐츠 가이드</h4>
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-sm text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                {selected.contentGuide}
              </div>
            </section>
          )}

          {selected.bannedPhrases && (
            <section>
              <h4 className="text-sm font-black text-slate-900 mb-2">금지 표현</h4>
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 text-sm text-amber-900 font-medium whitespace-pre-wrap leading-relaxed">
                {selected.bannedPhrases}
              </div>
            </section>
          )}

          {/* 광고 표기는 선택이 아니다. 콘텐츠마다 이 문구(또는 같은 뜻)를 함께 올려야
              한다는 점을 참여 버튼 바로 위에 둔다. */}
          <section className="bg-slate-900 text-white rounded-2xl p-4">
            <p className="text-[10px] font-black text-white/60 mb-1">광고 표기 안내</p>
            <p className="text-xs font-bold whitespace-pre-wrap leading-relaxed">
              {selected.disclosureText || '이 콘텐츠에는 판매 수수료를 받는 링크가 포함되어 있습니다. (광고)'}
            </p>
            <p className="text-[10px] font-medium text-white/50 mt-2 leading-relaxed">
              스토리 · 게시물 · DM 등 링크를 공유하는 모든 곳에 광고임을 표시해 주세요.
              클릭 후 7일 안의 구매가 내 판매로 집계됩니다(마지막 클릭 기준).
            </p>
          </section>

          {/* 참여 */}
          {applyResult ? (
            <div
              className={`rounded-2xl p-4 border ${
                applyResult === 'approved' ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'
              }`}
            >
              <p className={`text-sm font-black ${applyResult === 'approved' ? 'text-emerald-700' : 'text-amber-700'}`}>
                {applyResult === 'approved' ? '바로 판매할 수 있어요' : '승인 대기 중이에요'}
              </p>
              <p className={`text-xs font-bold mt-1 leading-relaxed ${applyResult === 'approved' ? 'text-emerald-600' : 'text-amber-600'}`}>
                {applyResult === 'approved'
                  ? '협업 캠페인 › 어필리에이트 탭에서 링크를 확인하세요.'
                  : '브랜드가 신청을 확인하고 승인하면 협업 캠페인 › 어필리에이트 탭에 판매 링크가 생깁니다.'}
              </p>
            </div>
          ) : canApply(selected.myParticipation?.status) ? (
            <div className="space-y-2">
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value.slice(0, 500))}
                rows={3}
                placeholder={selected.joinMode === 'open' ? '브랜드에게 남길 말 (선택)' : '브랜드에게 남길 말 (선택) — 채널 소개나 판매 계획을 적으면 승인에 도움이 돼요'}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
              />
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                className="w-full bg-slate-900 text-white py-3.5 rounded-2xl font-black text-sm hover:bg-slate-800 active:scale-[0.99] transition-all disabled:opacity-60"
              >
                {applying ? '신청하는 중...' : selected.joinMode === 'open' ? '참여하기 · 바로 링크 받기' : '참여하기'}
              </button>
              <p className="text-[10px] text-slate-400 font-bold text-center">
                {selected.joinMode === 'open' ? '즉시 참여 캠페인이라 신청과 동시에 판매 링크가 생겨요.' : '승인제 캠페인이에요. 브랜드가 승인하면 판매 링크가 생겨요.'}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl p-4 bg-slate-50 border border-slate-100 text-center">
              <p className="text-sm font-black text-slate-700">
                {PARTICIPATION_STATUS_LABEL[selected.myParticipation!.status]}
              </p>
              <p className="text-[11px] font-bold text-slate-400 mt-1">
                {selected.myParticipation!.status === 'approved'
                  ? '협업 캠페인 › 어필리에이트 탭에서 링크를 확인하세요.'
                  : selected.myParticipation!.status === 'pending'
                    ? '브랜드가 신청을 확인하고 있어요.'
                    : '이 캠페인에는 지금 참여할 수 없어요.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {list}
      {detail}
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
