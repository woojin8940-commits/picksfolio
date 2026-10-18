import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react';
import {
  affiliateService,
  won,
  BATCH_STATUS_LABEL,
  COMMISSION_STATUS_LABEL,
  PARTICIPATION_STATUS_LABEL,
  CHANNEL_LINK_LABEL,
  type AffiliateCampaign,
  type AffiliateCampaignStatus,
  type AffiliateOrder,
  type AffiliateStats,
  type BatchStatus,
  type CommissionStatus,
  type Participation,
  type ParticipationStatus,
  type SettlementBatch,
  type StatRow,
} from '../../services/affiliateService';
import { todayInSeoul } from '../../utils/formatters';
import { lazyWithRetry, LazyRoute } from '../../utils/lazyRoute';

const AffiliateCampaignWizard = lazyWithRetry(() => import('./AffiliateCampaignWizard'));

/**
 * 판매 캠페인(어필리에이트) — 브랜드 메뉴.
 *
 * 맨 위는 두 갈래다. '캠페인'은 캠페인마다 신청자 · 성과 · 주문을 보고, '월별 정산'은
 * 계정 전체의 월 청구서를 본다. 정산은 캠페인이 아니라 달로 묶인다 — 한 달 동안 여러
 * 캠페인에서 생긴 확정 수수료가 청구서 한 장이 된다. 그래서 캠페인 상세의 정산 탭도
 * 같은 청구서 목록을 보여 주고, 그 점을 적어 둔다.
 *
 * 캠페인은 운영자 승인을 거쳐야 공개된다. 반려되면 사유를 보여 주고 같은 마법사로
 * 고쳐 재심사를 요청한다. 판매 중인 캠페인은 브랜드가 직접 종료할 수 있다.
 */

interface BrandAffiliateCampaignsProps {
  businessUsername: string;
  companyName: string;
  /** '쇼핑몰 연동' 메뉴로 보낸다(연결된 몰이 없을 때). */
  onOpenShopSettings?: () => void;
}

const STATUS_CHIP: Record<AffiliateCampaignStatus, { label: string; cls: string }> = {
  pending_approval: { label: '승인 대기', cls: 'bg-amber-50 text-amber-600' },
  active: { label: '모집·판매 중', cls: 'bg-emerald-50 text-emerald-600' },
  rejected: { label: '반려', cls: 'bg-rose-50 text-rose-500' },
  ended: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
};

const COMMISSION_CHIP: Record<CommissionStatus, string> = {
  pending: 'bg-blue-50 text-blue-600',
  confirmed: 'bg-emerald-50 text-emerald-600',
  excluded: 'bg-slate-100 text-slate-500',
  settled: 'bg-slate-900 text-white',
  unverified: 'bg-amber-50 text-amber-600',
};

const PARTICIPATION_CHIP: Record<ParticipationStatus, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-rose-50 text-rose-500',
  revoked: 'bg-slate-100 text-slate-500',
  cancelled: 'bg-slate-100 text-slate-400',
};

const BATCH_CHIP: Record<BatchStatus, string> = {
  draft: 'bg-amber-50 text-amber-600',
  brand_approved: 'bg-blue-50 text-blue-600',
  paid_in: 'bg-indigo-50 text-indigo-600',
  completed: 'bg-emerald-50 text-emerald-600',
};

const Chip: React.FC<{ cls: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap flex-shrink-0 ${cls}`}>{children}</span>
);

const Spinner: React.FC<{ label?: string }> = ({ label = '불러오는 중...' }) => (
  <div className="py-10 flex items-center justify-center gap-2">
    <Loader2 className="w-4 h-4 text-slate-300 animate-spin" />
    <span className="text-[12px] font-bold text-slate-400">{label}</span>
  </div>
);

const Empty: React.FC<{ title: string; desc?: string }> = ({ title, desc }) => (
  <div className="py-10 text-center">
    <p className="text-sm text-slate-500 font-bold">{title}</p>
    {desc && <p className="text-[11px] text-slate-400 font-medium mt-1.5 leading-relaxed whitespace-pre-line">{desc}</p>}
  </div>
);

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: 'numeric', day: 'numeric' });
};

/** "2026-09" → "2026년 9월". */
const periodLabel = (period: string) => {
  const [y, m] = String(period || '').split('-');
  return y && m ? `${y}년 ${Number(m)}월` : period;
};

/** 오늘에서 days 일 전(Asia/Seoul). */
const daysAgo = (days: number) => {
  const d = new Date(`${todayInSeoul()}T00:00:00+09:00`);
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
};

// ───────────────────────────── 월별 정산 ─────────────────────────────

/**
 * 월별 청구서 목록. 캠페인 상세의 정산 탭과 맨 위 '월별 정산' 탭이 같이 쓴다.
 *
 * 청구서는 월 마감 때 서버가 만든다(draft). 브랜드가 금액을 확인하고 승인하면
 * 입금 대기가 되고, 픽스폴리오가 입금을 확인한 뒤 인플루언서에게 원천징수 후 지급한다.
 */
const SettlementPanel: React.FC<{ campaignScoped?: boolean }> = ({ campaignScoped }) => {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState('');
  const [openId, setOpenId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateService.listSettlements('brand');
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    const list = Array.isArray(res.batches) ? res.batches : [];
    // 최근 달이 위로.
    setBatches([...list].sort((a, b) => String(b.period).localeCompare(String(a.period))));
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (b: SettlementBatch) => {
    if (!confirm(`${periodLabel(b.period)} 청구 금액 ${won(b.billedTotal)}을 확인하고 승인할까요?\n승인 후 입금 안내가 진행됩니다.`)) return;
    setApproving(b.id);
    const res = await affiliateService.approveBatch(b.id);
    setApproving('');
    if (res.error || !res.batch) { alert(res.error || '승인하지 못했습니다.'); return; }
    setBatches(prev => prev.map(x => (x.id === b.id ? res.batch! : x)));
  };

  if (loading && batches.length === 0) return <Spinner />;
  if (error && batches.length === 0) return <Empty title={error} />;

  return (
    <div className="space-y-3">
      {campaignScoped && (
        <p className="text-[11px] text-slate-400 font-bold leading-relaxed">
          정산은 캠페인이 아니라 달 단위로 묶입니다. 아래 청구서에는 이 계정의 모든 판매 캠페인 수수료가 함께 들어 있습니다.
        </p>
      )}
      {batches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
          <Empty
            title="아직 청구서가 없습니다"
            desc={'매월 초 지난달 확정된 수수료로 청구서가 만들어집니다.\n구매확정(또는 배송완료 후 자동 확정)된 주문만 포함됩니다.'}
          />
        </div>
      ) : (
        batches.map(b => {
          const open = openId === b.id;
          const lines = Array.isArray(b.lines) ? b.lines : [];
          return (
            <div key={b.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[14px] font-black text-slate-900">{periodLabel(b.period)}</p>
                    <Chip cls={BATCH_CHIP[b.status] || 'bg-slate-100 text-slate-500'}>{BATCH_STATUS_LABEL[b.status] || b.status}</Chip>
                  </div>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                    주문 {b.orderCount.toLocaleString()}건 · 인플루언서 {lines.length}명 · 판매 {won(b.totalSales)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-400">청구 금액(VAT 포함)</p>
                  <p className="text-lg font-black text-slate-900">{won(b.billedTotal)}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[9px] font-black text-slate-400">판매 수수료</p>
                  <p className="text-[12px] font-black text-slate-800">{won(b.brandFee)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[9px] font-black text-slate-400">부가세</p>
                  <p className="text-[12px] font-black text-slate-800">{won(b.vat)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-[9px] font-black text-slate-400">인플루언서 지급분</p>
                  <p className="text-[12px] font-black text-slate-800">{won(b.influencerGross)}</p>
                </div>
              </div>

              {b.status === 'draft' && (
                <button
                  type="button"
                  onClick={() => approve(b)}
                  disabled={approving === b.id}
                  className="mt-3 w-full py-2.5 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {approving === b.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  확인·승인
                </button>
              )}
              {b.brandApprovedAt && (
                <p className="text-[10px] text-slate-400 font-bold mt-2">
                  {formatDate(b.brandApprovedAt)} 승인
                  {b.paidInAt && ` · ${formatDate(b.paidInAt)} 입금 확인 ${won(b.paidInAmount)}`}
                </p>
              )}
              {b.memo && <p className="text-[11px] text-slate-500 font-medium mt-1">{b.memo}</p>}

              {lines.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? '' : b.id)}
                    className="mt-2 text-[11px] font-black text-blue-600 hover:underline"
                  >
                    {open ? '인플루언서별 내역 접기' : '인플루언서별 내역 보기'}
                  </button>
                  {open && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-[11px] min-w-[360px]">
                        <thead>
                          <tr className="text-slate-400 font-black text-left">
                            <th className="py-1.5 pr-2">인플루언서</th>
                            <th className="py-1.5 px-2 text-right">판매</th>
                            <th className="py-1.5 pl-2 text-right">수수료</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lines.map(l => (
                            <tr key={l.id} className="font-bold text-slate-700">
                              <td className="py-1.5 pr-2 truncate">@{l.influencerUsername}</td>
                              <td className="py-1.5 px-2 text-right">{won(l.salesAmount)}</td>
                              <td className="py-1.5 pl-2 text-right">{won(l.brandFee)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}
      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        청구 금액은 확정된 판매 수수료에 부가세를 더한 금액입니다. 인플루언서 개별 지급과 원천징수(3.3%)는 입금 확인 후
        픽스폴리오가 처리합니다. 세금계산서 발행은 별도로 안내드립니다.
      </p>
    </div>
  );
};

// ───────────────────────────── 캠페인 상세 탭 ─────────────────────────────

const ParticipantsTab: React.FC<{ campaign: AffiliateCampaign; onChanged: () => void }> = ({ campaign, onChanged }) => {
  const [rows, setRows] = useState<Participation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<'all' | ParticipationStatus>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateService.campaignParticipants(campaign.id);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    setRows(Array.isArray(res.participations) ? res.participations : []);
  }, [campaign.id]);

  useEffect(() => { load(); }, [load]);

  const decide = async (p: Participation, action: 'approve' | 'reject' | 'revoke') => {
    let reason = '';
    if (action === 'approve') {
      if (!confirm(`@${p.influencerUsername} 님의 참여를 승인할까요? 승인하면 판매 링크가 발급됩니다.`)) return;
    } else if (action === 'reject') {
      const r = prompt('거절 사유를 적어 주세요(인플루언서에게 보입니다).', '');
      if (r === null) return;
      reason = r.trim();
    } else {
      if (!confirm(`@${p.influencerUsername} 님의 참여를 중단할까요? 판매 링크가 더 이상 집계되지 않습니다.`)) return;
      const r = prompt('중단 사유(선택)', '');
      if (r === null) return;
      reason = r.trim();
    }
    setBusy(p.id);
    const res = await affiliateService.decideParticipation(p.id, action, reason);
    setBusy('');
    if (res.error || !res.participation) { alert(res.error || '처리하지 못했습니다.'); return; }
    setRows(prev => prev.map(x => (x.id === p.id ? { ...x, ...res.participation! } : x)));
    onChanged();
  };

  if (loading && rows.length === 0) return <Spinner />;
  if (error && rows.length === 0) return <Empty title={error} />;

  const pendingCount = rows.filter(r => r.status === 'pending').length;
  const shown = filter === 'all' ? rows : rows.filter(r => r.status === filter);

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1 mb-2">
        {(['all', 'pending', 'approved', 'rejected', 'revoked'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap ${
              filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {f === 'all' ? `전체 ${rows.length}` : f === 'pending' ? `승인 대기 ${pendingCount}` : PARTICIPATION_STATUS_LABEL[f]}
          </button>
        ))}
      </div>
      {campaign.joinMode === 'open' && (
        <p className="text-[11px] text-slate-400 font-bold mb-2">누구나 바로 참여하는 캠페인입니다. 신청 즉시 판매가 시작됩니다.</p>
      )}
      {shown.length === 0 ? (
        <Empty title="참여 신청이 없습니다" desc={campaign.status === 'active' ? '인플루언서가 신청하면 여기에 표시됩니다.' : undefined} />
      ) : (
        <div className="divide-y divide-slate-100">
          {shown.map(p => (
            <div key={p.id} className="py-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
                {p.profile?.profileImage && <img src={p.profile.profileImage} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[13px] font-black text-slate-900 truncate">
                    {p.profile?.displayName || `@${p.influencerUsername}`}
                  </p>
                  <Chip cls={PARTICIPATION_CHIP[p.status]}>{PARTICIPATION_STATUS_LABEL[p.status]}</Chip>
                </div>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                  @{p.influencerUsername}
                  {p.profile?.followers ? ` · 팔로워 ${p.profile.followers.toLocaleString()}` : ''}
                  {p.profile?.category ? ` · ${p.profile.category}` : ''}
                  {` · ${formatDate(p.createdAt)} 신청`}
                </p>
                {(p.applicantName || p.applicantContact) && (
                  <p className="text-[11px] text-slate-700 font-bold mt-1">
                    {p.applicantName}
                    {p.applicantName && p.applicantContact ? ' · ' : ''}
                    {p.applicantContact && (
                      <a href={`tel:${p.applicantContact.replace(/[^0-9+]/g, '')}`} className="hover:underline">{p.applicantContact}</a>
                    )}
                  </p>
                )}
                {p.message && (
                  <p className="text-[11px] text-slate-600 font-medium mt-1 leading-relaxed whitespace-pre-line break-keep">{p.message}</p>
                )}
                {p.rejectReason && (p.status === 'rejected' || p.status === 'revoked') && (
                  <p className="text-[10px] text-rose-500 font-bold mt-1">사유: {p.rejectReason}</p>
                )}
                {(p.profile?.instagramUrl || (p.channelLinks || []).length > 0) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {p.profile?.instagramUrl && (
                      <a href={p.profile.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-blue-600 hover:underline">
                        인스타그램 보기
                      </a>
                    )}
                    {(p.channelLinks || []).map(l => (
                      <a key={l.type} href={l.url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-blue-600 hover:underline">
                        {CHANNEL_LINK_LABEL[l.type] || '링크'} 보기
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                {p.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      disabled={busy === p.id}
                      onClick={() => decide(p, 'approve')}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-50"
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      disabled={busy === p.id}
                      onClick={() => decide(p, 'reject')}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[11px] font-black disabled:opacity-50"
                    >
                      거절
                    </button>
                  </>
                )}
                {p.status === 'approved' && (
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => decide(p, 'revoke')}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-rose-500 text-[11px] font-black disabled:opacity-50"
                  >
                    참여 중단
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** 성과 · 인플루언서 순위 탭이 같이 쓰는 통계. 기간은 캠페인 시작일부터 오늘까지가 기본이다. */
const useCampaignStats = (campaign: AffiliateCampaign) => {
  const [from, setFrom] = useState(() => String(campaign.startDate || '').slice(0, 10) || daysAgo(30));
  const [to, setTo] = useState(() => todayInSeoul());
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    affiliateService.getStats('brand', { campaignId: campaign.id, from, to }).then(res => {
      if (!alive) return;
      setLoading(false);
      if (res.error) { setError(res.error); return; }
      setError('');
      setStats(res);
    });
    return () => { alive = false; };
  }, [campaign.id, from, to]);

  return { from, to, setFrom, setTo, stats, loading, error };
};

const RangePicker: React.FC<{ from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }> = ({ from, to, setFrom, setTo }) => (
  <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl w-fit mb-3">
    <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="bg-transparent text-[11px] font-bold text-slate-700 focus:outline-none" />
    <span className="text-slate-300 text-xs font-bold">~</span>
    <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} className="bg-transparent text-[11px] font-bold text-slate-700 focus:outline-none" />
  </div>
);

const StatTable: React.FC<{ rows: StatRow[]; nameLabel: string; ranked?: boolean; withImage?: boolean }> = ({ rows, nameLabel, ranked, withImage }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-[11px] min-w-[520px]">
      <thead>
        <tr className="text-slate-400 font-black text-left border-b border-slate-100">
          {ranked && <th className="py-2 pr-2 w-8">순위</th>}
          <th className="py-2 pr-2">{nameLabel}</th>
          <th className="py-2 px-2 text-right">클릭</th>
          <th className="py-2 px-2 text-right">주문</th>
          <th className="py-2 px-2 text-right">매출</th>
          <th className="py-2 px-2 text-right">취소</th>
          <th className="py-2 pl-2 text-right">수수료(예정+확정)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={r.key} className="font-bold text-slate-700">
            {ranked && <td className={`py-2 pr-2 font-black ${i === 0 ? 'text-blue-600' : 'text-slate-300'}`}>{i + 1}</td>}
            <td className="py-2 pr-2">
              <span className="flex items-center gap-2 min-w-0">
                {withImage && (
                  <span className="w-8 h-8 rounded-lg bg-slate-50 overflow-hidden flex-shrink-0">
                    {r.imageUrl && <img src={r.imageUrl} alt="" className="w-full h-full object-cover" />}
                  </span>
                )}
                <span className="truncate max-w-[180px]">{r.label}</span>
              </span>
            </td>
            <td className="py-2 px-2 text-right">{r.clicks.toLocaleString()}</td>
            <td className="py-2 px-2 text-right">{r.orders.toLocaleString()}</td>
            <td className="py-2 px-2 text-right">{won(r.sales)}</td>
            <td className="py-2 px-2 text-right text-slate-400">{r.cancelled.toLocaleString()}</td>
            <td className="py-2 pl-2 text-right">{won(r.pendingFee + r.confirmedFee + r.settledFee)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const PerformanceTab: React.FC<{ campaign: AffiliateCampaign }> = ({ campaign }) => {
  const { from, to, setFrom, setTo, stats, loading, error } = useCampaignStats(campaign);
  const t = stats?.totals;
  return (
    <div>
      <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {loading && !stats ? <Spinner /> : error && !stats ? <Empty title={error} /> : t ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['클릭', t.clicks.toLocaleString()],
              ['주문', `${t.orders.toLocaleString()}건`],
              ['매출', won(t.sales)],
              ['취소', `${t.cancelled.toLocaleString()}건`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-slate-50 px-3.5 py-3">
                <p className="text-[10px] font-black text-slate-400">{k}</p>
                <p className="text-[15px] font-black text-slate-900 mt-0.5">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              ['예정 수수료', t.pendingFee, 'text-blue-600'],
              ['확정 수수료', t.confirmedFee, 'text-emerald-600'],
              ['정산 완료', t.settledFee, 'text-slate-900'],
            ].map(([k, v, cls]) => (
              <div key={k as string} className="rounded-2xl border border-slate-100 px-3.5 py-3">
                <p className="text-[10px] font-black text-slate-400">{k}</p>
                <p className={`text-[13px] font-black mt-0.5 ${cls}`}>{won(v as number)}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed">
            수수료는 브랜드 부담액입니다. 구매확정 전 주문은 '예정'이고, 취소·반품되면 제외됩니다.
          </p>

          <p className="text-[12px] font-black text-slate-700 mt-5 mb-1">상품별 성과</p>
          {stats!.byProduct.length === 0 ? <Empty title="아직 집계된 판매가 없습니다" /> : (
            <StatTable rows={stats!.byProduct} nameLabel="상품" withImage />
          )}
        </>
      ) : null}
    </div>
  );
};

const RankingTab: React.FC<{ campaign: AffiliateCampaign }> = ({ campaign }) => {
  const { from, to, setFrom, setTo, stats, loading, error } = useCampaignStats(campaign);
  const rows = stats?.byInfluencer || [];
  return (
    <div>
      <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {loading && !stats ? <Spinner /> : error && !stats ? <Empty title={error} /> : rows.length === 0 ? (
        <Empty title="아직 판매한 인플루언서가 없습니다" />
      ) : (
        <StatTable rows={rows} nameLabel="인플루언서" ranked />
      )}
    </div>
  );
};

const OrdersTab: React.FC<{ campaign: AffiliateCampaign }> = ({ campaign }) => {
  const [orders, setOrders] = useState<AffiliateOrder[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<CommissionStatus | 'all'>('all');

  const load = useCallback(async (reset: boolean, offset: number) => {
    setLoading(true);
    const res = await affiliateService.listOrders('brand', { campaignId: campaign.id, status, limit: 50, offset: reset ? 0 : offset });
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    const list = Array.isArray(res.orders) ? res.orders : [];
    setOrders(prev => (reset ? list : [...prev, ...list]));
    setHasMore(!!res.hasMore);
  }, [campaign.id, status]);

  useEffect(() => { load(true, 0); }, [load]);

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-1 mb-2">
        {(['all', 'pending', 'confirmed', 'settled', 'excluded', 'unverified'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-black whitespace-nowrap ${
              status === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {s === 'all' ? '전체' : COMMISSION_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {loading && orders.length === 0 ? <Spinner /> : error && orders.length === 0 ? <Empty title={error} /> : orders.length === 0 ? (
        <Empty title="주문 내역이 없습니다" desc="인플루언서 링크로 들어와 결제한 주문이 쇼핑몰에서 확인되면 여기에 표시됩니다." />
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {orders.map(o => (
              <div key={o.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[12px] font-black text-slate-900">{o.orderNo}</p>
                    <Chip cls={COMMISSION_CHIP[o.commissionStatus] || 'bg-slate-100 text-slate-500'}>
                      {COMMISSION_STATUS_LABEL[o.commissionStatus] || o.commissionStatus}
                    </Chip>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                    {formatDate(o.orderedAt)} · @{o.influencerUsername}
                  </p>
                  {o.reason && <p className="text-[10px] text-slate-500 font-medium mt-0.5">{o.reason}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[12px] font-black text-slate-900">{won(o.commissionBase)}</p>
                  {o.refundedAmount > 0 && (
                    <p className="text-[10px] font-bold text-rose-500">환불 {won(o.refundedAmount)}</p>
                  )}
                  <p className="text-[10px] font-bold text-slate-400">수수료 {won(o.fee)}</p>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              type="button"
              disabled={loading}
              onClick={() => load(false, orders.length)}
              className="mt-2 w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? '불러오는 중...' : '더 보기'}
            </button>
          )}
        </>
      )}
      <p className="text-[10px] text-slate-400 font-medium mt-3 leading-relaxed">
        주문번호는 일부를 가려 보여 줍니다. '미검증'은 쇼핑몰 주문 API 로 아직 확인되지 않은 주문으로, 확인되면 상태가 바뀝니다.
      </p>
    </div>
  );
};

// ───────────────────────────── 캠페인 상세 ─────────────────────────────

type DetailTab = 'participants' | 'performance' | 'ranking' | 'orders' | 'settlement';
const DETAIL_TABS: { key: DetailTab; label: string }[] = [
  { key: 'participants', label: '참여 신청' },
  { key: 'performance', label: '성과' },
  { key: 'ranking', label: '인플루언서 순위' },
  { key: 'orders', label: '주문 내역' },
  { key: 'settlement', label: '정산' },
];

const CampaignDetail: React.FC<{
  campaign: AffiliateCampaign;
  onBack: () => void;
  onEdit: () => void;
  onUpdated: (c: AffiliateCampaign) => void;
  onReload: () => void;
}> = ({ campaign: c, onBack, onEdit, onUpdated, onReload }) => {
  const [tab, setTab] = useState<DetailTab>('participants');
  const [ending, setEnding] = useState(false);
  const chip = STATUS_CHIP[c.status];

  const endCampaign = async () => {
    if (!confirm('판매를 종료할까요? 종료하면 인플루언서 링크로 들어온 새 주문은 수수료가 집계되지 않습니다.')) return;
    setEnding(true);
    const res = await affiliateService.updateCampaign(c.id, { action: 'end' });
    setEnding(false);
    if (res.error || !res.campaign) { alert(res.error || '종료하지 못했습니다.'); return; }
    onUpdated(res.campaign);
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12px] font-black text-slate-500 hover:text-slate-900">
        <ArrowLeft className="w-4 h-4" /> 목록으로
      </button>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip cls={chip.cls}>{chip.label}</Chip>
              <span className="text-[10px] text-slate-400 font-bold">{c.category}</span>
            </div>
            <p className="text-[16px] md:text-xl font-black text-slate-900 mt-1.5 break-keep">{c.title}</p>
            <p className="text-[11px] text-slate-400 font-bold mt-1">
              {String(c.startDate).slice(0, 10)} ~ {String(c.endDate).slice(0, 10)} · {c.joinMode === 'approval' ? '승인제' : '누구나 바로'} · 상품 {c.products.length}개
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[10px] font-black text-slate-400">수수료율</p>
            <p className="text-lg font-black text-slate-900">{c.commissionRate ?? '-'}%</p>
            <p className="text-[10px] font-bold text-slate-400">
              인플루언서 {c.creatorRate}%{c.platformRate != null && ` · 플랫폼 ${c.platformRate}%`}
            </p>
          </div>
        </div>

        {c.status === 'pending_approval' && (
          <p className="mt-3 text-[11px] text-amber-600 font-bold">관리자 승인 후 공개됩니다. 승인 전에는 인플루언서에게 보이지 않습니다.</p>
        )}
        {c.status === 'rejected' && (
          <div className="mt-3 rounded-2xl bg-rose-50 border border-rose-100 px-3.5 py-3">
            <p className="text-[12px] font-black text-rose-600 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> 반려되었습니다
            </p>
            {c.rejectReason && (
              <p className="text-[11px] text-rose-600 font-medium mt-1 leading-relaxed whitespace-pre-line">{c.rejectReason}</p>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="mt-2.5 px-3.5 py-2 rounded-xl bg-rose-600 text-white text-[11px] font-black hover:bg-rose-700"
            >
              수정하고 재심사 요청
            </button>
          </div>
        )}
        {c.status === 'active' && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={endCampaign}
              disabled={ending}
              className="px-3.5 py-2 rounded-xl border border-slate-200 text-rose-500 text-[11px] font-black hover:bg-rose-50 disabled:opacity-50"
            >
              {ending ? '종료 중...' : '판매 종료'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide px-3 pt-3 border-b border-slate-100">
          {DETAIL_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2.5 text-[12px] font-black whitespace-nowrap border-b-2 -mb-px ${
                tab === t.key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
              {t.key === 'participants' && (c.counts?.pending || 0) > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{c.counts!.pending}</span>
              )}
            </button>
          ))}
        </div>
        <div className="p-4 md:p-5">
          {tab === 'participants' && <ParticipantsTab campaign={c} onChanged={onReload} />}
          {tab === 'performance' && <PerformanceTab campaign={c} />}
          {tab === 'ranking' && <RankingTab campaign={c} />}
          {tab === 'orders' && <OrdersTab campaign={c} />}
          {tab === 'settlement' && <SettlementPanel campaignScoped />}
        </div>
      </div>
    </div>
  );
};

// ───────────────────────────── 메뉴 본체 ─────────────────────────────

const BrandAffiliateCampaigns: React.FC<BrandAffiliateCampaignsProps> = ({ companyName, onOpenShopSettings }) => {
  const [topTab, setTopTab] = useState<'campaigns' | 'settlement'>('campaigns');
  const [campaigns, setCampaigns] = useState<AffiliateCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** 마법사: null=닫힘 · 'new'=새 캠페인 · 캠페인=반려 건 수정. */
  const [wizard, setWizard] = useState<'new' | AffiliateCampaign | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateService.listMyCampaigns();
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    setError('');
    setCampaigns(Array.isArray(res.campaigns) ? res.campaigns : []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const detail = detailId ? campaigns.find(c => c.id === detailId) || null : null;

  const upsert = (c: AffiliateCampaign) => {
    // 응답에는 counts 가 없을 수 있다 — 목록에 있던 값을 지키고, 정확한 값은 다시 읽어 맞춘다.
    setCampaigns(prev => {
      const i = prev.findIndex(x => x.id === c.id);
      if (i < 0) return [c, ...prev];
      const next = [...prev];
      next[i] = { ...prev[i], ...c, counts: c.counts || prev[i].counts };
      return next;
    });
  };

  return (
    <main className="p-4 md:p-14 w-full max-w-5xl animate-in fade-in duration-500">
      <header className="mb-4 md:mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg md:text-3xl font-black text-slate-900">판매 캠페인</h2>
          <p className="text-[12px] md:text-sm text-slate-500 font-bold mt-1 leading-relaxed">
            자사몰 상품을 인플루언서가 판매하고, 팔린 만큼 수수료를 지급합니다.
          </p>
        </div>
        {topTab === 'campaigns' && !wizard && !detail && (
          <button
            type="button"
            onClick={() => setWizard('new')}
            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[12px] md:text-sm font-black hover:bg-blue-700 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" /> 새 판매 캠페인
          </button>
        )}
      </header>

      {!wizard && !detail && (
        <div className="flex gap-1 mb-4">
          {([['campaigns', '캠페인'], ['settlement', '월별 정산']] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTopTab(k)}
              className={`px-4 py-2 rounded-full text-sm font-black ${
                topTab === k ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {wizard ? (
        <LazyRoute>
          <AffiliateCampaignWizard
            companyName={companyName}
            editing={wizard === 'new' ? null : wizard}
            onClose={() => setWizard(null)}
            onSaved={c => {
              upsert(c);
              setWizard(null);
              setDetailId(c.id);
              load();
            }}
            onOpenShopSettings={onOpenShopSettings}
          />
        </LazyRoute>
      ) : topTab === 'settlement' ? (
        <SettlementPanel />
      ) : detail ? (
        <CampaignDetail
          key={detail.id}
          campaign={detail}
          onBack={() => setDetailId(null)}
          onEdit={() => setWizard(detail)}
          onUpdated={upsert}
          onReload={load}
        />
      ) : loading && campaigns.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm"><Spinner /></div>
      ) : error && campaigns.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 text-center">
          <p className="text-sm font-bold text-rose-500">{error}</p>
          <button type="button" onClick={load} className="mt-3 px-4 py-2 rounded-xl bg-slate-900 text-white text-[12px] font-black">
            다시 불러오기
          </button>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 md:p-12 text-center">
          <span className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
            <ShoppingBag className="w-6 h-6 text-blue-600" />
          </span>
          <p className="text-[15px] md:text-lg font-black text-slate-900 mt-3">아직 판매 캠페인이 없습니다</p>
          <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed">
            쇼핑몰을 연동하고 상품과 수수료율을 정하면, 승인 후 인플루언서가 참여해 판매합니다.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => setWizard('new')}
              className="px-5 py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700"
            >
              새 판매 캠페인 만들기
            </button>
            {onOpenShopSettings && (
              <button
                type="button"
                onClick={onOpenShopSettings}
                className="px-5 py-3 rounded-xl border border-slate-200 text-slate-600 text-[13px] font-black hover:bg-slate-50"
              >
                쇼핑몰 연동
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => {
            const chip = STATUS_CHIP[c.status] || STATUS_CHIP.ended;
            const n = c.counts;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setDetailId(c.id)}
                className="w-full text-left bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-xl bg-slate-50 overflow-hidden flex-shrink-0">
                    {c.products[0]?.imageUrl && <img src={c.products[0].imageUrl} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Chip cls={chip.cls}>{chip.label}</Chip>
                      {(n?.pending || 0) > 0 && <Chip cls="bg-red-500 text-white">신청 대기 {n!.pending}</Chip>}
                    </div>
                    <p className="text-[14px] font-black text-slate-900 mt-1 truncate">{c.title}</p>
                    <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                      수수료 {c.commissionRate ?? '-'}% · {String(c.startDate).slice(0, 10)} ~ {String(c.endDate).slice(0, 10)} · 상품 {c.products.length}개
                    </p>
                    {c.status === 'rejected' && c.rejectReason && (
                      <p className="text-[11px] text-rose-500 font-bold mt-1 truncate">반려 사유: {c.rejectReason}</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />
                </div>
                {n && (
                  <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                    {[
                      ['참여', `${n.approved}명`],
                      ['클릭', n.clicks.toLocaleString()],
                      ['주문', `${n.orders.toLocaleString()}건`],
                      ['매출', won(n.sales)],
                      ['취소', `${n.cancelled.toLocaleString()}건`],
                      ['신청 대기', `${n.pending}명`],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <p className="text-[9px] font-black text-slate-400">{k}</p>
                        <p className="text-[11px] font-black text-slate-800 truncate">{v}</p>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-[11px] font-black text-slate-400 hover:text-slate-600 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
            </button>
          </div>
        </div>
      )}
    </main>
  );
};

export default BrandAffiliateCampaigns;
