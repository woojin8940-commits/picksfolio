import React, { useState, useCallback, useEffect } from 'react';
import ManagerCampaignsPanel, { isMyTurn } from '../manager/ManagerCampaignsPanel';
import ManagerBrandPicksPanel from '../manager/ManagerBrandPicksPanel';
import ManagerInfluencerDirectory from '../manager/ManagerInfluencerDirectory';
import ManagerChatPanel from '../manager/ManagerChatPanel';
import { apiService } from '../../services/apiService';

/**
 * 운영 콘솔 안의 담당자 업무 — 담당자 대시보드와 같은 화면을 운영자가 직접 쓴다.
 *
 * 초기에는 담당자 계정 없이 운영자가 캠페인 배정부터 검수 · 정산까지 모두 맡는다.
 * 예전 운영 콘솔의 리스트업 탭은 명단을 만드는 데까지만 할 수 있어서, 브랜드가 고른
 * 후보로 협업을 시작하거나 · 캠페인을 맡거나 · 진행 보드에서 검수하려면 담당자
 * 화면으로 건너가야 했다. 그래서 담당자 대시보드의 패널을 그대로 가져온다 — 따로
 * 만들면 같은 캠페인이 두 화면에서 다르게 보이고, 담당자 화면을 고칠 때 이쪽이 뒤처진다.
 *
 * 서버는 운영자를 담당자로 인정한다(_shared/manager-auth 의 resolveIdentities).
 * 이 화면에서 "맡기"를 누르면 운영자 아이디가 캠페인 담당자로 남는다.
 */

type WorkTab = 'picks' | 'campaigns' | 'influencers' | 'chat';

const TABS: { key: WorkTab; label: string; hint: string }[] = [
  { key: 'picks', label: '브랜드 선택', hint: '브랜드가 고른 인플루언서 · 금액 확인 후 협업 시작' },
  { key: 'campaigns', label: '캠페인 배정 · 진행', hint: '캠페인을 맡고 · 후보를 명단에 올려 제안하고 · 진행 · 검수 · 정산까지' },
  { key: 'influencers', label: '인플루언서 명부', hint: '카테고리별 전체 명부' },
  { key: 'chat', label: '대화', hint: '인플루언서 · 브랜드 채널' },
];

const AdminManagerWorkspace: React.FC = () => {
  const [tab, setTab] = useState<WorkTab>('campaigns');
  const [openCampaignId, setOpenCampaignId] = useState('');
  // 서버가 이 운영자를 어떤 담당자 아이디로 보는지. "내 담당" 판정이 이 값과 맞아야 한다.
  const [managerUsername, setManagerUsername] = useState('');
  const [authError, setAuthError] = useState('');
  const [badges, setBadges] = useState<{ picks: number; campaigns: number }>({ picks: 0, campaigns: 0 });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await apiService.getManagerCampaigns({});
      if (!alive) return;
      if (res.error) {
        setAuthError(res.error);
        return;
      }
      setAuthError('');
      const me = res.managerUsername || '';
      setManagerUsername(me);
      const campaigns = res.campaigns || [];
      const picks = res.brandPicks || [];
      setBadges({
        picks: picks.filter((p: any) => p.mine || p.unassigned).length,
        campaigns: campaigns.filter(
          (c: any) => (c.managerUsername === me || !c.managerUsername) && isMyTurn(c),
        ).length,
      });
    })();
    return () => {
      alive = false;
    };
  }, [tab]);

  const active = TABS.find((t) => t.key === tab);

  if (authError && !managerUsername) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 p-8 text-center">
        <p className="text-sm font-black text-red-500">{authError}</p>
        <p className="mt-1 text-[11px] font-medium text-slate-400">
          운영자 계정으로 다시 로그인한 뒤 열어 주세요.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 rounded-xl font-black text-sm transition-all flex items-center gap-1.5 ${
              tab === t.key
                ? 'bg-slate-900 text-white shadow-lg'
                : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
            }`}
          >
            {t.label}
            {(t.key === 'picks' || t.key === 'campaigns') && badges[t.key] > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                  tab === t.key ? 'bg-white/20 text-white' : 'bg-red-50 text-red-500'
                }`}
              >
                {badges[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="text-[11px] font-bold text-slate-400 mb-5">
        {active?.hint}
        {managerUsername ? ` · 담당자 아이디 @${managerUsername}` : ''}
      </p>

      {tab === 'picks' && (
        <ManagerBrandPicksPanel
          onNotify={notify}
          onOpenCampaign={(campaignId) => {
            setOpenCampaignId(campaignId);
            setTab('campaigns');
          }}
        />
      )}
      {tab === 'campaigns' && managerUsername && (
        <ManagerCampaignsPanel
          managerUsername={managerUsername}
          onNotify={notify}
          initialCampaignId={openCampaignId}
        />
      )}
      {tab === 'influencers' && <ManagerInfluencerDirectory onNotify={notify} />}
      {tab === 'chat' && managerUsername && (
        <ManagerChatPanel managerUsername={managerUsername} onNotify={notify} />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-2xl shadow-xl text-xs font-black ${
            toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-slate-900 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default AdminManagerWorkspace;
