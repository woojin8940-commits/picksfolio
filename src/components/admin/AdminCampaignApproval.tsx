import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon, formatKRW } from '../../utils/formatters';

/**
 * 캠페인 승인 — 한 캠페인이 한 줄이다.
 *
 * 이전에는 정사각형 썸네일 카드를 눌러 아래로 정보를 펼치는 구조였다. 승인 대기가
 * 몇 건일 때는 괜찮지만, 심사할 캠페인이 쌓이면 한 화면에 두세 개밖에 들어오지
 * 않는다. 게다가 펼치는 순간 아래 카드들이 밀려서 방금 보던 위치를 잃는다.
 * 심사는 "여러 건을 훑고 대부분 바로 승인, 몇 건만 자세히 본다"는 일이라 목록이
 * 조밀해야 한다.
 *
 * 그래서 판단에 필요한 값(브랜드·유형·단가·예산·모집·기간·담당자·상태)을 모두 줄
 * 안에 넣고, 승인/거절 버튼도 같은 줄에 둔다. 설명·지원조건처럼 길이가 들쭉날쭉한
 * 값만 오버레이로 뺐다 — 이건 줄을 밀지 않으므로 목록의 위치가 유지된다.
 */

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
  budget_krw?: number;
  seeding_count?: number;
  package_tier?: string;
  start_date: string;
  end_date: string;
  status: string;
  application_count: number;
  admin_rejected_reason?: string;
  admin_approved_at?: string;
  manager_username?: string;
  manager_assigned_at?: string;
  created_at: string;
  listed_count?: number;
  accepted_count?: number;
}

interface AdminCampaignApprovalProps {
  token: string;
}

type FilterStatus = 'pending_approval' | 'all' | 'active' | 'admin_rejected' | 'inactive';

const typeLabel = (t: string) => {
  const map: Record<string, string> = { ad_collab: '광고 협업', group_buy: '공동구매', other: '기타', collaboration: '협업', advertisement: '광고', review: '리뷰', event: '이벤트' };
  return map[t] || t || '-';
};

const categoryLabel = (c: string) => {
  const map: Record<string, string> = { beauty: '뷰티', fashion: '패션', food: '식품', travel: '여행', lifestyle: '라이프스타일', health: '건강', tech: 'IT/테크', parenting: '육아', pet: '반려동물', interior: '인테리어', sports: '스포츠', entertainment: '엔터테인먼트', education: '교육', other: '기타' };
  return map[c] || c || '';
};

const rewardLabel = (t: string) => {
  const map: Record<string, string> = { fixed: '고정 금액', product: '제품 제공', revenue_share: '수익 배분', mixed: '복합' };
  return map[t] || t || '-';
};

/**
 * reward_amount 는 TEXT 라서 "1000000" 도 오고 "제품 제공(3만원 상당)" 도 온다.
 * 숫자가 없는 값을 금액 포매터에 넣으면 "0원"이 되어 정보가 사라지므로,
 * 숫자가 섞여 있을 때만 금액으로 읽고 아니면 원문을 그대로 보여준다.
 */
const rewardValue = (raw: string) => {
  const text = String(raw || '').trim();
  if (!text) return '단가 미정';
  return /^[0-9,\s원]+$/.test(text) ? formatKoreanWon(text) : text;
};

const STATUS: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-green-100 text-green-700', label: '승인·모집중' },
  inactive: { cls: 'bg-slate-100 text-slate-500', label: '마감' },
  pending_approval: { cls: 'bg-orange-100 text-orange-700', label: '승인 대기' },
  admin_rejected: { cls: 'bg-red-100 text-red-700', label: '거절' },
};

const formatDate = (d: string) => {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
};

const daysRemaining = (endDate: string) => {
  if (!endDate) return null;
  const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (Number.isNaN(diff)) return null;
  if (diff < 0) return '마감';
  if (diff === 0) return 'D-Day';
  return `D-${diff}`;
};

const AdminCampaignApproval: React.FC<AdminCampaignApprovalProps> = ({ token }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending_approval');
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
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
    if (!confirm('이 캠페인을 승인하시겠습니까? 승인하면 담당자가 배정되고 모집이 시작됩니다.')) return;
    setProcessing(id);
    const result = await apiService.adminCampaignAction(token, id, 'approve');
    if (result.success) fetchCampaigns();
    else alert(result.error || '승인 실패');
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

  const handleAssignManager = async (id: string) => {
    if (!confirm('이 캠페인을 내 담당으로 배정하시겠습니까? 진행 중인 협업 담당자도 함께 변경됩니다.')) return;
    setProcessing(id);
    const result = await apiService.adminCampaignAction(token, id, 'assign_manager');
    if (result.success) await fetchCampaigns();
    else alert(result.error || '담당자 배정 실패');
    setProcessing(null);
  };

  const pendingCount = campaigns.filter(c => c.status === 'pending_approval').length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter(c =>
      [c.title, c.brand_name, c.business_username, c.category, c.manager_username]
        .some(v => String(v || '').toLowerCase().includes(q)),
    );
  }, [campaigns, query]);

  const detail = detailId ? campaigns.find(c => c.id === detailId) || null : null;

  const filters: { key: FilterStatus; label: string }[] = [
    { key: 'pending_approval', label: '승인 대기' },
    { key: 'all', label: '전체' },
    { key: 'active', label: '승인됨' },
    { key: 'admin_rejected', label: '거절됨' },
    { key: 'inactive', label: '마감' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilterStatus(f.key)}
              className={`px-3 py-1.5 rounded-lg font-black text-[11px] transition-all flex items-center gap-1.5 ${
                filterStatus === f.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {f.label}
              {f.key === 'pending_approval' && filterStatus !== 'pending_approval' && pendingCount > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-500 text-white">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="캠페인 · 브랜드 · 담당자 검색"
            className="text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 w-52 focus:outline-none focus:border-blue-400"
          />
          <span className="text-[11px] font-bold text-slate-400">{visible.length}건</span>
          <button
            onClick={fetchCampaigns}
            className="px-2.5 py-1.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-500 hover:bg-slate-200"
          >
            새로고침
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-7 h-7 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-400 font-bold">캠페인 불러오는 중...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-400 font-bold">해당 상태의 캠페인이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {/* 열 제목. 숫자 열은 오른쪽 정렬해 자릿수를 눈으로 비교할 수 있게 둔다. */}
          <div className="hidden lg:grid grid-cols-[minmax(0,3fr)_86px_minmax(0,1.3fr)_74px_92px_minmax(0,1fr)_84px_150px] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
            {['캠페인 / 브랜드', '유형', '단가 · 예산', '모집', '기간', '담당자', '상태', ''].map((h, i) => (
              <div key={i} className={`text-[9px] font-black text-slate-400 uppercase tracking-widest ${i === 3 || i === 2 ? 'text-right' : ''}`}>
                {h}
              </div>
            ))}
          </div>

          <div className="divide-y divide-slate-50">
            {visible.map(c => {
              const days = daysRemaining(c.end_date);
              const status = STATUS[c.status] || { cls: 'bg-slate-100 text-slate-500', label: c.status };
              const busy = processing === c.id;
              const rejecting = rejectingId === c.id;
              return (
                <div key={c.id} className="lg:grid lg:grid-cols-[minmax(0,3fr)_86px_minmax(0,1.3fr)_74px_92px_minmax(0,1fr)_84px_150px] gap-2 px-3 py-2 items-center hover:bg-slate-50/60">
                  {/* 캠페인 + 브랜드 */}
                  <div className="flex items-center gap-2 min-w-0">
                    {c.thumbnail_url ? (
                      <img src={c.thumbnail_url} alt="" loading="lazy" className="w-9 h-9 rounded-lg object-cover bg-slate-100 shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-slate-100 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <button
                        onClick={() => setDetailId(c.id)}
                        className="block max-w-full text-left text-[12px] font-black text-slate-900 truncate hover:text-blue-600"
                        title={c.title}
                      >
                        {c.title}
                      </button>
                      <p className="text-[10px] font-bold text-slate-400 truncate">
                        {c.brand_name ? `${c.brand_name} · ` : ''}@{c.business_username}
                        {c.category ? ` · ${categoryLabel(c.category)}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* 유형 */}
                  <div className="hidden lg:block">
                    <p className="text-[10px] font-black text-slate-600 truncate">{typeLabel(c.type)}</p>
                    <p className="text-[9px] font-bold text-slate-300 truncate">{rewardLabel(c.reward_type)}</p>
                  </div>

                  {/* 단가 · 예산 */}
                  <div className="hidden lg:block text-right">
                    <p className="text-[11px] font-black text-blue-600 truncate">
                      {rewardValue(c.reward_amount)}
                    </p>
                    <p className="text-[9px] font-bold text-slate-400 truncate">
                      {c.budget_krw ? `예산 ${formatKRW(c.budget_krw)}` : c.seeding_count ? `시딩 ${c.seeding_count}건` : '예산 미정'}
                    </p>
                  </div>

                  {/* 모집 / 지원 */}
                  <div className="hidden lg:block text-right">
                    <p className="text-[11px] font-black text-slate-700">
                      {c.application_count}
                      <span className="text-slate-300">/{c.max_applicants > 0 ? c.max_applicants : '∞'}</span>
                    </p>
                    <p className="text-[9px] font-bold text-slate-300">지원/모집</p>
                  </div>

                  {/* 기간 */}
                  <div className="hidden lg:block">
                    <p className="text-[10px] font-bold text-slate-600 whitespace-nowrap">
                      {formatDate(c.start_date)}~{formatDate(c.end_date)}
                    </p>
                    {days && (
                      <p className={`text-[9px] font-black ${days === '마감' ? 'text-slate-300' : 'text-rose-500'}`}>{days}</p>
                    )}
                  </div>

                  {/* 담당자 */}
                  <div className="hidden lg:block min-w-0">
                    {c.manager_username ? (
                      <p className="text-[10px] font-black text-slate-700 truncate">@{c.manager_username}</p>
                    ) : (
                      <button
                        onClick={() => handleAssignManager(c.id)}
                        disabled={busy}
                        className="text-[10px] font-black text-amber-600 hover:underline disabled:opacity-50"
                      >
                        미배정 · 배정
                      </button>
                    )}
                  </div>

                  {/* 상태 */}
                  <div className="hidden lg:block">
                    <span className={`${status.cls} px-1.5 py-0.5 rounded text-[9px] font-black whitespace-nowrap`}>
                      {status.label}
                    </span>
                  </div>

                  {/* 액션 */}
                  <div className="flex items-center justify-end gap-1 mt-1.5 lg:mt-0">
                    {/* 모바일에서는 열이 접히므로 핵심 값을 액션 옆에 함께 적는다. */}
                    <div className="lg:hidden flex-1 min-w-0">
                      <p className="text-[10px] font-black text-blue-600 truncate">
                        {rewardValue(c.reward_amount)} · 지원 {c.application_count}
                      </p>
                      <p className="text-[9px] font-bold text-slate-400 truncate">
                        {status.label} · {c.manager_username ? `@${c.manager_username}` : '담당 미배정'}
                      </p>
                    </div>
                    {c.status === 'pending_approval' ? (
                      <>
                        <button
                          onClick={() => handleApprove(c.id)}
                          disabled={busy}
                          className="px-2.5 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-[10px] font-black disabled:opacity-50"
                        >
                          {busy ? '처리중' : '승인'}
                        </button>
                        <button
                          onClick={() => { setRejectingId(rejecting ? null : c.id); setRejectReason(''); }}
                          disabled={busy}
                          className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[10px] font-black disabled:opacity-50"
                        >
                          거절
                        </button>
                      </>
                    ) : (
                      <span className="text-[9px] font-bold text-slate-300 whitespace-nowrap">
                        {c.listed_count ? `명단 ${c.listed_count}` : ''}
                        {c.accepted_count ? ` · 수락 ${c.accepted_count}` : ''}
                      </span>
                    )}
                    <button
                      onClick={() => setDetailId(c.id)}
                      className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-black"
                    >
                      상세
                    </button>
                  </div>

                  {/* 거절 사유. 목록의 줄 높이를 유지하려고 전체 폭 한 줄만 쓴다. */}
                  {rejecting && (
                    <div className="lg:col-span-8 mt-2 flex items-center gap-2 rounded-lg bg-red-50 border border-red-100 px-2.5 py-2">
                      <input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="거절 사유 (비즈니스에게 전달됩니다)"
                        className="flex-1 text-[11px] font-medium bg-white border border-red-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-red-400"
                        autoFocus
                      />
                      <button
                        onClick={() => handleReject(c.id)}
                        disabled={busy}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md text-[10px] font-black disabled:opacity-50"
                      >
                        {busy ? '처리중' : '거절 확인'}
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectReason(''); }}
                        className="px-2 py-1.5 bg-white text-slate-500 rounded-md text-[10px] font-black border border-slate-200"
                      >
                        취소
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 상세 — 목록을 밀지 않도록 오버레이로 띄운다. */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={() => setDetailId(null)}>
          <div
            className="bg-white rounded-2xl w-full max-w-2xl my-8 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900">{detail.title}</p>
                <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                  {detail.brand_name ? `${detail.brand_name} · ` : ''}@{detail.business_username}
                  {detail.category ? ` · ${categoryLabel(detail.category)}` : ''}
                </p>
              </div>
              <button onClick={() => setDetailId(null)} className="shrink-0 px-2.5 py-1.5 bg-slate-100 rounded-lg text-[10px] font-black text-slate-500 hover:bg-slate-200">
                닫기
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { k: '유형', v: typeLabel(detail.type) },
                  { k: '보상', v: `${rewardLabel(detail.reward_type)} / ${rewardValue(detail.reward_amount)}` },
                  { k: '총 예산', v: detail.budget_krw ? formatKRW(detail.budget_krw) : '미정' },
                  { k: '모집 인원', v: detail.max_applicants > 0 ? `${detail.max_applicants}명` : '무제한' },
                  { k: '기간', v: `${formatDate(detail.start_date)} ~ ${formatDate(detail.end_date)}` },
                  { k: '지원자', v: `${detail.application_count}명` },
                  { k: '담당자', v: detail.manager_username ? `@${detail.manager_username}` : '미배정' },
                  { k: '접수일', v: formatDate(detail.created_at) },
                ].map(item => (
                  <div key={item.k} className="bg-slate-50 rounded-lg p-2.5">
                    <p className="text-[9px] font-black text-slate-400 uppercase">{item.k}</p>
                    <p className="text-[11px] font-bold text-slate-900 truncate">{item.v}</p>
                  </div>
                ))}
              </div>

              {detail.thumbnail_url && (
                <img src={detail.thumbnail_url} alt="" className="w-full max-h-64 object-contain rounded-xl bg-slate-50" />
              )}

              {detail.description && (
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase mb-1">캠페인 설명</p>
                  <p className="text-[12px] text-slate-600 font-medium whitespace-pre-wrap">{detail.description}</p>
                </div>
              )}

              {detail.requirements && (
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase mb-1">지원 조건</p>
                  <p className="text-[12px] text-slate-600 font-medium whitespace-pre-wrap">{detail.requirements}</p>
                </div>
              )}

              {detail.status === 'admin_rejected' && detail.admin_rejected_reason && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                  <p className="text-[9px] font-black text-red-400 uppercase mb-1">거절 사유</p>
                  <p className="text-[12px] text-red-700 font-medium">{detail.admin_rejected_reason}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-3 border-t border-slate-100 bg-slate-50">
              {detail.status === 'pending_approval' && (
                <>
                  <button
                    onClick={() => { handleApprove(detail.id); setDetailId(null); }}
                    className="px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-[11px] font-black"
                  >
                    승인
                  </button>
                  <button
                    onClick={() => { setRejectingId(detail.id); setDetailId(null); }}
                    className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[11px] font-black"
                  >
                    거절 사유 입력
                  </button>
                </>
              )}
              {detail.status !== 'pending_approval' && (
                <button
                  onClick={() => { handleAssignManager(detail.id); setDetailId(null); }}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[11px] font-black"
                >
                  내 담당으로 배정
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCampaignApproval;
