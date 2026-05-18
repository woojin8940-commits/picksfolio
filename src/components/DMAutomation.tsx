import React, { useState } from 'react';
import { MessageSquare, Bot, Zap, Settings, CheckCircle2, AlertCircle, ToggleLeft as Toggle, ToggleRight, Save } from 'lucide-react';
import { supabase } from '../services/supabase';
import Toast from './Toast';

interface DMAutomationProps {
  userName: string;
}

const DMAutomation: React.FC<DMAutomationProps> = ({ userName }) => {
  const [isEnabled, setIsEnabled] = useState(true);
  const [autoReply, setAutoReply] = useState('안녕하세요! 문의하신 상품 링크입니다: {link_url} \n추가로 궁금하신 점이 있다면 언제든 말씀해주세요! ✨');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  const handleSave = async () => {
    console.log('[DMSave] 시작');
    setIsSaving(true);
    setSaveMessage('');
    
    // 3초 후 강제 로딩 종료 안전장치
    const timeoutId = setTimeout(() => {
      console.warn('[DMSave] 3초 타임아웃 발생 - 로딩 강제 종료');
      setIsSaving(false);
    }, 3000);
    
    try {
      if (!supabase) throw new Error("서버에 연결할 수 없습니다.");
      
      // 세션 상태 강제 확인
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      console.log('[DMSave] 세션 상태:', { session: sessionData.session, error: sessionError });
      
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("로그인이 필요합니다.");

      console.log('[DMSave] 저장 시도...', { isEnabled, autoReply });
      
      // Simulate save or implement actual save logic here
      await new Promise(resolve => setTimeout(resolve, 800));
      
      console.log('[DMSave] 결과: 성공');
      setSaveMessage('템플릿이 저장되었습니다!');
      setShowToast(true);
    } catch (error) {
      console.error('[DMSave] 에러 발생:', error);
      setSaveMessage(error instanceof Error ? error.message : '저장 중 오류가 발생했습니다.');
      setShowToast(true);
    } finally {
      clearTimeout(timeoutId);
      setIsSaving(false);
      console.log('[DMSave] 종료');
    }
  };

  const stats = [
    { label: '오늘 자동 응답', value: '42건', icon: <MessageSquare size={16} /> },
    { label: '성공률', value: '98%', icon: <CheckCircle2 size={16} /> },
    { label: '절약된 시간', value: '2.5시간', icon: <Zap size={16} /> }
  ];

  return (
    <div className="p-4 md:p-14 max-w-5xl mx-auto animate-in fade-in duration-500">
      <header className="flex justify-between items-center mb-10">
        <div>
          <h2 className="text-lg md:text-3xl font-black text-slate-900 mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            DM 자동화 관리 <Bot className="text-purple-600 w-5 h-5 md:w-6 md:h-6" />
          </h2>
          <p className="text-slate-500 font-medium text-[10px] md:text-base">인스타그램 DM으로 들어오는 상품 문의에 AI가 자동으로 답변합니다.</p>
        </div>
        <button 
          onClick={() => setIsEnabled(!isEnabled)}
          className={`flex items-center gap-3 px-6 py-3 rounded-2xl font-black transition-all ${
            isEnabled ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' : 'bg-slate-200 text-slate-500'
          }`}
        >
          {isEnabled ? <ToggleRight size={24} /> : <Toggle size={24} />}
          <span>{isEnabled ? '자동화 활성화됨' : '자동화 비활성'}</span>
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <div className="text-purple-600 mb-3">{stat.icon}</div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-2xl font-black text-slate-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="space-y-8">
          <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Settings size={20} className="text-purple-600" /> 자동 응답 템플릿
            </h3>
            <div className="space-y-4">
              <p className="text-xs font-bold text-slate-500 leading-relaxed">
                사용자가 특정 키워드(예: "정보요", "링크주세요")를 포함한 DM을 보내면 아래 문구와 함께 해당 상품 링크가 전송됩니다.
              </p>
              <textarea 
                value={autoReply}
                onChange={e => setAutoReply(e.target.value)}
                rows={6}
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4 font-bold focus:outline-none focus:border-purple-600 transition-colors resize-none text-sm"
              />
              <div className="flex gap-2">
                <span className="bg-purple-50 text-purple-600 px-3 py-1 rounded-lg text-[10px] font-black border border-purple-100">{"{link_url}"} : 상품 링크</span>
                <span className="bg-purple-50 text-purple-600 px-3 py-1 rounded-lg text-[10px] font-black border border-purple-100">{"{user_name}"} : 상대방 이름</span>
              </div>
            </div>
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={18} />
              )}
              <span>{isSaving ? '저장 중...' : '저장하기'}</span>
            </button>
            {saveMessage && (
              <p className="text-center mt-4 font-bold text-sm text-emerald-500 animate-in fade-in slide-in-from-bottom-2">
                {saveMessage}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-indigo-50 p-10 rounded-[2.5rem] border border-indigo-100">
            <h3 className="text-lg font-black text-indigo-900 mb-6 flex items-center gap-2">
              <Zap size={20} className="text-indigo-600" /> 최근 자동 응답 내역
            </h3>
            <div className="space-y-4">
              <HistoryItem user="kim_style" time="2분 전" message="이 가방 정보 좀 알 수 있을까요?" />
              <HistoryItem user="lee_fashion" time="15분 전" message="셔츠 링크 부탁드려요!" />
              <HistoryItem user="park_daily" time="1시간 전" message="정보요!!" />
            </div>
            <button className="w-full mt-6 text-indigo-600 font-black text-xs hover:underline">전체 내역 보기</button>
          </div>

          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-start gap-4">
            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center flex-shrink-0">
              <AlertCircle size={24} />
            </div>
            <div>
              <h4 className="font-black text-slate-900 mb-1">인스타그램 계정 연결 확인</h4>
              <p className="text-xs font-medium text-slate-500 leading-tight">
                현재 @{userName} 계정과 정상적으로 연동되어 있습니다. 연동 해제 시 자동화 기능이 중단됩니다.
              </p>
            </div>
          </div>
        </div>
      </div>
      <Toast 
        message={saveMessage} 
        isVisible={showToast} 
        onClose={() => setShowToast(false)} 
      />
    </div>
  );
};

const HistoryItem: React.FC<{ user: string; time: string; message: string }> = ({ user, time, message }) => (
  <div className="bg-white p-4 rounded-2xl shadow-sm border border-indigo-50 flex justify-between items-center">
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-black text-xs text-slate-900">{user}</span>
        <span className="text-[10px] font-bold text-slate-400">{time}</span>
      </div>
      <p className="text-[10px] font-medium text-slate-500 truncate max-w-[150px]">{message}</p>
    </div>
    <div className="bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg text-[8px] font-black uppercase">Sent</div>
  </div>
);

export default DMAutomation;
