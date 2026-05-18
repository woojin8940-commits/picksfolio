import React, { useState } from 'react';
import { ArrowLeft, CreditCard, Bell, Shield, LogOut } from 'lucide-react';

interface SettingsPageProps {
  userName: string;
  onNavigateBack: () => void;
  onNavigateMembership: () => void;
  onLogout: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ userName, onNavigateBack, onNavigateMembership, onLogout }) => {
  const [liveNotifyConsent, setLiveNotifyConsent] = useState(() => localStorage.getItem('picks_live_consent') === 'true');
  const [notifyConsent, setNotifyConsent] = useState(() => localStorage.getItem('picks_notify_consent') === 'true');

  const handleToggleLiveNotify = () => {
    const next = !liveNotifyConsent;
    setLiveNotifyConsent(next);
    localStorage.setItem('picks_live_consent', String(next));
  };

  const handleToggleNotify = () => {
    const next = !notifyConsent;
    setNotifyConsent(next);
    localStorage.setItem('picks_notify_consent', String(next));
  };

  const handleDeleteAccount = () => {
    if (window.confirm('정말로 계정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      if (window.confirm('삭제된 계정과 데이터는 복구할 수 없습니다. 계속하시겠습니까?')) {
        alert('계정 삭제 요청이 접수되었습니다. 관리자 확인 후 처리됩니다.\n문의: privacy@picks-folio.com');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="container mx-auto px-6 py-8 max-w-2xl">
        <button onClick={onNavigateBack} className="flex items-center gap-2 text-slate-400 hover:text-slate-900 transition-colors mb-8">
          <ArrowLeft size={20} strokeWidth={3} />
          <span className="text-sm font-bold">돌아가기</span>
        </button>

        <h1 className="text-2xl font-black text-slate-900 mb-8">설정</h1>

        {/* Profile Section */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-4">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xl font-black">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900">{userName}</h3>
              <p className="text-slate-400 text-sm font-medium">picks-folio.com/{userName}</p>
            </div>
          </div>
        </div>

        {/* Membership Section */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-4">
          <button
            onClick={onNavigateMembership}
            className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <CreditCard size={20} className="text-purple-600" />
              </div>
              <div className="text-left">
                <h4 className="text-sm font-black text-slate-900">멤버십 관리</h4>
                <p className="text-slate-400 text-xs font-medium">구독 플랜 변경 및 결제 관리</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg>
          </button>
        </div>

        {/* Notification Section */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-4">
          <h3 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
            <Bell size={16} className="text-slate-600" />
            알림 설정
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">라이브 알림톡 수신</p>
                <p className="text-xs text-slate-400 font-medium">라이브 방송 시작 시 카카오 알림톡 발송</p>
              </div>
              <button
                onClick={handleToggleLiveNotify}
                className={`w-12 h-7 rounded-full transition-all relative ${liveNotifyConsent ? 'bg-purple-600' : 'bg-slate-200'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-1 transition-all ${liveNotifyConsent ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">협업 제안 알림</p>
                <p className="text-xs text-slate-400 font-medium">새로운 브랜드 협업 제안 알림</p>
              </div>
              <button
                onClick={handleToggleNotify}
                className={`w-12 h-7 rounded-full transition-all relative ${notifyConsent ? 'bg-purple-600' : 'bg-slate-200'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-1 transition-all ${notifyConsent ? 'right-1' : 'left-1'}`}></div>
              </button>
            </div>
          </div>
        </div>

        {/* Privacy Section */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mb-4">
          <a
            href="/privacy"
            target="_blank"
            className="w-full flex items-center justify-between p-6 hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center">
                <Shield size={20} className="text-slate-600" />
              </div>
              <div className="text-left">
                <h4 className="text-sm font-black text-slate-900">개인정보처리방침</h4>
                <p className="text-slate-400 text-xs font-medium">개인정보 수집·이용 및 처리 방침</p>
              </div>
            </div>
            <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"></path></svg>
          </a>
        </div>

        {/* Logout & Delete */}
        <div className="space-y-3 mt-8">
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-4 rounded-2xl font-black text-sm hover:bg-slate-800 transition-all"
          >
            <LogOut size={18} />
            로그아웃
          </button>
          <button
            onClick={handleDeleteAccount}
            className="w-full text-center text-red-400 text-xs font-bold py-3 hover:text-red-500 transition-colors"
          >
            회원 탈퇴
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
