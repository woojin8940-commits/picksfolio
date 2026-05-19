import React, { useState } from 'react';

interface FindAccountProps {
  accountType: 'user' | 'business';
  onBack: () => void;
}

const FindAccount: React.FC<FindAccountProps> = ({ accountType, onBack }) => {
  const [step, setStep] = useState<'choose' | 'find-id' | 'reset-pw'>('choose');
  const [phone, setPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [foundAccounts, setFoundAccounts] = useState<Array<{ username: string; display_name: string; created_at: string }>>([]);
  const [selectedUsername, setSelectedUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resultMessage, setResultMessage] = useState('');

  const handleSendSMS = async () => {
    if (!phone) {
      alert('휴대폰 번호를 입력해 주세요.');
      return;
    }
    setIsSending(true);
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: phone }),
      });
      const data = await response.json();
      if (response.ok) {
        setGeneratedCode(data.code);
        alert('인증번호가 발송되었습니다.');
        setShowVerificationInput(true);
      } else {
        alert(data.message || '인증번호 발송에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifySMS = () => {
    if (verificationCode === generatedCode && generatedCode !== '') {
      alert('인증되었습니다.');
      setIsVerified(true);
    } else {
      alert('인증번호가 일치하지 않습니다.');
    }
  };

  const handleFindId = async () => {
    if (!isVerified) {
      alert('휴대폰 인증을 완료해 주세요.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/.netlify/functions/find-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'find-id',
          phone: phone.replace(/\D/g, ''),
          account_type: accountType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFoundAccounts(data.accounts);
      } else {
        alert(data.error || '계정을 찾을 수 없습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!isVerified) {
      alert('휴대폰 인증을 완료해 주세요.');
      return;
    }
    if (!selectedUsername) {
      alert('아이디를 입력해 주세요.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      alert('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('비밀번호가 일치하지 않습니다.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/.netlify/functions/find-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset-password',
          phone: phone.replace(/\D/g, ''),
          username: selectedUsername.trim().toLowerCase(),
          new_password: newPassword,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResultMessage('비밀번호가 변경되었습니다. 로그인 페이지로 돌아가서 새 비밀번호로 로그인하세요.');
      } else {
        alert(data.error || '비밀번호 변경에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetState = () => {
    setPhone('');
    setIsSending(false);
    setGeneratedCode('');
    setVerificationCode('');
    setShowVerificationInput(false);
    setIsVerified(false);
    setFoundAccounts([]);
    setSelectedUsername('');
    setNewPassword('');
    setConfirmPassword('');
    setResultMessage('');
  };

  const accentClasses = {
    ring: accountType === 'business' ? 'focus:ring-blue-500/20 focus:border-blue-500 focus-within:border-blue-500' : 'focus:ring-purple-500/20 focus:border-purple-500 focus-within:border-purple-500',
    btn: accountType === 'business' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-purple-600 hover:bg-purple-500',
    btnShadow: accountType === 'business' ? 'hover:shadow-[0_10px_30px_rgba(37,99,235,0.3)]' : 'hover:shadow-[0_10px_30px_rgba(124,58,237,0.3)]',
    text: accountType === 'business' ? 'text-blue-600' : 'text-purple-600',
  };

  const PhoneVerificationSection = () => (
    <>
      <div className="space-y-2">
        <label className="block text-sm font-black text-slate-800 ml-1">휴대폰 번호</label>
        <div className="flex gap-2">
          <div className={`flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
            <input
              type="tel" value={phone}
              onChange={e => setPhone(e.target.value)}
              className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
              placeholder="01012345678"
              inputMode="numeric"
              disabled={isVerified}
            />
          </div>
          <button
            type="button" onClick={handleSendSMS}
            disabled={isSending || isVerified}
            className={`px-4 py-3 ${accentClasses.btn} text-white rounded-2xl font-black text-xs transition-all disabled:opacity-50 whitespace-nowrap flex-shrink-0`}
          >
            {isSending ? '발송중...' : isVerified ? '인증완료' : '인증번호 전송'}
          </button>
        </div>
      </div>

      {showVerificationInput && !isVerified && (
        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
          <label className="block text-sm font-black text-slate-800 ml-1">인증번호</label>
          <div className="flex gap-2">
            <div className={`flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
              <input
                type="text" value={verificationCode}
                onChange={e => setVerificationCode(e.target.value)}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                placeholder="6자리 숫자 입력"
                maxLength={6}
                inputMode="numeric"
              />
            </div>
            <button
              type="button" onClick={handleVerifySMS}
              className={`px-5 py-3 ${accentClasses.btn} text-white rounded-2xl font-black text-xs transition-all whitespace-nowrap flex-shrink-0`}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (step === 'choose') {
    return (
      <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 bg-midnight overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white rounded-[32px] sm:rounded-[40px] p-7 sm:p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-10">
            <h1 className="text-2xl font-black text-slate-900 mb-2">계정 찾기</h1>
            <p className="text-slate-500 text-sm font-medium">휴대폰 인증으로 아이디 찾기 또는 비밀번호를 재설정합니다.</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => { resetState(); setStep('find-id'); }}
              className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl p-5 text-left transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl shadow-sm flex-shrink-0">
                  🔍
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm">아이디 찾기</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">등록된 전화번호로 아이디를 찾습니다</p>
                </div>
              </div>
            </button>

            <button
              onClick={() => { resetState(); setStep('reset-pw'); }}
              className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-2xl p-5 text-left transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-2xl shadow-sm flex-shrink-0">
                  🔑
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm">비밀번호 재설정</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">전화번호 인증 후 새 비밀번호를 설정합니다</p>
                </div>
              </div>
            </button>
          </div>

          <div className="text-center mt-8">
            <button onClick={onBack} className="text-slate-400 text-sm font-bold hover:text-slate-600 transition-colors">
              로그인으로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'find-id') {
    return (
      <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 bg-midnight overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white rounded-[32px] sm:rounded-[40px] p-7 sm:p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black text-slate-900 mb-2">아이디 찾기</h1>
            <p className="text-slate-500 text-sm font-medium">회원가입 시 등록한 전화번호로 아이디를 찾습니다.</p>
          </div>

          <div className="space-y-4">
            <PhoneVerificationSection />

            {isVerified && foundAccounts.length === 0 && (
              <button
                onClick={handleFindId} disabled={isLoading}
                className={`w-full ${accentClasses.btn} text-white py-4 rounded-2xl text-base font-black transition-all ${accentClasses.btnShadow} active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2`}
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    찾는 중...
                  </>
                ) : '아이디 찾기'}
              </button>
            )}

            {foundAccounts.length > 0 && (
              <div className="bg-slate-50 rounded-2xl p-5 animate-in fade-in duration-300">
                <h3 className="font-black text-sm text-slate-900 mb-3">찾은 계정</h3>
                <div className="space-y-2">
                  {foundAccounts.map((acc, i) => (
                    <div key={i} className="bg-white rounded-xl p-4 border border-slate-100">
                      <p className={`font-black text-base ${accentClasses.text}`}>{acc.username}</p>
                      {acc.display_name && <p className="text-xs text-slate-500 font-medium mt-0.5">{acc.display_name}</p>}
                      <p className="text-[10px] text-slate-400 font-bold mt-1">가입일: {new Date(acc.created_at).toLocaleDateString('ko-KR')}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="text-center mt-8 space-y-2">
            <button onClick={() => setStep('choose')} className="text-slate-400 text-sm font-bold hover:text-slate-600 transition-colors block mx-auto">
              다른 방법으로 찾기
            </button>
            <button onClick={onBack} className="text-slate-400 text-xs font-bold hover:text-slate-600 transition-colors block mx-auto">
              로그인으로 돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'reset-pw') {
    return (
      <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 bg-midnight overflow-y-auto">
        <div className="w-full max-w-[440px] bg-white rounded-[32px] sm:rounded-[40px] p-7 sm:p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black text-slate-900 mb-2">비밀번호 재설정</h1>
            <p className="text-slate-500 text-sm font-medium">전화번호 인증 후 새 비밀번호를 설정합니다.</p>
          </div>

          {resultMessage ? (
            <div className="text-center animate-in fade-in duration-300">
              <div className="text-5xl mb-4">✅</div>
              <p className="font-black text-slate-900 text-base mb-2">비밀번호 변경 완료</p>
              <p className="text-sm text-slate-500 font-medium mb-6">{resultMessage}</p>
              <button onClick={onBack} className={`w-full ${accentClasses.btn} text-white py-4 rounded-2xl text-base font-black transition-all`}>
                로그인하러 가기
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <PhoneVerificationSection />

              {isVerified && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-2">
                    <label className="block text-sm font-black text-slate-800 ml-1">아이디</label>
                    <div className={`bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
                      <input
                        type="text" value={selectedUsername}
                        onChange={e => setSelectedUsername(e.target.value)}
                        className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                        placeholder="아이디를 입력해 주세요"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-black text-slate-800 ml-1">새 비밀번호</label>
                    <div className={`bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
                      <input
                        type="password" value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                        placeholder="새 비밀번호 (6자 이상)"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-black text-slate-800 ml-1">비밀번호 확인</label>
                    <div className={`bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 ${accentClasses.ring} transition-colors`}>
                      <input
                        type="password" value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                        placeholder="비밀번호를 다시 입력해 주세요"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleResetPassword} disabled={isLoading}
                    className={`w-full ${accentClasses.btn} text-white py-4 rounded-2xl text-base font-black transition-all ${accentClasses.btnShadow} active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2`}
                  >
                    {isLoading ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        변경 중...
                      </>
                    ) : '비밀번호 변경'}
                  </button>
                </div>
              )}
            </div>
          )}

          {!resultMessage && (
            <div className="text-center mt-8 space-y-2">
              <button onClick={() => setStep('choose')} className="text-slate-400 text-sm font-bold hover:text-slate-600 transition-colors block mx-auto">
                다른 방법으로 찾기
              </button>
              <button onClick={onBack} className="text-slate-400 text-xs font-bold hover:text-slate-600 transition-colors block mx-auto">
                로그인으로 돌아가기
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
