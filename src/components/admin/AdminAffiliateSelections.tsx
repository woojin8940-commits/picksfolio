import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  affiliateStoreService,
  won,
  MANAGER_STATUS_LABEL,
  MANAGER_STATUS_STYLE,
  type ManagerSelection,
  type ManagerStatus,
} from '../../services/affiliateStoreService';
import { formatPhone } from '../../utils/formatters';

/**
 * 어필리에이트 선정 연락 — 인플루언서가 판매 신청하고 브랜드가 선정한 건.
 *
 * 브랜드가 선정하면 담당자 연락 없이 바로 인플루언서 전용 판매 링크가 열린다(링크 발급).
 * 이 화면은 선정 · 링크 현황을 보는 곳이다. 문제가 있는 건은 상태를 되돌려 링크를 잠시 닫을 수 있다.
 */

type Filter = 'all' | ManagerStatus;
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const AdminAffiliateSelections: React.FC<{ token: string }> = ({ token }) => {
  const [rows, setRows] = useState<ManagerSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('done');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateStoreService.listSelections(token);
    if (res.error) setError(res.error);
    else {
      setError('');
      setRows(res.selections || []);
      setNotes(Object.fromEntries((res.selections || []).map(r => [r.id, r.managerNote || ''])));
    }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all: rows.length,
    waiting: rows.filter(r => r.managerStatus === 'waiting').length,
    contacting: rows.filter(r => r.managerStatus === 'contacting').length,
    done: rows.filter(r => r.managerStatus === 'done').length,
  }), [rows]);
  const visible = filter === 'all' ? rows : rows.filter(r => r.managerStatus === filter);

  const update = async (r: ManagerSelection, next: ManagerStatus) => {
    if (next === 'done' && !window.confirm('링크를 다시 열까요? 인플루언서의 전용 판매 링크로 다시 주문을 받을 수 있습니다.')) return;
    if (next !== 'done' && !window.confirm('링크를 잠시 닫을까요? 닫는 동안 이 인플루언서 링크로는 주문할 수 없습니다.')) return;
    setBusy(r.id);
    const res = await affiliateStoreService.updateSelection(token, r.id, next, notes[r.id] ?? '');
    setBusy('');
    if (res.error) window.alert(res.error);
    else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-black text-slate-900">어필리에이트 선정 · 링크 현황</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">브랜드가 선정한 판매 신청입니다. 선정과 동시에 인플루언서의 판매 링크가 자동으로 열립니다. 문제가 있으면 상태를 바꿔 링크를 잠시 닫을 수 있습니다.</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-black text-slate-600 hover:bg-slate-200">새로고침</button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {(['done', 'contacting', 'all'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${filter === f ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
          >
            {f === 'all' ? '전체' : MANAGER_STATUS_LABEL[f]} {counts[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center bg-white rounded-2xl border border-slate-100">해당하는 건이 없습니다.</p>
      ) : (
        <div className="grid gap-3">
          {visible.map(r => {
            const status = (r.managerStatus || 'waiting') as ManagerStatus;
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    {r.productImage && <img src={r.productImage} alt="" className="w-12 h-12 rounded-xl object-cover bg-slate-100 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-black text-slate-900 truncate">{r.brandName} · {r.productName}</p>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${MANAGER_STATUS_STYLE[status]}`}>{MANAGER_STATUS_LABEL[status]}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        판매가 {won(r.salePrice)} · 인플루언서 수수료 {r.commissionRate}% · 선정 {dateTime(r.updatedAt)}
                        {r.managerUsername ? ` · 담당 ${r.managerUsername}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {status !== 'done' && (
                      <button disabled={busy === r.id} onClick={() => update(r, 'done')} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black disabled:opacity-50">링크 다시 열기</button>
                    )}
                    {status === 'done' && (
                      <button disabled={busy === r.id} onClick={() => update(r, 'contacting')} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black disabled:opacity-50">링크 잠시 닫기</button>
                    )}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3 mt-4 text-xs">
                  <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] font-black text-slate-400">브랜드 담당자</p>
                    <p className="font-bold text-slate-800">{r.brandContact.name || '-'} <span className="text-slate-400 font-bold">biz/{r.businessUsername}</span></p>
                    {r.brandContact.phone && <p className="text-slate-600">{formatPhone(r.brandContact.phone)}</p>}
                    {r.brandContact.email && <p className="text-slate-600 break-all">{r.brandContact.email}</p>}
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] font-black text-slate-400">인플루언서</p>
                    <p className="font-bold text-slate-800">
                      <a href={`/${r.influencerUsername}`} target="_blank" rel="noreferrer" className="hover:text-blue-600">@{r.influencerUsername}</a>
                      {r.creatorContact.name ? ` · ${r.creatorContact.name}` : ''}
                    </p>
                    {r.creatorContact.phone && <p className="text-slate-600">{formatPhone(r.creatorContact.phone)}</p>}
                    {(r.channelUrl || r.creatorContact.instagramUrl) && (
                      <a href={r.channelUrl || r.creatorContact.instagramUrl} target="_blank" rel="noreferrer" className="block text-blue-600 font-bold truncate">{r.channelUrl || r.creatorContact.instagramUrl}</a>
                    )}
                    {r.message && <p className="text-slate-500 whitespace-pre-wrap line-clamp-3">"{r.message}"</p>}
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    value={notes[r.id] ?? ''}
                    onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="연락 메모 (내부용 · 상태를 바꿀 때 함께 저장)"
                    className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-blue-600"
                  />
                  <button disabled={busy === r.id} onClick={() => update(r, status)} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-50">메모 저장</button>
                </div>
                {status === 'done' && r.linkCode && (
                  <p className="mt-2 text-[11px] text-emerald-600 font-bold">판매 링크: /shop/{r.linkCode}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAffiliateSelections;
