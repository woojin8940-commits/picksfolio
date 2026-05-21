import React, { useEffect, useState } from 'react';
import { apiService } from '../services/apiService';
import { SellerVerification } from '../types';

interface MembershipGateProps {
  userName: string;
  featureName: string;
  featureDescription: string;
  icon?: string;
  onNavigateMembership?: () => void;
  children: React.ReactNode;
}

const MembershipGate: React.FC<MembershipGateProps> = ({
  userName,
  featureName,
  featureDescription,
  icon = '🔒',
  onNavigateMembership,
  children,
}) => {
  const normalizedUserName = userName.replace(/^biz\//, '');
  const [verification, setVerification] = useState<SellerVerification | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiService.getSellerVerification(normalizedUserName).then((data) => {
      if (cancelled) return;
      setVerification(data);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [normalizedUserName]);

  if (!loaded) {
    return (
      <div className="p-4 md:p-14 w-full">
        <div className="text-center py-20">
          <div className="w-8 h-8 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">확인 중...</p>
        </div>
      </div>
    );
  }

  if (verification?.membership_active) {
    return <>{children}</>;
  }

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <header className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-1 md:mb-2">{featureName}</h2>
        <p className="text-slate-500 font-medium text-[10px] md:text-base">{featureDescription}</p>
      </header>

      <div className="max-w-2xl bg-white border border-purple-100 rounded-2xl p-6 md:p-8 shadow-sm">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-xl">{icon}</div>
          <div>
            <h3 className="text-base md:text-lg font-black text-slate-900">
              {featureName}은(는) 멤버십 전용 기능입니다
            </h3>
            <p className="text-slate-500 text-xs md:text-sm font-medium mt-1">
              월 4,900원 스탠다드 멤버십을 구독하면 포트폴리오 영상 커버·콘텐츠 구성을 사용할 수 있습니다. 라이브 커머스 송출까지 원하시면 월 13,900원 커머스 멤버십을 선택하세요.
            </p>
          </div>
        </div>

        <div className="rounded-xl p-4 bg-slate-50 border border-slate-200 mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-slate-900">스탠다드 멤버십</p>
              <p className="text-[11px] text-slate-500 font-medium">월 4,900원 · 콘텐츠 구성 · 영상 커버</p>
            </div>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-200 text-slate-500">미구독</span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-2">
            <div>
              <p className="text-sm font-black text-slate-900">커머스 멤버십 🎥</p>
              <p className="text-[11px] text-slate-500 font-medium">월 13,900원 · 라이브 커머스 송출 포함</p>
            </div>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-200 text-slate-500">미구독</span>
          </div>
        </div>

        <ul className="space-y-2 mb-6">
          <li className="flex items-center gap-2 text-xs md:text-sm text-slate-600 font-medium">
            <span className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-[10px] font-black">✓</span>
            포트폴리오 영상 커버 · 콘텐츠 구성 편집
          </li>
          <li className="flex items-center gap-2 text-xs md:text-sm text-slate-600 font-medium">
            <span className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-[10px] font-black">✓</span>
            라이브 커머스 송출은 커머스 멤버십에서 풀립니다
          </li>
          <li className="flex items-center gap-2 text-xs md:text-sm text-slate-600 font-medium">
            <span className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-[10px] font-black">✓</span>
            링크 그리드 · 상품 등록 · 이미지 커버는 무료 유지
          </li>
        </ul>

        <button
          type="button"
          onClick={() => onNavigateMembership?.()}
          className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 transition-all shadow-md hover:shadow-lg"
        >
          멤버십 플랜에서 구독 시작하기
        </button>
        <p className="text-[11px] text-slate-400 font-medium mt-3 text-center">
          구독 후 즉시 이용 가능 · 라이브 송출 시에만 사업자 인증 추가 필요
        </p>
      </div>
    </div>
  );
};

export default MembershipGate;
