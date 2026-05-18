import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-midnight pt-20 pb-12 border-t border-white/5">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between gap-10 md:gap-12 mb-12">
          <div className="max-w-xs">
            <h2 className="text-xl font-black text-white mb-4 tracking-tighter">PICKS</h2>
            <p className="text-slate-500 text-[10px] font-bold leading-relaxed">
              픽스폴리오(Picksfolio)<br />
              일상을 큐레이션하고 스타일을 연결하는<br />
              소셜 커머스 링크 플랫폼.
            </p>
            <p className="text-slate-600 text-[10px] font-medium mt-3">admin@picks.me</p>
          </div>

          <div className="flex flex-wrap gap-10 md:gap-20">
            <div>
              <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-5">LEGAL</h4>
              <ul className="space-y-3">
                <li><a href="/privacy" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">개인정보처리방침</a></li>
                <li><a href="/terms" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">이용약관</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-5">PLATFORM</h4>
              <ul className="space-y-3">
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">Templates</a></li>
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">AI Scout</a></li>
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">라이브 커머스</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-5">COMPANY</h4>
              <ul className="space-y-3">
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">About Us</a></li>
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">Press Kit</a></li>
                <li><a href="/business-signup" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">비즈니스 파트너</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-slate-600 text-[10px] font-medium">
            © 2026 Picksfolio. All rights reserved.
          </div>
          <div className="flex gap-6 text-slate-500 text-[10px] font-bold uppercase tracking-widest">
            <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
