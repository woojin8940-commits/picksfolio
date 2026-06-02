
import React, { useState } from 'react';
import { motion } from 'motion/react';

interface HeroProps {
  onSignup: (id: string) => void;
}

const Hero: React.FC<HeroProps> = ({ onSignup }) => {
  const [handle, setHandle] = useState('');

  return (
    <section className="relative pt-20 pb-12 md:pt-32 md:pb-24 container mx-auto px-4 sm:px-6 text-center overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[300px] md:w-[600px] h-[300px] md:h-[600px] bg-blue-primary/10 blur-[80px] md:blur-[120px] rounded-full -z-10 animate-pulse"></div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-5xl mx-auto"
      >
        <h1 className="text-3xl md:text-[4.5rem] font-black leading-[1.1] md:leading-[1.05] mb-6 md:mb-8 tracking-tighter text-white font-display">
          일상을 큐레이션하다.<br />
          <span className="text-gradient">단 하나의 링크, PICKS</span>
        </h1>

        <p className="text-base md:text-lg text-slate-400 mb-8 md:mb-10 max-w-3xl mx-auto leading-relaxed font-medium">
          데이터로 픽하고, 감각적인 그리드 템플릿으로 연결하세요.
        </p>

        <div className="relative inline-flex flex-col md:flex-row items-stretch md:items-center bg-[#11141D] border border-white/5 p-3 md:p-3 rounded-[1.5rem] md:rounded-full w-full md:w-auto shadow-2xl backdrop-blur-xl mb-8 md:mb-10">
          <div className="flex items-center px-3 md:px-6 mb-2 md:mb-0">
            <span className="text-slate-500 font-bold text-base md:text-lg tracking-tight whitespace-nowrap">picks.me/</span>
            <input
              type="text"
              placeholder="yourname"
              className="bg-transparent border-none outline-none text-white text-base md:text-lg font-bold p-2 flex-1 min-w-0 md:flex-none md:w-44 placeholder:text-slate-700"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <button
            onClick={() => onSignup(handle)}
            className="w-full md:w-auto bg-gradient-to-r from-blue-primary to-blue-secondary text-white hover:opacity-90 px-8 py-3.5 md:px-10 md:py-4 rounded-[1.2rem] md:rounded-full text-base md:text-lg font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
          >
            바로 만들기
          </button>
        </div>

        <div className="text-sm md:text-base font-medium text-slate-500">
          이미 <span className="text-blue-primary font-bold">4,281개</span>의 링크가 개설되었습니다
        </div>
      </motion.div>
    </section>
  );
};

export default Hero;
