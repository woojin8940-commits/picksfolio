import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-midnight pt-24 pb-12 border-t border-white/5">
      <div className="container mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between gap-12 mb-16">
          <div className="max-w-xs">
            <h2 className="text-xl font-black text-white mb-6 tracking-tighter">PICKS</h2>
            <p className="text-slate-500 text-[10px] font-bold leading-relaxed">
              일상을 큐레이션하고 스타일을 연결하는<br />자세한 소셜 커머스 링크 플랫폼.
            </p>
          </div>
          
          <div className="flex gap-16 md:gap-24">
            <div>
              <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-6">PLATFORM</h4>
              <ul className="space-y-4">
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">Templates</a></li>
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">AI Scout</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white text-[10px] font-black uppercase tracking-widest mb-6">COMPANY</h4>
              <ul className="space-y-4">
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">About Us</a></li>
                <li><a href="#" className="text-slate-500 hover:text-white text-[10px] font-bold transition-colors">Press Kit</a></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
