
import React, { useState } from 'react';
import { supabase } from '../services/supabase';

interface SetupLinkProps {
  userId: string;
  onSetupComplete: (username: string) => void;
}

const SetupLink: React.FC<SetupLinkProps> = ({ userId, onSetupComplete }) => {
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const validateUsername = (value: string) => {
    if (value.length < 3) return '3자 이상 입력해 주세요.';
    if (value.length > 20) return '20자 이하로 입력해 주세요.';
    if (!/^[a-z0-9_]+$/.test(value)) return '영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다.';
    return '';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const originalValue = e.target.value;
    const value = originalValue.toLowerCase().replace(/[^a-z0-9_]/g, '');
    
    if (originalValue !== value) {
      if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(originalValue)) {
        setError('링크는 영문, 숫자, 밑줄(_)만 입력 가능합니다.');
      } else {
        setError('영문 소문자, 숫자, 밑줄(_)만 사용할 수 있습니다.');
      }
    } else {
      setError('');
    }
    
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
      localStorage.setItem('picks_user_session', username);
      onSetupComplete(username);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Check if username is already taken
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      if (existing) {
        setError('이미 사용 중인 링크입니다. 다른 링크를 입력해 주세요.');
        setIsLoading(false);
        return;
      }

      // Update the user's profile with the chosen username
      const profilePayload: Record<string, any> = {
        id: userId,
        username: username,
        role: 'user',
        updated_at: new Date().toISOString(),
      };
      let { error: updateError } = await supabase
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' });

      // If upsert failed due to unknown column, retry with only core fields
      if (updateError && updateError.message && /column.*does not exist/i.test(updateError.message)) {
        console.warn('[SetupLink] Upsert failed due to missing column, retrying with core fields:', updateError.message);
        const corePayload = { id: userId, username: username, updated_at: new Date().toISOString() };
        const retryResult = await supabase
          .from('profiles')
          .upsert(corePayload, { onConflict: 'id' });
        updateError = retryResult.error;
      }

      if (updateError) {
        console.error('Profile update error:', updateError);
        setError('저장 중 오류가 발생했습니다. 다시 시도해 주세요.');
        return;
      }

      onSetupComplete(username);
    } catch (err: any) {
      console.error('SetupLink error:', err);
      setError('서버 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-20 bg-midnight">
      <div className="w-full max-w-[440px] bg-white rounded-[40px] p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">환영합니다!</h1>
          <p className="text-slate-500 text-sm font-medium leading-relaxed">
            사용할 고유 링크를 만들어주세요.<br />
            이 링크가 나만의 페이지 주소가 됩니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">나만의 링크</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-blue-500 transition-colors flex items-center gap-2">
              <span className="text-slate-400 text-sm font-bold whitespace-nowrap">picks.me/</span>
              <input
                type="text"
                placeholder="my-link"
                value={username}
                onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
                maxLength={20}
                autoFocus
              />
            </div>
            {error && (
              <p className="text-red-500 text-xs font-bold ml-1">{error}</p>
            )}
            <p className="text-slate-400 text-xs ml-1">영문 소문자, 숫자, 밑줄(_)만 사용 가능 (3~20자)</p>
          </div>

          <button
            type="submit"
            disabled={isLoading || username.length < 3}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl text-lg font-black transition-all hover:shadow-[0_10px_30px_rgba(124,58,237,0.3)] active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                저장 중...
              </>
            ) : (
              '저장하기'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SetupLink;
