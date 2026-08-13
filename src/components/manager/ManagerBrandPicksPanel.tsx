import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatNumberWithCommas } from '../../utils/formatters';
import InfluencerCandidateCard from '../collab/InfluencerCandidateCard';

/**
 * 브랜드 선택 — 브랜드가 고른 인플루언서와, 담당자가 눌러야 할 버튼 하나.
 *
 * 브랜드의 선택은 캠페인 안쪽 명단에만 남는다. 그래서 담당자는 캠페인을 하나씩 열어
 * 봐야 "브랜드가 골랐는데 아직 아무 일도 일어나지 않은 사람"을 찾을 수 있었고, 그
 * 사이 브랜드 화면에는 며칠씩 아무 변화가 없었다. 선택은 기록이 아니라 답을 기다리는
 * 요청이므로 담당자 대시보드의 첫 화면이 이것이다.
 *
 * 여기서 하는 일은 하나뿐이다 — 진행하기. 누르면 협업이 만들어지고 브랜드와
 * 인플루언서 양쪽 진행사항에 같은 건이 뜬다. 조건을 다듬어 제안서로 보내고 싶으면
 * 캠페인 안의 명단으로 들어간다. 이 화면에 제안 폼까지 얹으면 "빨리 진행"과
 * "조건 협의" 두 가지 일이 한 칸에 섞여, 둘 다 반쯤 하게 된다.
 */

interface ManagerBrandPicksPanelProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** 캠페인 안 명단으로 보내기. 조건을 손봐야 하는 건은 그쪽에서 처리한다. */
  onOpenCampaign?: (campaignId: string) => void;
}

const OUTREACH_BADGE: Record<string, { label: string; cls: string }> = {
  not_sent: { label: '제안 전', cls: 'bg-slate-100 text-slate-400' },
  sent: { label: '응답 대기', cls: 'bg-amber-50 text-amber-600' },
  declined: { label: '거절', cls: 'bg-red-50 text-red-500' },
  expired: { label: '기한 지남', cls: 'bg-slate-100 text-slate-400' },
};

const ManagerBrandPicksPanel: React.FC<ManagerBrandPicksPanelProps> = ({
  onNotify,
  onOpenCampaign,
}) => {
  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getManagerCampaigns({ mine: mineOnly });
    setLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setPicks(res.brandPicks || []);
  }, [mineOnly, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  /** 캠페인별로 묶는다. 담당자가 연락을 돌릴 때의 단위가 캠페인이다. */
  const groups = useMemo(() => {
    const map = new Map<string, { campaignId: string; title: string; brand: string; mine: boolean; unassigned: boolean; rows: any[] }>();
    for (const pick of picks) {
      const key = String(pick.campaignId || '');
      if (!map.has(key)) {
        map.set(key, {
          campaignId: key,
          title: pick.campaignTitle || '(제목 없음)',
          brand: pick.brandName || pick.businessUsername || '',
          mine: !!pick.mine,
          unassigned: !!pick.unassigned,
          rows: [],
        });
      }
      map.get(key)!.rows.push(pick);
    }
    return Array.from(map.values());
  }, [picks]);

  const startCollab = async (pick: any) => {
    if (
      !window.confirm(
        `@${pick.influencerUsername} 협업을 시작합니다. 브랜드와 인플루언서 진행사항에 바로 표시되고 되돌릴 수 없습니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }
    setBusyId(pick.id);
    const res = await apiService.listupAction(pick.id, 'start_collab', {});
    setBusyId('');
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    onNotify(
      res.alreadyAccepted
        ? '이미 진행 중인 협업입니다.'
        : `@${pick.influencerUsername} 협업을 시작했습니다. 양쪽 진행사항에 표시됩니다.`,
    );
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900">
            브랜드가 선택한 인플루언서 ({picks.length})
          </h3>
          <p className="text-[11px] text-slate-400 font-medium mt-0.5">
            브랜드가 진행을 요청한 사람들입니다. 진행하기를 누르면 협업이 만들어지고 브랜드·인플루언서
            진행사항에 함께 표시됩니다.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setMineOnly(v => !v)}
            className={`px-3 py-2 rounded-lg text-[10px] font-black ${
              mineOnly ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            내 캠페인만
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
          >
            새로고침
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">선택 내역을 불러오는 중...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">아직 브랜드가 고른 후보가 없습니다.</p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {mineOnly
              ? '내가 맡은 캠페인에는 선택이 없습니다. 전체로 바꿔 보세요.'
              : '캠페인에 명단을 올리면 브랜드가 이 자리에서 고릅니다.'}
          </p>
        </div>
      ) : (
        groups.map(group => (
          <div key={group.campaignId} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-100 flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">{group.title}</p>
                <p className="text-[11px] text-slate-400 font-bold truncate">
                  {group.brand} · 선택 {group.rows.length}명
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 담당자가 없는 캠페인의 선택은 아무도 답하지 않는다. 눈에 띄게 둔다. */}
                {group.unassigned ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-50 text-amber-600">
                    담당자 없음
                  </span>
                ) : group.mine ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-50 text-blue-600">
                    내 담당
                  </span>
                ) : null}
                {onOpenCampaign && (
                  <button
                    onClick={() => onOpenCampaign(group.campaignId)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200"
                  >
                    캠페인 열기
                  </button>
                )}
              </div>
            </div>

            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch bg-slate-50/60">
              {group.rows.map(pick => {
                const outreach = OUTREACH_BADGE[pick.outreachStatus] || OUTREACH_BADGE.not_sent;
                return (
                  <InfluencerCandidateCard
                    key={pick.id}
                    data={pick}
                    note={pick.managerNote}
                    badges={
                      <>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-50 text-blue-600">
                          브랜드 선택
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${outreach.cls}`}>
                          {outreach.label}
                        </span>
                      </>
                    }
                  >
                    <div className="space-y-2">
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-0.5">
                        <span className="text-[11px] text-slate-700 font-bold">
                          브랜드 제시가{' '}
                          {pick.quotedFee ? `${formatNumberWithCommas(pick.quotedFee)}원` : '협의'}
                        </span>
                        <span className="text-[11px] text-slate-500 font-bold">
                          지급 단가{' '}
                          {pick.payoutFee ? `${formatNumberWithCommas(pick.payoutFee)}원` : '미입력'}
                        </span>
                      </div>

                      {pick.brandDecisionNote && (
                        <p className="text-[11px] text-slate-500 font-medium">
                          브랜드 메모: {pick.brandDecisionNote}
                        </p>
                      )}

                      {/* 지급 단가가 비어 있으면 캠페인 1인 단가가 그대로 계약 금액이
                          된다. 눌러도 되지만, 모르고 누르는 일은 없어야 한다. */}
                      {!pick.payoutFee && (
                        <p className="text-[11px] text-amber-600 font-bold">
                          지급 단가가 비어 있습니다. 캠페인 단가로 협업이 만들어집니다.
                        </p>
                      )}

                      <button
                        onClick={() => startCollab(pick)}
                        disabled={busyId === pick.id}
                        className="w-full px-3.5 py-2 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-500 disabled:opacity-40"
                      >
                        {busyId === pick.id ? '진행 중...' : '진행하기'}
                      </button>
                    </div>
                  </InfluencerCandidateCard>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default ManagerBrandPicksPanel;
