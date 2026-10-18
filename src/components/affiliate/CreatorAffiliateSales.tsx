import React, { useCallback, useEffect, useState } from 'react';
import {
  affiliateService,
  won,
  CREATOR_PAYOUT_NOTICE,
  COMMISSION_STATUS_LABEL,
  waitingText,
  clickText,
  PARTICIPATION_STATUS_LABEL,
  type AffiliateOrder,
  type AffiliateStats,
  type CommissionStatus,
  type Participation,
  type PayoutAccount,
} from '../../services/affiliateService';
import { copyText } from '../../utils/clipboard';
import Toast from '../Toast';

/**
 * 협업 캠페인 › 어필리에이트 — 인플루언서의 판매 연동형 캠페인 작업대.
 *
 * 네 칸으로 나눈다.
 *   링크      참여 중인 캠페인과, 승인된 캠페인의 상품별 추적 링크(/go/{code}).
 *             링크를 복사해 링크 관리의 상품 링크 · 스토리 · DM 에 붙인다.
 *   성과      상품별 클릭 · 주문 · 수수료(예정 / 확정 / 정산 완료).
 *   주문      내 링크로 들어온 주문과 수수료 상태. 주문번호는 서버가 일부를 가려 보낸다.
 *   지급 정보  성명 · 주민등록번호 · 계좌. 원천징수(3.3%) 신고와 월 정산금 입금에 쓰인다.
 *
 * 수수료는 모두 "내 몫"이다. 브랜드가 내는 총 수수료와 플랫폼 몫은 이 화면에 오지 않는다.
 * 월 정산 결과(지급 예정 · 지급 완료)는 정산금 화면(UserSettlement)에 광고비와 함께 뜬다.
 */

interface CreatorAffiliateSalesProps {
  userName: string;
}

type Section = 'links' | 'stats' | 'orders' | 'payout';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'links', label: '판매 링크' },
  { key: 'stats', label: '성과' },
  { key: 'orders', label: '주문' },
  { key: 'payout', label: '지급 정보' },
];

const PARTICIPATION_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-600',
  revoked: 'bg-slate-200 text-slate-600',
  cancelled: 'bg-slate-100 text-slate-500',
};

const COMMISSION_BADGE: Record<CommissionStatus, string> = {
  pending: 'bg-blue-50 text-blue-600',
  confirmed: 'bg-emerald-50 text-emerald-600',
  excluded: 'bg-slate-100 text-slate-400',
  settled: 'bg-violet-50 text-violet-600',
  unverified: 'bg-amber-50 text-amber-600',
};

const ORDER_FILTERS: { value: CommissionStatus | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: COMMISSION_STATUS_LABEL.pending },
  { value: 'confirmed', label: COMMISSION_STATUS_LABEL.confirmed },
  { value: 'settled', label: COMMISSION_STATUS_LABEL.settled },
  { value: 'excluded', label: COMMISSION_STATUS_LABEL.excluded },
  { value: 'unverified', label: COMMISSION_STATUS_LABEL.unverified },
];

const ORDER_PAGE = 20;

const fmtDate = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const inputCls =
  'w-full text-sm font-medium border border-slate-200 rounded-xl px-3 py-2.5 bg-white focus:outline-none focus:border-slate-400 transition-colors';

const CreatorAffiliateSales: React.FC<CreatorAffiliateSalesProps> = () => {
  const [section, setSection] = useState<Section>('links');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => setToast({ message, type }), []);

  // ── 참여 · 링크 ──────────────────────────────────────────────────────
  const [participations, setParticipations] = useState<Participation[]>([]);
  const [partLoading, setPartLoading] = useState(true);
  const [partError, setPartError] = useState('');
  const [busyId, setBusyId] = useState('');

  const loadParticipations = useCallback(async () => {
    setPartLoading(true);
    setPartError('');
    const res = await affiliateService.myParticipations();
    if (res.error) setPartError(res.error);
    else setParticipations(Array.isArray(res.participations) ? res.participations : []);
    setPartLoading(false);
  }, []);

  useEffect(() => { void loadParticipations(); }, [loadParticipations]);

  const replaceParticipation = (next: Participation) =>
    setParticipations(prev => prev.map(p => (p.id === next.id ? { ...p, ...next, campaign: next.campaign || p.campaign, links: next.links || p.links } : p)));

  const cancelParticipation = async (p: Participation) => {
    const ask = p.status === 'approved'
      ? '판매를 중단할까요? 내 링크는 더 이상 추적되지 않고 상품 페이지로만 연결됩니다. 이미 들어온 주문의 수수료는 그대로 정산됩니다.'
      : '참여 신청을 취소할까요?';
    if (!confirm(ask)) return;
    setBusyId(p.id);
    const res = await affiliateService.updateMyParticipation(p.id, 'cancel');
    setBusyId('');
    if (res.error || !res.participation) {
      notify(res.error || '처리하지 못했습니다.', 'error');
      return;
    }
    replaceParticipation(res.participation);
    notify(p.status === 'approved' ? '판매를 중단했습니다.' : '신청을 취소했습니다.');
  };

  const copyLink = async (url: string) => {
    const ok = await copyText(url);
    notify(ok ? '링크를 복사했어요. 공유할 때 광고 표기를 함께 해 주세요.' : `복사하지 못했어요: ${url}`, ok ? 'success' : 'error');
  };

  // ── 성과 ───────────────────────────────────────────────────────────
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    const res = await affiliateService.getStats('creator');
    if (res.error) setStatsError(res.error);
    else setStats({ totals: res.totals, byProduct: Array.isArray(res.byProduct) ? res.byProduct : [], waiting: res.waiting });
    setStatsLoading(false);
  }, []);

  // ── 주문 ───────────────────────────────────────────────────────────
  const [orders, setOrders] = useState<AffiliateOrder[]>([]);
  const [orderFilter, setOrderFilter] = useState<CommissionStatus | 'all'>('all');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [ordersHasMore, setOrdersHasMore] = useState(false);

  const loadOrders = useCallback(async (offset = 0) => {
    setOrdersLoading(true);
    setOrdersError('');
    const res = await affiliateService.listOrders('creator', { status: orderFilter, limit: ORDER_PAGE, offset });
    if (res.error) {
      setOrdersError(res.error);
    } else {
      const list = Array.isArray(res.orders) ? res.orders : [];
      setOrders(prev => (offset === 0 ? list : [...prev, ...list]));
      setOrdersHasMore(!!res.hasMore);
    }
    setOrdersLoading(false);
  }, [orderFilter]);

  // ── 지급 정보 ───────────────────────────────────────────────────────
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [form, setForm] = useState({ legalName: '', rrn: '', bankName: '', accountNumber: '' });
  const [saving, setSaving] = useState(false);

  const loadAccount = useCallback(async () => {
    const res = await affiliateService.getPayoutAccount();
    if (res.error) notify(res.error, 'error');
    const a = res.account || null;
    setAccount(a);
    // 주민등록번호는 서버가 돌려주지 않는다 — 칸은 비워 두고 가린 값만 안내한다.
    setForm({ legalName: a?.legalName || '', rrn: '', bankName: a?.bankName || '', accountNumber: a?.accountNumber || '' });
    setAccountLoaded(true);
  }, [notify]);

  // 칸을 처음 열 때 읽는다. 성과 · 주문은 열 때마다 새로 읽는다(주문 확정이 수시로 바뀐다).
  useEffect(() => {
    if (section === 'stats') void loadStats();
    if (section === 'orders') void loadOrders(0);
    if (section === 'payout' && !accountLoaded) void loadAccount();
  }, [section, loadStats, loadOrders, loadAccount, accountLoaded]);

  /**
   * 지급 정보 저장 — 성명 · 주민등록번호 · 계좌만 받는다(신분증 사본은 받지 않는다).
   * 이미 낸 적이 있으면 주민등록번호 칸을 비워 둔 채 계좌만 고칠 수 있다.
   */
  const saveAccount = async () => {
    const rrnDigits = form.rrn.replace(/[^0-9]/g, '');
    const hasRrn = Boolean(account?.rrnMasked && !account.prefilled);
    if (!form.legalName.trim()) { notify('성명을 입력해 주세요.', 'error'); return; }
    if (!hasRrn && rrnDigits.length !== 13) { notify('주민등록번호 13자리를 입력해 주세요.', 'error'); return; }
    if (rrnDigits && rrnDigits.length !== 13) { notify('주민등록번호 13자리를 확인해 주세요.', 'error'); return; }
    if (!form.bankName.trim()) { notify('은행명을 입력해 주세요.', 'error'); return; }
    if (form.accountNumber.replace(/[^0-9]/g, '').length < 6) { notify('계좌번호를 확인해 주세요.', 'error'); return; }

    setSaving(true);
    const res = await affiliateService.savePayoutAccount({
      legalName: form.legalName.trim(),
      rrn: rrnDigits,
      bankName: form.bankName.trim(),
      accountNumber: form.accountNumber.trim(),
    });
    setSaving(false);
    if (res.error || !res.account) {
      notify(res.error || '저장하지 못했습니다.', 'error');
      return;
    }
    setAccount(res.account);
    setForm(f => ({ ...f, rrn: '' }));
    notify('지급 정보를 저장했어요.');
  };

  // ────────────────────────────────────────────────────────────── 화면
  const spinner = (label: string) => (
    <div className="text-center py-14">
      <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-sm text-slate-400 font-bold">{label}</p>
    </div>
  );

  const errorBox = (message: string, retry: () => void) => (
    <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
      <p className="text-sm text-slate-500 font-bold mb-3">{message}</p>
      <button onClick={retry} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-700">
        다시 시도
      </button>
    </div>
  );

  const renderLinks = () => {
    if (partLoading && participations.length === 0) return spinner('참여 중인 캠페인 불러오는 중...');
    if (partError) return errorBox(partError, loadParticipations);
    if (participations.length === 0) {
      return (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 md:p-12 text-center">
          <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-3">🔗</div>
          <h3 className="text-base font-black text-slate-900 mb-1">참여 중인 판매 캠페인이 없습니다</h3>
          <p className="text-sm text-slate-400 font-medium">캠페인 메뉴의 어필리에이트에서 상품을 골라 참여해 보세요.</p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {participations.map(p => {
          const c = p.campaign;
          const approved = p.status === 'approved';
          const links = p.links || [];
          return (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${PARTICIPATION_BADGE[p.status] || 'bg-slate-100 text-slate-500'}`}>
                      {PARTICIPATION_STATUS_LABEL[p.status] || p.status}
                    </span>
                    {c && <span className="text-[10px] font-black text-violet-600">수수료 {c.creatorRate}%</span>}
                  </div>
                  <h4 className="text-sm font-black text-slate-900 mt-1.5 truncate">{c?.title || '판매 캠페인'}</h4>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5 truncate">
                    {c?.companyName}
                    {c && (c.startDate || c.endDate) && ` · ${fmtDate(c.startDate)} ~ ${c.endDate ? fmtDate(c.endDate) : '상시'}`}
                  </p>
                </div>
                {(p.status === 'pending' || approved) && (
                  <button
                    type="button"
                    onClick={() => cancelParticipation(p)}
                    disabled={busyId === p.id}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                  >
                    {approved ? '판매 중단' : '신청 취소'}
                  </button>
                )}
              </div>

              {p.status === 'pending' && (
                <p className="text-[11px] text-amber-600 font-bold mt-3 bg-amber-50 rounded-xl px-3 py-2">
                  브랜드가 신청을 확인하고 있어요. 승인되면 여기에 판매 링크가 생깁니다.
                </p>
              )}
              {(p.status === 'rejected' || p.status === 'revoked') && p.rejectReason && (
                <p className="text-[11px] text-slate-500 font-bold mt-3 bg-slate-50 rounded-xl px-3 py-2">사유: {p.rejectReason}</p>
              )}

              {approved && (
                <>
                  {/* 개인페이지에 따로 판매 칸을 두지 않는다. 링크를 복사해 링크 관리의 상품
                      링크나 스토리 · DM 에 붙이면, 어디서 눌러도 클릭과 주문이 추적된다. */}
                  <p className="mt-3 text-[11px] text-slate-500 font-bold bg-slate-50 rounded-xl px-3 py-2.5 leading-relaxed">
                    링크를 복사해 <span className="text-slate-800">링크 관리</span>의 상품 링크나 스토리 · DM 에 붙여 주세요.
                    이 링크로 들어온 클릭과 주문이 내 판매로 집계됩니다.
                  </p>

                  <div className="mt-3 space-y-2">
                    {links.length === 0 ? (
                      <p className="text-[11px] text-slate-400 font-bold">아직 발급된 링크가 없습니다.</p>
                    ) : links.map(l => (
                      <div key={l.code} className="flex items-center gap-3 border border-slate-100 rounded-xl p-2.5">
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-50 flex-shrink-0">
                          {l.productImage && <img src={l.productImage} alt={l.productName} className="w-full h-full object-cover" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-slate-900 truncate">{l.productName}</p>
                          <p className="text-[10px] font-bold text-slate-400 truncate">
                            {won(l.price)}
                            {l.status !== 'active' && <span className="ml-1.5 text-rose-500">· {l.status === 'paused' ? '일시 중지' : '중단됨'}</span>}
                          </p>
                          <p className="text-[10px] font-medium text-blue-600 truncate">{l.url}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyLink(l.url)}
                          disabled={l.status === 'revoked'}
                          className="flex-shrink-0 px-3 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 disabled:opacity-40"
                        >
                          링크 복사
                        </button>
                      </div>
                    ))}
                  </div>
                  {c?.disclosureText && (
                    <p className="text-[10px] text-slate-400 font-bold mt-2 leading-relaxed">광고 표기: {c.disclosureText}</p>
                  )}
                </>
              )}
            </div>
          );
        })}
        <p className="text-[11px] text-slate-400 font-medium leading-relaxed px-1">
          링크를 누른 뒤 7일 안에 같은 기기에서 구매하면 내 판매로 집계돼요(마지막 클릭 기준).
          간편결제 등 일부 결제 방식은 추적되지 않을 수 있어요.
        </p>
      </div>
    );
  };

  const renderStats = () => {
    if (statsLoading && !stats) return spinner('성과 불러오는 중...');
    if (statsError) return errorBox(statsError, loadStats);
    const t = stats?.totals;
    const rows = stats?.byProduct || [];
    const cards: { label: string; value: string; cls: string }[] = [
      { label: '클릭', value: clickText(t?.clicks || 0, t?.allClicks), cls: 'text-slate-900' },
      { label: '주문', value: (t?.orders || 0).toLocaleString('ko-KR'), cls: 'text-slate-900' },
      { label: '예정 수수료', value: won(t?.pendingFee || 0), cls: 'text-blue-600' },
      { label: '확정 수수료', value: won(t?.confirmedFee || 0), cls: 'text-emerald-600' },
      { label: '정산 완료', value: won(t?.settledFee || 0), cls: 'text-violet-600' },
    ];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          {cards.map(card => (
            <div key={card.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3.5">
              <p className="text-[10px] font-black text-slate-400">{card.label}</p>
              <p className={`text-base md:text-lg font-black mt-1 ${card.cls}`}>{card.value}</p>
            </div>
          ))}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3.5 md:hidden">
            <p className="text-[10px] font-black text-slate-400">판매액</p>
            <p className="text-base font-black mt-1 text-slate-900">{won(t?.sales || 0)}</p>
          </div>
        </div>

        {(stats?.waiting?.orders || 0) > 0 && (
          <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-3.5 py-2.5 leading-relaxed">
            {waitingText(stats!.waiting!)}
          </p>
        )}

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h4 className="text-sm font-black text-slate-900">상품별 성과</h4>
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-slate-400 font-bold text-center py-10">아직 집계된 클릭 · 주문이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[560px]">
                <thead className="bg-slate-50 text-[10px] font-black text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-2.5">상품</th>
                    <th className="text-right px-3 py-2.5">클릭</th>
                    <th className="text-right px-3 py-2.5">주문</th>
                    <th className="text-right px-3 py-2.5">예정 수수료</th>
                    <th className="text-right px-3 py-2.5">확정 수수료</th>
                    <th className="text-right px-4 py-2.5">정산 완료</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => (
                    <tr key={r.key}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {r.imageUrl && <img src={r.imageUrl} alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0" />}
                          <span className="font-bold text-slate-800 truncate max-w-[180px]">{r.label}</span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-2.5 font-bold text-slate-700">{r.clicks.toLocaleString('ko-KR')}</td>
                      <td className="text-right px-3 py-2.5 font-bold text-slate-700">
                        {r.orders.toLocaleString('ko-KR')}
                        {r.cancelled > 0 && <span className="text-[10px] text-slate-400 ml-1">(취소 {r.cancelled})</span>}
                      </td>
                      <td className="text-right px-3 py-2.5 font-bold text-blue-600">{won(r.pendingFee)}</td>
                      <td className="text-right px-3 py-2.5 font-bold text-emerald-600">{won(r.confirmedFee)}</td>
                      <td className="text-right px-4 py-2.5 font-bold text-violet-600">{won(r.settledFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-400 font-medium leading-relaxed px-1">
          예정은 주문이 들어왔지만 아직 구매가 확정되지 않은 수수료예요. 구매확정(또는 배송완료 후 일정 기간)이 지나면
          확정으로 바뀌고, 취소 · 반품된 주문은 제외돼요. 확정 수수료는 매달 모아 다음 달 말일에 지급합니다.
        </p>
      </div>
    );
  };

  const renderOrders = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
        {ORDER_FILTERS.map(f => (
          <button
            key={f.value}
            type="button"
            onClick={() => setOrderFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-black whitespace-nowrap transition-colors ${
              orderFilter === f.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {ordersError ? (
        errorBox(ordersError, () => loadOrders(0))
      ) : ordersLoading && orders.length === 0 ? (
        spinner('주문 불러오는 중...')
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-400 font-bold">아직 내 링크로 들어온 주문이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
          {orders.map(o => (
            <div key={o.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black flex-shrink-0 ${COMMISSION_BADGE[o.commissionStatus] || 'bg-slate-100 text-slate-500'}`}>
                    {COMMISSION_STATUS_LABEL[o.commissionStatus] || o.commissionStatus}
                  </span>
                  <span className="text-xs font-black text-slate-900 truncate">{o.campaignTitle}</span>
                </div>
                <p className="text-[11px] text-slate-400 font-bold mt-1">
                  {fmtDate(o.orderedAt)} · 주문 {o.orderNo} · 결제 {won(o.commissionBase)}
                  {o.refundedAmount > 0 && <span className="text-rose-500"> · 환불 {won(o.refundedAmount)}</span>}
                </p>
                {o.reason && <p className="text-[10px] text-slate-400 font-medium mt-0.5">{o.reason}</p>}
              </div>
              <p className={`text-sm font-black flex-shrink-0 ${o.commissionStatus === 'excluded' ? 'text-slate-300 line-through' : 'text-slate-900'}`}>
                {won(o.fee)}
              </p>
            </div>
          ))}
        </div>
      )}
      {ordersHasMore && !ordersError && (
        <button
          type="button"
          onClick={() => loadOrders(orders.length)}
          disabled={ordersLoading}
          className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-black text-slate-600 hover:border-slate-300 disabled:opacity-50"
        >
          {ordersLoading ? '불러오는 중...' : '더 보기'}
        </button>
      )}
    </div>
  );

  const renderPayout = () => {
    if (!accountLoaded) return spinner('지급 정보 불러오는 중...');
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-xs font-black text-blue-800 mb-1">판매 수수료는 이렇게 지급돼요</p>
          <ul className="text-[11px] text-blue-700 font-bold leading-relaxed list-disc pl-4 space-y-0.5">
            <li>매달 확정된 수수료를 모아 다음 달 말일에 지급합니다.</li>
            <li>사업소득으로 원천징수 3.3%(소득세 3% + 지방소득세 0.3%)를 뗀 금액이 입금돼요.</li>
            <li>원천징수 신고에 성명과 주민등록번호가 필요해요. 계좌 예금주는 입력한 성명과 같아야 해요 — 다르면 은행에서 반송됩니다.</li>
            <li>주민등록번호는 암호화해 보관하고, 지급 · 신고 때만 픽스폴리오 담당자가 확인합니다.</li>
          </ul>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-5 space-y-3">
          {account?.prefilled && (
            <p className="text-[11px] font-bold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              협업 정산에서 제출한 정보를 불러왔어요. 확인 후 저장해야 판매 수수료 지급에 쓰입니다.
            </p>
          )}
          {account?.submittedAt && !account.prefilled && (
            <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
              {fmtDate(account.submittedAt)}에 제출했어요. 바꾸면 다음 지급부터 새 계좌로 보내 드려요.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[10px] font-black text-slate-500 mb-1">성명</span>
              <input
                value={form.legalName}
                onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
                placeholder="실명 (예금주와 같게)"
                autoComplete="name"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="block text-[10px] font-black text-slate-500 mb-1">주민등록번호</span>
              <input
                value={form.rrn}
                onChange={e => setForm(f => ({ ...f, rrn: e.target.value.replace(/[^0-9-]/g, '').slice(0, 14) }))}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder={account?.rrnMasked && !account.prefilled ? `${account.rrnMasked} (바꿀 때만 입력)` : '- 없이 13자리'}
                className={inputCls}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[10px] font-black text-slate-500 mb-1">은행</span>
              <input
                value={form.bankName}
                onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                placeholder="예: 국민은행"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="block text-[10px] font-black text-slate-500 mb-1">계좌번호</span>
              <input
                value={form.accountNumber}
                onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))}
                inputMode="numeric"
                placeholder="- 없이 숫자만"
                className={inputCls}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={saveAccount}
            disabled={saving}
            className="w-full bg-slate-900 text-white py-3 rounded-xl font-black text-sm hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? '저장하는 중...' : '지급 정보 저장'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 font-medium leading-relaxed px-1">
          지급 예정 · 지급 완료 내역은 정산금 화면에서 광고비 정산과 함께 볼 수 있어요.
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
        <p className="text-xs font-black text-blue-800">판매 수수료 지급일: 다음 달 말일</p>
        <p className="text-[11px] font-bold text-blue-700 leading-relaxed mt-0.5 break-keep">
          {CREATOR_PAYOUT_NOTICE} 예를 들어 3월에 확정된 수수료는 4월 말일에 원천징수 3.3%를 뗀 금액으로 입금돼요.
        </p>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
        {SECTIONS.map(s => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-black whitespace-nowrap transition-colors border ${
              section === s.key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'links' && renderLinks()}
      {section === 'stats' && renderStats()}
      {section === 'orders' && renderOrders()}
      {section === 'payout' && renderPayout()}

      <Toast
        message={toast?.message || ''}
        isVisible={!!toast}
        onClose={() => setToast(null)}
        type={toast?.type || 'success'}
      />
    </div>
  );
};

export default CreatorAffiliateSales;
