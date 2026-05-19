import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessProposal } from '../types';

interface BusinessInboxProps {
  businessUsername: string;
  companyName: string;
}

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'completed';

const BusinessInbox: React.FC<BusinessInboxProps> = ({ businessUsername, companyName }) => {
  const [proposals, setProposals] = useState<(BusinessProposal & { _influencer?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch all proposals sent by this business (across all influencers).
  // localStorage stores the session as 'biz/{name}', but the route
  // `/api/business-proposals/:businessUsername` matches a single path segment,
  // so the slash must be stripped before encoding.
  const fetchProposals = async () => {
    setLoading(true);
    try {
      const cleanUsername = businessUsername.replace(/^biz\//, '');
      const res = await fetch(`/api/business-proposals/${encodeURIComponent(cleanUsername)}`);
      if (res.ok) {
        const data = await res.json();
        setProposals(data.proposals || []);
      }
    } catch (e) {
      console.error('Failed to fetch business proposals:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProposals();
  }, [businessUsername]);

  const filteredProposals = useMemo(() => {
    if (statusFilter === 'all') return proposals;
    return proposals.filter(p => p.status === statusFilter);
  }, [proposals, statusFilter]);

  const pendingCount = proposals.filter(p => p.status === 'pending').length;
  const acceptedCount = proposals.filter(p => p.status === 'accepted').length;
  const rejectedCount = proposals.filter(p => p.status === 'rejected').length;
  const completedCount = proposals.filter(p => p.status === 'completed').length;

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => `${fee.toLocaleString()}원`;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-lg">대기중</span>;
      case 'accepted': return <span className="px-2.5 py-1 bg-green-100 text-green-700 text-[11px] font-bold rounded-lg">수락됨</span>;
      case 'rejected': return <span className="px-2.5 py-1 bg-red-100 text-red-700 text-[11px] font-bold rounded-lg">거절됨</span>;
      case 'completed': return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-[11px] font-bold rounded-lg">완료</span>;
      default: return null;
    }
  };

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-3xl font-black text-slate-900">비즈니스 제안 현황</h2>
        <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">
          {companyName}에서 보낸 협업 제안 현황을 확인합니다
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-2 md:gap-4 mb-6">
        {[
          { label: '전체', count: proposals.length, filter: 'all' as StatusFilter, activeColor: 'border-blue-300 bg-blue-50 ring-2 ring-blue-200', textColor: 'text-slate-900' },
          { label: '대기중', count: pendingCount, filter: 'pending' as StatusFilter, activeColor: 'border-amber-300 bg-amber-50 ring-2 ring-amber-200', textColor: 'text-amber-600' },
          { label: '수락됨', count: acceptedCount, filter: 'accepted' as StatusFilter, activeColor: 'border-green-300 bg-green-50 ring-2 ring-green-200', textColor: 'text-green-600' },
          { label: '거절됨', count: rejectedCount, filter: 'rejected' as StatusFilter, activeColor: 'border-red-300 bg-red-50 ring-2 ring-red-200', textColor: 'text-red-500' },
          { label: '완료', count: completedCount, filter: 'completed' as StatusFilter, activeColor: 'border-blue-300 bg-blue-50 ring-2 ring-blue-200', textColor: 'text-blue-600' },
        ].map(({ label, count, filter, activeColor, textColor }) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={`p-3 md:p-5 rounded-2xl border transition-all text-left ${
              statusFilter === filter ? `${activeColor} shadow-md` : 'border-slate-100 bg-white shadow-sm hover:border-slate-200'
            }`}
          >
            <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
            <p className={`text-lg md:text-2xl font-black ${textColor}`}>{count}<span className="text-xs md:text-sm font-bold">건</span></p>
          </button>
        ))}
      </div>

      {/* Proposal List */}
      {loading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">로딩 중...</p>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-12 text-center">
          <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">📨</div>
          <h3 className="font-black text-slate-900 text-lg mb-2">
            {statusFilter !== 'all' ? `${statusFilter === 'pending' ? '대기중인' : statusFilter === 'accepted' ? '수락된' : statusFilter === 'rejected' ? '거절된' : '완료된'} 제안이 없습니다` : '보낸 제안이 없습니다'}
          </h3>
          <p className="text-slate-400 text-sm font-medium">인플루언서에게 제안을 보내면 여기서 현황을 확인할 수 있습니다.</p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredProposals.map((proposal) => (
            <div
              key={proposal.id}
              className={`bg-white rounded-2xl border transition-all ${
                expandedId === proposal.id ? 'border-blue-200 shadow-lg shadow-blue-100/50' : 'border-slate-100 shadow-sm hover:border-slate-200 hover:shadow-md'
              }`}
            >
              <div
                className="p-4 md:p-6 flex items-center gap-3 md:gap-4 cursor-pointer"
                onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    {getStatusBadge(proposal.status)}
                    <span className="text-[11px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md">
                      @{proposal.influencer_username}
                    </span>
                  </div>
                  <h4 className="font-black text-slate-900 text-base md:text-lg truncate">{proposal.title}</h4>
                  <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">
                    {proposal.category} · {formatDate(proposal.start_date)} ~ {formatDate(proposal.end_date)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black text-blue-600 text-base md:text-lg">{formatFee(proposal.fee)}</p>
                </div>
                <svg
                  className={`w-5 h-5 text-slate-300 transition-transform shrink-0 ${expandedId === proposal.id ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {expandedId === proposal.id && (
                <div className="px-4 md:px-6 pb-6 border-t border-slate-100 pt-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">제안 금액</p>
                        <p className="text-2xl font-black text-blue-700 mt-1">{formatFee(proposal.fee)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">대상 인플루언서</p>
                        <p className="text-sm font-bold text-blue-600 mt-1">@{proposal.influencer_username}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">상세 내용</p>
                    <p className="text-sm text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{proposal.content}</p>
                  </div>

                  {proposal.status === 'rejected' && proposal.rejection_reason && (
                    <div className="px-4 py-3 bg-red-50 rounded-xl border border-red-100">
                      <p className="text-[11px] font-black text-red-400 uppercase tracking-widest mb-1.5">거절 사유</p>
                      <p className="text-sm text-red-700 font-medium leading-relaxed">{proposal.rejection_reason}</p>
                    </div>
                  )}

                  {/* Timeline Chat Button - for accepted/completed proposals */}
                  {(proposal.status === 'accepted' || proposal.status === 'completed') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.dispatchEvent(new CustomEvent('navigate-timeline', { detail: { proposalId: proposal.id } }));
                      }}
                      className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 rounded-xl font-black text-sm shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      타임라인에서 대화하기
                    </button>
                  )}

                  <p className="text-[10px] text-slate-400 font-bold pt-1">
                    제안일: {formatDate(proposal.created_at)}
                    {proposal.updated_at && ` · 업데이트: ${formatDate(proposal.updated_at)}`}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BusinessInbox;
