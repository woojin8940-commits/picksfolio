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
  admin_rejected_reason?: string;
  admin_approved_at?: string;
  created_at: string;
}

interface Applicant {
  id: string;
  campaign_id: string;
  applicant_username: string;
  message: string;
  contact: string;
  portfolio_url: string;
  status: string;
  created_at: string;
}

interface CampaignCollabManagementProps {
  businessUsername: string;
  companyName: string;
}

const CampaignCollabManagement: React.FC<CampaignCollabManagementProps> = ({ businessUsername, companyName }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [formData, setFormData] = useState({
    type: 'collaboration',
    title: '',
    description: '',
    brand_name: companyName,
    category: '',
    reward_type: 'fixed',
    reward_amount: '',
    requirements: '',
    max_applicants: 0,
    start_date: '',
    end_date: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns?business=${businessUsername}`);
      const data = await res.json();
      setCampaigns(data.campaigns || []);
    } catch {
      console.error('Failed to fetch campaigns');
    } finally {
      setLoading(false);
    }
  }, [businessUsername]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const fetchApplicants = async (campaignId: string) => {
    setApplicantsLoading(true);
    try {
      const res = await fetch(`/api/campaign-applicants?campaign_id=${campaignId}`);
      const data = await res.json();
      setApplicants(data.applicants || []);
    } catch {
      console.error('Failed to fetch applicants');
    } finally {
      setApplicantsLoading(false);
    }
  };

  const handleSelectCampaign = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    fetchApplicants(campaign.id);
  };

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      alert('캠페인 제목을 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    try {
      if (editingCampaign) {
        const res = await fetch('/api/campaigns', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingCampaign.id, ...formData }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || '수정 실패');
          return;
        }
      } else {
        const res = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, business_username: businessUsername }),
        });
        if (!res.ok) {
          const err = await res.json();
          alert(err.error || '등록 실패');
          return;
        }
        alert('캠페인이 등록되었습니다. 관리자 승인 후 공개됩니다.');
      }
      resetForm();
      fetchCampaigns();
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setFormData({
      type: campaign.type,
      title: campaign.title,
      description: campaign.description,
      brand_name: campaign.brand_name,
      category: campaign.category,
      reward_type: campaign.reward_type,
      reward_amount: campaign.reward_amount,
      requirements: campaign.requirements,
      max_applicants: campaign.max_applicants,
      start_date: campaign.start_date || '',
      end_date: campaign.end_date || '',
    });
    setShowForm(true);
    setSelectedCampaign(null);
  };

  const handleToggleStatus = async (campaign: Campaign) => {
    const newStatus = campaign.status === 'active' ? 'inactive' : 'active';
    try {
      await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: campaign.id, status: newStatus }),
      });
      fetchCampaigns();
    } catch {
      alert('상태 변경에 실패했습니다.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      await fetch(`/api/campaigns?id=${id}`, { method: 'DELETE' });
      fetchCampaigns();
      if (selectedCampaign?.id === id) setSelectedCampaign(null);
    } catch {
      alert('삭제에 실패했습니다.');
    }
  };

  const handleApplicantStatus = async (applicantId: string, status: string) => {
    try {
      await fetch('/api/campaign-applicants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: applicantId, status }),
      });
      if (selectedCampaign) fetchApplicants(selectedCampaign.id);
    } catch {
      alert('상태 변경에 실패했습니다.');
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingCampaign(null);
    setFormData({
      type: 'collaboration',
      title: '',
      description: '',
      brand_name: companyName,
      category: '',
      reward_type: 'fixed',
      reward_amount: '',
      requirements: '',
      max_applicants: 0,
      start_date: '',
      end_date: '',
    });
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      active: { bg: 'bg-green-100', text: 'text-green-700', label: '모집중' },
      inactive: { bg: 'bg-slate-100', text: 'text-slate-500', label: '마감' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '대기중' },
      pending_approval: { bg: 'bg-orange-100', text: 'text-orange-700', label: '승인 대기' },
      admin_rejected: { bg: 'bg-red-100', text: 'text-red-700', label: '승인 거절' },
      accepted: { bg: 'bg-blue-100', text: 'text-blue-700', label: '수락됨' },
      rejected: { bg: 'bg-red-100', text: 'text-red-700', label: '거절됨' },
    };
    const s = map[status] || { bg: 'bg-slate-100', text: 'text-slate-500', label: status };
    return <span className={`${s.bg} ${s.text} px-2 py-0.5 rounded-full text-[10px] font-black`}>{s.label}</span>;
  };

  if (selectedCampaign) {
    return (
      <main className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <button onClick={() => setSelectedCampaign(null)} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          캠페인 목록
        </button>

        <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 mb-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {statusBadge(selectedCampaign.status)}
                <span className="text-[10px] text-slate-400 font-bold">{selectedCampaign.type === 'collaboration' ? '협업 캠페인' : '광고 캠페인'}</span>
              </div>
              <h2 className="text-xl md:text-2xl font-black text-slate-900">{selectedCampaign.title}</h2>
              {selectedCampaign.brand_name && <p className="text-sm text-slate-500 font-bold mt-1">{selectedCampaign.brand_name}</p>}
            </div>
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
          </div>
          {selectedCampaign.description && <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap mb-4">{selectedCampaign.description}</p>}
          {selectedCampaign.status === 'pending_approval' && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4">
              <p className="text-sm font-black text-orange-700">관리자 승인 대기 중</p>
              <p className="text-xs text-orange-500 font-medium mt-1">캠페인이 관리자 승인 후 공개됩니다. 승인 전까지 일반 유저에게 노출되지 않습니다.</p>
            </div>
          )}
          {selectedCampaign.status === 'admin_rejected' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <p className="text-sm font-black text-red-700">관리자에 의해 승인 거절됨</p>
              {selectedCampaign.admin_rejected_reason && (
                <p className="text-xs text-red-500 font-medium mt-1">사유: {selectedCampaign.admin_rejected_reason}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {selectedCampaign.category && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-[9px] text-slate-400 font-black uppercase">카테고리</p>
                <p className="text-sm font-black text-slate-900">{selectedCampaign.category}</p>
              </div>
            )}
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[9px] text-slate-400 font-black uppercase">보상</p>
              <p className="text-sm font-black text-slate-900">{selectedCampaign.reward_type === 'fixed' ? '고정 금액' : selectedCampaign.reward_type === 'product' ? '제품 제공' : selectedCampaign.reward_type || '-'} {selectedCampaign.reward_amount && `/ ${selectedCampaign.reward_amount}`}</p>
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
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-4">지원자 목록 ({applicants.length}명)</h3>
          {applicantsLoading ? (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
            </div>
          ) : applicants.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">📭</p>
              <p className="text-sm text-slate-400 font-bold">아직 지원자가 없습니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {applicants.map(app => (
                <div key={app.id} className="border border-slate-100 rounded-xl p-4 hover:border-slate-200 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-sm text-slate-900">@{app.applicant_username}</span>
                        {statusBadge(app.status)}
                      </div>
                      {app.message && <p className="text-xs text-slate-600 font-medium mt-1 whitespace-pre-wrap">{app.message}</p>}
                      <div className="flex flex-wrap gap-3 mt-2">
                        {app.contact && <span className="text-[10px] text-slate-400 font-bold">연락처: {app.contact}</span>}
                        {app.portfolio_url && (
                          <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 font-bold hover:underline">
                            포트폴리오 보기
                          </a>
                        )}
                        <span className="text-[10px] text-slate-300 font-bold">{new Date(app.created_at).toLocaleDateString('ko-KR')}</span>
                      </div>
                    </div>
                    {app.status === 'pending' && (
                      <div className="flex gap-1.5 ml-3 flex-shrink-0">
                        <button onClick={() => handleApplicantStatus(app.id, 'accepted')} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 transition-colors">
                          수락
                        </button>
                        <button onClick={() => handleApplicantStatus(app.id, 'rejected')} className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-200 transition-colors">
                          거절
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  if (showForm) {
    return (
      <main className="p-4 md:p-14 w-full animate-in fade-in duration-500">
        <button onClick={resetForm} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          캠페인 목록
        </button>

        <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h2 className="text-xl font-black text-slate-900 mb-6">{editingCampaign ? '캠페인 수정' : '새 캠페인 등록'}</h2>
          <form onSubmit={handleCreateOrUpdate} className="space-y-5">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1.5">캠페인 유형</label>
              <select
                value={formData.type}
                onChange={e => setFormData(p => ({ ...p, type: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
              >
                <option value="collaboration">협업 캠페인</option>
                <option value="advertisement">광고 캠페인</option>
                <option value="review">리뷰 캠페인</option>
                <option value="event">이벤트 캠페인</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1.5">캠페인 제목 *</label>
              <input
                type="text" value={formData.title}
                onChange={e => setFormData(p => ({ ...p, title: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                placeholder="캠페인 제목을 입력하세요"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1.5">상세 설명</label>
              <textarea
                value={formData.description}
                onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[120px] resize-y"
                placeholder="캠페인 상세 내용을 입력하세요 (모집 조건, 활동 내용 등)"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">브랜드명</label>
                <input
                  type="text" value={formData.brand_name}
                  onChange={e => setFormData(p => ({ ...p, brand_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="브랜드 이름"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">카테고리</label>
                <select
                  value={formData.category}
                  onChange={e => setFormData(p => ({ ...p, category: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                >
                  <option value="">카테고리 선택</option>
                  <option value="fashion">패션</option>
                  <option value="beauty">뷰티</option>
                  <option value="food">맛집/음식</option>
                  <option value="travel">여행</option>
                  <option value="lifestyle">라이프스타일</option>
                  <option value="tech">테크/IT</option>
                  <option value="fitness">운동/건강</option>
                  <option value="pet">반려동물</option>
                  <option value="other">기타</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">보상 유형</label>
                <select
                  value={formData.reward_type}
                  onChange={e => setFormData(p => ({ ...p, reward_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                >
                  <option value="fixed">고정 금액</option>
                  <option value="product">제품 제공</option>
                  <option value="revenue_share">수익 배분</option>
                  <option value="mixed">복합</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">보상 금액/내용</label>
                <input
                  type="text" value={formData.reward_amount}
                  onChange={e => setFormData(p => ({ ...p, reward_amount: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="예: 500,000원, 제품 1세트"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">모집 인원 (0=무제한)</label>
                <input
                  type="number" value={formData.max_applicants}
                  onChange={e => setFormData(p => ({ ...p, max_applicants: parseInt(e.target.value) || 0 }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  min="0"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1.5">지원 조건</label>
              <textarea
                value={formData.requirements}
                onChange={e => setFormData(p => ({ ...p, requirements: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[80px] resize-y"
                placeholder="팔로워 수, 콘텐츠 스타일 등 지원 조건"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">시작일</label>
                <input
                  type="date" value={formData.start_date}
                  onChange={e => setFormData(p => ({ ...p, start_date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">종료일</label>
                <input
                  type="date" value={formData.end_date}
                  onChange={e => setFormData(p => ({ ...p, end_date: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit" disabled={submitting}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    {editingCampaign ? '수정 중...' : '등록 중...'}
                  </>
                ) : (
                  editingCampaign ? '캠페인 수정' : '캠페인 등록'
                )}
              </button>
              <button type="button" onClick={resetForm} className="px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 transition-colors">
                취소
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-8">
        <div>
          <h2 className="text-lg md:text-2xl font-black text-slate-900">캠페인 협업</h2>
          <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">캠페인을 등록하고 크리에이터의 지원을 받으세요</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl font-black text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
          새 캠페인 등록
        </button>
      </header>

      {loading ? (
        <div className="text-center py-20">
          <div className="w-10 h-10 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm text-slate-400 font-bold">캠페인 불러오는 중...</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">📢</div>
          <h3 className="text-lg font-black text-slate-900 mb-2">등록된 캠페인이 없습니다</h3>
          <p className="text-sm text-slate-500 font-medium mb-6">새 캠페인을 등록하여 크리에이터의 지원을 받아보세요</p>
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-black text-sm transition-all shadow-lg"
          >
            첫 캠페인 등록하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map(campaign => (
            <div
              key={campaign.id}
              className="bg-white rounded-2xl border border-slate-100 p-5 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer group"
              onClick={() => handleSelectCampaign(campaign)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  {statusBadge(campaign.status)}
                  <span className="text-[9px] text-slate-400 font-bold uppercase">
                    {campaign.type === 'collaboration' ? '협업' : campaign.type === 'advertisement' ? '광고' : campaign.type === 'review' ? '리뷰' : '이벤트'}
                  </span>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button onClick={() => handleEdit(campaign)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors" title="수정">
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  <button onClick={() => handleDelete(campaign.id)} className="p-1.5 hover:bg-red-50 rounded-lg transition-colors" title="삭제">
                    <svg className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
              <h3 className="font-black text-base text-slate-900 mb-1 line-clamp-1 group-hover:text-blue-600 transition-colors">{campaign.title}</h3>
              {campaign.brand_name && <p className="text-xs text-slate-400 font-bold mb-2">{campaign.brand_name}</p>}
              {campaign.description && <p className="text-xs text-slate-500 font-medium line-clamp-2 mb-3">{campaign.description}</p>}
              <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <span className="text-xs font-black text-blue-600">{campaign.application_count}명 지원</span>
                  {campaign.max_applicants > 0 && <span className="text-[10px] text-slate-400 font-bold">/ {campaign.max_applicants}명</span>}
                </div>
                {campaign.reward_amount && (
                  <span className="text-[10px] text-slate-400 font-bold">{campaign.reward_amount}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
};

export default CampaignCollabManagement;
