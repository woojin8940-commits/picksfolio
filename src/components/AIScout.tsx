import React, { useState } from 'react';
import { Radar, RefreshCw, ArrowUpRight } from 'lucide-react';

const AIScout: React.FC = () => {
  const [activePlatform, setActivePlatform] = useState('MUSINSA');

  const platforms = ['MUSINSA', 'OLIVE YOUNG', '29CM', 'KREAM'];
  const keywords = [
    { id: '01', tag: 'UP', keyword: '#바시티 자켓', category: '아우터', desc: '"AI 분석: 간절기 필수 아이템으로 클래식 무드 강화 중"' },
    { id: '02', tag: 'NEW', keyword: '#글로시 숏패딩', category: '아우터', desc: '"AI 분석: 유광 소재에 대한 1020 세대의 관심도 폭발"' },
    { id: '03', tag: 'UP', keyword: '#워크웨어 팬츠', category: '하의', desc: '"AI 분석: 투박한 워크웨어 브랜드의 대중화 현상"' },
    { id: '04', tag: 'UP', keyword: '#레드 가디건', category: '상의', desc: '"AI 분석: 올 시즌 키 컬러인 레드가 포인트 컬러로 부상"' },
    { id: '05', tag: 'DOWN', keyword: '#어그 부츠', category: '신발', desc: '"AI 분석: 겨울 시즌 종료에 따른 리셀 곡선 진입"' },
  ];

  return (
    <section className="py-24 md:py-40 bg-midnight overflow-hidden relative">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-[#7C3AED] text-[10px] font-black uppercase tracking-[0.2em] mb-8">
              <Radar size={12} /> AI TREND SCOUT
            </div>
            <h2 className="text-4xl md:text-[56px] font-black text-white leading-[1.1] mb-8 tracking-tight">
              모든 플랫폼의<br />
              <span className="text-[#7C3AED]">데이터를 한 눈에.</span>
            </h2>
            <p className="text-slate-400 font-medium max-w-xl text-lg opacity-80">
              무신사, 올리브영, 29CM, KREAM의 실시간 급상승 키워드를 AI가 분석하여 당신의 큐레이션에 필요한 인사이트를 제안합니다.
            </p>
          </div>
          <button className="flex items-center gap-2 bg-[#121217] hover:bg-white/10 border border-white/5 px-8 py-4 rounded-full text-white text-sm font-black transition-all">
            <RefreshCw size={14} className="text-[#7C3AED]" /> 실시간 데이터 새로고침
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Platform Sidebar */}
          <div className="lg:col-span-3 flex flex-row lg:flex-col gap-4">
            {platforms.map(platform => (
              <button
                key={platform}
                onClick={() => setActivePlatform(platform)}
                className={`flex-1 lg:flex-none p-8 rounded-[2rem] border transition-all text-left ${activePlatform === platform ? 'bg-[#7C3AED] border-[#7C3AED] text-white shadow-2xl shadow-purple-900/30' : 'bg-[#121217] border-white/5 text-slate-500 hover:border-white/10'}`}
              >
                <p className="text-[10px] font-black uppercase opacity-50 mb-3 tracking-widest">PLATFORM</p>
                <p className="text-xl font-black tracking-tight">{platform}</p>
              </button>
            ))}
          </div>

          {/* Keywords Panel */}
          <div className="lg:col-span-9 bg-[#121217] border border-white/5 rounded-[3.5rem] p-8 md:p-14 relative overflow-hidden">
            <div className="flex items-center justify-between mb-12">
              <h3 className="text-2xl font-black text-white flex items-center gap-4">
                {activePlatform} Hot Keywords <span className="text-[11px] bg-slate-800 px-3 py-1 rounded-md text-slate-400 font-bold">TOP 5</span>
              </h3>
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
                <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em]">LIVE SYNC ACTIVE</span>
              </div>
            </div>

            <div className="space-y-8">
              {keywords.map((item) => (
                <div key={item.id} className="group flex flex-col md:flex-row items-start md:items-center justify-between p-4 md:p-6 rounded-3xl hover:bg-white/[0.02] transition-all border border-transparent hover:border-white/5">
                  <div className="flex items-center gap-8 mb-4 md:mb-0">
                    <span className="text-4xl md:text-5xl font-black text-slate-800 italic group-hover:text-slate-700 transition-colors tracking-tighter">{item.id}</span>
                    <div>
                      <div className="flex items-center gap-4 mb-2">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-md ${item.tag === 'UP' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : item.tag === 'NEW' ? 'bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20' : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'}`}>
                          {item.tag}
                        </span>
                        <h4 className="text-xl md:text-2xl font-black text-white tracking-tight">{item.keyword}</h4>
                        <span className="text-sm font-bold text-slate-600">{item.category}</span>
                      </div>
                      <p className="text-sm md:text-base font-medium text-slate-500 italic opacity-80">{item.desc}</p>
                    </div>
                  </div>
                  <button className="w-full md:w-auto flex items-center justify-center gap-3 bg-[#1A1A1E] hover:bg-slate-800 text-white px-6 py-3 rounded-2xl text-sm font-black transition-all border border-white/5">
                    관련 상품 보기 <ArrowUpRight size={16} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-16 pt-10 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-10 h-10 rounded-full border-2 border-midnight bg-slate-800 overflow-hidden shadow-lg">
                      <img src={`https://i.pravatar.cc/100?u=${i}`} alt="avatar" referrerPolicy="no-referrer" />
                    </div>
                  ))}
                </div>
                <p className="text-sm font-medium text-slate-500">
                  현재 <span className="text-white font-bold">428명</span> 큐레이터가 이 데이터를 활용하고 있습니다.
                </p>
              </div>
              <button className="w-full md:w-auto bg-white text-black hover:bg-slate-100 px-10 py-4 rounded-2xl text-base font-black flex items-center justify-center gap-3 transition-all shadow-xl">
                이 트렌드로 큐레이션 시작
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AIScout;
