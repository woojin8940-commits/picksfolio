import React, { useState, useCallback, useEffect } from 'react';
import ManagerInfluencerDirectory from './ManagerInfluencerDirectory';
import ManagerCampaignsPanel, { isMyTurn } from './ManagerCampaignsPanel';
import ManagerBrandPicksPanel from './ManagerBrandPicksPanel';
import ManagerChatPanel from './ManagerChatPanel';
import { apiService } from '../../services/apiService';

/**
 * 담당자 대시보드.
 *
 * 운영자가 일반 계정을 담당자로 배정하면 로그인 후 이 화면이 뜬다. 운영 콘솔과
 * 나눠 둔 이유는 권한 범위다. 담당자는 승인·정산·회원 관리를 하지 않는다. 담당자가
 * 하는 일은 인플루언서를 알고, 캠페인에 배정하고, 대화하는 것 셋뿐이므로 메뉴도
 * 넷을 넘기지 않는다. 여기에 운영 탭을 하나씩 얹기 시작하면 결국 운영 콘솔이 두 벌이 된다.
 *
 * 첫 탭이 "브랜드 선택"인 이유는 그것이 유일하게 답을 기다리는 일이기 때문이다.
 * 브랜드가 명단에서 사람을 고르면 그 요청은 캠페인 안쪽 명단에만 남아, 담당자가
 * 캠페인을 하나씩 열어 보기 전에는 아무 데도 뜨지 않았다. 그동안 브랜드 화면에는
 * 아무 변화가 없다. 나머지 탭(인플루언서·캠페인·대화)은 담당자가 찾아가는 자료지만,
 * 이 탭은 담당자를 찾아온 일이다.
 *
 * 인플루언서가 올린 가이드·대본·영상 확인은 별도 메뉴가 아니라 캠페인 안에 있다.
 * 검수는 항상 "어느 캠페인의 누구"에 대한 일이고, 캠페인에서 떼면 담당자가 목록에서
 * 다시 캠페인을 찾아 맞춰 봐야 한다.
 */

interface ManagerDashboardProps {
  username: string;
  displayName?: string;
  onLogout: () => void;
  /**
   * 자기 크리에이터 대시보드로 돌아가는 문. 담당자도 자기 계정을 그대로 쓰는데,
   * 여기에 문이 없으면 로그인 직후 담당자 화면에 도착한 사람은 주소를 직접 고치는
   * 수밖에 없다(크리에이터 대시보드 → 담당자 화면 방향은 버튼이 있다).
   */
  onNavigateCreator?: () => void;
}

type ManagerTab = 'picks' | 'influencers' | 'campaigns' | 'chat';

const TABS: { key: ManagerTab; label: string; hint: string }[] = [
  { key: 'picks', label: '브랜드 선택', hint: '브랜드가 고른 인플루언서 · 진행하기' },
  { key: 'influencers', label: '인플루언서', hint: '카테고리별 전체 명부' },
  { key: 'campaigns', label: '브랜드 캠페인', hint: '캠페인별 배정과 검수' },
  { key: 'chat', label: '대화', hint: '인플루언서 · 브랜드 채널' },
];

const ManagerDashboard: React.FC<ManagerDashboardProps> = ({
  username,
  displayName,
  onLogout,
  onNavigateCreator,
}) => {
  const [tab, setTab] = useState<ManagerTab>('picks');
  const [openCampaignId, setOpenCampaignId] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  /**
   * 탭에 붙는 숫자.
   *
   * 담당자는 한 번에 한 탭만 본다. 캠페인이 몇 건일 때는 탭을 옮겨 다니며 확인할 수
   * 있었지만, 승인된 캠페인이 쌓이면 "다른 탭에 나를 기다리는 일이 있는지"를 알
   * 방법이 탭을 눌러 보는 것뿐이다. 그래서 브랜드가 고른 후보 수와 내 차례인 캠페인
   * 수를 탭 위에 적는다 — 판정은 캠페인 목록의 "내 차례" 묶음과 같은 함수를 쓴다.
   */
  const [badges, setBadges] = useState<{ picks: number; campaigns: number }>({
    picks: 0,
    campaigns: 0,
  });

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  // 탭을 옮길 때마다 다시 센다. 숫자가 바뀌는 시점이 곧 담당자가 무언가를 처리한
  // 직후라, 이때 맞춰 두면 배지가 실제 남은 일과 어긋나 있는 시간이 거의 없다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await apiService.getManagerCampaigns({});
      if (!alive || res.error) return;
      const campaigns = res.campaigns || [];
      const picks = res.brandPicks || [];
      setBadges({
        // 내가 맡은 캠페인의 선택 + 아직 담당자가 없는 캠페인의 선택. 주인 없는
        // 요청도 누군가 집어야 하므로 숫자에 넣는다.
        picks: picks.filter((p: any) => p.mine || p.unassigned).length,
        campaigns: campaigns.filter(
          (c: any) => (c.managerUsername === username || !c.managerUsername) && isMyTurn(c),
        ).length,
      });
    })();
    return () => {
      alive = false;
    };
  }, [tab, username]);

  const active = TABS.find((t) => t.key === tab);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-black text-slate-900 truncate">담당자 대시보드</h1>
              <p className="text-[10px] font-bold text-slate-400 truncate">
                {displayName ? `${displayName} · ` : ''}@{username}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {onNavigateCreator && (
              <button
                onClick={onNavigateCreator}
                className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-all"
              >
                내 대시보드
              </button>
            )}
            <button
              onClick={onLogout}
              className="px-4 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-black hover:bg-red-100 transition-all"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 캠페인 탭만 폭을 넓게 쓴다. 그 안의 진행 보드가 단계를 가로로 늘어놓은
          형태라(BrandCollabProgress) 1280px 에 맞추면 다섯 칸 중 두어 칸만 보이고
          나머지는 가로로 밀어 봐야 한다 — 브랜드 화면이 1560px 를 쓰는 것과 같은
          이유다. 나머지 탭(명부 · 대화)은 지금 폭에 맞춰 만든 목록이라 그대로 둔다. */}
      <div
        className={`mx-auto px-4 md:px-8 py-6 ${tab === 'campaigns' ? 'max-w-[1560px]' : 'max-w-7xl'}`}
      >
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
        <p className="text-[11px] font-bold text-slate-400 mb-5">{active?.hint}</p>

        {tab === 'picks' && (
          <ManagerBrandPicksPanel
            onNotify={notify}
            onOpenCampaign={(campaignId) => {
              setOpenCampaignId(campaignId);
              setTab('campaigns');
            }}
          />
        )}
        {tab === 'influencers' && <ManagerInfluencerDirectory onNotify={notify} />}
        {tab === 'campaigns' && (
          <ManagerCampaignsPanel
            managerUsername={username}
            onNotify={notify}
            initialCampaignId={openCampaignId}
          />
        )}
        {tab === 'chat' && <ManagerChatPanel managerUsername={username} onNotify={notify} />}
      </div>

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

export default ManagerDashboard;
