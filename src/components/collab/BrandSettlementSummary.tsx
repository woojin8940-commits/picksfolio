import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import type { Settlement } from '../../types';

/**
 * 브랜드가 보는 정산 — 픽스폴리오에 한 번에 보내는 금액.
 *
 * 예전에는 이 자리에 인플루언서 한 명당 한 줄이 있었다("@daily_kim · 지급 예정 ·
 * 300,000원"). 지급 기록이 사람마다 쌓이니 화면도 그대로 사람마다 그린 것이었는데,
 * 그것은 픽스폴리오 안쪽의 사실이고 브랜드가 할 일과는 맞지 않는다. 브랜드는 인플루언서
 * 스무 명에게 스무 번 송금하지 않는다 — 픽스폴리오에 한 번 보내고, 원천징수(3.3%)와
 * 개별 지급은 픽스폴리오가 한다. 사람마다 지급 상태를 보여 주면 브랜드는 자기 일이
 * 아닌 일정 스무 개를 확인해야 하고, "이 사람에게는 아직 안 나갔다"를 자기 잘못으로
 * 읽는다.
 *
 * 그래서 사람이 아니라 회차로 묶는다. 정산 예정일은 "업로드가 확인된 달의 익월 말일"로
 * 자동으로 잡히므로, 같은 달에 확인된 인플루언서들은 같은 날짜를 공유한다 — 그 날짜가
 * 곧 브랜드가 한 번 보내는 회차다. 인원 수는 남긴다(청구 금액이 맞는지 대조할 근거가
 * 필요하다). 누가 언제 얼마를 받는지는 남기지 않는다.
 *
 * 화면을 읽기만 한다. 정산을 만들거나 금액을 고치는 것은 담당자의 일이고, 브랜드가
 * 직접 고칠 수 있게 두면 업로드 확인과 지급 근거가 어긋난다.
 */

interface BrandSettlementSummaryProps {
  /** 브랜드 계정 아이디. 'biz/' 접두사가 붙어 넘어와도 된다. */
  businessUsername: string;
  /** 이 캠페인의 정산만. 비우면 이 브랜드의 모든 캠페인 정산. */
  campaignId?: string;
  /** 캠페인 등록 때 정한 집행 예산(원). 있으면 청구 금액과 나란히 견준다. */
  budgetKrw?: number;
}

/** 한 회차 — 같은 날 한 번에 보내는 정산. */
type Round = {
  /** 지급 예정일(YYYY-MM-DD). 비어 있으면 담당자가 아직 날짜를 안 잡은 회차다. */
  date: string;
  amount: number;
  headcount: number;
  /** 금액이 아직 확정되지 않은 건수(공동구매 수수료 등). */
  pendingCount: number;
  /** 회차 전체가 입금 완료인지. 한 건이라도 남아 있으면 아직 보낼 회차다. */
  paid: boolean;
};

/** 2026년 9월 30일. 회차 제목은 이 표기를 쓴다 — 송금하는 날짜라 숫자만으로는 부족하다. */
const korFullDate = (raw: string) => {
  const key = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  return `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`;
};

const BrandSettlementSummary: React.FC<BrandSettlementSummaryProps> = ({
  businessUsername,
  campaignId,
  budgetKrw = 0,
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
      // 정산 항목의 proposal_id 에 캠페인 ID 가 들어 있다(`campaign_<캠페인>_<인플루언서>`).
      // 캠페인 ID 로 정산을 조회하는 API 는 없고, 목록은 한 번에 다 읽어 오는 크기다.
      setRows(campaignId ? all.filter(s => (s.proposal_id || '').includes(campaignId)) : all);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [businessUsername, campaignId]);

  const { rounds, total, unpaid, paid, pendingCount } = useMemo(() => {
    // 취소된 정산은 타입에는 없지만 옛 기록에 남아 있을 수 있다 — 합계에서 뺀다.
    const live = rows.filter(s => String(s.status) !== 'cancelled');
    const map = new Map<string, Round>();
    for (const s of live) {
      const date = String(s.scheduled_date || '').slice(0, 10);
      const cur = map.get(date) || { date, amount: 0, headcount: 0, pendingCount: 0, paid: true };
      cur.amount += Number(s.amount || 0);
      cur.headcount += 1;
      if (s.amount_pending && !Number(s.amount || 0)) cur.pendingCount += 1;
      if (s.status !== 'completed') cur.paid = false;
      map.set(date, cur);
    }
    const sum = (list: Settlement[]) => list.reduce((acc, s) => acc + Number(s.amount || 0), 0);
    return {
      // 날짜가 빈 회차(담당자가 아직 날짜를 안 잡은 건)는 맨 아래로.
      rounds: [...map.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')),
      total: sum(live),
      unpaid: sum(live.filter(s => s.status !== 'completed')),
      paid: sum(live.filter(s => s.status === 'completed')),
      pendingCount: live.filter(s => s.amount_pending && !Number(s.amount || 0)).length,
    };
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
      {/* 이 화면의 첫 문장이 정산 방식이다. 금액만 먼저 보여 주면 "이걸 누구에게
          보내는 건지"를 담당자에게 다시 물어보게 된다. */}
      <div className="bg-slate-900 rounded-2xl p-5 md:p-6 text-white">
        <p className="text-[10px] font-black text-slate-400">픽스폴리오 일괄 정산</p>
        <p className="text-2xl md:text-3xl font-black mt-1.5">{formatKoreanWon(total) || '0원'}</p>
        <p className="text-[11px] font-bold text-slate-300 mt-2 leading-relaxed">
          인플루언서에게 각각 보내지 않습니다. 픽스폴리오에 한 번에 입금하면, 원천징수(3.3%)와
          인플루언서별 지급은 픽스폴리오가 처리합니다.
        </p>
        {budgetKrw > 0 && (
          <p className="text-[11px] font-bold text-slate-400 mt-1">
            집행 예산 {formatKoreanWon(budgetKrw)} 중
          </p>
        )}
        {pendingCount > 0 && (
          <p className="text-[11px] font-bold text-amber-300 mt-1">
            금액 조율 중 {pendingCount}건은 확정 후 합계에 더해집니다.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">입금 예정</p>
          <p className="text-lg font-black text-blue-600 mt-1">{formatKoreanWon(unpaid) || '0원'}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">
            {rounds.filter(r => !r.paid).length}회차
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">입금 완료</p>
          <p className="text-lg font-black text-emerald-600 mt-1">{formatKoreanWon(paid) || '0원'}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">
            {rounds.filter(r => r.paid).length}회차
          </p>
        </div>
      </div>

      {rounds.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <p className="text-sm text-slate-500 font-bold">아직 정산 예정 내역이 없습니다</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1.5 leading-relaxed">
            정산은 담당자가 업로드를 확인한 뒤 회차로 묶입니다.<br />
            지급일은 확인한 달의 다음 달 말일입니다.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
          {rounds.map(round => (
            <div key={round.date || 'undecided'} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-900 truncate">
                    {korFullDate(round.date) || '지급일 미정'}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black flex-shrink-0 ${
                      round.paid ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                    }`}
                  >
                    {round.paid ? '입금 완료' : '입금 예정'}
                  </span>
                </div>
                {/* 인원은 남긴다 — 청구 금액이 맞는지 대조할 근거가 있어야 한다.
                    누가 얼마를 받는지는 남기지 않는다. */}
                <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                  인플루언서 {round.headcount}명 분 일괄
                  {round.pendingCount > 0 && ` · 금액 조율 중 ${round.pendingCount}건`}
                </p>
              </div>
              <p className="text-sm font-black text-slate-900 flex-shrink-0">
                {formatKoreanWon(round.amount) || '0원'}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        세금계산서 발행과 입금 계좌는 픽스폴리오 담당자가 안내합니다. 금액이나 지급일에 대한 문의는
        담당자에게 연락해 주세요.
      </p>
    </div>
  );
};

export default BrandSettlementSummary;
