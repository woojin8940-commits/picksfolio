import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';

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

interface AdminCampaignApprovalProps {
  token: string;
}

type FilterStatus = 'pending_approval' | 'all' | 'active' | 'admin_rejected' | 'inactive';

const AdminCampaignApproval: React.FC<AdminCampaignApprovalProps> = ({ token }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending_approval');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const statusParam = filterStatus === 'all' ? undefined : filterStatus;
      const data = await apiService.getAdminCampaigns(token, statusParam);
      setCampaigns(data.campaigns || []);
    } catch {
      console.error('Failed to fetch admin campaigns');
    } finally {
      setLoading(false);
    }
  }, [token, filterStatus]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleApprove = async (id: string) => {
    if (!confirm('이 캠페인을 승인하시겠습니까?')) return;
    setProcessing(id);
    const result = await apiService.adminCampaignAction(token, id, 'approve');
    if (result.success) {
      fetchCampaigns();
    } else {
      alert(result.error || '승인 실패');
    }
    setProcessing(null);
  };

  const handleReject = async (id: string) => {
    setProcessing(id);
    const result = await apiService.adminCampaignAction(token, id, 'reject', rejectReason);
    if (result.success) {
      setRejectingId(null);
      setRejectReason('');
      fetchCampaigns();
    } else {
      alert(result.error || '거절 실패');
    }
    setProcessing(null);
  };

  const typeLabel = (t: string) => {
    const map: Record<string, string> = { collaboration: '협업', advertisement: '광고', review: '리뷰', event: '이벤트' };
    return map[t] || t;
  };

  const categoryLabel = (c: string) => {
    const map: Record<string, string> = { fashion: '패션', beauty: '뷰티', food: '맛집/음식', travel: '여행', lifestyle: '라이프스타일', tech: '테크/IT', fitness: '운동/건강', pet: '반려동물', other: '기타' };
    return map[c] || c;
  };

  const rewardLabel = (t: string) => {
    const map: Record<string, string> = { fixed: '고정 금액', product: '제품 제공', revenue_share: '수익 배분', mixed: '복합' };
    return map[t] || t;
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      active: { bg: 'bg-green-100', text: 'text-green-700', label: '승인됨 (모집중)' },
      inactive: { bg: 'bg-slate-100', text: 'text-slate-500', label: '마감' },
      pending_approval: { bg: 'bg-orange-100', text: 'text-orange-700', label: '승인 대기' },
      admin_rejected: { bg: 'bg-red-100', text: 'text-red-700', label: '승인 거절' },
    };
    const s = map[status] || { bg: 'bg-slate-100', text: 'text-slate-500', label: status };
    return <span className={`${s.bg} ${s.text} px-2.5 py-1 rounded-lg text-[10px] font-black`}>{s.label}</span>;
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    const date = new Date(d);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };

  const pendingCount = campaigns.filter(c => c.status === 'pending_approval').length;

  const filters: { key: FilterStatus; label: string }[] = [
    { key: 'pending_approval', label: '승인 대기' },
    { key: 'all', label: '전체' },
    { key: 'active', label: '승인됨' },
    { key: 'admin_rejected', label: '거절됨' },
    { key: 'inactive', label: '마감' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilterStatus(f.key)}
            className={`px-3 py-2 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 ${
              filterStatus === f.key
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
            }`}
          >
            {f.label}
            {f.key === 'pending_approval' && filterStatus !== 'pending_approval' && pendingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] bg-orange-500 text-white">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <div className="w-8 h-8 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">캠페인 불러오는 중...</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <p className="text-4xl mb-3">📢</p>
          <p className="text-sm text-slate-400 font-bold">해당 상태의 캠페인이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(campaign => (
            <div key={campaign.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div
                className="p-4 md:p-5 cursor-pointer hover:bg-slate-50/50 transition-all"
                onClick={() => setExpandedId(expandedId === campaign.id ? null : campaign.id)}
              >
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 rounded-xl overflow-hidden bg-slate-100">
                    {campaign.thumbnail_url ? (
                      <img src={campaign.thumbnail_url} alt={campaign.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
                        <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      {statusBadge(campaign.status)}
                      <span className="text-[10px] text-slate-400 font-bold uppercase">
                        {typeLabel(campaign.type)}
                      </span>
                      {campaign.category && (
                        <span className="text-[10px] text-slate-300 font-bold">
                          {categoryLabel(campaign.category)}
                        </span>
                      )}
                    </div>
                    <h3 className="font-black text-slate-900 text-sm md:text-base truncate">{campaign.title}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-purple-600 font-black">@{campaign.business_username}</span>
                      {campaign.brand_name && <span className="text-xs text-slate-400 font-bold">{campaign.brand_name}</span>}
                      <span className="text-[10px] text-slate-300 font-bold">{formatDate(campaign.created_at)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black text-blue-600">{campaign.application_count}명 지원</p>
                    {campaign.reward_amount && (
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">{campaign.reward_amount}</p>
                    )}
                  </div>
                </div>
              </div>

              {expandedId === campaign.id && (
                <div className="px-4 md:px-5 pb-4 md:pb-5 border-t border-slate-100 pt-4 space-y-4 animate-in fade-in duration-200">
                  {campaign.thumbnail_url && (
                    <div className="w-full h-40 md:h-56 rounded-xl overflow-hidden bg-slate-100">
                      <img src={campaign.thumbnail_url} alt={campaign.title} className="w-full h-full object-cover" />
                    </div>
                  )}

                  {campaign.description && (
                    <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap">{campaign.description}</p>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] text-slate-400 font-black uppercase">캠페인 유형</p>
                      <p className="text-xs font-bold text-slate-900">{typeLabel(campaign.type)}</p>
                    </div>
                    {campaign.category && (
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[9px] text-slate-400 font-black uppercase">카테고리</p>
                        <p className="text-xs font-bold text-slate-900">{categoryLabel(campaign.category)}</p>
                      </div>
                    )}
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] text-slate-400 font-black uppercase">보상</p>
                      <p className="text-xs font-bold text-slate-900">
                        {rewardLabel(campaign.reward_type)} {campaign.reward_amount && `/ ${campaign.reward_amount}`}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] text-slate-400 font-black uppercase">모집 인원</p>
                      <p className="text-xs font-bold text-slate-900">
                        {campaign.max_applicants > 0 ? `${campaign.max_applicants}명` : '무제한'}
                      </p>
                    </div>
                    {campaign.start_date && (
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[9px] text-slate-400 font-black uppercase">시작일</p>
                        <p className="text-xs font-bold text-slate-900">{formatDate(campaign.start_date)}</p>
                      </div>
                    )}
                    {campaign.end_date && (
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[9px] text-slate-400 font-black uppercase">종료일</p>
                        <p className="text-xs font-bold text-slate-900">{formatDate(campaign.end_date)}</p>
                      </div>
                    )}
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] text-slate-400 font-black uppercase">비즈니스 계정</p>
                      <p className="text-xs font-bold text-purple-600">@{campaign.business_username}</p>
                    </div>
                  </div>

                  {campaign.requirements && (
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-[9px] text-slate-400 font-black uppercase mb-1">지원 조건</p>
                      <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap">{campaign.requirements}</p>
                    </div>
                  )}

                  {campaign.status === 'admin_rejected' && campaign.admin_rejected_reason && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                      <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">거절 사유</p>
                      <p className="text-sm text-red-700 font-medium">{campaign.admin_rejected_reason}</p>
                    </div>
                  )}

                  {campaign.status === 'pending_approval' && (
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => handleApprove(campaign.id)}
                        disabled={processing === campaign.id}
                        className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {processing === campaign.id ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                        )}
                        승인
                      </button>
                      <button
                        onClick={() => setRejectingId(rejectingId === campaign.id ? null : campaign.id)}
                        disabled={processing === campaign.id}
                        className="flex-1 bg-red-50 hover:bg-red-100 text-red-600 py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                        거절
                      </button>
                    </div>
                  )}

                  {rejectingId === campaign.id && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3 animate-in fade-in duration-200">
                      <p className="text-sm font-black text-red-700">거절 사유 입력</p>
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        className="w-full border border-red-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 min-h-[80px] resize-y bg-white"
                        placeholder="거절 사유를 입력해 주세요 (비즈니스에게 전달됩니다)"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleReject(campaign.id)}
                          disabled={processing === campaign.id}
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-xl font-black text-sm transition-all disabled:opacity-50"
                        >
                          {processing === campaign.id ? '처리 중...' : '거절 확인'}
                        </button>
                        <button
                          onClick={() => { setRejectingId(null); setRejectReason(''); }}
                          className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-black text-slate-600 transition-colors"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminCampaignApproval;
