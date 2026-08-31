import React, { useState, useEffect, useMemo } from 'react';
import type { BusinessProposal } from '../types';
import { formatKRW } from '../utils/formatters';
import { authHeaders, apiService } from '../services/apiService';
import {
  CampaignCollabStatus,
  dropProposalsCoveredByCollabs,
  openCampaignCollab,
  toCampaignCollabStatuses,
} from '../utils/campaignCollabStatus';

interface BusinessInboxProps {
  businessUsername: string;
  companyName: string;
}

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'completed';

/**
 * 이 화면이 보여 주는 "제안 현황"에는 두 갈래가 들어온다.
 *
 *   · 비즈니스 제안   브랜드가 인플루언서에게 직접 보낸 건
 *   · 캠페인 협업     캠페인에 지원한 사람을 선정해 담당자를 거쳐 돌아가는 건
 *
 * 예전에는 앞의 것만 있었다. 그래서 캠페인으로 다섯 명과 촬영을 진행하는 중에도 이
 * 화면은 "보낸 제안이 없습니다"였고, 진행 상황은 캠페인 협업 화면을 따로 열어야
 * 보였다. 같은 질문("지금 몇 건이 돌아가고 있나")에 두 화면이 다른 답을 하고 있었던
 * 셈이다. 두 갈래를 한 목록에 놓고, 줄마다 어느 갈래인지 배지로 남긴다.
 */
type InboxItem =
  | { kind: 'proposal'; key: string; at: string; bucket: StatusFilter; proposal: BusinessProposal & { _influencer?: string } }
  | { kind: 'collab'; key: string; at: string; bucket: StatusFilter; collab: CampaignCollabStatus };

const BusinessInbox: React.FC<BusinessInboxProps> = ({ businessUsername, companyName }) => {
  const cleanUsername = businessUsername.replace(/^biz\//, '');
  const cacheKey = `picks_biz_inbox_${cleanUsername.toLowerCase()}`;

  const cachedProposals = (() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  })();

  const [proposals, setProposals] = useState<(BusinessProposal & { _influencer?: string })[]>(cachedProposals);
  const [collabs, setCollabs] = useState<CampaignCollabStatus[]>([]);
  const [loading, setLoading] = useState(cachedProposals.length === 0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /**
   * 목록에서 내린 캠페인 협업 id. 협업 줄은 이 화면의 제안 API 가 아니라 협업 목록
   * API 에서 오므로, 서버가 알려 준 이 집합으로 화면에서 걸러 낸다.
   */
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchProposals = async () => {
    try {
      const res = await fetch(`/api/business-proposals/${encodeURIComponent(cleanUsername)}`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const fresh = data.proposals || [];
        setProposals(fresh);
        setHiddenIds(new Set<string>(data.hiddenIds || []));
        try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch {}
      }
    } catch (e) {
      console.error('Failed to fetch business proposals:', e);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 비즈니스 제안 지우기. 인플루언서 수신함의 삭제와 같은 경로를 쓴다 — SQL 행과
   * 양쪽 캐시, 딸려 생긴 정산 항목·협업 일정까지 함께 지워진다. 그래서 확인 문구에
   * 되돌릴 수 없다는 것을 분명히 적는다.
   */
  const deleteProposalRow = async (proposal: BusinessProposal) => {
    const warning = proposal.status === 'accepted'
      ? `@${proposal.influencer_username} 님이 수락한 제안입니다. 지우면 인플루언서 수신함과 협업 현황에서도 사라지고 되돌릴 수 없습니다. 계속하시겠습니까?`
      : '이 제안을 지웁니다. 삭제 후 복구할 수 없습니다. 계속하시겠습니까?';
    if (!confirm(warning)) return;

    setRemovingId(proposal.id);
    const ok = await apiService.deleteBusinessProposal(cleanUsername, proposal.id);
    if (ok) {
      setProposals(prev => {
        const next = prev.filter(p => p.id !== proposal.id);
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch {}
        return next;
      });
      if (expandedId === proposal.id) setExpandedId(null);
    } else {
      alert('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    setRemovingId(null);
  };

  /**
   * 캠페인 협업 줄 내리기. 협업은 담당자와 인플루언서가 함께 쓰는 진행 기록이라
   * 지우지 않고 이 목록에서만 감춘다 — 진행은 브랜드 협업현황에서 그대로 볼 수 있다.
   */
  const hideCollabRow = async (collab: CampaignCollabStatus) => {
    if (!confirm('이 협업을 제안 현황 목록에서 내립니다. 협업 자체는 지워지지 않고 브랜드 협업현황에서 계속 확인할 수 있습니다.')) return;

    setRemovingId(collab.id);
    const ok = await apiService.deleteBusinessProposal(cleanUsername, collab.id, 'hide');
    if (ok) {
      setHiddenIds(prev => new Set(prev).add(collab.id));
      if (expandedId === collab.id) setExpandedId(null);
    } else {
      alert('목록에서 내리지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    setRemovingId(null);
  };

  /**
   * 캠페인 협업은 실패해도 화면을 멈추지 않는다. 제안 목록은 이미 왔는데 협업 요청
   * 하나 때문에 전체가 로딩으로 남으면, 있던 정보까지 못 보게 된다.
   */
  const fetchCollabs = async () => {
    try {
      const res = await apiService.getCollabs('brand');
      setCollabs(toCampaignCollabStatuses(res.collabs || [], 'brand'));
    } catch (e) {
      console.error('Failed to fetch campaign collabs:', e);
    }
  };

  useEffect(() => {
    fetchProposals();
    fetchCollabs();
    const interval = setInterval(() => {
      fetchProposals();
      fetchCollabs();
    }, 30_000);
    return () => clearInterval(interval);
  }, [businessUsername]);

  /**
   * 두 갈래를 한 목록으로. 최근에 움직인 것이 위로 온다.
   *
   * 상태 칸은 제안의 다섯 상태를 그대로 쓴다. 진행 중인 캠페인 협업은 '진행중'
   * (수락된 제안과 같은 칸)에, 끝난 협업은 '완료'에 들어간다 — 협업에는 '대기중'과
   * '거절됨'이 없다(선정된 뒤에 생기는 것이라서).
   */
  const items = useMemo<InboxItem[]>(() => {
    // 선정된 캠페인 지원자는 제안 목록에도 한 줄로 접혀서 온다. 협업 줄과 겹치는
    // 것을 빼지 않으면 같은 협업이 두 줄로 뜨고 건수도 두 번 세어진다.
    const fromProposals: InboxItem[] = dropProposalsCoveredByCollabs(proposals, collabs).map(p => ({
      kind: 'proposal',
      key: `p:${p.id}`,
      at: String(p.updated_at || p.created_at || ''),
      bucket: (['pending', 'accepted', 'rejected', 'completed'].includes(String(p.status))
        ? String(p.status)
        : 'pending') as StatusFilter,
      proposal: p,
    }));
    const fromCollabs: InboxItem[] = collabs
      .filter(c => c.state !== 'cancelled' && !hiddenIds.has(c.id))
      .map(c => ({
        kind: 'collab',
        key: `c:${c.id}`,
        at: c.updatedAt,
        bucket: c.state === 'completed' ? 'completed' : 'accepted',
        collab: c,
      }));
    return [...fromProposals, ...fromCollabs].sort((a, b) => b.at.localeCompare(a.at));
  }, [proposals, collabs, hiddenIds]);

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return items;
    return items.filter(i => i.bucket === statusFilter);
  }, [items, statusFilter]);

  const countOf = (bucket: StatusFilter) => items.filter(i => i.bucket === bucket).length;
  const pendingCount = countOf('pending');
  const acceptedCount = countOf('accepted');
  const rejectedCount = countOf('rejected');
  const completedCount = countOf('completed');

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-lg">대기중</span>;
      case 'accepted': return <span className="px-2.5 py-1 bg-green-100 text-green-700 text-[11px] font-bold rounded-lg">진행중</span>;
      case 'rejected': return <span className="px-2.5 py-1 bg-red-100 text-red-700 text-[11px] font-bold rounded-lg">거절됨</span>;
      case 'completed': return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-[11px] font-bold rounded-lg">완료</span>;
      default: return null;
    }
  };

  /** 어느 갈래에서 온 줄인지. 통합 목록에서 이것만이 "담당자를 거치는 건"을 알려 준다. */
  const sourceBadge = (label: string, tone: string) => (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${tone}`}>{label}</span>
  );

  const renderProposal = (proposal: BusinessProposal & { _influencer?: string }) => (
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
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {getStatusBadge(proposal.status)}
            {sourceBadge('비즈니스 제안', 'bg-slate-100 text-slate-500')}
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

          {/* 협업 타임라인 — 수락을 기다리는 제안도 열어 둔다. 조건을
              물어볼 창구가 없으면 확인 없이 수락하거나 그냥 거절된다. */}
          {(proposal.status === 'pending' || proposal.status === 'accepted' || proposal.status === 'completed') && (
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
              {proposal.status === 'pending' ? '타임라인에서 조건 상의하기' : '타임라인에서 대화하기'}
            </button>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[10px] text-slate-400 font-bold">
              제안일: {formatDate(proposal.created_at)}
              {proposal.updated_at && ` · 업데이트: ${formatDate(proposal.updated_at)}`}
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); deleteProposalRow(proposal); }}
              disabled={removingId === proposal.id}
              className="flex-shrink-0 text-[11px] font-black text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors"
            >
              {removingId === proposal.id ? '삭제 중...' : '삭제'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderCollab = (collab: CampaignCollabStatus) => (
    <div
      key={collab.id}
      className={`bg-white rounded-2xl border transition-all ${
        expandedId === collab.id ? 'border-violet-200 shadow-lg shadow-violet-100/50' : 'border-slate-100 shadow-sm hover:border-slate-200 hover:shadow-md'
      }`}
    >
      <div
        className="p-4 md:p-6 flex items-center gap-3 md:gap-4 cursor-pointer"
        onClick={() => setExpandedId(expandedId === collab.id ? null : collab.id)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {getStatusBadge(collab.state === 'completed' ? 'completed' : 'accepted')}
            {sourceBadge('캠페인 협업', 'bg-violet-100 text-violet-600')}
            <span className="text-[11px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-md">
              @{collab.creatorUsername}
            </span>
            {collab.mine && collab.state === 'in_progress' && (
              sourceBadge('내 차례', 'bg-amber-100 text-amber-700')
            )}
          </div>
          <h4 className="font-black text-slate-900 text-base md:text-lg truncate">{collab.title}</h4>
          <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">
            {collab.currentStageTitle ? `${collab.currentStageTitle} 단계` : '진행 준비'}
            {collab.endDate ? ` · ${formatDate(collab.endDate)}까지` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-black text-violet-600 text-base md:text-lg">{collab.progress}%</p>
          {collab.fee > 0 && <p className="text-[11px] font-bold text-slate-400">{formatFee(collab.fee)}</p>}
        </div>
        <svg
          className={`w-5 h-5 text-slate-300 transition-transform shrink-0 ${expandedId === collab.id ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expandedId === collab.id && (
        <div className="px-4 md:px-6 pb-6 border-t border-slate-100 pt-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">진행률</p>
              <p className="text-[11px] font-black text-violet-600">{collab.progress}%</p>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${collab.progress}%` }} />
            </div>
          </div>

          <div className="px-4 py-3 bg-slate-50 rounded-xl">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5">지금 할 일</p>
            <p className="text-sm text-slate-700 font-bold leading-relaxed">{collab.todo}</p>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              openCampaignCollab({ campaignId: collab.campaignId, collabId: collab.id });
            }}
            className="w-full bg-gradient-to-r from-violet-500 to-indigo-600 text-white py-3 rounded-xl font-black text-sm shadow-lg shadow-violet-500/30 hover:shadow-violet-500/50 transition-all active:scale-[0.98]"
          >
            캠페인 진행사항 열기
          </button>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[10px] text-slate-400 font-bold">
              시작: {formatDate(collab.startDate)}
              {collab.endDate && ` · 마감: ${formatDate(collab.endDate)}`}
            </p>
            {/* 협업은 지우지 않고 목록에서만 내린다. 글자를 '삭제'로 두면 협업이
                없어지는 것으로 읽혀서, 진행 중인 건을 정리하다 사고가 난다. */}
            <button
              onClick={(e) => { e.stopPropagation(); hideCollabRow(collab); }}
              disabled={removingId === collab.id}
              className="flex-shrink-0 text-[11px] font-black text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors"
            >
              {removingId === collab.id ? '처리 중...' : '목록에서 내리기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-3xl font-black text-slate-900">비즈니스 제안 현황</h2>
        <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">
          {companyName}에서 보낸 협업 제안과 진행 중인 캠페인 협업을 함께 확인합니다
        </p>
      </div>

      {/* Stats Cards */}
      <div className="flex gap-2 md:grid md:grid-cols-5 md:gap-4 mb-6 overflow-x-auto pb-1 scrollbar-hide">
        {[
          { label: '전체', count: items.length, filter: 'all' as StatusFilter, activeColor: 'border-blue-300 bg-blue-50 ring-2 ring-blue-200', textColor: 'text-slate-900' },
          { label: '대기중', count: pendingCount, filter: 'pending' as StatusFilter, activeColor: 'border-amber-300 bg-amber-50 ring-2 ring-amber-200', textColor: 'text-amber-600' },
          { label: '진행중', count: acceptedCount, filter: 'accepted' as StatusFilter, activeColor: 'border-green-300 bg-green-50 ring-2 ring-green-200', textColor: 'text-green-600' },
          { label: '거절됨', count: rejectedCount, filter: 'rejected' as StatusFilter, activeColor: 'border-red-300 bg-red-50 ring-2 ring-red-200', textColor: 'text-red-500' },
          { label: '완료', count: completedCount, filter: 'completed' as StatusFilter, activeColor: 'border-blue-300 bg-blue-50 ring-2 ring-blue-200', textColor: 'text-blue-600' },
        ].map(({ label, count, filter, activeColor, textColor }) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={`min-w-[80px] flex-shrink-0 md:min-w-0 p-3 md:p-5 rounded-2xl border transition-all text-left ${
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
      ) : filteredItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 md:p-12 text-center">
          <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4">📨</div>
          <h3 className="font-black text-slate-900 text-lg mb-2">
            {statusFilter !== 'all' ? `${statusFilter === 'pending' ? '대기중인' : statusFilter === 'accepted' ? '진행중인' : statusFilter === 'rejected' ? '거절된' : '완료된'} 건이 없습니다` : '보낸 제안과 진행 중인 협업이 없습니다'}
          </h3>
          <p className="text-slate-400 text-sm font-medium">인플루언서에게 제안을 보내거나 캠페인에서 인플루언서를 선정하면 여기서 현황을 확인할 수 있습니다.</p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredItems.map(item =>
            item.kind === 'proposal' ? renderProposal(item.proposal) : renderCollab(item.collab),
          )}
        </div>
      )}
    </div>
  );
};

export default BusinessInbox;
