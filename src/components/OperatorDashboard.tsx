import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { logout, getUser } from '@netlify/identity';
import type { BusinessProposal } from '../types';
import { apiService } from '../services/apiService';
import AdminInfluencersPanel from './admin/AdminInfluencersPanel';
import AdminSettlementConsole from './admin/AdminSettlementConsole';
import AdminLiveConsole from './admin/AdminLiveConsole';
import AdminWorkflowConsole from './admin/AdminWorkflowConsole';
import AdminGrowthCards from './admin/AdminGrowthCards';
import AdminCampaignApproval from './admin/AdminCampaignApproval';

type OperatorTab = 'overview' | 'influencer' | 'calendar' | 'users' | 'settlement' | 'live' | 'workflow' | 'campaigns';
type StatusFilter = 'all' | 'pending' | 'accepted' | 'rejected' | 'completed';

interface AdminStats {
  totalInfluencers: number;
  totalProposals: number;
  pending: number;
  accepted: number;
  completed: number;
  rejected: number;
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
  const [influencers, setInfluencers] = useState<string[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<OperatorTab>('overview');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedInfluencer, setSelectedInfluencer] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
    return (user as any)?.token?.access_token || '';
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const user = await getUser();
      if (!user) {
        setError('인증이 만료되었습니다. 다시 로그인해주세요.');
        setLoading(false);
        return;
      }
      const token = (user as any).token?.access_token || '';
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
      setInfluencers(data.influencers || []);
      setStats(data.stats || null);

      // Mark admin as authenticated so sub-panels render. Use the bearer token
      // when available, otherwise a sentinel so the truthy gate passes — the
      // sub-panels authenticate via the `nf_jwt` cookie either way.
      setAdminToken(token || 'cookie');

      // Fetch notifications (server reads cookie when token is empty).
      const notifData = await apiService.getAdminNotifications(token);
      setNotifications(notifData.notifications || []);
      setUnreadCount(notifData.unreadCount || 0);
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
    onLogout();
  };

  const handleMarkAllRead = async () => {
    const token = await getToken();
    await apiService.markNotificationsRead(token, undefined, true);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  // Filter proposals by status + influencer
  const filteredProposals = useMemo(() => {
    let filtered = proposals;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(p => p.status === statusFilter);
    }
    if (selectedInfluencer) {
      filtered = filtered.filter(p => p._username === selectedInfluencer);
    }
    return filtered;
  }, [proposals, statusFilter, selectedInfluencer]);

  // Calendar helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split('T')[0];

  const getDateStr = (day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const calendarProposals = useMemo(
    () => proposals.filter(p => p.status === 'accepted' || p.status === 'completed'),
    [proposals]
  );

  const eventsMap = useMemo(() => {
    const map: Record<string, (BusinessProposal & { _username: string })[]> = {};
    calendarProposals.forEach(p => {
      if (!p.start_date || !p.end_date) return;
      const start = new Date(p.start_date);
      const end = new Date(p.end_date);
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = cursor.toISOString().split('T')[0];
        if (!map[key]) map[key] = [];
        map[key].push(p);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [calendarProposals]);

  const selectedEvents = selectedDate ? (eventsMap[selectedDate] || []) : [];

  // Per-influencer stats
  const influencerStats = useMemo(() => {
    const map: Record<string, { total: number; pending: number; accepted: number; completed: number; totalFee: number }> = {};
    proposals.forEach(p => {
      const u = p._username;
      if (!map[u]) map[u] = { total: 0, pending: 0, accepted: 0, completed: 0, totalFee: 0 };
      map[u].total++;
      if (p.status === 'pending') map[u].pending++;
      if (p.status === 'accepted') map[u].accepted++;
      if (p.status === 'completed') map[u].completed++;
      map[u].totalFee += p.fee || 0;
    });
    return map;
  }, [proposals]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatFee = (fee: number) => {
    return `${fee.toLocaleString()}원`;
  };

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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted': return 'bg-green-500';
      case 'completed': return 'bg-blue-500';
      default: return 'bg-purple-500';
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

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

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
                      <button onClick={handleMarkAllRead} className="text-[10px] font-bold text-purple-600 hover:underline">
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
                        <div key={notif.id} className={`p-3 ${!notif.read ? 'bg-purple-50/50' : ''}`}>
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
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { key: 'overview' as OperatorTab, label: '전체 현황' },
            { key: 'campaigns' as OperatorTab, label: '캠페인 승인' },
            { key: 'users' as OperatorTab, label: '회원 관리' },
            { key: 'settlement' as OperatorTab, label: '정산·매출' },
            { key: 'live' as OperatorTab, label: '라이브 운영' },
            { key: 'workflow' as OperatorTab, label: '제안 워크플로' },
            { key: 'influencer' as OperatorTab, label: '인플루언서별' },
            { key: 'calendar' as OperatorTab, label: '일정 캘린더' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setSelectedInfluencer(null); setSelectedDate(null); setStatusFilter('all'); }}
              className={`px-4 py-2.5 rounded-xl font-black text-sm transition-all ${
                activeTab === tab.key
                  ? 'bg-slate-900 text-white shadow-lg'
                  : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && !stats && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
            <p className="text-slate-400 font-bold text-sm">아직 데이터가 없습니다.</p>
            <p className="text-slate-300 font-bold text-xs mt-1">제안이 접수되면 여기에 현황이 표시됩니다.</p>
          </div>
        )}
        {activeTab === 'overview' && stats && (
          <div className="space-y-6">
            {/* Growth metrics */}
            {adminToken && <AdminGrowthCards token={adminToken} />}
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">인플루언서</p>
                <p className="text-2xl font-black text-slate-900">{stats.totalInfluencers}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">전체 제안</p>
                <p className="text-2xl font-black text-slate-900">{stats.totalProposals}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">대기중</p>
                <p className="text-2xl font-black text-amber-600">{stats.pending}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">수락됨</p>
                <p className="text-2xl font-black text-green-600">{stats.accepted}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">완료</p>
                <p className="text-2xl font-black text-blue-600">{stats.completed}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">거절됨</p>
                <p className="text-2xl font-black text-red-500">{stats.rejected}</p>
              </div>
            </div>

            {/* Status Filter Tabs */}
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { key: 'all' as StatusFilter, label: '전체', count: stats.totalProposals },
                { key: 'pending' as StatusFilter, label: '대기중', count: stats.pending, color: 'amber' },
                { key: 'accepted' as StatusFilter, label: '수락됨', count: stats.accepted, color: 'green' },
                { key: 'rejected' as StatusFilter, label: '거절됨', count: stats.rejected, color: 'red' },
                { key: 'completed' as StatusFilter, label: '완료', count: stats.completed, color: 'blue' },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  className={`px-3 py-2 rounded-xl font-black text-xs transition-all flex items-center gap-1.5 ${
                    statusFilter === f.key
                      ? 'bg-slate-900 text-white shadow-lg'
                      : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {f.label}
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                    statusFilter === f.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {f.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Enhanced Proposal List - One-Line Format */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-black text-slate-900">
                  {statusFilter === 'all' ? '전체 제안 목록' : `${statusFilter === 'pending' ? '대기중' : statusFilter === 'accepted' ? '수락됨' : statusFilter === 'rejected' ? '거절됨' : '완료'} 제안`}
                </h3>
                <span className="text-xs font-bold text-slate-400">{filteredProposals.length}건</span>
              </div>

              {/* Table Header */}
              <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">광고주</div>
                <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">제안 내용</div>
                <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">대상 인플루언서</div>
                <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">금액 / 기간</div>
                <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">상태</div>
              </div>

              <div className="divide-y divide-slate-50">
                {filteredProposals.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-slate-400 font-bold">해당 상태의 제안이 없습니다.</p>
                  </div>
                ) : (
                  filteredProposals.map(proposal => (
                    <div key={proposal.id}>
                      {/* Desktop: One-line row */}
                      <div
                        className="hidden md:grid grid-cols-12 gap-2 px-5 py-3.5 items-center hover:bg-slate-50/50 transition-all cursor-pointer"
                        onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
                      >
                        {/* Advertiser */}
                        <div className="col-span-2 min-w-0">
                          <p className="font-black text-slate-900 text-sm truncate">{proposal.company_name}</p>
                          <p className="text-[10px] font-bold text-slate-400 truncate">{proposal.contact_person}</p>
                        </div>
                        {/* Proposal Content */}
                        <div className="col-span-3 min-w-0">
                          <p className="font-bold text-slate-700 text-sm truncate">{proposal.title}</p>
                          <p className="text-[10px] font-bold text-slate-300 truncate">{proposal.category} · {proposal.content?.slice(0, 40)}{(proposal.content?.length || 0) > 40 ? '...' : ''}</p>
                        </div>
                        {/* Target Influencer */}
                        <div className="col-span-3 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center shrink-0">
                              <span className="text-[10px] font-black text-white">{proposal._username.slice(0, 1).toUpperCase()}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="font-black text-purple-600 text-xs truncate">@{proposal._username}</p>
                              <p className="text-[10px] font-bold text-slate-400 truncate">
                                {proposal.contact_email}{proposal.contact_phone ? ` · ${proposal.contact_phone}` : ''}
                              </p>
                            </div>
                          </div>
                        </div>
                        {/* Fee / Period */}
                        <div className="col-span-2">
                          <p className="font-black text-purple-600 text-sm">{formatFee(proposal.fee)}</p>
                          <p className="text-[9px] font-bold text-slate-300">
                            {formatDate(proposal.start_date)} ~ {formatDate(proposal.end_date)}
                          </p>
                        </div>
                        {/* Status */}
                        <div className="col-span-2 flex items-center gap-2">
                          {getStatusBadge(proposal.status)}
                          {getDaysLeft(proposal.end_date)}
                        </div>
                      </div>

                      {/* Mobile: Card layout */}
                      <div
                        className="md:hidden p-4 hover:bg-slate-50/50 transition-all cursor-pointer"
                        onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center shrink-0">
                            <span className="text-xs font-black text-purple-600">
                              {proposal._username.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
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
                            <p className="font-black text-purple-600 text-sm">{formatFee(proposal.fee)}</p>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Detail */}
                      {expandedId === proposal.id && (
                        <div className="px-5 pb-4 border-t border-slate-100 pt-4 space-y-3 animate-in fade-in duration-200">
                          <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap">{proposal.content}</p>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <div className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[9px] font-black text-slate-400">회사명</p>
                              <p className="text-xs font-bold text-slate-900">{proposal.company_name}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[9px] font-black text-slate-400">담당자</p>
                              <p className="text-xs font-bold text-slate-900">{proposal.contact_person}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[9px] font-black text-slate-400">인플루언서</p>
                              <p className="text-xs font-bold text-purple-600">@{proposal._username}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[9px] font-black text-slate-400">이메일</p>
                              <p className="text-xs font-bold text-slate-900 truncate">{proposal.contact_email}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[9px] font-black text-slate-400">연락처</p>
                              <p className="text-xs font-bold text-slate-900">{proposal.contact_phone || '-'}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[9px] font-black text-slate-400">카테고리</p>
                              <p className="text-xs font-bold text-slate-900">{proposal.category}</p>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2.5">
                              <p className="text-[9px] font-black text-slate-400">접수일</p>
                              <p className="text-xs font-bold text-slate-900">{formatDate(proposal.created_at)}</p>
                            </div>
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
                                  };
                                  return (
                                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="block">
                                      {isImage ? (
                                        <img
                                          src={url}
                                          alt={`첨부 ${idx + 1}`}
                                          className="w-full h-24 object-cover rounded-lg border border-slate-200 hover:border-purple-400 transition-all"
                                        />
                                      ) : (
                                        <div className="w-full h-24 rounded-lg border border-slate-200 bg-slate-50 hover:border-purple-400 transition-all flex flex-col items-center justify-center gap-1">
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
                              <p className="text-sm text-red-700 font-medium">{proposal.rejection_reason}</p>
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
        )}

        {/* Influencer Management Tab */}
        {activeTab === 'users' && (
          adminToken
            ? <AdminInfluencersPanel token={adminToken} />
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 인플루언서 데이터가 표시됩니다." />
        )}

        {/* Settlement Console Tab */}
        {activeTab === 'settlement' && (
          adminToken
            ? <AdminSettlementConsole token={adminToken} />
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 정산 데이터가 표시됩니다." />
        )}

        {/* Live Commerce Console Tab */}
        {activeTab === 'live' && (
          adminToken
            ? <AdminLiveConsole token={adminToken} />
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 라이브 데이터가 표시됩니다." />
        )}

        {/* Workflow Console Tab */}
        {activeTab === 'workflow' && (
          adminToken
            ? <AdminWorkflowConsole token={adminToken} proposals={proposals} />
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 워크플로 분석이 표시됩니다." />
        )}

        {/* Campaign Approval Tab */}
        {activeTab === 'campaigns' && (
          adminToken
            ? <AdminCampaignApproval token={adminToken} />
            : <EmptyTabState message="아직 데이터가 없습니다." subMessage="관리자 인증이 완료되면 캠페인 승인 관리가 표시됩니다." />
        )}

        {/* Influencer Tab */}
        {activeTab === 'influencer' && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Influencer List */}
            <div className="lg:w-80 shrink-0">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="font-black text-slate-900 text-sm">인플루언서 목록 ({influencers.length})</h3>
                </div>
                <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
                  {influencers.map(username => {
                    const s = influencerStats[username];
                    const isActive = selectedInfluencer === username;
                    return (
                      <button
                        key={username}
                        onClick={() => setSelectedInfluencer(isActive ? null : username)}
                        className={`w-full p-4 text-left hover:bg-slate-50 transition-all ${isActive ? 'bg-purple-50 border-l-4 border-purple-500' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                            <span className="text-sm font-black text-white">{username.slice(0, 1).toUpperCase()}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-slate-900 text-sm">@{username}</p>
                            <div className="flex gap-2 mt-1">
                              <span className="text-[9px] font-bold text-slate-400">제안 {s?.total || 0}</span>
                              {(s?.pending || 0) > 0 && (
                                <span className="text-[9px] font-black text-amber-600">대기 {s.pending}</span>
                              )}
                              {(s?.accepted || 0) > 0 && (
                                <span className="text-[9px] font-black text-green-600">진행 {s.accepted}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-black text-purple-600">{formatFee(s?.totalFee || 0)}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {influencers.length === 0 && (
                    <div className="p-8 text-center">
                      <p className="text-slate-400 text-sm font-bold">등록된 인플루언서가 없습니다.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Proposals for Selected Influencer */}
            <div className="flex-1">
              {selectedInfluencer ? (
                <div className="space-y-4">
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                    <h3 className="font-black text-slate-900 text-lg mb-1">@{selectedInfluencer}</h3>
                    <div className="grid grid-cols-4 gap-3 mt-4">
                      <div className="bg-slate-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-black text-slate-900">{influencerStats[selectedInfluencer]?.total || 0}</p>
                        <p className="text-[9px] font-bold text-slate-400">전체</p>
                      </div>
                      <div className="bg-amber-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-black text-amber-600">{influencerStats[selectedInfluencer]?.pending || 0}</p>
                        <p className="text-[9px] font-bold text-amber-500">대기</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-black text-green-600">{influencerStats[selectedInfluencer]?.accepted || 0}</p>
                        <p className="text-[9px] font-bold text-green-500">진행</p>
                      </div>
                      <div className="bg-blue-50 rounded-xl p-3 text-center">
                        <p className="text-lg font-black text-blue-600">{influencerStats[selectedInfluencer]?.completed || 0}</p>
                        <p className="text-[9px] font-bold text-blue-500">완료</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {filteredProposals.map(proposal => (
                      <div key={proposal.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm">
                        <div
                          className="p-4 flex items-center gap-3 cursor-pointer"
                          onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              {getStatusBadge(proposal.status)}
                              <span className="text-[10px] font-bold text-slate-300">{proposal.category}</span>
                              {getDaysLeft(proposal.end_date)}
                            </div>
                            <p className="font-black text-slate-900 text-sm truncate">{proposal.title}</p>
                            <p className="text-[10px] font-bold text-slate-400">{proposal.company_name} · {proposal.contact_person}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-black text-purple-600 text-sm">{formatFee(proposal.fee)}</p>
                            <p className="text-[9px] font-bold text-slate-300">
                              {formatDate(proposal.start_date)} ~ {formatDate(proposal.end_date)}
                            </p>
                          </div>
                        </div>
                        {expandedId === proposal.id && (
                          <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3 animate-in fade-in duration-200">
                            <p className="text-sm text-slate-600 font-medium whitespace-pre-wrap">{proposal.content}</p>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                              <div className="bg-slate-50 rounded-lg p-2.5">
                                <p className="text-[9px] font-black text-slate-400">회사명</p>
                                <p className="text-xs font-bold text-slate-900">{proposal.company_name}</p>
                              </div>
                              <div className="bg-slate-50 rounded-lg p-2.5">
                                <p className="text-[9px] font-black text-slate-400">담당자</p>
                                <p className="text-xs font-bold text-slate-900">{proposal.contact_person}</p>
                              </div>
                              <div className="bg-slate-50 rounded-lg p-2.5">
                                <p className="text-[9px] font-black text-slate-400">이메일</p>
                                <p className="text-xs font-bold text-slate-900 truncate">{proposal.contact_email}</p>
                              </div>
                              <div className="bg-slate-50 rounded-lg p-2.5">
                                <p className="text-[9px] font-black text-slate-400">연락처</p>
                                <p className="text-xs font-bold text-slate-900">{proposal.contact_phone || '-'}</p>
                              </div>
                              <div className="bg-slate-50 rounded-lg p-2.5">
                                <p className="text-[9px] font-black text-slate-400">접수일</p>
                                <p className="text-xs font-bold text-slate-900">{formatDate(proposal.created_at)}</p>
                              </div>
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
                                    };
                                    return (
                                      <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="block">
                                        {isImage ? (
                                          <img
                                            src={url}
                                            alt={`첨부 ${idx + 1}`}
                                            className="w-full h-24 object-cover rounded-lg border border-slate-200 hover:border-purple-400 transition-all"
                                          />
                                        ) : (
                                          <div className="w-full h-24 rounded-lg border border-slate-200 bg-slate-50 hover:border-purple-400 transition-all flex flex-col items-center justify-center gap-1">
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
                                <p className="text-sm text-red-700 font-medium">{proposal.rejection_reason}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <h4 className="font-black text-slate-900 text-lg mb-1">인플루언서를 선택해주세요</h4>
                  <p className="text-slate-400 text-sm font-bold">왼쪽 목록에서 인플루언서를 선택하면 상세 정보를 확인할 수 있습니다.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <div className="flex flex-col xl:flex-row gap-6">
            <div className="flex-1">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-5 md:p-8 border-b border-slate-100">
                  <button
                    onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
                    className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all"
                  >
                    <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h3 className="text-xl md:text-2xl font-black text-slate-900">{year}년 {month + 1}월</h3>
                  <button
                    onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
                    className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center hover:bg-slate-100 transition-all"
                  >
                    <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-7">
                  {weekDays.map(day => (
                    <div key={day} className="p-2.5 text-center text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {Array.from({ length: firstDay }).map((_, i) => (
                    <div key={`e-${i}`} className="p-2 md:p-3 min-h-[100px] md:min-h-[130px] border-b border-r border-slate-50" />
                  ))}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dateStr = getDateStr(day);
                    const events = eventsMap[dateStr] || [];
                    const isToday = dateStr === today;
                    const isSelected = dateStr === selectedDate;
                    const dayOfWeek = (firstDay + i) % 7;

                    return (
                      <div
                        key={day}
                        onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                        className={`p-2 md:p-3 min-h-[100px] md:min-h-[130px] border-b border-r border-slate-50 cursor-pointer transition-all hover:bg-purple-50/50 ${
                          isSelected ? 'bg-purple-50 ring-2 ring-inset ring-purple-300' : ''
                        }`}
                      >
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-black ${
                          isToday ? 'bg-slate-900 text-white'
                          : dayOfWeek === 0 ? 'text-red-400'
                          : dayOfWeek === 6 ? 'text-blue-400'
                          : 'text-slate-700'
                        }`}>
                          {day}
                        </span>
                        <div className="mt-1 space-y-0.5">
                          {events.slice(0, 2).map(ev => (
                            <div
                              key={ev.id}
                              className={`${getStatusColor(ev.status)} text-white text-[10px] font-bold px-1 py-0.5 rounded truncate leading-tight`}
                            >
                              <span className="opacity-70">@{ev._username}</span> {ev.title}
                            </div>
                          ))}
                          {events.length > 2 && (
                            <p className="text-[10px] font-bold text-slate-400 px-1">+{events.length - 2}건</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedDate && (
                <div className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 animate-in fade-in slide-in-from-top-2 duration-300">
                  <h4 className="font-black text-slate-900 mb-4">{formatDate(selectedDate)} 일정</h4>
                  {selectedEvents.length === 0 ? (
                    <p className="text-slate-400 text-sm font-bold">이 날짜에 예정된 일정이 없습니다.</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedEvents.map(ev => (
                        <div key={ev.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
                          <div className={`w-2 h-12 rounded-full shrink-0 ${getStatusColor(ev.status)}`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-slate-900 text-sm truncate">{ev.title}</p>
                            <p className="text-xs font-bold text-slate-400">@{ev._username} · {ev.company_name} · {formatFee(ev.fee)}</p>
                          </div>
                          <span className={`text-xs font-black ${ev.status === 'completed' ? 'text-blue-500' : 'text-green-500'}`}>
                            {ev.status === 'completed' ? '완료' : '진행중'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Calendar Sidebar */}
            <div className="xl:w-80 shrink-0 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">전체 일정 현황</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-green-600">{calendarProposals.filter(p => p.status === 'accepted').length}</p>
                    <p className="text-[10px] font-bold text-green-500">진행중</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-black text-blue-600">{calendarProposals.filter(p => p.status === 'completed').length}</p>
                    <p className="text-[10px] font-bold text-blue-500">완료</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">다가오는 마감</h4>
                <div className="space-y-3">
                  {(() => {
                    const upcoming = calendarProposals
                      .filter(p => p.status === 'accepted' && new Date(p.end_date) >= new Date())
                      .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())
                      .slice(0, 8);
                    if (upcoming.length === 0) {
                      return <p className="text-slate-400 text-xs font-bold text-center py-2">아직 데이터가 없습니다.</p>;
                    }
                    return upcoming.map(p => {
                      const diff = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      const isUrgent = diff <= 3;
                      return (
                        <div key={p.id} className={`p-3 rounded-xl border ${isUrgent ? 'border-red-200 bg-red-50/50' : 'border-slate-100 bg-slate-50'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-black ${isUrgent ? 'text-red-500' : 'text-slate-400'}`}>
                              {diff < 0 ? '마감됨' : diff === 0 ? 'D-Day' : `D-${diff}`}
                            </span>
                            <span className="text-[10px] font-bold text-slate-300">@{p._username}</span>
                          </div>
                          <p className="font-black text-slate-900 text-sm truncate">{p.title}</p>
                          <p className="text-xs font-bold text-slate-400 mt-0.5">{p.company_name}</p>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">범례</h4>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-sm font-bold text-slate-600">진행중 (수락됨)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-sm font-bold text-slate-600">완료됨</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
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

export default OperatorDashboard;
