import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

interface HeroProps {
  onSignup: (id: string) => void;
}

const Hero: React.FC<HeroProps> = ({ onSignup }) => {
  const [handle, setHandle] = useState('');

  return (
    <section className="relative pt-24 pb-16 md:pt-48 md:pb-32 container mx-auto px-6 text-center overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[300px] md:w-[600px] h-[300px] md:h-[600px] bg-purple-primary/10 blur-[80px] md:blur-[120px] rounded-full -z-10 animate-pulse"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-5xl mx-auto"
      >
        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-6 md:mb-8">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          <span className="text-slate-400 text-xs font-bold">무신사·올리브영 데이터 기반 트렌드 분석</span>
        </div>

        <h1 className="text-3xl md:text-7xl font-black leading-[1.1] md:leading-[1.05] mb-6 md:mb-8 tracking-tighter text-white font-display">
          일상을 큐레이션하다.<br />
          <span className="text-gradient">단 하나의 링크, PICKS</span>
        </h1>

        <p className="text-sm md:text-xl text-slate-400 mb-8 md:mb-12 max-w-2xl mx-auto leading-relaxed font-medium">
          데이터로 픽하고, 감각적인 그리드 템플릿으로 연결하세요.<br className="hidden md:block" />
          AI 트렌드 분석 · DM 자동화 · 라이브 커머스까지 한번에.
        </p>

        <div className="relative inline-flex flex-col md:flex-row items-center bg-[#11141D] border border-white/5 p-2 md:p-3 rounded-[1.5rem] md:rounded-full w-full md:w-auto shadow-2xl backdrop-blur-xl mb-6 md:mb-8">
          <div className="flex items-center px-4 md:px-6 mb-2 md:mb-0">
            <span className="text-slate-500 font-bold text-base md:text-xl tracking-tight">picks.me/</span>
            <input
              type="text"
              placeholder="yourname"
              className="bg-transparent border-none outline-none text-white text-base md:text-xl font-bold p-2 w-28 md:w-48 placeholder:text-slate-700"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <button
            onClick={() => onSignup(handle)}
            className="w-full md:w-auto bg-gradient-to-r from-purple-primary to-purple-secondary text-white hover:opacity-90 px-8 py-3.5 md:px-10 md:py-4 rounded-[1.2rem] md:rounded-full text-base md:text-lg font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
          >
            바로 만들기
            <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
          </button>
        </div>

        <div className="text-sm font-medium text-slate-500 mb-4">
          이미 <span className="text-purple-primary font-bold">4,281개</span>의 링크가 개설되었습니다
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 md:gap-6 text-[10px] md:text-xs text-slate-600 font-bold">
          <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 무료 시작</span>
          <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 신용카드 불필요</span>
          <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> 실시간 데이터 분석</span>
        </div>
      </motion.div>
    </section>
  );
};

export default Hero;
