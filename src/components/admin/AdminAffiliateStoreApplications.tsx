import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { affiliateStoreService, type ApplicationStatus, type StoreApplication } from '../../services/affiliateStoreService';
import { formatPhone } from '../../utils/formatters';

/**
 * 어필리에이트 입점 신청 — 브랜드가 낸 입점 신청서를 보고 승인 · 반려한다.
 * 승인하면 그 브랜드의 어필리에이트 메뉴(상품 등록)가 열린다.
 */

type Filter = 'all' | ApplicationStatus;

const STATUS_LABEL: Record<ApplicationStatus, string> = { pending: '심사 대기', approved: '승인', rejected: '반려' };
const STATUS_STYLE: Record<ApplicationStatus, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
};

const bizNo = (v: string) => (v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : v);
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const AdminAffiliateStoreApplications: React.FC<{ token: string }> = ({ token }) => {
  const [rows, setRows] = useState<StoreApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('pending');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateStoreService.listApplications(token);
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

  const review = async (r: StoreApplication, decision: 'approve' | 'reject') => {
    let reason = '';
    if (decision === 'reject') {
      const input = window.prompt(`'${r.brandName}' 입점 신청을 반려합니다. 브랜드에게 보일 사유를 적어 주세요.`, '');
      if (input === null) return;
      reason = input;
    } else if (!window.confirm(`'${r.brandName}' 입점을 승인할까요? 승인하면 바로 상품 등록이 열립니다.`)) {
      return;
    }
    setBusy(r.id);
    const res = await affiliateStoreService.reviewApplication(token, r.id, decision, reason);
    setBusy('');
    if (res.error) window.alert(res.error);
    else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-black text-slate-900">어필리에이트 입점 신청</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">승인한 브랜드는 어필리에이트 메뉴에서 상품을 등록할 수 있습니다. (오픈 전 · 테스트 계정 전용)</p>
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
        <p className="text-xs font-bold text-slate-400 py-10 text-center bg-white rounded-2xl border border-slate-100">해당하는 신청이 없습니다.</p>
      ) : (
        <div className="grid gap-3">
          {visible.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-black text-slate-900">{r.brandName}</p>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">계정 biz/{r.businessUsername} · 신청 {dateTime(r.createdAt)}{r.reviewedAt ? ` · 처리 ${dateTime(r.reviewedAt)}` : ''}</p>
                </div>
                <div className="flex gap-1.5">
                  {r.status !== 'approved' && (
                    <button disabled={busy === r.id} onClick={() => review(r, 'approve')} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black disabled:opacity-50">승인</button>
                  )}
                  {r.status !== 'rejected' && (
                    <button disabled={busy === r.id} onClick={() => review(r, 'reject')} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black disabled:opacity-50">반려</button>
                  )}
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3 mt-4 text-xs">
                <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-slate-400">사업자</p>
                  <p className="font-bold text-slate-800">{r.businessName}</p>
                  <p className="text-slate-600">{bizNo(r.businessNumber)}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-slate-400">브랜드</p>
                  <a href={r.channelUrl} target="_blank" rel="noreferrer" className="block font-bold text-blue-600 truncate">{r.channelUrl}</a>
                  <div className="flex flex-wrap gap-1">
                    {r.categories.map(c => <span key={c} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-600">{c}</span>)}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-slate-400">담당자</p>
                  <p className="font-bold text-slate-800">{r.contactName}{r.contactPosition ? ` · ${r.contactPosition}` : ''}</p>
                  <p className="text-slate-600">{formatPhone(r.contactPhone)}</p>
                  <p className="text-slate-600 break-all">{r.contactEmail}</p>
                </div>
              </div>
              {r.status === 'rejected' && r.rejectReason && (
                <p className="mt-3 text-[11px] text-red-500 bg-red-50 rounded-lg px-3 py-2">반려 사유: {r.rejectReason}</p>
              )}
              {r.status === 'approved' && (
                <p className="mt-3 text-[11px] text-slate-500">등록 상품 {r.productCount || 0}개</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminAffiliateStoreApplications;
