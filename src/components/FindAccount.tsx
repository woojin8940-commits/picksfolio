import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { digitsOnly, formatPhoneInput } from '../utils/formatters';

interface FoundAccount {
  username: string;
  display_name: string;
  created_at: string | null;
  account_type?: 'user' | 'business';
  login_method?: 'password' | 'kakao';
}

interface FindAccountProps {
  accountType: 'user' | 'business';
  onBack: () => void;
}

const FindAccount: React.FC<FindAccountProps> = ({ accountType, onBack }) => {
  const { language } = useLanguage();
  const isEn = language === 'en';

  const [step, setStep] = useState<'choose' | 'find-id' | 'reset-pw'>('choose');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [foundAccounts, setFoundAccounts] = useState<FoundAccount[]>([]);
  const [lookupError, setLookupError] = useState('');
  const [selectedUsername, setSelectedUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const smsPurpose = step === 'find-id' ? 'find-id' : 'reset-password';

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSendSMS = async () => {
    if (!name.trim()) {
      alert(isEn ? 'Please enter your name.' : '이름을 입력해 주세요.');
      return;
    }
    if (!phone) {
      alert(isEn ? 'Please enter your phone number.' : '휴대폰 번호를 입력해 주세요.');
      return;
    }
    setIsSending(true);
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: phone, purpose: smsPurpose }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        alert(isEn ? 'Verification code sent.' : '인증번호가 발송되었습니다.');
        setShowVerificationInput(true);
        setCooldown(60);
      } else {
        alert(data.error || data.message || (isEn ? 'Failed to send verification code.' : '인증번호 발송에 실패했습니다.'));
      }
    } catch {
      alert(isEn ? 'Server error occurred.' : '서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const fetchAccounts = async (lookupAction: 'find-id' | 'reset-lookup' = 'find-id') => {
    const res = await fetch('/.netlify/functions/find-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: lookupAction,
        name: name.trim(),
        phone: phone.replace(/\D/g, ''),
        account_type: accountType,
      }),
    });
    return res.json();
  };

  // 인증이 끝나면 바로 계정을 조회한다. 예전에는 인증 후 "아이디 찾기" 버튼을 한 번
  // 더 눌러야 했고, 조회가 실패하면 알림창만 뜨고 화면이 그대로 남아 무엇이
  // 잘못됐는지 알 수 없었다. 결과와 오류는 화면 안에 보여 준다.
  const lookupAccounts = async () => {
    setIsLoading(true);
    setLookupError('');
    try {
      const data = await fetchAccounts(step === 'find-id' ? 'find-id' : 'reset-lookup');
      if (data.success && data.accounts?.length) {
        setFoundAccounts(data.accounts);
        const firstPasswordAccount = data.accounts.find((a: FoundAccount) => a.login_method !== 'kakao') || data.accounts[0];
        setSelectedUsername(firstPasswordAccount.username);
      } else {
        if (data.code === 'VERIFICATION_REQUIRED') {
          setIsVerified(false);
          setShowVerificationInput(false);
          setVerificationCode('');
        }
        setFoundAccounts([]);
        setLookupError(data.error || (isEn ? 'No account found matching this info.' : '일치하는 계정을 찾을 수 없습니다.'));
      }
    } catch {
      setLookupError(isEn ? 'Server error occurred. Please try again.' : '서버 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySMS = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      alert(isEn ? 'Please enter 6-digit code.' : '6자리 인증번호를 입력해 주세요.');
      return;
    }
    setIsVerifying(true);
    try {
      const response = await fetch('/.netlify/functions/verify-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.replace(/\D/g, ''),
          code: verificationCode,
          purpose: smsPurpose,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setIsVerified(true);
        setIsVerifying(false);
        await lookupAccounts();
      } else {
        alert(data.error || (isEn ? 'Code does not match.' : '인증번호가 일치하지 않습니다.'));
      }
    } catch {
      alert(isEn ? 'Server error occurred.' : '서버 오류가 발생했습니다.');
    } finally {
      setIsVerifying(false);
    }
  };

  // 아이디 찾기 결과에서 바로 비밀번호 재설정으로 넘어간다. 서버는 아이디 찾기
  // 인증도 재설정에 인정하므로 문자를 다시 받지 않는다.
  const goToResetPassword = (username: string) => {
    setSelectedUsername(username);
    setNewPassword('');
    setConfirmPassword('');
    setResultMessage('');
    setStep('reset-pw');
  };

  const handleResetPassword = async () => {
    if (!isVerified) {
      alert(isEn ? 'Please verify your phone first.' : '휴대폰 인증을 완료해 주세요.');
      return;
    }
    if (!selectedUsername) {
      alert(isEn ? 'No username selected.' : '재설정할 아이디가 선택되지 않았습니다.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      alert(isEn ? 'Password must be at least 6 characters.' : '새 비밀번호를 6자 이상 입력해 주세요.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert(isEn ? 'Passwords do not match.' : '비밀번호가 일치하지 않습니다.');
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('/.netlify/functions/find-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset-pw',
          name: name.trim(),
          phone: phone.replace(/\D/g, ''),
          account_type: accountType,
          username: selectedUsername,
          new_password: newPassword,
        }),
      });
      const data = await response.json();
      if (data.success) {
        if (data.username) setSelectedUsername(data.username);
        setResultMessage(isEn ? 'Password reset successfully. Please log in with your new password.' : '비밀번호가 성공적으로 변경되었습니다. 새 비밀번호로 로그인해 주세요.');
      } else {
        if (data.code === 'VERIFICATION_REQUIRED') {
          setIsVerified(false);
          setShowVerificationInput(false);
          setVerificationCode('');
          setFoundAccounts([]);
        }
        alert(data.error || (isEn ? 'Failed to reset password.' : '비밀번호 변경에 실패했습니다.'));
      }
    } catch {
      alert(isEn ? 'Server error occurred.' : '서버 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetState = () => {
    setName('');
    setPhone('');
    setVerificationCode('');
    setShowVerificationInput(false);
    setIsVerified(false);
    setFoundAccounts([]);
    setLookupError('');
    setSelectedUsername('');
    setNewPassword('');
    setConfirmPassword('');
    setResultMessage('');
    setCooldown(0);
  };

  const accentClasses = {
    ring: 'focus:ring-[#2563EB]/20 focus:border-[#2563EB] focus-within:border-[#2563EB]',
    btn: 'bg-[#2563EB] hover:bg-[#1d4ed8]',
    btnShadow: 'shadow-[0_12px_28px_-12px_rgba(37,99,235,0.8)]',
    text: 'text-[#2563EB]',
  };

  const PhoneVerificationSection = () => (
    <>
      <div className="space-y-2">
        <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'Name' : '이름'}</label>
        <div className={`bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
          <input
            type="text" value={name}
            onChange={e => setName(e.target.value)}
            className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold"
            placeholder={isEn ? 'Name registered during signup' : '가입 시 등록한 이름'}
            disabled={isVerified && !lookupError}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'Phone Number' : '휴대폰 번호'}</label>
        <div className="flex gap-2">
          <div className={`flex-1 bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
            <input
              type="tel" value={formatPhoneInput(phone)}
              onChange={e => setPhone(digitsOnly(e.target.value).slice(0, 11))}
              className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold"
              placeholder="010-1234-5678"
              inputMode="numeric"
              disabled={isVerified}
            />
          </div>
          <button
            type="button" onClick={handleSendSMS}
            disabled={isSending || isVerified || cooldown > 0}
            className={`px-4 py-3 ${accentClasses.btn} text-white rounded-full font-black text-xs transition-all disabled:opacity-50 whitespace-nowrap flex-shrink-0`}
          >
            {isSending
              ? (isEn ? 'Sending...' : '발송중...')
              : isVerified
              ? (isEn ? 'Verified' : '인증완료')
              : cooldown > 0
              ? `${cooldown}s`
              : (isEn ? 'Send Code' : '인증번호 전송')}
          </button>
        </div>
      </div>

      {showVerificationInput && !isVerified && (
        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'Verification Code' : '인증번호'}</label>
          <div className="flex gap-2">
            <div className={`flex-1 bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
              <input
                type="text" value={verificationCode}
                onChange={e => setVerificationCode(e.target.value)}
                className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold"
                placeholder={isEn ? '6-digit code' : '6자리 숫자 입력'}
                maxLength={6}
                inputMode="numeric"
              />
            </div>
            <button
              type="button" onClick={handleVerifySMS}
              disabled={isVerifying}
              className={`px-5 py-3 ${accentClasses.btn} text-white rounded-full font-black text-xs transition-all whitespace-nowrap flex-shrink-0 disabled:opacity-50`}
            >
              {isVerifying ? (isEn ? 'Verifying...' : '확인중...') : (isEn ? 'Verify' : '확인')}
            </button>
          </div>
          <p className="text-xs text-[#8B93AE] font-medium ml-1">{isEn ? 'Code is valid for 5 minutes.' : '인증번호는 5분 동안 유효합니다.'}</p>
        </div>
      )}
    </>
  );

  const accountTypeLabel = (acc: FoundAccount) => {
    const isBusiness = acc.account_type === 'business';
    const isKakao = acc.login_method === 'kakao';
    return (
      <span className="flex flex-wrap gap-1 mt-1.5">
        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#EEF1F8] text-[#4A5273]">
          {isBusiness ? (isEn ? 'Business' : '비즈니스 계정') : (isEn ? 'Creator' : '크리에이터 계정')}
        </span>
        {isKakao && (
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-[#FEE500] text-[#3C1E1E]">
            {isEn ? 'Kakao login' : '카카오 로그인'}
          </span>
        )}
      </span>
    );
  };

  // 인증 뒤 조회 중이거나 조회에 실패했을 때 화면 안에 보여 준다.
  const LookupStatus = () => {
    if (isLoading && foundAccounts.length === 0) {
      return (
        <div className="flex items-center justify-center gap-2 py-4 text-sm font-bold text-[#4A5273]">
          <div className="w-5 h-5 border-2 border-[#2563EB]/30 border-t-[#2563EB] rounded-full animate-spin"></div>
          {isEn ? 'Looking up your account...' : '가입한 계정을 찾는 중...'}
        </div>
      );
    }
    if (!lookupError) return null;
    return (
      <div className="bg-[#FFF4F4] border border-[#E5484D]/20 rounded-2xl p-4 animate-in fade-in duration-300">
        <p className="text-sm font-bold text-[#B42318]">{lookupError}</p>
        {isVerified && (
          <p className="text-xs text-[#8B93AE] font-medium mt-1">
            {isEn ? 'Correct the name above and try again — no new code needed.' : '위 이름을 고친 뒤 다시 조회하면 인증번호를 다시 받지 않아도 됩니다.'}
          </p>
        )}
        <div className="flex gap-2 mt-3">
          {isVerified && (
            <button
              type="button" onClick={lookupAccounts}
              disabled={isLoading}
              className={`flex-1 ${accentClasses.btn} text-white py-2.5 rounded-full text-xs font-black disabled:opacity-50`}
            >
              {isEn ? 'Try again' : '다시 조회'}
            </button>
          )}
        </div>
      </div>
    );
  };

  if (step === 'choose') {
    return (
      <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 paper-page overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-6 sm:p-9 md:p-10 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="text-center mb-10">
            <h1 className="text-2xl font-black text-[#0B0F1A] mb-2">{isEn ? 'Find Account' : '계정 찾기'}</h1>
            <p className="text-[#4A5273] text-sm font-medium">
              {isEn ? 'Find your ID or reset password with phone verification.' : '휴대폰 인증으로 아이디 찾기 또는 비밀번호를 재설정합니다.'}
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => { resetState(); setStep('find-id'); }}
              className="w-full bg-[#F7F8FC] hover:bg-[#EEF1F8] border border-[#0B0F1A]/[0.08] rounded-2xl p-5 text-left transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl shadow-sm flex-shrink-0">
                  🔍
                </div>
                <div>
                  <h3 className="font-black text-[#0B0F1A] text-sm">{isEn ? 'Find Username' : '아이디 찾기'}</h3>
                  <p className="text-xs text-[#8B93AE] font-medium mt-0.5">{isEn ? 'Find ID with your name & phone number' : '이름과 전화번호로 아이디를 찾습니다'}</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => { resetState(); setStep('reset-pw'); }}
              className="w-full bg-[#F7F8FC] hover:bg-[#EEF1F8] border border-[#0B0F1A]/[0.08] rounded-2xl p-5 text-left transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl shadow-sm flex-shrink-0">
                  🔑
                </div>
                <div>
                  <h3 className="font-black text-[#0B0F1A] text-sm">{isEn ? 'Reset Password' : '비밀번호 재설정'}</h3>
                  <p className="text-xs text-[#8B93AE] font-medium mt-0.5">{isEn ? 'Reset password after phone verification' : '이름·전화번호 인증 후 새 비밀번호를 설정합니다'}</p>
                </div>
              </div>
            </button>
          </div>

          <div className="text-center mt-8">
            <button onClick={onBack} className="text-[#8B93AE] text-sm font-bold hover:text-[#0B0F1A] transition-colors">
              {isEn ? 'Back to Login' : '로그인으로 돌아가기'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'find-id') {
    return (
      <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 paper-page overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-6 sm:p-9 md:p-10 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black text-[#0B0F1A] mb-2">{isEn ? 'Find Username' : '아이디 찾기'}</h1>
            <p className="text-[#4A5273] text-sm font-medium">{isEn ? 'Find ID registered with name & phone number.' : '회원가입 시 등록한 이름과 전화번호로 아이디를 찾습니다.'}</p>
          </div>

          <div className="space-y-4">
            {foundAccounts.length === 0 && PhoneVerificationSection()}
            {LookupStatus()}

            {foundAccounts.length > 0 && (
              <div className="animate-in fade-in duration-300 space-y-4">
                <div className="bg-[#F7F8FC] border border-[#0B0F1A]/[0.06] rounded-2xl p-5">
                  <h3 className="font-black text-sm text-[#0B0F1A] mb-1">
                    {isEn ? `Accounts registered to ${name.trim()}` : `${name.trim()}님이 가입한 아이디`}
                  </h3>
                  <p className="text-xs text-[#8B93AE] font-medium mb-3">
                    {isEn ? 'Verified with your phone number.' : '휴대폰 인증으로 확인된 계정입니다.'}
                  </p>
                  <div className="space-y-2">
                    {foundAccounts.map((acc, i) => (
                      <div key={i} className="bg-white rounded-xl p-4 border border-[#0B0F1A]/[0.07] flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`font-black text-base ${accentClasses.text} break-all`}>{acc.username}</p>
                          {accountTypeLabel(acc)}
                          {acc.created_at && <p className="text-[10px] text-[#A6ADC6] font-bold mt-1">{isEn ? 'Joined: ' : '가입일: '}{new Date(acc.created_at).toLocaleDateString(isEn ? 'en-US' : 'ko-KR')}</p>}
                        </div>
                        {acc.login_method !== 'kakao' && (
                          <button
                            type="button" onClick={() => goToResetPassword(acc.username)}
                            className="flex-shrink-0 text-[11px] font-black text-[#2563EB] bg-[#2563EB]/[0.08] hover:bg-[#2563EB]/[0.14] px-3 py-2 rounded-full transition-colors"
                          >
                            {isEn ? 'Reset password' : '비밀번호 재설정'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {foundAccounts.some(a => a.login_method === 'kakao') && (
                    <p className="text-[11px] text-[#8B93AE] font-medium mt-3">
                      {isEn ? 'Kakao accounts sign in with the Kakao login button.' : '카카오 로그인 계정은 로그인 화면의 카카오 로그인 버튼으로 들어갈 수 있습니다.'}
                    </p>
                  )}
                </div>
                <button
                  onClick={onBack}
                  className={`w-full ${accentClasses.btn} text-white py-3.5 rounded-full text-base font-black transition-all ${accentClasses.btnShadow} active:scale-95`}
                >
                  {isEn ? 'Go to Login' : '로그인하러 가기'}
                </button>
              </div>
            )}
          </div>

          <div className="text-center mt-8 space-y-2">
            <button onClick={() => setStep('choose')} className="text-[#8B93AE] text-sm font-bold hover:text-[#0B0F1A] transition-colors block mx-auto">
              {isEn ? 'Choose another option' : '다른 방법으로 찾기'}
            </button>
            <button onClick={onBack} className="text-[#8B93AE] text-xs font-bold hover:text-[#0B0F1A] transition-colors block mx-auto">
              {isEn ? 'Back to Login' : '로그인으로 돌아가기'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'reset-pw') {
    return (
      <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 paper-page overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-6 sm:p-9 md:p-10 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black text-[#0B0F1A] mb-2">{isEn ? 'Reset Password' : '비밀번호 재설정'}</h1>
            <p className="text-[#4A5273] text-sm font-medium">{isEn ? 'Set a new password after phone verification.' : '이름·전화번호 인증 후 새 비밀번호를 설정합니다.'}</p>
          </div>

          {resultMessage ? (
            <div className="text-center animate-in fade-in duration-300">
              <div className="text-5xl mb-4">✅</div>
              <p className="font-black text-[#0B0F1A] text-base mb-2">{isEn ? 'Password Reset Complete' : '비밀번호 변경 완료'}</p>
              {selectedUsername && (
                <p className="text-sm font-black text-[#0B0F1A] mb-1">{isEn ? 'Username: ' : '아이디: '}<span className={accentClasses.text}>{selectedUsername}</span></p>
              )}
              <p className="text-sm text-[#4A5273] font-medium mb-6">{resultMessage}</p>
              <button onClick={onBack} className={`w-full ${accentClasses.btn} text-white py-3.5 rounded-full text-base font-black transition-all`}>
                {isEn ? 'Go to Login' : '로그인하러 가기'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {!(isVerified && foundAccounts.length > 0) && PhoneVerificationSection()}
              {LookupStatus()}

              {isVerified && foundAccounts.length > 0 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-2">
                    <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'Username' : '아이디'}</label>
                    {foundAccounts.length > 1 ? (
                      <div className={`bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
                        <select
                          value={selectedUsername}
                          onChange={e => setSelectedUsername(e.target.value)}
                          className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold"
                        >
                          {foundAccounts.map((acc, i) => (
                            <option key={i} value={acc.username}>
                              {acc.username} · {acc.account_type === 'business' ? (isEn ? 'Business' : '비즈니스') : (isEn ? 'Creator' : '크리에이터')}{acc.login_method === 'kakao' ? (isEn ? ' · Kakao' : ' · 카카오') : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-5 py-4 flex items-center justify-between">
                        <span className={`font-black ${accentClasses.text} break-all`}>{selectedUsername}</span>
                        <span className="text-[11px] text-[#A6ADC6] font-bold flex-shrink-0">{isEn ? 'Verified Account' : '인증된 계정'}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'New Password' : '새 비밀번호'}</label>
                    <div className={`bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
                      <input
                        type="password" value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold"
                        placeholder={isEn ? 'New password (min 6 chars)' : '새 비밀번호 (6자 이상)'}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-black text-[#39415C] ml-1">{isEn ? 'Confirm Password' : '비밀번호 확인'}</label>
                    <div className={`bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
                      <input
                        type="password" value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold"
                        placeholder={isEn ? 'Confirm new password' : '비밀번호를 다시 입력해 주세요'}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleResetPassword} disabled={isLoading}
                    className={`w-full ${accentClasses.btn} text-white py-3.5 rounded-full text-base font-black transition-all ${accentClasses.btnShadow} active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2`}
                  >
                    {isLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        {isEn ? 'Resetting...' : '변경 중...'}
                      </>
                    ) : (isEn ? 'Reset Password' : '비밀번호 변경')}
                  </button>
                </div>
              )}
            </div>
          )}

          {!resultMessage && (
            <div className="text-center mt-8 space-y-2">
              <button onClick={() => setStep('choose')} className="text-[#8B93AE] text-sm font-bold hover:text-[#0B0F1A] transition-colors block mx-auto">
                {isEn ? 'Choose another option' : '다른 방법으로 찾기'}
              </button>
              <button onClick={onBack} className="text-[#8B93AE] text-xs font-bold hover:text-[#0B0F1A] transition-colors block mx-auto">
                {isEn ? 'Back to Login' : '로그인으로 돌아가기'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default FindAccount;
