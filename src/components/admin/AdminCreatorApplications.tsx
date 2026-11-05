import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { affiliateStoreService, type CreatorApplication } from '../../services/affiliateStoreService';
import { formatPhone } from '../../utils/formatters';

/**
 * 크리에이터 지원 — 새로 들어온 인플루언서가 자동 디엠 · 어필리에이트를 쓰려고 낸 지원서.
 * 승인하면 두 기능이 바로 열린다. 기존 계정은 자동 승인이라 이 목록에 없다.
 */

type Status = CreatorApplication['status'];
type Filter = 'all' | Status;

const STATUS_LABEL: Record<Status, string> = { pending: '심사 대기', approved: '승인', rejected: '반려' };
const STATUS_STYLE: Record<Status, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
};
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const AdminCreatorApplications: React.FC<{ token: string }> = ({ token }) => {
  const [rows, setRows] = useState<CreatorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('pending');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateStoreService.listCreatorApplications(token);
    if (res.error) setError(res.error);
    else { setError(''); setRows(res.applications || []); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  }), [rows]);
  const visible = filter === 'all' ? rows : rows.filter(r => r.status === filter);

  const review = async (r: CreatorApplication, decision: 'approve' | 'reject') => {
    let reason = '';
    if (decision === 'reject') {
      const input = window.prompt(`@${r.username} 크리에이터 지원을 반려합니다. 인플루언서에게 보일 사유를 적어 주세요.`, '');
      if (input === null) return;
      reason = input;
    } else if (!window.confirm(`@${r.username} 님을 크리에이터로 승인할까요? 승인하면 자동 디엠과 어필리에이트가 바로 열립니다.`)) {
      return;
    }
    setBusy(r.username);
    const res = await affiliateStoreService.reviewCreator(token, r.username, decision, reason);
    setBusy('');
    if (res.error) window.alert(res.error);
    else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-black text-slate-900">크리에이터 지원</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">새로 가입한 인플루언서는 승인 후 자동 디엠 · 어필리에이트를 쓸 수 있습니다. 기존 인플루언서는 자동 승인되어 목록에 없습니다.</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-black text-slate-600 hover:bg-slate-200">새로고침</button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${filter === f ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
          >
            {f === 'all' ? '전체' : STATUS_LABEL[f]} {counts[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center bg-white rounded-2xl border border-slate-100">해당하는 지원서가 없습니다.</p>
      ) : (
        <div className="grid gap-3">
          {visible.map(r => (
            <div key={r.username} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <a href={`/${r.username}`} target="_blank" rel="noreferrer" className="text-base font-black text-slate-900 hover:text-blue-600">@{r.username}</a>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">지원 {dateTime(r.updatedAt || r.createdAt)}{r.reviewedAt ? ` · 처리 ${dateTime(r.reviewedAt)}${r.reviewedBy ? ` (${r.reviewedBy})` : ''}` : ''}</p>
                </div>
                <div className="flex gap-1.5">
                  {r.status !== 'approved' && (
                    <button disabled={busy === r.username} onClick={() => review(r, 'approve')} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black disabled:opacity-50">승인</button>
                  )}
                  {r.status !== 'rejected' && (
                    <button disabled={busy === r.username} onClick={() => review(r, 'reject')} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black disabled:opacity-50">반려</button>
                  )}
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-4 text-xs">
                <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-slate-400">지원자</p>
                  <p className="font-bold text-slate-800">{r.name}</p>
                  <p className="text-slate-600">{formatPhone(r.contact)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-slate-400">채널</p>
                  <a href={r.instagramUrl} target="_blank" rel="noreferrer" className="block font-bold text-blue-600 truncate">{r.instagramUrl}</a>
                  <p className="text-slate-500">개인정보 동의 {r.privacyConsentedAt ? dateTime(r.privacyConsentedAt) : '-'}</p>
                </div>
              </div>
              {r.status === 'rejected' && r.rejectReason && (
                <p className="mt-3 text-[11px] text-red-500 bg-red-50 rounded-lg px-3 py-2">반려 사유: {r.rejectReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminCreatorApplications;
