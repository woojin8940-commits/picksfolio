
import React, { useState } from 'react';
import { supabase } from '../services/supabase';

interface LoginPageProps {
  onNavigateHome: () => void;
  onNavigateSignup: () => void;
  onLoginSuccess: (id: string) => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onNavigateHome, onNavigateSignup, onLoginSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    id: '',
    password: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Virtual email for Supabase authentication
      const virtualEmail = `${formData.id.trim()}@picks.me`;

      if (!supabase) {
        // Demo mode
        if (formData.id && formData.password) {
          onLoginSuccess(formData.id.trim());
          return;
        }
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: virtualEmail,
        password: formData.password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          alert('아이디 또는 비밀번호를 확인해주세요.');
        } else {
          alert('로그인 실패: ' + error.message);
        }
        return;
      }

      if (data.user) {
        console.log('Login successful, fetching profile...');
        // Fetch profile to get the username
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', data.user.id)
          .maybeSingle();

        if (profileError) {
          console.error('Error fetching profile:', profileError);
        }

        const userId = profileData?.username || formData.id.trim();
        console.log('User ID determined:', userId);
        onLoginSuccess(userId);
      }
    } catch (error: any) {
      console.error('Login catch error:', error);
      alert('서버 오류가 발생했습니다: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-20 bg-midnight">
      <div className="w-full max-w-[440px] bg-white rounded-[40px] p-10 md:p-12 shadow-[0_30px_100px_rgba(0,0,0,0.7)] animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-slate-900 mb-2">로그인</h1>
          <p className="text-slate-500 text-sm font-medium">픽스폴리오에 다시 오신 것을 환영합니다.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">아이디</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-purple-500 transition-colors">
              <input 
                type="text" 
                name="id"
                placeholder="아이디를 입력해 주세요" 
                required 
                value={formData.id}
                onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-black text-slate-800 ml-1">비밀번호</label>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 focus-within:border-purple-500 transition-colors">
              <input 
                type="password" 
                name="password"
                placeholder="비밀번호를 입력해 주세요" 
                required 
                value={formData.password}
                onChange={handleChange}
                className="bg-transparent border-none outline-none text-slate-900 w-full font-medium"
                disabled={isLoading}
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-5 rounded-2xl text-lg font-black transition-all hover:shadow-[0_10px_30px_rgba(124,58,237,0.3)] active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                로그인 중...
              </>
            ) : (
              '로그인'
            )}
          </button>
        </form>

        <div className="text-center mt-8 text-slate-400 text-sm font-bold">
          계정이 없으신가요? <button onClick={onNavigateSignup} className="text-slate-800 hover:underline" disabled={isLoading}>회원가입하기</button>
        </div>
        
        <div className="text-center mt-4">
          <button onClick={onNavigateHome} className="text-slate-400 text-xs hover:text-slate-600 transition-colors">홈으로 돌아가기</button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
