import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CreditCard, ExternalLink, FileText, Play, RefreshCw, Save, ShieldCheck, X, XCircle,
} from 'lucide-react';
import {
  affiliateService,
  BATCH_STATUS_LABEL,
  COMMISSION_STATUS_LABEL,
  won,
  type AffiliateCampaign,
  type AffiliateCampaignStatus,
  type AffiliateOrder,
  type BatchStatus,
  type SettlementBatch,
  type SettlementLine,
} from '../../services/affiliateService';

/**
 * 판매 연동 캠페인(어필리에이트) 운영 콘솔.
 *
 *   캠페인 심사 — 금지 표현 · 비정상 수수료율을 보고 승인/반려
 *   월 정산     — 집계(draft) → 브랜드 승인 → 입금 확인 → 인플루언서 지급 → 완료
 *   미검증 주문 — 카페24 API 로 확인되지 않은 주문(정산 제외)을 다시 조회
 */

interface Props {
  token: string;
}

type SubTab = 'review' | 'settlement' | 'orders';

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('ko-KR') : '-');
const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString('ko-KR') : '-');

const Spinner: React.FC<{ label: string }> = ({ label }) => (
  <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
    <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
    <p className="text-slate-400 font-bold text-sm">{label}</p>
  </div>
);

const ErrorBar: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-[11px] font-bold text-red-600">{message}</div>
  ) : null;

const AdminAffiliateConsole: React.FC<Props> = ({ token }) => {
  const [tab, setTab] = useState<SubTab>('review');
  const tabs: { key: SubTab; label: string }[] = [
    { key: 'review', label: '캠페인 심사' },
    { key: 'settlement', label: '월 정산' },
    { key: 'orders', label: '미검증 주문' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 rounded-xl text-xs font-black ${
              tab === t.key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-100 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'review' && <CampaignReview token={token} />}
      {tab === 'settlement' && <MonthlySettlement token={token} />}
      {tab === 'orders' && <UnverifiedOrders token={token} />}
    </div>
  );
};

// ───────────────────────────── 캠페인 심사 ─────────────────────────────

const CAMPAIGN_STATUS: Record<AffiliateCampaignStatus, { cls: string; label: string }> = {
  pending_approval: { cls: 'bg-amber-100 text-amber-700', label: '심사 대기' },
  active: { cls: 'bg-green-100 text-green-700', label: '진행 중' },
  rejected: { cls: 'bg-red-100 text-red-700', label: '반려' },
  ended: { cls: 'bg-slate-100 text-slate-500', label: '종료' },
};

/** 비정상 수수료율 경고. 하나라도 있으면 심사 시 한 번 더 본다. */
const rateWarnings = (c: AffiliateCampaign): string[] => {
  const w: string[] = [];
  const commission = Number(c.commissionRate ?? 0);
  const platform = Number(c.platformRate ?? 0);
  const creator = Number(c.creatorRate ?? 0);
  if (commission >= 50) w.push(`총 수수료율 ${commission}% — 50% 이상`);
  if (creator < 3) w.push(`인플루언서 몫 ${creator}% — 3% 미만`);
  if (c.commissionRate !== undefined && c.platformRate !== undefined && Math.abs(commission - platform - creator) > 0.01) {
    w.push('총 수수료율 − 플랫폼 수수료율 ≠ 인플루언서 몫');
  }
  return w;
};

const CampaignReview: React.FC<{ token: string }> = ({ token }) => {
  const [status, setStatus] = useState<AffiliateCampaignStatus | 'all'>('pending_approval');
  const [campaigns, setCampaigns] = useState<AffiliateCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await affiliateService.listCampaignsForAdmin(token, status);
    if (res.error) setError(res.error);
    setCampaigns(res.campaigns || []);
    setLoading(false);
  }, [token, status]);

  useEffect(() => { load(); }, [load]);

  const detail = useMemo(() => campaigns.find(c => c.id === detailId) || null, [campaigns, detailId]);

  const openDetail = (id: string) => {
    setDetailId(id);
    setRejecting(false);
    setRejectReason('');
  };

  const review = async (c: AffiliateCampaign, action: 'approve' | 'reject') => {
    if (action === 'approve') {
      const warns = rateWarnings(c);
      const msg = warns.length
        ? `수수료율 경고가 있습니다.\n- ${warns.join('\n- ')}\n\n그래도 승인할까요? 승인하면 인플루언서 둘러보기에 노출됩니다.`
        : '이 캠페인을 승인할까요? 승인하면 인플루언서 둘러보기에 노출됩니다.';
      if (!confirm(msg)) return;
    } else if (!rejectReason.trim()) {
      setError('반려 사유를 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await affiliateService.reviewCampaign(token, c.id, action, action === 'reject' ? rejectReason.trim() : '');
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setDetailId(null);
    setRejecting(false);
    setRejectReason('');
    await load();
  };

  const filters: { key: AffiliateCampaignStatus | 'all'; label: string }[] = [
    { key: 'pending_approval', label: '심사 대기' },
    { key: 'active', label: '진행 중' },
    { key: 'rejected', label: '반려' },
    { key: 'ended', label: '종료' },
    { key: 'all', label: '전체' },
  ];

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-black text-slate-900">판매 캠페인 심사</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
              금지 표현 · 광고 표기 · 비정상 수수료율(총 50% 이상, 인플루언서 몫 3% 미만)을 확인합니다
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {filters.map(f => (
              <button
                key={f.key}
                onClick={() => setStatus(f.key)}
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black ${
                  status === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button onClick={load} className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200" title="새로고침">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {!detail && error && <div className="p-3"><ErrorBar message={error} /></div>}

        <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
          <div className="col-span-3">브랜드 / 캠페인</div>
          <div className="col-span-1">상품</div>
          <div className="col-span-3">수수료율 (총 · 플랫폼 · 인플루언서)</div>
          <div className="col-span-2">기간</div>
          <div className="col-span-1">상태</div>
          <div className="col-span-2 text-right">처리</div>
        </div>
        <div className="divide-y divide-slate-50">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm font-bold">불러오는 중...</div>
          ) : campaigns.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm font-bold">표시할 캠페인이 없습니다.</div>
          ) : campaigns.map(c => {
            const warns = rateWarnings(c);
            const st = CAMPAIGN_STATUS[c.status] || { cls: 'bg-slate-100 text-slate-500', label: c.status };
            return (
              <div key={c.id} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-slate-50/50 space-y-1 md:space-y-0">
                <div className="md:col-span-3 min-w-0">
                  <p className="font-black text-slate-900 text-sm truncate">{c.companyName || c.businessUsername}</p>
                  <p className="text-[11px] font-bold text-slate-500 truncate">{c.title}</p>
                  <p className="text-[10px] font-bold text-slate-300">{c.shopType} · {c.mallId} · 등록 {fmtDate(c.createdAt)}</p>
                </div>
                <div className="md:col-span-1 text-xs font-bold text-slate-600">{c.products?.length || 0}개</div>
                <div className="md:col-span-3">
                  <p className="text-xs font-black text-slate-900">
                    {c.commissionRate ?? '-'}% <span className="text-slate-300">·</span>{' '}
                    <span className="text-slate-500">{c.platformRate ?? '-'}%</span> <span className="text-slate-300">·</span>{' '}
                    <span className={c.creatorRate < 3 ? 'text-red-600' : 'text-blue-600'}>{c.creatorRate}%</span>
                  </p>
                  {warns.length > 0 && (
                    <p className="flex items-center gap-1 text-[10px] font-black text-red-600 mt-0.5">
                      <AlertTriangle className="w-3 h-3" /> {warns[0]}{warns.length > 1 ? ` 외 ${warns.length - 1}건` : ''}
                    </p>
                  )}
                </div>
                <div className="md:col-span-2 text-[11px] font-bold text-slate-500">{c.startDate} ~ {c.endDate}</div>
                <div className="md:col-span-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${st.cls}`}>{st.label}</span>
                </div>
                <div className="md:col-span-2 flex md:justify-end gap-1">
                  <button
                    onClick={() => openDetail(c.id)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-[11px] font-black"
                  >
                    {c.status === 'pending_approval' ? '심사' : '상세'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={() => setDetailId(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400">{detail.companyName || detail.businessUsername} · @{detail.businessUsername}</p>
                <h3 className="font-black text-slate-900 text-lg">{detail.title}</h3>
                <p className="text-[11px] font-bold text-slate-400">{detail.category || '카테고리 없음'} · {detail.shopType} {detail.mallId}</p>
              </div>
              <button onClick={() => setDetailId(null)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* 수수료율 */}
              <div>
                <div className="grid grid-cols-3 gap-2">
                  <RateBox label="총 수수료율(브랜드)" value={detail.commissionRate} warn={Number(detail.commissionRate ?? 0) >= 50} />
                  <RateBox label="플랫폼 수수료율(고정)" value={detail.platformRate} />
                  <RateBox label="인플루언서 몫" value={detail.creatorRate} warn={detail.creatorRate < 3} highlight />
                </div>
                {rateWarnings(detail).length > 0 && (
                  <div className="mt-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2 space-y-0.5">
                    {rateWarnings(detail).map(w => (
                      <p key={w} className="flex items-center gap-1 text-[11px] font-black text-red-600">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <InfoRow label="판매 기간" value={`${detail.startDate} ~ ${detail.endDate}`} />
                <InfoRow label="참여 방식" value={detail.joinMode === 'open' ? '자유 참여(즉시 승인)' : '브랜드 승인 후 참여'} />
                <InfoRow label="샘플 제공" value={detail.sampleOffered ? `제공${detail.sampleNote ? ` · ${detail.sampleNote}` : ''}` : '없음'} />
                <InfoRow label="팔로워 할인" value={detail.followerDiscount || '없음'} />
              </div>

              {detail.description && <TextBlock label="캠페인 설명" text={detail.description} />}

              {/* 상품 */}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">상품 {detail.products?.length || 0}개</p>
                <div className="space-y-1.5">
                  {(detail.products || []).map(p => (
                    <div key={p.id} className="flex items-center gap-3 p-2 rounded-xl border border-slate-100">
                      {p.imageUrl
                        ? <img src={p.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" />
                        : <div className="w-10 h-10 rounded-lg bg-slate-100 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">{p.name}</p>
                        <p className="text-[10px] font-bold text-slate-400">
                          {won(p.price)} · 상품번호 {p.shopProductId}
                          {detail.commissionRate !== undefined && ` · 건당 수수료 ${won(p.price * Number(detail.commissionRate) / 100)}`}
                          {!p.active && ' · 비활성'}
                        </p>
                      </div>
                      {p.productUrl && (
                        <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <TextBlock label="콘텐츠 가이드" text={detail.contentGuide || '없음'} />
              <TextBlock label="금지 표현" text={detail.bannedPhrases || '없음'} tone={detail.bannedPhrases ? 'amber' : undefined} />
              <TextBlock label="광고 표기(자동 포함)" text={detail.disclosureText || '-'} />

              {detail.status === 'rejected' && detail.rejectReason && (
                <TextBlock label="반려 사유" text={detail.rejectReason} tone="red" />
              )}

              {detail.status === 'pending_approval' && rejecting && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">반려 사유 (브랜드에게 보입니다)</p>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={3}
                    placeholder="예: 인플루언서 몫이 너무 낮습니다. 총 수수료율을 조정해 다시 요청해 주세요."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-200"
                  />
                </div>
              )}
              <ErrorBar message={error} />
            </div>

            {detail.status === 'pending_approval' && (
              <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
                {rejecting ? (
                  <>
                    <button onClick={() => setRejecting(false)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-xs font-black">취소</button>
                    <button
                      onClick={() => review(detail, 'reject')}
                      disabled={busy || !rejectReason.trim()}
                      className="flex items-center gap-1 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-black hover:bg-red-700 disabled:opacity-40"
                    >
                      <XCircle className="w-3.5 h-3.5" /> 반려 확정
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setRejecting(true); setError(''); }}
                      className="flex items-center gap-1 px-3 py-2 rounded-xl bg-red-50 text-red-600 text-xs font-black hover:bg-red-100"
                    >
                      <XCircle className="w-3.5 h-3.5" /> 반려
                    </button>
                    <button
                      onClick={() => review(detail, 'approve')}
                      disabled={busy}
                      className="flex items-center gap-1 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 disabled:opacity-40"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> 승인
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const RateBox: React.FC<{ label: string; value?: number; warn?: boolean; highlight?: boolean }> = ({ label, value, warn, highlight }) => (
  <div className={`p-3 rounded-xl border ${warn ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50'}`}>
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
    <p className={`text-xl font-black ${warn ? 'text-red-600' : highlight ? 'text-blue-600' : 'text-slate-900'}`}>
      {value === undefined || value === null ? '-' : `${value}%`}
    </p>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="p-2.5 rounded-xl bg-slate-50">
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
    <p className="text-xs font-bold text-slate-800 mt-0.5 break-words">{value}</p>
  </div>
);

const TextBlock: React.FC<{ label: string; text: string; tone?: 'amber' | 'red' }> = ({ label, text, tone }) => {
  const cls = tone === 'red' ? 'bg-red-50 border-red-100 text-red-700' : tone === 'amber' ? 'bg-amber-50 border-amber-100 text-slate-800' : 'bg-slate-50 border-slate-100 text-slate-700';
  return (
    <div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-[12px] font-medium whitespace-pre-wrap leading-relaxed rounded-xl border px-3 py-2 ${cls}`}>{text}</p>
    </div>
  );
};

// ───────────────────────────── 월 정산 ─────────────────────────────

const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const BATCH_STATUS_CLS: Record<BatchStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  brand_approved: 'bg-amber-100 text-amber-700',
  paid_in: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

const BATCH_STEPS: BatchStatus[] = ['draft', 'brand_approved', 'paid_in', 'completed'];

const MonthlySettlement: React.FC<{ token: string }> = ({ token }) => {
  const [period, setPeriod] = useState(lastMonth());
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await affiliateService.listSettlements('admin', { period }, token);
    if (res.error) setError(res.error);
    setBatches(res.batches || []);
    setLoading(false);
  }, [token, period]);

  useEffect(() => { load(); }, [load]);

  const runClose = async () => {
    if (!/^\d{4}-\d{2}$/.test(period)) return;
    if (!confirm(`${period} 월 마감을 실행합니다.\n\n해당 월의 확정 주문을 브랜드별 청구서와 인플루언서별 지급 내역으로 집계합니다. 이미 집계된 브랜드는 건너뜁니다. 계속할까요?`)) return;
    setRunning(true);
    setError('');
    setNotice('');
    const res = await affiliateService.adminSettlementAction(token, 'run_close', { period });
    setRunning(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNotice(`마감 완료 · 새 청구서 ${res.created ?? 0}건`);
    await load();
  };

  const replaceBatch = (b: SettlementBatch) => setBatches(prev => prev.map(x => (x.id === b.id ? b : x)));

  const totals = useMemo(() => batches.reduce(
    (acc, b) => ({
      sales: acc.sales + (b.totalSales || 0),
      billed: acc.billed + (b.billedTotal || 0),
      platform: acc.platform + (b.platformFee || 0),
      influencer: acc.influencer + (b.influencerGross || 0),
    }),
    { sales: 0, billed: 0, platform: 0, influencer: 0 },
  ), [batches]);

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-black text-slate-900">월 정산</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">
            매월 1일 지난달 확정 주문을 집계 → 브랜드 확인·승인 → 운영자 입금 확인 → 인플루언서 지급(3.3% 원천징수)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-black text-slate-900"
          />
          <button onClick={load} className="p-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200" title="새로고침">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={runClose}
            disabled={running || !/^\d{4}-\d{2}$/.test(period)}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5" /> {running ? '마감 중...' : '마감 실행'}
          </button>
        </div>
      </div>

      <ErrorBar message={error} />
      {notice && <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2 text-[11px] font-bold text-green-700">{notice}</div>}

      <div className="bg-amber-50/70 border border-amber-100 rounded-2xl px-4 py-2.5">
        <p className="text-[11px] font-bold text-slate-600">
          세금계산서 발행은 보류 중입니다. 별도로 발행한 경우 청구서 메모에 계산서 번호만 기록해 두세요.
        </p>
      </div>

      {batches.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SumCard label={`${period} 판매액`} value={won(totals.sales)} />
          <SumCard label="청구 합계(부가세 포함)" value={won(totals.billed)} />
          <SumCard label="플랫폼 몫" value={won(totals.platform)} tone="text-indigo-600" />
          <SumCard label="인플루언서 몫(세전)" value={won(totals.influencer)} tone="text-blue-600" />
        </div>
      )}

      {loading ? (
        <Spinner label="정산 내역 불러오는 중..." />
      ) : batches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
          <p className="text-slate-400 font-bold text-sm">{period} 정산 내역이 없습니다.</p>
          <p className="text-slate-300 font-bold text-xs mt-1">아직 마감 전이라면 '마감 실행'으로 집계할 수 있습니다.</p>
        </div>
      ) : batches.map(b => (
        <BatchCard key={b.id} batch={b} token={token} onChange={replaceBatch} onReload={load} />
      ))}
    </div>
  );
};

const SumCard: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = 'text-slate-900' }) => (
  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className={`text-lg font-black ${tone}`}>{value}</p>
  </div>
);

const BatchCard: React.FC<{
  batch: SettlementBatch;
  token: string;
  onChange: (b: SettlementBatch) => void;
  onReload: () => void;
}> = ({ batch: b, token, onChange, onReload }) => {
  const [amount, setAmount] = useState(String(b.paidInAmount || b.billedTotal || 0));
  const [memo, setMemo] = useState(b.memo || '');
  const [invoiceNo, setInvoiceNo] = useState(b.invoiceNo || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(b.status === 'paid_in');
  /** 운영자가 "지급 정보 보기"로 연 원문. 화면을 떠나면 사라진다(저장하지 않는다). */
  const [revealed, setRevealed] = useState<Record<string, { legalName: string; rrn: string; bankName: string; accountNumber: string }>>({});

  const toggleReveal = async (l: SettlementLine) => {
    if (revealed[l.id]) {
      setRevealed(prev => { const next = { ...prev }; delete next[l.id]; return next; });
      return;
    }
    if (!confirm(`@${l.influencerUsername} 의 주민등록번호와 계좌번호를 엽니다.\n\n지급 · 원천징수 신고 목적으로만 열람하세요. 열람 기록이 남습니다.`)) return;
    setBusy(`reveal-${l.id}`);
    const res = await affiliateService.revealPayoutAccount(token, l.id);
    setBusy(null);
    if (res.error || !res.account) {
      setError(res.error || '지급 정보를 열지 못했습니다.');
      return;
    }
    setRevealed(prev => ({ ...prev, [l.id]: res.account }));
  };

  useEffect(() => {
    setAmount(String(b.paidInAmount || b.billedTotal || 0));
    setMemo(b.memo || '');
    setInvoiceNo(b.invoiceNo || '');
  }, [b.id, b.paidInAmount, b.billedTotal, b.memo, b.invoiceNo]);

  const apply = async (
    key: string,
    action: 'mark_paid_in' | 'pay_line' | 'save_memo',
    payload: { batchId?: string; lineId?: string; amount?: number; memo?: string; invoiceNo?: string },
  ) => {
    setBusy(key);
    setError('');
    const res = await affiliateService.adminSettlementAction(token, action, payload);
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.batch) onChange(res.batch);
    else onReload();
  };

  const markPaidIn = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('입금액을 입력해 주세요.');
      return;
    }
    const diff = n !== b.billedTotal ? `\n\n청구 합계 ${won(b.billedTotal)}와 다릅니다.` : '';
    if (!confirm(`${b.companyName || b.businessUsername} 입금 ${won(n)}을 확인 처리합니다.${diff}\n\n확인 후 인플루언서 지급을 진행할 수 있습니다. 계속할까요?`)) return;
    apply('paid_in', 'mark_paid_in', { batchId: b.id, amount: n });
  };

  const payLine = (l: SettlementLine) => {
    const acct = l.payoutAccount;
    const acctText = acct ? `${acct.bankName} ${acct.legalName} ****${acct.accountTail}` : '';
    if (!confirm(`@${l.influencerUsername} 에게 실지급 ${won(l.influencerNet)}을 지급 처리합니다.\n\n계좌: ${acctText}\n세전 ${won(l.influencerGross)} − 원천징수 ${won(l.withholding)}\n\n실제 이체를 마친 뒤 처리하세요. 계속할까요?`)) return;
    apply(`line-${l.id}`, 'pay_line', { batchId: b.id, lineId: l.id });
  };

  const memoDirty = memo !== (b.memo || '') || invoiceNo !== (b.invoiceNo || '');
  const paidCount = b.lines.filter(l => l.status === 'paid').length;
  const stepIdx = BATCH_STEPS.indexOf(b.status);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-start justify-between flex-wrap gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-black text-slate-900 truncate">{b.companyName || b.businessUsername}</h4>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${BATCH_STATUS_CLS[b.status]}`}>{BATCH_STATUS_LABEL[b.status]}</span>
          </div>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">
            @{b.businessUsername} · {b.period} · 주문 {b.orderCount}건 · 인플루언서 {b.lines.length}명 (지급 {paidCount})
          </p>
        </div>
        <div className="flex items-center gap-1">
          {BATCH_STEPS.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <span className={`w-3 h-px ${i <= stepIdx ? 'bg-slate-900' : 'bg-slate-200'}`} />}
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${i <= stepIdx ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {s === 'draft' ? '집계' : s === 'brand_approved' ? '브랜드 승인' : s === 'paid_in' ? '입금 확인' : '지급 완료'}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="p-4 grid grid-cols-2 md:grid-cols-6 gap-2">
        <MiniStat label="판매액" value={won(b.totalSales)} />
        <MiniStat label="브랜드 수수료" value={won(b.brandFee)} />
        <MiniStat label="부가세" value={won(b.vat)} />
        <MiniStat label="청구 합계" value={won(b.billedTotal)} strong />
        <MiniStat label="플랫폼 몫" value={won(b.platformFee)} tone="text-indigo-600" />
        <MiniStat label="인플루언서 몫" value={won(b.influencerGross)} tone="text-blue-600" />
      </div>

      <div className="px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-400">
        <span>브랜드 승인 {fmtDateTime(b.brandApprovedAt)}</span>
        <span>입금 확인 {fmtDateTime(b.paidInAt)}{b.paidInAt ? ` · ${won(b.paidInAmount)}` : ''}</span>
      </div>

      <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 입금 확인 */}
        <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">브랜드 입금 확인</p>
          {b.status === 'draft' ? (
            <p className="text-[11px] font-bold text-slate-500">브랜드가 청구서를 확인·승인한 뒤 입금 확인을 할 수 있습니다.</p>
          ) : b.status === 'brand_approved' ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-black"
              />
              <button
                onClick={markPaidIn}
                disabled={busy !== null}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-800 disabled:opacity-40 shrink-0"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> {busy === 'paid_in' ? '처리 중...' : '입금 확인'}
              </button>
            </div>
          ) : (
            <p className="text-[11px] font-bold text-green-700">입금 확인됨 · {won(b.paidInAmount)}</p>
          )}
        </div>

        {/* 메모 · 계산서 번호 */}
        <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">메모 · 계산서 번호(선택)</p>
          <div className="flex items-center gap-2">
            <input
              value={invoiceNo}
              onChange={e => setInvoiceNo(e.target.value)}
              placeholder="계산서 번호"
              className="w-32 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
            />
            <input
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="운영 메모"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold"
            />
            <button
              onClick={() => apply('memo', 'save_memo', { batchId: b.id, memo, invoiceNo })}
              disabled={!memoDirty || busy !== null}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-[11px] font-black hover:bg-slate-300 disabled:opacity-40 shrink-0"
            >
              <Save className="w-3.5 h-3.5" /> 저장
            </button>
          </div>
        </div>
      </div>

      {error && <div className="px-4 pb-3"><ErrorBar message={error} /></div>}

      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2 border-t border-slate-100 text-[11px] font-black text-slate-500 hover:bg-slate-50 flex items-center justify-center gap-1"
      >
        <FileText className="w-3.5 h-3.5" /> 인플루언서별 지급 내역 {open ? '접기' : `보기 (${b.lines.length})`}
      </button>

      {open && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                <th className="text-left px-4 py-2.5">인플루언서</th>
                <th className="text-right px-2 py-2.5">판매액</th>
                <th className="text-right px-2 py-2.5">세전</th>
                <th className="text-right px-2 py-2.5">원천징수</th>
                <th className="text-right px-2 py-2.5">실지급</th>
                <th className="text-left px-3 py-2.5">지급 정보</th>
                <th className="text-right px-4 py-2.5">지급</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {b.lines.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-slate-400 font-bold">지급 내역이 없습니다.</td></tr>
              ) : b.lines.map(l => {
                const acct = l.payoutAccount;
                const canPay = b.status === 'paid_in' && l.status === 'pending' && !!acct?.submitted;
                const blockReason = l.status === 'paid'
                  ? ''
                  : b.status !== 'paid_in'
                    ? '입금 확인 후 지급 가능'
                    : !acct?.submitted ? '지급 정보 미제출' : '';
                return (
                  <tr key={l.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-bold text-blue-600">@{l.influencerUsername}</td>
                    <td className="px-2 py-2.5 text-right font-bold text-slate-600">{won(l.salesAmount)}</td>
                    <td className="px-2 py-2.5 text-right font-bold text-slate-900">{won(l.influencerGross)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <p className="font-bold text-slate-600">−{won(l.withholding)}</p>
                      <p className="text-[9px] font-bold text-slate-400">소득세 {won(l.incomeTax)} · 지방세 {won(l.localTax)}</p>
                    </td>
                    <td className="px-2 py-2.5 text-right font-black text-slate-900">{won(l.influencerNet)}</td>
                    <td className="px-3 py-2.5">
                      {acct?.submitted ? (
                        <div>
                          {revealed[l.id] ? (
                            <>
                              <p className="font-bold text-slate-900 select-all">{revealed[l.id].bankName} {revealed[l.id].accountNumber}</p>
                              <p className="text-[9px] font-bold text-slate-600 select-all">
                                {revealed[l.id].legalName} · {revealed[l.id].rrn}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-bold text-slate-700">{acct.bankName} ****{acct.accountTail}</p>
                              <p className="text-[9px] font-bold text-slate-400">{acct.legalName} · {acct.rrnMasked}</p>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleReveal(l)}
                            disabled={busy !== null}
                            className="mt-0.5 text-[9px] font-black text-blue-600 underline disabled:opacity-40"
                          >
                            {busy === `reveal-${l.id}` ? '여는 중...' : revealed[l.id] ? '가리기' : '지급 정보 보기'}
                          </button>
                        </div>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-black">미제출</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {l.status === 'paid' ? (
                        <div>
                          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-black">지급 완료</span>
                          <p className="text-[9px] font-bold text-slate-400 mt-0.5">{fmtDate(l.paidAt)}</p>
                        </div>
                      ) : (
                        <div className="flex flex-col items-end">
                          <button
                            onClick={() => payLine(l)}
                            disabled={!canPay || busy !== null}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-800 disabled:opacity-30"
                          >
                            <CreditCard className="w-3.5 h-3.5" /> {busy === `line-${l.id}` ? '처리 중...' : '지급 처리'}
                          </button>
                          {blockReason && <p className="text-[9px] font-bold text-slate-400 mt-0.5">{blockReason}</p>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const MiniStat: React.FC<{ label: string; value: string; tone?: string; strong?: boolean }> = ({ label, value, tone = 'text-slate-900', strong }) => (
  <div className={`p-2.5 rounded-xl ${strong ? 'bg-slate-900' : 'bg-slate-50'}`}>
    <p className={`text-[9px] font-black uppercase tracking-widest ${strong ? 'text-slate-400' : 'text-slate-400'}`}>{label}</p>
    <p className={`text-sm font-black mt-0.5 ${strong ? 'text-white' : tone}`}>{value}</p>
  </div>
);

// ───────────────────────────── 미검증 주문 ─────────────────────────────

const UnverifiedOrders: React.FC<{ token: string }> = ({ token }) => {
  const [verification, setVerification] = useState<'unverified' | 'failed'>('unverified');
  const [orders, setOrders] = useState<AffiliateOrder[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<Record<string, string>>({});

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    setError('');
    const res = await affiliateService.listOrders('admin', { verification, limit: 50, offset }, token);
    if (res.error) setError(res.error);
    setOrders(prev => (offset ? [...prev, ...(res.orders || [])] : res.orders || []));
    setHasMore(!!res.hasMore);
    setLoading(false);
  }, [token, verification]);

  useEffect(() => { setResultMsg({}); load(0); }, [load]);

  const reverify = async (o: AffiliateOrder) => {
    setBusyId(o.id);
    const res = await affiliateService.reverifyOrder(token, o.id);
    setBusyId(null);
    if (res.error) {
      setResultMsg(m => ({ ...m, [o.id]: res.error || '재검증 실패' }));
      return;
    }
    const updated = res.order;
    if (updated) {
      setResultMsg(m => ({
        ...m,
        [o.id]: updated.verification === 'verified' ? '검증 완료' : updated.verification === 'failed' ? `확인 실패${updated.reason ? ` · ${updated.reason}` : ''}` : '아직 확인되지 않음',
      }));
      setOrders(prev => prev.map(x => (x.id === o.id ? updated : x)));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-black text-slate-900">미검증 주문</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">
            추적 스크립트로 들어왔지만 카페24 주문 API 로 확인되지 않은 주문입니다. 검증 전까지 정산에서 제외됩니다.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(['unverified', 'failed'] as const).map(k => (
            <button
              key={k}
              onClick={() => setVerification(k)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black ${
                verification === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {k === 'unverified' ? '미검증' : '확인 실패'}
            </button>
          ))}
          <button onClick={() => load(0)} className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200" title="새로고침">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="p-3"><ErrorBar message={error} /></div>}

      <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
        <div className="col-span-2">주문번호</div>
        <div className="col-span-3">캠페인</div>
        <div className="col-span-2">인플루언서</div>
        <div className="col-span-1 text-right">금액</div>
        <div className="col-span-2">사유</div>
        <div className="col-span-2 text-right">재검증</div>
      </div>
      <div className="divide-y divide-slate-50">
        {!loading && orders.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm font-bold">
            {verification === 'unverified' ? '미검증 주문이 없습니다.' : '확인 실패 주문이 없습니다.'}
          </div>
        ) : orders.map(o => (
          <div key={o.id} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-slate-50/50 space-y-1 md:space-y-0">
            <div className="md:col-span-2 min-w-0">
              <p className="font-black text-slate-900 text-xs font-mono truncate">{o.orderNo}</p>
              <p className="text-[10px] font-bold text-slate-400">{fmtDateTime(o.orderedAt)}</p>
            </div>
            <div className="md:col-span-3 min-w-0">
              <p className="text-xs font-bold text-slate-700 truncate">{o.campaignTitle}</p>
              <p className="text-[10px] font-bold text-slate-400">{COMMISSION_STATUS_LABEL[o.commissionStatus] || o.commissionStatus}</p>
            </div>
            <div className="md:col-span-2 text-xs font-bold text-blue-600 truncate">@{o.influencerUsername}</div>
            <div className="md:col-span-1 md:text-right text-xs font-black text-slate-900">{won(o.commissionBase)}</div>
            <div className="md:col-span-2 text-[11px] font-bold text-slate-500 break-words">{o.reason || '-'}</div>
            <div className="md:col-span-2 flex flex-col md:items-end">
              <button
                onClick={() => reverify(o)}
                disabled={busyId !== null || o.verification === 'verified'}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-[11px] font-black disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busyId === o.id ? 'animate-spin' : ''}`} />
                {o.verification === 'verified' ? '검증됨' : '재검증'}
              </button>
              {resultMsg[o.id] && (
                <p className={`text-[10px] font-bold mt-0.5 ${o.verification === 'verified' ? 'text-green-600' : 'text-red-500'}`}>{resultMsg[o.id]}</p>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="p-6 text-center text-slate-400 text-sm font-bold">불러오는 중...</div>}
      </div>
      {hasMore && !loading && (
        <button onClick={() => load(orders.length)} className="w-full py-2.5 border-t border-slate-100 text-[11px] font-black text-slate-500 hover:bg-slate-50">
          더 보기
        </button>
      )}
    </div>
  );
};

export default AdminAffiliateConsole;
