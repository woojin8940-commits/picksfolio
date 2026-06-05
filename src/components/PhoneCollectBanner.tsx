import React, { useState } from 'react';
import { supabase } from '../services/supabase';

interface PhoneCollectBannerProps {
  onPhoneUpdated: () => void;
}

const PhoneCollectBanner: React.FC<PhoneCollectBannerProps> = ({ onPhoneUpdated }) => {
  const [phone, setPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [step, setStep] = useState<'input' | 'verify' | 'saving'>('input');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  const handleSendSMS = async () => {
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      setError('올바른 전화번호를 입력해 주세요.');
      return;
    }
    setIsSending(true);
    setError('');
    try {
      const response = await fetch('/.netlify/functions/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiver: phone.replace(/\D/g, ''), purpose: 'update_phone' }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setVerificationCode('');
        setStep('verify');
      } else {
        setError(data.error || data.message || '인증번호 발송에 실패했습니다.');
      }
    } catch {
      setError('서버 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyAndSave = async () => {
    if (!verificationCode) {
      setError('인증번호를 입력해 주세요.');
      return;
    }
    setStep('saving');
    setError('');
    try {
      // Verify the code against the server (the code never leaves the server)
      const verifyRes = await fetch('/.netlify/functions/verify-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ''), code: verificationCode, purpose: 'update_phone' }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        setError(verifyData.error || '인증번호가 일치하지 않습니다.');
        setStep('verify');
        return;
      }

      const session = await supabase?.auth.getSession();
      const token = session?.data?.session?.access_token;
      if (!token) {
        setError('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
        setStep('verify');
        return;
      }

      const response = await fetch('/.netlify/functions/update-phone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: phone.replace(/\D/g, '') }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        // Refresh local session to pick up updated user_metadata set by admin API
        try {
          await supabase?.auth.refreshSession();
        } catch {
          // Non-critical — the phone is already saved server-side
        }
        onPhoneUpdated();
      } else {
        setError(data.error || '전화번호 저장에 실패했습니다.');
        setStep('verify');
      }
    } catch {
      setError('서버 오류가 발생했습니다.');
      setStep('verify');
    }
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-800 relative">
      <div className="max-w-lg mx-auto">
        <p className="font-medium mb-2 text-center">
          전화번호가 등록되지 않았습니다. 서비스 이용을 위해 전화번호를 등록해 주세요.
        </p>
        {error && (
          <p className="text-red-600 text-xs mb-2 text-center">{error}</p>
        )}
        {step === 'input' && (
          <div className="flex gap-2 items-center justify-center">
            <input
              type="tel"
              placeholder="01012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm w-40 bg-white text-slate-900 focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={handleSendSMS}
              disabled={isSending}
              className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {isSending ? '발송 중...' : '인증번호 발송'}
            </button>
          </div>
        )}
        {step === 'verify' && (
          <div className="flex gap-2 items-center justify-center">
            <input
              type="text"
              placeholder="인증번호 6자리"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              maxLength={6}
              className="border border-amber-300 rounded-lg px-3 py-1.5 text-sm w-32 bg-white text-slate-900 focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={handleVerifyAndSave}
              className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-700"
            >
              확인
            </button>
            <button
              onClick={() => { setStep('input'); setVerificationCode(''); setError(''); }}
              className="text-amber-600 text-xs hover:underline"
            >
              다시 발송
            </button>
          </div>
        )}
        {step === 'saving' && (
          <p className="text-center text-amber-600 text-xs">저장 중...</p>
        )}
      </div>
    </div>
  );
};

export default PhoneCollectBanner;
