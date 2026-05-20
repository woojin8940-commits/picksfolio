import React, { useState, useEffect, useCallback, useRef } from 'react';
import { formatNumberWithCommas, formatKoreanWon } from '../utils/formatters';

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
  instagram_url: string;
  youtube_naver_url: string;
  status: string;
  created_at: string;
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

const CampaignCollabManagement: React.FC<CampaignCollabManagementProps> = ({ businessUsername, companyName }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [applicantsLoading, setApplicantsLoading] = useState(false);
  const [activeTypeFilter, setActiveTypeFilter] = useState('');
  const [thumbnailPreview, setThumbnailPreview] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    type: 'ad_collab',
    title: '',
    description: '',
    brand_name: companyName,
    thumbnail_url: '',
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

  const resizeImage = (file: File, size: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
          'image/jpeg',
          0.9
        );
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
      img.src = objectUrl;
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('이미지 크기는 5MB 이하만 가능합니다.');
      return;
    }
    setUploadingImage(true);

    try {
      const resized = await resizeImage(file, 400);
      const previewUrl = URL.createObjectURL(resized);
      setThumbnailPreview(previewUrl);

      const fd = new FormData();
      fd.append('image', new File([resized], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
      fd.append('username', businessUsername);
      const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.url) {
        setFormData(p => ({ ...p, thumbnail_url: data.url }));
      } else {
        alert('이미지 업로드에 실패했습니다.');
        setThumbnailPreview('');
      }
    } catch {
      alert('이미지 업로드 중 오류가 발생했습니다.');
      setThumbnailPreview('');
    } finally {
      setUploadingImage(false);
    }
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
      thumbnail_url: campaign.thumbnail_url || '',
      category: campaign.category,
      reward_type: campaign.reward_type,
      reward_amount: campaign.reward_amount,
      requirements: campaign.requirements,
      max_applicants: campaign.max_applicants,
      start_date: campaign.start_date || '',
      end_date: campaign.end_date || '',
    });
    setThumbnailPreview(campaign.thumbnail_url || '');
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
      const res = await fetch(`/api/campaigns?id=${id}&business=${businessUsername}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || '삭제에 실패했습니다.');
        return;
      }
      await fetchCampaigns();
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
    setThumbnailPreview('');
    setFormData({
      type: 'ad_collab',
      title: '',
      description: '',
      brand_name: companyName,
      thumbnail_url: '',
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

  const typeLabel = (type: string) => {
    const m: Record<string, string> = { ad_collab: '광고 협업', group_buy: '공동구매', other: '기타', collaboration: '협업', advertisement: '광고/협찬', review: '리뷰', event: '이벤트' };
    return m[type] || type;
  };

  const rewardLabel = (type: string) => {
    const m: Record<string, string> = { fixed: '고정 금액', product: '제품 제공', revenue_share: '수익 배분', mixed: '복합' };
    return m[type] || type;
  };

  const daysRemaining = (endDate: string) => {
    if (!endDate) return null;
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return null;
    if (diff === 0) return 'D-Day';
    return `D-${diff}`;
  };

  const filteredCampaigns = activeTypeFilter
    ? campaigns.filter(c => c.type === activeTypeFilter)
    : campaigns;

  // --- Campaign Detail View ---
  if (selectedCampaign) {
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
                  {statusBadge(selectedCampaign.status)}
                  <span className="text-[11px] text-slate-400 font-bold">{typeLabel(selectedCampaign.type)}</span>
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
          </div>
        </div>

        {/* Applicants */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h3 className="text-lg font-black text-slate-900 mb-4">지원자 목록 ({applicants.length}명)</h3>
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
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-sm text-slate-900">@{app.applicant_username}</span>
                        {statusBadge(app.status)}
                      </div>
                      {app.message && <p className="text-xs text-slate-600 font-medium mt-1 whitespace-pre-wrap">{app.message}</p>}
                      <div className="flex flex-wrap gap-3 mt-2">
                        {app.contact && <span className="text-[10px] text-slate-400 font-bold">연락처: {app.contact}</span>}
                        {app.instagram_url && (
                          <a href={app.instagram_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-pink-500 font-bold hover:underline">
                            인스타그램
                          </a>
                        )}
                        {app.youtube_naver_url && (
                          <a href={app.youtube_naver_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-red-500 font-bold hover:underline">
                            유튜브/네이버
                          </a>
                        )}
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

  // --- Campaign Form ---
  if (showForm) {
    return (
      <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-3xl mx-auto">
        <button onClick={resetForm} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-black text-sm mb-6 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          캠페인 목록
        </button>

        <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-8 shadow-sm">
          <h2 className="text-xl font-black text-slate-900 mb-6">{editingCampaign ? '캠페인 수정' : '새 캠페인 등록'}</h2>
          <form onSubmit={handleCreateOrUpdate} className="space-y-5">
            {/* Thumbnail Upload */}
            <div>
              <label className="block text-xs font-black text-slate-700 mb-2">캠페인 대표 이미지</label>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              {(thumbnailPreview || formData.thumbnail_url) ? (
                <div className="relative w-full aspect-square max-w-[400px] rounded-xl overflow-hidden border border-slate-200 bg-slate-50 group">
                  <img
                    src={thumbnailPreview || formData.thumbnail_url}
                    alt="캠페인 썸네일"
                    className="w-full h-full object-cover"
                  />
                  {uploadingImage && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-white rounded-xl text-xs font-black text-slate-700 shadow-lg"
                    >
                      이미지 변경
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setThumbnailPreview('');
                        setFormData(p => ({ ...p, thumbnail_url: '' }));
                      }}
                      className="px-4 py-2 bg-red-500 text-white rounded-xl text-xs font-black shadow-lg ml-2"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-square max-w-[400px] border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center hover:border-blue-400 hover:bg-blue-50/50 transition-all group"
                >
                  <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-blue-100 transition-colors">
                    <svg className="w-6 h-6 text-slate-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-xs font-bold text-slate-400 group-hover:text-blue-500">클릭하여 이미지 업로드</p>
                  <p className="text-[10px] text-slate-300 mt-1">JPG, PNG (최대 5MB · 400×400 자동 리사이즈)</p>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">캠페인 유형</label>
                <select
                  value={formData.type}
                  onChange={e => setFormData(p => ({ ...p, type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                >
                  <option value="ad_collab">광고 협업</option>
                  <option value="group_buy">공동구매</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">카테고리</label>
                <select
                  value={formData.category}
                  onChange={e => setFormData(p => ({ ...p, category: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
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
                <label className="block text-xs font-black text-slate-700 mb-1.5">모집 인원 (0=무제한)</label>
                <input
                  type="number" value={formData.max_applicants}
                  onChange={e => setFormData(p => ({ ...p, max_applicants: parseInt(e.target.value) || 0 }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  min="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  onChange={e => {
                    const raw = e.target.value;
                    const digitsOnly = raw.replace(/,/g, '');
                    if (/^\d*$/.test(digitsOnly) && digitsOnly.length > 0) {
                      setFormData(p => ({ ...p, reward_amount: formatNumberWithCommas(digitsOnly) + (raw.endsWith('원') ? '원' : '') }));
                    } else {
                      setFormData(p => ({ ...p, reward_amount: raw }));
                    }
                  }}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  placeholder="예: 500,000원, 제품 1세트"
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
                type="submit" disabled={submitting || uploadingImage}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
              <button type="button" onClick={resetForm} className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 transition-colors">
                취소
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  // --- Campaign List ---
  return (
    <main className="p-4 md:p-10 w-full animate-in fade-in duration-500 max-w-5xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-lg md:text-2xl font-black text-slate-900">캠페인 리스트</h2>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {filteredCampaigns.map(campaign => {
            const days = campaign.end_date ? daysRemaining(campaign.end_date) : null;
            return (
              <div
                key={campaign.id}
                className="bg-white rounded-2xl border border-slate-100 hover:border-blue-200 hover:shadow-lg transition-all cursor-pointer group overflow-hidden"
                onClick={() => handleSelectCampaign(campaign)}
              >
                {/* Thumbnail */}
                <div className="w-full h-[200px] bg-slate-50 overflow-hidden relative">
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
                    {statusBadge(campaign.status)}
                    {days && (
                      <span className="bg-rose-500 text-white px-2 py-0.5 rounded-lg text-[10px] font-black shadow-sm">
                        {days}
                      </span>
                    )}
                  </div>
                  {/* Edit/Delete overlay */}
                  <div className="absolute top-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleEdit(campaign)} className="p-1.5 bg-white/90 backdrop-blur-sm hover:bg-white rounded-lg transition-colors shadow-sm" title="수정">
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => handleDelete(campaign.id)} className="p-1.5 bg-white/90 backdrop-blur-sm hover:bg-red-50 rounded-lg transition-colors shadow-sm" title="삭제">
                      <svg className="w-3.5 h-3.5 text-slate-500 hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="p-3.5 md:p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {campaign.brand_name && (
                      <span className="text-[11px] text-slate-400 font-bold">{campaign.brand_name}</span>
                    )}
                    {campaign.category && (
                      <>
                        <span className="text-slate-200">·</span>
                        <span className="text-[11px] text-slate-400 font-medium">{categoryLabel(campaign.category)}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-black text-sm md:text-base text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors mb-1.5">
                    {campaign.title}
                  </h3>
                  <div className="flex items-center justify-between">
                    {campaign.reward_amount ? (
                      <span className="text-sm font-black text-blue-600">{formatKoreanWon(campaign.reward_amount)}</span>
                    ) : <span />}
                    <span className="text-[11px] text-slate-400 font-bold">
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
    </main>
  );
};

export default CampaignCollabManagement;
