import React from 'react';

/** 카카오 로그인 버튼(카카오 디자인 가이드 색). 로그인 처리는 기존 카카오 로그인을 그대로 부른다. */
export const KakaoLoginButton: React.FC<{ onClick: () => void; className?: string; label?: string }> = ({ onClick, className = '', label = '카카오로 시작하기' }) => (
  <button
    onClick={onClick}
    className={`w-full h-12 rounded-xl bg-[#FEE500] text-[#191919] text-sm font-black flex items-center justify-center gap-2 ${className}`}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.48 3 2 6.58 2 11c0 2.86 1.88 5.37 4.71 6.79l-.96 3.53c-.08.31.27.56.54.38l4.2-2.78c.5.05 1 .08 1.51.08 5.52 0 10-3.58 10-8S17.52 3 12 3z" /></svg>
    {label}
  </button>
);

/**
 * 통신판매중개자 고지 · 픽스폴리오 사업자 정보 · 고객센터. 상품 페이지와 마이페이지 하단에 둔다.
 * 사업자 정보는 사이트 하단(Footer.tsx)과 같은 값이다.
 */
export const PlatformLegalFooter: React.FC = () => (
  <footer className="px-5 mt-10 pt-6 pb-4 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed space-y-2">
    <p className="font-bold text-slate-500">
      픽스폴리오는 통신판매중개자이며 거래 당사자가 아닙니다. 상품 · 거래 정보와 거래에 대한 책임은 판매자에게 있습니다.
    </p>
    <p>
      상호 픽스폴리오(Picksfolio) | 대표자 신우진 | 사업자등록번호 220-26-01995<br />
      통신판매업신고번호 제 2026-부천원미-0846 호<br />
      경기도 부천시 원미구 부일로199번길 26, 7층 2호(상동, 서련코아)
    </p>
    <p>
      고객센터 <a href="tel:07079548452" className="underline">070-7954-8452</a> ·{' '}
      <a href="mailto:woojin8940@inplace-ad.com" className="underline">woojin8940@inplace-ad.com</a>
    </p>
  </footer>
);
