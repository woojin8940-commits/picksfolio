
import React, { useState } from 'react';
import { Users, MessageSquare, DollarSign, Settings, Calendar, Info, Camera } from 'lucide-react';
import LiveStreaming from './LiveStreaming';

interface LiveCommerceManagementProps {
  userName: string;
}

const LiveCommerceManagement: React.FC<LiveCommerceManagementProps> = ({ userName }) => {
  const [showLiveStream, setShowLiveStream] = useState(false);

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-10">
        <div>
          <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-1 md:mb-2">라이브 커머스</h2>
          <p className="text-slate-500 font-medium text-[10px] md:text-base">실시간 방송으로 팬들과 소통하세요.</p>
        </div>
        <button
          onClick={() => setShowLiveStream(true)}
          className="bg-slate-900 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl md:rounded-2xl font-black text-sm md:text-lg hover:bg-slate-800 transition-all shadow-xl shadow-slate-500/20 flex items-center gap-2 md:gap-3 active:scale-95"
        >
          <Settings className="w-4 h-4 md:w-6 md:h-6" />
          방송 설정
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-8 mb-6 md:mb-10">
        {/* Camera Preview Card - Now Static until started */}
        <div className="lg:col-span-2 bg-slate-900 rounded-2xl md:rounded-[2.5rem] overflow-hidden relative group aspect-video lg:aspect-auto flex items-center justify-center">
          <div className="absolute inset-0">
            <img
              src="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80"
              alt="Studio"
              className="w-full h-full object-cover opacity-40"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />

          <div className="relative z-10 text-center space-y-4">
            <div className="w-20 h-20 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center mx-auto text-white/40">
              <Camera size={40} />
            </div>
            <p className="text-white/60 font-black uppercase tracking-widest text-xs">방송 시작 시 카메라가 활성화됩니다</p>
          </div>

          <div className="absolute bottom-4 md:bottom-8 left-4 md:left-8 right-4 md:right-8 flex items-center justify-between">
            <div>
              <h4 className="text-white text-sm md:text-xl font-black mb-0.5 md:mb-1">방송 준비</h4>
              <p className="text-white/60 text-[10px] md:text-sm font-medium">상단의 '방송 설정' 버튼을 눌러주세요.</p>
            </div>
          </div>
        </div>

        {/* Stats Column */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mb-4">
              <Users size={24} />
            </div>
            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">누적 시청자</p>
            <h3 className="text-3xl font-black text-slate-900">0명</h3>
          </div>
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600 mb-4">
              <MessageSquare size={24} />
            </div>
            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">평균 채팅 수</p>
            <h3 className="text-3xl font-black text-slate-900">0개</h3>
          </div>
          <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-sm">
            <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-600 mb-4">
              <DollarSign size={24} />
            </div>
            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">총 판매액</p>
            <h3 className="text-3xl font-black text-slate-900">₩0</h3>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8">
        <section className="bg-white p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4 md:mb-8">
            <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
              <Settings className="w-4 h-4 md:w-5 md:h-5 text-slate-400" /> 방송 설정
            </h4>
          </div>

          <div className="space-y-4 md:space-y-6">
            <div>
              <label className="block text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 md:mb-2">방송 제목</label>
              <input
                type="text"
                placeholder="제목을 입력하세요"
                className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 md:py-4 px-4 md:px-6 text-sm md:text-slate-900 font-bold outline-none focus:border-purple-500/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 md:mb-2">방송 카테고리</label>
              <select className="w-full bg-slate-50 border border-slate-100 rounded-xl py-3 md:py-4 px-4 md:px-6 text-sm md:text-slate-900 font-bold outline-none focus:border-purple-500/50 transition-all appearance-none">
                <option>패션/스타일</option>
                <option>뷰티/메이크업</option>
                <option>라이프스타일</option>
                <option>기타</option>
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4 md:mb-8">
            <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
              <Calendar className="w-4 h-4 md:w-5 md:h-5 text-slate-400" /> 방송 예약
            </h4>
          </div>

          <div className="flex flex-col items-center justify-center py-6 md:py-10 text-center">
            <div className="w-12 h-12 md:w-20 md:h-20 bg-slate-50 rounded-full flex items-center justify-center text-xl md:text-3xl mb-3 md:mb-4">
              📅
            </div>
            <p className="text-slate-500 font-bold text-xs md:text-base mb-4 md:mb-6">예약된 방송이 없습니다.</p>
            <button className="text-purple-600 font-black text-[10px] md:text-sm hover:underline">새로운 방송 예약하기</button>
          </div>
        </section>
      </div>

      <div className="mt-10 bg-blue-50 p-8 rounded-[2rem] border border-blue-100 flex items-start gap-6">
        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-blue-600 shadow-sm shrink-0">
          <Info size={24} />
        </div>
        <div>
          <h5 className="font-black text-blue-900 mb-1">라이브 커머스 팁</h5>
          <p className="text-blue-700 text-sm font-medium leading-relaxed">
            방송 시작 전 조명과 마이크 상태를 꼭 확인해 주세요. 시청자들과 활발하게 소통할수록 판매 전환율이 높아집니다!
          </p>
        </div>
      </div>

      {/* Live Stream Overlay */}
      {showLiveStream && (
        <LiveStreaming
          userName={userName}
          onClose={() => setShowLiveStream(false)}
        />
      )}
    </div>
  );
};

export default LiveCommerceManagement;
