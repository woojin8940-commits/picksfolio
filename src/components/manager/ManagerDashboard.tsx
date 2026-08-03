import React, { useState, useCallback } from 'react';
import ManagerInfluencerDirectory from './ManagerInfluencerDirectory';
import ManagerCampaignsPanel from './ManagerCampaignsPanel';
import ManagerChatPanel from './ManagerChatPanel';

/**
 * 담당자 대시보드.
 *
 * 운영자가 일반 계정을 담당자로 배정하면 로그인 후 이 화면이 뜬다. 운영 콘솔과
 * 나눠 둔 이유는 권한 범위다. 담당자는 승인·정산·회원 관리를 하지 않는다. 담당자가
 * 하는 일은 인플루언서를 알고, 캠페인에 배정하고, 대화하는 것 셋뿐이므로 메뉴도
 * 셋만 둔다. 여기에 운영 탭을 하나씩 얹기 시작하면 결국 운영 콘솔이 두 벌이 된다.
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

type ManagerTab = 'influencers' | 'campaigns' | 'chat';

const TABS: { key: ManagerTab; label: string; hint: string }[] = [
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
  const [tab, setTab] = useState<ManagerTab>('campaigns');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

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

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <div className="flex gap-2 mb-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 rounded-xl font-black text-sm transition-all ${
                tab === t.key
                  ? 'bg-slate-900 text-white shadow-lg'
                  : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] font-bold text-slate-400 mb-5">{active?.hint}</p>

        {tab === 'influencers' && <ManagerInfluencerDirectory onNotify={notify} />}
        {tab === 'campaigns' && (
          <ManagerCampaignsPanel managerUsername={username} onNotify={notify} />
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
