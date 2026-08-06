import React, { useState, useEffect } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import type { Settlement } from '../../types';

/**
 * 캠페인 정산 — 브랜드가 보는 지급 현황.
 *
 * 정산은 담당자가 업로드를 확인한 시점(confirm 단계)에 예약된다. 그래서 이 화면은
 * 예약을 만들지 않고 읽기만 한다 — 브랜드가 직접 정산을 만들 수 있게 하면 업로드
 * 확인과 지급 근거가 어긋난다.
 *
 * 정산 항목은 proposal_id 에 캠페인 ID 가 들어 있어(`campaign_<캠페인>_<인플루언서>`)
 * 그 값으로 이 캠페인의 정산만 골라낸다. 캠페인 ID 로 정산을 조회하는 API 는 없고,
 * 브랜드 정산 목록은 어차피 한 번에 다 읽어 오는 크기다.
 */

interface CampaignSettlementPanelProps {
  businessUsername: string;
  campaignId: string;
  /** 캠페인 등록 때 정한 총 집행 예산(원). 지급 진행률의 분모다. */
  budgetKrw: number;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  scheduled: { label: '지급 예정', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '지급 완료', cls: 'bg-emerald-50 text-emerald-600' },
  pending: { label: '확인 대기', cls: 'bg-amber-50 text-amber-600' },
  cancelled: { label: '취소', cls: 'bg-slate-100 text-slate-400' },
};

const CampaignSettlementPanel: React.FC<CampaignSettlementPanelProps> = ({
  businessUsername,
  campaignId,
  budgetKrw,
}) => {
  const [rows, setRows] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // businessUsername 은 화면에 따라 'biz/브랜드' 형태로 넘어온다. 정산 API 는
      // 경로에 아이디를 넣기 때문에 슬래시를 먼저 떼야 한다.
      const clean = businessUsername.replace(/^biz\//, '');
      const all = await apiService.getSettlements(clean, 'business');
      if (!alive) return;
      setRows(all.filter(s => (s.proposal_id || '').includes(campaignId)));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [businessUsername, campaignId]);

  const scheduled = rows.filter(s => s.status === 'scheduled');
  const completed = rows.filter(s => s.status === 'completed');
  const sum = (list: Settlement[]) => list.reduce((acc, s) => acc + Number(s.amount || 0), 0);

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">집행 예산</p>
          <p className="text-lg font-black text-slate-900 mt-1">{formatKoreanWon(budgetKrw) || '0원'}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">지급 예정</p>
          <p className="text-lg font-black text-blue-600 mt-1">{formatKoreanWon(sum(scheduled)) || '0원'}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">{scheduled.length}건</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <p className="text-[10px] font-black text-slate-400">지급 완료</p>
          <p className="text-lg font-black text-emerald-600 mt-1">{formatKoreanWon(sum(completed)) || '0원'}</p>
          <p className="text-[10px] text-slate-400 font-bold mt-0.5">{completed.length}건</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <p className="text-sm text-slate-500 font-bold">아직 정산 예정 내역이 없습니다</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1.5 leading-relaxed">
            정산은 담당자가 업로드를 확인한 뒤 예약됩니다.<br />
            지급일은 확인한 달의 다음 달 말일입니다.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
          {rows.map(s => {
            const badge = STATUS_LABEL[s.status] || { label: s.status, cls: 'bg-slate-100 text-slate-400' };
            return (
              <div key={s.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900 truncate">@{s.influencer_username}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black flex-shrink-0 ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                    지급 예정일 {s.scheduled_date || '미정'}
                  </p>
                  {s.memo && <p className="text-[11px] text-slate-400 font-medium mt-1">{s.memo}</p>}
                </div>
                <p className="text-sm font-black text-slate-900 flex-shrink-0">
                  {s.amount_pending && !Number(s.amount || 0) ? (
                    /* 공동구매 수수료처럼 담당자가 조율 중인 금액. 0원으로 그리면
                       지급할 것이 없는 협업으로 읽힌다. */
                    <span className="text-amber-600">협의중</span>
                  ) : (
                    formatKoreanWon(s.amount)
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        표시된 금액은 인플루언서에게 지급되는 금액입니다. 원천징수(3.3%)는 지급 시 차감되며, 세금계산서는
        지급 완료 후 발행됩니다.
      </p>
    </div>
  );
};

export default CampaignSettlementPanel;
