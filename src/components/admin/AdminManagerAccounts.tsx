import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';

/**
 * 담당자 계정 — 운영자가 일반 계정에 담당자 권한을 준다.
 *
 * 담당자는 관리자가 아니다. 여기서 올려 준 계정은 자기 계정으로 로그인한 뒤
 * 담당자 대시보드를 받는다. 운영 콘솔에는 들어올 수 없다.
 *
 * 해제는 행을 지우지 않고 내리기만 한다. 누가 언제 누구를 올렸고 내렸는지는
 * 남아야 하는 기록이다. 그리고 해제 전에 그 사람이 맡고 있는 캠페인·협업 수를
 * 함께 보여 준다 — 열 개를 든 사람을 아무 표시 없이 내리면 그 열 개가 멈춘다.
 */

interface AdminManagerAccountsProps {
  token: string;
}

const AdminManagerAccounts: React.FC<AdminManagerAccountsProps> = ({ token }) => {
  const [managers, setManagers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', email: '', note: '' });

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getManagers(token);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError('');
    setManagers(res.managers || []);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async () => {
    const username = form.username.trim().toLowerCase();
    if (!username) return;
    setBusy(true);
    const res = await apiService.assignManager({ ...form, username }, token);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError('');
    setManagers(res.managers || []);
    setForm({ username: '', displayName: '', email: '', note: '' });
    // 이미 로그인해 있는 세션은 배정 사실을 모른다. 담당자 여부는 로그인 시점(또는
    // 새로고침)에 한 번 확인하므로, 운영자가 "배정했는데 안 바뀐다"로 헤매지 않게
    // 여기서 미리 알려 준다.
    notify(`@${username} 계정에 담당자 권한을 주었습니다. 이미 로그인 중이라면 새로고침 후 적용됩니다.`);
  };

  const setActive = async (username: string, active: boolean, campaignCount: number) => {
    if (!active && campaignCount > 0) {
      const ok = window.confirm(
        `@${username} 님이 캠페인 ${campaignCount}건을 맡고 있습니다. 해제하면 그 캠페인은 담당자 없는 상태가 됩니다. 계속할까요?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    const res = await apiService.setManagerActive(username, active, token);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError('');
    setManagers(res.managers || []);
    notify(active ? `@${username} 권한을 다시 주었습니다.` : `@${username} 권한을 해제했습니다.`);
  };

  const activeCount = managers.filter((m) => m.active).length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-black text-slate-900">담당자 계정</h3>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
            활성 {activeCount}명
          </span>
        </div>
        <p className="text-[11px] text-slate-400 font-medium mt-0.5">
          일반 계정 아이디를 넣으면 그 계정으로 로그인했을 때 담당자 대시보드가 열립니다.
          운영 콘솔 권한은 주지 않습니다.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-4">
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="계정 아이디 (필수)"
            className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
          />
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="표시 이름"
            className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
          />
          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="이메일"
            className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
          />
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="메모 (담당 범위 등)"
            className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={assign}
            disabled={busy || !form.username.trim()}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 disabled:opacity-40"
          >
            담당자로 배정
          </button>
          <p className="text-[10px] text-slate-400 font-bold">
            아이디는 소문자로 저장됩니다. 이미 담당자인 계정을 다시 넣으면 정보만 갱신됩니다.
          </p>
        </div>

        {error && (
          <p className="mt-2 text-[11px] font-bold text-red-500 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-[11px] text-slate-400 font-bold text-center py-10">
            담당자 목록을 불러오는 중...
          </p>
        ) : managers.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500 font-black">배정된 담당자가 없습니다.</p>
            <p className="mt-1 text-[11px] font-medium text-slate-400">
              위에서 계정 아이디를 넣어 첫 담당자를 배정해 주세요.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {managers.map((m) => (
              <div key={m.username} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[12px] font-black text-slate-900">
                      {m.displayName || `@${m.username}`}
                    </p>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                        m.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {m.active ? '활성' : '해제됨'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-bold truncate">
                    @{m.username}
                    {m.email ? ` · ${m.email}` : ''}
                  </p>
                  <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                    캠페인 {m.campaignCount}건 · 진행 협업 {m.collabCount}건
                    {m.assignedAt
                      ? ` · 배정 ${new Date(m.assignedAt).toLocaleDateString('ko-KR')}`
                      : ''}
                    {m.assignedBy ? ` (${m.assignedBy})` : ''}
                    {!m.active && m.revokedAt
                      ? ` · 해제 ${new Date(m.revokedAt).toLocaleDateString('ko-KR')}`
                      : ''}
                  </p>
                  {m.note && (
                    <p className="text-[11px] text-slate-500 font-medium mt-1 whitespace-pre-wrap">
                      {m.note}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setActive(m.username, !m.active, m.campaignCount)}
                  disabled={busy}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-40 flex-shrink-0 ${
                    m.active
                      ? 'bg-red-50 text-red-500 hover:bg-red-100'
                      : 'bg-slate-900 text-white hover:bg-slate-700'
                  }`}
                >
                  {m.active ? '권한 해제' : '다시 배정'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-2xl shadow-xl text-xs font-black bg-slate-900 text-white">
          {toast}
        </div>
      )}
    </div>
  );
};

export default AdminManagerAccounts;
