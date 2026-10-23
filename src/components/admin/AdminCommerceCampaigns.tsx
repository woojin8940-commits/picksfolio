import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { daysUntilDeadline } from '../../utils/campaignRecruit';
import ListupWorkspace from '../collab/ListupWorkspace';
import BrandContactCard from '../collab/BrandContactCard';
import InfluencerCandidateCard, { ContactPanel, metricsFrom } from '../collab/InfluencerCandidateCard';

/**
 * 커머스 캠페인(운영 콘솔 탭) — 인플루언서 계정의 '캠페인' 메뉴와 같은 모양으로 늘어놓는다.
 *
 * 커머스형은 브랜드가 지원자 중에서 직접 수락하고, 그 뒤의 조건 · 일정 · 수수료는 담당자가
 * 중간에서 조율한다. 그래서 이 탭의 첫 번째 일은 "브랜드가 누구를 골랐는지"를 알리는 것이다.
 * 새로 선정된 건이 있는 캠페인은 카드에 표시가 붙고 맨 앞으로 오며, 카드를 열면 선정된
 * 인플루언서의 지표 · 연락처와 브랜드 담당자 연락처를 한 화면에서 본다. 열어 보면 그
 * 캠페인의 알림은 확인 처리된다.
 *
 * 인플루언서 화면과 달리 희망 수수료를 그대로 보여 준다 — 운영자는 그 숫자로 조건을
 * 조율하는 사람이다.
 */

interface Props {
  token: string;
  /** 새 선정 수가 바뀌면 알린다. 탭 배지가 이 값을 쓴다. */
  onNewCountChange?: (count: number) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  beauty: '뷰티', fashion: '패션', food: '식품', lifestyle: '라이프스타일',
  travel: '여행', health: '건강', tech: 'IT/테크', parenting: '육아',
  pet: '반려동물', interior: '인테리어', sports: '스포츠',
  entertainment: '엔터테인먼트', education: '교육', other: '기타',
};

type ViewFilter = '' | 'new' | 'selected' | 'open' | 'closed';

const num = (v: unknown) => Number(v || 0) || 0;

const isClosed = (c: any) => c.status !== 'active' || (daysUntilDeadline(c.end_date) ?? 0) < 0;

const deadlineInfo = (endDate: string) => {
  if (!endDate) return null;
  const days = daysUntilDeadline(endDate);
  if (days === null) return null;
  if (days < 0) return { label: '마감', urgent: false };
  if (days === 0) return { label: 'D-Day', urgent: true };
  if (days <= 3) return { label: `마감임박 D-${days}`, urgent: true };
  return { label: `D-${days}`, urgent: false };
};

const formatDate = (raw: string) => String(raw || '').slice(0, 10).replace(/-/g, '.');

const AdminCommerceCampaigns: React.FC<Props> = ({ token, onNewCountChange }) => {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewFilter>('');
  const [category, setCategory] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [applicants, setApplicants] = useState<any[]>([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [showListup, setShowListup] = useState(false);

  // 승인된 커머스 캠페인만 온다(서버가 거른다). 상세에서 돌아올 때마다 다시 세어
  // 방금 확인한 알림이 카드에 남아 있지 않게 한다.
  useEffect(() => {
    if (selectedId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const res = await apiService.getAdminCommerceCampaigns(token);
      if (!alive) return;
      setCampaigns(res.campaigns || []);
      onNewCountChange?.(res.newSelectedTotal || 0);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [token, selectedId, onNewCountChange]);

  // 캠페인을 열면 지원자를 불러오고, 그 캠페인의 새 선정 알림을 확인 처리한다.
  // "새 선정" 표시는 이번 화면에서는 그대로 두어 어느 사람이 새로 골라졌는지 보이게 한다.
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    (async () => {
      setApplicantsLoading(true);
      setApplicants([]);
      setShowListup(false);
      const res = await apiService.getAdminCommerceApplicants(token, selectedId);
      if (!alive) return;
      setApplicants(res.applicants || []);
      setApplicantsLoading(false);
      if ((res.applicants || []).some((a: any) => a.is_new)) {
        void apiService.markAdminCommerceSeen(token, selectedId);
      }
    })();
    return () => { alive = false; };
  }, [token, selectedId]);

  const counts = useMemo(() => ({
    '': campaigns.length,
    new: campaigns.filter(c => num(c.new_selected_count) > 0).length,
    selected: campaigns.filter(c => num(c.selected_count) > 0).length,
    open: campaigns.filter(c => !isClosed(c)).length,
    closed: campaigns.filter(isClosed).length,
  }), [campaigns]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns
      .filter(c => {
        if (view === 'new') return num(c.new_selected_count) > 0;
        if (view === 'selected') return num(c.selected_count) > 0;
        if (view === 'open') return !isClosed(c);
        if (view === 'closed') return isClosed(c);
        return true;
      })
      .filter(c => !category || c.category === category)
      .filter(c => !q || [c.title, c.brand_name, c.product_name].some(v => String(v || '').toLowerCase().includes(q)))
      // 새로 선정된 건이 있는 캠페인이 가장 급하다(최근 선정 순). 그다음 모집 중, 마감 순.
      .sort((a, b) => {
        const rank = (c: any) => (num(c.new_selected_count) > 0 ? 0 : isClosed(c) ? 2 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (rank(a) === 0) return String(b.last_selected_at || '').localeCompare(String(a.last_selected_at || ''));
        return String(a.end_date || '9999').localeCompare(String(b.end_date || '9999'));
      });
  }, [campaigns, view, category, search]);

  const selected = campaigns.find(c => c.id === selectedId) || null;

  // ------------------------------------------------------------------ 상세
  if (selectedId) {
    const c = selected;
    const selectedRows = applicants.filter(a => a.status === 'accepted');
    const newRows = selectedRows.filter(a => a.is_new);
    const otherRows = applicants.filter(a => a.status !== 'accepted');
    const deadline = c ? deadlineInfo(c.end_date) : null;
    const rate = num(c?.groupbuy_commission_rate);
    const headcount = num(c?.max_applicants);
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <button
              onClick={() => setSelectedId('')}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors"
              aria-label="커머스 캠페인 목록"
            >
              <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h3 className="text-sm font-black text-slate-900 truncate flex-1">{c?.title || '캠페인'}</h3>
            {c && isClosed(c) ? (
              <span className="bg-slate-400 text-white px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0">마감</span>
            ) : deadline ? (
              <span className={`${deadline.urgent ? 'bg-rose-500' : 'bg-slate-900'} text-white px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0`}>
                {deadline.label}
              </span>
            ) : null}
          </div>

          {c && (
            <div className="p-4 md:p-6 flex flex-col md:flex-row gap-5">
              <div className="w-full md:w-56 aspect-square bg-slate-100 rounded-2xl overflow-hidden flex-shrink-0 relative">
                {c.thumbnail_url ? (
                  <img src={c.thumbnail_url} alt={c.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-50 via-indigo-50 to-slate-50" />
                )}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 flex-wrap">
                  <span className="bg-blue-600 text-white px-2.5 py-0.5 rounded-full text-[10px] font-black shadow">커머스</span>
                  {c.category && (
                    <span className="bg-white/90 text-slate-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm">
                      {CATEGORY_LABELS[c.category] || c.category}
                    </span>
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {c.brand_name && <p className="text-sm text-slate-500 font-bold">{c.brand_name}</p>}
                <h2 className="text-lg md:text-xl font-black text-slate-900 leading-tight mt-0.5">{c.title}</h2>
                <p className="text-xs text-slate-400 font-medium mt-1.5">
                  등록 {formatDate(c.created_at)}
                  {c.manager_username ? ` · 담당 @${c.manager_username}` : ' · 담당자 없음'}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                  <InfoTile label="희망 수수료" value={rate > 0 ? `${rate}%` : '협의'} accent />
                  <InfoTile label="모집 인원" value={headcount > 0 ? `${headcount}명` : '제한 없음'} />
                  <InfoTile
                    label="모집기간"
                    value={c.end_date ? `${formatDate(c.start_date)} ~ ${formatDate(c.end_date)}` : '상시'}
                  />
                  <InfoTile label="채널" value={c.upload_channel || '-'} />
                </div>
                {c.description && (
                  <p className="text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-line mt-4 line-clamp-4">
                    {c.description}
                  </p>
                )}
                {c.product_url && (
                  <a
                    href={c.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-[11px] font-black text-blue-600 hover:underline"
                  >
                    제품 페이지 보기 →
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 브랜드 담당자. 선정된 인플루언서와 조건을 맞추려면 브랜드에게도 바로 물어볼 수
            있어야 한다 — 캠페인 등록 때 받은 담당자 성함 · 연락처 · 메일이다. */}
        {c && (
          <BrandContactCard
            campaignId={c.id}
            businessUsername={c.business_username}
            brandName={c.brand_name || c.business_username}
            token={token}
          />
        )}

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h3 className="text-base font-black text-slate-900">
              브랜드가 선정한 인플루언서 <span className="text-blue-600">{selectedRows.length}</span>
            </h3>
            {newRows.length > 0 && (
              <span className="bg-rose-500 text-white px-2.5 py-1 rounded-full text-[10px] font-black">새 선정 {newRows.length}</span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 font-medium mb-4">
            선정된 분께 연락해 판매 기간 · 수수료 · 일정을 조율해 주세요. 연락처는 선정된 인플루언서만 보입니다.
          </p>
          {applicantsLoading ? (
            <div className="py-10 text-center">
              <div className="w-7 h-7 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
            </div>
          ) : selectedRows.length === 0 ? (
            <div className="py-10 text-center bg-slate-50 rounded-xl">
              <p className="text-sm font-black text-slate-500">아직 브랜드가 선정한 지원자가 없습니다</p>
              <p className="text-[11px] text-slate-400 font-medium mt-1">브랜드가 지원자를 수락하면 여기와 탭 알림에 표시됩니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {selectedRows.map(a => (
                <InfluencerCandidateCard
                  key={a.id}
                  data={applicantData(a)}
                  defaultExpanded
                  badges={
                    <>
                      {a.is_new && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-rose-50 text-rose-600">새 선정</span>
                      )}
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-50 text-blue-600">
                        {a.decided_by_role === 'brand' ? '브랜드 선정' : '담당자 선정'}
                      </span>
                    </>
                  }
                  details={<ContactPanel contact={a.contact_card} fallbackName={metricsFrom(applicantData(a)).name} />}
                >
                  <ApplicationInfo a={a} />
                </InfluencerCandidateCard>
              ))}
            </div>
          )}
        </div>

        {!applicantsLoading && otherRows.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
            <h3 className="text-base font-black text-slate-900 mb-1">
              선정 전 지원자 <span className="text-slate-400">{otherRows.length}</span>
            </h3>
            <p className="text-[11px] text-slate-400 font-medium mb-4">브랜드가 아직 고르지 않은 지원자입니다.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {otherRows.map(a => (
                <InfluencerCandidateCard
                  key={a.id}
                  data={applicantData(a)}
                  badges={
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-slate-100 text-slate-500">
                      {a.status === 'rejected' ? '미선정' : a.brand_preference === 'pass' ? '브랜드 보류' : '검토 중'}
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* 커머스형은 지원과 함께 담당자 리스트업도 받는다. 자주 쓰는 자리가 아니라 접어 둔다. */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
          <button
            onClick={() => setShowListup(v => !v)}
            className="w-full flex items-center justify-between text-sm font-black text-slate-700"
          >
            담당자 리스트업
            <span className="text-[11px] text-slate-400">{showListup ? '접기' : '열기'}</span>
          </button>
        </div>
        {showListup && <ListupWorkspace campaignId={selectedId} token={token} />}
      </div>
    );
  }

  // ------------------------------------------------------------------ 목록
  const viewChips: { value: ViewFilter; label: string }[] = [
    { value: '', label: '전체' },
    { value: 'new', label: '새 선정' },
    { value: 'selected', label: '선정 있음' },
    { value: 'open', label: '모집중' },
    { value: 'closed', label: '마감' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-8">
      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-black text-slate-900 mb-1">커머스 캠페인</h2>
        <p className="text-sm text-slate-400 font-medium">
          브랜드가 지원자를 선정하면 카드에 표시됩니다. 카드를 눌러 선정된 인플루언서와 브랜드 연락처를 확인하고 조율을 시작하세요.
        </p>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        <div className="relative">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white shadow-[0_4px_14px_-8px_rgba(15,23,42,0.35)]"
            placeholder="캠페인 · 브랜드 · 제품 검색..."
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {viewChips.map(f => (
            <button
              key={f.value}
              onClick={() => setView(f.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-black whitespace-nowrap transition-all ${
                view === f.value
                  ? 'bg-slate-900 text-white shadow-[0_6px_14px_-6px_rgba(15,23,42,0.85)] -translate-y-px'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {f.label}
              <span className={`ml-1 ${view === f.value ? 'text-white/60' : 'text-slate-400'}`}>{counts[f.value]}</span>
            </button>
          ))}
          <span className="ml-auto text-xs font-bold text-slate-400 whitespace-nowrap pl-2">{visible.length}개</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {[['', '전체 카테고리'], ...Object.entries(CATEGORY_LABELS).filter(([v]) => v !== 'entertainment')].map(([value, label]) => (
            <button
              key={value || 'all'}
              onClick={() => setCategory(value)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${
                category === value
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">캠페인 불러오는 중...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">🛍️</span>
          </div>
          <h3 className="text-base font-black text-slate-900 mb-1">
            {campaigns.length > 0 ? '조건에 맞는 커머스 캠페인이 없습니다' : '승인된 커머스 캠페인이 없습니다'}
          </h3>
          <p className="text-sm text-slate-400 font-medium">
            {campaigns.length > 0 ? '필터나 카테고리를 바꿔 보세요' : '커머스 캠페인을 승인하면 여기에 표시됩니다'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 md:gap-5 py-1">
          {visible.map(c => {
            const closed = isClosed(c);
            const deadline = closed ? { label: '마감', urgent: false } : deadlineInfo(c.end_date);
            const applied = num(c.application_count);
            const selectedCount = num(c.selected_count);
            const fresh = num(c.new_selected_count);
            const rate = num(c.groupbuy_commission_rate);
            const headcount = num(c.max_applicants);
            return (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`bg-white rounded-2xl border border-slate-100 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.12)] hover:border-blue-200 hover:shadow-[0_12px_28px_-6px_rgba(37,99,235,0.25)] hover:-translate-y-1 transition-all duration-300 cursor-pointer group overflow-hidden ${closed ? 'opacity-70' : ''}`}
              >
                <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
                  {c.thumbnail_url ? (
                    <img
                      src={c.thumbnail_url}
                      alt={c.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-pink-50">
                      <svg className="w-10 h-10 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span className="bg-white/90 backdrop-blur-sm text-blue-700 px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm">
                      커머스
                    </span>
                    {deadline && (
                      <span className={`${deadline.urgent ? 'bg-rose-500' : 'bg-slate-900/85'} text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm`}>
                        {deadline.label}
                      </span>
                    )}
                  </div>
                  <div className="absolute top-2.5 right-2.5">
                    {fresh > 0 ? (
                      <span className="bg-rose-500 text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm animate-pulse">새 선정 {fresh}</span>
                    ) : selectedCount > 0 ? (
                      <span className="bg-blue-500 text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm">선정 {selectedCount}명</span>
                    ) : null}
                  </div>
                </div>

                <div className="p-2.5 md:p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    {c.brand_name && (
                      <span className="text-[10px] text-slate-400 font-bold truncate">{c.brand_name}</span>
                    )}
                    {c.category && (
                      <>
                        <span className="text-slate-200">·</span>
                        <span className="text-[10px] text-slate-400 font-medium truncate">{CATEGORY_LABELS[c.category] || c.category}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-black text-xs md:text-sm text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1">
                    {c.title}
                  </h3>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-rose-500">{rate > 0 ? `수수료 ${rate}%` : '수수료 협의'}</span>
                    <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap">
                      {headcount > 0 ? `${applied}/${headcount}명` : `${applied}명 지원`}{selectedCount > 0 ? ` · 선정 ${selectedCount}` : ''}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium mt-1 truncate">
                    {c.manager_username ? `담당 @${c.manager_username}` : '담당자 없음'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** 지원 행을 후보 카드가 읽는 모양으로. */
const applicantData = (a: any) => ({
  ...(a.insights || {}),
  username: a.applicant_username,
  instagramUrl: a.insights?.instagramUrl || a.instagram_url || '',
});

/** 지원서에 적힌 내용과 선정 시각. 담당자가 연락하기 전에 읽는 자리다. */
const ApplicationInfo: React.FC<{ a: any }> = ({ a }) => (
  <div className="bg-slate-50 rounded-lg px-3 py-2 space-y-1">
    <p className="text-[11px] text-slate-500 font-bold">
      @{a.applicant_username}
      {a.decided_at ? ` · 선정 ${String(a.decided_at).slice(0, 16).replace('T', ' ')}` : ''}
    </p>
    {a.contact && <p className="text-[11px] text-slate-700 font-bold">지원서 연락처 {a.contact}</p>}
    {a.message && <p className="text-[11px] text-slate-600 font-medium whitespace-pre-line line-clamp-3">"{a.message}"</p>}
    <div className="flex flex-wrap gap-x-3">
      {[a.instagram_url, a.youtube_naver_url, a.portfolio_url].filter(Boolean).map((link: string) => (
        <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="text-[11px] font-black text-blue-600 hover:underline truncate max-w-full">
          {link.replace(/^https?:\/\//, '')}
        </a>
      ))}
    </div>
  </div>
);

const InfoTile: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className={`rounded-xl px-3 py-2.5 ${accent ? 'bg-gradient-to-r from-blue-50 to-pink-50 border border-blue-100' : 'bg-slate-50'}`}>
    <p className="text-[10px] text-slate-400 font-black">{label}</p>
    <p className={`text-sm font-black mt-0.5 truncate ${accent ? 'text-blue-700' : 'text-slate-900'}`}>{value}</p>
  </div>
);

export default AdminCommerceCampaigns;
