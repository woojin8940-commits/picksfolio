import React, { useState } from 'react';
import { ArrowRight, Check, Link2, Sparkles } from 'lucide-react';
import { supabase } from '../services/supabase';
import { claimUsername } from '../services/apiService';
import { sessionSet } from '../utils/accountScope';
import { useLanguage } from '../contexts/LanguageContext';

interface SetupLinkProps {
  onSetupComplete: (username: string) => void;
}

/**
 * 가입 직후(카카오 간편로그인 포함) "나만의 링크"(= 아이디 · 개인페이지 주소)를
 * 정하는 화면.
 *
 * 저장은 서버(auth-claim-username)가 한다. 예전에는 이 화면이 수파베이스 profiles 로
 * 직접 upsert 했는데, 그러면 실패할 수 있는 이유가 여러 가지인데도 화면에 남는 말은
 * "저장 중 오류가 발생했습니다." 한 줄이었다 — 이름이 이미 쓰이고 있어서인지, 로그인
 * 세션이 아직 준비되지 않아서인지, 잠깐의 네트워크 문제인지 알 수 없으니 사용자가
 * 할 수 있는 것도 없었다. 지금은 서버가 이유를 붙여 답하고, 화면은 그 이유에 맞는
 * 다음 행동(다른 이름 · 다시 로그인 · 다시 시도)을 보여준다.
 *
 * 화면은 홈(히어로) · 로그인 · 가입과 같은 종이색 판이다. 예전에는 이 화면만
 * 검정(bg-midnight)에 보라 그림자를 쓴 옛 디자인으로 남아 있어서, 카카오로
 * 로그인한 사람은 밝은 홈 → 밝은 로그인 → 밝은 로딩까지 오다가 마지막 한 장에서만
 * 검은 화면을 만났고, 저장을 누르면 다시 밝은 대시보드로 나갔다. 이제 순서대로
 * (알약 → 큰 제목 → 설명 → 흰 카드) 홈과 같은 규칙을 쓴다. 이 화면은 App.tsx 의
 * 바깥 틀(헤더가 있는 판) 밖에서 단독으로 그려지므로, 종이색과 점 격자는
 * `paper-page` 로 이 화면이 직접 깐다.
 */
const SetupLink: React.FC<SetupLinkProps> = ({ onSetupComplete }) => {
  const { language } = useLanguage();
  const en = language === 'en';
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  /** 다시 로그인해야 하는 상태. 이때는 "다시 시도" 가 아무 소용이 없다. */
  const [needsLogin, setNeedsLogin] = useState(false);

  const validateUsername = (value: string) => {
    if (value.length < 3) return en ? 'Enter at least 3 characters.' : '3자 이상 입력해 주세요.';
    if (value.length > 20) return en ? 'Use 20 characters or fewer.' : '20자 이하로 입력해 주세요.';
    if (!/^[a-z0-9_]+$/.test(value)) {
      return en
        ? 'Only lowercase letters, numbers and underscores (_) are allowed.'
        : '영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다.';
    }
    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const originalValue = e.target.value;
    const value = originalValue.toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (originalValue !== value) {
      if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(originalValue)) {
        setError(
          en
            ? 'The link accepts only letters, numbers and underscores (_).'
            : '링크는 영문, 숫자, 밑줄(_)만 입력 가능합니다.',
        );
      } else {
        setError(
          en
            ? 'Only lowercase letters, numbers and underscores (_) are allowed.'
            : '영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다.',
        );
      }
    } else {
      setError('');
    }
    setNeedsLogin(false);

    setUsername(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateUsername(username);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!supabase) {
      // Demo mode: just save username and proceed
      setIsLoading(true);
      sessionSet('picks_user_session', username);
      onSetupComplete(username);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');
    setNeedsLogin(false);

    try {
      const result = await claimUsername(username);

      if (!result.ok) {
        setError(result.error);
        setNeedsLogin(result.reason === 'auth');
        return;
      }

      // 링크를 여기서 기억해 둔다. 저장 직후 새로고침하거나 앱이 화면을 다시
      // 띄워도(모바일 웹뷰에서 흔하다) 이 화면으로 되돌아오지 않게 하기 위해서다.
      sessionSet('picks_user_session', result.username);
      onSetupComplete(result.username);
    } finally {
      setIsLoading(false);
    }
  };

  /** 규칙을 다 지킨 이름인가. 입력칸 옆의 초록 체크와 버튼 활성에 함께 쓴다. */
  const isValid = !validateUsername(username);

  return (
    <div className="relative min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 pt-14 sm:pt-20 pb-12 sm:pb-16 overflow-hidden paper-page">
      {/* 홈의 히어로가 쓰는 파스텔 얼룩 두 개. 점 격자와 종이색은 위의
          `paper-page` 가 한 장으로 깔아 두었다. 스크롤과 함께 다시 그리지 않도록
          배경 레이어에만 얹는다. */}
      <div
        aria-hidden
        className="absolute -top-24 -right-16 w-[320px] h-[320px] md:w-[520px] md:h-[520px] rounded-full z-0 blur-[90px] paper-glow-blue"
      />
      <div
        aria-hidden
        className="absolute top-1/2 -left-24 w-[260px] h-[260px] md:w-[400px] md:h-[400px] rounded-full z-0 blur-[90px] paper-glow-green"
      />

      <div className="relative z-10 w-full max-w-sm sm:max-w-md">
        {/* 이 화면에는 헤더가 없다(가입 도중이라 돌아갈 메뉴가 없다). 대신 로딩
            화면과 같은 자리·같은 모양의 PICKS 표시를 두어 앞 화면과 이어 붙인다. */}
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-xl font-black tracking-tighter text-[#0B0F1A] font-display">PICKS</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] translate-y-1" />
        </div>

        {/* 카드 밖의 인사말. 홈의 히어로와 같은 순서(알약 → 큰 제목 → 설명)다. */}
        <div className="text-center mt-6 sm:mt-7">
          <span className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] text-[11px] font-black px-3.5 py-1.5 rounded-full shadow-sm">
            <Sparkles size={12} strokeWidth={2.8} />
            {en ? 'Last step' : '마지막 한 단계'}
          </span>
          <h1 className="mt-4 sm:mt-5 text-[1.6rem] sm:text-[2.15rem] leading-[1.18] font-black tracking-tighter text-[#0B0F1A] font-display">
            {en ? (
              <>
                Pick the address of
                <br />
                <span className="relative inline-block">
                  <span className="relative z-10 text-[#2563EB]">your page</span>
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-2.5 -z-0 rounded-full"
                    style={{ background: 'rgba(37,99,235,0.16)' }}
                  />
                </span>
              </>
            ) : (
              <>
                <span className="relative inline-block">
                  <span className="relative z-10 text-[#2563EB]">내 페이지 주소</span>
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-2.5 -z-0 rounded-full"
                    style={{ background: 'rgba(37,99,235,0.16)' }}
                  />
                </span>
                만 정하면 끝
              </>
            )}
          </h1>
          <p className="mt-2.5 sm:mt-3 text-sm text-[#4A5273] font-medium">
            {en
              ? 'This address becomes your own page link. It is the one link you share everywhere.'
              : '여기서 정한 주소가 나만의 페이지 링크가 됩니다.'}
          </p>
        </div>

        {/* 링크 만들기 카드 — 홈의 흰 카드와 같은 테두리·그림자·둥근 정도다. */}
        <div className="mt-6 sm:mt-7 bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-5 sm:p-7 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-black text-[#39415C] ml-1">
                <Link2 size={13} className="text-[#2563EB]" strokeWidth={2.8} />
                {en ? 'My link' : '나만의 링크'}
              </label>

              {/* 홈 히어로의 시작 입력칸과 같은 모양이다 — 주소 앞머리를 회색으로
                  붙여 두면 이 칸이 무엇을 정하는 자리인지 설명이 줄어든다. */}
              <div
                className={`flex items-center gap-1 bg-[#F7F8FC] border rounded-2xl px-4 py-3 transition-colors focus-within:bg-white ${
                  error
                    ? 'border-[#E0454A]/45 bg-[#E0454A]/[0.05]'
                    : isValid
                      ? 'border-[#10B981]/45 bg-[#10B981]/[0.06]'
                      : 'border-[#0B0F1A]/[0.08] focus-within:border-[#2563EB]'
                }`}
              >
                <span className="text-[#98A0BC] text-sm font-bold whitespace-nowrap">picks-folio.com/</span>
                {/* size={1} · w-0 은 이 칸이 "타고난 너비"(글자 20칸)를 부모에게
                    올려보내지 않게 하는 것이다. 휴대폰에서 그 너비가 카드를 밀어
                    화면 밖으로 넘기던 문제는 히어로의 같은 자리에 적어 두었다. */}
                <input
                  type="text"
                  placeholder={en ? 'yourname' : 'mylink'}
                  aria-label={en ? 'My page address' : '내 페이지 주소'}
                  value={username}
                  onChange={handleChange}
                  size={1}
                  className="bg-transparent border-none outline-none text-[#0B0F1A] text-sm font-bold w-0 flex-1 min-w-0 placeholder:text-[#C3C9DC]"
                  disabled={isLoading}
                  maxLength={20}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {isValid && !error && (
                  <Check size={16} className="text-[#10B981] shrink-0" strokeWidth={3} />
                )}
              </div>

              {error ? (
                <div className="ml-1 space-y-1">
                  <p className="text-[#E0454A] text-[11px] font-black">{error}</p>
                  {needsLogin && (
                    <button
                      type="button"
                      onClick={() => window.location.assign('/login')}
                      className="text-[#2563EB] text-[11px] font-black underline"
                    >
                      {en ? 'Log in again' : '다시 로그인하기'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[#8B93AE] text-[11px] font-bold ml-1">
                  {en
                    ? 'Lowercase letters, numbers and underscores (_) only, 3–20 characters.'
                    : '영문 소문자, 숫자, 밑줄(_)만 사용 가능 (3~20자)'}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || username.length < 3}
              className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white py-3.5 rounded-full text-sm font-black transition-all shadow-[0_12px_28px_-12px_rgba(37,99,235,0.8)] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  {en ? 'Saving...' : '저장 중...'}
                </>
              ) : (
                <>
                  {en ? 'Create my page' : '내 페이지 만들기'}
                  <ArrowRight size={16} strokeWidth={2.8} />
                </>
              )}
            </button>
          </form>
        </div>

        {/* 주소는 만든 뒤 화면에서 바꿀 수 있는 자리가 없다(서버의
            auth-claim-username 이 한 번만 잡아 준다). 그러니 "나중에 바꿀 수
            있다" 고 적어 두면 안 된다 — 한 번 정하는 것임을 여기서 알려 준다. */}
        <p className="text-center mt-4 text-[#8B93AE] text-[11px] font-bold">
          {en
            ? 'This address is what people will see — pick one you will keep.'
            : '한 번 정한 주소는 그대로 쓰게 되니 신중하게 정해 주세요.'}
        </p>
      </div>
    </div>
  );
};

export default SetupLink;
