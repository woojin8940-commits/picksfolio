import React from 'react';
import { Share2 } from 'lucide-react';
import { DesignSettings } from '../types';
import { themeIsDark } from '../utils/themeColor';
import { shareOrCopy } from '../utils/clipboard';

/**
 * 개인페이지 맨 아래 — 공유 버튼과 통신판매중개자 사업자 정보.
 *
 * 예전에는 이 한 벌이 공개 페이지(UserPage)에만 적혀 있었다. 편집 화면의 미리보기는
 * 본문(PublicPageBody)만 그렸으므로, 미리보기를 끝까지 내려도 페이지가 그냥 끊겼다 —
 * 실제 페이지에는 공유 버튼과 사업자 정보가 한 화면 가까이 붙어 있는데, 편집하는
 * 사람은 그것을 보지 못한 채 "여기까지가 내 페이지"라고 판단했다. 마지막 카드 아래에
 * 무엇이 오는지는 여백과 색을 고를 때 실제로 영향을 준다.
 *
 * 그래서 푸터를 따로 떼어 두 화면이 같은 파일을 그린다. 미리보기 쪽은 공유할 주소를
 * 자기 공개 페이지 주소로 넘긴다(미리보기 화면의 주소는 대시보드 주소다).
 */
interface PublicPageFooterProps {
  design: DesignSettings;
  /** 공유 시트에 뜨는 제목. */
  shareTitle: string;
  /** 공유·복사할 주소. 공개 페이지는 지금 보고 있는 주소, 미리보기는 자기 페이지 주소. */
  shareUrl: string;
}

const PublicPageFooter: React.FC<PublicPageFooterProps> = ({ design, shareTitle, shareUrl }) => {
  const isDark = themeIsDark(design);
  const subTextColor = isDark ? 'text-white/60' : 'text-slate-500';

  return (
    <footer className="py-12 flex flex-col items-center space-y-6 shrink-0">
      <button
        onClick={async () => {
          // 공유 API 가 없는 환경(데스크톱, 구형 인앱 브라우저)에서는
          // navigator.share 호출 자체가 TypeError 라 버튼이 죽어 있었다.
          // 시트를 닫은 것도 실패로 받아 "복사되었습니다"를 띄웠다.
          const result = await shareOrCopy({ title: shareTitle, url: shareUrl });
          if (result === 'copied') alert('링크가 복사되었습니다!');
          else if (result === 'failed') alert('공유할 수 없습니다. 주소창의 링크를 복사해 주세요.');
        }}
        className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-[2rem] font-black text-sm hover:scale-105 transition-all shadow-2xl"
      >
        <Share2 size={18} />
        페이지 공유하기
      </button>

      <div className="flex items-center gap-2 opacity-30 grayscale hover:grayscale-0 transition-all cursor-pointer">
        <span className="text-[10px] font-black tracking-tighter">POWERED BY</span>
        <span className="text-sm font-black text-blue-600 tracking-tighter">PICKSFOLIO</span>
      </div>

      {/* 통신판매중개자 사업자 정보 및 고객센터 (전자상거래법 제20조 / 결제 연동 심사 대응) */}
      <div className={`w-full max-w-md mx-auto pt-6 mt-2 border-t text-center space-y-1.5 ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
        <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
          본 페이지의 거래는 통신판매중개 플랫폼 픽스폴리오(Picksfolio)를 통해 이루어집니다.
        </p>
        <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
          상호명 픽스폴리오(Picksfolio) | 대표자 신우진
        </p>
        <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
          사업자등록번호 220-26-01995 | 통신판매업신고 제 2026-부천원미-0846 호
        </p>
        <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
          경기도 부천시 원미구 부일로199번길 26, 7층 2호(상동, 서련코아)
        </p>
        <p className={`text-[11px] font-bold leading-relaxed ${subTextColor}`}>
          고객센터 070-7954-8452 | woojin8940@inplace-ad.com
        </p>
        <div className="flex items-center justify-center gap-3 pt-1">
          <a href="/terms" className={`text-[11px] font-bold underline underline-offset-2 transition-colors ${isDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
            이용약관
          </a>
          <span className={subTextColor}>|</span>
          <a href="/privacy" className={`text-[11px] font-bold underline underline-offset-2 transition-colors ${isDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}>
            개인정보처리방침 · 취소/환불/배송 안내
          </a>
        </div>
      </div>
    </footer>
  );
};

export default PublicPageFooter;
