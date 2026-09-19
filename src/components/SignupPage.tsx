import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, AtSign, Briefcase, Check, Lock, Mail, Phone, Sparkles, User, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { digitsOnly, formatPhoneInput } from '../utils/formatters';
import { checkUsername, prefetchUsername } from '../utils/usernameCheck';

interface SignupPageProps {
  initialId: string;
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onSignupSuccess: () => void;
}

/** 서버(auth-check-username · auth-signup)와 같은 아이디 규칙. */
const ID_PATTERN = /^[a-z0-9_]{3,20}$/;

/**
 * 아이디 칸에 넣을 수 있는 글자만 남긴다.
 *
 * 홈 히어로의 시작 입력칸은 아무 글자나 받으므로(대문자 · 한글 · 공백) 그 값이
 * 그대로 이 화면으로 넘어온다. 예전에는 잘못된 글자가 오면 alert 로 되돌렸는데,
 * 사용자가 무엇을 지워야 하는지 알 수 없는 안내였다. 지금은 조용히 걸러 내고,
 * 무엇이 걸러졌는지는 칸 아래 한 줄로 알려 준다.
 */
const sanitizeId = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]/g, '');

/**
 * 중복확인 결과. 검사한 아이디 문자열을 함께 들고 있다 — 아이디를 한 글자만
 * 고쳐도 직전 결과는 그 아이디에 대한 답이 아니기 때문이다. 문자열이 어긋나면
 * "확인 전" 으로 되돌아가고, 같은 값으로 되돌려 쓰면 결과가 다시 살아난다.
 */
type IdCheck = {
  id: string;
  state: 'available' | 'unavailable';
  message: string;
};

const SignupPage: React.FC<SignupPageProps> = ({ initialId, onNavigateHome, onNavigateLogin, onSignupSuccess }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [id, setId] = useState(() => sanitizeId(initialId || ''));
  const [idNotice, setIdNotice] = useState('');
  const [idCheck, setIdCheck] = useState<IdCheck | null>(null);
  const [isCheckingId, setIsCheckingId] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 직전 결과가 지금 입력된 아이디에 대한 답일 때만 인정한다.
  const checkResult = idCheck && idCheck.id === id ? idCheck : null;
  const idAvailable = checkResult?.state === 'available';

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const value = sanitizeId(raw);
    setId(value);
    if (raw === value) {
      setIdNotice('');
    } else if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(raw)) {
      setIdNotice(isEn ? 'Only lowercase letters, numbers and underscore can be used.' : '아이디는 영문 소문자, 숫자, 밑줄(_)만 입력할 수 있습니다.');
    } else {
      setIdNotice(isEn ? 'Only lowercase letters, numbers and underscore can be used.' : '영문 소문자, 숫자, 밑줄(_)로 바꿔 입력했습니다.');
    }
  };

  const handleCheckId = useCallback(async () => {
    const value = sanitizeId(id);
    if (!ID_PATTERN.test(value)) {
      setIdCheck({
        id: value,
        state: 'unavailable',
        message: isEn
          ? 'Use 3–20 lowercase letters, numbers or underscore.'
          : '영문 소문자, 숫자, 밑줄(_)로 3~20자까지 입력해 주세요.',
      });
      setId(value);
      return;
    }

    setIsCheckingId(true);
    try {
      const result = await checkUsername(value);

      // 확인에 실패한 경우(서버 오류 · 호출 제한)는 "사용 불가" 가 아니다. 결과를
      // 남기지 않고 다시 눌러 달라고만 안내한다 — 남겨 두면 쓸 수 있는 아이디가
      // 못 쓰는 아이디로 보인다.
      if (!result.ok) {
        setIdCheck(null);
        alert(result.message || (isEn ? 'Could not check the username. Please try again.' : '아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
        return;
      }

      setIdCheck({
        id: value,
        state: result.available ? 'available' : 'unavailable',
        message: result.available
          ? (isEn ? 'This username is available.' : '사용 가능한 아이디입니다.')
          : result.message || (isEn ? 'This username is already taken.' : '이미 사용 중인 아이디입니다.'),
      });
    } finally {
      setIsCheckingId(false);
    }
  }, [id, isEn]);

  /**
   * 입력이 멈추면 답을 미리 받아 둔다. 사용자가 "중복확인" 을 누르는 시점에는
   * 왕복이 이미 끝나 있어 기다림이 없다.
   *
   * 받아 둔 답을 idCheck 에 넣지는 않는다. 누른 적이 없는데 "사용 가능" 표시가
   * 떠 있으면 확인을 거쳤다는 뜻이 되고, 가입 버튼의 전제(누른 아이디에 대한
   * 답만 인정)가 흐려진다.
   */
  useEffect(() => {
    if (!ID_PATTERN.test(id)) return;
    const timer = setTimeout(() => prefetchUsername(id), 500);
    return () => clearTimeout(timer);
  }, [id]);

  // 전화번호를 고치면 직전 인증은 그 번호에 대한 인증이 아니다. 예전에는 인증
  // 완료 표시가 그대로 남아, 번호를 바꾼 뒤 그대로 가입을 눌러 서버에서 거절당했다.
  useEffect(() => {
    setIsVerified(false);
    setShowVerificationInput(false);
    setVerificationCode('');
  }, [phone]);

  const handleSendSMS = async () => {
    if (!phone) {
      alert(isEn ? 'Please enter your phone number.' : '휴대폰 번호를 입력해 주세요.');
      return;
    }

    const isResend = showVerificationInput;
    setIsSending(true);
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: phone, purpose: 'signup' }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setVerificationCode('');
        setShowVerificationInput(true);
        alert(isResend ? (isEn ? 'Verification code resent.' : '인증번호를 재전송했습니다.') : (isEn ? 'Verification code sent.' : '인증번호가 발송되었습니다.'));
      } else {
        alert(data.error || data.message || (isEn ? 'Failed to send verification code.' : '인증번호 발송에 실패했습니다.'));
      }
    } catch (error) {
      alert(isEn ? 'Server error occurred.' : '서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifySMS = async () => {
    if (!verificationCode) {
      alert(isEn ? 'Please enter the verification code.' : '인증번호를 입력해 주세요.');
      return;
    }

    setIsVerifying(true);
    try {
      const response = await fetch('/.netlify/functions/verify-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: verificationCode, purpose: 'signup' }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setIsVerified(true);
      } else {
        alert(data.error || data.message || (isEn ? 'Verification failed.' : '인증번호가 일치하지 않거나 만료되었습니다.'));
      }
    } catch (error) {
      alert(isEn ? 'Server error occurred.' : '서버 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 중복확인을 지나치지 못하게 한다. 이 확인 없이 가입을 누르면 다 채운 폼이
    // "이미 사용 중인 아이디" 하나로 되돌아온다.
    if (!idAvailable) {
      alert(isEn ? 'Please check that your username is available.' : '아이디 중복확인을 먼저 눌러 주세요.');
      return;
    }

    if (password !== confirmPassword) {
      alert(isEn ? 'Passwords do not match.' : '비밀번호가 일치하지 않습니다.');
      return;
    }

    if (!isVerified) {
      alert(isEn ? 'Please complete phone verification.' : '휴대폰 번호 인증을 완료해 주세요.');
      return;
    }

    setIsLoading(true);

    try {
      // `identity-signup` 은 가입 API 가 아니다. Netlify Identity 가 계정을 만들 때
      // 스스로 호출하는 예약된 훅 이름이고, 본문에서 `user` 를 읽어 권한(roles)만
      // 돌려준다. 외부에서 직접 부르면 Netlify 가 403 으로 막는다 — 그래서 이 화면의
      // 회원가입은 무엇을 입력해도 "회원가입 실패" 로만 끝났다. 실제로 Supabase
      // 계정 · profiles · site_data · 프로필 코드를 만드는 함수는 `auth-signup` 이다.
      const response = await fetch('/.netlify/functions/auth-signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: id,
          email,
          password,
          full_name: fullName,
          phone,
        }),
      });

      const data = await response.json();

      // auth-signup 은 실패도 200 으로 알려 준다(본문의 success). 상태 코드만 보면
      // 실패를 성공으로 읽어 "가입 완료" 를 띄우고 로그인 화면으로 보내 버린다.
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || (isEn ? 'Signup failed' : '회원가입 실패'));
      }

      alert(isEn ? 'Signup complete! Please log in.' : '회원가입이 완료되었습니다! 로그인해 주세요.');
      onSignupSuccess();
    } catch (error: any) {
      alert(error.message || (isEn ? 'An error occurred during signup.' : '회원가입 중 오류가 발생했습니다.'));
    } finally {
      setIsLoading(false);
    }
  };

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  // 홈·로그인 화면과 같은 규칙을 쓰는 조각들. 입력칸이 여러 번 반복되므로 한곳에
  // 모아 둔다(LoginPage 의 같은 이름과 짝이다).
  const fieldShell =
    'flex items-center gap-2.5 bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-4 py-3 transition-colors focus-within:border-[#2563EB] focus-within:bg-white';
  const fieldInput =
    'bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold placeholder:text-[#C3C9DC] text-sm';
  const labelClass = 'block text-xs font-black text-[#39415C] ml-1';
  /** 칸 옆에 붙는 작은 실행 버튼(중복확인 · 인증번호 전송 · 확인). */
  const sideButton =
    'shrink-0 px-4 rounded-2xl text-[12px] font-black transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed border';

  return (
    <div className="relative min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 pt-20 sm:pt-28 pb-12 sm:pb-16 overflow-hidden">
      {/* 배경은 홈의 히어로·로그인 화면과 같다 — 종이색 위에 옅은 점 격자와 파스텔
          얼룩 두 개. 종이색 자체는 body.home-paper 와 App.tsx 의 바깥 틀이 칠하므로
          여기서는 무늬만 올린다. 층 순서를 음수 z-index 로 두지 않는 이유는
          LoginPage 의 같은 자리에 적어 두었다(바깥 틀의 배경색보다 먼저 그려져
          아예 보이지 않는다). */}
      <div aria-hidden className="absolute inset-0 z-0 home-dotgrid opacity-70" />
      <div
        aria-hidden
        className="absolute -top-24 -right-16 w-[320px] h-[320px] md:w-[520px] md:h-[520px] rounded-full z-0 blur-[90px] paper-glow-blue"
      />
      <div
        aria-hidden
        className="absolute top-1/2 -left-24 w-[260px] h-[260px] md:w-[400px] md:h-[400px] rounded-full z-0 blur-[90px] paper-glow-green"
      />

      <div className="relative z-10 w-full max-w-sm sm:max-w-md">
        {/* 카드 밖의 인사말. 홈의 히어로와 같은 순서(알약 → 큰 제목 → 설명)다. */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] text-[11px] font-black px-3.5 py-1.5 rounded-full shadow-sm">
            <Sparkles size={12} strokeWidth={2.8} />
            {isEn ? 'Creator sign up' : '크리에이터 회원가입'}
          </span>
          <h1 className="mt-4 sm:mt-5 text-[1.6rem] sm:text-[2.15rem] leading-[1.18] font-black tracking-tighter text-[#0B0F1A] font-display">
            {isEn ? (
              <>
                Pick an address,
                <br />
                open{' '}
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
                주소만 정하면
                <br />
                <span className="relative inline-block">
                  <span className="relative z-10 text-[#2563EB]">내 페이지</span>
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-2.5 -z-0 rounded-full"
                    style={{ background: 'rgba(37,99,235,0.16)' }}
                  />
                </span>
                가 열립니다
              </>
            )}
          </h1>
          <p className="mt-2.5 sm:mt-3 text-sm text-[#4A5273] font-medium">
            {isEn
              ? 'Start building your portfolio with PICKSFOLIO.'
              : '픽스폴리오와 함께 나만의 포트폴리오를 만들어보세요.'}
          </p>
        </div>

        {/* 가입 카드 — 홈의 흰 카드와 같은 테두리·그림자·둥근 정도다. */}
        <div className="mt-6 sm:mt-7 bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-5 sm:p-7 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 아이디 = 페이지 주소. 홈 히어로의 시작 입력칸과 같은 모양으로 보여
                주면(주소 앞머리를 회색으로 붙인다) 이 칸이 무엇인지 설명이 줄어든다. */}
            <div className="space-y-1.5">
              <label className={labelClass}>{isEn ? 'Username (page address)' : '아이디 (내 페이지 주소)'}</label>
              <div className="flex gap-2">
                <div
                  className={`${fieldShell} flex-1 min-w-0 ${
                    checkResult
                      ? checkResult.state === 'available'
                        ? 'border-[#10B981]/45 bg-[#10B981]/[0.06]'
                        : 'border-[#E0454A]/45 bg-[#E0454A]/[0.05]'
                      : ''
                  }`}
                >
                  <AtSign size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                  <span className="text-[#98A0BC] font-bold text-[13px] shrink-0 hidden sm:inline">picks-folio.com/</span>
                  {/* size={1} · w-0 은 이 칸이 "타고난 너비"(글자 20칸)를 부모에게
                      물려주지 않게 하는 것이다. 자세한 이유는 Hero 의 같은 칸에
                      적어 두었다 — 휴대폰에서 폼 전체가 화면보다 넓어졌다. */}
                  <input
                    type="text"
                    value={id}
                    onChange={handleIdChange}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      // 이 칸에서 엔터는 "중복확인" 이다. 그대로 폼이 넘어가면
                      // 확인하지 않은 아이디로 가입을 시도하게 된다.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!isCheckingId) handleCheckId();
                      }
                    }}
                    size={1}
                    className={`${fieldInput} w-0 flex-1`}
                    placeholder={isEn ? 'yourname' : '사용할 아이디'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="username"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCheckId}
                  disabled={isCheckingId || !id}
                  className={`${sideButton} ${
                    idAvailable
                      ? 'bg-[#10B981]/10 border-[#10B981]/35 text-[#0F9D6E]'
                      : 'bg-[#F7F8FC] border-[#0B0F1A]/10 text-[#39415C] hover:border-[#2563EB]/45 hover:text-[#2563EB]'
                  }`}
                >
                  {isCheckingId
                    ? (isEn ? 'Checking...' : '확인 중...')
                    : idAvailable
                    ? (isEn ? 'Available' : '사용 가능')
                    : (isEn ? 'Check' : '중복확인')}
                </button>
              </div>

              {checkResult ? (
                <p
                  className={`flex items-start gap-1 text-[11px] font-bold ml-1 ${
                    checkResult.state === 'available' ? 'text-[#0F9D6E]' : 'text-[#D93F45]'
                  }`}
                >
                  {checkResult.state === 'available' ? (
                    <Check size={13} strokeWidth={3} className="shrink-0 mt-px" />
                  ) : (
                    <X size={13} strokeWidth={3} className="shrink-0 mt-px" />
                  )}
                  {checkResult.message}
                </p>
              ) : (
                <p className="text-[11px] text-[#8B93AE] font-bold ml-1">
                  {idNotice ||
                    (isEn
                      ? '3–20 lowercase letters, numbers or underscore. Tap Check to see if it is free.'
                      : '영문 소문자·숫자·밑줄(_) 3~20자. 중복확인을 눌러 사용 가능한지 확인해 주세요.')}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>{isEn ? 'Full Name' : '이름'}</label>
              <div className={fieldShell}>
                <User size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={fieldInput}
                  placeholder={isEn ? 'Enter your name' : '이름을 입력해 주세요'}
                  autoComplete="name"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>{isEn ? 'Email' : '이메일'}</label>
              <div className={fieldShell}>
                <Mail size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldInput}
                  placeholder="email@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>{isEn ? 'Password' : '비밀번호'}</label>
              <div className={fieldShell}>
                <Lock size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="password"
                  name="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={fieldInput}
                  placeholder={isEn ? 'Enter password' : '비밀번호를 입력해 주세요'}
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>{isEn ? 'Confirm Password' : '비밀번호 확인'}</label>
              <div className={`${fieldShell} ${passwordMismatch ? 'border-[#E0454A]/45 bg-[#E0454A]/[0.05]' : ''}`}>
                <Lock size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="password"
                  name="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={fieldInput}
                  placeholder={isEn ? 'Confirm password' : '비밀번호를 다시 입력해 주세요'}
                  autoComplete="new-password"
                  required
                />
              </div>
              {/* 어긋난 비밀번호는 가입을 누르기 전에 알려 준다 — 다 채운 폼이
                  경고창 하나로 되돌아오는 일을 한 가지 줄인다. */}
              {passwordMismatch && (
                <p className="flex items-center gap-1 text-[11px] font-bold text-[#D93F45] ml-1">
                  <X size={13} strokeWidth={3} className="shrink-0" />
                  {isEn ? 'Passwords do not match.' : '비밀번호가 일치하지 않습니다.'}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>{isEn ? 'Phone Number' : '휴대폰 번호'}</label>
              <div className="flex gap-2">
                <div className={`${fieldShell} flex-1 min-w-0 ${isVerified ? 'border-[#10B981]/45 bg-[#10B981]/[0.06]' : ''}`}>
                  <Phone size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                  <input
                    type="tel"
                    value={formatPhoneInput(phone)}
                    onChange={(e) => setPhone(digitsOnly(e.target.value).slice(0, 11))}
                    size={1}
                    className={`${fieldInput} w-0 flex-1`}
                    placeholder="010-1234-5678"
                    inputMode="numeric"
                    autoComplete="tel"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendSMS}
                  disabled={isSending || isVerified}
                  className={`${sideButton} ${
                    isVerified
                      ? 'bg-[#10B981]/10 border-[#10B981]/35 text-[#0F9D6E]'
                      : 'bg-[#F7F8FC] border-[#0B0F1A]/10 text-[#39415C] hover:border-[#2563EB]/45 hover:text-[#2563EB]'
                  }`}
                >
                  {isSending
                    ? (isEn ? 'Sending...' : '발송 중...')
                    : isVerified
                    ? (isEn ? 'Verified' : '인증 완료')
                    : showVerificationInput
                    ? (isEn ? 'Resend' : '재전송')
                    : (isEn ? 'Send code' : '인증번호 전송')}
                </button>
              </div>
              {isVerified && (
                <p className="flex items-center gap-1 text-[11px] font-bold text-[#0F9D6E] ml-1">
                  <Check size={13} strokeWidth={3} className="shrink-0" />
                  {isEn ? 'Phone verification complete.' : '휴대폰 인증이 완료되었습니다.'}
                </p>
              )}
            </div>

            {showVerificationInput && !isVerified && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className={labelClass}>{isEn ? 'Verification Code' : '인증번호'}</label>
                <div className="flex gap-2">
                  <div className={`${fieldShell} flex-1 min-w-0`}>
                    <input
                      type="text"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(digitsOnly(e.target.value).slice(0, 6))}
                      size={1}
                      className={`${fieldInput} w-0 flex-1 tracking-[0.3em]`}
                      placeholder={isEn ? '6-digit code' : '6자리 숫자'}
                      maxLength={6}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifySMS}
                    disabled={isVerifying}
                    className={`${sideButton} bg-[#2563EB]/[0.08] border-[#2563EB]/25 text-[#2563EB] hover:bg-[#2563EB]/[0.14]`}
                  >
                    {isVerifying ? (isEn ? 'Checking...' : '확인 중...') : (isEn ? 'Verify' : '확인')}
                  </button>
                </div>
              </div>
            )}

            {/* space-y-4 가 자식의 margin-top 을 자기 선택자로 잡으므로 버튼에
                mt-* 를 더해도 이기지 못한다. 한 칸 더 띄우는 일은 감싼 div 가 한다. */}
            <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white py-3.5 rounded-full text-sm font-black transition-all shadow-[0_12px_28px_-12px_rgba(37,99,235,0.8)] active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  {isEn ? 'Signing up...' : '가입 중...'}
                </>
              ) : (
                <>
                  {isEn ? 'Sign Up' : '회원가입'}
                  <ArrowRight size={16} strokeWidth={2.8} />
                </>
              )}
            </button>
            </div>
          </form>

          <p className="text-center mt-5 text-[#8B93AE] text-[13px] font-bold">
            {isEn ? 'Already have an account?' : '이미 계정이 있으신가요?'}{' '}
            <button
              onClick={onNavigateLogin}
              className="text-[#2563EB] font-black hover:underline"
              disabled={isLoading}
            >
              {isEn ? 'Log In' : '로그인'}
            </button>
          </p>
        </div>

        {/* 비즈니스 가입은 다른 종류의 계정이라 카드 밖에 둔다 — 로그인 화면의
            비즈니스 버튼과 같은 자리·같은 모양이다. */}
        <button
          type="button"
          onClick={() => { window.location.href = '/business-signup'; }}
          disabled={isLoading}
          className="w-full mt-4 py-3 rounded-full text-[13px] font-black transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-white text-[#0B0F1A] border border-[#0B0F1A]/10 hover:border-[#0B0F1A]/25 shadow-sm"
        >
          <Briefcase size={15} className="text-[#2563EB]" strokeWidth={2.6} />
          {isEn ? 'Business Sign Up' : '비즈니스 회원으로 가입하기'}
        </button>

        <div className="text-center mt-4">
          <button
            onClick={onNavigateHome}
            className="text-[#8B93AE] text-xs font-bold hover:text-[#0B0F1A] transition-colors"
          >
            {isEn ? 'Return to Home' : '홈으로 돌아가기'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
