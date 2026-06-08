import React, { useState, useEffect, useCallback } from 'react';
import { formatKoreanWon } from '../utils/formatters';

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
}

interface UserCampaignBrowseProps {
  userName: string;
  onBack?: () => void;
}

const REWARD_FILTERS = [
  { value: '', label: '전체' },
  { value: 'ad_collab', label: '광고 협업' },
  { value: 'group_buy', label: '공동구매' },
  { value: 'other', label: '기타' },
];

const CATEGORIES: Record<string, string> = {
  beauty: '뷰티', fashion: '패션', food: '식품', lifestyle: '라이프스타일',
  travel: '여행', health: '건강', tech: 'IT/테크', parenting: '육아',
  pet: '반려동물', interior: '인테리어', sports: '스포츠',
  entertainment: '엔터테인먼트', education: '교육', other: '기타',
};

const TYPE_LABELS: Record<string, string> = {
  ad_collab: '광고 협업', group_buy: '공동구매', other: '기타',
  collaboration: '협업', advertisement: '광고/협찬', review: '리뷰', event: '이벤트',
};

const REWARD_LABELS: Record<string, string> = {
  fixed: '고정 금액', product: '제품 제공', revenue_share: '수익 배분', mixed: '복합',
};

const UserCampaignBrowse: React.FC<UserCampaignBrowseProps> = ({ userName, onBack }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [acceptedCampaigns, setAcceptedCampaigns] = useState<Map<string, string>>(new Map());
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState({ contact: '', instagram_url: '', youtube_naver_url: '' });

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/api/campaigns?status=active';
      if (activeFilter) url += `&type=${activeFilter}`;
      if (searchQuery.trim()) url = `/api/campaigns?status=active&search=${encodeURIComponent(searchQuery.trim())}`;
      if (activeFilter && searchQuery.trim()) url += `&type=${activeFilter}`;
      const res = await fetch(url);
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch {
      console.error('Failed to fetch campaigns');
    } finally {
      setLoading(false);
    }
  }, [activeFilter, searchQuery]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    const fetchApplied = async () => {
      try {
        const res = await fetch(`/api/campaign-applications?username=${userName}`);
        const data = await res.json();
        const apps = data.applications || [];
        const ids = new Set<string>(apps.map((a: any) => a.campaign_id));
        setAppliedIds(ids);
        const accepted = new Map<string, string>();
        apps.forEach((a: any) => {
          if (a.status === 'accepted') {
            accepted.set(a.campaign_id, a.applicant_username);
          }
        });
        setAcceptedCampaigns(accepted);
      } catch {}
    };
    if (userName) fetchApplied();
  }, [userName]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCampaigns();
  };

  const handleApply = async () => {
    if (!selectedCampaign) return;
    setApplying(true);
    try {
      const res = await fetch('/api/campaign-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: selectedCampaign.id,
          applicant_username: userName,
          contact: applyForm.contact,
          instagram_url: applyForm.instagram_url,
          youtube_naver_url: applyForm.youtube_naver_url,
        }),
      });
      if (res.ok) {
        setAppliedIds(prev => new Set(prev).add(selectedCampaign.id));
        setShowApplyForm(false);
        setApplyForm({ contact: '', instagram_url: '', youtube_naver_url: '' });
        alert('지원이 완료되었습니다!');
        fetchCampaigns();
      } else {
        const err = await res.json();
        alert(err.error || '지원에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setApplying(false);
    }
  };

  const daysRemaining = (endDate: string) => {
    if (!endDate) return null;
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return null;
    if (diff === 0) return 'D-Day';
    return `D-${diff}`;
  };

  const formatDate = (d: string) => {
    if (!d) return '';
    const date = new Date(d);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };

  const filteredCampaigns = campaigns.filter(c => c.business_username !== userName);

  // --- Campaign Detail View ---
  if (selectedCampaign) {
    const isApplied = appliedIds.has(selectedCampaign.id);
    const days = selectedCampaign.end_date ? daysRemaining(selectedCampaign.end_date) : null;
    const applicantPercent = selectedCampaign.max_applicants > 0
      ? Math.min(100, Math.round((selectedCampaign.application_count / selectedCampaign.max_applicants) * 100))
      : 0;
    const isAlmostFull = selectedCampaign.max_applicants > 0 && applicantPercent >= 80;

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
            {days && (
              <span className="bg-rose-500 text-white px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0">{days}</span>
            )}
          </div>
        </div>

        <div className="max-w-3xl mx-auto">
          {/* Hero Image */}
          <div className="w-full aspect-[4/3] md:aspect-[16/9] bg-slate-100 overflow-hidden relative">
            {selectedCampaign.thumbnail_url ? (
              <img src={selectedCampaign.thumbnail_url} alt={selectedCampaign.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 via-pink-50 to-orange-50">
                <svg className="w-16 h-16 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {/* Gradient overlay at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />
            {/* Badges on image */}
            <div className="absolute top-4 left-4 flex items-center gap-2 flex-wrap">
              <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-[11px] font-black shadow-lg">
                {TYPE_LABELS[selectedCampaign.type] || selectedCampaign.type}
              </span>
              {selectedCampaign.category && (
                <span className="bg-white/90 backdrop-blur-sm text-slate-700 px-3 py-1 rounded-full text-[11px] font-bold shadow-sm">
                  {CATEGORIES[selectedCampaign.category] || selectedCampaign.category}
                </span>
              )}
            </div>
            {isApplied && (
              <div className="absolute top-4 right-4">
                <span className={`${acceptedCampaigns.has(selectedCampaign.id) ? 'bg-blue-600' : 'bg-emerald-500'} text-white px-3 py-1 rounded-full text-[11px] font-black shadow-lg`}>
                  {acceptedCampaigns.has(selectedCampaign.id) ? '수락됨' : '지원완료'}
                </span>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="px-4 md:px-8">
            {/* Brand & Title Section */}
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
                <span>등록 {formatDate(selectedCampaign.created_at)}</span>
                {days && (
                  <>
                    <span className="text-slate-200">|</span>
                    <span className={`font-black ${days === 'D-Day' ? 'text-rose-500' : 'text-rose-400'}`}>{days}</span>
                  </>
                )}
              </div>
            </div>

            {/* Key Info Cards */}
            <div className="py-5 border-b border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                {/* Reward Card */}
                {selectedCampaign.reward_amount && (
                  <div className="col-span-2 bg-gradient-to-r from-blue-50 to-pink-50 border border-blue-100 rounded-2xl p-4 md:p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </div>
                      <span className="text-xs text-blue-500 font-black uppercase tracking-wider">리워드</span>
                    </div>
                    <p className="text-2xl font-black text-blue-700">{formatKoreanWon(selectedCampaign.reward_amount)}</p>
                    <span className="text-xs font-bold text-blue-400 mt-1 inline-block">{REWARD_LABELS[selectedCampaign.reward_type] || ''}</span>
                  </div>
                )}

                {/* Recruitment Card */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-blue-50 rounded-lg flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                    <span className="text-[10px] text-slate-400 font-black uppercase">모집 인원</span>
                  </div>
                  <p className="text-lg font-black text-slate-900">
                    {selectedCampaign.max_applicants > 0
                      ? <><span className="text-blue-600">{selectedCampaign.application_count}</span> / {selectedCampaign.max_applicants}명</>
                      : <><span className="text-blue-600">{selectedCampaign.application_count}</span>명 지원</>}
                  </p>
                  {selectedCampaign.max_applicants > 0 && (
                    <div className="mt-2">
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${isAlmostFull ? 'bg-rose-500' : 'bg-blue-500'}`}
                          style={{ width: `${applicantPercent}%` }}
                        />
                      </div>
                      {isAlmostFull && (
                        <p className="text-[10px] text-rose-500 font-bold mt-1">마감 임박!</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Period Card */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 bg-emerald-50 rounded-lg flex items-center justify-center">
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <span className="text-[10px] text-slate-400 font-black uppercase">캠페인 기간</span>
                  </div>
                  {selectedCampaign.start_date ? (
                    <div>
                      <p className="text-sm font-black text-slate-900">{formatDate(selectedCampaign.start_date)}</p>
                      {selectedCampaign.end_date && <p className="text-sm font-black text-slate-900">~ {formatDate(selectedCampaign.end_date)}</p>}
                    </div>
                  ) : selectedCampaign.end_date ? (
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold">마감일</p>
                      <p className="text-sm font-black text-slate-900">{formatDate(selectedCampaign.end_date)}</p>
                    </div>
                  ) : (
                    <p className="text-sm font-bold text-slate-400">상시 모집</p>
                  )}
                </div>
              </div>
            </div>

            {/* Campaign Progress Timeline */}
            {(selectedCampaign.start_date || selectedCampaign.end_date) && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  캠페인 진행 일정
                </h3>
                <div className="relative pl-6">
                  <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-slate-200" />

                  {selectedCampaign.start_date && (
                    <div className="relative mb-5">
                      <div className="absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full border-2 border-blue-500 bg-white flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                      </div>
                      <div>
                        <p className="text-xs font-black text-blue-600">캠페인 시작</p>
                        <p className="text-sm font-bold text-slate-700 mt-0.5">{formatDate(selectedCampaign.start_date)}</p>
                      </div>
                    </div>
                  )}

                  {selectedCampaign.end_date && (
                    <div className="relative mb-1">
                      <div className={`absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full border-2 ${days ? 'border-slate-300 bg-white' : 'border-rose-500 bg-rose-500'} flex items-center justify-center`}>
                        {!days && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <div>
                        <p className={`text-xs font-black ${days ? 'text-slate-400' : 'text-rose-500'}`}>
                          {days ? '캠페인 마감' : '마감 완료'}
                        </p>
                        <p className="text-sm font-bold text-slate-700 mt-0.5">{formatDate(selectedCampaign.end_date)}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Campaign Description */}
            {selectedCampaign.description && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  캠페인 상세 설명
                </h3>
                <div className="bg-slate-50 rounded-2xl p-5 md:p-6">
                  <div className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-[1.8]">
                    {selectedCampaign.description}
                  </div>
                </div>
              </div>
            )}

            {/* Requirements */}
            {selectedCampaign.requirements && (
              <div className="py-5 border-b border-slate-100">
                <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  지원 조건
                </h3>
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 md:p-6">
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

            {/* Campaign Info Summary Table */}
            <div className="py-5 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                캠페인 정보
              </h3>
              <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-50">
                <div className="flex items-center px-5 py-3.5">
                  <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">유형</span>
                  <span className="text-sm text-slate-900 font-bold">{TYPE_LABELS[selectedCampaign.type] || selectedCampaign.type}</span>
                </div>
                {selectedCampaign.category && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">카테고리</span>
                    <span className="text-sm text-slate-900 font-bold">{CATEGORIES[selectedCampaign.category] || selectedCampaign.category}</span>
                  </div>
                )}
                {selectedCampaign.brand_name && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">브랜드</span>
                    <span className="text-sm text-slate-900 font-bold">{selectedCampaign.brand_name}</span>
                  </div>
                )}
                {selectedCampaign.reward_type && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">보상 유형</span>
                    <span className="text-sm text-slate-900 font-bold">{REWARD_LABELS[selectedCampaign.reward_type] || selectedCampaign.reward_type}</span>
                  </div>
                )}
                {selectedCampaign.reward_amount && (
                  <div className="flex items-center px-5 py-3.5">
                    <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">보상 금액</span>
                    <span className="text-sm text-blue-700 font-black">{formatKoreanWon(selectedCampaign.reward_amount)}</span>
                  </div>
                )}
                <div className="flex items-center px-5 py-3.5">
                  <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">모집 인원</span>
                  <span className="text-sm text-slate-900 font-bold">
                    {selectedCampaign.max_applicants > 0
                      ? `${selectedCampaign.max_applicants}명`
                      : '제한 없음'}
                  </span>
                </div>
                <div className="flex items-center px-5 py-3.5">
                  <span className="text-xs text-slate-400 font-bold w-24 flex-shrink-0">등록일</span>
                  <span className="text-sm text-slate-900 font-bold">{formatDate(selectedCampaign.created_at)}</span>
                </div>
              </div>
            </div>

            {/* Apply Section (inline for accepted/applied states) */}
            {isApplied && (
              <div className="py-5">
                {acceptedCampaigns.has(selectedCampaign.id) ? (
                  <div className="space-y-3">
                    <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-5 text-center">
                      <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                      </div>
                      <p className="text-base font-black text-emerald-700">협업이 승인되었습니다!</p>
                      <p className="text-sm text-emerald-500 font-medium mt-1">채팅으로 브랜드와 소통을 시작해보세요</p>
                    </div>
                    <button
                      onClick={() => {
                        const proposalId = `campaign_${selectedCampaign.id}_${userName.toLowerCase()}`;
                        window.dispatchEvent(new CustomEvent('navigate-timeline', { detail: { proposalId } }));
                      }}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-black text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                      브랜드와 채팅하기
                    </button>
                  </div>
                ) : (
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 text-center">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <p className="text-base font-black text-blue-700">지원 완료</p>
                    <p className="text-sm text-blue-400 font-medium mt-1">브랜드의 검토 후 결과를 안내해 드립니다</p>
                  </div>
                )}
              </div>
            )}

            {/* Apply Form (inline, above fixed button) */}
            {!isApplied && showApplyForm && (
              <div className="py-5">
                <div className="border border-blue-200 rounded-2xl p-5 md:p-6 bg-gradient-to-b from-blue-50/50 to-white space-y-4">
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    캠페인 지원하기
                  </h3>
                  <p className="text-xs text-slate-400 font-medium -mt-2">브랜드가 검토할 정보를 입력해 주세요</p>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">연락처 <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      value={applyForm.contact}
                      onChange={e => setApplyForm(p => ({ ...p, contact: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                      placeholder="이메일 또는 전화번호"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">인스타그램 링크 <span className="text-rose-500">*</span></label>
                    <input
                      type="url"
                      value={applyForm.instagram_url}
                      onChange={e => setApplyForm(p => ({ ...p, instagram_url: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                      placeholder="https://instagram.com/username"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">유튜브 / 네이버 링크 <span className="text-slate-400 font-medium">(선택)</span></label>
                    <input
                      type="url"
                      value={applyForm.youtube_naver_url}
                      onChange={e => setApplyForm(p => ({ ...p, youtube_naver_url: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                      placeholder="https://youtube.com/... 또는 https://blog.naver.com/..."
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleApply}
                      disabled={applying || !applyForm.contact.trim() || !applyForm.instagram_url.trim()}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {applying ? (
                        <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 지원 중...</>
                      ) : '지원하기'}
                    </button>
                    <button
                      onClick={() => setShowApplyForm(false)}
                      className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 transition-colors"
                    >
                      취소
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Fixed Bottom CTA */}
        {!isApplied && !showApplyForm && (
          <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/90 backdrop-blur-lg border-t border-slate-100 safe-area-bottom">
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {selectedCampaign.reward_amount && (
                  <p className="text-lg font-black text-blue-700 truncate">{formatKoreanWon(selectedCampaign.reward_amount)}</p>
                )}
                {selectedCampaign.max_applicants > 0 && (
                  <p className="text-[11px] text-slate-400 font-bold">
                    {selectedCampaign.application_count}/{selectedCampaign.max_applicants}명 지원중
                    {isAlmostFull && <span className="text-rose-500 ml-1">마감 임박</span>}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowApplyForm(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3.5 rounded-2xl font-black text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                지원하기
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Campaign List View ---
  return (
    <div className="p-4 md:p-8 w-full animate-in fade-in duration-300 max-w-4xl mx-auto">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 font-bold text-sm mb-4 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          뒤로
        </button>
      )}

      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-black text-slate-900 mb-1">캠페인</h2>
        <p className="text-sm text-slate-400 font-medium">브랜드 캠페인에 지원하고 협업 기회를 잡아보세요</p>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col gap-3 mb-6">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
              placeholder="캠페인 검색..."
            />
          </div>
        </form>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {REWARD_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setActiveFilter(f.value)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-black whitespace-nowrap transition-all ${
                activeFilter === f.value
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs font-bold text-slate-400 whitespace-nowrap pl-2">{filteredCampaigns.length}개</span>
        </div>
      </div>

      {/* Campaign Cards */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">캠페인 불러오는 중...</p>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">📢</span>
          </div>
          <h3 className="text-base font-black text-slate-900 mb-1">모집중인 캠페인이 없습니다</h3>
          <p className="text-sm text-slate-400 font-medium">새로운 캠페인이 등록되면 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 md:gap-5 py-1">
          {filteredCampaigns.map(campaign => {
            const isApplied = appliedIds.has(campaign.id);
            const days = campaign.end_date ? daysRemaining(campaign.end_date) : null;
            return (
              <div
                key={campaign.id}
                onClick={() => setSelectedCampaign(campaign)}
                className="bg-white rounded-2xl border border-slate-100 shadow-[0_4px_16px_-4px_rgba(15,23,42,0.12)] hover:border-blue-200 hover:shadow-[0_12px_28px_-6px_rgba(37,99,235,0.25)] hover:-translate-y-1 transition-all duration-300 cursor-pointer group overflow-hidden"
              >
                {/* Thumbnail */}
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
                  {/* Badges overlay */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span className="bg-white/90 backdrop-blur-sm text-blue-700 px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm">
                      {TYPE_LABELS[campaign.type] || campaign.type}
                    </span>
                    {days && (
                      <span className="bg-rose-500 text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm">
                        {days}
                      </span>
                    )}
                  </div>
                  {isApplied && (
                    <div className="absolute top-2.5 right-2.5">
                      <span className={`${acceptedCampaigns.has(campaign.id) ? 'bg-blue-500' : 'bg-emerald-500'} text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm`}>
                        {acceptedCampaigns.has(campaign.id) ? '수락됨' : '지원완료'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-2.5 md:p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    {campaign.brand_name && (
                      <span className="text-[10px] text-slate-400 font-bold truncate">{campaign.brand_name}</span>
                    )}
                    {campaign.category && (
                      <>
                        <span className="text-slate-200">·</span>
                        <span className="text-[10px] text-slate-400 font-medium truncate">{CATEGORIES[campaign.category] || campaign.category}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-black text-xs md:text-sm text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1">
                    {campaign.title}
                  </h3>
                  <div className="flex items-center justify-between">
                    {campaign.reward_amount ? (
                      <span className="text-xs font-black text-rose-500">{formatKoreanWon(campaign.reward_amount)}</span>
                    ) : <span />}
                    <span className="text-[10px] text-slate-400 font-bold">
                      {campaign.max_applicants > 0
                        ? `${campaign.application_count}/${campaign.max_applicants}명`
                        : `${campaign.application_count}명 지원중`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default UserCampaignBrowse;
