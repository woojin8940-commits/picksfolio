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
 * 그래서 사람이 아니라 회차로 묶는다. 회차의 기준은 지급 예정일이다 — 정산은 콘텐츠가
 * 올라간 달의 익월 말일로 자동 예약되므로(서버 settlementDateFrom), 같은 달에 업로드한
 * 인플루언서들은 같은 날짜를 공유하고 그 날짜가 곧 브랜드가 한 번 보내는 회차다.
 *
 * 맨 위는 일괄 정산 총액 한 칸이고, 그 아래에
 * 입금 예정 · 입금 완료 합계를 둔다. 회차 줄에는 금액과 상태, 그리고 인원 수를 남긴다 —
 * 인원 수는 청구 금액이 맞는지 대조할 근거이지, 누가 언제 얼마를 받는지가 아니다.
 *
 * 사람별 지급 상태와 금액은 담당자 화면에만 남는다. 서류를 받고 지급일을 잡고 입금하는
 * 것이 담당자의 일이다.
 *
 * ── 무엇을 '완료'라고 부르는가 ──
 * 한동안 이 화면의 상태는 인플루언서 지급이 끝났는지(정산 항목의 status)를 말했다.
 * 그건 브랜드가 확인할 수 없고 손댈 수도 없는 남의 진행이었고, 정작 브랜드가 알고
 * 싶은 "내가 보낸 돈이 접수됐나"는 담당자에게 전화해야 알 수 있었다. 그래서 상태의
 * 기준을 브랜드 입금 수납(brand_settlement)으로 바꿨다 — 담당자가 통장을 확인하고
 * '입금 확인 완료'를 누르면 이 화면의 회차가 '정산완료'가 된다. 인플루언서 개별
 * 지급은 그 뒤에 픽스폴리오가 처리한다.
 *
 * ── 캠페인 한 건을 볼 때(campaignId) ──
 * 캠페인 정산 탭에서는 회차로 쪼개지 않고 "픽스폴리오에 보낼 금액" 한 칸만 세운다.
 * 그 금액은 정산 항목의 합이 아니라 진행이 확정된 인플루언서들의 광고비 합계
 * (api-campaign-brand-settlement 의 billingBasis)다 — 인플루언서가 받는 보수가 아니라
 * 브랜드가 명단에서 보고 고른 광고비이고, 개별 지급은 그 뒤 픽스폴리오가 한다. 정산
 * 항목은 담당자가 업로드를
 * 확인한 뒤에야 생기므로, 그것만 더하면 이미 진행을 시작한 사람의 금액이 화면에
 * 없다 — 브랜드는 보낼 금액을 알 수 없고, 등록할 때 적은 예산과도 다르다(명단은
 * 협의하면서 늘거나 줄고, 예산은 그 전에 적은 희망값이다).
 *
 * ── 비즈니스 제안으로 직접 한 협업 ──
 * 위 설명은 담당자가 관리하는 캠페인 이야기다. 브랜드가 인플루언서에게 직접 제안해
 * 성사된 협업은 돈도 브랜드가 직접 보낸다 — 픽스폴리오를 거치지 않으니 회차로 묶을
 * 일괄 정산도, 담당자가 확인해 줄 수납도 없다. 그런데도 같은 목록에 섞여 있어서
 * 브랜드가 이미 보낸 돈이 '입금 확인 대기'로 남아 있었다.
 * 그래서 그 건들은 아래에 따로 세우고, 브랜드가 직접 '정산완료'를 누를 수 있게 한다.
 * 인플루언서 쪽에서 눌러도 마찬가지로 완료다 — 둘 중 한쪽이 확인하면 그걸로 끝이다.
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
  /** 이 회차의 브랜드 입금이 전부 접수됐는가. */
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

/**
 * 담당자가 관리하는 캠페인에서 온 정산인가.
 *
 * 서버가 `source` 를 내려주지만, 캐시된 예전 응답에는 없을 수 있어 식별자 규칙으로
 * 한 번 더 판단한다(`campaign_<캠페인>_<아이디>`).
 */
const isCampaignSettlement = (s: Settlement) =>
  s.source ? s.source === 'campaign' : String(s.proposal_id || '').startsWith('campaign_');

/**
 * 이 정산의 브랜드 입금이 접수됐는가.
 *
 * 캠페인 협업에는 수납 기록이 붙어 온다(brand_settlement) — 담당자가 통장을 확인한
 * 사실이고, 브랜드가 이 화면에서 알고 싶은 것이 그것이다. 비즈니스 제안에서 성사된
 * 협업은 브랜드가 인플루언서에게 직접 지급하므로 일괄 정산 수납이라는 것이 없다.
 * 그 줄은 예전 그대로 정산 항목의 상태를 쓴다.
 */
const isBrandPaid = (s: Settlement) =>
  s.brand_settlement ? s.brand_settlement.received : s.status === 'completed';

/** 캠페인 한 건의 청구 요약(브랜드용 응답). */
type CampaignBilling = {
  /** 픽스폴리오에 보낼 금액. */
  amount: number;
  /** 담당자가 청구서 금액을 확정해 적었는가. */
  invoiced: boolean;
  /** 담당자가 입금을 확인했는가 — 이 화면의 '정산완료'. */
  received: boolean;
  /** 금액의 근거가 된 인원. */
  headcount: number;
  /** 광고비가 아직 확정되지 않아 금액에 들어가지 않은 인원. */
  pendingCount: number;
  memo: string;
};

const BrandSettlementSummary: React.FC<BrandSettlementSummaryProps> = ({
  businessUsername,
  campaignId = '',
}) => {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [completingId, setCompletingId] = useState<string | null>(null);
  /** 캠페인 한 건을 볼 때만 채워진다. 계정 전체 화면에는 청구 단위가 없다. */
  const [billing, setBilling] = useState<CampaignBilling | null>(null);

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
      const [all, billed] = await Promise.all([
        apiService.getSettlements(clean, 'business'),
        campaignId ? apiService.getCampaignBrandSettlement(campaignId) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setRows(all.filter(s => !campaignId || String(s.proposal_id || '').includes(campaignId)));
      if (billed?.settlement) {
        setBilling({
          amount: Number(billed.settlement.amount || 0),
          invoiced: Boolean(billed.settlement.invoiced),
          received: Boolean(billed.settlement.received),
          headcount: Number(billed.basis?.headcount || 0),
          pendingCount: Number(billed.basis?.pendingCount || 0),
          memo: String(billed.settlement.memo || ''),
        });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [businessUsername, campaignId]);

  /** 담당자가 관리하는 캠페인 — 회차로 묶어 픽스폴리오에 한 번 보내는 건들. */
  const campaignRows = useMemo(() => rows.filter(isCampaignSettlement), [rows]);
  /** 브랜드가 인플루언서에게 직접 보내는 건들. 가까운 지급일이 위로. */
  const directRows = useMemo(
    () =>
      rows
        .filter(s => !isCampaignSettlement(s))
        .sort((a, b) =>
          String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999')),
        ),
    [rows],
  );

  /**
   * 브랜드가 직접 지급한 건을 완료로 닫는다.
   *
   * 이 돈은 브랜드 통장에서 인플루언서 통장으로 바로 간다 — 픽스폴리오는 보냈는지
   * 알 수 없다. 그래서 보낸 사람이 직접 표시하고, 그 값이 인플루언서 화면에도 같이
   * 반영된다.
   */
  const handleComplete = async (s: Settlement) => {
    if (!confirm('정산금을 지급하셨습니까? 인플루언서 화면에도 정산완료로 표시됩니다.')) return;
    const clean = String(businessUsername || '').replace(/^biz\//, '');
    setCompletingId(s.id);
    const res = await apiService.completeSettlement(clean, s.id, 'business');
    setCompletingId(null);
    if (!res.ok) {
      alert(res.error || '정산 완료 처리에 실패했습니다.');
      return;
    }
    setRows(prev =>
      prev.map(r =>
        r.id === s.id
          ? res.settlement || { ...r, status: 'completed', completed_at: new Date().toISOString() }
          : r,
      ),
    );
  };

  const { rounds, total, scheduledSum, completedSum, pendingCount, headcount, allReceived } =
    useMemo(() => {
      const byDate = new Map<string, Round>();
      const people = new Set<string>();
      let total = 0;
      let scheduledSum = 0;
      let completedSum = 0;
      let pendingCount = 0;
      let receivedRows = 0;

      for (const s of campaignRows) {
        const date = String(s.scheduled_date || '').slice(0, 10);
        const amount = Number(s.amount || 0);
        // '완료'의 기준은 브랜드 입금 수납이다(isBrandPaid 참고).
        const paid = isBrandPaid(s);
        const pending = isAmountPending(s);

        total += amount;
        if (paid) completedSum += amount;
        else scheduledSum += amount;
        if (pending) pendingCount += 1;
        if (paid) receivedRows += 1;
        people.add(String(s.influencer_username || '').toLowerCase());

        const round =
          byDate.get(date) ||
          { date, headcount: 0, amount: 0, pendingCount: 0, paid: true };
        round.headcount += 1;
        round.amount += amount;
        if (pending) round.pendingCount += 1;
        // 한 건이라도 입금 전이면 회차는 아직 입금 전이다.
        if (!paid) round.paid = false;
        byDate.set(date, round);
      }

      // 가까운 회차가 위로. 날짜가 아직 없는 묶음은 맨 아래에 둔다.
      const rounds = [...byDate.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
      return {
        rounds,
        total,
        scheduledSum,
        completedSum,
        pendingCount,
        headcount: people.size,
        /** 이 화면에 있는 정산이 전부 접수됐는가. 맨 위 칸의 배지가 이 값이다. */
        allReceived: campaignRows.length > 0 && receivedRows === campaignRows.length,
      };
    }, [campaignRows]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
      </div>
    );
  }

  /**
   * 일괄 정산 묶음을 그릴지. 직접 지급 건만 있는 브랜드에게 0원짜리 '일괄 정산 총액'과
   * '아직 정산 예정 내역이 없습니다'를 같이 보여 주면, 있는 정산이 없는 것처럼 읽힌다.
   * 아무 정산도 없을 때는 이 묶음의 빈 안내가 그 역할을 한다.
   */
  const showBatch = campaignRows.length > 0 || directRows.length === 0;

  return (
    <div className="space-y-4">
      {/* 캠페인 한 건을 볼 때. 브랜드가 할 일은 "이 금액을 픽스폴리오에 보내기" 하나이고,
          그 뒤는 담당자의 입금 확인 하나다. 그래서 칸도 하나다 — 회차와 사람별 지급
          진행은 그리지 않는다. */}
      {billing ? (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400">픽스폴리오에 정산할 금액</p>
                <p className="text-2xl font-black text-slate-900 mt-1">{formatKRW(billing.amount)}</p>
                <p className="text-[11px] text-slate-400 font-bold mt-1">
                  {billing.headcount > 0
                    ? `진행 확정 인플루언서 ${billing.headcount}명 광고비 기준`
                    : '아직 진행이 확정된 인플루언서가 없습니다'}
                  {billing.invoiced ? ' · 청구서 발행' : ''}
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0 ${
                  billing.received ? 'bg-emerald-600 text-white' : 'bg-blue-50 text-blue-600'
                }`}
              >
                {billing.received ? '정산완료' : '입금 확인 대기'}
              </span>
            </div>
            {billing.received ? (
              <p className="text-[11px] text-emerald-600 font-bold mt-2">
                입금 확인 완료 · 인플루언서 지급은 픽스폴리오가 진행합니다.
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 font-medium mt-2 leading-relaxed">
                픽스폴리오 계좌로 한 번 보내 주세요. 담당자가 입금을 확인하면 이 칸이 '정산완료'로 바뀝니다.
              </p>
            )}
            {billing.pendingCount > 0 && (
              <p className="text-[11px] text-amber-600 font-bold mt-1">
                광고비 조율 중 {billing.pendingCount}명이 아직 포함되지 않았습니다.
              </p>
            )}
            {billing.memo && (
              <p className="text-[11px] text-slate-500 font-medium mt-1">{billing.memo}</p>
            )}
          </div>

          <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
            등록할 때 적은 예산이 아니라 실제로 진행이 확정된 인플루언서들의 광고비 합계입니다. 명단에서 보신
            광고비가 그대로 더해지고, 명단이 늘거나 줄면 이 금액도 따라 바뀝니다. 인플루언서 개별 지급과
            원천징수(3.3%)는 입금 확인 후 픽스폴리오가 처리하고, 세금계산서도 그때 발행됩니다.
          </p>
        </>
      ) : (
      <>
      {/* 담당자가 관리하는 캠페인 — 회차로 묶어 픽스폴리오로 한 번 보내는 정산. 직접
          지급하는 건만 있으면 이 묶음은 그릴 것이 없다. */}
      {showBatch && (
        <>
        {/* 맨 위 한 칸. 브랜드가 이 화면에서 확인하는 것은 "얼마를 어디로 보내는가"와
            "보낸 것이 접수됐는가" 둘이다. */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-400">일괄 정산 총액</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{formatKRW(total)}</p>
            </div>
            {rows.length > 0 && (
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-black flex-shrink-0 ${
                  allReceived ? 'bg-emerald-600 text-white' : 'bg-blue-50 text-blue-600'
                }`}
              >
                {allReceived ? '정산완료' : '입금 확인 대기'}
              </span>
            )}
          </div>
          {allReceived && (
            <p className="text-[11px] text-emerald-600 font-bold mt-1">
              입금 확인 완료 · 인플루언서 지급은 픽스폴리오가 진행합니다.
            </p>
          )}
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
              지급일은 콘텐츠를 올린 달의 다음 달 말일입니다.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
            <div className="px-4 py-3">
              <p className="text-[11px] font-black text-slate-900">정산 회차 {rounds.length}건</p>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                같은 지급일의 협업이 한 회차로 묶입니다. '정산완료'는 픽스폴리오가 입금을 확인한 회차입니다.
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
                      {round.paid ? '정산완료' : '입금 예정'}
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
          표시된 금액은 픽스폴리오로 입금하는 금액입니다{headcount > 0 && ` (인플루언서 ${headcount}명)`}. 입금이
          확인되면 회차가 '정산완료'로 바뀌고, 인플루언서 개별 지급과 원천징수(3.3%)는 그 뒤에 픽스폴리오가
          처리합니다. 세금계산서는 입금 확인 후 발행됩니다. 지급일은 콘텐츠를 올린 달의 다음 달 말일입니다.
        </p>
        </>
      )}
      </>
      )}

      {/* 브랜드가 직접 지급하는 건. 회차로 묶지 않고 한 건씩 세운다 — 보낸 사람이
          직접 완료를 눌러야 하므로 어느 협업인지 그대로 보여야 한다. */}
      {directRows.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
          <div className="px-4 py-3">
            <p className="text-[11px] font-black text-slate-900">비즈니스 제안 직접 협업 {directRows.length}건</p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5 leading-relaxed">
              내가 직접 제안해 성사된 협업입니다. 정산금은 픽스폴리오를 거치지 않고 인플루언서에게 바로
              지급하며, 지급 후 '정산완료'를 눌러 주세요. 인플루언서가 먼저 확인해도 완료로 바뀝니다.
            </p>
          </div>
          {directRows.map(s => {
            const done = s.status === 'completed';
            return (
              <div key={s.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900 truncate">
                      {s.influencer_username ? `@${s.influencer_username}` : s.title || '협업 정산'}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black flex-shrink-0 ${
                        done ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                      }`}
                    >
                      {done ? '정산완료' : '지급 예정'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5 truncate">
                    {s.title || '협업 정산'} · {roundLabel(String(s.scheduled_date || '').slice(0, 10))}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="text-sm font-black text-slate-900">
                    {isAmountPending(s) ? (
                      <span className="text-amber-600">금액 조율 중</span>
                    ) : (
                      formatKRW(Number(s.amount || 0))
                    )}
                  </p>
                  {!done && !isAmountPending(s) && (
                    <button
                      type="button"
                      onClick={() => handleComplete(s)}
                      disabled={completingId === s.id}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[10px] font-black hover:bg-slate-800 disabled:opacity-50"
                    >
                      {completingId === s.id ? '처리 중...' : '정산완료'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BrandSettlementSummary;
