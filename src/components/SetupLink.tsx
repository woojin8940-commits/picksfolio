
import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { claimUsername } from '../services/apiService';
import { sessionSet } from '../utils/accountScope';

interface SetupLinkProps {
  onSetupComplete: (username: string) => void;
}

/**
 * 가입 직후 "나만의 링크"(= 아이디 · 개인페이지 주소)를 정하는 화면.
 *
 * 저장은 서버(auth-claim-username)가 한다. 예전에는 이 화면이 수파베이스 profiles 로
 * 직접 upsert 했는데, 그러면 실패할 수 있는 이유가 여러 가지인데도 화면에 남는 말은
 * "저장 중 오류가 발생했습니다." 한 줄이었다 — 이름이 이미 쓰이고 있어서인지, 로그인
 * 세션이 아직 준비되지 않아서인지, 잠깐의 네트워크 문제인지 알 수 없으니 사용자가
 * 할 수 있는 것도 없었다. 지금은 서버가 이유를 붙여 답하고, 화면은 그 이유에 맞는
 * 다음 행동(다른 이름 · 다시 로그인 · 다시 시도)을 보여준다.
 */
const SetupLink: React.FC<SetupLinkProps> = ({ onSetupComplete }) => {
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  /** 다시 로그인해야 하는 상태. 이때는 "다시 시도" 가 아무 소용이 없다. */
  const [needsLogin, setNeedsLogin] = useState(false);

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
              <span className="text-slate-400 text-sm font-bold whitespace-nowrap">picks-folio.com/</span>
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
              <div className="ml-1 space-y-1">
                <p className="text-red-500 text-xs font-bold">{error}</p>
                {needsLogin && (
                  <button
                    type="button"
                    onClick={() => window.location.assign('/login')}
                    className="text-blue-600 text-xs font-black underline"
                  >
                    다시 로그인하기
                  </button>
                )}
              </div>
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
