import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, AtSign, Building2, Check, Lock, Mail, Phone, User, X } from 'lucide-react';
import { digitsOnly, formatPhoneInput } from '../utils/formatters';

interface BusinessSignupPageProps {
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onSignupSuccess: () => void;
}

/** 서버(auth-check-username · business-auth)와 같은 아이디 규칙. */
const ID_PATTERN = /^[a-z0-9_]{3,20}$/;

const sanitizeId = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]/g, '');

/** 검사한 아이디를 함께 들고 있는 중복확인 결과(SignupPage 와 같은 방식). */
type IdCheck = {
  id: string;
  state: 'available' | 'unavailable';
  message: string;
};

const BusinessSignupPage: React.FC<BusinessSignupPageProps> = ({ onNavigateHome, onNavigateLogin, onSignupSuccess }) => {
  const [companyName, setCompanyName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [isBizVerifying, setIsBizVerifying] = useState(false);
  const [isBizVerified, setIsBizVerified] = useState(false);
  const [bizVerifyMsg, setBizVerifyMsg] = useState('');
  const [bizVerifyError, setBizVerifyError] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [username, setUsername] = useState('');
  const [usernameNotice, setUsernameNotice] = useState('');
  const [idCheck, setIdCheck] = useState<IdCheck | null>(null);
  const [isCheckingId, setIsCheckingId] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);

  // 직전 결과가 지금 입력된 아이디에 대한 답일 때만 인정한다.
  const checkResult = idCheck && idCheck.id === username ? idCheck : null;
  const idAvailable = checkResult?.state === 'available';

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const value = sanitizeId(raw);
    setUsername(value);
    setUsernameNotice(raw === value ? '' : '아이디는 영문 소문자, 숫자, 밑줄(_)만 입력할 수 있습니다.');
  };

  const handleCheckId = useCallback(async () => {
    const value = sanitizeId(username);
    if (!ID_PATTERN.test(value)) {
      setIdCheck({
        id: value,
        state: 'unavailable',
        message: '영문 소문자, 숫자, 밑줄(_)로 3~20자까지 입력해 주세요.',
      });
      setUsername(value);
      return;
    }

    setIsCheckingId(true);
    try {
      const response = await fetch('/.netlify/functions/auth-check-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: value }),
      });
      const data = await response.json();

      // 확인 자체가 실패한 경우는 "사용 불가" 가 아니다. 결과를 남기지 않고 다시
      // 눌러 달라고만 안내한다 — 남겨 두면 쓸 수 있는 아이디가 못 쓰는 아이디로 보인다.
      if (!response.ok || !data?.success) {
        setIdCheck(null);
        alert(data?.error || '아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      setIdCheck({
        id: value,
        state: data.available ? 'available' : 'unavailable',
        message: data.available ? '사용 가능한 아이디입니다.' : data.error || '이미 사용 중인 아이디입니다.',
      });
    } catch {
      setIdCheck(null);
      alert('아이디를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsCheckingId(false);
    }
  }, [username]);

  // 번호를 고치면 직전 인증은 그 번호에 대한 인증이 아니다.
  useEffect(() => {
    setIsVerified(false);
    setShowVerificationInput(false);
    setVerificationCode('');
  }, [contactPhone]);

  const handleSendSMS = async () => {
    if (!contactPhone) {
      alert('휴대폰 번호를 입력해 주세요.');
      return;
    }
    const isResend = showVerificationInput;
    setIsSending(true);
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: contactPhone, purpose: 'business_signup' }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setVerificationCode('');
        setShowVerificationInput(true);
        alert(isResend ? '인증번호를 재전송했습니다.' : '인증번호가 발송되었습니다.');
      } else {
        alert(data.error || data.message || '인증번호 발송에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifySMS = async () => {
    if (!verificationCode) {
      alert('인증번호를 입력해 주세요.');
      return;
    }
    setIsVerifying(true);
    try {
      const response = await fetch('/.netlify/functions/verify-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: contactPhone, code: verificationCode, purpose: 'business_signup' }),
      });
      const data = await response.json();
      if (data.success) {
        setIsVerified(true);
      } else {
        alert(data.error || '인증번호가 일치하지 않습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBusinessNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBusinessNumber(e.target.value);
    // 번호가 바뀌면 직전 인증 상태를 초기화한다.
    if (isBizVerified || bizVerifyMsg || bizVerifyError) {
      setIsBizVerified(false);
      setBizVerifyMsg('');
      setBizVerifyError('');
    }
  };

  const handleVerifyBusiness = async () => {
    const digits = businessNumber.replace(/\D/g, '');
    if (digits.length !== 10) {
      setBizVerifyError('사업자등록번호 10자리를 정확히 입력해 주세요.');
      return;
    }
    setIsBizVerifying(true);
    setBizVerifyError('');
    setBizVerifyMsg('');
    try {
      const response = await fetch('/.netlify/functions/business-verify-nts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_number: digits }),
      });
      const result = await response.json();
      if (result.verified) {
        setIsBizVerified(true);
        setBizVerifyMsg(`국세청 확인 완료 · ${result.status || '계속사업자'}`);
      } else {
        setIsBizVerified(false);
        setBizVerifyError(result.error || '사업자 조회에 실패했습니다.');
      }
    } catch {
      setBizVerifyError('서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsBizVerifying(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    // 중복확인을 지나치지 못하게 한다 — 다 채운 폼이 "이미 사용 중인 아이디" 하나로
    // 되돌아오는 일을 막는다.
    if (!idAvailable) {
      alert('아이디 중복확인을 먼저 눌러 주세요.');
      return;
    }
    if (password !== confirmPassword) {
      alert('비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!isVerified) {
      alert('휴대폰 인증을 완료해 주세요.');
      return;
    }
    if (!companyName || !businessNumber || !contactPerson || !contactEmail) {
      alert('모든 필수 항목을 입력해 주세요.');
      return;
    }
    if (!isBizVerified) {
      alert('사업자등록번호 조회(국세청 확인)를 완료해 주세요.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/.netlify/functions/business-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'signup',
          company_name: companyName.trim(),
          business_number: businessNumber.trim(),
          business_verified: true,
          contact_person: contactPerson.trim(),
          contact_email: contactEmail.trim(),
          contact_phone: contactPhone.replace(/\D/g, ''),
          username: username.trim().toLowerCase(),
          password,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        alert(result.error || '회원가입 실패');
        return;
      }

      if (result.success) {
        alert('비즈니스 회원가입이 완료되었습니다. 로그인해주세요.');
        onSignupSuccess();
      } else {
        alert(result.error || '회원가입에 실패했습니다.');
      }
    } catch (error: any) {
      alert('서버 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  // 홈·로그인 화면과 같은 규칙을 쓰는 조각들(LoginPage · SignupPage 와 짝이다).
  const fieldShell =
    'flex items-center gap-2.5 bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-4 py-3 transition-colors focus-within:border-[#2563EB] focus-within:bg-white';
  const fieldInput =
    'bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold placeholder:text-[#C3C9DC] text-sm';
  const labelClass = 'block text-xs font-black text-[#39415C] ml-1';
  const sideButton =
    'shrink-0 px-4 rounded-2xl text-[12px] font-black transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed border';
  const neutralSideButton = `${sideButton} bg-[#F7F8FC] border-[#0B0F1A]/10 text-[#39415C] hover:border-[#2563EB]/45 hover:text-[#2563EB]`;
  const doneSideButton = `${sideButton} bg-[#10B981]/10 border-[#10B981]/35 text-[#0F9D6E]`;

  return (
    <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-16 paper-page overflow-y-auto">
      <div className="w-full max-w-sm sm:max-w-md">
        {/* 카드 밖의 인사말 — 비즈니스 로그인 화면과 같은 순서(알약 → 제목 → 설명)다. */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] text-[11px] font-black px-3.5 py-1.5 rounded-full shadow-sm">
            BUSINESS
          </span>
          <h1 className="mt-4 sm:mt-5 text-[1.6rem] sm:text-[2.15rem] leading-[1.18] font-black tracking-tighter text-[#0B0F1A] font-display">
            기업 회원으로
            <br />
            <span className="relative inline-block">
              <span className="relative z-10 text-[#2563EB]">인플루언서 협업</span>
              <span
                aria-hidden
                className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-2.5 -z-0 rounded-full"
                style={{ background: 'rgba(37,99,235,0.16)' }}
              />
            </span>
            을 시작하세요
          </h1>
          <p className="mt-2.5 sm:mt-3 text-sm text-[#4A5273] font-medium">
            사업자 정보를 확인하고 캠페인을 바로 등록할 수 있습니다.
          </p>
        </div>

        <div className="mt-6 sm:mt-7 bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-5 sm:p-7 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-1.5">
              <label className={labelClass}>회사명 *</label>
              <div className={fieldShell}>
                <Building2 size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className={fieldInput}
                  placeholder="회사명을 입력해 주세요"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>사업자등록번호 *</label>
              <div className="flex gap-2">
                <div className={`${fieldShell} flex-1 min-w-0 ${isBizVerified ? 'border-[#10B981]/45 bg-[#10B981]/[0.06]' : ''}`}>
                  <input
                    type="text"
                    value={businessNumber}
                    onChange={handleBusinessNumberChange}
                    size={1}
                    className={`${fieldInput} w-0 flex-1`}
                    placeholder="000-00-00000"
                    inputMode="numeric"
                    disabled={isBizVerified}
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={handleVerifyBusiness}
                  disabled={isBizVerifying || isBizVerified}
                  className={isBizVerified ? doneSideButton : neutralSideButton}
                >
                  {isBizVerifying ? '조회 중...' : isBizVerified ? '확인 완료' : '사업자 조회'}
                </button>
              </div>
              {bizVerifyMsg && (
                <p className="flex items-center gap-1 text-[11px] font-bold text-[#0F9D6E] ml-1">
                  <Check size={13} strokeWidth={3} className="shrink-0" />
                  {bizVerifyMsg}
                </p>
              )}
              {bizVerifyError && (
                <p className="flex items-start gap-1 text-[11px] font-bold text-[#D93F45] ml-1">
                  <X size={13} strokeWidth={3} className="shrink-0 mt-px" />
                  {bizVerifyError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>담당자명 *</label>
              <div className={fieldShell}>
                <User size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className={fieldInput}
                  placeholder="담당자 이름"
                  autoComplete="name"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>이메일 *</label>
              <div className={fieldShell}>
                <Mail size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className={fieldInput}
                  placeholder="company@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>아이디 (비즈니스 로그인용) *</label>
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
                  <span className="text-[#98A0BC] font-bold text-[13px] shrink-0">biz/</span>
                  <input
                    type="text"
                    value={username}
                    onChange={handleUsernameChange}
                    onKeyDown={(e) => {
                      // 이 칸에서 엔터는 "중복확인" 이다.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!isCheckingId) handleCheckId();
                      }
                    }}
                    size={1}
                    className={`${fieldInput} w-0 flex-1`}
                    placeholder="사용할 아이디"
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
                  disabled={isCheckingId || !username}
                  className={idAvailable ? doneSideButton : neutralSideButton}
                >
                  {isCheckingId ? '확인 중...' : idAvailable ? '사용 가능' : '중복확인'}
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
                  {usernameNotice || '영문 소문자·숫자·밑줄(_) 3~20자. 아이디는 나중에 변경할 수 없습니다.'}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>비밀번호 *</label>
              <div className={fieldShell}>
                <Lock size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={fieldInput}
                  placeholder="비밀번호를 입력해 주세요"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>비밀번호 확인 *</label>
              <div className={`${fieldShell} ${passwordMismatch ? 'border-[#E0454A]/45 bg-[#E0454A]/[0.05]' : ''}`}>
                <Lock size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={fieldInput}
                  placeholder="비밀번호를 다시 입력해 주세요"
                  autoComplete="new-password"
                  required
                />
              </div>
              {passwordMismatch && (
                <p className="flex items-center gap-1 text-[11px] font-bold text-[#D93F45] ml-1">
                  <X size={13} strokeWidth={3} className="shrink-0" />
                  비밀번호가 일치하지 않습니다.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className={labelClass}>담당자 연락처 *</label>
              <div className="flex gap-2">
                <div className={`${fieldShell} flex-1 min-w-0 ${isVerified ? 'border-[#10B981]/45 bg-[#10B981]/[0.06]' : ''}`}>
                  <Phone size={16} className="text-[#98A0BC] shrink-0" strokeWidth={2.5} />
                  <input
                    type="tel"
                    value={formatPhoneInput(contactPhone)}
                    onChange={(e) => setContactPhone(digitsOnly(e.target.value).slice(0, 11))}
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
                  className={isVerified ? doneSideButton : neutralSideButton}
                >
                  {isSending ? '발송 중...' : isVerified ? '인증 완료' : showVerificationInput ? '재전송' : '인증번호 전송'}
                </button>
              </div>
              {isVerified && (
                <p className="flex items-center gap-1 text-[11px] font-bold text-[#0F9D6E] ml-1">
                  <Check size={13} strokeWidth={3} className="shrink-0" />
                  휴대폰 인증이 완료되었습니다.
                </p>
              )}
            </div>

            {showVerificationInput && !isVerified && (
              <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className={labelClass}>인증번호</label>
                <div className="flex gap-2">
                  <div className={`${fieldShell} flex-1 min-w-0`}>
                    <input
                      type="text"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(digitsOnly(e.target.value).slice(0, 6))}
                      size={1}
                      className={`${fieldInput} w-0 flex-1 tracking-[0.3em]`}
                      placeholder="6자리 숫자"
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
                    {isVerifying ? '확인 중...' : '확인'}
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
                    가입 중...
                  </>
                ) : (
                  <>
                    비즈니스 회원가입
                    <ArrowRight size={16} strokeWidth={2.8} />
                  </>
                )}
              </button>
            </div>
          </form>

          <p className="text-center mt-5 text-[#8B93AE] text-[13px] font-bold">
            이미 비즈니스 계정이 있으신가요?{' '}
            <button onClick={onNavigateLogin} className="text-[#2563EB] font-black hover:underline" disabled={isLoading}>
              로그인
            </button>
          </p>
        </div>

        {/* 크리에이터 가입은 다른 종류의 계정이라 카드 밖에 둔다. 예전에는 이
            버튼이 홈으로만 보냈는데, 누른 사람이 원한 것은 가입 화면이다. */}
        <button
          type="button"
          onClick={() => { window.location.href = '/signup'; }}
          disabled={isLoading}
          className="w-full mt-4 py-3 rounded-full text-[13px] font-black transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-white text-[#0B0F1A] border border-[#0B0F1A]/10 hover:border-[#0B0F1A]/25 shadow-sm"
        >
          인플루언서이신가요? 일반 회원가입
        </button>

        <div className="text-center mt-4">
          <button
            onClick={onNavigateHome}
            className="text-[#8B93AE] text-xs font-bold hover:text-[#0B0F1A] transition-colors"
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
};

export default BusinessSignupPage;
