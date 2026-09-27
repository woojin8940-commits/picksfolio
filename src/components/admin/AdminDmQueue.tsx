import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-react';

interface Account {
  ig_account_id: string;
  username: string | null;
  pending: number;
  processing: number;
  oldest_due_at: string | null;
  lease_until: string | null;
  cooldown_until: string | null;
  sent_hour: number;
  failed_hour: number;
  uncertain_hour: number;
  needs_review: number;
}

interface Job {
  id: string;
  status: string;
  outcome: string | null;
  last_error: string | null;
  error_kind: string | null;
  due_at: string;
  completed_at: string | null;
}

const time = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR') : '-';
const iconButton = 'h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40';

export default function AdminDmQueue({ token }: { token: string }) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ accounts: Account[]; hasMore: boolean; generatedAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Account | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobOffset, setJobOffset] = useState(0);
  const [jobError, setJobError] = useState('');
  const [jobsLoading, setJobsLoading] = useState(false);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/dm-queue?offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok) throw new Error('DM 대기열을 불러오지 못했습니다.');
      const result = await response.json();
      if (!controller.signal.aborted) setData(result);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [offset, token]);

  useEffect(() => {
    setData(null);
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    return () => { window.clearInterval(timer); request.current?.abort(); };
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setJobs([]);
    setJobError('');
    setJobsLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/dm-queue?account=${encodeURIComponent(selected.ig_account_id)}&offset=${jobOffset}`, {
          headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin', signal: controller.signal,
        });
        if (!response.ok) throw new Error('발송 내역을 불러오지 못했습니다.');
        const result = await response.json();
        if (!controller.signal.aborted) setJobs(result.jobs);
      } catch (e) {
        if (!controller.signal.aborted) setJobError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setJobsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selected, jobOffset, token]);

  const now = data ? Date.parse(data.generatedAt) : Date.now();
  return (
    <section className="space-y-4 text-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold">DM 발송 현황</h2><p className="text-xs text-slate-500 mt-1">최근 집계 {time(data?.generatedAt || null)}</p></div>
        <button type="button" title="새로고침" aria-label="새로고침" onClick={() => void load()} disabled={loading} className={iconButton}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm text-left border-collapse">
          <thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-600"><tr>{['계정', '상태', '대기', '처리 중', '최장 지연', '최근 1시간 성공', '실패', '결과 미확인', '확인할 작업'].map((label) => <th key={label} className="px-3 py-3 whitespace-nowrap">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.accounts || []).map((account) => {
              const cooling = Date.parse(account.cooldown_until || '') > now;
              const running = Date.parse(account.lease_until || '') > now;
              const delay = account.oldest_due_at ? Math.max(0, Math.floor((now - Date.parse(account.oldest_due_at)) / 1000)) : 0;
              return <tr key={account.ig_account_id}>
                <td className="px-3 py-3"><p className="font-semibold break-all">{account.username ? `@${account.username}` : account.ig_account_id}</p><p className="text-xs text-slate-400">{account.username ? account.ig_account_id : ''}</p></td>
                <td className="px-3 py-3 whitespace-nowrap"><span className={cooling ? 'text-amber-700' : running ? 'text-green-700' : 'text-slate-500'}>{cooling ? '한도 대기' : running ? '실행 중' : '대기'}</span>{cooling && <p className="text-xs text-slate-400">{time(account.cooldown_until)}</p>}</td>
                <td className="px-3 py-3">{account.pending}</td><td className="px-3 py-3">{account.processing}</td><td className="px-3 py-3 whitespace-nowrap">{delay >= 60 ? `${Math.floor(delay / 60)}분 ${delay % 60}초` : `${delay}초`}</td>
                <td className="px-3 py-3 text-green-700">{account.sent_hour}</td><td className="px-3 py-3 text-red-600">{account.failed_hour}</td><td className="px-3 py-3 text-amber-700">{account.uncertain_hour}</td>
                <td className="px-3 py-3"><button type="button" onClick={() => { setSelected(account); setJobOffset(0); }} className="text-blue-600 underline underline-offset-4">내역 {account.needs_review}</button></td>
              </tr>;
            })}
            {!data?.accounts.length && <tr><td colSpan={9} className="py-10 text-center text-slate-500">{loading ? '불러오는 중...' : error ? '집계 불가' : '발송 계정이 없습니다.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3"><button type="button" className={iconButton} title="이전 페이지" aria-label="이전 페이지" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))}><ArrowLeft size={16} /></button><span className="text-sm">{offset / 50 + 1}</span><button type="button" className={iconButton} title="다음 페이지" aria-label="다음 페이지" disabled={!data?.hasMore || loading} onClick={() => setOffset(offset + 50)}><ArrowRight size={16} /></button></div>
      {selected && <section className="border-t border-slate-200 pt-4 space-y-3">
        <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold break-all">{selected.username || selected.ig_account_id} 발송 내역</h3><button type="button" title="내역 닫기" aria-label="내역 닫기" className={iconButton} onClick={() => setSelected(null)}><X size={16} /></button></div>
        {jobError && <p role="alert" className="text-sm text-red-600">{jobError}</p>}
        <div className="divide-y divide-slate-100">{jobs.map((job) => <div key={job.id} className="py-3 text-sm space-y-1"><p className="font-semibold">{job.outcome === 'partial' ? '일부 발송' : job.status === 'uncertain' ? '결과 확인 필요' : '실패'} <span className="font-normal text-xs text-slate-500">{time(job.completed_at || job.due_at)}</span></p><p className="break-words text-slate-600">{job.last_error || job.error_kind || '-'}</p><p className="text-xs text-slate-400 break-all">{job.id}</p></div>)}</div>
        {!jobs.length && !jobError && <p className="text-sm text-slate-500">{jobsLoading ? '불러오는 중...' : '해당 내역이 없습니다.'}</p>}
        <div className="flex items-center justify-end gap-3"><button type="button" className={iconButton} title="이전 내역" aria-label="이전 내역" disabled={jobOffset === 0 || jobsLoading} onClick={() => setJobOffset(Math.max(0, jobOffset - 50))}><ArrowLeft size={16} /></button><span className="text-sm">{jobOffset / 50 + 1}</span><button type="button" className={iconButton} title="다음 내역" aria-label="다음 내역" disabled={jobs.length < 50 || jobsLoading} onClick={() => setJobOffset(jobOffset + 50)}><ArrowRight size={16} /></button></div>
      </section>}
    </section>
  );
}
