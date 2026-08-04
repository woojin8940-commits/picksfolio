import React, { useState, useEffect, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import { isManagerListupMode, rewardModeOf } from '../../utils/campaignBrief';
import ListupWorkspace from '../collab/ListupWorkspace';

/**
 * 담당자 리스트업 콘솔(운영 콘솔 탭) — 캠페인을 고르는 자리.
 *
 * 후보를 올리고 제안하는 일 자체는 ListupWorkspace 가 한다. 담당자 대시보드도 같은
 * 작업대를 쓰기 때문에 두 벌로 두지 않는다. 두 벌이 되는 순간 브랜드 카드에 찍히는
 * 값이 어느 화면에서 올렸느냐에 따라 달라진다.
 *
 * 여기 남은 것은 운영 콘솔에만 있는 부분이다. 관리자 토큰으로 승인된 캠페인 전체를
 * 불러와 드롭다운으로 고르는 것 — 담당자 대시보드는 자기 캠페인 카드를 눌러 들어온다.
 */

interface AdminCampaignListupProps {
  token: string;
}

const AdminCampaignListup: React.FC<AdminCampaignListupProps> = ({ token }) => {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignId, setCampaignId] = useState('');

  // 승인된 캠페인만 리스트업 대상으로 노출한다. 승인 전 후보를 먼저 만들면
  // 브랜드가 볼 수 없는 캠페인에 운영 작업이 쌓이므로 승인과 리스트업 순서를 고정한다.
  //
  // 제품 협찬형은 목록에서 아예 뺀다. 지원자만 받는 방식이라 리스트업 자리가 없고,
  // 골라 들어가도 후보를 올릴 수 없다 — 고를 수 있는데 아무것도 못 하는 선택지는
  // 담당자가 서버 거절을 보고 나서야 이유를 알게 된다.
  useEffect(() => {
    (async () => {
      const res = await apiService.getAdminCampaigns(token);
      const list = (res.campaigns || [])
        .filter((c: any) => c.status === 'active' && isManagerListupMode(c.reward_mode))
        .sort((a: any, b: any) => {
          const aAssigned = a.manager_username ? 1 : 0;
          const bAssigned = b.manager_username ? 1 : 0;
          if (aAssigned !== bAssigned) return aAssigned - bAssigned;
          return new Date(b.admin_approved_at || b.created_at).getTime()
            - new Date(a.admin_approved_at || a.created_at).getTime();
        });
      setCampaigns(list);
    })();
  }, [token]);

  const selected = useMemo(
    () => campaigns.find((c) => c.id === campaignId) || null,
    [campaigns, campaignId],
  );

  return (
    <div className="space-y-4">
      {/* 캠페인 선택 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900">리스트업</h3>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
                승인 캠페인 {campaigns.length}건
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              캠페인을 고르면 후보 풀에서 명단을 만들고, 브랜드가 고른 후보에게 조건을 담아 제안합니다.
              제품 협찬형은 지원자만 받으므로 목록에 없습니다.
            </p>
          </div>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400 max-w-full"
          >
            <option value="">캠페인 선택...</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.brand_name || c.business_username}
                {c.manager_username ? ` (담당 @${c.manager_username})` : ' (담당자 없음)'}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div className="mt-3 bg-slate-50 rounded-xl px-4 py-3 flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-[11px] text-slate-600 font-bold">
              진행 방식 {rewardModeOf(selected.reward_mode).label}
            </span>
            <span className="text-[11px] text-slate-600 font-bold">
              보상 {selected.reward_amount ? formatKoreanWon(selected.reward_amount) : '미정'}
            </span>
            {selected.upload_channel && (
              <span className="text-[11px] text-slate-500 font-bold">채널 {selected.upload_channel}</span>
            )}
            {selected.content_format && (
              <span className="text-[11px] text-slate-500 font-bold">형식 {selected.content_format}</span>
            )}
            {selected.upload_from && (
              <span className="text-[11px] text-slate-500 font-bold">
                희망 게시 {selected.upload_from}
                {selected.upload_to ? ` ~ ${selected.upload_to}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {!campaignId ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">
            {campaigns.length > 0 ? '승인된 캠페인을 먼저 선택해 주세요.' : '리스트업할 승인 캠페인이 없습니다.'}
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {campaigns.length > 0
              ? '담당자가 없는 캠페인은 목록 위쪽에 표시됩니다.'
              : '광고비 지급형·공동구매형 캠페인을 승인하면 이 목록에 올라옵니다.'}
          </p>
        </div>
      ) : (
        <ListupWorkspace campaignId={campaignId} token={token} />
      )}
    </div>
  );
};

export default AdminCampaignListup;
