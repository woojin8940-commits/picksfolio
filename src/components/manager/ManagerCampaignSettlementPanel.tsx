import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';

/**
 * 캠페인 정산 — 브랜드에게 받고, 인플루언서에게 보내는 두 칸.
 *
 * 돈은 브랜드 → 픽스폴리오 → 인플루언서로 흐른다. 브랜드는 인플루언서 스무 명에게
 * 스무 번 송금하지 않고 픽스폴리오에 한 번 보내며, 원천징수(3.3%)와 개별 지급은
 * 픽스폴리오가 한다. 그러니 이 화면의 순서도 그 순서여야 한다 — 위쪽이 브랜드 입금
 * 확인이고, 아래쪽이 사람별 지급이다.
 *
 * 한동안 아래쪽만 있었다. 브랜드 입금은 담당자가 통장을 열어 확인하고 그 사실은
 * 아무데도 남지 않았으므로, 화면은 "서류를 냈으니 보낼 수 있다"까지만 알고 있었다.
 * 입금 전에 지급을 닫으면 픽스폴리오 돈이 먼저 나가고, 브랜드가 늦게 보내거나 금액이
 * 어긋나도 회수할 방법이 없다. 그래서 브랜드 입금이 확인될 때까지 사람별 '정산완료'
 * 버튼을 잠근다. 서버도 같은 규칙을 본다(complete_settlement) — 지급을 닫는 자리는
 * 진행사항 보드와 운영 콘솔에도 있어서, 화면 하나에만 걸어 두면 우회된다.
 *
 * 여기서 누르는 '정산완료'는 진행사항 보드의 '지급 완료 처리'와 완전히 같은 동작이다
 * (complete_settlement) — 인플루언서 정산금 화면이 '지급 완료'로 바뀌고, 브랜드의
 * 정산 회차도 같은 값으로 닫힌다. 동작을 새로 만들지 않은 이유가 여기 있다: 두 화면이
 * 서로 다른 방법으로 지급을 닫으면 한쪽에서 닫은 건이 다른 쪽에는 열린 채로 남는다.
 *
 * 브랜드 입금을 확인하면 브랜드 계정의 캠페인 정산 화면에도 '정산완료'로 뜬다
 * (api-settlements 가 정산 항목에 수납 상태를 실어 보낸다). 브랜드가 "보낸 돈이
 * 접수됐나"를 담당자에게 묻지 않아도 되는 자리가 그것이다.
 *
 * 서류(신분증 사본 · 계좌)는 이 목록에 담지 않는다. 목록 응답에는 제출 여부만
 * 들어 있고, 서류 원본은 진행사항 보드의 정산 칸에서만 열린다 — 개인정보를 캠페인
 * 하나를 열었다는 이유로 스무 명분 내려받게 할 이유가 없다.
 */

interface ManagerCampaignSettlementPanelProps {
  /** 이 캠페인. 브랜드 입금 기록은 캠페인 단위로 남는다. */
  campaignId: string;
  /** 이 캠페인의 협업들(담당자 역할로 읽은 목록). 이미 읽어 둔 것을 그대로 받는다. */
  collabs: any[];
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** 지급을 닫은 뒤 목록을 다시 읽는다. */
  onChanged: () => void | Promise<void>;
}

/** 원천징수(3.3%)를 뗀 실지급액. 서버가 같은 식으로 계산한다. */
const netOf = (fee: number) => Math.floor(fee * 0.967);

const todayInSeoul = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/** 입력칸에 찍힌 금액에서 숫자만. "1,200,000원" → 1200000 */
const digitsOf = (raw: string) => Number(String(raw).replace(/[^0-9]/g, '') || 0);

const ManagerCampaignSettlementPanel: React.FC<ManagerCampaignSettlementPanelProps> = ({
  campaignId,
  collabs,
  onNotify,
  onChanged,
}) => {
  const [busyId, setBusyId] = useState('');

  /** 브랜드 일괄 정산금 수납 기록. 없으면 아직 확인 전이다. */
  const [brand, setBrand] = useState<any>(null);
  /** 청구 근거 — 확정 보수 합계와 인원(서버 계산). */
  const [billing, setBilling] = useState<{ amount: number; headcount: number; pendingCount: number } | null>(
    null,
  );
  const [brandLoading, setBrandLoading] = useState(true);
  const [brandBusy, setBrandBusy] = useState(false);
  /** 입금 확인 칸을 펼쳤는지. 기본은 접어 둔다 — 대개 확인은 한 번뿐이다. */
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState({ amount: '', date: todayInSeoul(), memo: '' });

  const loadBrand = useCallback(async () => {
    if (!campaignId) {
      setBrandLoading(false);
      return;
    }
    setBrandLoading(true);
    const res = await apiService.getCampaignBrandSettlement(campaignId);
    setBrandLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setBrand(res.settlement || null);
    setBilling(res.billing || null);
    // 금액 칸의 기본값은 청구액이다. 통장 금액이 다르면 담당자가 고쳐 적는다.
    setForm(f => ({
      ...f,
      amount: String(
        Number(res.settlement?.receivedAmount || 0) ||
          Number(res.settlement?.invoiceAmount || 0) ||
          Number(res.billing?.amount || 0) ||
          '',
      ),
      memo: String(res.settlement?.memo || f.memo || ''),
    }));
  }, [campaignId, onNotify]);

  useEffect(() => {
    loadBrand();
  }, [loadBrand]);

  const brandReceived = Boolean(brand?.received);

  /**
   * 정산 대상. 취소된 협업과 보수가 0원인 협업(제품 협찬형)은 지급할 것이 없다.
   *
   * 조건이 아직 잠기지 않아 0원으로 오는 협업은 '금액 미확정'으로 남겨 둔다 —
   * 목록에서 빼면 담당자는 그 사람이 왜 안 보이는지 알 수 없다.
   */
  const rows = useMemo(() => {
    return collabs
      .filter((c) => c.status === 'in_progress' || c.status === 'completed')
      .map((c) => {
        const fee = Number(c.fee || 0);
        const stl = c.settlement || {};
        return {
          id: String(c.id),
          handle: c.creator?.instagramHandle
            ? `@${c.creator.instagramHandle}`
            : `@${c.creatorUsername}`,
          image: c.creator?.profileImage || '',
          fee,
          feeLocked: Boolean(c.feeLocked),
          submitted: Boolean(stl.submitted),
          payoutDate: String(stl.payoutDate || ''),
          paidAt: stl.paidAt || null,
          /** 업로드 확인 전에는 정산이 열리지 않는다(서버도 같은 규칙이다). */
          uploadConfirmed: Boolean(c.uploadConfirmedAt),
        };
      })
      .sort((a, b) => {
        // 아직 안 보낸 사람이 위로. 그 안에서는 서류를 낸 사람(바로 보낼 수 있는
        // 사람)부터.
        const rank = (r: typeof a) => (r.paidAt ? 2 : r.submitted ? 0 : 1);
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return b.fee - a.fee;
      });
  }, [collabs]);

  const totals = useMemo(() => {
    const paid = rows.filter((r) => r.paidAt);
    const open = rows.filter((r) => !r.paidAt);
    return {
      headcount: rows.length,
      total: rows.reduce((s, r) => s + r.fee, 0),
      paidSum: paid.reduce((s, r) => s + r.fee, 0),
      paidCount: paid.length,
      openSum: open.reduce((s, r) => s + r.fee, 0),
      openCount: open.length,
      /** 서류가 아직 없어서 지금은 누를 수 없는 건수. */
      waitingDocs: open.filter((r) => !r.submitted).length,
    };
  }, [rows]);

  /** 브랜드가 보내야 하는 금액. 담당자가 적은 청구액이 있으면 그것이 먼저다. */
  const invoiceAmount = Number(brand?.invoiceAmount || 0) || Number(billing?.amount || 0) || totals.total;

  const markReceived = async () => {
    const amount = digitsOf(form.amount) || invoiceAmount;
    if (
      !confirm(
        `브랜드 입금을 확인 완료로 처리합니다.\n입금액 ${amount.toLocaleString('ko-KR')}원 · ${form.date}\n\n` +
          `확인하면 인플루언서 지급(정산완료)이 열리고, 브랜드 정산 화면에 '정산완료'로 표시됩니다.`,
      )
    ) {
      return;
    }
    setBrandBusy(true);
    const res = await apiService.campaignBrandSettlementAction(campaignId, 'mark_received', {
      receivedAmount: amount,
      invoiceAmount,
      receivedDate: form.date,
      memo: form.memo,
    });
    setBrandBusy(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setBrand(res.settlement || null);
    setBilling(res.billing || billing);
    setConfirming(false);
    onNotify('브랜드 입금을 확인 완료로 처리했습니다.');
  };

  const reopenBrand = async () => {
    if (!confirm('브랜드 입금 확인을 되돌립니다.\n인플루언서 지급(정산완료)이 다시 잠깁니다.')) return;
    setBrandBusy(true);
    const res = await apiService.campaignBrandSettlementAction(campaignId, 'reopen');
    setBrandBusy(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setBrand(res.settlement || null);
    onNotify('브랜드 입금 확인을 되돌렸습니다.');
  };

  const complete = async (row: { id: string; handle: string; payoutDate: string }) => {
    if (!confirm(`${row.handle} 정산을 완료로 처리합니다.\n인플루언서와 브랜드 화면에 '지급 완료'로 표시됩니다.`)) {
      return;
    }
    setBusyId(row.id);
    const res = await apiService.collabAction(
      row.id,
      'complete_settlement',
      { paidDate: row.payoutDate || todayInSeoul() },
      undefined,
      'manager',
    );
    setBusyId('');
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    onNotify(`${row.handle} 정산을 완료로 처리했습니다.`);
    await onChanged();
  };

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-900 focus:outline-none focus:border-slate-400';

  /**
   * 브랜드 입금 칸. 사람별 지급보다 위에 둔다 — 화면의 순서가 곧 돈의 순서다.
   */
  const brandCard = (
    <div
      className={`rounded-2xl border p-4 md:p-5 ${
        brandReceived ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-amber-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-slate-900">브랜드 일괄 정산금</p>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                brandReceived ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {brandLoading ? '확인 중...' : brandReceived ? '정산완료' : '입금 대기'}
            </span>
          </div>
          <p className="text-[11px] font-bold text-slate-500 mt-1 leading-relaxed">
            {brandReceived ? (
              <>
                {brand?.receivedDate || '-'} 입금 확인
                {Number(brand?.receivedAmount || 0) > 0 && (
                  <> · {formatKoreanWon(Number(brand.receivedAmount))} 수납</>
                )}
                {brand?.receivedBy && ` · 확인 ${brand.receivedBy}`}
              </>
            ) : (
              <>브랜드 입금이 확인되기 전에는 인플루언서 지급을 닫을 수 없습니다.</>
            )}
          </p>
          {brand?.memo && <p className="text-[11px] font-medium text-slate-400 mt-1">{brand.memo}</p>}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[10px] font-black text-slate-400">청구 금액</p>
          <p className="text-lg font-black text-slate-900">{formatKoreanWon(invoiceAmount) || '0원'}</p>
          <p className="text-[10px] font-bold text-slate-400">
            인플루언서 {billing?.headcount ?? totals.headcount}명 확정 보수 합계
          </p>
        </div>
      </div>

      {Number(billing?.pendingCount || 0) > 0 && !brandReceived && (
        <p className="text-[11px] font-bold text-amber-600 mt-2">
          조건이 아직 확정되지 않은 협업 {billing?.pendingCount}건이 청구 금액에 빠져 있습니다. 조건표를 먼저
          확정해 주세요.
        </p>
      )}

      {!brandLoading && !brandReceived && (
        confirming ? (
          <div className="mt-4 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="block text-[10px] font-black text-slate-400 mb-1">입금액</span>
                <input
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  inputMode="numeric"
                  placeholder={String(invoiceAmount || '')}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-black text-slate-400 mb-1">입금일</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="block text-[10px] font-black text-slate-400 mb-1">메모 (선택)</span>
                <input
                  value={form.memo}
                  onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="예: 1차분 · 세금계산서 발행"
                  className={inputCls}
                />
              </label>
            </div>
            <p className="text-[10px] font-bold text-slate-400 leading-relaxed">
              통장에 찍힌 금액과 날짜를 그대로 적어 주세요. 입금일과 메모는 브랜드 정산 화면에도 보입니다.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={markReceived}
                disabled={brandBusy}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-700 disabled:opacity-40"
              >
                {brandBusy ? '처리 중...' : '입금 확인 완료'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={brandBusy}
                className="px-3 py-2 rounded-xl border border-slate-200 text-slate-500 text-xs font-black hover:bg-slate-50 disabled:opacity-40"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="mt-3 w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-700"
          >
            브랜드 입금 확인하기
          </button>
        )
      )}

      {brandReceived && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            onClick={reopenBrand}
            disabled={brandBusy}
            className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-[11px] font-black text-slate-500 hover:text-slate-900 disabled:opacity-40"
          >
            {brandBusy ? '처리 중...' : '확인 되돌리기'}
          </button>
          <span className="text-[10px] font-bold text-slate-400">
            잘못 확인한 경우에만 사용하세요. 되돌리면 인플루언서 지급이 다시 잠깁니다.
          </span>
        </div>
      )}
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        {brandCard}
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">정산할 협업이 없습니다.</p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            인플루언서가 제안을 수락해 협업이 시작되면 이 자리에 사람별 지급 줄이 생깁니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {brandCard}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[10px] font-black text-slate-400">정산 대상</p>
          <p className="text-lg font-black text-slate-900 mt-1">{totals.headcount}명</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">
            확정 보수 합계 {formatKoreanWon(totals.total) || '0원'}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[10px] font-black text-slate-400">지급 남음</p>
          <p className="text-lg font-black text-blue-600 mt-1">{formatKoreanWon(totals.openSum) || '0원'}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">{totals.openCount}명</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[10px] font-black text-slate-400">정산 완료</p>
          <p className="text-lg font-black text-emerald-600 mt-1">{formatKoreanWon(totals.paidSum) || '0원'}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">{totals.paidCount}명</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-[10px] font-black text-slate-400">서류 대기</p>
          <p className="text-lg font-black text-amber-600 mt-1">{totals.waitingDocs}명</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">신분증 · 계좌 미제출</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100">
          <h4 className="text-sm font-black text-slate-900">사람별 지급 ({rows.length})</h4>
          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
            {brandReceived
              ? "입금을 보낸 뒤 '정산완료'를 눌러 주세요. 인플루언서 정산금 화면과 브랜드 정산 회차가 함께 '지급 완료'로 바뀝니다. 신분증 사본과 계좌는 진행사항 탭의 정산 칸에서 열립니다."
              : '브랜드 입금 확인 전입니다. 위 칸에서 브랜드 입금을 확인하면 사람별 지급이 열립니다.'}
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map((r) => {
            const paid = Boolean(r.paidAt);
            const badge = paid
              ? { label: '정산완료', cls: 'bg-emerald-50 text-emerald-600' }
              : !brandReceived
                ? { label: '브랜드 입금 대기', cls: 'bg-amber-50 text-amber-600' }
                : r.submitted
                  ? r.payoutDate
                    ? { label: `지급 예정 ${r.payoutDate}`, cls: 'bg-blue-50 text-blue-600' }
                    : { label: '지급일 미정', cls: 'bg-indigo-50 text-indigo-600' }
                  : { label: '서류 대기', cls: 'bg-amber-50 text-amber-600' };
            return (
              <div key={r.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  {r.image ? (
                    <img src={r.image} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-100 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-slate-900 truncate">{r.handle}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                      {r.fee > 0 ? (
                        <>
                          {formatKoreanWon(r.fee)} · 원천징수 3.3% 차감 후 {formatKoreanWon(netOf(r.fee))} 입금
                        </>
                      ) : (
                        '보수 미확정 · 조건표를 먼저 확정해 주세요'
                      )}
                    </p>
                    {!paid && !r.uploadConfirmed && (
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                        게시물 업로드 확인 전입니다. 확인하면 정산 서류 칸이 열립니다.
                      </p>
                    )}
                  </div>
                </div>

                {paid ? (
                  <span className="text-[11px] font-black text-emerald-600 flex-shrink-0">
                    {String(r.paidAt).slice(0, 10)} 지급
                  </span>
                ) : (
                  <button
                    onClick={() => complete(r)}
                    disabled={busyId === r.id || !r.submitted || !brandReceived}
                    title={
                      !brandReceived
                        ? '브랜드 일괄 정산금 입금을 먼저 확인해 주세요.'
                        : r.submitted
                          ? ''
                          : '인플루언서가 신분증 사본과 계좌를 제출한 뒤 누를 수 있습니다.'
                    }
                    className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    {busyId === r.id ? '처리 중...' : '정산완료'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ManagerCampaignSettlementPanel;
