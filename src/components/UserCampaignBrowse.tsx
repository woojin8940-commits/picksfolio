import React, { useState, useEffect, useCallback } from 'react';
import { formatKoreanWon } from '../utils/formatters';
import { apiService } from '../services/apiService';
import { daysUntilDeadline, isCampaignClosed, isPastDeadline, isQuotaReached } from '../utils/campaignRecruit';
import { rewardModeOf } from '../utils/campaignBrief';
import CollabMatchRegister from './CollabMatchRegister';
import CreatorCollabWorkspace from './CreatorCollabWorkspace';
import CreatorOfferInbox from './collab/CreatorOfferInbox';
import Toast from './Toast';
import { useLanguage } from '../contexts/LanguageContext';

interface Campaign {
  id: string;
  business_username: string;
  type: string;
  title: string;
  description: string;
  brand_name: string;
  thumbnail_url: string;
  category: string;
  reward_type: string;
  reward_amount: string;
  requirements: string;
  max_applicants: number;
  start_date: string;
  end_date: string;
  status: string;
  application_count: number;
  created_at: string;
  recruit_closed?: boolean;
  reward_mode?: string;
  seeding_count?: number;
}

interface UserCampaignBrowseProps {
  userName: string;
  onBack?: () => void;
}

const CATEGORIES_KO: Record<string, string> = {
  beauty: '뷰티', fashion: '패션', food: '식품', lifestyle: '라이프스타일',
  travel: '여행', health: '건강', tech: 'IT/테크', parenting: '육아',
  pet: '반려동물', interior: '인테리어', sports: '스포츠',
  entertainment: '엔터테인먼트', education: '교육', other: '기타',
};

const CATEGORIES_EN: Record<string, string> = {
  beauty: 'Beauty', fashion: 'Fashion', food: 'Food', lifestyle: 'Lifestyle',
  travel: 'Travel', health: 'Health', tech: 'Tech', parenting: 'Parenting',
  pet: 'Pets', interior: 'Interior', sports: 'Sports',
  entertainment: 'Entertainment', education: 'Education', other: 'Other',
};

const PAGE_SIZE = 12;

const TYPE_LABELS_KO: Record<string, string> = {
  ad_collab: '광고 협업', group_buy: '공동구매', other: '기타',
  collaboration: '협업', advertisement: '광고/협찬', review: '리뷰', event: '이벤트',
};

const TYPE_LABELS_EN: Record<string, string> = {
  ad_collab: 'Ad Collab', group_buy: 'Group Buy', other: 'Other',
  collaboration: 'Collaboration', advertisement: 'Sponsorship', review: 'Review', event: 'Event',
};

const REWARD_LABELS_KO: Record<string, string> = {
  fixed: '고정 금액', product: '제품 제공', revenue_share: '수익 배분', mixed: '복합',
};

const REWARD_LABELS_EN: Record<string, string> = {
  fixed: 'Fixed Payout', product: 'Product Provided', revenue_share: 'Revenue Share', mixed: 'Mixed',
};

const modeBadge = (c: Campaign, isEn: boolean): string => {
  const mode = rewardModeOf(c.reward_mode);
  if (mode.openApply) {
    if (isEn) {
      if (mode.value === 'barter') return 'Product Sponsorship';
      if (mode.value === 'groupbuy') return 'Group Buy';
    }
    return mode.label;
  }
  const labels = isEn ? TYPE_LABELS_EN : TYPE_LABELS_KO;
  return labels[c.type] || c.type;
};

const rewardText = (c: Campaign, isEn: boolean): { headline: string; caption: string; short: string } | null => {
  const mode = rewardModeOf(c.reward_mode);
  if (mode.value === 'barter') {
    return {
      headline: isEn ? 'Product Sponsorship' : '제품 협찬',
      caption: isEn ? 'Receive products provided without ad fees' : '광고비 없이 제품을 제공받는 캠페인이에요',
      short: isEn ? 'Product Sponsor' : '제품 협찬',
    };
  }
  if (mode.value === 'groupbuy') {
    return {
      headline: isEn ? 'Sales Commission Negotiable' : '판매 수수료 협의',
      caption: isEn ? 'Specific rates will be discussed with manager' : '구체적인 조건은 담당자와 상의해 결정해요',
      short: isEn ? 'Commission' : '수수료 협의',
    };
  }
  if (c.reward_amount) {
    return {
      headline: formatKoreanWon(c.reward_amount),
      caption: isEn ? 'Guaranteed payout upon completion' : '활동 완료 시 확정 지급',
      short: formatKoreanWon(c.reward_amount),
    };
  }
  return null;
};

const headcountOf = (c: Campaign): number => {
  const mode = rewardModeOf(c.reward_mode);
  if (mode.value === 'barter') return c.seeding_count || c.max_applicants || 0;
  return c.max_applicants || 0;
};

const deadlineInfo = (endDateStr: string, isEn: boolean) => {
  if (!endDateStr) return null;
  const days = daysUntilDeadline(endDateStr);
  if (days === null) return null;
  if (days < 0) return { label: isEn ? 'Ended' : '마감', urgent: false };
  if (days === 0) return { label: 'D-Day', urgent: true };
  if (days <= 3) return { label: isEn ? `Urgent D-${days}` : `마감임박 D-${days}`, urgent: true };
  return { label: `D-${days}`, urgent: false };
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const UserCampaignBrowse: React.FC<UserCampaignBrowseProps> = ({ userName, onBack }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const categoriesMap = isEn ? CATEGORIES_EN : CATEGORIES_KO;
  const rewardFilters = [
    { value: '', label: isEn ? 'All' : '전체' },
    { value: 'ad_collab', label: isEn ? 'Product Sponsorship' : '제품 협찬' },
    { value: 'group_buy', label: isEn ? 'Group Buy' : '공동구매' },
  ];

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [activeFilter, setActiveFilter] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [acceptedCampaigns, setAcceptedCampaigns] = useState<Set<string>>(new Set());
  const [collabByCampaign, setCollabByCampaign] = useState<Record<string, string>>({});

  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState({ contact: '', instagram_url: '', youtube_naver_url: '' });
  const [applying, setApplying] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const loadMyApplications = useCallback(async () => {
    if (!userName) return;
    try {
      // 조회 파라미터는 username 이다. 예전에는 applicant_username 으로 불러서
      // 서버가 400 을 돌려줬고, 이미 지원한 캠페인에도 "지원하기"가 그대로 떴다.
      const res = await fetch(`/.netlify/functions/api-campaign-applications?username=${encodeURIComponent(userName)}`).then(r => r.json());
      if (res.applications) {
        setAppliedIds(new Set(res.applications.map((a: any) => a.campaign_id)));
      }
    } catch (e) {
      console.error(e);
    }
  }, [userName]);

  const loadMyCollabs = useCallback(async () => {
    if (!userName) return;
    const res = await apiService.getCollabs('influencer');
    const acceptedSet = new Set<string>();
    const map: Record<string, string> = {};
    (res.collabs || []).forEach((c: any) => {
      // 협업 목록은 campaignId(카멜)로 내려온다. snake_case 로 읽던 예전 코드에서는
      // 이 표가 늘 비어 있어서, 진행 중인 캠페인도 "지원 가능"으로 보였다.
      const campaignId = c.campaignId || c.campaign_id;
      if (campaignId) {
        acceptedSet.add(campaignId);
        map[campaignId] = c.id;
      }
    });
    setAcceptedCampaigns(acceptedSet);
    setCollabByCampaign(map);
  }, [userName]);

  const fetchCampaignsList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeFilter) params.append('type', activeFilter);
      if (activeCategory) params.append('category', activeCategory);
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      params.append('page', String(page));
      params.append('limit', String(PAGE_SIZE));

      const res = await fetch(`/.netlify/functions/api-campaigns?${params.toString()}`).then(r => r.json());
      setCampaigns(res.campaigns || []);
      setTotal(res.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, activeCategory, searchQuery, page]);

  useEffect(() => {
    fetchCampaignsList();
  }, [fetchCampaignsList]);

  useEffect(() => {
    loadMyApplications();
    loadMyCollabs();
  }, [loadMyApplications, loadMyCollabs]);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const changeFilter = (f: string) => {
    setActiveFilter(f);
    setPage(1);
  };

  const changeCategory = (cat: string) => {
    setActiveCategory(cat);
    setPage(1);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const handleApply = async () => {
    if (!selectedCampaign || !userName) return;
    if (!applyForm.contact.trim() || !applyForm.instagram_url.trim()) {
      setToast({ message: isEn ? 'Please enter contact info and Instagram link.' : '연락처와 인스타그램 링크를 입력해 주세요.', type: 'error' });
      return;
    }
    setApplying(true);
    try {
      const res = await fetch('/.netlify/functions/api-campaign-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: selectedCampaign.id,
          applicant_username: userName,
          contact: applyForm.contact.trim(),
          instagram_url: applyForm.instagram_url.trim(),
          youtube_naver_url: applyForm.youtube_naver_url.trim() || undefined,
        }),
      }).then(r => r.json());

      if (res.error) {
        setToast({ message: res.error, type: 'error' });
      } else {
        setToast({ message: isEn ? 'Application submitted successfully!' : '캠페인 지원이 완료되었습니다!', type: 'success' });
        setAppliedIds(prev => new Set([...prev, selectedCampaign.id]));
        setShowApplyForm(false);
        setSelectedCampaign(prev => prev ? { ...prev, application_count: prev.application_count + 1 } : null);
      }
    } catch (e: any) {
      setToast({ message: e?.message || (isEn ? 'Error submitting application' : '지원 처리 중 오류가 발생했습니다'), type: 'error' });
    } finally {
      setApplying(false);
    }
  };

  const filteredCampaigns = campaigns;

  // --- Campaign Detail View ---
  if (selectedCampaign) {
    const isApplied = appliedIds.has(selectedCampaign.id);
    const isClosed = isCampaignClosed(selectedCampaign);
    const closedReason = isPastDeadline(selectedCampaign.end_date)
      ? (isEn ? 'Recruitment period has ended' : '모집 기간이 종료되었습니다')
      : (isEn ? 'Brand has closed recruitment' : '브랜드가 모집을 마감했습니다');
    const deadline = deadlineInfo(selectedCampaign.end_date, isEn);
    const days = deadline?.label ?? null;
    const mode = rewardModeOf(selectedCampaign.reward_mode);
    const reward = rewardText(selectedCampaign, isEn);
    const headcount = headcountOf(selectedCampaign);
    const applicantPercent = headcount > 0
      ? Math.min(100, Math.round((selectedCampaign.application_count / headcount) * 100))
      : 0;
    const quotaReached = isQuotaReached(selectedCampaign);

    const headcountLabel = isEn
      ? (mode.value === 'barter' ? 'Sponsor Count' : mode.value === 'groupbuy' ? 'Target Creators' : 'Recruit Quota')
      : mode.headcountLabel;

    return (
      <div className="w-full animate-in fade-in duration-300 pb-28">
        {/* Sticky top bar */}
        <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-lg border-b border-slate-100">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => { setSelectedCampaign(null); setShowApplyForm(false); }}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors"
            >
              <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h3 className="text-sm font-black text-slate-900 truncate flex-1">{selectedCampaign.title}</h3>
            {isClosed ? (
              <span className="bg-slate-400 text-white px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0">
                {isEn ? 'Closed' : '마감'}
              </span>
            ) : deadline ? (
              <span className={`${deadline.urgent ? 'bg-rose-500' : 'bg-slate-900'} text-white px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0`}>
                {deadline.label}
              </span>
            ) : null}
          </div>
        </div>

        <div className="max-w-3xl mx-auto">
          <div className="w-full max-w-[420px] md:max-w-[460px] mx-auto md:mt-4 aspect-square bg-slate-100 overflow-hidden relative md:rounded-3xl md:shadow-[0_20px_44px_-20px_rgba(15,23,42,0.5)]">
            {selectedCampaign.thumbnail_url ? (
              <img src={selectedCampaign.thumbnail_url} alt={selectedCampaign.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-slate-50">
                <svg className="w-16 h-16 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />
            <div className="absolute top-4 left-4 flex items-center gap-2 flex-wrap">
              <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[11px] font-black shadow-lg">
                {modeBadge(selectedCampaign, isEn)}
              </span>
              {selectedCampaign.category && (
                <span className="bg-white/90 backdrop-blur-sm text-slate-700 px-3 py-1 rounded-full text-[11px] font-bold shadow-sm">
                  {categoriesMap[selectedCampaign.category] || selectedCampaign.category}
                </span>
              )}
            </div>
            {isApplied && (
              <div className="absolute top-4 right-4">
                <span className={`${acceptedCampaigns.has(selectedCampaign.id) ? 'bg-blue-600' : 'bg-emerald-500'} text-white px-3 py-1 rounded-full text-[11px] font-black shadow-lg`}>
                  {acceptedCampaigns.has(selectedCampaign.id)
                    ? (isEn ? 'Accepted' : '수락됨')
                    : (isEn ? 'Applied' : '지원완료')}
                </span>
              </div>
            )}
          </div>

          <div className="px-4 md:px-8">
            <div className="pt-5 pb-4 border-b border-slate-100">
              {selectedCampaign.brand_name && (
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-[9px] font-black text-white">{selectedCampaign.brand_name.charAt(0)}</span>
                  </div>
                  <span className="text-sm text-slate-500 font-bold">{selectedCampaign.brand_name}</span>
                </div>
              )}
              <h1 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">{selectedCampaign.title}</h1>
              <div className="flex items-center gap-3 mt-3 text-xs text-slate-400 font-medium">
                <span>{isEn ? 'Posted ' : '등록 '}{formatDate(selectedCampaign.created_at)}</span>
                {days && (
                  <>
                    <span className="text-slate-200">|</span>
                    <span className={`font-black ${days === 'D-Day' ? 'text-rose-500' : 'text-rose-400'}`}>{days}</span>
                  </>
                )}
              </div>
            </div>

            <div className="py-5 border-b border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                {reward && (
                  <div className="col-span-2 bg-gradient-to-r from-blue-50 to-pink-50 border border-blue-100 rounded-2xl p-4 md:p-5 shadow-[0_10px_26px_-12px_rgba(37,99,235,0.45)]">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center shadow-[0_3px_8px_-3px_rgba(37,99,235,0.5)]">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </div>
                      <span className="text-xs text-blue-500 font-black uppercase tracking-wider">{isEn ? 'Reward' : '리워드'}</span>
                    </div>
                    <p className="text-2xl font-black text-blue-700">{reward.headline}</p>
                    <span className="text-xs font-bold text-blue-400 mt-1 inline-block">{reward.caption}</span>
                  </div>
                )}

                <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[0_6px_18px_-8px_rgba(15,23,42,0.22)]">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center shadow-[0_2px_6px_-2px_rgba(37,99,235,0.45)]">
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                    <span className="text-[10px] text-slate-400 font-black uppercase">{headcountLabel}</span>
                  </div>
                  <p className="text-lg font-black text-slate-900">
                    {headcount > 0
                      ? <><span className="text-blue-600">{selectedCampaign.application_count}</span> / {headcount}{isEn ? ' people' : '명'}</>
                      : <><span className="text-blue-600">{selectedCampaign.application_count}</span>{isEn ? ' applicants' : '명 지원'}</>}
                  </p>
                  {headcount > 0 && (
                    <div className="mt-2">
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${quotaReached ? 'bg-emerald-500' : 'bg-blue-500'}`}
                          style={{ width: `${applicantPercent}%` }}
                        />
                      </div>
                      {quotaReached && (
                        <p className="text-[10px] text-emerald-600 font-bold mt-1">
                          {isEn ? 'Quota reached, but applications are still open' : '모집 인원을 채웠지만 계속 지원할 수 있어요'}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[0_6px_18px_-8px_rgba(15,23,42,0.22)]">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-emerald-50 rounded-lg flex items-center justify-center shadow-[0_2px_6px_-2px_rgba(16,185,129,0.45)]">
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <span className="text-[10px] text-slate-400 font-black uppercase">{isEn ? 'Campaign Period' : '캠페인 기간'}</span>
                  </div>
                  {selectedCampaign.start_date ? (
                    <div>
                      <p className="text-sm font-black text-slate-900">{formatDate(selectedCampaign.start_date)}</p>
                      {selectedCampaign.end_date && <p className="text-sm font-black text-slate-900">~ {formatDate(selectedCampaign.end_date)}</p>}
                    </div>
                  ) : selectedCampaign.end_date ? (
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold">{isEn ? 'Deadline' : '마감일'}</p>
                      <p className="text-sm font-black text-slate-900">{formatDate(selectedCampaign.end_date)}</p>
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-slate-400">{isEn ? 'Always Open' : '상시 모집'}</p>
                  )}
                </div>
              </div>
            </div>

            {(selectedCampaign.start_date || selectedCampaign.end_date) && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  {isEn ? 'Campaign Schedule' : '캠페인 진행 일정'}
                </h3>
                <div className="relative pl-6">
                  <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-slate-200" />

                  {selectedCampaign.start_date && (
                    <div className="relative mb-5">
                      <div className="absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full border-2 border-blue-500 bg-white flex items-center justify-center shadow-[0_3px_8px_-2px_rgba(37,99,235,0.55)]">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-blue-600">{isEn ? 'Campaign Start' : '캠페인 시작'}</p>
                        <p className="text-sm font-bold text-slate-700 mt-0.5">{formatDate(selectedCampaign.start_date)}</p>
                      </div>
                    </div>
                  )}

                  {selectedCampaign.end_date && (
                    <div className="relative mb-1">
                      <div className={`absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full border-2 shadow-[0_3px_8px_-2px_rgba(15,23,42,0.35)] ${days ? 'border-slate-300 bg-white' : 'border-rose-500 bg-rose-500'} flex items-center justify-center`}>
                        {!days && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <div>
                        <p className={`text-xs font-black ${days ? 'text-slate-400' : 'text-rose-500'}`}>
                          {days ? (isEn ? 'Campaign Deadline' : '캠페인 마감') : (isEn ? 'Closed' : '마감 완료')}
                        </p>
                        <p className="text-sm font-bold text-slate-700 mt-0.5">{formatDate(selectedCampaign.end_date)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedCampaign.description && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  {isEn ? 'Campaign Details' : '캠페인 상세 설명'}
                </h3>
                <div className="bg-slate-50 rounded-2xl p-5 md:p-6 border border-slate-100 shadow-[0_6px_18px_-10px_rgba(15,23,42,0.25)]">
                  <div className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-[1.8]">
                    {selectedCampaign.description}
                  </div>
                </div>
              </div>
            )}

            {selectedCampaign.requirements && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  {isEn ? 'Requirements' : '지원 조건'}
                </h3>
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 md:p-6 shadow-[0_8px_22px_-12px_rgba(217,119,6,0.45)]">
                  <div className="text-sm text-amber-900 font-medium whitespace-pre-wrap leading-[1.8]">
                    {selectedCampaign.requirements.split('\n').map((line, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        {line.trim() && (
                          <>
                            <svg className="w-3.5 h-3.5 text-amber-500 mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                            <span>{line}</span>
                          </>
                        )}
                        {!line.trim() && <br />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="py-5 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {isEn ? 'Campaign Info' : '캠페인 정보'}
              </h3>
              <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-50 shadow-[0_8px_22px_-12px_rgba(15,23,42,0.28)]">
                <div className="flex items-center px-5 py-3.5">
                  <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Type' : '유형'}</span>
                  <span className="text-sm text-slate-900 font-bold">{modeBadge(selectedCampaign, isEn)}</span>
                </div>
                {selectedCampaign.category && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Category' : '카테고리'}</span>
                    <span className="text-sm text-slate-900 font-bold">{categoriesMap[selectedCampaign.category] || selectedCampaign.category}</span>
                  </div>
                )}
                {selectedCampaign.brand_name && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Brand' : '브랜드'}</span>
                    <span className="text-sm text-slate-900 font-bold">{selectedCampaign.brand_name}</span>
                  </div>
                )}
                {selectedCampaign.reward_type && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Reward Type' : '보상 유형'}</span>
                    <span className="text-sm text-slate-900 font-bold">
                      {(isEn ? REWARD_LABELS_EN : REWARD_LABELS_KO)[selectedCampaign.reward_type] || selectedCampaign.reward_type}
                    </span>
                  </div>
                )}
                {selectedCampaign.reward_amount && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Reward Amount' : '보상 금액'}</span>
                    <span className="text-sm text-blue-700 font-black">{formatKoreanWon(selectedCampaign.reward_amount)}</span>
                  </div>
                )}
                {mode.value === 'groupbuy' && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Commission' : '판매 수수료'}</span>
                    <span className="text-sm text-blue-700 font-black">{isEn ? 'Negotiable with Manager' : '담당자와 협의'}</span>
                  </div>
                )}
                <div className="flex items-center px-5 py-3.5">
                  <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{headcountLabel}</span>
                  <span className="text-sm text-slate-900 font-bold">
                    {headcount > 0 ? `${headcount}${isEn ? ' people' : '명'}` : (isEn ? 'No limit' : '제한 없음')}
                  </span>
                </div>
                {mode.openApply && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Selection' : '선정 방식'}</span>
                    <span className="text-sm text-slate-900 font-bold">{isEn ? 'Brand selects from applicants' : '지원자 중 브랜드가 선정'}</span>
                  </div>
                )}
                <div className="flex items-center px-5 py-3.5">
                  <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">{isEn ? 'Posted Date' : '등록일'}</span>
                  <span className="text-sm text-slate-900 font-bold">{formatDate(selectedCampaign.created_at)}</span>
                </div>
              </div>
            </div>

            {isApplied && (
              <div className="py-5">
                {acceptedCampaigns.has(selectedCampaign.id) ? (
                  <div className="space-y-3">
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-5 text-center shadow-[0_10px_26px_-12px_rgba(16,185,129,0.5)]">
                      <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_4px_12px_-3px_rgba(16,185,129,0.5)]">
                        <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <p className="text-base font-black text-emerald-700">{isEn ? 'You have been selected!' : '캠페인에 선정되었습니다!'}</p>
                      <p className="text-sm text-emerald-500 font-medium mt-1">
                        {collabByCampaign[selectedCampaign.id]
                          ? (isEn ? 'Your manager will guide terms & schedule. Feel free to ask your manager.' : '담당자가 조건과 일정을 안내드립니다. 궁금한 점은 담당자에게 물어보세요.')
                          : (isEn ? 'Your manager will guide the process.' : '담당자가 진행을 안내드립니다.')}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const collabId = collabByCampaign[selectedCampaign.id];
                        const proposalId = collabId
                          ? `support_inf_${collabId}`
                          : `campaign_${selectedCampaign.id}_${userName.toLowerCase()}`;
                        window.dispatchEvent(new CustomEvent('navigate-timeline', { detail: { proposalId } }));
                      }}
                      className="w-full bg-slate-900 hover:bg-slate-700 text-white py-4 rounded-2xl font-black text-sm transition-all shadow-[0_12px_28px_-10px_rgba(15,23,42,0.75)] hover:shadow-[0_16px_34px_-10px_rgba(15,23,42,0.85)] hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                      {collabByCampaign[selectedCampaign.id] ? (isEn ? 'Chat with Manager' : '담당자와 대화하기') : (isEn ? 'Chat' : '대화하기')}
                    </button>
                  </div>
                ) : (
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 text-center shadow-[0_10px_26px_-12px_rgba(37,99,235,0.5)]">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_4px_12px_-3px_rgba(37,99,235,0.5)]">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <p className="text-base font-black text-blue-700">{isEn ? 'Application Submitted' : '지원 완료'}</p>
                    <p className="text-sm text-blue-400 font-medium mt-1">{isEn ? 'The brand will review and notify you of results' : '브랜드의 검토 후 결과를 안내해 드립니다'}</p>
                  </div>
                )}
              </div>
            )}

            {!isApplied && isClosed && (
              <div className="py-5">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center shadow-[0_8px_22px_-12px_rgba(15,23,42,0.3)]">
                  <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_4px_12px_-4px_rgba(15,23,42,0.35)]">
                    <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                  </div>
                  <p className="text-base font-black text-slate-600">{isEn ? 'Campaign Closed' : '마감된 캠페인'}</p>
                  <p className="text-sm text-slate-400 font-medium mt-1">{closedReason}</p>
                </div>
              </div>
            )}

            {!isApplied && !isClosed && showApplyForm && (
              <div className="py-5">
                <div className="border border-blue-200 rounded-2xl p-5 md:p-6 bg-gradient-to-b from-blue-50/50 to-white space-y-4 shadow-[0_12px_30px_-14px_rgba(37,99,235,0.5)]">
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    {isEn ? 'Apply for Campaign' : '캠페인 지원하기'}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium -mt-2">{isEn ? 'Enter information for brand review' : '브랜드가 검토할 정보를 입력해 주세요'}</p>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Contact Info' : '연락처'} <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      value={applyForm.contact}
                      onChange={e => setApplyForm(p => ({ ...p, contact: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                      placeholder={isEn ? 'Email or phone number' : '이메일 또는 전화번호'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'Instagram URL' : '인스타그램 링크'} <span className="text-rose-500">*</span></label>
                    <input
                      type="url"
                      value={applyForm.instagram_url}
                      onChange={e => setApplyForm(p => ({ ...p, instagram_url: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                      placeholder="https://instagram.com/username"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">{isEn ? 'YouTube / Naver URL' : '유튜브 / 네이버 링크'} <span className="text-slate-400 font-medium">({isEn ? 'Optional' : '선택'})</span></label>
                    <input
                      type="url"
                      value={applyForm.youtube_naver_url}
                      onChange={e => setApplyForm(p => ({ ...p, youtube_naver_url: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                      placeholder={isEn ? 'https://youtube.com/... or blog link' : 'https://youtube.com/... 또는 https://blog.naver.com/...'}
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleApply}
                      disabled={applying || !applyForm.contact.trim() || !applyForm.instagram_url.trim()}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-black text-sm transition-all disabled:opacity-50 disabled:shadow-none shadow-[0_10px_24px_-10px_rgba(37,99,235,0.75)] hover:shadow-[0_14px_30px_-10px_rgba(37,99,235,0.85)] hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
                    >
                      {applying ? (
                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {isEn ? 'Submitting...' : '지원 중...'}</>
                      ) : (isEn ? 'Submit Application' : '지원하기')}
                    </button>
                    <button
                      onClick={() => setShowApplyForm(false)}
                      className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 transition-colors"
                    >
                      {isEn ? 'Cancel' : '취소'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!isApplied && !isClosed && !showApplyForm && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-lg border-t border-slate-100 safe-area-bottom shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.35)]">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {reward && (
                  <p className="text-lg font-black text-blue-700 truncate">{reward.headline}</p>
                )}
                {headcount > 0 && (
                  <p className="text-[11px] text-slate-400 font-bold">
                    {selectedCampaign.application_count}/{headcount}{isEn ? ' applied' : '명 지원중'}
                    {quotaReached && <span className="text-emerald-600 ml-1">{isEn ? 'Open past quota' : '정원 초과 지원 가능'}</span>}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowApplyForm(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3.5 rounded-2xl font-black text-sm transition-all shadow-[0_12px_28px_-10px_rgba(37,99,235,0.8)] hover:shadow-[0_16px_34px_-10px_rgba(37,99,235,0.9)] hover:-translate-y-0.5 active:translate-y-0 flex items-center gap-2 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                {isEn ? 'Apply Now' : '지원하기'}
              </button>
            </div>
          </div>
        )}

        <Toast
          message={toast?.message || ''}
          isVisible={!!toast}
          onClose={() => setToast(null)}
          type={toast?.type || 'success'}
        />
      </div>
    );
  }

  // --- Campaign List View ---
  return (
    <div className="p-4 md:p-8 w-full animate-in fade-in duration-300 max-w-4xl mx-auto">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 font-bold text-sm mb-4 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          {isEn ? 'Back' : '뒤로'}
        </button>
      )}

      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-black text-slate-900 mb-1">{isEn ? 'Campaigns' : '캠페인'}</h2>
        <p className="text-sm text-slate-400 font-medium">
          {isEn ? 'Apply directly to product sponsorship & group buy campaigns to find collaboration opportunities' : '제품 협찬 · 공동구매 캠페인에 직접 지원하고 협업 기회를 잡아보세요'}
        </p>
      </div>

      {userName && (
        <div className="mb-6">
          <CreatorCollabWorkspace userName={userName} hideWhenEmpty />
        </div>
      )}

      {userName && (
        <div className="mb-6">
          <CreatorOfferInbox
            userName={userName}
            hideWhenEmpty
            onNotify={(message, type = 'success') => setToast({ message, type })}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 mb-6">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white shadow-[0_4px_14px_-8px_rgba(15,23,42,0.35)]"
              placeholder={isEn ? 'Search campaigns...' : '캠페인 검색...'}
            />
          </div>
        </form>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {rewardFilters.map(f => (
            <button
              key={f.value}
              onClick={() => changeFilter(f.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-black whitespace-nowrap transition-all ${
                activeFilter === f.value
                  ? 'bg-slate-900 text-white shadow-[0_6px_14px_-6px_rgba(15,23,42,0.85)] -translate-y-px'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 shadow-[0_2px_6px_-3px_rgba(15,23,42,0.3)] hover:shadow-[0_5px_12px_-5px_rgba(15,23,42,0.4)] hover:-translate-y-px'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs font-bold text-slate-400 whitespace-nowrap pl-2">{total}{isEn ? ' total' : '개'}</span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          <button
            onClick={() => changeCategory('')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${
              activeCategory === ''
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {isEn ? 'All Categories' : '전체 카테고리'}
          </button>
          {Object.entries(categoriesMap).map(([value, label]) => (
            <button
              key={value}
              onClick={() => changeCategory(value)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${
                activeCategory === value
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <CollabMatchRegister variant="influencer" applicantUsername={userName} />
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">{isEn ? 'Loading campaigns...' : '캠페인 불러오는 중...'}</p>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">📢</span>
          </div>
          <h3 className="text-base font-black text-slate-900 mb-1">
            {activeCategory || activeFilter || searchQuery.trim()
              ? (isEn ? 'No campaigns match your criteria' : '조건에 맞는 캠페인이 없습니다')
              : (isEn ? 'No recruiting campaigns found' : '모집중인 캠페인이 없습니다')}
          </h3>
          <p className="text-sm text-slate-400 font-medium">
            {activeCategory || activeFilter || searchQuery.trim()
              ? (isEn ? 'Try changing your category or filter selection' : '카테고리나 진행 방식을 바꿔 보세요')
              : (isEn ? 'New campaigns will be listed here once registered' : '새로운 캠페인이 등록되면 여기에 표시됩니다')}
          </p>
          {(activeCategory || activeFilter) && (
            <button
              onClick={() => { changeFilter(''); changeCategory(''); }}
              className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black"
            >
              {isEn ? 'Reset All Filters' : '조건 모두 해제'}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 md:gap-5 py-1">
          {filteredCampaigns.map(campaign => {
            const isApplied = appliedIds.has(campaign.id);
            const deadline = deadlineInfo(campaign.end_date, isEn);
            const reward = rewardText(campaign, isEn);
            const headcount = headcountOf(campaign);
            return (
              <div
                key={campaign.id}
                onClick={() => setSelectedCampaign(campaign)}
                className="bg-white rounded-2xl border border-slate-100 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.12)] hover:border-blue-200 hover:shadow-[0_12px_28px_-6px_rgba(37,99,235,0.25)] hover:-translate-y-1 transition-all duration-300 cursor-pointer group overflow-hidden"
              >
                <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
                  {campaign.thumbnail_url ? (
                    <img
                      src={campaign.thumbnail_url}
                      alt={campaign.title}
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
                      {modeBadge(campaign, isEn)}
                    </span>
                    {deadline && (
                      <span className={`${deadline.urgent ? 'bg-rose-500' : 'bg-slate-900/85'} text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm`}>
                        {deadline.label}
                      </span>
                    )}
                  </div>
                  {isApplied && (
                    <div className="absolute top-2.5 right-2.5">
                      <span className={`${acceptedCampaigns.has(campaign.id) ? 'bg-blue-500' : 'bg-emerald-500'} text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm`}>
                        {acceptedCampaigns.has(campaign.id) ? (isEn ? 'Accepted' : '수락됨') : (isEn ? 'Applied' : '지원완료')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-2.5 md:p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    {campaign.brand_name && (
                      <span className="text-[10px] text-slate-400 font-bold truncate">{campaign.brand_name}</span>
                    )}
                    {campaign.category && (
                      <>
                        <span className="text-slate-200">·</span>
                        <span className="text-[10px] text-slate-400 font-medium truncate">{categoriesMap[campaign.category] || campaign.category}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-black text-xs md:text-sm text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1">
                    {campaign.title}
                  </h3>
                  <div className="flex items-center justify-between">
                    {reward ? (
                      <span className="text-xs font-black text-rose-500">{reward.short}</span>
                    ) : <span />}
                    <span className="text-[10px] text-slate-400 font-bold">
                      {headcount > 0
                        ? `${campaign.application_count}/${headcount}${isEn ? ' people' : '명'}`
                        : `${campaign.application_count}${isEn ? ' applied' : '명 지원중'}`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-8">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:border-slate-300"
          >
            {isEn ? 'Prev' : '이전'}
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
            .map((n, idx, arr) => (
              <React.Fragment key={n}>
                {idx > 0 && n - arr[idx - 1] > 1 && (
                  <span className="px-1 text-xs font-black text-slate-300">…</span>
                )}
                <button
                  onClick={() => goToPage(n)}
                  className={`min-w-[36px] px-2.5 py-2 rounded-xl text-xs font-black transition-all ${
                    n === page
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {n}
                </button>
              </React.Fragment>
            ))}
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-2 rounded-xl text-xs font-black bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:border-slate-300"
          >
            {isEn ? 'Next' : '다음'}
          </button>
        </div>
      )}

      <Toast
        message={toast?.message || ''}
        isVisible={!!toast}
        onClose={() => setToast(null)}
        type={toast?.type || 'success'}
      />
    </div>
  );
};

export default UserCampaignBrowse;
