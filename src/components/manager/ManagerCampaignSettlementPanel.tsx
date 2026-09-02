import React, { useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';

/**
 * 캠페인 정산 — 담당자가 사람별로 지급을 닫는 화면.
 *
 * 지급 처리는 원래 진행사항 보드 안쪽, 인플루언서 한 명을 열고 정산 칸까지 내려간
 * 자리에만 있었다(CampaignProcessBoard 의 settlement 단계). 담당자가 실제로 하는 일은
 * "이 캠페인에서 아직 안 보낸 사람이 누구인가"를 한 번에 보고 순서대로 닫는 것인데,
 * 그 화면에서는 스무 명이면 스무 번 열어 보고 스무 번 되돌아 나와야 알 수 있었다.
 *
 * 그래서 캠페인 탭에 같은 동작을 목록으로 낸다. 여기서 누르는 '정산완료'는 진행사항
 * 보드의 '지급 완료 처리'와 완전히 같은 동작이다(complete_settlement) — 인플루언서
 * 정산금 화면이 '지급 완료'로 바뀌고, 브랜드의 정산 회차도 같은 값으로 닫힌다.
 * 동작을 새로 만들지 않은 이유가 여기 있다: 두 화면이 서로 다른 방법으로 지급을
 * 닫으면 한쪽에서 닫은 건이 다른 쪽에는 열린 채로 남는다.
 *
 * 서류(신분증 사본 · 계좌)는 이 목록에 담지 않는다. 목록 응답에는 제출 여부만
 * 들어 있고, 서류 원본은 진행사항 보드의 정산 칸에서만 열린다 — 개인정보를 캠페인
 * 하나를 열었다는 이유로 스무 명분 내려받게 할 이유가 없다.
 */

interface ManagerCampaignSettlementPanelProps {
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

const ManagerCampaignSettlementPanel: React.FC<ManagerCampaignSettlementPanelProps> = ({
  collabs,
  onNotify,
  onChanged,
}) => {
  const [busyId, setBusyId] = useState('');

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

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
        <p className="text-sm text-slate-500 font-black">정산할 협업이 없습니다.</p>
        <p className="mt-1 text-[11px] font-medium text-slate-400">
          인플루언서가 제안을 수락해 협업이 시작되면 이 자리에 사람별 지급 줄이 생깁니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
            입금을 보낸 뒤 '정산완료'를 눌러 주세요. 인플루언서 정산금 화면과 브랜드 정산 회차가 함께
            '지급 완료'로 바뀝니다. 신분증 사본과 계좌는 진행사항 탭의 정산 칸에서 열립니다.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map((r) => {
            const paid = Boolean(r.paidAt);
            const badge = paid
              ? { label: '정산완료', cls: 'bg-emerald-50 text-emerald-600' }
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
                    disabled={busyId === r.id || !r.submitted}
                    title={r.submitted ? '' : '인플루언서가 신분증 사본과 계좌를 제출한 뒤 누를 수 있습니다.'}
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
