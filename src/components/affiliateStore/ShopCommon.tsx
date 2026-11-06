import React, { useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle } from 'lucide-react';
import { PICKSFOLIO_CS_EMAIL } from '../../services/affiliateBuyerService';

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

/** https:// 주소만 연다(서버도 같은 규칙으로 저장한다). */
export const safeInquiryUrl = (u?: string | null) => (/^https:\/\/\S+$/i.test(String(u || '')) ? String(u) : '');

/**
 * 구매자 "문의하기" → 브랜드 자사몰 · 고객센터(새 창). 픽스폴리오 안의 문의 작성 창은 쓰지 않는다.
 * 주문 상세에서는 주문번호와 복사 버튼을 함께 보여 준다. 문의 링크가 없는 브랜드는 픽스폴리오 고객센터를 안내한다.
 */
export const SellerInquiry: React.FC<{ inquiryUrl?: string | null; orderId?: string; compact?: boolean; className?: string }> = ({ inquiryUrl, orderId, compact, className = '' }) => {
  const url = safeInquiryUrl(inquiryUrl);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!orderId) return;
    try {
      await navigator.clipboard.writeText(orderId);
    } catch {
      const t = document.createElement('textarea');
      t.value = orderId; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* 복사 불가 */ }
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (!url) {
    return (
      <div className={`rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ${className}`}>
        <p className="font-bold">판매자 문의 링크가 아직 등록되지 않았어요</p>
        <p className="mt-1">픽스폴리오 고객센터로 문의해 주세요: <a href={`mailto:${PICKSFOLIO_CS_EMAIL}`} className="font-bold underline">{PICKSFOLIO_CS_EMAIL}</a></p>
        {orderId && (
          <p className="mt-1 flex items-center gap-1.5 flex-wrap">주문번호 <span className="font-mono break-all">{orderId}</span>
            <button type="button" onClick={copy} className="h-6 px-2 rounded-md bg-white border border-slate-200 text-[10px] font-black flex items-center gap-1">{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? '복사됨' : '복사'}</button>
          </p>
        )}
      </div>
    );
  }
  return (
    <div className={className}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${compact ? 'inline-flex h-9 px-4 text-xs' : 'flex h-11 w-full text-sm'} rounded-xl border border-slate-300 font-black text-slate-700 items-center justify-center gap-1.5`}
      >
        <MessageCircle className="w-4 h-4" /> 문의하기 <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
      </a>
      {orderId && (
        <div className="mt-2 text-[11px] text-slate-500 leading-relaxed">
          <p>판매자 고객센터로 이동해요. 주문번호 <span className="font-mono font-bold text-slate-700 break-all">{orderId}</span>를 알려 주시면 빠르게 확인할 수 있어요.</p>
          <button type="button" onClick={copy} className="mt-1.5 h-7 px-2.5 rounded-lg bg-slate-100 text-[11px] font-black text-slate-600 flex items-center gap-1">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied ? '복사했어요' : '주문번호 복사'}
          </button>
        </div>
      )}
    </div>
  );
};
