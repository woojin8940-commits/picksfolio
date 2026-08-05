import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { logout, getUser } from '@netlify/identity';
import type { BusinessProposal } from '../types';
import { apiService } from '../services/apiService';
import { formatKRW } from '../utils/formatters';
import AdminInfluencersPanel from './admin/AdminInfluencersPanel';
import AdminSettlementConsole from './admin/AdminSettlementConsole';
import AdminGrowthCards from './admin/AdminGrowthCards';
import AdminOperatorOverview from './admin/AdminOperatorOverview';
import AdminCampaignApproval from './admin/AdminCampaignApproval';
import AdminCampaignListup from './admin/AdminCampaignListup';
import AdminCampaignBoard from './admin/AdminCampaignBoard';
import AdminCollabManagerConsole from './admin/AdminCollabManagerConsole';
import AdminRevenueCards from './admin/AdminRevenueCards';
import AdminCollabDirectory from './admin/AdminCollabDirectory';
import AdminInfluencerDatabase from './admin/AdminInfluencerDatabase';
import AdminManagerAccounts from './admin/AdminManagerAccounts';
import { isTestProposal } from '../utils/testData';

/**
 * 운영자 대시보드 — 탭을 일하는 순서대로 묶는다.
 *
 * 탭이 13개까지 늘어나 두 줄로 접히면서, 무엇이 매일 보는 화면이고 무엇이 어쩌다
 * 한 번 여는 화면인지 구분이 사라졌다. 그래서 네 묶음으로 나눴다.
 *
 *   현황     — 전체 현황 (하루를 여기서 시작한다)
 *   캠페인   — 승인 → 리스트업 → 캠페인 관리 (돈이 흐르는 순서 그대로)
 *   인플루언서 — 인플루언서 DB, 브랜드 매칭 지원자
 *   운영     — 회원 관리, 담당자 계정, 정산·매출
 *
 * 준비중이거나 다른 탭과 겹치던 화면(라이브 운영·라이브 승인·제안 워크플로·
 * 인플루언서별·일정 캘린더)은 없앴다. 1:1 다이렉트 제안은 전체 현황 아래의 목록에서
 * 그대로 볼 수 있으므로 별도 탭이 필요하지 않다.
 */

type OperatorTab =
  | 'overview'
  | 'campaigns'
  | 'listup'
  | 'collabs'
  | 'influencerdb'
  | 'directory'
  | 'users'
  | 'managers'
  | 'settlement';

type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'completed';

interface AdminStats {
  totalInfluencers: number;
  totalProposals: number;
  pending: number;
  accepted: number;
  completed: number;
  rejected: number;
}

interface SettlementSummary {
  total: number;
  scheduled: number;
  pending: number;
  completed: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
}

interface AdminNotification {
  id: string;
  type: 'proposal_accepted' | 'proposal_rejected';
  influencer_username: string;
  proposal_id: string;
  proposal_title: string;
  company_name: string;
  rejection_reason?: string;
  created_at: string;
  read: boolean;
}

interface OperatorDashboardProps {
  onLogout: () => void;
}

const OperatorDashboard: React.FC<OperatorDashboardProps> = ({ onLogout }) => {
  const [proposals, setProposals] = useState<(BusinessProposal & { _username: string })[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [settlementSummary, setSettlementSummary] = useState<SettlementSummary | null>(null);
  // /api/admin/operator-overview 집계. 전체 현황과 순수익 카드가 같은 응답을 쓴다.
  const [overview, setOverview] = useState<any | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<OperatorTab>('overview');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Operators work against real accounts by default; seed/QA data is hidden
  // until this toggle is flipped on.
  const [showTestData, setShowTestData] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  // Indicates the admin is authenticated and sub-panels can render.
  // The current @netlify/identity SDK does not expose access tokens to the
  // browser — auth is cookie-based via the `nf_jwt` cookie sent automatically
  // with `credentials: 'same-origin'`. Sub-panels and apiService calls work
  // off that cookie, so we only need a flag to know auth is ready.
  const [adminToken, setAdminToken] = useState<string>('');

  const getToken = useCallback(async () => {
    const user = await getUser();
    const identityToken = (user as any)?.token?.access_token || '';
    if (identityToken) return identityToken;
    return localStorage.getItem('picks_admin_token') || '';
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      let token = '';
      const user = await getUser();
      if (user) {
        token = (user as any).token?.access_token || '';
      } else {
        token = localStorage.getItem('picks_admin_token') || '';
        if (!token) {
          setError('인증이 만료되었습니다. 다시 로그인해주세요.');
          setLoading(false);
          return;
        }
      }
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/admin/proposals', {
        credentials: 'same-origin',
        headers
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError('관리자 권한이 필요합니다.');
        } else {
          setError('데이터를 불러오는데 실패했습니다.');
        }
        setLoading(false);
        return;
      }
      const data = await res.json();
      setProposals(data.proposals || []);
      setStats(data.stats || null);

      // Mark admin as authenticated so sub-panels render. Use the bearer token
      // when available, otherwise a sentinel so the truthy gate passes — the
      // sub-panels authenticate via the `nf_jwt` cookie either way.
      setAdminToken(token || 'cookie');

      // Fetch notifications (server reads cookie when token is empty).
      const notifData = await apiService.getAdminNotifications(token);
      setNotifications(notifData.notifications || []);
      setUnreadCount(notifData.unreadCount || 0);

      // 전체 현황 집계(가입 계정·브랜드 매칭 지원·캠페인 예산/마진·AI 수익).
      setOverviewLoading(true);
      const overviewData = await apiService.getAdminOperatorOverview(token);
      setOverview(overviewData && !overviewData.error ? overviewData : null);
      setOverviewLoading(false);

      // 정산 요약은 순수익 카드의 거래 현황과 정산 탭이 함께 쓴다.
      try {
        const settlementData = await apiService.getAdminSettlementsOverview(token);
        setSettlementSummary(settlementData.summary || null);
      } catch {
        setSettlementSummary(null);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    localStorage.removeItem('picks_admin_token');
    onLogout();
  };

  const handleMarkAllRead = async () => {
    const token = await getToken();
    await apiService.markNotificationsRead(token, undefined, true);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const filteredProposals = useMemo(() => {
    let filtered = proposals;
    if (!showTestData) {
      filtered = filtered.filter(p => !isTestProposal(p));
    }
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => p.status === statusFilter);
    }
    return filtered;
  }, [proposals, statusFilter, showTestData]);

  const hiddenTestCount = useMemo(
    () => proposals.filter(p => isTestProposal(p)).length,
    [proposals]
  );

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => formatKRW(fee);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-black rounded-lg">대기중</span>;
      case 'accepted':
        return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-black rounded-lg">수락됨</span>;
      case 'rejected':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-black rounded-lg">거절됨</span>;
      case 'completed':
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black rounded-lg">완료</span>;
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

  const formatTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    return `${days}일 전`;
  };

  // 탭 묶음. 배지는 "지금 손이 필요한 건수"만 붙인다 — 모든 탭에 숫자를 붙이면
  // 급한 것이 무엇인지 다시 알 수 없게 된다.
  const pendingCampaigns = overview?.campaigns?.pendingApproval || 0;
  const pendingDirectory = overview?.directory?.influencer?.pending || 0;
  const navGroups: { group: string; tabs: { key: OperatorTab; label: string; badge?: number }[] }[] = [
    { group: '현황', tabs: [{ key: 'overview', label: '전체 현황' }] },
    {
      group: '캠페인',
      tabs: [
        { key: 'campaigns', label: '1. 캠페인 승인', badge: pendingCampaigns },
        { key: 'listup', label: '2. 인플루언서 리스트업' },
        { key: 'collabs', label: '3. 캠페인 관리' },
      ],
    },
    {
      group: '인플루언서',
      tabs: [
        { key: 'influencerdb', label: '인플루언서 DB' },
        { key: 'directory', label: '브랜드 매칭 지원자', badge: pendingDirectory },
      ],
    },
    {
      group: '운영',
      tabs: [
        { key: 'users', label: '회원 관리' },
        { key: 'managers', label: '담당자 계정' },
        { key: 'settlement', label: '정산·매출' },
      ],
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-red-100 p-8 max-w-md w-full text-center">
          <p className="text-red-500 font-bold mb-4">{error}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={fetchData} className="bg-slate-200 text-slate-900 px-6 py-2.5 rounded-xl font-black text-sm">
              다시 시도
            </button>
            <button onClick={handleLogout} className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-black text-sm">
              다시 로그인
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">PICKS Control Tower</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Business Command Center</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 top-12 w-96 bg-white rounded-2xl border border-slate-100 shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                    <h4 className="font-black text-slate-900 text-sm">알림</h4>
                    {unreadCount > 0 && (
                      <button onClick={handleMarkAllRead} className="text-[10px] font-bold text-blue-600 hover:underline">
                        모두 읽음
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center">
                        <p className="text-slate-400 text-sm font-bold">알림이 없습니다</p>
                      </div>
                    ) : (
                      notifications.slice(0, 20).map(notif => (
                        <div key={notif.id} className={`p-3 ${!notif.read ? 'bg-blue-50/50' : ''}`}>
                          <div className="flex items-start gap-2">
                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${notif.type === 'proposal_accepted' ? 'bg-green-500' : 'bg-red-500'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-700">
                                <span className="font-black text-slate-900">@{notif.influencer_username}</span>
                                {notif.type === 'proposal_accepted' ? '님이 제안을 수락했습니다' : '님이 제안을 거절했습니다'}
                              </p>
                              <p className="text-[10px] font-bold text-slate-400 truncate mt-0.5">
                                {notif.company_name} - {notif.proposal_title}
                              </p>
                              {notif.type === 'proposal_rejected' && notif.rejection_reason && (
                                <p className="text-[10px] font-bold text-red-500 mt-1 bg-red-50 px-2 py-1 rounded-lg">
                                  사유: {notif.rejection_reason}
                                </p>
                              )}
                              <p className="text-[9px] text-slate-300 font-bold mt-1">{formatTimeAgo(notif.created_at)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={fetchData}
              className="px-3 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-all"
            >
              새로고침
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-black hover:bg-red-100 transition-all"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        {/* Tab Navigation — 일하는 순서대로 묶어 둔다. */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          {navGroups.map((group, gi) => (
            <React.Fragment key={group.group}>
              {gi > 0 && <div className="hidden md:block w-px h-8 bg-slate-200" />}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest mr-0.5">{group.group}</span>
                {group.tabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => { setActiveTab(tab.key); setStatusFilter('all'); setExpandedId(null); }}
                    className={`px-3.5 py-2 rounded-xl font-black text-[13px] transition-all flex items-center gap-1.5 ${
                      activeTab === tab.key
                        ? 'bg-slate-900 text-white shadow-lg'
                        : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {tab.label}
                    {!!tab.badge && tab.badge > 0 && (
                      <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-black ${
                        activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* 전체 현황 */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <AdminOperatorOverview
              data={overview}
              loading={overviewLoading}
              onNavigate={(tab) => setActiveTab(tab as OperatorTab)}
            />

            {/* 순수익 — 멤버십 / 캠페인 마진 / AI */}
            {adminToken && (
              <AdminRevenueCards token={adminToken} settlementSummary={settlementSummary} overview={overview} />
            )}

            {/* 활동 지표 */}
            {adminToken && <AdminGrowthCards token={adminToken} />}

            {/* 1:1 다이렉트 제안 — 광고주가 특정 인플루언서에게 직접 보낸 제안 */}
            <div className="space-y-3">
              <div className="flex items-end justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="text-sm font-black text-slate-900">1:1 다이렉트 제안</h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                    광고주가 특정 인플루언서에게 직접 보낸 제안입니다. 공개 모집 캠페인은 캠페인 탭에서 처리합니다.
                  </p>
                </div>
                {hiddenTestCount > 0 && (
                  <button
                    onClick={() => setShowTestData(v => !v)}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                      showTestData ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    title="testuser, 더미 제안 등 운영과 무관한 데이터를 숨기거나 표시합니다."
                  >
                    {showTestData ? `테스트 데이터 표시중 (${hiddenTestCount})` : `테스트 데이터 ${hiddenTestCount}건 숨김`}
                  </button>
                )}
              </div>

              {stats && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { key: 'all' as StatusFilter, label: '전체', count: stats.totalProposals },
                    { key: 'pending' as StatusFilter, label: '대기중', count: stats.pending },
                    { key: 'accepted' as StatusFilter, label: '수락됨', count: stats.accepted },
                    { key: 'rejected' as StatusFilter, label: '거절됨', count: stats.rejected },
                    { key: 'completed' as StatusFilter, label: '완료', count: stats.completed },
                  ].map(f => (
                    <button
                      key={f.key}
                      onClick={() => setStatusFilter(f.key)}
                      className={`px-3 py-1.5 rounded-lg font-black text-[11px] transition-all flex items-center gap-1.5 ${
                        statusFilter === f.key
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {f.label}
                      <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                        statusFilter === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {f.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
                  <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">광고주</div>
                  <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">제안 내용</div>
                  <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">대상 인플루언서</div>
                  <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">금액 / 기간</div>
                  <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">상태</div>
                </div>

                <div className="divide-y divide-slate-50">
                  {filteredProposals.length === 0 ? (
                    <div className="p-10 text-center">
                      <p className="text-slate-400 font-bold text-sm">해당 상태의 제안이 없습니다.</p>
                    </div>
                  ) : (
                    filteredProposals.map(proposal => (
                      <div key={proposal.id}>
                        {/* Desktop: 한 줄 */}
                        <div
                          className="hidden md:grid grid-cols-12 gap-2 px-4 py-2.5 items-center hover:bg-slate-50/50 transition-all cursor-pointer"
                          onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
                        >
                          <div className="col-span-2 min-w-0">
                            <p className="font-black text-slate-900 text-[12px] truncate">{proposal.company_name}</p>
                            <p className="text-[10px] font-bold text-slate-400 truncate">{proposal.contact_person}</p>
                          </div>
                          <div className="col-span-3 min-w-0">
                            <p className="font-bold text-slate-700 text-[12px] truncate">{proposal.title}</p>
                            <p className="text-[10px] font-bold text-slate-300 truncate">
                              {proposal.category} · {proposal.content?.slice(0, 40)}{(proposal.content?.length || 0) > 40 ? '...' : ''}
                            </p>
                          </div>
                          <div className="col-span-3 min-w-0">
                            <p className="font-black text-blue-600 text-[11px] truncate">@{proposal._username}</p>
                            <p className="text-[10px] font-bold text-slate-400 truncate">
                              {proposal.contact_email}{proposal.contact_phone ? ` · ${proposal.contact_phone}` : ''}
                            </p>
                          </div>
                          <div className="col-span-2">
                            <p className="font-black text-blue-600 text-[12px]">{formatFee(proposal.fee)}</p>
                            <p className="text-[9px] font-bold text-slate-300">
                              {formatDate(proposal.start_date)} ~ {formatDate(proposal.end_date)}
                            </p>
                          </div>
                          <div className="col-span-2 flex items-center gap-2">
                            {getStatusBadge(proposal.status)}
                            {getDaysLeft(proposal.end_date)}
                          </div>
                        </div>

                        {/* Mobile: 카드 */}
                        <div
                          className="md:hidden p-4 hover:bg-slate-50/50 transition-all cursor-pointer"
                          onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                {getStatusBadge(proposal.status)}
                                <span className="text-[10px] font-bold text-slate-300">@{proposal._username}</span>
                                {getDaysLeft(proposal.end_date)}
                              </div>
                              <p className="font-bold text-slate-900 text-sm truncate">{proposal.title}</p>
                              <p className="text-[10px] font-bold text-slate-400">{proposal.company_name} · {proposal.contact_person}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-black text-blue-600 text-sm">{formatFee(proposal.fee)}</p>
                            </div>
                          </div>
                        </div>

                        {/* 상세 */}
                        {expandedId === proposal.id && (
                          <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3 animate-in fade-in duration-200">
                            <p className="text-[13px] text-slate-600 font-medium whitespace-pre-wrap">{proposal.content}</p>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                              {[
                                { k: '회사명', v: proposal.company_name },
                                { k: '담당자', v: proposal.contact_person },
                                { k: '인플루언서', v: `@${proposal._username}` },
                                { k: '이메일', v: proposal.contact_email },
                                { k: '연락처', v: proposal.contact_phone || '-' },
                                { k: '카테고리', v: proposal.category },
                                { k: '접수일', v: formatDate(proposal.created_at) },
                              ].map(item => (
                                <div key={item.k} className="bg-slate-50 rounded-lg p-2.5">
                                  <p className="text-[9px] font-black text-slate-400">{item.k}</p>
                                  <p className="text-[11px] font-bold text-slate-900 truncate">{item.v}</p>
                                </div>
                              ))}
                            </div>
                            {proposal.revenue_share != null && proposal.revenue_share > 0 && (
                              <p className="text-xs font-bold text-slate-500">수익 배분: {proposal.revenue_share}%</p>
                            )}
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
                                      className="block text-xs text-blue-600 font-bold hover:underline truncate"
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
                                    };
                                    return (
                                      <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="block">
                                        {isImage ? (
                                          <img
                                            src={url}
                                            alt={`첨부 ${idx + 1}`}
                                            className="w-full h-24 object-cover rounded-lg border border-slate-200 hover:border-blue-400 transition-all"
                                          />
                                        ) : (
                                          <div className="w-full h-24 rounded-lg border border-slate-200 bg-slate-50 hover:border-blue-400 transition-all flex flex-col items-center justify-center gap-1">
                                            <span className="text-lg">
                                              {ext === 'pdf' ? '📄' : ['doc', 'docx'].includes(ext) ? '📝' : ['xls', 'xlsx'].includes(ext) ? '📊' : ['ppt', 'pptx'].includes(ext) ? '📑' : ext === 'zip' ? '📦' : '📎'}
                                            </span>
                                            <span className="text-[10px] font-black text-slate-500">{fileLabel[ext] || ext.toUpperCase()}</span>
                                          </div>
                                        )}
                                      </a>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {proposal.status === 'rejected' && proposal.rejection_reason && (
                              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                                <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">거절 사유</p>
                                <p className="text-[13px] text-red-700 font-medium">{proposal.rejection_reason}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 1. 캠페인 승인 */}
        {activeTab === 'campaigns' && (
          adminToken
            ? (
              <div className="space-y-4">
                <TabIntro
                  title="캠페인 승인 · 공개 모집형 캠페인 심사"
                  body="광고주가 등록한 공개 모집 캠페인을 노출 전에 승인/거절합니다. 한 줄에 브랜드·단가·예산·모집·기간·담당자가 모두 보이며, 설명과 지원 조건은 '상세'를 눌러 확인합니다."
                />
                <AdminCampaignApproval token={adminToken} />
              </div>
            )
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 캠페인 승인 관리가 표시됩니다." />
        )}

        {/* 2. 인플루언서 리스트업 */}
        {activeTab === 'listup' && (
          adminToken
            ? (
              <div className="space-y-4">
                <TabIntro
                  title="인플루언서 리스트업 · 후보 명단과 단가 책정"
                  body="승인된 캠페인을 골라 지원자와 등록 인플루언서 풀을 함께 검토하고, 브랜드에 제안할 후보 명단을 만듭니다. 후보마다 인플루언서 단가와 브랜드 제시가를 함께 입력하면 그 차액이 우리 수익으로 집계됩니다."
                />
                <AdminCampaignListup token={adminToken} />
              </div>
            )
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 인플루언서 리스트업이 표시됩니다." />
        )}

        {/* 3. 캠페인 관리 */}
        {activeTab === 'collabs' && (
          adminToken
            ? (
              <div className="space-y-5">
                <TabIntro
                  title="캠페인 관리 · 전체 진행과 담당자 배정"
                  body="모든 캠페인이 어느 단계에서 멈춰 있고 누가 맡고 있는지 한 표로 봅니다. 담당자를 바로 바꿀 수 있고, 아래 협업 콘솔에서는 조건 확정·제출물 검수·정산 예약을 처리합니다."
                />
                <AdminCampaignBoard token={adminToken} />
                <div className="pt-1">
                  <h3 className="text-sm font-black text-slate-900 mb-2">선정 인플루언서 협업 관리</h3>
                  <AdminCollabManagerConsole token={adminToken} />
                </div>
              </div>
            )
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 캠페인 관리가 표시됩니다." />
        )}

        {/* 인플루언서 DB */}
        {activeTab === 'influencerdb' && (
          adminToken
            ? (
              <div className="space-y-4">
                <TabIntro
                  title="인플루언서 DB · 카테고리 · 팔로워 · 인사이트"
                  body="픽스폴리오에 등록된 인플루언서를 한 표로 정리해 둡니다. 인플루언서가 브랜드 매칭 등록에서 직접 고른 분야로 추린 뒤, 팔로워 많은 순과 인사이트 좋은 순으로 나란히 볼 수 있습니다. 인사이트는 조회율·반응률·최근 릴스 동향을 합친 점수로, 팔로워 규모와 무관하게 콘텐츠 성과만 봅니다."
                />
                <AdminInfluencerDatabase token={adminToken} />
              </div>
            )
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 인플루언서 DB가 표시됩니다." />
        )}

        {/* 브랜드 매칭 지원자 */}
        {activeTab === 'directory' && (
          adminToken
            ? (
              <div className="space-y-4">
                <TabIntro
                  title="브랜드 매칭 지원자 · 인플루언서 채널 검토"
                  body="브랜드 매칭 받기에 지원한 인플루언서를 지원자가 직접 고른 분야별로, 그리고 팔로워 구간별로 확인합니다. 팔로워 많은 순과 인사이트(조회율·반응률·릴스 동향) 좋은 순으로 정렬을 바꿔 볼 수 있고, 연결된 Instagram Meta 계정에서 팔로워·팔로잉과 최근 릴스 성과를 갱신해 검토할 수 있습니다."
                />
                <AdminCollabDirectory token={adminToken} />
              </div>
            )
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 지원자 목록이 표시됩니다." />
        )}

        {/* 회원 관리 */}
        {activeTab === 'users' && (
          adminToken
            ? <AdminInfluencersPanel token={adminToken} />
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 인플루언서 데이터가 표시됩니다." />
        )}

        {/* 담당자 계정 */}
        {activeTab === 'managers' && (
          adminToken
            ? <AdminManagerAccounts token={adminToken} />
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 담당자 목록이 표시됩니다." />
        )}

        {/* 정산·매출 */}
        {activeTab === 'settlement' && (
          adminToken
            ? (
              <div className="space-y-4">
                <TabIntro
                  title="정산·매출 · 세 수익원의 순수익"
                  body="멤버십 구독료, 캠페인 마진(브랜드 제시가 − 인플루언서 단가), AI 사용 순수익을 나눠 봅니다. 아래 정산 콘솔에서 인플루언서 지급 예약과 완료 처리를 합니다."
                />
                <AdminRevenueCards token={adminToken} settlementSummary={settlementSummary} overview={overview} />
                <AdminSettlementConsole token={adminToken} />
              </div>
            )
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 정산 데이터가 표시됩니다." />
        )}
      </div>

      {/* Click outside to close notifications */}
      {showNotifications && (
        <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
      )}
    </div>
  );
};

const EmptyTabState: React.FC<{ message: string; subMessage?: string }> = ({ message, subMessage }) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
    <p className="text-slate-400 font-bold text-sm">{message}</p>
    {subMessage && <p className="text-slate-300 font-bold text-xs mt-1">{subMessage}</p>}
  </div>
);

// 탭 상단 설명. 겹쳐 보이는 화면(캠페인 승인 vs 리스트업 vs 캠페인 관리)이
// 각각 무엇을 하는 곳인지 한 문장으로 구분해 준다.
const TabIntro: React.FC<{ title: string; body: string; tone?: 'blue' | 'amber' }> = ({ title, body, tone = 'blue' }) => {
  const palette = tone === 'amber'
    ? 'bg-amber-50/70 border-amber-100'
    : 'bg-blue-50/60 border-blue-100';
  return (
    <div className={`${palette} border rounded-2xl px-4 py-3`}>
      <p className="text-xs font-black text-slate-800">{title}</p>
      <p className="text-[11px] font-bold text-slate-500 leading-relaxed mt-0.5">{body}</p>
    </div>
  );
};

export default OperatorDashboard;
