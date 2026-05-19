
import React, { useState, useEffect } from 'react';
import { getSiteSettings, updateSiteSettings } from '../services/settingsService';
import Toast from './Toast';

interface ProfileSettingsProps {
  userName: string;
}

const ProfileSettings: React.FC<ProfileSettingsProps> = ({ userName }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      const settings = await getSiteSettings(userName);
      if (settings) {
        setTitle(settings.profile?.title || settings.design?.title || `${userName}의 페이지`);
        setDescription(settings.profile?.description || settings.design?.description || '패션과 뷰티를 사랑하는 크리에이터입니다.');
      }
      setIsLoading(false);
    };
    loadSettings();
  }, [userName]);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage('');
    try {
      // Optimistic feedback
      setMessage('저장이 완료되었습니다!');
      setShowToast(true);
      setIsSaving(false); // Release button immediately for instant feel

      // We update both profile and design for compatibility
      await updateSiteSettings(userName, {
        design: {
          title,
          description
        } as any,
        profile: {
          title,
          description
        }
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage('저장 중 오류가 발생했습니다.');
      setShowToast(true);
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-14 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-purple-600/20 border-t-purple-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-14 max-w-2xl animate-in fade-in duration-500">
      <h2 className="text-2xl md:text-3xl font-black text-slate-900 mb-8 md:mb-12">프로필 설정</h2>
      
      <div className="space-y-8 bg-white p-6 md:p-10 rounded-[2rem] border border-slate-100 shadow-sm">
        <div>
          <label className="block text-sm font-black text-slate-400 uppercase tracking-widest mb-3">페이지 제목</label>
          <input 
            type="text" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-slate-50 border border-slate-100 p-4 rounded-2xl font-bold text-lg text-slate-900 focus:outline-none focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500 transition-all"
            placeholder="페이지 제목을 입력하세요"
          />
        </div>

        <div>
          <label className="block text-sm font-black text-slate-400 uppercase tracking-widest mb-3">소개 문구</label>
          <textarea 
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-50 border border-slate-100 p-4 rounded-2xl font-bold text-lg text-slate-900 focus:outline-none focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500 transition-all min-h-[120px]"
            placeholder="나를 소개하는 한 줄을 입력하세요"
          />
        </div>

        <div className="pt-4">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-purple-500/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                저장 중...
              </>
            ) : (
              '[저장하기]'
            )}
          </button>
          {message && (
            <p className={`text-center mt-4 font-bold text-sm ${message.includes('오류') ? 'text-red-500' : 'text-emerald-500'}`}>
              {message}
            </p>
          )}
        </div>
      </div>
      <Toast 
        message={message} 
        isVisible={showToast} 
        onClose={() => setShowToast(false)} 
      />
    </div>
  );
};

export default ProfileSettings;
