import React from 'react';
import { formatKRW, formatSignedKRW } from '../../utils/formatters';

/**
 * 전체 현황 — 운영자가 대시보드를 열자마자 답이 필요한 세 가지만 위에 둔다.
 *
 *   1) 브랜드 매칭에 지원한 인플루언서가 몇 명이고 어디까지 검토됐는지
 *   2) 픽스폴리오에 가입한 계정이 몇 개인지
 *   3) 광고비가 들어가는 캠페인의 예산과 우리 수익이 얼마인지
 *
 * 숫자를 그냥 늘어놓지 않고 "지금 손이 필요한 값"(검토 대기, 승인 대기)은 눌러서
 * 해당 탭으로 넘어가게 했다. 대시보드에서 숫자만 보고 다시 탭을 찾아 헤매면
 * 현황판이 아니라 보고서가 된다.
 *
 * 집계는 /api/admin/operator-overview 한 번으로 받는다(부모가 받아서 내려준다).
 */

interface Props {
  data: any | null;
  loading?: boolean;
  onNavigate?: (tab: string) => void;
}

/** 팔로워처럼 자릿수가 큰 수는 만/억으로 줄여 읽는다. */
const compact = (n: number) => {
  const v = Number(n || 0);
  if (v >= 100000000) return `${(v / 100000000).toFixed(v % 100000000 === 0 ? 0 : 1)}억`;
  if (v >= 10000) return `${(v / 10000).toFixed(v % 10000 === 0 ? 0 : 1)}만`;
  return v.toLocaleString();
};

/**
 * 마진 자리에 쓰는 금액. 지급액이 제시가를 넘으면 음수가 나오는데 formatKRW 는
 * 부호를 버려서 손해가 이익으로 읽힌다. 예산처럼 음수가 없는 값에는 쓰지 않는다.
 */
const money = (n: unknown) => {
  const v = Number(n || 0);
  return v < 0 ? formatSignedKRW(v) : formatKRW(v);
};

const Card: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'dark' | 'blue' | 'amber' | 'green' | 'plain' | 'pink';
  onClick?: () => void;
}> = ({ label, value, sub, tone = 'plain', onClick }) => {
  const palette: Record<string, string> = {
    dark: 'bg-gradient-to-br from-slate-900 to-slate-700 text-white border-transparent',
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    green: 'bg-green-50 border-green-100 text-green-700',
    pink: 'bg-pink-50 border-pink-100 text-pink-700',
    plain: 'bg-white border-slate-100 text-slate-900',
  };
  const labelTone = tone === 'dark' ? 'text-white/60' : 'text-slate-400';
  const subTone = tone === 'dark' ? 'text-white/50' : 'text-slate-400';
  const body = (
    <>
      <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${labelTone}`}>{label}</p>
      <p className="text-xl font-black leading-tight">{value}</p>
      {sub && <p className={`text-[9px] font-bold mt-1 ${subTone}`}>{sub}</p>}
    </>
  );
  const shell = `${palette[tone]} border rounded-2xl p-3.5 text-left w-full`;
  if (onClick) {
    return (
      <button onClick={onClick} className={`${shell} hover:shadow-md transition-all cursor-pointer`}>
        {body}
      </button>
    );
  }
  return <div className={shell}>{body}</div>;
};

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, hint, children, action }) => (
  <div className="space-y-2.5">
    <div className="flex items-end justify-between gap-2">
      <div>
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        {hint && <p className="text-[10px] font-bold text-slate-400 mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

const DIR_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '검토 대기', cls: 'bg-amber-100 text-amber-700' },
  reviewed: { label: '검토 완료', cls: 'bg-blue-100 text-blue-700' },
  contacted: { label: '연락함', cls: 'bg-green-100 text-green-700' },
  archived: { label: '보류', cls: 'bg-slate-100 text-slate-500' },
};

const AdminOperatorOverview: React.FC<Props> = ({ data, loading, onNavigate }) => {
  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
        <div className="w-7 h-7 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-xs font-bold text-slate-400">현황 집계 중...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
        <p className="text-sm font-bold text-slate-400">현황을 집계하지 못했습니다.</p>
        <p className="text-xs font-bold text-slate-300 mt-1">새로고침을 눌러 다시 시도해 주세요.</p>
      </div>
    );
  }

  const accounts = data.accounts || {};
  const dir = data.directory?.influencer || {};
  const brandDir = data.directory?.brand || {};
  const campaigns = data.campaigns || {};
  const funnel = data.funnel || {};
  const collabs = data.collabs || {};
  const profit = data.campaignProfit || {};
  const confirmed = profit.confirmed || {};
  const pipeline = profit.pipeline || {};
  const unknown = profit.marginUnknown || {};
  const recent = Array.isArray(data.directory?.recent) ? data.directory.recent : [];

  return (
    <div className="space-y-6">
      {/* 1. 가입 계정 */}
      <Section
        title="픽스폴리오 가입 계정"
        hint={accounts.available === false
          ? '계정 집계를 불러오지 못했습니다. 나머지 수치는 정상입니다.'
          : '인플루언서와 비즈니스 계정을 합한 전체 가입 수입니다.'}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card tone="dark" label="전체 계정" value={`${(accounts.total || 0).toLocaleString()}개`} sub={`오늘 +${accounts.today || 0}`} />
          <Card label="인플루언서" value={`${(accounts.influencers || 0).toLocaleString()}명`} />
          <Card label="비즈니스" value={`${(accounts.businesses || 0).toLocaleString()}개`} />
          <Card tone="blue" label="최근 7일 가입" value={`+${accounts.last7d || 0}`} />
          <Card label="최근 30일 가입" value={`+${accounts.last30d || 0}`} />
        </div>
      </Section>

      {/* 2. 브랜드 매칭 지원 인플루언서 */}
      <Section
        title="브랜드 매칭 지원 인플루언서"
        hint="브랜드 매칭 받기에 지원한 인플루언서의 검토 진행 상황입니다."
        action={onNavigate && (
          <button onClick={() => onNavigate('directory')} className="text-[10px] font-black text-blue-600 hover:underline shrink-0">
            지원자 목록 →
          </button>
        )}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card tone="dark" label="지원 인플루언서" value={`${(dir.total || 0).toLocaleString()}명`} sub={`최근 7일 +${dir.recent7d || 0}`} />
          <Card
            tone="amber"
            label="검토 대기"
            value={`${dir.pending || 0}명`}
            sub={onNavigate ? '눌러서 검토하기' : undefined}
            onClick={onNavigate ? () => onNavigate('directory') : undefined}
          />
          <Card tone="blue" label="검토 완료" value={`${dir.reviewed || 0}명`} />
          <Card tone="green" label="연락함" value={`${dir.contacted || 0}명`} />
          <Card label="지표 연동" value={`${dir.withFollowers || 0}명`} sub={`평균 팔로워 ${compact(data.directory?.avgFollowers || 0)}`} />
          <Card label="브랜드 지원" value={`${brandDir.total || 0}개`} sub={`대기 ${brandDir.pending || 0}`} />
        </div>

        {recent.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">최근 지원</p>
              <span className="text-[10px] font-bold text-slate-300">최신 {recent.length}건</span>
            </div>
            <div className="divide-y divide-slate-50">
              {recent.map((r: any) => {
                const meta = DIR_STATUS[r.status] || DIR_STATUS.pending;
                return (
                  <div key={r.id} className="px-4 py-2 flex items-center gap-3">
                    <span className={`${meta.cls} px-1.5 py-0.5 rounded text-[9px] font-black shrink-0`}>{meta.label}</span>
                    {/* 계정이 먼저다 — 지원자를 다시 찾는 단서는 이름이 아니라 계정이다. */}
                    <p className="text-[11px] font-black text-slate-900 truncate">@{r.username}</p>
                    <p className="text-[10px] font-bold text-slate-400 truncate flex-1">
                      {r.name || ''}{r.name && r.category ? ' · ' : ''}{r.category || ''}
                    </p>
                    <p className="text-[10px] font-black text-slate-600 shrink-0">
                      {r.followers > 0 ? `팔로워 ${compact(r.followers)}` : '지표 미연동'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* 3. 캠페인 예산 · 수익 */}
      <Section
        title="캠페인 예산 · 수익"
        hint="광고비가 들어오는 캠페인의 예산과, 브랜드 제시가에서 인플루언서 단가를 뺀 우리 순수익입니다."
        action={onNavigate && (
          <button onClick={() => onNavigate('collabs')} className="text-[10px] font-black text-blue-600 hover:underline shrink-0">
            캠페인 관리 →
          </button>
        )}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Card tone="dark" label="총 캠페인 예산" value={formatKRW(campaigns.budgetTotal || 0)} sub={`캠페인 ${campaigns.total || 0}건 · 최근 30일 +${campaigns.recent30d || 0}`} />
          <Card tone="green" label="모집중 예산" value={formatKRW(campaigns.activeBudget || 0)} sub={`${campaigns.active || 0}건 진행`} />
          <Card
            tone="amber"
            label="승인 대기"
            value={`${campaigns.pendingApproval || 0}건`}
            sub={`예산 ${formatKRW(campaigns.pendingBudget || 0)}`}
            onClick={onNavigate ? () => onNavigate('campaigns') : undefined}
          />
          <Card
            tone="pink"
            label="확정 순수익"
            value={money(confirmed.margin)}
            sub={`수락 ${confirmed.count || 0}건 중 단가 확정 ${confirmed.pricedCount || 0}건`}
          />
          <Card
            tone="blue"
            label="예상 순수익"
            value={money(pipeline.margin)}
            sub={`제안 발송 ${pipeline.count || 0}건 응답 대기`}
          />
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">브랜드 제시가 합계</p>
              <p className="text-base font-black text-slate-900">{formatKRW(confirmed.brandAmount || 0)}</p>
              <p className="text-[9px] font-bold text-slate-400">수락된 후보 기준</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">인플루언서 지급액</p>
              <p className="text-base font-black text-slate-600">{formatKRW(confirmed.influencerCost || 0)}</p>
              <p className="text-[9px] font-bold text-slate-400">우리가 인플루언서에게 줄 금액</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">차액(순수익)</p>
              <p className="text-base font-black text-pink-600">{money(confirmed.margin)}</p>
              <p className="text-[9px] font-bold text-slate-400">
                {confirmed.brandAmount > 0
                  ? `마진율 ${Math.round(((confirmed.margin || 0) / confirmed.brandAmount) * 100)}%`
                  : '제시가 입력 후 계산'}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">단가 미입력</p>
              <p className="text-base font-black text-amber-600">{(unknown.confirmed || 0) + (unknown.pipeline || 0)}건</p>
              <p className="text-[9px] font-bold text-slate-400">브랜드 제시가나 인플루언서 단가가 비어 집계 제외</p>
            </div>
          </div>
          {((unknown.confirmed || 0) + (unknown.pipeline || 0)) > 0 && (
            <p className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3">
              단가가 비어 있는 후보가 있어 순수익은 부분 집계입니다. 리스트업에서 브랜드 제시가를 입력하면 반영됩니다.
            </p>
          )}
        </div>
      </Section>

      {/* 4. 진행 퍼널 */}
      <Section title="캠페인 진행 퍼널" hint="리스트업 → 브랜드 선택 → 제안 → 수락 → 협업으로 이어지는 흐름입니다.">
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {[
              { label: '명단 등록', value: funnel.listed || 0, cls: 'text-slate-900' },
              { label: '브랜드 픽', value: funnel.picked || 0, cls: 'text-blue-600' },
              { label: '제안 발송', value: funnel.sent || 0, cls: 'text-indigo-600' },
              { label: '수락', value: funnel.accepted || 0, cls: 'text-green-600' },
              { label: '협업 진행', value: collabs.inProgress || 0, cls: 'text-amber-600' },
              { label: '협업 완료', value: collabs.completed || 0, cls: 'text-slate-500' },
            ].map(step => (
              <div key={step.label} className="bg-slate-50 rounded-xl p-2.5 text-center">
                <p className={`text-lg font-black ${step.cls}`}>{step.value}</p>
                <p className="text-[9px] font-bold text-slate-400">{step.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-bold text-slate-400 mt-2.5">
            거절 {funnel.declined || 0}건 · 만료 {funnel.expired || 0}건 · 브랜드 패스 {funnel.passed || 0}건
          </p>
        </div>
      </Section>
    </div>
  );
};

export default AdminOperatorOverview;
