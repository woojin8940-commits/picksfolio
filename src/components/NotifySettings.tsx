
import React, { useState, useEffect } from 'react';
import { Bell, Users, Save, CheckCircle2, Target, UserCheck } from 'lucide-react';

interface NotifySettingsProps {
  userName: string;
}

type Gender = 'all' | 'female' | 'male';

interface TargetSettings {
  genders: Gender[];
  ageRanges: string[]; // '10', '20', '30', '40', '50+', 'all'
}

interface UsageStats {
  monthlySent: number;
  monthlyQuota: number;
  resetAt: string;
  totalSent: number;
  costPerMessage: number;
}

const AGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '전 연령' },
  { value: '10', label: '10대' },
  { value: '20', label: '20대' },
  { value: '30', label: '30대' },
  { value: '40', label: '40대' },
  { value: '50+', label: '50대 이상' },
];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'female', label: '여성' },
  { value: 'male', label: '남성' },
];

const DEFAULT_SETTINGS: TargetSettings = {
  genders: ['all'],
  ageRanges: ['all'],
};

const DEFAULT_USAGE: UsageStats = {
  monthlySent: 0,
  monthlyQuota: 100,
  resetAt: '',
  totalSent: 0,
  costPerMessage: 15, // 원 단위 — 건당 15원 기준 (예시)
};

const NotifySettings: React.FC<NotifySettingsProps> = ({ userName }) => {
  const [settings, setSettings] = useState<TargetSettings>(DEFAULT_SETTINGS);
  const [usage, setUsage] = useState<UsageStats>(DEFAULT_USAGE);
  const [subscriberCount, setSubscriberCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/alimtalk-settings?user=${encodeURIComponent(userName.toLowerCase())}`);
        if (res.ok) {
          const data = await res.json();
          if (cancelled) return;
          if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
          if (data.usage) setUsage({ ...DEFAULT_USAGE, ...data.usage });
          if (typeof data.subscriberCount === 'number') setSubscriberCount(data.subscriberCount);
        }
      } catch (e) {
        console.warn('[NotifySettings] load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (userName) load();
    return () => { cancelled = true; };
  }, [userName]);

  const toggleGender = (value: Gender) => {
    setSettings(prev => {
      if (value === 'all') return { ...prev, genders: ['all'] };
      const without = prev.genders.filter(g => g !== 'all' && g !== value);
      const next = prev.genders.includes(value) ? without : [...without, value];
      return { ...prev, genders: next.length === 0 ? ['all'] : next };
    });
  };

  const toggleAge = (value: string) => {
    setSettings(prev => {
      if (value === 'all') return { ...prev, ageRanges: ['all'] };
      const without = prev.ageRanges.filter(a => a !== 'all' && a !== value);
      const next = prev.ageRanges.includes(value) ? without : [...without, value];
      return { ...prev, ageRanges: next.length === 0 ? ['all'] : next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/alimtalk-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: userName.toLowerCase(),
          settings,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (e) {
      console.warn('[NotifySettings] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const remaining = Math.max(usage.monthlyQuota - usage.monthlySent, 0);
  const usagePct = usage.monthlyQuota > 0 ? Math.min(100, Math.round((usage.monthlySent / usage.monthlyQuota) * 100)) : 0;
  const monthlyCost = usage.monthlySent * usage.costPerMessage;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500 space-y-6 md:space-y-8">
      {/* Subscriber Count */}
      <section className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm p-6 md:p-10">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
            <UserCheck className="w-4 h-4 md:w-5 md:h-5 text-emerald-500" /> 알림 받기 신청자
          </h4>
          <span className="text-[10px] md:text-xs font-bold text-slate-400">
            라이브 시작 알림톡 발송 대상
          </span>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl md:rounded-2xl p-5 md:p-6 flex items-center justify-between">
          <div>
            <p className="text-[10px] md:text-xs font-black text-emerald-700 uppercase tracking-widest mb-1">현재 알림받기 신청</p>
            <p className="text-2xl md:text-4xl font-black text-slate-900">
              {subscriberCount.toLocaleString()}
              <span className="text-sm md:text-base text-slate-500 ml-1 font-bold">명</span>
            </p>
          </div>
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-white shadow-md flex items-center justify-center">
            <Bell className="w-5 h-5 md:w-7 md:h-7 text-emerald-500" />
          </div>
        </div>
      </section>

      {/* Usage Stats */}
      <section className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm p-6 md:p-10">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
            <Bell className="w-4 h-4 md:w-5 md:h-5 text-blue-500" /> 알림톡 사용량
          </h4>
          <span className="text-[10px] md:text-xs font-bold text-slate-400">
            {usage.resetAt ? `${new Date(usage.resetAt).toLocaleDateString('ko-KR')} 갱신` : '이번 달'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5 mb-5">
          <div className="bg-slate-50 rounded-xl md:rounded-2xl p-4 md:p-5">
            <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">이번 달 발송</p>
            <p className="text-xl md:text-3xl font-black text-slate-900">{usage.monthlySent.toLocaleString()}<span className="text-xs md:text-sm text-slate-400 ml-1">건</span></p>
          </div>
          <div className="bg-slate-50 rounded-xl md:rounded-2xl p-4 md:p-5">
            <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">잔여 건수</p>
            <p className="text-xl md:text-3xl font-black text-blue-600">{remaining.toLocaleString()}<span className="text-xs md:text-sm text-slate-400 ml-1">건</span></p>
          </div>
          <div className="bg-slate-50 rounded-xl md:rounded-2xl p-4 md:p-5">
            <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">예상 비용</p>
            <p className="text-xl md:text-3xl font-black text-slate-900">₩{monthlyCost.toLocaleString()}</p>
            <p className="text-[9px] md:text-[10px] font-bold text-slate-400 mt-0.5">건당 ₩{usage.costPerMessage}</p>
          </div>
          <div className="bg-slate-50 rounded-xl md:rounded-2xl p-4 md:p-5">
            <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">누적 발송</p>
            <p className="text-xl md:text-3xl font-black text-slate-900">{usage.totalSent.toLocaleString()}<span className="text-xs md:text-sm text-slate-400 ml-1">건</span></p>
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1.5 text-[10px] md:text-xs font-black text-slate-500">
            <span>월 한도 {usage.monthlyQuota.toLocaleString()}건</span>
            <span>{usagePct}%</span>
          </div>
          <div className="h-2 md:h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${usagePct >= 90 ? 'bg-red-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${usagePct}%` }} />
          </div>
          <p className="text-[10px] md:text-xs font-medium text-slate-400 mt-2 leading-relaxed">
            발송 건수에 따라 서비스 이용 요금이 책정됩니다. 한도를 초과하면 추가 발송이 제한될 수 있습니다.
          </p>
        </div>
      </section>

      {/* Targeting Settings */}
      <section className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm p-6 md:p-10">
        <div className="flex items-center justify-between mb-4 md:mb-8">
          <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
            <Target className="w-4 h-4 md:w-5 md:h-5 text-indigo-500" /> 발송 대상 설정
          </h4>
        </div>

        <div className="space-y-6 md:space-y-8">
          <div>
            <label className="flex items-center gap-2 text-[11px] md:text-sm font-black text-slate-700 mb-3">
              <Users size={14} /> 성별
            </label>
            <div className="flex flex-wrap gap-2">
              {GENDER_OPTIONS.map(opt => {
                const active = settings.genders.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleGender(opt.value)}
                    className={`px-4 md:px-5 py-2 md:py-2.5 rounded-xl border font-black text-xs md:text-sm transition-all ${
                      active
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-[11px] md:text-sm font-black text-slate-700 mb-3">
              <Users size={14} /> 연령대
            </label>
            <div className="flex flex-wrap gap-2">
              {AGE_OPTIONS.map(opt => {
                const active = settings.ageRanges.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleAge(opt.value)}
                    className={`px-4 md:px-5 py-2 md:py-2.5 rounded-xl border font-black text-xs md:text-sm transition-all ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-500/20'
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] md:text-xs font-medium text-slate-400 mt-2">
              회원가입 시 수집한 생년월일/성별 정보를 기반으로 대상이 자동 선정됩니다.
            </p>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-[11px] md:text-xs font-medium text-slate-500 leading-relaxed">
            발송 메시지는 사전 승인된 <span className="font-black text-slate-700">Solapi 라이브 시작 알림 템플릿</span>으로 자동 전송되며 별도로 편집할 수 없습니다.
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <p className="text-[11px] md:text-sm font-bold text-slate-400">
              설정은 다음 알림톡 발송부터 적용됩니다.
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 md:px-6 py-2.5 md:py-3 rounded-xl font-black text-xs md:text-sm hover:bg-blue-500 transition-all disabled:opacity-50"
            >
              {saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
              {saved ? '저장됨' : saving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default NotifySettings;
