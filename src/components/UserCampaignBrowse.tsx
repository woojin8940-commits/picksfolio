import React, { useState, useEffect, useCallback } from 'react';

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
  { value: 'collaboration', label: '협업' },
  { value: 'advertisement', label: '광고/협찬' },
  { value: 'review', label: '리뷰' },
  { value: 'event', label: '이벤트' },
];

const CATEGORIES: Record<string, string> = {
  fashion: '패션', beauty: '뷰티', food: '맛집/음식', travel: '여행',
  lifestyle: '라이프스타일', tech: '테크/IT', fitness: '운동/건강',
  baby: '유아/키즈', pet: '반려동물', other: '기타',
};

const TYPE_LABELS: Record<string, string> = {
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
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applyForm, setApplyForm] = useState({ message: '', contact: '', portfolio_url: '' });

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      let url = '/api/campaigns?status=active';
      if (activeFilter) url += `&type=${activeFilter}`;
      if (searchQuery.trim()) url = `/api/campaigns?status=active&search=${encodeURIComponent(searchQuery.trim())}`;
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
        const ids = new Set<string>((data.applications || []).map((a: any) => a.campaign_id));
        setAppliedIds(ids);
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
          message: applyForm.message,
          contact: applyForm.contact,
          portfolio_url: applyForm.portfolio_url,
        }),
      });
      if (res.ok) {
        setAppliedIds(prev => new Set(prev).add(selectedCampaign.id));
        setShowApplyForm(false);
        setApplyForm({ message: '', contact: '', portfolio_url: '' });
        alert('신청이 완료되었습니다!');
        fetchCampaigns();
      } else {
        const err = await res.json();
        alert(err.error || '신청에 실패했습니다.');
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
    return (
      <div className="p-4 md:p-8 w-full animate-in fade-in duration-300 max-w-3xl mx-auto">
        <button
          onClick={() => { setSelectedCampaign(null); setShowApplyForm(false); }}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-700 font-bold text-sm mb-5 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          목록으로
        </button>

        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          {selectedCampaign.thumbnail_url && (
            <div className="w-full h-52 md:h-72 bg-slate-100 overflow-hidden">
              <img src={selectedCampaign.thumbnail_url} alt={selectedCampaign.title} className="w-full h-full object-cover" />
            </div>
          )}

          <div className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="bg-purple-100 text-purple-700 px-2.5 py-0.5 rounded-full text-[10px] font-black">
                {TYPE_LABELS[selectedCampaign.type] || selectedCampaign.type}
              </span>
              {selectedCampaign.category && (
                <span className="bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                  {CATEGORIES[selectedCampaign.category] || selectedCampaign.category}
                </span>
              )}
              {selectedCampaign.end_date && daysRemaining(selectedCampaign.end_date) && (
                <span className="bg-rose-50 text-rose-500 px-2.5 py-0.5 rounded-full text-[10px] font-black">
                  {daysRemaining(selectedCampaign.end_date)}
                </span>
              )}
            </div>

            <h2 className="text-xl md:text-2xl font-black text-slate-900 mb-1">{selectedCampaign.title}</h2>
            {selectedCampaign.brand_name && (
              <p className="text-sm text-slate-400 font-bold mb-4">{selectedCampaign.brand_name}</p>
            )}

            {selectedCampaign.reward_amount && (
              <div className="bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-100 rounded-xl p-4 mb-5">
                <p className="text-[9px] text-rose-400 font-black uppercase tracking-widest mb-1">리워드</p>
                <p className="text-lg font-black text-rose-600">
                  {selectedCampaign.reward_amount}
                  <span className="text-xs font-bold text-rose-400 ml-2">{REWARD_LABELS[selectedCampaign.reward_type] || ''}</span>
                </p>
              </div>
            )}

            {selectedCampaign.description && (
              <div className="mb-5">
                <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-2">캠페인 상세 설명</p>
                <div className="bg-slate-50 rounded-xl p-4 md:p-5">
                  <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">
                    {selectedCampaign.description}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 mb-5">
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[9px] text-slate-400 font-black uppercase">모집 인원</p>
                <p className="text-sm font-black text-slate-900 mt-0.5">
                  {selectedCampaign.max_applicants > 0
                    ? `${selectedCampaign.application_count} / ${selectedCampaign.max_applicants}명`
                    : `${selectedCampaign.application_count}명 신청`}
                </p>
              </div>
              {selectedCampaign.start_date && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[9px] text-slate-400 font-black uppercase">캠페인 기간</p>
                  <p className="text-xs font-bold text-slate-900 mt-0.5">
                    {formatDate(selectedCampaign.start_date)}
                    {selectedCampaign.end_date && ` ~ ${formatDate(selectedCampaign.end_date)}`}
                  </p>
                </div>
              )}
              {!selectedCampaign.start_date && selectedCampaign.end_date && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[9px] text-slate-400 font-black uppercase">마감일</p>
                  <p className="text-xs font-bold text-slate-900 mt-0.5">{formatDate(selectedCampaign.end_date)}</p>
                </div>
              )}
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[9px] text-slate-400 font-black uppercase">등록일</p>
                <p className="text-xs font-bold text-slate-900 mt-0.5">{formatDate(selectedCampaign.created_at)}</p>
              </div>
            </div>

            {selectedCampaign.requirements && (
              <div className="mb-5">
                <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-2">지원 조건</p>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-sm text-amber-800 font-medium whitespace-pre-wrap leading-relaxed">
                    {selectedCampaign.requirements}
                  </p>
                </div>
              </div>
            )}

            {/* Apply Section */}
            {isApplied ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                <p className="text-sm font-black text-emerald-600">이미 신청한 캠페인입니다</p>
                <p className="text-xs text-emerald-500 font-medium mt-1">결과를 기다려 주세요</p>
              </div>
            ) : showApplyForm ? (
              <div className="border border-purple-200 rounded-xl p-5 bg-purple-50/30 space-y-4">
                <h3 className="text-sm font-black text-slate-900">캠페인 신청</h3>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">자기소개 / 지원 메시지</label>
                  <textarea
                    value={applyForm.message}
                    onChange={e => setApplyForm(p => ({ ...p, message: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400 min-h-[100px] resize-y bg-white"
                    placeholder="간단한 자기소개와 지원 동기를 적어주세요"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">연락처</label>
                    <input
                      type="text"
                      value={applyForm.contact}
                      onChange={e => setApplyForm(p => ({ ...p, contact: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400 bg-white"
                      placeholder="이메일 또는 전화번호"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">포트폴리오 URL</label>
                    <input
                      type="url"
                      value={applyForm.portfolio_url}
                      onChange={e => setApplyForm(p => ({ ...p, portfolio_url: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400 bg-white"
                      placeholder="https://"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleApply}
                    disabled={applying}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {applying ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> 신청 중...</>
                    ) : '신청하기'}
                  </button>
                  <button
                    onClick={() => setShowApplyForm(false)}
                    className="px-5 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowApplyForm(true)}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-purple-600/20 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                캠페인 신청하기
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- Campaign List View ---
  return (
    <div className="p-4 md:p-8 w-full animate-in fade-in duration-300 max-w-3xl mx-auto">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 font-bold text-sm mb-4 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          뒤로
        </button>
      )}

      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg md:text-xl font-black text-slate-900">캠페인 리스트</h2>
          <span className="text-xs font-bold text-slate-400">{filteredCampaigns.length}개 모집중</span>
        </div>
        <p className="text-xs text-slate-400 font-medium">브랜드 캠페인에 신청하고 협업 기회를 잡아보세요</p>
      </div>

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-100 rounded-xl p-3.5 mb-5 flex items-center gap-3">
        <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
          <span className="text-lg">📢</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-purple-700">캠페인 모집 소식을 확인하세요</p>
          <p className="text-[10px] text-purple-400 font-medium mt-0.5">새로운 캠페인이 오면 알려드릴게요</p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400 bg-white"
            placeholder="캠페인 검색..."
          />
          <button type="submit" className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2.5 rounded-xl font-black text-sm transition-all shadow-sm">
            검색
          </button>
        </div>
      </form>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 mb-5 overflow-x-auto pb-1 scrollbar-hide">
        {REWARD_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-black whitespace-nowrap transition-all ${
              activeFilter === f.value
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Campaign Cards */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-3" />
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
        <div className="space-y-3">
          {filteredCampaigns.map(campaign => {
            const isApplied = appliedIds.has(campaign.id);
            const days = campaign.end_date ? daysRemaining(campaign.end_date) : null;
            return (
              <div
                key={campaign.id}
                className="bg-white rounded-2xl border border-slate-100 hover:border-purple-200 hover:shadow-md transition-all overflow-hidden group"
              >
                <div className="flex">
                  {/* Thumbnail */}
                  <div
                    className="w-24 h-24 md:w-32 md:h-32 flex-shrink-0 bg-slate-100 overflow-hidden cursor-pointer"
                    onClick={() => setSelectedCampaign(campaign)}
                  >
                    {campaign.thumbnail_url ? (
                      <img
                        src={campaign.thumbnail_url}
                        alt={campaign.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-50 to-pink-50">
                        <svg className="w-8 h-8 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 p-3 md:p-4 flex flex-col justify-between cursor-pointer" onClick={() => setSelectedCampaign(campaign)}>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[9px] font-black">
                          {TYPE_LABELS[campaign.type] || campaign.type}
                        </span>
                        {campaign.brand_name && (
                          <span className="text-[10px] text-slate-400 font-bold">{campaign.brand_name}</span>
                        )}
                        {campaign.category && (
                          <span className="text-[10px] text-slate-300 font-bold">{CATEGORIES[campaign.category] || campaign.category}</span>
                        )}
                      </div>
                      <h3 className="font-black text-sm text-slate-900 line-clamp-1 group-hover:text-purple-600 transition-colors">
                        {campaign.title}
                      </h3>
                      {campaign.description && (
                        <p className="text-[11px] text-slate-400 font-medium line-clamp-1 mt-0.5">{campaign.description}</p>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {campaign.reward_amount && (
                          <span className="text-sm font-black text-rose-500">{campaign.reward_amount}</span>
                        )}
                        <span className="text-[10px] text-slate-400 font-bold">
                          {campaign.max_applicants > 0
                            ? `${campaign.application_count}/${campaign.max_applicants}명`
                            : `${campaign.application_count}명 신청중`}
                        </span>
                        {days && (
                          <span className="text-[10px] font-black text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">{days}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Apply Button */}
                  <div className="flex items-center px-3 md:px-4 flex-shrink-0">
                    {isApplied ? (
                      <span className="bg-emerald-50 text-emerald-600 px-3 py-2 rounded-xl text-[10px] font-black whitespace-nowrap">
                        신청완료
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCampaign(campaign);
                          setShowApplyForm(true);
                        }}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-3 md:px-4 py-2 rounded-xl text-[10px] md:text-xs font-black whitespace-nowrap transition-all shadow-sm"
                      >
                        신청하기
                      </button>
                    )}
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
