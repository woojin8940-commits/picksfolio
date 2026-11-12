import React, { useCallback, useEffect, useState } from 'react';
import { affiliateStoreService } from '../../services/affiliateStoreService';
import { affiliatePayoutService } from '../../services/affiliatePayoutService';

/**
 * 운영자 홈 맨 위 "지금 처리할 일". 어필리에이트가 굴러가는 순서대로
 * (크리에이터 승인 → 브랜드 입점 → 선정 조율 → 취소·반품 → 지급) 손이 필요한 건수만 보여 주고,
 * 카드를 누르면 그 탭으로 간다. 0건인 칸은 흐리게 둬서 급한 것만 눈에 띄게 한다.
 */
type TodoKey = 'creator-applications' | 'affiliate-store' | 'affiliate-selections' | 'affiliate-issues' | 'affiliate-payouts';

interface Props {
  token: string;
  onNavigate: (tab: TodoKey) => void;
  /** 바깥에서 새로고침을 누르면 바뀌는 값. 바뀌면 다시 센다. */
  refreshKey?: number;
}

const STEPS: { key: TodoKey; step: string; title: string; hint: string; unit: string }[] = [
  { key: 'creator-applications', step: '1', title: '크리에이터 지원', hint: '승인해야 어필리에이트를 쓸 수 있어요', unit: '명 대기' },
  { key: 'affiliate-store', step: '2', title: '브랜드 입점 신청', hint: '승인하면 상품을 올릴 수 있어요', unit: '건 대기' },
  { key: 'affiliate-selections', step: '3', title: '새 선정 · 조율', hint: '브랜드가 선정 — 양쪽에 연락해 조율해요', unit: '건 새로' },
  { key: 'affiliate-issues', step: '4', title: '미처리 취소·반품', hint: '3영업일 넘게 처리되지 않은 반품', unit: '건' },
  { key: 'affiliate-payouts', step: '5', title: '지급 신청', hint: '브랜드 · 인플루언서 정산 지급 대기', unit: '건 대기' },
];

const AdminAffiliateTodo: React.FC<Props> = ({ token, onNavigate, refreshKey }) => {
  const [counts, setCounts] = useState<Partial<Record<TodoKey, number>>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [creators, stores, selections, issues, payouts] = await Promise.all([
      affiliateStoreService.listCreatorApplications(token),
      affiliateStoreService.listApplications(token),
      affiliateStoreService.selectionsNewCount(token),
      affiliateStoreService.adminIssues(token),
      affiliatePayoutService.adminList(token, { status: 'requested' }),
    ]);
    setCounts({
      'creator-applications': creators.error ? undefined : (creators.applications || []).filter((a) => a.status === 'pending').length,
      'affiliate-store': stores.error ? undefined : (stores.applications || []).filter((a) => a.status === 'pending').length,
      'affiliate-selections': selections.error ? undefined : selections.newCount || 0,
      'affiliate-issues': issues.error ? undefined : (issues.returns || []).length,
      'affiliate-payouts': payouts.error ? undefined : (payouts.requests || []).length,
    });
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const total = Object.values(counts).reduce<number>((s, n) => s + (n || 0), 0);

  return (
    <div className="space-y-2.5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">지금 처리할 일 · 어필리에이트</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">
            {loading ? '건수를 세는 중...' : total > 0 ? `손이 필요한 일이 ${total}건 있어요. 카드를 누르면 바로 이동해요.` : '지금 밀린 일이 없어요.'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {STEPS.map((s) => {
          const n = counts[s.key];
          const hot = !loading && (n || 0) > 0;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onNavigate(s.key)}
              className={`text-left rounded-2xl border p-4 transition-all hover:shadow-md ${
                hot ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-5 h-5 rounded-md text-[10px] font-black flex items-center justify-center ${hot ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'}`}>{s.step}</span>
                <p className="text-[11px] font-black text-slate-700 truncate">{s.title}</p>
              </div>
              <p className={`text-2xl font-black mt-2 ${hot ? 'text-amber-600' : 'text-slate-300'}`}>
                {loading ? '…' : n === undefined ? '-' : n}
                {!loading && n !== undefined && <span className="text-[11px] font-black ml-1">{s.unit}</span>}
              </p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 leading-snug">{n === undefined && !loading ? '불러오지 못했어요' : s.hint}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AdminAffiliateTodo;
