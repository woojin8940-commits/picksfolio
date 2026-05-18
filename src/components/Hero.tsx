import React, { useState } from 'react';
import { motion } from 'motion/react';

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
        <h1 className="text-3xl md:text-7xl font-black leading-[1.1] md:leading-[1.05] mb-6 md:mb-8 tracking-tighter text-white font-display">
          일상을 큐레이션하다.<br />
          <span className="text-gradient">단 하나의 링크, PICKS</span>
        </h1>

        <p className="text-sm md:text-xl text-slate-400 mb-8 md:mb-12 max-w-2xl mx-auto leading-relaxed font-medium">
          데이터로 픽하고, 감각적인 그리드 템플릿으로 연결하세요.
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
            onClick={() => {
              if (!handle.trim()) {
                onSignup('');
                return;
              }
              onSignup(handle.trim());
            }}
            className="w-full md:w-auto bg-gradient-to-r from-purple-primary to-purple-secondary text-white hover:opacity-90 px-8 py-3.5 md:px-10 md:py-4 rounded-[1.2rem] md:rounded-full text-base md:text-lg font-bold transition-all active:scale-95 flex items-center justify-center shadow-lg shadow-purple-500/20"
          >
            바로 만들기
          </button>
        </div>

        <div className="text-sm font-medium text-slate-500">
          이미 <span className="text-purple-primary font-bold">4,281개</span>의 링크가 개설되었습니다
        </div>
      </motion.div>
    </section>
  );
};

export default Hero;
