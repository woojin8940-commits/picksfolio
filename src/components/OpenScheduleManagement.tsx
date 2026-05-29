import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Loader2, CheckCircle2 } from 'lucide-react';
import { OpenScheduleItem } from '../types';
import { apiService } from '../services/apiService';

interface OpenScheduleManagementProps {
  userName: string;
}

const OpenScheduleManagement: React.FC<OpenScheduleManagementProps> = ({ userName }) => {
  const [schedules, setSchedules] = useState<OpenScheduleItem[]>(() => {
    try {
      const saved = localStorage.getItem(`picks_schedule_${(userName || '').toLowerCase()}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', date: '', time: '', description: '', link: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const loadFromCloud = async () => {
      try {
        const apiData = await apiService.getSiteData(userName);
        if (apiData?.openSchedule) {
          setSchedules(apiData.openSchedule);
          localStorage.setItem(`picks_schedule_${userName.toLowerCase()}`, JSON.stringify(apiData.openSchedule));
        }
      } catch (e) {
        console.warn('[OpenSchedule] 클라우드 로드 실패:', e);
      }
    };
    loadFromCloud();
  }, [userName]);

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const saveToCloud = async (items: OpenScheduleItem[]) => {
    localStorage.setItem(`picks_schedule_${userName.toLowerCase()}`, JSON.stringify(items));
    try {
      await apiService.saveSiteData(userName, { openSchedule: items });
    } catch (e) {
      console.warn('[OpenSchedule] 클라우드 동기화 실패:', e);
    }
  };

  const showSuccessFeedback = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleAdd = () => {
    setEditingId(null);
    setForm({ title: '', date: '', time: '', description: '', link: '' });
    setShowForm(true);
  };

  const handleEdit = (item: OpenScheduleItem) => {
    setEditingId(item.id);
    setForm({ title: item.title, date: item.date, time: item.time || '', description: item.description || '', link: item.link || '' });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.date) return;
    setIsSaving(true);

    let updated: OpenScheduleItem[];
    if (editingId) {
      updated = schedules.map(s => s.id === editingId ? { ...s, ...form, title: form.title.trim(), description: form.description.trim(), link: form.link.trim() } : s);
    } else {
      const newItem: OpenScheduleItem = {
        id: generateId(),
        title: form.title.trim(),
        date: form.date,
        time: form.time,
        description: form.description.trim(),
        link: form.link.trim(),
        isActive: true,
        created_at: new Date().toISOString()
      };
      updated = [newItem, ...schedules];
    }

    setSchedules(updated);
    await saveToCloud(updated);
    setShowForm(false);
    showSuccessFeedback();
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    const updated = schedules.filter(s => s.id !== id);
    setSchedules(updated);
    await saveToCloud(updated);
    showSuccessFeedback();
  };

  const handleToggleActive = async (id: string) => {
    const updated = schedules.map(s => s.id === id ? { ...s, isActive: !s.isActive } : s);
    setSchedules(updated);
    await saveToCloud(updated);
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    } catch {
      return dateStr;
    }
  };

  const isUpcoming = (dateStr: string) => {
    return new Date(dateStr) >= new Date(new Date().toDateString());
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-14">
      <div className="max-w-[1200px] mx-auto w-full">
        <header className="mb-6 md:mb-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl md:text-4xl font-black text-[#1E1E2E] mb-1 md:mb-2">오픈 일정 관리</h1>
              <p className="text-[#64748B] font-medium text-xs md:text-base">
                오픈 일정을 등록하면 개인 페이지에서 팔로워들에게 자동으로 노출됩니다.
              </p>
            </div>
            <button
              onClick={handleAdd}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 transition-all shadow-lg self-start md:self-auto"
            >
              <Plus size={16} />
              새 일정 추가
            </button>
          </div>
        </header>

        {isSaved && (
          <div className="fixed top-6 right-6 bg-green-500 text-white px-6 py-3 rounded-2xl font-black text-sm flex items-center gap-2 shadow-2xl z-[300] animate-in fade-in slide-in-from-top-4 duration-300">
            <CheckCircle2 size={16} /> 저장 완료!
          </div>
        )}

        {/* Schedule List */}
        <div className="space-y-4">
          {schedules.length === 0 ? (
            <div className="bg-white rounded-3xl border border-[#E2E8F0] p-12 text-center">
              <div className="text-4xl mb-4">📅</div>
              <h3 className="text-lg font-black text-[#1E1E2E] mb-2">등록된 오픈 일정이 없습니다</h3>
              <p className="text-sm text-[#64748B] font-medium mb-6">새 일정을 추가하여 팔로워들에게 오픈 소식을 알려보세요.</p>
              <button onClick={handleAdd} className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-black text-sm hover:bg-blue-700 transition-all">
                <Plus size={14} className="inline mr-1" /> 첫 일정 등록하기
              </button>
            </div>
          ) : (
            schedules.map(item => (
              <div key={item.id} className={`bg-white rounded-2xl border ${item.isActive && isUpcoming(item.date) ? 'border-blue-200 bg-blue-50/30' : 'border-[#E2E8F0]'} p-5 md:p-6 shadow-sm transition-all`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {item.isActive && isUpcoming(item.date) ? (
                        <span className="bg-blue-600 text-white text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider">예정</span>
                      ) : !isUpcoming(item.date) ? (
                        <span className="bg-slate-200 text-slate-500 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider">종료</span>
                      ) : (
                        <span className="bg-slate-100 text-slate-400 text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider">비활성</span>
                      )}
                      <span className="text-xs font-black text-[#64748B]">{formatDate(item.date)}</span>
                      {item.time && <span className="text-xs font-bold text-[#94A3B8]">{item.time}</span>}
                    </div>
                    <h3 className="text-base md:text-lg font-black text-[#1E1E2E] mb-1">{item.title}</h3>
                    {item.description && <p className="text-sm text-[#64748B] font-medium mb-2">{item.description}</p>}
                    {item.link && (
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 font-bold hover:underline break-all">
                        {item.link}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleToggleActive(item.id)}
                      className={`relative w-11 h-6 rounded-full transition-all ${item.isActive ? 'bg-blue-600' : 'bg-slate-200'}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all ${item.isActive ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                    <button onClick={() => handleEdit(item)} className="p-2 rounded-xl hover:bg-slate-100 text-[#94A3B8] hover:text-blue-600 transition-all">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="p-2 rounded-xl hover:bg-red-50 text-[#94A3B8] hover:text-red-500 transition-all">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
            <div className="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-black text-[#1E1E2E] mb-6">{editingId ? '일정 수정' : '새 오픈 일정'}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">일정 제목 *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="예: 봄 신상 오픈, 한정판 발매"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black focus:border-blue-600 transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">날짜 *</label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={e => setForm({ ...form, date: e.target.value })}
                      className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black focus:border-blue-600 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">시간 (선택)</label>
                    <input
                      type="time"
                      value={form.time}
                      onChange={e => setForm({ ...form, time: e.target.value })}
                      className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-black focus:border-blue-600 transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">설명 (선택)</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="일정에 대한 간단한 설명"
                    rows={3}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-bold focus:border-blue-600 transition-all resize-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">관련 링크 (선택)</label>
                  <input
                    type="url"
                    value={form.link}
                    onChange={e => setForm({ ...form, link: e.target.value })}
                    placeholder="https://..."
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl px-6 py-4 font-bold focus:border-blue-600 transition-all"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button onClick={() => setShowForm(false)} className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-600 font-black text-sm hover:bg-slate-200 transition-all">
                  취소
                </button>
                <button
                  onClick={handleSave}
                  disabled={!form.title.trim() || !form.date || isSaving}
                  className="flex-1 py-4 rounded-2xl bg-blue-600 text-white font-black text-sm hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                  {editingId ? '수정' : '등록'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpenScheduleManagement;
