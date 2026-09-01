import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKRW } from '../../utils/formatters';
import type { Settlement } from '../../types';

/**
 * 브랜드가 보는 정산 — 회차 하나에 한 번 보내는 돈.
 *
 * 브랜드는 인플루언서 스무 명에게 스무 번 송금하지 않는다. 픽스폴리오에 한 번 보내고,
 * 원천징수(3.3%)와 개별 지급은 픽스폴리오가 한다. 그런데 화면은 지급 기록이 사람마다
 * 쌓인다는 이유로 그대로 사람마다 그려져 있었다 — 브랜드는 자기 일이 아닌 지급 일정을
 * 인원수만큼 확인해야 했고, "이 사람에게는 아직 안 나갔다"를 자기 잘못으로 읽을 수밖에
 * 없었다.
 *
 * 그래서 사람이 아니라 회차로 묶는다. 회차의 기준은 지급 예정일이다 — 정산은 업로드가
 * 확인된 달의 익월 말일로 자동 예약되므로(서버 settlementDateFrom), 같은 달에 업로드가
 * 확인된 인플루언서들은 같은 날짜를 공유하고 그 날짜가 곧 브랜드가 한 번 보내는 회차다.
 *
 * 맨 위는 일괄 정산 총액과 "인플루언서에게 각각 보내지 않습니다"라는 설명이고, 그 아래에
 * 입금 예정 · 입금 완료 합계를 둔다. 회차 줄에는 금액과 상태, 그리고 인원 수를 남긴다 —
 * 인원 수는 청구 금액이 맞는지 대조할 근거이지, 누가 언제 얼마를 받는지가 아니다.
 *
 * 사람별 지급 상태와 금액은 담당자 화면에만 남는다. 서류를 받고 지급일을 잡고 입금하는
 * 것이 담당자의 일이다.
 */

interface BrandSettlementSummaryProps {
  /** 브랜드 계정 아이디. 'biz/' 접두사가 붙은 채로 넘어와도 된다. */
  businessUsername: string;
  /**
   * 이 캠페인의 정산만 남긴다. 비우면 브랜드 계정 전체 — 협업 현황의 정산 탭이
   * 그렇게 쓴다.
   *
   * 캠페인 ID 로 정산을 조회하는 API 는 없다. 정산 항목의 proposal_id 에 캠페인 ID 가
   * 들어 있어(`campaign_<캠페인>_<인플루언서>`) 그 값으로 골라낸다.
   */
  campaignId?: string;
}

/** 한 회차 — 같은 날 한 번 보내는 돈. */
type Round = {
  /** 지급 예정일(YYYY-MM-DD). 비면 아직 날짜가 잡히지 않은 묶음이다. */
  date: string;
  /** 이 회차에 포함된 인플루언서 수. 청구 금액을 대조할 근거로만 쓴다. */
  headcount: number;
  /** 금액이 확정된 건들의 합. */
  amount: number;
  /** 금액이 아직 조율 중인 건수(공동구매 수수료 등). */
  pendingCount: number;
  /** 이 회차가 전부 입금 완료됐는가. */
  paid: boolean;
};

/** 회차 라벨 — "2026년 3월 31일". 날짜가 없으면 아직 잡히지 않은 회차다. */
const roundLabel = (date: string) => {
  if (!date) return '지급일 미정';
  const [y, m, d] = date.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

/**
 * 금액이 아직 정해지지 않은 정산인지.
 *
 * 공동구매 수수료처럼 담당자가 조율해 정하는 금액은, 확정 전에 0원으로 그리면 보낼 것이
 * 없는 회차로 읽힌다.
 */
const isAmountPending = (s: Settlement) => Boolean(s.amount_pending) && !Number(s.amount || 0);

const BrandSettlementSummary: React.FC<BrandSettlementSummaryProps> = ({
  businessUsername,
  campaignId = '',
}) => {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 화면에 따라 'biz/브랜드' 꼴로 넘어온다. 정산 API 는 경로에 아이디를 넣으므로
      // 슬래시를 먼저 뗀다.
      const clean = String(businessUsername || '').replace(/^biz\//, '');
      if (!clean) {
        if (alive) setLoading(false);
        return;
      }
      const all = await apiService.getSettlements(clean, 'business');
      if (!alive) return;
      setRows(all.filter(s => !campaignId || String(s.proposal_id || '').includes(campaignId)));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [businessUsername, campaignId]);

  const { rounds, total, scheduledSum, completedSum, pendingCount, headcount } = useMemo(() => {
    const byDate = new Map<string, Round>();
    const people = new Set<string>();
    let total = 0;
    let scheduledSum = 0;
    let completedSum = 0;
    let pendingCount = 0;

    for (const s of rows) {
      const date = String(s.scheduled_date || '').slice(0, 10);
      const amount = Number(s.amount || 0);
      const paid = s.status === 'completed';
      const pending = isAmountPending(s);

      total += amount;
      if (paid) completedSum += amount;
      else scheduledSum += amount;
      if (pending) pendingCount += 1;
      people.add(String(s.influencer_username || '').toLowerCase());

      const round = byDate.get(date) || { date, headcount: 0, amount: 0, pendingCount: 0, paid: true };
      round.headcount += 1;
      round.amount += amount;
      if (pending) round.pendingCount += 1;
      // 한 건이라도 입금 전이면 회차는 아직 입금 전이다.
      if (!paid) round.paid = false;
      byDate.set(date, round);
    }

    // 가까운 회차가 위로. 날짜가 아직 없는 묶음은 맨 아래에 둔다.
    const rounds = [...byDate.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    return { rounds, total, scheduledSum, completedSum, pendingCount, headcount: people.size };
  }, [rows]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 맨 위 한 칸. 브랜드가 이 화면에서 확인하는 것은 "얼마를 어디로 보내는가" 하나다. */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <p className="text-[10px] font-black text-slate-400">일괄 정산 총액</p>
        <p className="text-2xl font-black text-slate-900 mt-1">{formatKRW(total)}</p>
        <p className="text-[11px] text-slate-500 font-bold mt-2 leading-relaxed">
          픽스폴리오에 한 번 보내시면 됩니다. 인플루언서에게 각각 보내지 않습니다.
        </p>
        {pendingCount > 0 && (
          <p className="text-[11px] text-amber-600 font-bold mt-1">
            금액 조율 중 {pendingCount}건이 총액에 아직 포함되지 않았습니다.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">입금 예정</p>
          <p className="text-lg font-black text-blue-600 mt-1">{formatKRW(scheduledSum)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">입금 완료</p>
          <p className="text-lg font-black text-emerald-600 mt-1">{formatKRW(completedSum)}</p>
        </div>
      </div>

      {rounds.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <p className="text-sm text-slate-500 font-bold">아직 정산 예정 내역이 없습니다</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1.5 leading-relaxed">
            정산은 담당자가 업로드를 확인한 뒤 예약됩니다.<br />
            지급일은 확인한 달의 다음 달 말일입니다.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
          <div className="px-4 py-3">
            <p className="text-[11px] font-black text-slate-900">정산 회차 {rounds.length}건</p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              같은 지급일의 협업이 한 회차로 묶입니다. 인원 수는 청구 금액을 대조할 때만 쓰입니다.
            </p>
          </div>
          {rounds.map(round => (
            <div key={round.date || 'undated'} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-900 truncate">{roundLabel(round.date)}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black flex-shrink-0 ${
                      round.paid ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                    }`}
                  >
                    {round.paid ? '입금 완료' : '입금 예정'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                  인플루언서 {round.headcount}명
                  {round.pendingCount > 0 && ` · 금액 조율 중 ${round.pendingCount}명`}
                </p>
              </div>
              <p className="text-sm font-black text-slate-900 flex-shrink-0">
                {round.amount > 0 ? (
                  formatKRW(round.amount)
                ) : (
                  /* 회차 전체가 아직 조율 중. 0원으로 그리면 보낼 것이 없는 회차로 읽힌다. */
                  <span className="text-amber-600">금액 조율 중</span>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        표시된 금액은 픽스폴리오로 입금하는 금액입니다{headcount > 0 && ` (인플루언서 ${headcount}명)`}. 인플루언서
        개별 지급과 원천징수(3.3%)는 픽스폴리오가 처리하며, 세금계산서는 입금 확인 후 발행됩니다. 지급일은 업로드가
        확인된 달의 다음 달 말일입니다.
      </p>
    </div>
  );
};

export default BrandSettlementSummary;
