import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface FooterProps {
  onNavigateTerms?: () => void;
  onNavigatePrivacy?: () => void;
  onNavigateSignup?: () => void;
}

/* 이 푸터는 홈(마케팅) 화면에서만 그려진다 — App.tsx 가 view === 'home' 일 때만
   붙인다. 그래서 홈과 같은 종이색·먹색을 그대로 쓴다. */
const Footer: React.FC<FooterProps> = ({ onNavigateTerms, onNavigatePrivacy, onNavigateSignup }) => {
  const { language } = useLanguage();
  const en = language === 'en';

  return (
    <footer className="bg-[#F4F5FA] pt-12 md:pt-20 pb-10 border-t border-[#0B0F1A]/[0.07]">
      <div className="container mx-auto px-4 sm:px-6">
        {/* 마지막 한 번 더 권하는 자리. 종이색 위에 먹색 판 하나만 올린다. */}
        {onNavigateSignup && (
          <div className="mb-12 md:mb-20 rounded-[1.75rem] md:rounded-[2.5rem] bg-[#0B0F1A] px-6 py-8 md:px-12 md:py-12 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-[0_40px_80px_-50px_rgba(11,15,26,0.9)]">
            <div>
              <h3 className="text-lg md:text-3xl font-black text-white tracking-tighter leading-snug">
                {en ? 'Your address is still free.' : '내 주소, 아직 비어 있습니다'}
              </h3>
              <p className="mt-2 text-xs md:text-base font-medium text-white/60">
                {en
                  ? 'Pick a handle and the trend board, templates and inquiry inbox come with it.'
                  : '아이디만 정하면 트렌드 보드와 템플릿, 제안 수신함이 함께 열립니다.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateSignup}
              className="shrink-0 inline-flex items-center justify-center gap-2 bg-white text-[#0B0F1A] hover:bg-[#EDF2FF] px-6 py-3.5 md:px-8 md:py-4 rounded-full text-sm md:text-base font-black transition-all active:scale-[0.97]"
            >
              {en ? 'Create now' : '바로 만들기'}
              <ArrowRight size={17} strokeWidth={2.8} />
            </button>
          </div>
        )}

        <div className="flex flex-col md:flex-row justify-between gap-8 md:gap-12 mb-8 md:mb-12">
          <div className="max-w-xs">
            <h2 className="text-xl md:text-2xl font-black text-[#0B0F1A] mb-5 md:mb-8 tracking-tighter flex items-center gap-2">
              PICKS
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] translate-y-1" />
            </h2>
            <p className="text-[#5B6382] text-sm font-bold leading-relaxed">
              {en
                ? 'The all-in-one service for creators — build your own homepage and connect everything with a single link.'
                : '크리에이터를 위한 올인원 서비스. 나만의 홈페이지로 모든 것을 하나의 링크로 연결하세요.'}
            </p>
          </div>

          <div className="flex gap-10 md:gap-24">
            <div>
              <h4 className="text-[#0B0F1A] text-sm font-black uppercase tracking-widest mb-6">PLATFORM</h4>
              <ul className="space-y-4">
                <li><a href="#" className="text-[#8B93AE] hover:text-[#0B0F1A] text-sm font-bold transition-colors">Templates</a></li>
                <li><a href="#" className="text-[#8B93AE] hover:text-[#0B0F1A] text-sm font-bold transition-colors">AI Scout</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[#0B0F1A] text-sm font-black uppercase tracking-widest mb-6">COMPANY</h4>
              <ul className="space-y-4">
                <li><a href="#" className="text-[#8B93AE] hover:text-[#0B0F1A] text-sm font-bold transition-colors">About Us</a></li>
                <li><a href="#" className="text-[#8B93AE] hover:text-[#0B0F1A] text-sm font-bold transition-colors">Press Kit</a></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Business Information */}
        <div className="border-t border-[#0B0F1A]/[0.07] pt-8">
          <div className="space-y-2">
            <p className="text-[#8B93AE] text-sm font-bold">
              <span className="text-[#39415C] font-black">{en ? 'Company Name' : '상호명'}</span> {en ? 'Picksfolio' : '픽스폴리오(Picksfolio)'} | <span className="text-[#39415C] font-black">{en ? 'CEO' : '대표자'}</span> {en ? 'Woojin Shin' : '신우진'}
            </p>
            <p className="text-[#8B93AE] text-sm font-bold">
              <span className="text-[#39415C] font-black">{en ? 'Business Registration No.' : '사업자등록번호'}</span> 220-26-01995
            </p>
            <p className="text-[#8B93AE] text-sm font-bold">
              <span className="text-[#39415C] font-black">{en ? 'E-Commerce Permit No.' : '통신판매업신고번호'}</span> {en ? '2026-Bucheon Wonmi-0846' : '제 2026-부천원미-0846 호'}
            </p>
            <p className="text-[#8B93AE] text-sm font-bold">
              <span className="text-[#39415C] font-black">{en ? 'Address' : '사업장 주소'}</span> {en ? '7F #2, 26 Buil-ro 199beon-gil, Wonmi-gu, Bucheon-si, Gyeonggi-do, Korea' : '경기도 부천시 원미구 부일로199번길 26, 7층 2호(상동, 서련코아)'}
            </p>
            <p className="text-[#8B93AE] text-sm font-bold">
              <span className="text-[#39415C] font-black">{en ? 'Customer Support' : '고객센터'}</span> 070-7954-8452 | woojin8940@inplace-ad.com
            </p>
          </div>
          <div className="mt-4 flex gap-4">
            <button
              onClick={onNavigateTerms}
              className="text-[#8B93AE] hover:text-[#0B0F1A] text-sm font-bold transition-colors underline underline-offset-2"
            >
              {en ? 'Terms of Service' : '이용약관'}
            </button>
            <span className="text-[#C3C9DC]">|</span>
            <button
              onClick={onNavigatePrivacy}
              className="text-[#8B93AE] hover:text-[#0B0F1A] text-sm font-bold transition-colors underline underline-offset-2"
            >
              {en ? 'Privacy Policy' : '개인정보처리방침'}
            </button>
          </div>
          <p className="text-[#A6ADC6] text-xs font-bold mt-6">&copy; {new Date().getFullYear()} Picksfolio. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
