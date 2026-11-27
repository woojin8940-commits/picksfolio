import React, { useEffect, useState } from 'react';
import { brandTeamService } from '../services/brandTeamService';
import { rememberBusinessTeam } from '../utils/businessTeam';
import { useLanguage } from '../contexts/LanguageContext';

interface BusinessJoinPageProps {
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  /** 가입과 로그인이 끝나 회사 워크스페이스로 들어갈 때. */
  onJoined: (businessUsername: string, companyName: string) => void;
}

const inviteTokenFromUrl = (): string => {
  try {
    return new URLSearchParams(window.location.search).get('invite') || '';
  } catch {
    return '';
  }
};

/**
 * 회사 관리자가 보낸 좌석 초대 링크(/business/join?invite=…)로 직원 계정을 만드는 화면.
 * 직원은 자기 아이디 · 비밀번호를 만들고, 가입이 끝나면 바로 회사 워크스페이스로 들어간다.
 */
const BusinessJoinPage: React.FC<BusinessJoinPageProps> = ({ onNavigateHome, onNavigateLogin, onJoined }) => {
  const { language } = useLanguage();
  const [token] = useState(inviteTokenFromUrl);
  const [invite, setInvite] = useState<{ companyName: string; label: string; expiresAt: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setInviteError('초대 링크가 올바르지 않아요. 회사 관리자에게 받은 링크를 그대로 열어 주세요.');
        setChecking(false);
        return;
      }
      const res = await brandTeamService.inviteInfo(token);
      if (cancelled) return;
      if (res.success) setInvite(res.invite);
      else setInviteError(res.error);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const username = form.username.trim().toLowerCase();
    if (!form.name.trim()) return setError('이름을 입력해 주세요.');
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return setError('아이디는 영문 소문자 · 숫자 · 밑줄로 3~20자여야 해요.');
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(form.password)) return setError('비밀번호는 영문과 숫자를 섞어 8자 이상으로 만들어 주세요.');
    if (form.password !== form.confirm) return setError('비밀번호가 서로 달라요.');
    setSubmitting(true);
    const res = await brandTeamService.join({ token, username, password: form.password, name: form.name.trim() });
    setSubmitting(false);
    if (!res.success) return setError(res.error);
    try {
      rememberBusinessTeam(res);
      localStorage.setItem('picks_business_session', res.username);
      localStorage.setItem('picks_business_company', res.company_name || '');
      if (res.access_token) localStorage.setItem('picks_business_access_token', res.access_token);
      if (res.refresh_token) localStorage.setItem('picks_business_refresh_token', res.refresh_token);
    } catch {
      // 저장하지 못하면 로그인 화면에서 다시 들어오면 된다.
    }
    if (!res.access_token) return onNavigateLogin();
    onJoined(res.username, res.company_name || '');
  };

  const field = (name: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="space-y-2">
      <label className="block text-sm font-black text-[#39415C] ml-1">{label}</label>
      <div className="bg-[#F7F8FC] border border-[#0B0F1A]/[0.08] rounded-2xl px-4 py-3.5 transition-colors focus-within:border-[#2563EB] focus-within:bg-white">
        <input
          name={name}
          value={form[name]}
          onChange={onChange}
          disabled={submitting}
          className="bg-transparent border-none outline-none text-[#0B0F1A] w-full font-bold text-sm"
          {...props}
        />
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] flex items-start justify-center px-4 sm:px-6 py-10 sm:py-20 paper-page overflow-y-auto">
      <div className="w-full max-w-[440px] bg-white border border-[#0B0F1A]/[0.08] rounded-[1.5rem] sm:rounded-[1.75rem] p-6 sm:p-9 md:p-10 shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] px-3.5 py-1.5 rounded-full text-[11px] font-black mb-4 shadow-sm">
            BUSINESS · TEAM
          </div>
          <h1 className="text-[1.6rem] sm:text-3xl font-black tracking-tighter text-[#0B0F1A] mb-2 font-display">직원 계정 만들기</h1>
          {invite && (
            <p className="text-[#4A5273] text-sm font-medium">
              <strong className="text-[#0B0F1A]">{invite.companyName}</strong> 팀에 직원으로 초대받았어요.
            </p>
          )}
        </div>

        {checking ? (
          <p className="text-center text-sm font-bold text-[#8B93AE]">초대 링크를 확인하는 중...</p>
        ) : inviteError ? (
          <div className="space-y-5">
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-xl px-4 py-3">{inviteError}</div>
            <button type="button" onClick={onNavigateLogin} className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white py-4 rounded-full text-base font-black">
              비즈니스 로그인으로 가기
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {field('name', '이름', { placeholder: '팀에서 보일 이름 (예: 김지은)', maxLength: 40, autoComplete: 'name', required: true })}
            {field('username', '아이디', {
              placeholder: '영문 소문자 · 숫자 · 밑줄 3~20자', autoComplete: 'username', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, required: true,
            })}
            {field('password', '비밀번호', { type: 'password', placeholder: '영문 + 숫자 8자 이상', autoComplete: 'new-password', required: true })}
            {field('confirm', '비밀번호 확인', { type: 'password', placeholder: '비밀번호를 한 번 더 입력해 주세요', autoComplete: 'new-password', required: true })}
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-xl px-4 py-3">{error}</div>}
            <p className="text-[11px] text-[#8B93AE] font-medium leading-relaxed">
              이 아이디와 비밀번호로 비즈니스 로그인을 하면 회사 워크스페이스로 들어갑니다. 결제와 좌석 관리는 회사 관리자 계정이 합니다.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#2563EB] hover:bg-[#1d4ed8] text-white py-4 rounded-full text-base font-black transition-all shadow-[0_12px_28px_-12px_rgba(37,99,235,0.8)] active:scale-[0.97] disabled:opacity-50"
            >
              {submitting ? '가입하는 중...' : '가입하고 시작하기'}
            </button>
          </form>
        )}

        <div className="text-center mt-6">
          <button onClick={onNavigateHome} className="text-[#8B93AE] text-xs font-bold hover:text-[#0B0F1A] transition-colors">
            {language === 'en' ? 'Return to Home' : '홈으로 돌아가기'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BusinessJoinPage;
