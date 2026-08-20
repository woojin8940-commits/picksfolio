import React, { useState, useEffect, useCallback } from 'react';
import { formatKoreanWon } from '../utils/formatters';
import { daysUntilDeadline, isPastDeadline, isQuotaReached } from '../utils/campaignRecruit';
import { authHeaders, apiService } from '../services/apiService';
import BrandCollabProgress from './BrandCollabProgress';
import CampaignRegisterWizard from './collab/CampaignRegisterWizard';
import CampaignListupBoard from './collab/CampaignListupBoard';
import CampaignGuidelineEditor, { parseGuidelineFiles } from './collab/CampaignGuidelineEditor';
import CampaignInsightPanel from './collab/CampaignInsightPanel';
import CampaignSettlementPanel from './collab/CampaignSettlementPanel';
import InfluencerCandidateCard, { candidateSortValues } from './collab/InfluencerCandidateCard';
import {
  rewardModeOf, PRODUCT_PROVIDE, AD_OBJECTIVES, stageMarksFor,
  parseTierCounts, chosenTiers, tierFeeLabel, allocatedFloor,
} from '../utils/campaignBrief';
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
  guideline_files?: unknown;
  second_use_fee?: number;
  second_use_note?: string;
  upload_from?: string;
  upload_to?: string;
  // 등록 화면이 정하는 값. 진행 단계는 진행 방식에서, 인원은 규모별 배분에서 나온다.
  reward_mode?: string;
  tier_counts?: string;
  /** 패키지를 없애기 전에 등록된 캠페인만 이 값을 쓴다. */
  package_tier?: string;
  product_provide?: string;
  ad_objective?: string;
  budget_krw?: number;
  /** 제품 협찬형의 협찬 인원. 컬럼은 예전 시딩 건수 칸을 그대로 쓴다. */
  seeding_count?: number;
  /** 공동구매의 판매 수수료(%). 다른 방식에서는 0 이다. */
  groupbuy_commission_rate?: number;
  influencer_gender?: string;
  influencer_ages?: string;
  sns_category?: string;
  follower_tiers?: string;
  min_views?: number;
  influencer_styles?: string;
  exclude_keywords?: string;
  target_audience?: string;
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
  /**
   * 이 행이 만들어진 경로. 'apply' 는 인플루언서가 직접 지원한 것이고, 'listup' 은
   * 담당자 제안을 수락해 협업을 세우려고 만들어진 행이다(협업은 지원 행 하나에
   * 매달려야 한다 — netlify/functions/_shared/campaign-listup.mts). 후자는 지원이
   * 아니므로 지원자 목록에서는 세지 않는다.
   */
  source?: string;
  // 브랜드가 남기는 의견. 선정 권한과 분리된 값이라 status 와 다른 컬럼에 있다.
  brand_preference?: string;
  brand_preference_note?: string;
  /**
   * 담당자가 이 지원자에 대해 적어 둔 추천 이유. 담당자 콘솔에서 쓰고 브랜드 카드에
   * 그대로 보인다 — 담당자만 보는 메모가 아니다.
   */
  manager_note?: string;
  // 수락한 뒤 만들어지는 협업 본체. 만드는 사람은 진행 방식에 따라 브랜드일 수도,
  // 담당자일 수도 있다.
  collab_id?: string;
  collab_status?: string;
  current_stage_key?: string;
  /**
   * 메타 API 로 받아 둔 채널 지표(팔로워 · 평균 조회수 · 최근 릴스). 서버가 지원자마다
   * 붙여 준다. 연동 전이거나 등록서만 있는 사람은 metricsSource 로 구분된다 —
   * 브랜드가 사람을 고르는 화면이므로 숫자의 출처가 보여야 한다.
   */
  insights?: any;
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
  /**
   * 지원자를 고르는 사람. 서버가 캠페인의 진행 방식을 보고 알려준다.
   *
   * 'brand'  — 제품 협찬형·공동구매. 브랜드가 직접 수락하고 담당자가 그 뒤를 맡는다.
   * 'manager' — 광고비 지급형. 브랜드는 추천 의견만 남긴다.
   *
   * 화면에서 진행 방식을 보고 직접 판단하지 않고 서버 값을 쓴다 — 버튼은 보이는데
   * 서버가 막는(또는 그 반대의) 상태를 만들지 않으려면 판단이 한 곳에 있어야 한다.
   */
  const [selectionBy, setSelectionBy] = useState<'brand' | 'manager'>('manager');
  const [accepting, setAccepting] = useState('');
  /**
   * 지원자 목록의 보기 방식.
   *
   * 지원자가 수십 명이 되면 "누가 지원했나"보다 "이 중에 누구를 볼 것인가"가 먼저다.
   * 정렬은 브랜드가 실제로 쓰는 기준 셋만 둔다 — 최신순(기본), 팔로워순, 평균
   * 조회수순. 광고비순은 넣지 않는다: 단가가 자유 입력 문자열이라("200만원",
   * "협의 후 결정") 크기로 줄을 세우면 협의로 적은 사람이 늘 맨 아래로 밀린다.
   *
   * 거른 상태는 목록에서 지우지 않고 개수를 함께 적는다. "보류" 탭이 비어 있는 것과
   * 보류한 사람이 없는 것은 다른 이야기다.
   */
  const [applicantSort, setApplicantSort] = useState<'recent' | 'followers' | 'views'>('recent');
  const [applicantView, setApplicantView] = useState<'' | 'pending' | 'accepted' | 'pass'>('');
  // 상세 화면의 탭. 캠페인 하나에 붙는 정보가 네 갈래(누가 하는지 / 어디까지 왔는지 /
  // 성과 / 지급)로 늘어나 한 화면에 세로로 쌓으면 아래쪽은 아무도 보지 않는다.
  const [detailTab, setDetailTab] = useState<'influencer' | 'progress' | 'insight' | 'settlement'>('influencer');
  // 캠페인 조건 전문. 등록한 브랜드는 이미 아는 내용이라 접어 두고, 필요할 때만 편다.
  const [showBrief, setShowBrief] = useState(false);
  // 하단 요약 바와 인사이트 탭이 읽는 협업 요약. 상세 진행 내역은 BrandCollabProgress
  // 가 따로 읽고, 여기서는 건수만 쓴다.
  const [collabSummary, setCollabSummary] = useState<Array<{ id: string; uploadUrl: string; confirmedAt: string | null }>>([]);
  const [activeTypeFilter, setActiveTypeFilter] = useState('');
  // 카테고리·모집 상태 필터. 캠페인이 쌓이면 진행 방식만으로는 원하는 캠페인을 찾을
  // 수 없다("지난달 뷰티 캠페인 중 마감된 것"처럼 두 조건이 겹친다).
  const [activeCategoryFilter, setActiveCategoryFilter] = useState('');
  const [activeStatusFilter, setActiveStatusFilter] = useState<'' | 'open' | 'closed'>('');
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

  const fetchApplicants = async (campaignId: string) => {
    setApplicantsLoading(true);
    try {
      // 지원자 연락처가 담긴 목록이라 서버가 캠페인 소유자(또는 담당자)인지 확인한다.
      const data = await apiService.getCampaignApplicants(campaignId);
      setApplicants(data.applicants || []);
      setCampaignManager(data.managerUsername || '');
      setSelectionBy(data.selectionBy === 'brand' ? 'brand' : 'manager');
    } catch {
      console.error('Failed to fetch applicants');
    } finally {
      setApplicantsLoading(false);
    }
  };

  const handleSelectCampaign = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setDetailTab('influencer');
    setShowBrief(false);
    setCollabSummary([]);
    // 지원자 보기 방식은 캠페인마다 새로 시작한다. 앞 캠페인에서 "보류"만 보던
    // 상태가 그대로 넘어오면 지원자가 있는 캠페인이 빈 목록으로 열린다.
    setApplicantView('');
    setApplicantSort('recent');
    if (normalizeUser(campaign.business_username) === normalizeUser(businessUsername)) {
      setApplicants([]);
      fetchApplicants(campaign.id);
      fetchCollabSummary(campaign.id);
    } else {
      setApplicants([]);
    }
  };


  /**
   * 확정된 협업 건수. 하단 요약 바에 "몇 명이 진행 중인지"를 보여 주기 위한 값이다.
   * 예정 인원(max_applicants)만 보여 주면 실제로 몇 명이 촬영 중인지 알 수 없다.
   */
  const fetchCollabSummary = async (campaignId: string) => {
    try {
      const res = await apiService.getCollabs('brand');
      const rows = (res.collabs || []) as Array<{ id: string; campaignId: string; uploadUrl: string; confirmedAt: string | null }>;
      setCollabSummary(
        rows
          .filter(c => c.campaignId === campaignId)
          .map(c => ({ id: c.id, uploadUrl: c.uploadUrl || '', confirmedAt: c.confirmedAt })),
      );
    } catch {
      console.error('Failed to fetch collab summary');
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
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: businessUsername }),
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

  /**
   * 캠페인 삭제. 지원 기록과 협업까지 함께 지워지므로(서버가 같은 요청에서 지운다)
   * 무엇이 사라지는지 제목과 함께 확인받는다. "정말 삭제하시겠습니까?"만 띄우면
   * 명단이 함께 없어지는 것을 모른 채 누르게 된다.
   */
  const handleDelete = async (campaign: Campaign | string) => {
    const target = typeof campaign === 'string' ? campaigns.find(c => c.id === campaign) : campaign;
    const id = typeof campaign === 'string' ? campaign : campaign.id;
    const title = target?.title || '이 캠페인';
    // 지원을 받지 않는 캠페인(광고비 지급형)에도 협업이 세워진 인플루언서는 이 칸에
    // 세어져 있다. "지원자"라고 적으면 지원을 받지 않는 캠페인에서 없는 말이 된다.
    const people = Number(target?.application_count || 0);
    const peopleLabel = rewardModeOf(target?.reward_mode).openApply ? '지원자' : '인플루언서';
    if (
      !confirm(
        `'${title}' 캠페인을 삭제합니다.\n\n` +
          (people > 0 ? `${peopleLabel} ${people}명의 기록과 ` : '') +
          '진행 기록이 함께 지워지고 되돌릴 수 없습니다.\n계속하시겠습니까?',
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/campaigns?id=${id}&business=${businessUsername}`, {
        method: 'DELETE',
        headers: await authHeaders({}, { account: businessUsername }),
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
   * 광고비 지급형에서만 쓰인다. 선정은 담당자가 하고, 브랜드는 "이 사람이 좋다 /
   * 아니다"를 남긴다 — 담당자에게 전달되는 메모다. 제품 협찬형·공동구매에서는
   * 브랜드가 직접 수락하므로, 여기서는 '보류'만 쓴다.
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

  /**
   * 지원자 수락(제품 협찬형·공동구매).
   *
   * 이 버튼 한 번으로 협업 본체와 단계가 생기고 인플루언서에게 선정 알림이 간다.
   * 되돌릴 수 없는 통보가 나가므로 누르기 전에 한 번 확인한다.
   *
   * 수락 뒤에는 목록을 다시 읽는다 — 협업 ID 가 생겨야 진행사항에 이 인플루언서가
   * 나타나고, 그 값은 서버가 만든다.
   */
  const handleAcceptApplicant = async (app: Applicant) => {
    if (
      !window.confirm(
        `@${app.applicant_username} 님을 수락하시겠습니까?\n\n` +
          '수락하면 인플루언서에게 선정 안내가 가고, 픽스폴리오 담당자가 중간에서 조건과 일정을 정리해 진행합니다.',
      )
    ) {
      return;
    }
    setAccepting(app.id);
    try {
      const res = await apiService.decideApplicant(app.id, 'accepted');
      if (res.error) {
        notify(res.error, 'error');
        return;
      }
      notify(
        res.managerUsername
          ? `수락했습니다. 담당자 (@${res.managerUsername})가 이어서 진행합니다.`
          : '수락했습니다. 픽스폴리오 담당자가 곧 연락드립니다.',
      );
      if (selectedCampaign) {
        await fetchApplicants(selectedCampaign.id);
        fetchCollabSummary(selectedCampaign.id);
      }
    } finally {
      setAccepting('');
    }
  };

  /**
   * 진행사항 탭으로 보낸다.
   *
   * 예전에는 여기에 '담당자와 대화' 버튼이 있었다(브랜드↔담당자 전용 대화방).
   * 그런데 브랜드가 담당자에게 하는 말은 예외 없이 "이 인플루언서의 이 단계"에
   * 대한 것이라, 대화방으로 빠지면 어느 건인지 다시 설명해야 했고 그 결정은
   * 진행 화면에 남지 않았다. 이제는 진행사항의 단계별 피드백으로 받는다.
   */
  const openProgress = () => setDetailTab('progress');

  const resetForm = () => {
    setShowForm(false);
    setEditingCampaign(null);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      active: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: '모집중' },
      inactive: { bg: 'bg-slate-100', text: 'text-slate-500', label: '마감' },
      pending: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: '대기중' },
      pending_approval: { bg: 'bg-amber-50', text: 'text-amber-600', label: '승인 대기' },
      admin_rejected: { bg: 'bg-red-50', text: 'text-red-600', label: '승인 거절' },
      accepted: { bg: 'bg-blue-50', text: 'text-blue-600', label: '수락됨' },
      rejected: { bg: 'bg-red-50', text: 'text-red-600', label: '거절됨' },
    };
    const s = map[status] || { bg: 'bg-slate-100', text: 'text-slate-500', label: status };
    return <span className={`${s.bg} ${s.text} px-2.5 py-1 rounded-full text-xs font-black`}>{s.label}</span>;
  };

  // status가 'active'여도 종료일이 지난 캠페인은 크리에이터 화면에 더 이상 노출되지
  // 않는다. 브랜드가 그 이유를 알 수 있도록 "모집중" 대신 '기간 종료'를 보여 준다.
  // 모집 인원을 다 채운 것은 마감 사유가 아니다(정원이 차도 지원은 계속 받는다).
  const campaignStatusBadge = (campaign: Campaign) => {
    if (campaign.status === 'active' && isPastDeadline(campaign.end_date)) {
      return <span className="bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full text-xs font-black">기간 종료</span>;
    }
    return statusBadge(campaign.status);
  };

  /**
   * 마감된 캠페인인지. 삭제 버튼을 어디에 내놓을지가 이 값으로 갈린다.
   *
   * 직접 마감한 것(inactive)과 종료일이 지난 것을 함께 본다. 브랜드에게는 둘 다 "끝난
   * 캠페인"이고, 화면에도 같은 '마감 / 기간 종료' 배지로 나간다. 승인 거절도 여기에
   * 넣는다 — 되살릴 수 없는 캠페인이 목록에 계속 남아 있을 이유가 없다.
   *
   * 모집중인 캠페인은 뺀다. 지원자가 들어오고 있는 캠페인을 한 번의 클릭으로 지우면
   * 지원 기록과 협업까지 함께 사라진다.
   */
  const isClosedCampaign = (campaign: Campaign) =>
    campaign.status === 'inactive' ||
    campaign.status === 'admin_rejected' ||
    (campaign.status === 'active' && isPastDeadline(campaign.end_date));

  const typeLabel = (type: string) => {
    const m: Record<string, string> = { ad_collab: '광고 협업', group_buy: '공동구매', other: '기타', collaboration: '협업', advertisement: '광고/협찬', review: '리뷰', event: '이벤트' };
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

  // 목록은 언제나 내가 올린 캠페인뿐이다. 다른 브랜드의 캠페인은 여기서 볼 일이 없고,
  // 남의 캠페인이 섞이면 지원자·정산 화면으로 들어갔을 때 권한 오류만 보게 된다.
  //
  // 세 조건(진행 방식 · 카테고리 · 모집 상태)은 겹쳐서 걸린다. 조건마다 목록을 따로
  // 만들면 "뷰티 + 마감"처럼 겹쳐 보는 조합이 빠지기 때문이다.
  //
  // 모집 상태를 서버 status 그대로 쓰지 않는 이유: 브랜드가 마감을 누르지 않아도
  // 종료일이 지나면 지원을 받을 수 없다. 화면의 배지도 그렇게 나가므로(마감 / 기간
  // 종료) 필터도 같은 기준을 봐야 한다. 승인 대기는 아직 모집도 마감도 아니어서
  // 따로 둔다 — '모집중'에 섞으면 지원자가 들어올 것처럼 보인다.
  const recruitStateOf = (c: Campaign): 'open' | 'closed' | 'pending' => {
    if (c.status === 'pending_approval') return 'pending';
    if (isClosedCampaign(c)) return 'closed';
    return c.status === 'active' ? 'open' : 'closed';
  };

  const filteredCampaigns = campaigns.filter(c => {
    if (activeTypeFilter && c.type !== activeTypeFilter) return false;
    if (activeCategoryFilter && (c.category || '') !== activeCategoryFilter) return false;
    if (activeStatusFilter && recruitStateOf(c) !== activeStatusFilter) return false;
    return true;
  });

  /** 상태 필터 칩에 붙는 개수. 고른 조건과 무관하게 늘 전체 기준으로 센다. */
  const statusCounts = campaigns.reduce(
    (acc, c) => {
      acc[recruitStateOf(c)] += 1;
      return acc;
    },
    { open: 0, closed: 0, pending: 0 } as Record<'open' | 'closed' | 'pending', number>,
  );

  const STATUS_FILTERS: Array<{ value: '' | 'open' | 'closed'; label: string; count: number }> = [
    { value: '', label: '전체', count: campaigns.length },
    { value: 'open', label: '모집중', count: statusCounts.open },
    { value: 'closed', label: '마감', count: statusCounts.closed },
  ];

  // --- Campaign Detail View ---
  if (selectedCampaign) {
    // 목록에 내 캠페인만 담기므로 여기서는 늘 true 다. 그래도 지우지 않는 이유는
    // localStorage 캐시다 — 계정을 바꿔 로그인했을 때 이전 캐시가 한 번 그려질 수 있고,
    // 그 화면에서 지원자 연락처가 보이면 안 된다.
    const isOwner = normalizeUser(selectedCampaign.business_username) === normalizeUser(businessUsername);
    // 진행 방식이 없던 시절 캠페인은 모두 광고비를 지급했다 — rewardModeOf 가 'paid'
    // 로 되돌려 준다.
    const mode = rewardModeOf(selectedCampaign.reward_mode);
    const isBarter = mode.value === 'barter';
    const isGroupBuy = mode.value === 'groupbuy';
    // 지원을 받아 브랜드가 고르는 방식인지. 리스트업 유무는 mode.managerListup 이
    // 따로 정한다(공동구매는 지원도 받고 리스트업도 받는다).
    const openApply = mode.openApply;
    /**
     * 화면에 그리는 지원자. 리스트업 제안을 수락한 사람도 지원 행으로 남지만
     * (source='listup'), 그 사람은 리스트업 명단에서 이미 상태까지 보인다. 같은 사람이
     * 두 목록에 겹쳐 있으면 브랜드는 "지원자가 한 명 더 있다"로 세게 된다.
     */
    const applyRows = applicants.filter(a => (a.source || 'apply') !== 'listup');
    /**
     * 화면에 실제로 그리는 지원자. 거르기와 정렬을 여기서 한 번에 끝낸다.
     *
     * 보류(brand_preference==='pass')는 상태가 아니라 브랜드가 남긴 표시라서
     * status 와 따로 본다 — 보류해 둔 사람도 status 는 계속 'pending' 이다.
     */
    const applyCounts = {
      all: applyRows.length,
      pending: applyRows.filter(a => a.status === 'pending' && a.brand_preference !== 'pass').length,
      accepted: applyRows.filter(a => a.status === 'accepted').length,
      pass: applyRows.filter(a => a.brand_preference === 'pass').length,
    };
    const visibleApplyRows = applyRows
      .filter(a => {
        if (applicantView === 'pending') return a.status === 'pending' && a.brand_preference !== 'pass';
        if (applicantView === 'accepted') return a.status === 'accepted';
        if (applicantView === 'pass') return a.brand_preference === 'pass';
        return true;
      })
      .sort((a, b) => {
        if (applicantSort === 'followers') {
          return candidateSortValues(b.insights || {}).followers - candidateSortValues(a.insights || {}).followers;
        }
        if (applicantSort === 'views') {
          return candidateSortValues(b.insights || {}).avgViews - candidateSortValues(a.insights || {}).avgViews;
        }
        // 서버가 이미 최신순으로 주지만, 정렬을 되돌렸을 때도 같은 순서가 되도록
        // 화면에서 한 번 더 맞춘다.
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    // 브랜드가 직접 수락하는 캠페인인지. 실제 권한 판단은 서버(selectionBy)가 하고,
    // 목록을 읽어 오는 동안에는 진행 방식으로 안내 문구만 미리 맞춰 둔다(그 사이에는
    // 버튼이 그려지지 않는다).
    const brandSelects = applicantsLoading ? openApply : selectionBy === 'brand';
    const tierCounts = parseTierCounts(selectedCampaign.tier_counts);
    const tierRows = chosenTiers(tierCounts).filter(t => (tierCounts[t.key] || 0) > 0);
    // 협찬 인원. 세는 대상은 제품이 아니라 사람이다 — 컬럼은 예전 시딩 건수 칸을 쓴다.
    const barterHeadcount = Number(selectedCampaign.seeding_count || 0) || Number(selectedCampaign.max_applicants || 0);
    const commissionRate = Number(selectedCampaign.groupbuy_commission_rate || 0);
    const budget = mode.pickInfluencer ? Number(selectedCampaign.budget_krw || 0) : 0;
    const stageMarks = stageMarksFor(mode.value);
    const uploadedCount = collabSummary.filter(c => c.uploadUrl).length;
    const provideLabel = PRODUCT_PROVIDE.find(p => p.value === selectedCampaign.product_provide)?.label || '';
    // 광고 목적은 담당자 리스트업에 쓰는 조건이라 광고비 지급형에만 있다.
    const objectiveLabel = mode.pickInfluencer
      ? AD_OBJECTIVES.find(o => o.value === selectedCampaign.ad_objective)?.label || ''
      : '';

    // 섭외중 / 진행중. 브랜드가 가장 알고 싶은 것은 "지금 사람을 찾고 있는지, 이미
    // 찍고 있는지"다. 캠페인 상태(active/inactive)만으로는 그 구분이 안 된다.
    const phasePill =
      selectedCampaign.status !== 'active'
        ? null
        : collabSummary.length === 0
          ? { label: '섭외중', cls: 'bg-blue-50 text-blue-600' }
          : uploadedCount >= collabSummary.length
            ? { label: '업로드 완료', cls: 'bg-emerald-50 text-emerald-600' }
            : { label: '진행중', cls: 'bg-blue-50 text-blue-600' };

    /**
     * 상세 탭. 정산은 지급할 돈이 있는 방식에만 붙는다 — 제품 협찬형은 광고비도
     * 판매 수수료도 없어 정산할 것이 없고, 협업 단계에도 정산 단계가 생기지 않는다.
     * 빈 정산 탭을 남겨 두면 브랜드는 지급을 기다리게 된다.
     */
    const TABS = [
      { key: 'influencer' as const, label: '인플루언서' },
      { key: 'progress' as const, label: '진행사항' },
      { key: 'insight' as const, label: '인사이트' },
      ...(mode.hasSettlement ? [{ key: 'settlement' as const, label: '정산' }] : []),
    ];
    // 캠페인을 옮겨 다니면 탭 상태가 남는다. 정산 탭이 없는 캠페인에서 그 상태가
    // 그대로면 아무것도 그려지지 않는 화면이 된다.
    const activeTab = TABS.some(t => t.key === detailTab) ? detailTab : 'influencer';

    /**
     * 진행 중인 협업이 하나라도 있는지. 하단 고정 바의 '진행사항 보기' 버튼을
     * 켤지 정하는 데만 쓴다.
     *
     * 여기서는 지원 경로로 걸러 낸 applyRows 가 아니라 전체 목록을 본다 — 리스트업
     * 제안으로 시작된 협업도 진행사항에 나와야 하고, 광고비 지급형은 그 경로가
     * 유일하다.
     */
    const hasCollab = !!(applicants.find(a => a.collab_id)?.collab_id || collabSummary[0]?.id);

    return (
      /* 폭은 화면을 거의 다 쓴다. 진행사항 탭이 단계를 가로로 늘어놓은 보드라
         (BrandCollabProgress) 1024px 에 맞춰 두면 다섯 칸 중 두 칸만 보이고 나머지는
         가로로 밀어 봐야 한다 — 보드로 만든 이유가 "몰려 있는 칸이 한눈에 보이는 것"인데
         그 이유가 폭에서 사라진다. 다른 탭은 카드 열이 늘어나 빈자리를 채운다. */
      <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-[1560px] mx-auto pb-[calc(152px+env(safe-area-inset-bottom,0px))] md:pb-28">
        <button onClick={() => setSelectedCampaign(null)} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          캠페인 목록
        </button>

        {/* 머리말. 상태와 제목만 남기고 나머지 조건은 '자세히 보기'로 접는다 —
            등록한 브랜드는 이미 아는 내용이고, 매번 스크롤해 지나가야 할 이유가 없다. */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 md:p-8 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {campaignStatusBadge(selectedCampaign)}
                {phasePill && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-black ${phasePill.cls}`}>
                    {phasePill.label}
                  </span>
                )}
                <span className="text-xs text-slate-400 font-bold">{typeLabel(selectedCampaign.type)}</span>
                <span className="text-xs text-slate-400 font-bold">· {mode.label}</span>
                {openApply && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[11px] font-black">
                    {mode.tagline}
                  </span>
                )}
              </div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900">{selectedCampaign.title}</h2>
              {selectedCampaign.brand_name && <p className="text-sm text-slate-500 font-bold mt-1">{selectedCampaign.brand_name}</p>}
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {selectedCampaign.thumbnail_url && (
                <div className="w-16 h-16 rounded-2xl bg-slate-100 overflow-hidden">
                  <img src={selectedCampaign.thumbnail_url} alt="" className="w-full h-full object-cover" />
                </div>
              )}
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
                  {/* 마감된 캠페인만 여기서 지울 수 있다. 모집중인 캠페인 옆에 삭제
                      버튼을 두면 '마감' 대신 눌러 지원자 기록까지 날리게 된다. */}
                  {isClosedCampaign(selectedCampaign) && (
                    <button
                      onClick={() => handleDelete(selectedCampaign)}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 rounded-xl text-xs font-black text-red-500 transition-colors"
                    >
                      삭제
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            onClick={() => setShowBrief(v => !v)}
            className="mt-4 text-xs font-black text-blue-600 hover:underline"
          >
            {showBrief ? '접기 ▲' : '자세히 보기 ▼'}
          </button>

          {showBrief && (
            <div className="mt-4 space-y-4">
              {selectedCampaign.description && (
                <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap leading-relaxed">
                  {selectedCampaign.description}
                </p>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {selectedCampaign.category && (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">카테고리</p>
                    <p className="text-sm font-black text-slate-900">{categoryLabel(selectedCampaign.category)}</p>
                  </div>
                )}
                {isBarter ? (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">협찬 인원</p>
                    <p className="text-sm font-black text-slate-900">
                      {barterHeadcount > 0 ? `${barterHeadcount}명` : '-'}
                    </p>
                  </div>
                ) : isGroupBuy ? (
                  /* 브랜드가 등록 때 적은 희망 비율이다. 인플루언서 화면에는
                     숫자가 나가지 않고 "담당자와 협의"로만 표시된다. 최종 수수료는
                     담당자가 인플루언서와 조율해 정한다. */
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">희망 수수료</p>
                    <p className="text-sm font-black text-slate-900">
                      {commissionRate > 0 ? `${commissionRate}%` : '담당자 조율'}
                    </p>
                    <p className="text-[9px] text-slate-400 font-bold mt-0.5">담당자 협의 후 확정</p>
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">집행 예산</p>
                    <p className="text-sm font-black text-slate-900">{formatKoreanWon(budget) || '-'}</p>
                  </div>
                )}
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[11px] text-slate-400 font-black uppercase">
                    {openApply ? mode.headcountLabel : '예정 인원'}
                  </p>
                  <p className="text-sm font-black text-blue-600">
                    {selectedCampaign.max_applicants > 0 ? `${selectedCampaign.max_applicants}명` : '담당자 조율'}
                  </p>
                </div>
                {selectedCampaign.upload_channel && (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">업로드 채널</p>
                    <p className="text-sm font-black text-slate-900">{selectedCampaign.upload_channel}</p>
                  </div>
                )}
                {(selectedCampaign.upload_from || selectedCampaign.upload_to) && (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">희망 업로드</p>
                    <p className="text-sm font-black text-slate-900">
                      {selectedCampaign.upload_from || '미정'}{selectedCampaign.upload_to ? ` ~ ${selectedCampaign.upload_to}` : ''}
                    </p>
                  </div>
                )}
                {provideLabel && (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">제품 제공</p>
                    <p className="text-sm font-black text-slate-900">{provideLabel}</p>
                  </div>
                )}
                {objectiveLabel && (
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-[11px] text-slate-400 font-black uppercase">광고 목적</p>
                    <p className="text-sm font-black text-slate-900">{objectiveLabel}</p>
                  </div>
                )}
              </div>

              {/* 규모별 모집 인원. 등록 때 배분한 구성을 그대로 되짚어 준다 —
                  담당자가 올린 후보가 그 구성과 맞는지 대조할 수 있어야 한다. */}
              {tierRows.length > 0 && (
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-3">모집 구성</p>
                  <div className="space-y-2">
                    {tierRows.map(t => (
                      <div key={t.key} className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black text-slate-900">
                          {t.label}
                          <span className="text-[11px] text-slate-400 font-bold ml-1.5">{t.followers}</span>
                        </span>
                        <span className="text-xs font-black text-slate-500 flex-shrink-0">
                          {tierCounts[t.key]}명
                          {mode.pickInfluencer && <span className="text-slate-400 font-bold ml-1.5">1인 {tierFeeLabel(t)}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                  {mode.pickInfluencer && (
                    <p className="text-xs text-slate-400 font-medium mt-3 pt-3 border-t border-slate-200">
                      최소 집행액 {formatKoreanWon(allocatedFloor(tierCounts)) || '0원'}
                      {budget > 0 && ` · 예산 ${formatKoreanWon(budget)}`}
                    </p>
                  )}
                </div>
              )}

              {/* 진행 방식이 정한 진행 단계. 등록 화면에서 본 것과 같은 표시여야 한다. */}
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-[11px] text-slate-400 font-black uppercase mb-3">진행 단계 · {mode.label}</p>
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {stageMarks.map((s, i) => (
                    <React.Fragment key={s.label}>
                      <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-[76px]">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black ${s.included ? 'bg-slate-900 text-white' : 'bg-white text-slate-300 border border-slate-200'}`}>
                          {s.included ? '✓' : '—'}
                        </span>
                        <span className={`text-[11px] font-black text-center leading-tight ${s.included ? 'text-slate-700' : 'text-slate-300'}`}>
                          {s.label}
                        </span>
                      </div>
                      {i < stageMarks.length - 1 && <span className="w-4 h-px bg-slate-200 flex-shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
                <p className="text-xs text-slate-400 font-medium mt-2">{mode.secondUseNote}</p>
              </div>

              {selectedCampaign.video_concept && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1.5">영상 컨셉</p>
                  <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap">{selectedCampaign.video_concept}</p>
                </div>
              )}

              {selectedCampaign.requirements && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1.5">희망 인플루언서</p>
                  <p className="text-sm text-slate-700 font-medium whitespace-pre-wrap">{selectedCampaign.requirements}</p>
                </div>
              )}

              {selectedCampaign.target_audience && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1.5">타겟 오디언스</p>
                  <p className="text-sm text-slate-700 font-medium">{selectedCampaign.target_audience}</p>
                </div>
              )}

              {selectedCampaign.product_url && (
                <a
                  href={selectedCampaign.product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[11px] text-blue-600 font-black hover:underline"
                >
                  제품 바로가기 →
                </a>
              )}
            </div>
          )}
        </div>

        {/* 상태 안내. 승인 대기·거절·기간 종료는 탭과 무관하게 항상 보여야 한다. */}
        {selectedCampaign.status === 'pending_approval' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
            <p className="text-sm font-black text-amber-700">관리자 승인 대기 중</p>
            <p className="text-xs text-amber-600 font-medium mt-1">캠페인이 관리자 승인 후 공개되고, 담당자가 배정됩니다.</p>
          </div>
        )}
        {selectedCampaign.status === 'admin_rejected' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4">
            <p className="text-sm font-black text-red-700">관리자에 의해 승인 거절됨</p>
            {selectedCampaign.admin_rejected_reason && (
              <p className="text-xs text-red-500 font-medium mt-1">사유: {selectedCampaign.admin_rejected_reason}</p>
            )}
          </div>
        )}
        {selectedCampaign.status === 'active' && isPastDeadline(selectedCampaign.end_date) && (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-4">
            <p className="text-sm font-black text-slate-600">모집 기간이 종료되었습니다</p>
            <p className="text-xs text-slate-400 font-medium mt-1">
              크리에이터 캠페인 목록에 더 이상 노출되지 않습니다. 계속 모집하려면 수정에서 희망 업로드 시작일을 늦춰 주세요.
            </p>
          </div>
        )}
        {/* 정원을 채워도 지원은 계속 받는다 — 담당자가 더 나은 후보를 고를 수 있게 하기 위함. */}
        {selectedCampaign.status === 'active' && !isPastDeadline(selectedCampaign.end_date) && isQuotaReached(selectedCampaign) && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4">
            <p className="text-sm font-black text-emerald-700">예정 인원을 모두 채웠습니다</p>
            <p className="text-xs text-emerald-600 font-medium mt-1">
              모집 기간 동안에는 예정 인원을 넘겨도 지원을 계속 받습니다. 더 많은 후보 중에서 담당자가 골라 드립니다.
            </p>
          </div>
        )}

        {/* 가이드라인. 비어 있으면 [필수] 배너로, 작성했으면 내용 카드로 바뀐다. */}
        {isOwner && (
          <div className="mb-4">
            <CampaignGuidelineEditor
              campaignId={selectedCampaign.id}
              guidelineNote={selectedCampaign.guideline_note || ''}
              guidelineUrl={selectedCampaign.guideline_url || ''}
              guidelineFiles={parseGuidelineFiles(selectedCampaign.guideline_files)}
              isOwner={isOwner}
              onSaved={next => {
                setSelectedCampaign(prev => (prev ? { ...prev, ...next } : prev));
                setCampaigns(prev => prev.map(c => (c.id === selectedCampaign.id ? { ...c, ...next } : c)));
              }}
              onNotify={notify}
            />
          </div>
        )}

        {/* 탭 */}
        <div className="flex items-center gap-1 border-b border-slate-100 mb-5 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setDetailTab(t.key)}
              className={`px-4 py-3 text-sm font-black whitespace-nowrap border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
              {/* 지원자 수는 지원을 받는 캠페인에만 붙인다. 광고비 지급형은 지원자
                  목록이 없으므로 셀 것도 없다. */}
              {t.key === 'influencer' && openApply && applyRows.length > 0 && (
                <span className="ml-1.5 text-blue-600">{applyRows.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ------------------------------------------------ 인플루언서 */}
        {activeTab === 'influencer' && (
          isOwner ? (
            <div className="space-y-4">
              {/* 담당자가 올린 후보 명단. 지원을 기다리는 것과 별개로 진행되는 길이므로
                  지원자 목록보다 위에 둔다 — 광고비 지급형은 이 명단에서 시작하고,
                  공동구매는 지원과 명단이 함께 온다.
                  제품 협찬형에는 리스트업이 없다(지원자만 받는다). 빈 명단을 띄워 두면
                  "담당자가 아직 안 올려 줬나"로 읽혀 오지 않을 명단을 기다리게 된다. */}
              {mode.managerListup && (
                <CampaignListupBoard
                  campaignId={selectedCampaign.id}
                  onNotify={notify}
                  onConfirmed={() => setDetailTab('progress')}
                />
              )}

              {/* 지원자 목록은 지원을 받는 방식에만 둔다. 광고비 지급형은 담당자가 조건에
                  맞는 후보를 찾아 올리는 길이라 지원이 들어오지 않는다 — 그 캠페인에서
                  사람을 고르는 자리는 위쪽 리스트업 하나뿐이다. */}
              {openApply && (
                <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
                  <h3 className="text-lg font-black text-slate-900 mb-2">지원자 목록 ({applyRows.length}명)</h3>
                  {/* 고르는 사람이 누구인지를 화면 맨 위에서 분명히 해 둔다. 제품 협찬형·
                      공동구매는 브랜드가 직접 수락하고, 광고비 지급형은 담당자가 고른다.
                      어느 쪽이든 수락 뒤의 조건·일정·발송은 담당자가 맡는다 — 그래서
                      "고르기"와 "진행"을 한 문장 안에서 나눠 적는다. */}
                  <div className="mb-5 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
                    <p className="text-sm text-slate-700 font-bold">
                      {brandSelects
                        ? `함께할 인플루언서는 브랜드가 직접 수락하고, 그 뒤는 픽스폴리오 담당자${campaignManager ? ` (@${campaignManager})` : ''}가 중간에서 맡습니다.`
                        : `지원자 선정은 픽스폴리오 담당자${campaignManager ? ` (@${campaignManager})` : ''}가 진행합니다.`}
                    </p>
                    <p className="text-xs text-slate-500 font-medium mt-1">
                      {brandSelects ? (
                        <>
                          지원자의 팔로워·평균 조회수와 최근 릴스를 보고 함께하고 싶은 분을{' '}
                          <span className="font-black text-blue-600">수락</span>해 주세요.
                          {selectedCampaign.max_applicants > 0
                            ? ` ${mode.headcountLabel} ${selectedCampaign.max_applicants}명만큼 수락하시면 됩니다. `
                            : ' '}
                          수락하는 순간 담당자가 조건과 일정을 정리해 진행을 맡고, 상황은 <span className="font-black">진행사항</span> 탭에서 확인하실 수 있습니다.
                          함께하기 어려운 분은 <span className="font-black">보류</span>로 표시해 두시면 담당자가 정리해 안내합니다.
                        </>
                      ) : (
                        <>
                          함께하고 싶은 지원자를 <span className="font-black text-blue-600">추천</span>으로 표시해 주세요.
                          담당자가 조건과 일정을 정리해 협업을 시작하고, 진행 상황은 <span className="font-black">진행사항</span> 탭에서 확인하실 수 있습니다.
                        </>
                      )}
                    </p>
                    {/* 지표 출처를 미리 알려 둔다. '본인 입력'과 '메타 연동 확인'이 같은
                        굵기로 보이면 브랜드는 어느 숫자도 믿지 않게 된다. */}
                    <p className="text-xs text-slate-400 font-medium mt-1.5">
                      숫자 옆 배지는 지표의 출처입니다 — <span className="font-black text-emerald-600">메타 연동 확인</span>은 인스타그램 계정을 연동해 받아온 값이고,
                      <span className="font-black text-amber-600"> 본인 입력</span>은 인플루언서가 적어 낸 값입니다.
                    </p>
                  </div>
                  {/* 목록을 훑는 도구. 지원자가 늘어나면 "누가 지원했나"보다 "이 중
                      누구를 볼 것인가"가 먼저가 된다. 상태로 한 번 좁히고, 브랜드가
                      실제로 쓰는 기준(팔로워 · 평균 조회수)으로 줄을 세운다. */}
                  {applyRows.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {([
                          { value: '' as const, label: '전체', count: applyCounts.all },
                          { value: 'pending' as const, label: '검토 대기', count: applyCounts.pending },
                          { value: 'accepted' as const, label: '수락함', count: applyCounts.accepted },
                          { value: 'pass' as const, label: '보류', count: applyCounts.pass },
                        ]).map(v => (
                          <button
                            key={v.value || 'all'}
                            onClick={() => setApplicantView(v.value)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-colors ${
                              applicantView === v.value
                                ? 'bg-slate-900 text-white'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            {v.label} {v.count}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-slate-400 font-black mr-0.5">정렬</span>
                        {([
                          { value: 'recent' as const, label: '최신순' },
                          { value: 'followers' as const, label: '팔로워순' },
                          { value: 'views' as const, label: '조회수순' },
                        ]).map(s => (
                          <button
                            key={s.value}
                            onClick={() => setApplicantSort(s.value)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-colors ${
                              applicantSort === s.value
                                ? 'bg-blue-50 text-blue-600'
                                : 'text-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {applicantsLoading ? (
                    <div className="text-center py-12">
                      <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
                      <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
                    </div>
                  ) : applyRows.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      </div>
                      <p className="text-sm text-slate-500 font-bold">아직 지원자가 없습니다</p>
                      <p className="text-xs text-slate-400 font-medium mt-1.5 leading-relaxed">
                        승인된 캠페인은 캠페인 협업 목록에 올라갑니다.<br />
                        조건을 보고 지원한 인플루언서가 이 목록에 쌓입니다.
                        {mode.managerListup && (
                          <>
                            <br />
                            담당자가 찾아 올린 후보는 위쪽 리스트업에서 확인하실 수 있습니다.
                          </>
                        )}
                      </p>
                    </div>
                  ) : visibleApplyRows.length === 0 ? (
                    <p className="text-xs text-slate-400 font-bold text-center py-8">
                      이 조건에 해당하는 지원자가 없습니다.
                    </p>
                  ) : (
                    /* 640px 부터 두 줄, 1280px 부터 세 줄로 나눈다. 예전에는 768px
                       아래를 전부 한 줄로 뒀는데, 노트북 창을 반만 열어 둔 700px 언저리에서
                       카드 하나가 폭을 다 먹어 지원자가 한 명일 때 카드가 화면만큼
                       커 보였다. 담당자 추천 명단과 같은 배치라, 두 화면을 오가며 후보를
                       견줘도 눈이 같은 자리에서 같은 숫자를 찾는다. */
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 items-stretch">
                      {visibleApplyRows.map(app => (
                        /* 지원자도 후보 명단과 같은 카드로 본다. 브랜드가 사람을 고르는
                           화면이 두 곳(담당자 명단 · 지원자 목록)인데 숫자가 다르게 생기면
                           고른 근거를 나중에 맞춰 볼 수 없다. 지원서에 적어 낸 인스타 주소는
                           채널 연동이 없을 때의 대체값으로만 쓴다. */
                        <InfluencerCandidateCard
                          key={app.id}
                          data={{
                            ...(app.insights || {}),
                            username: app.applicant_username,
                            instagramUrl: app.insights?.instagramUrl || app.instagram_url || '',
                          }}
                          /* 지원자 카드는 릴스·숏폼만 세 편 싣는다. 지원은 이미
                             "이 캠페인을 하겠다"는 뜻이라, 브랜드가 여기서 판단하는
                             것은 계정 톤이 아니라 이 사람이 만드는 영상이다. 피드
                             사진으로 빈 칸을 메우면 그 판단에 쓰이지 않는 그림이
                             자리를 차지한다. */
                          mediaMode="reels"
                          badges={
                            <>
                              {statusBadge(app.status)}
                              {app.status === 'pending' && app.brand_preference === 'pass' && (
                                <span className="bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full text-xs font-black">보류</span>
                              )}
                              <span className="text-[11px] text-slate-300 font-bold">
                                {new Date(app.created_at).toLocaleDateString('ko-KR')}
                              </span>
                            </>
                          }
                          /* 담당자가 이 지원자를 왜 권하는지. 지원자가 스스로 적어 낸
                             지원 메시지와 달리, 이 줄은 캠페인을 아는 담당자가 붙인
                             판단이라 카드 겉에 둔다 — 펼침 안에 숨기면 브랜드는 숫자만
                             보고 거르게 된다. */
                          note={app.manager_note}
                          /* 지원 메시지와 연락처는 펼쳤을 때만 보여 준다. 고를 때
                             필요한 것은 숫자와 릴스이고, 연락처는 고른 뒤에 쓰는
                             값이다 — 겉에 두면 카드 하나가 화면을 다 차지해 후보를
                             나란히 비교할 수 없다. */
                          details={
                            <div className="space-y-2.5">
                              {app.message && (
                                <div>
                                  <p className="text-[11px] text-slate-400 font-black uppercase mb-1">지원 메시지</p>
                                  <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap">{app.message}</p>
                                </div>
                              )}
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
                          }
                        >
                          <div className="space-y-2">
                            {app.status === 'pending' && (
                              <div className="flex flex-wrap gap-1.5">
                                {brandSelects ? (
                                  <>
                                    {/* 이 버튼이 협업을 만든다. 그래서 '추천'보다 크게 두고,
                                        누르면 담당자가 무엇을 이어받는지 확인 창에서 알린다. */}
                                    <button
                                      onClick={() => handleAcceptApplicant(app)}
                                      disabled={accepting === app.id}
                                      className="px-3.5 py-2 bg-blue-600 text-white rounded-lg text-xs font-black hover:bg-blue-500 transition-colors disabled:opacity-50"
                                    >
                                      {accepting === app.id ? '수락 중...' : '수락하고 진행하기'}
                                    </button>
                                    <button
                                      onClick={() => handleApplicantPreference(app.id, app.brand_preference === 'pass' ? '' : 'pass')}
                                      disabled={prefSaving === app.id}
                                      className={`px-3 py-2 rounded-lg text-xs font-black transition-colors disabled:opacity-50 ${
                                        app.brand_preference === 'pass'
                                          ? 'bg-slate-600 text-white hover:bg-slate-500'
                                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                      }`}
                                    >
                                      {app.brand_preference === 'pass' ? '보류함' : '보류'}
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handleApplicantPreference(app.id, app.brand_preference === 'shortlist' ? '' : 'shortlist')}
                                      disabled={prefSaving === app.id}
                                      className={`px-3 py-2 rounded-lg text-xs font-black transition-colors disabled:opacity-50 ${
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
                                      className={`px-3 py-2 rounded-lg text-xs font-black transition-colors disabled:opacity-50 ${
                                        app.brand_preference === 'pass'
                                          ? 'bg-slate-600 text-white hover:bg-slate-500'
                                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                      }`}
                                    >
                                      {app.brand_preference === 'pass' ? '보류함' : '보류'}
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                            {app.status === 'accepted' && (
                              <button
                                onClick={openProgress}
                                disabled={!app.collab_id}
                                className="px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-black hover:bg-slate-700 transition-colors flex items-center gap-1 disabled:opacity-40"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-6 0h.01M12 16h3m-6 0h.01" /></svg>
                                진행사항 보기
                              </button>
                            )}
                            {app.status === 'accepted' && (
                              <p className="text-xs text-emerald-600 font-bold">
                                수락 완료. 조건과 일정은 담당자{campaignManager ? ` (@${campaignManager})` : ''}가 정리해 진행합니다.
                              </p>
                            )}
                            {app.status === 'pending' && !brandSelects && app.brand_preference === 'shortlist' && (
                              <p className="text-xs text-blue-600 font-bold">담당자에게 추천 의견이 전달되었습니다. 선정 결과를 기다려 주세요.</p>
                            )}
                          </div>
                        </InfluencerCandidateCard>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm text-center">
              <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              </div>
              <p className="text-sm text-slate-500 font-bold">다른 브랜드의 캠페인입니다</p>
              <p className="text-xs text-slate-400 font-medium mt-1">인플루언서 명단은 캠페인을 등록한 브랜드만 확인할 수 있습니다</p>
            </div>
          )
        )}

        {/* ------------------------------------------------ 진행사항 */}
        {activeTab === 'progress' && (
          isOwner ? (
            // 선정 이후의 진행 상황. 브랜드는 여기서 단계와 산출물을 보고 담당자에게
            // 의견을 남긴다 — 인플루언서에게 직접 전달되지 않고 담당자를 거친다.
            <BrandCollabProgress
              campaignId={selectedCampaign.id}
              guidelineFiles={parseGuidelineFiles(selectedCampaign.guideline_files)}
              guidelineNote={selectedCampaign.guideline_note || ''}
              guidelineUrl={selectedCampaign.guideline_url || ''}
              budgetKrw={budget}
              businessUsername={businessUsername}
              onGuidelineFilesChange={files => {
                // 진행사항 안에서 올린 가이드도 같은 캠페인 가이드라인이다. 위쪽
                // 가이드라인 카드가 곧바로 같은 목록을 보여 주지 않으면 방금 올린
                // 파일이 사라진 것처럼 읽힌다.
                setSelectedCampaign(prev => (prev ? { ...prev, guideline_files: files } : prev));
                setCampaigns(prev =>
                  prev.map(c => (c.id === selectedCampaign.id ? { ...c, guideline_files: files } : c)),
                );
              }}
              onNotify={notify}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 p-10 shadow-sm text-center">
              <p className="text-sm text-slate-500 font-bold">진행 상황은 캠페인을 등록한 브랜드만 확인할 수 있습니다</p>
            </div>
          )
        )}

        {/* ------------------------------------------------ 인사이트 */}
        {activeTab === 'insight' && (
          <CampaignInsightPanel
            budgetKrw={budget}
            uploadedCount={uploadedCount}
            totalCollabs={collabSummary.length}
          />
        )}

        {/* ------------------------------------------------ 정산
            제품 협찬형에는 이 탭이 없다(TABS 참고) — 지급할 광고비가 없어 정산도 없다. */}
        {activeTab === 'settlement' && (
          isOwner ? (
            <CampaignSettlementPanel
              businessUsername={businessUsername}
              campaignId={selectedCampaign.id}
              budgetKrw={budget}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-100 p-10 shadow-sm text-center">
              <p className="text-sm text-slate-500 font-bold">정산 내역은 캠페인을 등록한 브랜드만 확인할 수 있습니다</p>
            </div>
          )
        )}

        {/* 하단 고정 요약. 탭을 옮겨 다니는 동안에도 이 캠페인의 규모와 진행사항으로
            가는 길이 남아 있어야 한다. 견적을 확정하는 버튼은 두지 않는다 — 인원과
            조건은 담당자가 후보를 올린 뒤 정해지고, 브랜드가 먼저 확정하면 그 과정이
            할 일이 없어진다. */}
        {isOwner && (
          /* 왼쪽은 사이드바(w-60, z-50) 폭만큼 비켜 세운다 — left-0 으로 두면 바가
             사이드바 아래로 깔려 '광고비 지급형 / 진행 n명' 앞부분이 잘려 보인다.
             휴대폰에서는 아래쪽 탭 바(약 72px + 홈 인디케이터)가 화면 맨 아래를
             쓰고 있으니 그 높이만큼 올려 앉힌다. */
          <div className="fixed left-0 right-0 md:left-60 bottom-[calc(72px+env(safe-area-inset-bottom,0px))] md:bottom-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200">
            <div className="max-w-[1560px] mx-auto px-4 md:px-10 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black text-slate-400">{mode.label}</p>
                <p className="text-sm font-black text-slate-900 truncate">
                  진행 {collabSummary.length}명
                  {selectedCampaign.max_applicants > 0 && ` / 예정 ${selectedCampaign.max_applicants}명`}
                  {isBarter
                    ? barterHeadcount > 0 && ` · 협찬 ${barterHeadcount}명`
                    : isGroupBuy
                      ? ' · 수수료 담당자 협의'
                      : budget > 0 && ` · ${formatKoreanWon(budget)}`}
                </p>
              </div>
              <button
                onClick={openProgress}
                disabled={!hasCollab}
                className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 disabled:opacity-40 flex-shrink-0 transition-colors"
              >
                {hasCollab ? '진행사항 보기' : '진행 대기'}
              </button>
            </div>
          </div>
        )}
        {toastEl}
      </main>
    );
  }

  // --- 캠페인 등록 ---
  if (showForm) {
    return (
      <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-6xl mx-auto pb-[calc(88px+env(safe-area-inset-bottom,0px))] md:pb-10">
        <button onClick={resetForm} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          캠페인 목록
        </button>

        <CampaignRegisterWizard
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
    <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-[1560px] mx-auto pb-[calc(88px+env(safe-area-inset-bottom,0px))] md:pb-10">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-lg md:text-2xl font-black text-slate-900">캠페인 리스트</h2>
          <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">
            내가 등록한 캠페인을 관리하고 지원자를 확인하세요
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
            새 캠페인 등록
          </button>
        </div>
      </header>

      {/* Type Filter Tabs */}
      <div className="flex items-center gap-1 mb-2.5 overflow-x-auto pb-1 scrollbar-hide">
        {CAMPAIGN_TYPES.map(ct => (
          <button
            key={ct.value}
            onClick={() => setActiveTypeFilter(ct.value)}
            className={`px-4 py-2 rounded-full text-sm font-black whitespace-nowrap transition-all ${
              activeTypeFilter === ct.value
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {ct.label}
          </button>
        ))}
        <div className="ml-auto pl-4 text-sm text-slate-400 font-bold whitespace-nowrap">
          총 {filteredCampaigns.length}개
        </div>
      </div>

      {/* 모집 상태. 개수를 함께 적는다 — 마감이 몇 건 쌓였는지가 눌러 보기 전에 보인다. */}
      <div className="flex items-center gap-1.5 mb-2.5 overflow-x-auto pb-1 scrollbar-hide">
        {STATUS_FILTERS.map(sf => (
          <button
            key={sf.value || 'all'}
            onClick={() => setActiveStatusFilter(sf.value)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-black whitespace-nowrap transition-all border ${
              activeStatusFilter === sf.value
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {sf.label}
            <span className={`ml-1 ${activeStatusFilter === sf.value ? 'text-white/70' : 'text-slate-400'}`}>
              {sf.count}
            </span>
          </button>
        ))}
      </div>

      {/* 카테고리. 등록할 때 고른 값 그대로다(CATEGORIES 첫 항목은 등록 폼용 안내
          문구라 '전체 카테고리'로 바꿔 낸다). */}
      <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-1 scrollbar-hide">
        {CATEGORIES.map(cat => (
          <button
            key={cat.value || 'all'}
            onClick={() => setActiveCategoryFilter(cat.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-all border ${
              activeCategoryFilter === cat.value
                ? 'bg-slate-900 border-slate-900 text-white'
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {cat.value === '' ? '전체 카테고리' : cat.label}
          </button>
        ))}
      </div>

      {loading ? (
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
          {campaigns.length > 0 ? (
            /* 캠페인은 있는데 조건에 걸린 경우. "등록된 캠페인이 없습니다"를 그대로
               보여 주면 필터 때문인 줄 모르고 등록을 다시 하게 된다. */
            <>
              <h3 className="text-lg font-black text-slate-900 mb-2">조건에 맞는 캠페인이 없습니다</h3>
              <p className="text-sm text-slate-500 font-medium mb-6">고른 진행 방식 · 상태 · 카테고리를 바꿔 보세요</p>
              <button
                onClick={() => { setActiveTypeFilter(''); setActiveStatusFilter(''); setActiveCategoryFilter(''); }}
                className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-black text-sm transition-all"
              >
                조건 모두 해제
              </button>
            </>
          ) : (
            <>
              <h3 className="text-lg font-black text-slate-900 mb-2">등록된 캠페인이 없습니다</h3>
              <p className="text-sm text-slate-500 font-medium mb-6">새 캠페인을 등록하여 크리에이터의 지원을 받아보세요</p>
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-black text-sm transition-all shadow-lg"
              >
                첫 캠페인 등록하기
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 md:gap-3">
          {filteredCampaigns.map(campaign => {
            const deadline = deadlineInfo(campaign.end_date);
            const closed = isClosedCampaign(campaign);
            const cardMode = rewardModeOf(campaign.reward_mode);
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
                    {deadline && campaign.status === 'active' && (
                      <span className={`${deadline.urgent ? 'bg-rose-500' : 'bg-slate-900/85'} text-white px-2 py-0.5 rounded-lg text-xs font-black shadow-sm`}>
                        {deadline.urgent ? `마감임박 ${deadline.label}` : deadline.label}
                      </span>
                    )}
                  </div>
                  {/* 수정·삭제. 마감된 캠페인의 삭제 버튼은 계속 보이게 둔다 — 손댈 일이
                      끝난 캠페인을 정리하려면 커서를 올려야 나타나는 버튼을 먼저 찾아내야
                      하는데, 모바일에서는 hover 가 없어 아예 닿지 않는다. */}
                  <div
                    className={`absolute top-2.5 right-2.5 flex gap-1 transition-opacity ${
                      closed ? '' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onClick={e => e.stopPropagation()}
                  >
                    <button onClick={() => handleEdit(campaign)} className="p-1.5 bg-white/90 backdrop-blur-sm hover:bg-white rounded-lg transition-colors shadow-sm" title="수정">
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => handleDelete(campaign)} className="p-1.5 bg-white/90 backdrop-blur-sm hover:bg-red-50 rounded-lg transition-colors shadow-sm" title="삭제">
                      <svg className="w-3.5 h-3.5 text-slate-500 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-2.5 md:p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    {campaign.brand_name && (
                      <span className="text-xs text-slate-400 font-bold truncate">{campaign.brand_name}</span>
                    )}
                    {campaign.category && (
                      <>
                        <span className="text-slate-200">·</span>
                        <span className="text-xs text-slate-400 font-medium truncate">{categoryLabel(campaign.category)}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-black text-sm md:text-base text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1">
                    {campaign.title}
                  </h3>
                  <div className="flex items-center justify-between">
                    {campaign.reward_amount ? (
                      <span className="text-sm font-black text-blue-600">{formatKoreanWon(campaign.reward_amount)}</span>
                    ) : <span />}
                    <span className="text-xs text-slate-400 font-bold">
                      {/* 지원을 받지 않는 캠페인(광고비 지급형)에 "N명 신청중"을 적으면
                          오지 않는 지원을 기다리게 된다. 그 캠페인은 담당자가 명단을
                          올려 주는 길이라 모집 규모만 적는다. */}
                      {!cardMode.openApply
                        ? campaign.max_applicants > 0
                          ? `${cardMode.headcountLabel} ${campaign.max_applicants}명`
                          : '담당자 리스트업'
                        : campaign.max_applicants > 0
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
