import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessProposal } from '../types';
import { apiService } from '../services/apiService';
import { formatKRW } from '../utils/formatters';

interface BusinessDashboardProps {
  userName: string;
}

type SortMode = 'latest' | 'deadline' | 'fee';
type TabCategory = '광고' | '커머스';
type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'completed';

const BusinessDashboard: React.FC<BusinessDashboardProps> = ({ userName }) => {
  const [proposals, setProposals] = useState<BusinessProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabCategory>('광고');
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const fetchProposals = async () => {
    setLoading(true);
    const data = await apiService.getProposals(userName);
    setProposals(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchProposals();
  }, [userName]);

  const handleStatusUpdate = async (proposalId: string, status: 'accepted' | 'rejected', rejectionReasonText?: string) => {
    setUpdatingId(proposalId);
    const success = await apiService.updateProposalStatus(userName, proposalId, status, rejectionReasonText);
    if (success) {
      const updatedProposal = proposals.find(p => p.id === proposalId);
      setProposals(prev =>
        prev.map(p => p.id === proposalId ? { ...p, status, rejection_reason: rejectionReasonText, updated_at: new Date().toISOString() } : p)
      );
      setRejectingId(null);
      setRejectionReason('');

      // Auto-create timeline when proposal is accepted
      if (status === 'accepted' && updatedProposal) {
        try {
          await fetch(`/api/timeline/create/${proposalId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              influencerUsername: userName.toLowerCase(),
              businessUsername: updatedProposal.business_username || '',
              companyName: updatedProposal.company_name,
              proposalTitle: updatedProposal.title,
            }),
          });
        } catch (e) {
          console.error('Failed to auto-create timeline:', e);
        }
      }
    } else {
      alert('상태 업데이트에 실패했습니다.');
    }
    setUpdatingId(null);
  };

  const handleRejectClick = (proposalId: string) => {
    setRejectingId(proposalId);
    setRejectionReason('');
  };

  const handleRejectConfirm = () => {
    if (rejectingId) {
      handleStatusUpdate(rejectingId, 'rejected', rejectionReason || undefined);
    }
  };

  const handleDelete = async (proposalId: string) => {
    if (!confirm('정말 이 제안을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.')) return;
    setDeletingId(proposalId);
    const success = await apiService.deleteProposal(userName, proposalId);
    if (success) {
      setProposals(prev => prev.filter(p => p.id !== proposalId));
      if (expandedId === proposalId) setExpandedId(null);
    } else {
      alert('삭제에 실패했습니다.');
    }
    setDeletingId(null);
  };

  const filteredProposals = useMemo(() => {
    let filtered = proposals.filter(p => p.category === activeTab);

    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => p.status === statusFilter);
    }

    switch (sortMode) {
      case 'deadline':
        filtered.sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime());
        break;
      case 'fee':
        filtered.sort((a, b) => b.fee - a.fee);
        break;
      case 'latest':
      default:
        filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
    }

    return filtered;
  }, [proposals, activeTab, sortMode, statusFilter]);

  // Group proposals by month for schedule view
  const groupedBySchedule = useMemo(() => {
    if (statusFilter === 'all') return null;
    const groups: Record<string, BusinessProposal[]> = {};
    filteredProposals.forEach(p => {
      const d = new Date(p.start_date);
      const key = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    // Sort groups by date (newest first)
    const sorted = Object.entries(groups).sort((a, b) => {
      const dateA = new Date(a[1][0].start_date);
      const dateB = new Date(b[1][0].start_date);
      return dateB.getTime() - dateA.getTime();
    });
    return sorted;
  }, [filteredProposals, statusFilter]);

  // Fee summary for filtered view
  const feeSummary = useMemo(() => {
    const total = filteredProposals.reduce((sum, p) => sum + p.fee, 0);
    return { total, count: filteredProposals.length };
  }, [filteredProposals]);

  const adCount = proposals.filter(p => p.category === '광고').length;
  const commerceCount = proposals.filter(p => p.category === '커머스').length;
  const pendingCount = proposals.filter(p => p.status === 'pending').length;
  const acceptedCount = proposals.filter(p => p.status === 'accepted').length;
  const rejectedCount = proposals.filter(p => p.status === 'rejected').length;

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[10px] font-black rounded-lg">대기중</span>;
      case 'accepted':
        return <span className="px-2.5 py-1 bg-green-100 text-green-700 text-[10px] font-black rounded-lg">수락됨</span>;
      case 'rejected':
        return <span className="px-2.5 py-1 bg-red-100 text-red-700 text-[10px] font-black rounded-lg">거절됨</span>;
      case 'completed':
        return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-[10px] font-black rounded-lg">완료</span>;
      default:
        return null;
    }
  };

  const getDaysLeft = (endDate: string) => {
    if (!endDate) return null;
    const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return <span className="text-red-500 font-black text-[10px]">마감됨</span>;
    if (diff === 0) return <span className="text-red-500 font-black text-[10px]">D-Day</span>;
    if (diff <= 3) return <span className="text-orange-500 font-black text-[10px]">D-{diff}</span>;
    return <span className="text-slate-400 font-bold text-[10px]">D-{diff}</span>;
  };

  const renderProposalCard = (proposal: BusinessProposal) => (
    <div
      key={proposal.id}
      className={`bg-white rounded-2xl border transition-all ${
        expandedId === proposal.id ? 'border-purple-200 shadow-lg shadow-purple-100/50' : 'border-slate-100 shadow-sm hover:border-slate-200'
      }`}
    >
      {/* Row Summary */}
      <div
        className="p-4 md:p-5 flex items-center gap-3 md:gap-4 cursor-pointer"
        onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {getStatusBadge(proposal.status)}
            {getDaysLeft(proposal.end_date)}
          </div>
          <h4 className="font-black text-slate-900 text-sm md:text-base truncate">{proposal.title}</h4>
          <p className="text-slate-400 text-[10px] md:text-xs font-bold mt-0.5">
            {proposal.company_name} · {proposal.contact_person}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-black text-purple-600 text-sm md:text-base">{formatFee(proposal.fee)}</p>
          {proposal.revenue_share != null && proposal.revenue_share > 0 && (
            <p className="text-[10px] font-bold text-slate-400">+{proposal.revenue_share}% 배분</p>
          )}
          <p className="text-[9px] font-bold text-slate-300 mt-0.5">
            {formatDate(proposal.start_date)} ~ {formatDate(proposal.end_date)}
          </p>
        </div>
        <svg
          className={`w-5 h-5 text-slate-300 transition-transform shrink-0 ${expandedId === proposal.id ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded Detail */}
      {expandedId === proposal.id && (
        <div className="px-4 md:px-5 pb-5 border-t border-slate-100 pt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Fee Detail Card */}
          <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl p-4 border border-purple-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">제안 금액</p>
                <p className="text-xl font-black text-purple-700 mt-0.5">{formatFee(proposal.fee)}</p>
              </div>
              {proposal.revenue_share != null && proposal.revenue_share > 0 && (
                <div className="text-right">
                  <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">수익 배분</p>
                  <p className="text-xl font-black text-purple-700 mt-0.5">{proposal.revenue_share}%</p>
                </div>
              )}
              <div className="text-right">
                <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest">일정</p>
                <p className="text-xs font-bold text-purple-600 mt-0.5">{formatDate(proposal.start_date)} ~ {formatDate(proposal.end_date)}</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">상세 내용</p>
            <p className="text-sm text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{proposal.content}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[9px] font-black text-slate-400 uppercase">회사명</p>
              <p className="text-xs font-bold text-slate-900 mt-0.5">{proposal.company_name}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[9px] font-black text-slate-400 uppercase">담당자</p>
              <p className="text-xs font-bold text-slate-900 mt-0.5">{proposal.contact_person}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[9px] font-black text-slate-400 uppercase">이메일</p>
              <p className="text-xs font-bold text-slate-900 mt-0.5 truncate">{proposal.contact_email}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[9px] font-black text-slate-400 uppercase">연락처</p>
              <p className="text-xs font-bold text-slate-900 mt-0.5">{proposal.contact_phone || '-'}</p>
            </div>
          </div>

          {proposal.reference_links && proposal.reference_links.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">레퍼런스 링크</p>
              <div className="space-y-1">
                {proposal.reference_links.map((link, idx) => (
                  <a
                    key={idx}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-purple-600 font-bold hover:underline truncate"
                  >
                    {link}
                  </a>
                ))}
              </div>
            </div>
          )}

          {proposal.attachments && proposal.attachments.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">첨부 파일</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {proposal.attachments.map((url, idx) => {
                  const ext = url.split('.').pop()?.toLowerCase() || '';
                  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
                  const fileLabel: Record<string, string> = {
                    pdf: 'PDF', doc: 'DOC', docx: 'DOCX', xls: 'XLS', xlsx: 'XLSX',
                    ppt: 'PPT', pptx: 'PPTX', txt: 'TXT', zip: 'ZIP',
                    jpg: 'JPG', jpeg: 'JPEG', png: 'PNG', webp: 'WEBP', gif: 'GIF', bmp: 'BMP',
                  };
                  const fileName = url.split('/').pop() || `첨부파일 ${idx + 1}`;
                  return (
                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="block">
                      <div className="w-full h-24 rounded-lg border border-slate-200 bg-slate-50 hover:border-purple-400 hover:bg-purple-50/50 transition-all flex flex-col items-center justify-center gap-1">
                        <span className="text-lg">
                          {isImage ? '🖼️' : ext === 'pdf' ? '📄' : ['doc', 'docx'].includes(ext) ? '📝' : ['xls', 'xlsx'].includes(ext) ? '📊' : ['ppt', 'pptx'].includes(ext) ? '📑' : ext === 'zip' ? '📦' : '📎'}
                        </span>
                        <span className="text-[10px] font-black text-slate-500">{fileLabel[ext] || ext.toUpperCase()}</span>
                        <span className="text-[9px] font-medium text-slate-400 max-w-full px-2 truncate">{fileName}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[9px] text-slate-300 font-bold">
            접수일: {formatDate(proposal.created_at)}
            {proposal.updated_at && ` · 업데이트: ${formatDate(proposal.updated_at)}`}
          </p>

          {/* Action Buttons */}
          {proposal.status === 'pending' && (
            <div className="flex gap-3 pt-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleStatusUpdate(proposal.id, 'accepted'); }}
                disabled={updatingId === proposal.id}
                className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-xl font-black text-sm shadow-lg shadow-green-500/30 hover:shadow-green-500/50 transition-all disabled:opacity-60 active:scale-[0.98]"
              >
                {updatingId === proposal.id ? '처리 중...' : '✓ 수락하기'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleRejectClick(proposal.id); }}
                disabled={updatingId === proposal.id}
                className="flex-1 bg-white text-red-500 py-3 rounded-xl font-black text-sm border-2 border-red-200 hover:bg-red-50 transition-all disabled:opacity-60 active:scale-[0.98]"
              >
                {updatingId === proposal.id ? '처리 중...' : '✗ 거절하기'}
              </button>
            </div>
          )}

          {/* Timeline Chat Button - for accepted/completed proposals */}
          {(proposal.status === 'accepted' || proposal.status === 'completed') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Navigate to the timeline view — timeline was already created on acceptance
                window.dispatchEvent(new CustomEvent('navigate-timeline', { detail: { proposalId: proposal.id } }));
              }}
              className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 text-white py-3 rounded-xl font-black text-sm shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-2"
            >
              <span>💬</span> 타임라인에서 대화하기
            </button>
          )}

          {/* Show rejection reason if rejected */}
          {proposal.status === 'rejected' && proposal.rejection_reason && (
            <div className="pt-2 px-3 py-2.5 bg-red-50 rounded-xl border border-red-100">
              <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">거절 사유</p>
              <p className="text-sm text-red-700 font-medium">{proposal.rejection_reason}</p>
            </div>
          )}

          {/* Delete Button */}
          {proposal.status !== 'pending' && (
            <div className="flex justify-end pt-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(proposal.id); }}
                disabled={deletingId === proposal.id}
                className="px-4 py-2.5 bg-white text-red-500 rounded-xl font-black text-xs border-2 border-red-200 hover:bg-red-50 transition-all disabled:opacity-60 active:scale-[0.98] flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {deletingId === proposal.id ? '삭제 중...' : '삭제'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="p-3 md:p-14 w-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-10">
        <div>
          <h2 className="text-xl md:text-3xl font-black text-slate-900">비즈니스 수신함</h2>
          <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">
            브랜드로부터 받은 협업 제안을 관리합니다
            {pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black">
                새 제안 {pendingCount}건
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => {
            const url = `${window.location.origin}/${userName}/proposal`;
            navigator.clipboard.writeText(url);
            alert('제안 신청 링크가 복사되었습니다!\n브랜드에게 이 링크를 전달하세요.');
          }}
          className="bg-slate-900 text-white px-4 py-2.5 rounded-xl font-black text-xs md:text-sm hover:bg-slate-800 transition-all shadow-lg flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          제안 링크 복사
        </button>
      </div>

      {/* Stats Cards - Clickable Status Filters */}
      <div className="grid grid-cols-4 gap-2 md:gap-4 mb-6">
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-3 md:p-5 rounded-2xl border transition-all text-left ${
            statusFilter === 'all'
              ? 'border-purple-300 bg-purple-50 shadow-md shadow-purple-100/50 ring-2 ring-purple-200'
              : 'border-slate-100 bg-white shadow-sm hover:border-slate-200'
          }`}
        >
          <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">전체</p>
          <p className="text-base md:text-2xl font-black text-slate-900">{proposals.length}<span className="text-xs md:text-sm font-bold">건</span></p>
        </button>
        <button
          onClick={() => setStatusFilter('pending')}
          className={`p-3 md:p-5 rounded-2xl border transition-all text-left ${
            statusFilter === 'pending'
              ? 'border-amber-300 bg-amber-50 shadow-md shadow-amber-100/50 ring-2 ring-amber-200'
              : 'border-slate-100 bg-white shadow-sm hover:border-slate-200'
          }`}
        >
          <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">대기중</p>
          <p className="text-base md:text-2xl font-black text-amber-600">{pendingCount}<span className="text-xs md:text-sm font-bold">건</span></p>
        </button>
        <button
          onClick={() => setStatusFilter('accepted')}
          className={`p-3 md:p-5 rounded-2xl border transition-all text-left ${
            statusFilter === 'accepted'
              ? 'border-green-300 bg-green-50 shadow-md shadow-green-100/50 ring-2 ring-green-200'
              : 'border-slate-100 bg-white shadow-sm hover:border-slate-200'
          }`}
        >
          <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">수락됨</p>
          <p className="text-base md:text-2xl font-black text-green-600">{acceptedCount}<span className="text-xs md:text-sm font-bold">건</span></p>
        </button>
        <button
          onClick={() => setStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')}
          className={`p-3 md:p-5 rounded-2xl border transition-all text-left ${
            statusFilter === 'rejected'
              ? 'border-red-300 bg-red-50 shadow-md shadow-red-100/50 ring-2 ring-red-200'
              : 'border-slate-100 bg-white shadow-sm hover:border-slate-200'
          }`}
        >
          <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">거절됨</p>
          <p className="text-base md:text-2xl font-black text-red-500">{rejectedCount}<span className="text-xs md:text-sm font-bold">건</span></p>
        </button>
      </div>

      {/* Fee Summary Banner (visible when filtered) */}
      {statusFilter !== 'all' && feeSummary.count > 0 && (
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-2xl p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">
                {statusFilter === 'pending' ? '대기중' : statusFilter === 'accepted' ? '수락됨' : statusFilter === 'rejected' ? '거절됨' : '완료'} 총 금액
              </p>
              <p className="text-lg md:text-xl font-black text-purple-700">{formatFee(feeSummary.total)}</p>
            </div>
          </div>
          <p className="text-sm font-bold text-purple-400">{feeSummary.count}건</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setActiveTab('광고')}
          className={`px-3 md:px-4 py-2 md:py-2.5 rounded-xl font-black text-xs md:text-sm transition-all ${
            activeTab === '광고'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
              : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
          }`}
        >
          📢 광고 제안 <span className="ml-1 opacity-70">{adCount}</span>
        </button>
        <button
          onClick={() => setActiveTab('커머스')}
          className={`px-3 md:px-4 py-2 md:py-2.5 rounded-xl font-black text-xs md:text-sm transition-all ${
            activeTab === '커머스'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
              : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
          }`}
        >
          🛒 커머스 제안 <span className="ml-1 opacity-70">{commerceCount}</span>
        </button>

        {/* Sort Dropdown */}
        <div className="ml-auto">
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-600 focus:outline-none focus:border-purple-600"
          >
            <option value="latest">최신순</option>
            <option value="deadline">일정순 (마감 임박)</option>
            <option value="fee">금액순 (높은 순)</option>
          </select>
        </div>
      </div>

      {/* Proposal List */}
      {loading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">로딩 중...</p>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 md:p-12 text-center">
          <div className="w-12 h-12 md:w-16 md:h-16 bg-slate-50 rounded-xl md:rounded-2xl flex items-center justify-center text-2xl md:text-3xl mx-auto mb-3 md:mb-4">
            {statusFilter !== 'all'
              ? (statusFilter === 'accepted' ? '✓' : statusFilter === 'pending' ? '⏳' : statusFilter === 'rejected' ? '✗' : '✔')
              : (activeTab === '광고' ? '📢' : '🛒')}
          </div>
          <h3 className="font-black text-slate-900 text-base md:text-lg mb-2">
            {statusFilter !== 'all'
              ? `${statusFilter === 'pending' ? '대기중인' : statusFilter === 'accepted' ? '수락된' : statusFilter === 'rejected' ? '거절된' : '완료된'} 제안이 없습니다`
              : (activeTab === '광고' ? '광고 제안이 없습니다' : '커머스 제안이 없습니다')}
          </h3>
          <p className="text-slate-400 text-sm font-medium">
            {statusFilter !== 'all'
              ? '해당 상태의 제안이 아직 없습니다.'
              : '브랜드에게 제안 링크를 공유하면 여기서 제안을 관리할 수 있습니다.'}
          </p>
        </div>
      ) : groupedBySchedule ? (
        // Schedule-grouped view (when status filter is active)
        <div className="space-y-6">
          {groupedBySchedule.map(([monthLabel, monthProposals]) => (
            <div key={monthLabel}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-sm font-black text-slate-700">{monthLabel}</h3>
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[10px] font-black text-slate-400">{monthProposals.length}건 · {formatFee(monthProposals.reduce((s, p) => s + p.fee, 0))}</span>
              </div>
              <div className="space-y-3">
                {monthProposals.map(proposal => renderProposalCard(proposal))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredProposals.map(proposal => renderProposalCard(proposal))}
        </div>
      )}

      {/* Rejection Reason Modal */}
      {rejectingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setRejectingId(null); setRejectionReason(''); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <h3 className="font-black text-slate-900 text-lg mb-2">거절 사유 입력</h3>
            <p className="text-slate-400 text-sm font-bold mb-4">거절 사유를 입력하면 관리자가 광고주에게 대안을 제시할 때 참고할 수 있습니다.</p>
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              placeholder="거절 사유를 입력해주세요 (선택사항)"
              className="w-full border border-slate-200 rounded-xl p-3 text-sm font-medium text-slate-700 focus:outline-none focus:border-purple-500 resize-none h-28 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setRejectingId(null); setRejectionReason(''); }}
                className="flex-1 py-3 rounded-xl font-black text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
              >
                취소
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={updatingId === rejectingId}
                className="flex-1 py-3 rounded-xl font-black text-sm bg-red-500 text-white hover:bg-red-600 transition-all disabled:opacity-60"
              >
                {updatingId === rejectingId ? '처리 중...' : '거절 확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessDashboard;
