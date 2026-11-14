import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { affiliateStoreService, type CreatorApplication } from '../../services/affiliateStoreService';
import { formatNumberWithCommas, formatPhone } from '../../utils/formatters';
import InfluencerCandidateCard from '../collab/InfluencerCandidateCard';

/**
 * 크리에이터 명단 — 새로 들어온 인플루언서가 자동 디엠 · 어필리에이트를 쓰려고 낸 지원서.
 * 승인하면 두 기능이 바로 열린다. 기존 계정은 자동 승인이라 이 목록에 없다.
 *
 * 카드는 어필리에이트 · 캠페인 지원자 카드와 같다 — 인스타 계정 · 팔로워 · 최근 숏폼 3편.
 * 단가는 지원서에 적은 릴스 광고 단가를 보여 준다.
 */

type Status = CreatorApplication['status'];
type Filter = 'all' | Status;

const STATUS_LABEL: Record<Status, string> = { pending: '심사 대기', approved: '승인된 크리에이터', rejected: '반려' };
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
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [filterChosen, setFilterChosen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateStoreService.listCreatorApplications(token);
    if (res.error) setError(res.error);
    else {
      setError('');
      const list = res.applications || [];
      setRows(list);
      // 처음 열 때 심사 대기가 없으면 승인된 명단부터 보여 준다.
      if (!filterChosen && !list.some(r => r.status === 'pending')) setFilter('approved');
    }
    setLoading(false);
  }, [token, filterChosen]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  }), [rows]);
  const needle = q.trim().toLowerCase().replace(/^@/, '');
  const visible = rows
    .filter(r => filter === 'all' || r.status === filter)
    .filter(r => !needle || [r.username, r.name, r.instagramUrl, r.insights?.instagramHandle].some(v => String(v || '').toLowerCase().includes(needle)));

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
          <h3 className="text-sm font-black text-slate-900">크리에이터 명단</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">새로 가입한 인플루언서는 크리에이터 지원 · 승인 후 자동 디엠 · 어필리에이트를 쓸 수 있습니다. 기존 인플루언서는 자동 승인되어 목록에 없습니다.</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-black text-slate-600 hover:bg-slate-200">새로고침</button>
      </div>

      <div className="flex gap-1.5 flex-wrap items-center">
        {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setFilterChosen(true); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${filter === f ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
          >
            {f === 'all' ? '전체' : STATUS_LABEL[f]} {counts[f]}
          </button>
        ))}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="아이디 · 이름 · 인스타 검색"
          className="ml-auto h-8 w-52 px-3 rounded-lg border border-slate-200 text-[11px] focus:outline-none focus:border-blue-600"
        />
      </div>

      {loading ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center bg-white rounded-2xl border border-slate-100">해당하는 크리에이터가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
          {visible.map(r => {
            const insights = r.insights || {};
            return (
              <InfluencerCandidateCard
                key={r.username}
                data={{
                  ...insights,
                  username: r.username,
                  name: insights.name || r.name,
                  instagramUrl: insights.instagramUrl || r.instagramUrl,
                  // 지원서에 적은 숏폼 광고 단가가 원본이다. 예전 지원서처럼 비어 있으면 매칭 등록 단가를 쓴다.
                  postPrice: r.shortPrice ? '' : insights.postPrice,
                  shortPrice: r.shortPrice ? `${formatNumberWithCommas(r.shortPrice)}원` : insights.shortPrice,
                  adPrice: r.shortPrice ? '' : insights.adPrice,
                }}
                mediaMode="reels"
                badges={
                  <>
                    <span className={`px-2 py-1 rounded-md text-[10px] font-black ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    <span className="text-[11px] text-slate-300 font-bold">{dateTime(r.updatedAt || r.createdAt)}</span>
                  </>
                }
                details={
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    <p>지원 {dateTime(r.updatedAt || r.createdAt)}{r.reviewedAt ? ` · 처리 ${dateTime(r.reviewedAt)}${r.reviewedBy ? ` (${r.reviewedBy})` : ''}` : ''}</p>
                    <p>개인정보 동의 {r.privacyConsentedAt ? dateTime(r.privacyConsentedAt) : '-'}</p>
                    <a href={`/${r.username}`} target="_blank" rel="noreferrer" className="text-blue-600 font-bold">픽스폴리오 페이지 열기</a>
                  </div>
                }
              >
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs space-y-0.5">
                  <p className="font-bold text-slate-800">{r.name} <span className="text-slate-400 font-medium">@{r.username}</span></p>
                  <p className="text-slate-600">{formatPhone(r.contact)}</p>
                  <a href={r.instagramUrl} target="_blank" rel="noreferrer" className="block text-blue-600 font-bold truncate">{r.instagramUrl}</a>
                  <p className="text-slate-600"><span className="font-black text-slate-700">릴스 광고 단가</span> {r.shortPrice ? `${formatNumberWithCommas(r.shortPrice)}원` : '미입력'}</p>
                </div>
                {r.status === 'rejected' && r.rejectReason && (
                  <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-3 py-2">반려 사유: {r.rejectReason}</p>
                )}
                <div className="flex items-center gap-2 pt-1">
                  {r.status !== 'approved' && (
                    <button disabled={busy === r.username} onClick={() => review(r, 'approve')} className="h-9 flex-1 px-3 rounded-lg bg-blue-600 text-white text-xs font-black disabled:opacity-50">승인</button>
                  )}
                  {r.status !== 'rejected' && (
                    <button disabled={busy === r.username} onClick={() => review(r, 'reject')} className="h-9 flex-1 px-3 rounded-lg border border-slate-200 text-slate-600 text-xs font-black disabled:opacity-50">{r.status === 'approved' ? '승인 취소(반려)' : '반려'}</button>
                  )}
                </div>
              </InfluencerCandidateCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminCreatorApplications;
