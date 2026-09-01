import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import BrandRemitNegotiation from './BrandRemitNegotiation';
import type { BrandRemitSchedule, BrandSettlementRound } from '../../types';

/**
 * 브랜드가 픽스폴리오에 한 번에 보내는 정산. 브랜드와 담당자가 같은 화면을 본다.
 *
 * 예전에는 이 자리에 인플루언서 한 명당 한 줄이 있었다("@daily_kim · 지급 예정 ·
 * 300,000원"). 지급 기록이 사람마다 쌓이니 화면도 그대로 사람마다 그린 것이었는데,
 * 그것은 픽스폴리오 안쪽의 사실이고 브랜드가 할 일과는 맞지 않는다. 브랜드는 인플루언서
 * 스무 명에게 스무 번 송금하지 않는다 — 픽스폴리오에 한 번 보내고, 원천징수(3.3%)와
 * 개별 지급은 픽스폴리오가 한다.
 *
 * 그래서 사람이 아니라 회차로 묶는다. 인원 수는 남긴다(청구 금액이 맞는지 대조할
 * 근거가 필요하다). 누가 언제 얼마를 받는지는 응답에조차 담지 않는다.
 *
 * 입금일은 정해 두지 않는다. 회차 금액은 우리가 계산하지만 브랜드가 돈을 보내는 날은
 * 브랜드의 세금계산서 발행·내부 지급 규정에 달려 있어서, 어느 쪽이든 제안하고 상대가
 * 동의할 때 정해진다(BrandRemitNegotiation). 그전까지는 "미정"이라고 적는다 —
 * 자동으로 잡힌 인플루언서 지급 예정일을 브랜드의 입금일처럼 보여 주면, 약속하지 않은
 * 날짜가 약속처럼 걸려 있게 된다.
 *
 * 담당자도 같은 화면을 쓴다. 브랜드와 전화로 입금일을 이야기하면서 서로 다른 숫자를
 * 보고 있으면, 통화가 숫자 확인으로 끝난다. 담당자에게만 '입금 확인'이 있다.
 */

interface BrandSettlementSummaryProps {
  /** 브랜드 계정 아이디. 'biz/' 접두사가 붙어 넘어와도 된다. */
  businessUsername: string;
  /** 이 캠페인의 정산만. 비우면 이 브랜드의 모든 캠페인 정산. */
  campaignId?: string;
  /** 캠페인 등록 때 정한 집행 예산(원). 있으면 청구 금액과 나란히 견준다. */
  budgetKrw?: number;
  /** 브랜드 화면인지 담당자 화면인지. 입금 확인은 담당자만 한다. */
  viewer?: 'brand' | 'manager';
  /** 운영 콘솔에서 부를 때의 담당자 토큰. */
  token?: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

/** 2026년 9월분. 회차 이름은 인플루언서 지급 예정월을 쓴다 — 양쪽이 같은 이름으로 부른다. */
const korMonth = (roundKey: string) => {
  const key = String(roundKey || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return '';
  return `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월분`;
};

const BrandSettlementSummary: React.FC<BrandSettlementSummaryProps> = ({
  businessUsername,
  campaignId,
  budgetKrw = 0,
  viewer = 'brand',
  token,
  onNotify,
}) => {
  const [rounds, setRounds] = useState<BrandSettlementRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** '다시 시도' 로 같은 조건을 한 번 더 읽을 때만 올린다. */
  const [reloadKey, setReloadKey] = useState(0);

  const fetchRounds = useCallback(async () => {
    // 화면에 따라 'biz/브랜드' 꼴로 넘어온다. 조회 파라미터에는 접두사를 뗀 아이디를 쓴다.
    const clean = String(businessUsername || '').replace(/^biz\//, '');
    if (!clean) return { rounds: [] as BrandSettlementRound[] };
    return await apiService.getBrandSettlement({ businessUsername: clean, campaignId, token });
  }, [businessUsername, campaignId, token]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const res = await fetchRounds();
      if (!alive) return;
      setLoading(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError('');
      setRounds(res.rounds || []);
    })();
    return () => { alive = false; };
  }, [fetchRounds, reloadKey]);

  /** 한 줄만 갈아 끼운다. 목록을 다시 읽으면 조율 중인 다른 줄의 입력이 닫힌다. */
  const applySchedule = (roundKey: string, schedule: BrandRemitSchedule | null) => {
    setRounds(prev => prev.map(r => (r.roundKey === roundKey ? { ...r, schedule } : r)));
  };

  const { total, pendingRemit, received, undecided, pendingAmountCount } = useMemo(() => {
    const sum = (list: BrandSettlementRound[]) => list.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    // 브랜드의 '입금 완료'는 담당자가 입금을 확인한 회차만이다. 인플루언서 지급이
    // 끝났는지는 다른 이야기이고, 그것으로 브랜드의 입금 여부를 말할 수 없다.
    const done = rounds.filter(r => r.schedule?.receivedAt);
    const open = rounds.filter(r => !r.schedule?.receivedAt);
    return {
      total: sum(rounds),
      pendingRemit: sum(open),
      received: sum(done),
      undecided: open.filter(r => !r.schedule?.agreedDate).length,
      pendingAmountCount: rounds.reduce((acc, r) => acc + Number(r.pendingCount || 0), 0),
    };
  }, [rounds]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center">
        <p className="text-sm text-slate-500 font-bold">{error}</p>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          className="mt-3 px-3 py-1.5 rounded-lg text-[11px] font-black bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 이 화면의 첫 문장이 정산 방식이다. 금액만 먼저 보여 주면 "이걸 누구에게
          보내는 건지"를 담당자에게 다시 물어보게 된다. */}
      <div className="bg-slate-900 rounded-2xl p-5 md:p-6 text-white">
        <p className="text-[10px] font-black text-slate-400">
          {viewer === 'manager' ? '브랜드 청구 · 일괄 정산' : '픽스폴리오 일괄 정산'}
        </p>
        <p className="text-2xl md:text-3xl font-black mt-1.5">{formatKoreanWon(total) || '0원'}</p>
        <p className="text-[11px] font-bold text-slate-300 mt-2 leading-relaxed">
          {viewer === 'manager'
            ? '브랜드는 인플루언서에게 각각 보내지 않고 픽스폴리오에 회차별로 한 번에 입금합니다. 입금일은 브랜드와 조율해 정합니다.'
            : '인플루언서에게 각각 보내지 않습니다. 픽스폴리오에 회차별로 한 번에 입금하면, 원천징수(3.3%)와 인플루언서별 지급은 픽스폴리오가 처리합니다.'}
        </p>
        {budgetKrw > 0 && (
          <p className="text-[11px] font-bold text-slate-400 mt-1">
            집행 예산 {formatKoreanWon(budgetKrw)} 중
          </p>
        )}
        {pendingAmountCount > 0 && (
          <p className="text-[11px] font-bold text-amber-300 mt-1">
            금액 조율 중 {pendingAmountCount}건은 확정 후 합계에 더해집니다.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">입금 예정</p>
          <p className="text-lg font-black text-blue-600 mt-1">{formatKoreanWon(pendingRemit) || '0원'}</p>
          {/* 며칠에 보내는지는 회차마다 다르므로 여기에 날짜를 쓰지 않는다. 아직
              날짜를 정하지 못한 회차가 몇 개인지가 지금 할 일이다. */}
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">
            {rounds.filter(r => !r.schedule?.receivedAt).length}회차
            {undecided > 0 && ` · 입금일 미정 ${undecided}회차`}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">입금 완료</p>
          <p className="text-lg font-black text-emerald-600 mt-1">{formatKoreanWon(received) || '0원'}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">
            {rounds.filter(r => r.schedule?.receivedAt).length}회차
          </p>
        </div>
      </div>

      {rounds.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <p className="text-sm text-slate-500 font-bold">아직 정산 예정 내역이 없습니다</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1.5 leading-relaxed">
            정산은 담당자가 업로드를 확인한 뒤 회차로 묶입니다.<br />
            회차가 생기면 입금일을 {viewer === 'manager' ? '브랜드와' : '담당자와'} 조율해 정합니다.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
          {rounds.map((round, idx) => (
            <div key={round.roundKey || 'undecided'} className="p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">
                    {idx + 1}회차
                    {korMonth(round.roundKey) && (
                      <span className="text-slate-400 font-bold"> · {korMonth(round.roundKey)}</span>
                    )}
                  </p>
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
              <BrandRemitNegotiation
                businessUsername={businessUsername}
                roundKey={round.roundKey}
                schedule={round.schedule}
                viewer={viewer}
                token={token}
                onNotify={onNotify}
                onChanged={schedule => applySchedule(round.roundKey, schedule)}
              />
            </div>
          ))}
        </div>
      )}

      {/* 회차 입금일은 브랜드가 한 번에 보내는 단위(회차 전체)에 붙는다. 캠페인
          하나만 걸러 보는 화면에서 정하면 같은 회차의 다른 캠페인에도 같은 날짜가
          적용되므로, 그 사실을 화면에 적어 둔다. */}
      {!!campaignId && rounds.length > 0 && (
        <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
          입금일은 이 캠페인만이 아니라 같은 회차 전체(한 번에 보내는 금액)에 적용됩니다.
        </p>
      )}

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        {viewer === 'manager'
          ? '입금일은 브랜드와 합의된 날짜만 확정으로 남습니다. 세금계산서 발행과 입금 계좌 안내는 카카오톡·유선으로 진행하고, 결론만 위 회차에 적어 주세요.'
          : '세금계산서 발행과 입금 계좌는 픽스폴리오 담당자가 안내합니다. 입금일은 담당자와 조율해 정하며, 합의된 날짜만 확정으로 표시됩니다.'}
      </p>
    </div>
  );
};

export default BrandSettlementSummary;
