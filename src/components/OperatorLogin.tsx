import React, { useState, useEffect } from 'react';
import { login, acceptInvite, handleAuthCallback, AuthError, MissingIdentityError } from '@netlify/identity';

const ADMIN_EMAILS = ['woojin8940@inplace-ad.com', 'picksfolio@picks.me'];
const ADMIN_USERNAMES = ['picksfolio', 'picksfolio12'];

interface OperatorLoginProps {
  onLoginSuccess: (info?: { username: string; token: string }) => void;
}

const OperatorLogin: React.FC<OperatorLoginProps> = ({ onLoginSuccess }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const processHash = async () => {
      try {
        const hash = window.location.hash;
        if (hash && hash.includes('invite_token=')) {
          const result = await handleAuthCallback();
          if (result?.type === 'invite' && result.token) {
            setInviteToken(result.token);
          }
        }
      } catch (err) {
        console.error('Error processing auth callback:', err);
      } finally {
        setChecking(false);
      }
    };
    processHash();
  }, []);

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      await acceptInvite(inviteToken!, password);
      setInviteToken(null);
      window.history.replaceState(null, '', window.location.pathname);
      onLoginSuccess();
      return;
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message);
      } else {
        setError('초대 수락 중 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isEmailInput = (input: string) => input.includes('@');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const input = identifier.trim();

    if (isEmailInput(input)) {
      try {
        const user = await login(input, password);
        const roles: string[] = (user as any).app_metadata?.roles || [];
        if (!roles.includes('admin') && !ADMIN_EMAILS.includes(input.toLowerCase())) {
          setError('관리자 권한이 없는 계정입니다.');
          setLoading(false);
          return;
        }
        onLoginSuccess();
      } catch (err) {
        if (err instanceof MissingIdentityError) {
          setError('Identity 서비스가 설정되지 않았습니다.');
        } else if (err instanceof AuthError) {
          setError(err.status === 401 ? '이메일 또는 비밀번호가 올바르지 않습니다.' : err.message);
        } else {
          setError('로그인 중 오류가 발생했습니다.');
        }
        setLoading(false);
      }
      return;
    }

    const usernameClean = input.toLowerCase();
    try {
      await fetch('/.netlify/functions/admin-seed', { method: 'POST' }).catch(() => {});

      const response = await fetch('/.netlify/functions/auth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameClean, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error || '아이디 또는 비밀번호가 올바르지 않습니다.');
        setLoading(false);
        return;
      }

      const resolvedEmail = `${usernameClean}@picks.me`;
      if (!ADMIN_USERNAMES.includes(usernameClean) && !ADMIN_EMAILS.includes(resolvedEmail)) {
        setError('관리자 권한이 없는 계정입니다.');
        setLoading(false);
        return;
      }

      onLoginSuccess({
        username: result.username || usernameClean,
        token: result.access_token || '',
      });
    } catch {
      setError('로그인 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-slate-500 font-bold">로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-slate-900">
              {inviteToken ? '비밀번호 설정' : 'Operator Console'}
            </h1>
            <p className="text-slate-400 text-sm font-bold mt-1">
              {inviteToken ? '초대를 수락하고 비밀번호를 설정하세요' : 'PICKS 운영자 전용 로그인'}
            </p>
          </div>

          {inviteToken ? (
            <form onSubmit={handleAcceptInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">새 비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 transition-all"
                  placeholder="6자 이상 입력"
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비밀번호 확인</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 transition-all"
                  placeholder="비밀번호를 다시 입력"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-bold rounded-xl px-4 py-3">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-black text-sm hover:bg-slate-800 transition-all shadow-lg disabled:opacity-60 active:scale-[0.98]"
              >
                {loading ? '설정 중...' : '비밀번호 설정 완료'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">아이디 또는 이메일</label>
                <input
                  type="text"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 transition-all"
                  placeholder="아이디 또는 관리자 이메일"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <div>
                <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-2">비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 transition-all"
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm font-bold rounded-xl px-4 py-3">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-50 border border-green-200 text-green-600 text-sm font-bold rounded-xl px-4 py-3">
                  {success}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-black text-sm hover:bg-slate-800 transition-all shadow-lg disabled:opacity-60 active:scale-[0.98]"
              >
                {loading ? '로그인 중...' : '로그인'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default OperatorLogin;
