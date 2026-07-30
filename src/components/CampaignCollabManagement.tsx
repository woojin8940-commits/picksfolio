import React, { useState, useEffect, useCallback } from 'react';
import { formatKoreanWon } from '../utils/formatters';
import { daysUntilDeadline, isPastDeadline, isQuotaReached } from '../utils/campaignRecruit';
import { authHeaders, apiService } from '../services/apiService';
import CollabMatchRegister from './CollabMatchRegister';
import BrandCollabProgress from './BrandCollabProgress';
import CampaignBriefComposer from './collab/CampaignBriefComposer';
import CampaignListupBoard from './collab/CampaignListupBoard';
import Toast from './Toast';

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
  admin_rejected_reason?: string;
  admin_approved_at?: string;
  created_at: string;
  recruit_closed?: boolean;
  // 캠페인 등록 때 브랜드가 작성하는 브리프. 담당자와 인플루언서가 이 내용으로 협업을
  // 시작하므로, 목록·상세 화면도 같이 읽는다.
  product_name?: string;
  product_url?: string;
  upload_channel?: string;
  content_format?: string;
  video_concept?: string;
  guideline_url?: string;
  guideline_note?: string;
  second_use_fee?: number;
  second_use_note?: string;
  upload_from?: string;
  upload_to?: string;
}

interface Applicant {
  id: string;
  campaign_id: string;
  applicant_username: string;
  message: string;
  contact: string;
  portfolio_url: string;
  instagram_url: string;
  youtube_naver_url: string;
  status: string;
  created_at: string;
  // 브랜드가 남기는 의견. 선정 권한과 분리된 값이라 status 와 다른 컬럼에 있다.
  brand_preference?: string;
  brand_preference_note?: string;
  // 담당자가 선정한 뒤 만들어지는 협업 본체.
  collab_id?: string;
  collab_status?: string;
  current_stage_key?: string;
}

interface CampaignCollabManagementProps {
  businessUsername: string;
  companyName: string;
}

const CAMPAIGN_TYPES = [
  { value: '', label: '전체' },
  { value: 'ad_collab', label: '광고 협업' },
  { value: 'group_buy', label: '공동구매' },
  { value: 'other', label: '기타' },
];

const CATEGORIES = [
  { value: '', label: '카테고리 선택' },
  { value: 'beauty', label: '뷰티' },
  { value: 'fashion', label: '패션' },
  { value: 'food', label: '식품' },
  { value: 'lifestyle', label: '라이프스타일' },
  { value: 'travel', label: '여행' },
  { value: 'health', label: '건강' },
  { value: 'tech', label: 'IT/테크' },
  { value: 'parenting', label: '육아' },
  { value: 'pet', label: '반려동물' },
  { value: 'interior', label: '인테리어' },
  { value: 'sports', label: '스포츠' },
  { value: 'entertainment', label: '엔터테인먼트' },
  { value: 'education', label: '교육' },
  { value: 'other', label: '기타' },
];

const categoryLabel = (val: string) => CATEGORIES.find(c => c.value === val)?.label || val || '-';

// Normalize a username for ownership comparison (strip biz/ prefix, lowercase),
// mirroring how the backend matches business_username.
const normalizeUser = (u: string) => (u || '').replace(/^biz\//, '').toLowerCase();

const CampaignCollabManagement: React.FC<CampaignCollabManagementProps> = ({ businessUsername, companyName }) => {
  const cacheKey = `picks_biz_campaigns_${businessUsername.replace(/^biz\//, '').toLowerCase()}`;

  const cachedCampaigns = (() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  })();

  const [campaigns, setCampaigns] = useState<Campaign[]>(cachedCampaigns);
  const [loading, setLoading] = useState(cachedCampaigns.length === 0);
  const [showForm, setShowForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [campaignManager, setCampaignManager] = useState('');
  const [prefSaving, setPrefSaving] = useState('');
  const [activeTypeFilter, setActiveTypeFilter] = useState('');
  const [viewMode, setViewMode] = useState<'mine' | 'all'>('mine');
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const notify = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns?business=${businessUsername}`);
      const data = await res.json();
      const fresh = data.campaigns || [];
      setCampaigns(fresh);
      try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {}
    } catch {
      console.error('Failed to fetch campaigns');
    } finally {
      setLoading(false);
    }
  }, [businessUsername, cacheKey]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const fetchAllCampaigns = useCallback(async () => {
    setAllLoading(true);
    try {
      const res = await fetch('/api/campaigns?status=active');
      const data = await res.json();
      setAllCampaigns(data.campaigns || []);
    } catch {
      console.error('Failed to fetch all campaigns');
    } finally {
      setAllLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'all') fetchAllCampaigns();
  }, [viewMode, fetchAllCampaigns]);

  const fetchApplicants = async (campaignId: string) => {
    setApplicantsLoading(true);
    try {
      // 지원자 연락처가 담긴 목록이라 서버가 캠페인 소유자(또는 담당자)인지 확인한다.
      const data = await apiService.getCampaignApplicants(campaignId);
      setApplicants(data.applicants || []);
      setCampaignManager(data.managerUsername || '');
    } catch {
      console.error('Failed to fetch applicants');
    } finally {
      setApplicantsLoading(false);
    }
  };

  const handleSelectCampaign = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    if (normalizeUser(campaign.business_username) === normalizeUser(businessUsername)) {
      setApplicants([]);
      fetchApplicants(campaign.id);
    } else {
      setApplicants([]);
    }
  };


  /**
   * 수정 진입. 폼 상태는 브리프 작성 화면이 직접 들고 있으므로 여기서는 무엇을
   * 수정하는지만 정한다 — 같은 값을 두 곳에서 들고 있으면 반드시 한쪽이 어긋난다.
   */
  const handleEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setShowForm(true);
    setSelectedCampaign(null);
  };

  const handleToggleStatus = async (campaign: Campaign) => {
    const newStatus = campaign.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: campaign.id, status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify(err.error || '상태 변경에 실패했습니다.', 'error');
        return;
      }
      notify(newStatus === 'active' ? '캠페인 모집을 재개했습니다.' : '캠페인을 마감했습니다.');
      fetchCampaigns();
      if (selectedCampaign?.id === campaign.id) {
        setSelectedCampaign({ ...selectedCampaign, status: newStatus });
      }
    } catch {
      notify('상태 변경에 실패했습니다.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/campaigns?id=${id}&business=${businessUsername}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        notify(data.error || '삭제에 실패했습니다.', 'error');
        return;
      }
      notify('캠페인을 삭제했습니다.');
      await fetchCampaigns();
      if (selectedCampaign?.id === id) setSelectedCampaign(null);
    } catch {
      notify('삭제에 실패했습니다.', 'error');
    }
  };

  /**
   * 브랜드 의견 표시.
   *
   * 예전에는 이 자리에 수락/거절 버튼이 있었다. 그 한 번의 클릭이 대화방과 정산까지
   * 만들어 냈지만, 그 뒤를 챙기는 사람이 정해져 있지 않았다. 이제 선정은 담당자가
   * 하고, 브랜드는 "이 사람이 좋다 / 아니다"를 남긴다 — 담당자에게 전달되는 메모다.
   */
  const handleApplicantPreference = async (applicantId: string, preference: 'shortlist' | 'pass' | '') => {
    setPrefSaving(applicantId);
    try {
      const res = await apiService.setApplicantPreference(applicantId, preference);
      if (res.error) {
        notify(res.error, 'error');
        return;
      }
      setApplicants(prev => prev.map(a => (a.id === applicantId ? { ...a, brand_preference: preference } : a)));
      notify(
        preference === 'shortlist'
          ? '추천으로 표시했습니다. 담당자가 확인 후 선정을 진행합니다.'
          : preference === 'pass'
            ? '보류로 표시했습니다.'
            : '의견을 지웠습니다.',
      );
    } finally {
      setPrefSaving('');
    }
  };

  /** 담당자 채널 열기. 브랜드는 인플루언서와 직접 대화하지 않는다. */
  const openManagerThread = (app: Applicant) => {
    if (!app.collab_id) return;
    window.dispatchEvent(
      new CustomEvent('navigate-timeline', { detail: { proposalId: `support_biz_${app.collab_id}` } }),
    );
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingCampaign(null);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      active: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: '모집중' },
      inactive: { bg: 'bg-slate-100', text: 'text-slate-500', label: '마감' },
      pending: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: '대기중' },
      pending_approval: { bg: 'bg-orange-50', text: 'text-orange-600', label: '승인 대기' },
      admin_rejected: { bg: 'bg-red-50', text: 'text-red-600', label: '승인 거절' },
      accepted: { bg: 'bg-blue-50', text: 'text-blue-600', label: '수락됨' },
      rejected: { bg: 'bg-red-50', text: 'text-red-600', label: '거절됨' },
    };
    const s = map[status] || { bg: 'bg-slate-100', text: 'text-slate-500', label: status };
    return <span className={`${s.bg} ${s.text} px-2.5 py-1 rounded-full text-[11px] font-black`}>{s.label}</span>;
  };

  // status가 'active'여도 종료일이 지난 캠페인은 크리에이터 화면에 더 이상 노출되지
  // 않는다. 브랜드가 그 이유를 알 수 있도록 "모집중" 대신 '기간 종료'를 보여 준다.
  // 모집 인원을 다 채운 것은 마감 사유가 아니다(정원이 차도 지원은 계속 받는다).
  const campaignStatusBadge = (campaign: Campaign) => {
    if (campaign.status === 'active' && isPastDeadline(campaign.end_date)) {
      return <span className="bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full text-[11px] font-black">기간 종료</span>;
    }
    return statusBadge(campaign.status);
  };

  const typeLabel = (type: string) => {
    const m: Record<string, string> = { ad_collab: '광고 협업', group_buy: '공동구매', other: '기타', collaboration: '협업', advertisement: '광고/협찬', review: '리뷰', event: '이벤트' };
    return m[type] || type;
  };

  const rewardLabel = (type: string) => {
    const m: Record<string, string> = { fixed: '고정 금액', product: '제품 제공', revenue_share: '수익 배분', mixed: '복합' };
    return m[type] || type;
  };

  /**
   * 마감까지 남은 기간. 한국 시간 기준으로 계산하며, 3일 이내면 임박으로 본다.
   * 종료일이 없거나(상시 모집) 이미 지났으면 null.
   */
  const deadlineInfo = (endDate: string) => {
    const remaining = daysUntilDeadline(endDate);
    if (remaining === null || remaining < 0) return null;
    return { label: remaining === 0 ? 'D-Day' : `D-${remaining}`, urgent: remaining <= 3 };
  };

  // 화면이 세 갈래(상세/폼/목록)로 나뉘어 있어 토스트를 각 갈래 끝에 함께 렌더한다.
  const toastEl = (
    <Toast
      message={toast?.message || ''}
      isVisible={!!toast}
      onClose={() => setToast(null)}
      type={toast?.type || 'success'}
    />
  );

  const sourceCampaigns = viewMode === 'all' ? allCampaigns : campaigns;  const listLoading = viewMode === 'all' ? allLoading : loading;
  const filteredCampaigns = activeTypeFilter
    ? sourceCampaigns.filter(c => c.type === activeTypeFilter)
    : sourceCampaigns;

  // --- Campaign Detail View ---
  if (selectedCampaign) {
    const isOwner = normalizeUser(selectedCampaign.business_username) === normalizeUser(businessUsername);
    return (
      <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-5xl mx-auto">
        <button onClick={() => setSelectedCampaign(null)} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          캠페인 목록
        </button>

        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm mb-6">
          {selectedCampaign.thumbnail_url && (
            <div className="w-full aspect-square max-w-[400px] mx-auto bg-slate-100 overflow-hidden">
              <img src={selectedCampaign.thumbnail_url} alt={selectedCampaign.title} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-6 md:p-8">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {campaignStatusBadge(selectedCampaign)}
                  <span className="text-[11px] text-slate-400 font-bold">{typeLabel(selectedCampaign.type)}</span>
                </div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900">{selectedCampaign.title}</h2>
                {selectedCampaign.brand_name && <p className="text-sm text-slate-500 font-bold mt-1">{selectedCampaign.brand_name}</p>}
              </div>
              {isOwner && (
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(selectedCampaign)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-black text-slate-600 transition-colors">
                    수정
                  </button>
                  {selectedCampaign.status !== 'pending_approval' && selectedCampaign.status !== 'admin_rejected' && (
                    <button onClick={() => handleToggleStatus(selectedCampaign)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-black text-slate-600 transition-colors">
                      {selectedCampaign.status === 'active' ? '마감' : '재개'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {selectedCampaign.description && <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap mb-5 leading-relaxed">{selectedCampaign.description}</p>}

            {selectedCampaign.status === 'pending_approval' && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-5">
                <p className="text-sm font-black text-orange-700">관리자 승인 대기 중</p>
                <p className="text-xs text-orange-500 font-medium mt-1">캠페인이 관리자 승인 후 공개됩니다.</p>
              </div>
            )}
            {selectedCampaign.status === 'admin_rejected' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
                <p className="text-sm font-black text-red-700">관리자에 의해 승인 거절됨</p>
                {selectedCampaign.admin_rejected_reason && (
                  <p className="text-xs text-red-500 font-medium mt-1">사유: {selectedCampaign.admin_rejected_reason}</p>
                )}
              </div>
            )}

            {selectedCampaign.status === 'active' && isPastDeadline(selectedCampaign.end_date) && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5">
                <p className="text-sm font-black text-slate-600">모집 기간이 종료되었습니다</p>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  크리에이터 캠페인 목록에 더 이상 노출되지 않습니다. 계속 모집하려면 수정에서 종료일을 연장해 주세요.
                </p>
              </div>
            )}

            {/* 정원을 채워도 지원은 계속 받는다 — 더 나은 지원자를 고를 수 있게 하기 위함. */}
            {selectedCampaign.status === 'active' && !isPastDeadline(selectedCampaign.end_date) && isQuotaReached(selectedCampaign) && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-5">
                <p className="text-sm font-black text-emerald-700">모집 인원을 모두 채웠습니다</p>
                <p className="text-xs text-emerald-600 font-medium mt-1">
                  모집 기간 동안에는 정원을 넘겨도 지원을 계속 받습니다. 더 많은 지원자 중에서 골라 보세요.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {selectedCampaign.category && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[9px] text-slate-400 font-black uppercase">카테고리</p>
                  <p className="text-sm font-black text-slate-900">{categoryLabel(selectedCampaign.category)}</p>
                </div>
              )}
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[9px] text-slate-400 font-black uppercase">보상</p>
                <p className="text-sm font-black text-slate-900">{rewardLabel(selectedCampaign.reward_type)} {selectedCampaign.reward_amount && `/ ${formatKoreanWon(selectedCampaign.reward_amount)}`}</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[9px] text-slate-400 font-black uppercase">지원자</p>
                <p className="text-sm font-black text-blue-600">{selectedCampaign.application_count}명{selectedCampaign.max_applicants > 0 && ` / ${selectedCampaign.max_applicants}명`}</p>
              </div>
              {selectedCampaign.start_date && (
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[9px] text-slate-400 font-black uppercase">기간</p>
                  <p className="text-sm font-black text-slate-900">{selectedCampaign.start_date}{selectedCampaign.end_date && ` ~ ${selectedCampaign.end_date}`}</p>
                </div>
              )}
            </div>

            {selectedCampaign.requirements && (
              <div className="mt-4 bg-slate-50 rounded-xl p-4">
                <p className="text-[9px] text-slate-400 font-black uppercase mb-2">지원 조건</p>
                <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap">{selectedCampaign.requirements}</p>
              </div>
            )}

            {/* 요청 브리프 — 담당자와 인플루언서가 협업을 시작할 때 그대로 읽는 내용이다.
                비어 있으면 칸을 감추지 않고 무엇이 빠졌는지 알려 준다. 선정 뒤에 다시
                물어보는 일을 줄이는 것이 이 카드의 목적이다. */}
            {(() => {
              const brief = [
                { label: '제품 · 서비스', value: selectedCampaign.product_name },
                { label: '업로드 채널', value: selectedCampaign.upload_channel },
                {
                  label: '희망 게시일',
                  value:
                    selectedCampaign.upload_from || selectedCampaign.upload_to
                      ? `${selectedCampaign.upload_from || '미정'} ~ ${selectedCampaign.upload_to || '미정'}`
                      : '',
                },
                {
                  label: '2차 활용',
                  value:
                    Number(selectedCampaign.second_use_fee || 0) > 0
                      ? `${formatKoreanWon(selectedCampaign.second_use_fee)}${selectedCampaign.second_use_note ? ` · ${selectedCampaign.second_use_note}` : ''}`
                      : '',
                },
              ].filter(r => r.value);
              const missing = !selectedCampaign.product_name || !selectedCampaign.video_concept;

              return (
                <div className="mt-4 border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[9px] text-slate-400 font-black uppercase">요청 브리프</p>
                    {isOwner && missing && (
                      <button
                        onClick={() => handleEdit(selectedCampaign)}
                        className="px-2.5 py-1 bg-orange-50 text-orange-600 rounded-lg text-[10px] font-black hover:bg-orange-100"
                      >
                        내용 채우기
                      </button>
                    )}
                  </div>

                  {brief.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                      {brief.map(r => (
                        <div key={r.label} className="bg-slate-50 rounded-lg px-3 py-2">
                          <p className="text-[9px] text-slate-400 font-black uppercase">{r.label}</p>
                          <p className="text-xs font-bold text-slate-800 mt-0.5">{r.value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedCampaign.product_url && (
                    <a
                      href={selectedCampaign.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mb-3 text-[11px] text-blue-600 font-black hover:underline"
                    >
                      제품 바로가기 →
                    </a>
                  )}

                  <div className="bg-slate-50 rounded-lg px-3 py-2.5">
                    <p className="text-[9px] text-slate-400 font-black uppercase mb-1">영상 컨셉</p>
                    <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">
                      {selectedCampaign.video_concept || (
                        <span className="text-orange-500 font-bold">
                          아직 적지 않으셨습니다. 인플루언서가 대본을 쓸 때 가장 먼저 보는 항목입니다.
                        </span>
                      )}
                    </p>
                  </div>

                  {(selectedCampaign.guideline_url || selectedCampaign.guideline_note) && (
                    <div className="bg-slate-50 rounded-lg px-3 py-2.5 mt-2">
                      <p className="text-[9px] text-slate-400 font-black uppercase mb-1">필수 확인 사항</p>
                      {selectedCampaign.guideline_note && (
                        <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">
                          {selectedCampaign.guideline_note}
                        </p>
                      )}
                      {selectedCampaign.guideline_url && (
                        <a
                          href={selectedCampaign.guideline_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-1.5 text-[11px] text-blue-600 font-black hover:underline"
                        >
                          가이드라인 문서 보기 →
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* 담당자가 올린 후보 명단. 지원을 기다리는 것과 별개로 진행되는 길이므로
            지원자 목록보다 위에 둔다 — 대부분의 캠페인은 이 명단에서 시작한다. */}
        {isOwner && (
          <div className="mb-6">
            <CampaignListupBoard campaignId={selectedCampaign.id} onNotify={notify} />
          </div>
        )}

        {/* Applicants — only the owning business can view the applicant list */}
        {isOwner ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-2">지원자 목록 ({applicants.length}명)</h3>
          {/* 선정 주체를 화면에서 분명히 해 둔다. 예전 흐름을 기억하는 브랜드가
              "수락 버튼이 없어졌다"고 느끼지 않도록 무엇을 하면 되는지 함께 적는다. */}
          <div className="mb-5 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-700 font-bold">
              지원자 선정은 픽스폴리오 담당자{campaignManager ? ` (@${campaignManager})` : ''}가 진행합니다.
            </p>
            <p className="text-[11px] text-slate-500 font-medium mt-1">
              함께하고 싶은 지원자를 <span className="font-black text-blue-600">추천</span>으로 표시해 주세요. 담당자가 조건과 일정을 정리해
              협업을 시작하고, 진행 상황은 아래에서 확인하실 수 있습니다.
            </p>
          </div>
          {applicantsLoading ? (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
            </div>
          ) : applicants.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <p className="text-sm text-slate-400 font-bold">아직 지원자가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {applicants.map(app => (
                <div key={app.id} className="border border-slate-100 rounded-xl p-4 hover:border-slate-200 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-slate-900">@{app.applicant_username}</span>
                      {statusBadge(app.status)}
                      <span className="text-[10px] text-slate-300 font-bold">{new Date(app.created_at).toLocaleDateString('ko-KR')}</span>
                    </div>
                    {app.status === 'pending' && (
                      <div className="flex gap-1.5 ml-3 flex-shrink-0">
                        <button
                          onClick={() => handleApplicantPreference(app.id, app.brand_preference === 'shortlist' ? '' : 'shortlist')}
                          disabled={prefSaving === app.id}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-colors disabled:opacity-50 ${
                            app.brand_preference === 'shortlist'
                              ? 'bg-blue-600 text-white hover:bg-blue-500'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}
                        >
                          {app.brand_preference === 'shortlist' ? '★ 추천함' : '추천'}
                        </button>
                        <button
                          onClick={() => handleApplicantPreference(app.id, app.brand_preference === 'pass' ? '' : 'pass')}
                          disabled={prefSaving === app.id}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-colors disabled:opacity-50 ${
                            app.brand_preference === 'pass'
                              ? 'bg-slate-600 text-white hover:bg-slate-500'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {app.brand_preference === 'pass' ? '보류함' : '보류'}
                        </button>
                      </div>
                    )}
                    {app.status === 'accepted' && (
                      <button
                        onClick={() => openManagerThread(app)}
                        disabled={!app.collab_id}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 transition-colors ml-3 flex-shrink-0 flex items-center gap-1 disabled:opacity-40"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                        담당자와 대화
                      </button>
                    )}
                  </div>
                  {app.message && <p className="text-xs text-slate-600 font-medium mb-3 whitespace-pre-wrap">{app.message}</p>}
                  {app.status === 'pending' && app.brand_preference === 'shortlist' && (
                    <p className="text-[11px] text-blue-600 font-bold mb-3">담당자에게 추천 의견이 전달되었습니다. 선정 결과를 기다려 주세요.</p>
                  )}

                  {/* Contact & Links */}
                  <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                    {app.contact && (
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                        <span className="text-xs text-slate-700 font-bold">{app.contact}</span>
                      </div>
                    )}
                    {app.instagram_url && (
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-pink-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
                        <a href={app.instagram_url} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-600 font-bold hover:underline truncate">{app.instagram_url}</a>
                      </div>
                    )}
                    {app.youtube_naver_url && (
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
                        <a href={app.youtube_naver_url} target="_blank" rel="noopener noreferrer" className="text-xs text-red-600 font-bold hover:underline truncate">{app.youtube_naver_url}</a>
                      </div>
                    )}
                    {app.portfolio_url && (
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                        <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 font-bold hover:underline truncate">{app.portfolio_url}</a>
                      </div>
                    )}
                    {!app.contact && !app.instagram_url && !app.youtube_naver_url && !app.portfolio_url && (
                      <p className="text-[11px] text-slate-400 font-medium">등록된 연락처/링크가 없습니다</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm text-center">
            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </div>
            <p className="text-sm text-slate-500 font-bold">다른 브랜드의 캠페인입니다</p>
            <p className="text-xs text-slate-400 font-medium mt-1">지원자 목록은 캠페인을 등록한 브랜드만 확인할 수 있습니다</p>
          </div>
        )}
        {/* 선정 이후의 진행 상황. 브랜드는 여기서 단계와 산출물을 보고 담당자에게
            의견을 남긴다 — 인플루언서에게 직접 전달되지 않고 담당자를 거친다. */}
        {isOwner && (
          <div className="mt-6">
            <BrandCollabProgress campaignId={selectedCampaign.id} onNotify={notify} />
          </div>
        )}
        {toastEl}
      </main>
    );
  }

  // --- 캠페인 브리프 작성 ---
  if (showForm) {
    return (
      <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-3xl mx-auto">
        <button onClick={resetForm} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          캠페인 목록
        </button>

        <CampaignBriefComposer
          businessUsername={businessUsername}
          companyName={companyName}
          editing={editingCampaign}
          categories={CATEGORIES}
          onCancel={resetForm}
          onSaved={() => {
            resetForm();
            fetchCampaigns();
          }}
          onNotify={notify}
        />
        {toastEl}
      </main>
    );
  }

  // --- Campaign List ---
  return (
    <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-5xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-lg md:text-2xl font-black text-slate-900">캠페인 리스트</h2>
          <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">
            {viewMode === 'mine'
              ? '내가 등록한 캠페인을 관리하고 지원자를 확인하세요'
              : '플랫폼에 등록된 모든 캠페인을 둘러보세요'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-auto">
            {/* 인플루언서 매칭 받기 — 브랜드(광고주)로 지원(역할 고정) */}
            <CollabMatchRegister
              variant="brand"
              applicantUsername={businessUsername}
              buttonClassName="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-5 py-2.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-indigo-600/20"
            />
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
            새 캠페인 등록
          </button>
        </div>
      </header>

      {/* View Mode Toggle: 내 캠페인 / 전체 캠페인 */}
      <div className="inline-flex items-center bg-slate-100 rounded-xl p-1 mb-4">
        <button
          onClick={() => setViewMode('mine')}
          className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${
            viewMode === 'mine' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          내 캠페인
        </button>
        <button
          onClick={() => setViewMode('all')}
          className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${
            viewMode === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          전체 캠페인
        </button>
      </div>

      {/* Type Filter Tabs */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1 scrollbar-hide">
        {CAMPAIGN_TYPES.map(ct => (
          <button
            key={ct.value}
            onClick={() => setActiveTypeFilter(ct.value)}
            className={`px-4 py-2 rounded-full text-xs font-black whitespace-nowrap transition-all ${
              activeTypeFilter === ct.value
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {ct.label}
          </button>
        ))}
        <div className="ml-auto pl-4 text-xs text-slate-400 font-bold whitespace-nowrap">
          총 {filteredCampaigns.length}개
        </div>
      </div>

      {listLoading ? (
        <div className="text-center py-20">
          <div className="w-10 h-10 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-slate-400 font-bold">캠페인 불러오는 중...</p>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          </div>
          <h3 className="text-lg font-black text-slate-900 mb-2">등록된 캠페인이 없습니다</h3>
          {viewMode === 'mine' ? (
            <>
              <p className="text-sm text-slate-500 font-medium mb-6">새 캠페인을 등록하여 크리에이터의 지원을 받아보세요</p>
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-black text-sm transition-all shadow-lg"
              >
                첫 캠페인 등록하기
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-500 font-medium mb-6">현재 모집중인 캠페인이 없습니다</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
          {filteredCampaigns.map(campaign => {
            const deadline = deadlineInfo(campaign.end_date);
            return (
              <div
                key={campaign.id}
                className="bg-white rounded-xl border border-slate-100 hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer group overflow-hidden"
                onClick={() => handleSelectCampaign(campaign)}
              >
                {/* Thumbnail */}
                <div className="w-full aspect-square bg-slate-50 overflow-hidden relative">
                  {campaign.thumbnail_url ? (
                    <img src={campaign.thumbnail_url} alt={campaign.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-50">
                      <svg className="w-10 h-10 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  {/* Badges overlay */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    {campaignStatusBadge(campaign)}
                    {viewMode === 'all' && normalizeUser(campaign.business_username) === normalizeUser(businessUsername) && (
                      <span className="bg-blue-600 text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm">내 캠페인</span>
                    )}
                    {deadline && campaign.status === 'active' && (
                      <span className={`${deadline.urgent ? 'bg-rose-500' : 'bg-slate-900/85'} text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm`}>
                        {deadline.urgent ? `마감임박 ${deadline.label}` : deadline.label}
                      </span>
                    )}
                  </div>
                  {/* Edit/Delete overlay — only on own campaigns */}
                  {normalizeUser(campaign.business_username) === normalizeUser(businessUsername) && (
                  <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleEdit(campaign)} className="p-1.5 bg-white/90 backdrop-blur-sm hover:bg-white rounded-lg transition-colors shadow-sm" title="수정">
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => handleDelete(campaign.id)} className="p-1.5 bg-white/90 backdrop-blur-sm hover:bg-red-50 rounded-lg transition-colors shadow-sm" title="삭제">
                      <svg className="w-3.5 h-3.5 text-slate-500 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
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
                        <span className="text-[10px] text-slate-400 font-medium truncate">{categoryLabel(campaign.category)}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-black text-xs md:text-sm text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1">
                    {campaign.title}
                  </h3>
                  <div className="flex items-center justify-between">
                    {campaign.reward_amount ? (
                      <span className="text-xs font-black text-blue-600">{formatKoreanWon(campaign.reward_amount)}</span>
                    ) : <span />}
                    <span className="text-[10px] text-slate-400 font-bold">
                      {campaign.max_applicants > 0
                        ? `${campaign.application_count}/${campaign.max_applicants}명`
                        : `${campaign.application_count}명 신청중`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {toastEl}
    </main>
  );
};

export default CampaignCollabManagement;
