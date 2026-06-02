import React from 'react';

interface FooterProps {
  onNavigateTerms?: () => void;
  onNavigatePrivacy?: () => void;
}

const Footer: React.FC<FooterProps> = ({ onNavigateTerms, onNavigatePrivacy }) => {
  return (
    <footer className="bg-midnight pt-16 md:pt-20 pb-12 border-t border-white/5">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row justify-between gap-10 md:gap-12 mb-10 md:mb-12">
          <div className="max-w-xs">
            <h2 className="text-2xl font-black text-white mb-6 md:mb-8 tracking-tighter">PICKS</h2>
            <p className="text-slate-500 text-sm font-bold leading-relaxed">
              일상을 큐레이션하고 스타일을 연결하는<br />자세한 소셜 커머스 링크 플랫폼.
            </p>
          </div>

          <div className="flex gap-10 md:gap-24">
            <div>
              <h4 className="text-white text-sm font-black uppercase tracking-widest mb-6">PLATFORM</h4>
              <ul className="space-y-4">
                <li><a href="#" className="text-slate-500 hover:text-white text-sm font-bold transition-colors">Templates</a></li>
                <li><a href="#" className="text-slate-500 hover:text-white text-sm font-bold transition-colors">AI Scout</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white text-sm font-black uppercase tracking-widest mb-6">COMPANY</h4>
              <ul className="space-y-4">
                <li><a href="#" className="text-slate-500 hover:text-white text-sm font-bold transition-colors">About Us</a></li>
                <li><a href="#" className="text-slate-500 hover:text-white text-sm font-bold transition-colors">Press Kit</a></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Business Information */}
        <div className="border-t border-white/5 pt-8">
          <div className="space-y-2">
            <p className="text-slate-500 text-sm font-bold">
              <span className="text-slate-400 font-black">상호명</span> 픽스폴리오(Picksfolio) | <span className="text-slate-400 font-black">대표자</span> 신우진
            </p>
            <p className="text-slate-500 text-sm font-bold">
              <span className="text-slate-400 font-black">사업자등록번호</span> 220-26-01995
            </p>
            <p className="text-slate-500 text-sm font-bold">
              <span className="text-slate-400 font-black">통신판매업신고번호</span> 제 2026-부천원미-0846 호
            </p>
            <p className="text-slate-500 text-sm font-bold">
              <span className="text-slate-400 font-black">사업장 주소</span> 경기도 부천시 원미구 부일로199번길 26, 7층 2호(상동, 서련코아)
            </p>
            <p className="text-slate-500 text-sm font-bold">
              <span className="text-slate-400 font-black">고객센터</span> 010-3563-8940 | woojin8940@inplace-ad.com
            </p>
          </div>
          <div className="mt-4 flex gap-4">
            <button
              onClick={onNavigateTerms}
              className="text-slate-500 hover:text-white text-sm font-bold transition-colors underline underline-offset-2"
            >
              이용약관
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={onNavigatePrivacy}
              className="text-slate-500 hover:text-white text-sm font-bold transition-colors underline underline-offset-2"
            >
              개인정보처리방침
            </button>
          </div>
          <p className="text-slate-600 text-xs font-bold mt-6">&copy; {new Date().getFullYear()} Picksfolio. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
