import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { formatPhone } from '../../utils/formatters';

/**
 * 인플루언서 지원자 — 광고로 받은 지원서(/influencer-apply) 목록.
 *
 * 지원서는 계정과 묶이지 않은 연락처 한 줄이다. 운영자가 직접 전화·DM 으로 연락하고,
 * 연락했는지와 통화 메모를 여기 남긴다. 누가 아직 연락을 못 받았는지가 제일 중요해서
 * 기본 필터는 "새 지원"이다.
 */

type Status = 'new' | 'contacted' | 'done';
type Filter = 'all' | Status;

interface Application {
  id: number;
  name: string;
  phone: string;
  instagram: string;
  status: Status;
  memo: string;
  created_at: string;
}

const STATUS_LABEL: Record<Status, string> = {
  new: '새 지원',
  contacted: '연락함',
  done: '완료',
};

const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-blue-50 text-blue-600',
  contacted: 'bg-amber-50 text-amber-600',
  done: 'bg-emerald-50 text-emerald-600',
};

/** "@아이디" 나 "아이디" 로 적어도 눌러서 열 수 있게 프로필 주소로 바꾼다. */
const instagramHref = (raw: string) => {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/instagram\.com/i.test(v)) return `https://${v.replace(/^\/+/, '')}`;
  return `https://instagram.com/${v.replace(/^@/, '')}`;
};

const toCsv = (rows: Application[]) => {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['지원일시', '성함', '연락처', '인스타그램', '상태', '메모'];
  const body = rows.map((r) =>
    [new Date(r.created_at).toLocaleString('ko-KR'), r.name, r.phone, r.instagram, STATUS_LABEL[r.status], r.memo]
      .map(esc)
      .join(','),
  );
  return '﻿' + [head.map(esc).join(','), ...body].join('\n');
};

interface Props {
  token: string;
}

const AdminInfluencerApplications: React.FC<Props> = ({ token }) => {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('new');
  const [query, setQuery] = useState('');
  const [memos, setMemos] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getInfluencerApplications(token);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError('');
    setApps(res.applications || []);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (id: number, patch: { status?: Status; memo?: string }) => {
    setBusyId(id);
    const res = await apiService.updateInfluencerApplication(id, patch, token);
    setBusyId(null);
    if (res.error || !res.application) {
      setError(res.error || '지원서를 저장하지 못했습니다.');
      return;
    }
    setError('');
    setApps((prev) => prev.map((a) => (a.id === id ? res.application : a)));
    if (patch.memo !== undefined) {
      setMemos((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const counts = {
    all: apps.length,
    new: apps.filter((a) => a.status === 'new').length,
    contacted: apps.filter((a) => a.status === 'contacted').length,
    done: apps.filter((a) => a.status === 'done').length,
  };

  const q = query.trim().toLowerCase();
  const visible = apps.filter(
    (a) =>
      (filter === 'all' || a.status === filter) &&
      (!q || [a.name, a.phone, a.instagram, a.memo].some((v) => String(v || '').toLowerCase().includes(q))),
  );

  const downloadCsv = () => {
    const blob = new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `influencer-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-slate-900">인플루언서 지원자</h3>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
              새 지원 {counts.new}명
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/influencer-apply"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg text-[11px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200"
            >
              지원 페이지 열기
            </a>
            <button
              onClick={downloadCsv}
              disabled={visible.length === 0}
              className="px-3 py-1.5 rounded-lg text-[11px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 disabled:opacity-40"
            >
              CSV 다운로드
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-black text-white bg-slate-900 hover:bg-slate-700 disabled:opacity-40"
            >
              새로고침
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {(['new', 'contacted', 'done', 'all'] as Filter[]).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${
                filter === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {key === 'all' ? '전체' : STATUS_LABEL[key]} {counts[key]}
            </button>
          ))}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 · 연락처 · 인스타 · 메모 검색"
            className="ml-auto w-full sm:w-64 text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>

        {error && (
          <p className="mt-3 text-[11px] font-bold text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-[11px] text-slate-400 font-bold text-center py-10">지원자 목록을 불러오는 중...</p>
        ) : visible.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500 font-black">
              {apps.length === 0 ? '아직 지원자가 없습니다.' : '조건에 맞는 지원자가 없습니다.'}
            </p>
            {apps.length === 0 && (
              <p className="mt-1 text-[11px] font-medium text-slate-400">
                지원 페이지(/influencer-apply)로 들어온 지원서가 여기에 쌓입니다.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visible.map((a) => {
              const memoDraft = memos[a.id];
              const memoDirty = memoDraft !== undefined && memoDraft !== a.memo;
              return (
                <div key={a.id} className="px-4 py-3 flex flex-col md:flex-row md:items-start gap-3">
                  <div className="min-w-0 md:w-72 flex-shrink-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[13px] font-black text-slate-900">{a.name}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${STATUS_STYLE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </div>
                    <a
                      href={`tel:${a.phone.replace(/[^0-9+]/g, '')}`}
                      className="block text-[12px] font-bold text-slate-700 hover:text-blue-600 mt-0.5"
                    >
                      {formatPhone(a.phone) || a.phone}
                    </a>
                    <a
                      href={instagramHref(a.instagram)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[11px] font-bold text-blue-600 hover:underline truncate"
                    >
                      {a.instagram}
                    </a>
                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {new Date(a.created_at).toLocaleString('ko-KR')}
                    </p>
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <textarea
                      value={memoDraft ?? a.memo}
                      onChange={(e) => setMemos((prev) => ({ ...prev, [a.id]: e.target.value }))}
                      placeholder="통화 메모 (예: 9/30 통화, 뷰티 카테고리, 다음 주 미팅)"
                      rows={2}
                      className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400 resize-y"
                    />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['new', 'contacted', 'done'] as Status[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => save(a.id, { status: s })}
                          disabled={busyId === a.id || a.status === s}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black disabled:cursor-default ${
                            a.status === s ? STATUS_STYLE[s] : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          } ${busyId === a.id ? 'opacity-40' : ''}`}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                      {memoDirty && (
                        <button
                          onClick={() => save(a.id, { memo: memoDraft })}
                          disabled={busyId === a.id}
                          className="ml-auto px-3 py-1 rounded-lg text-[10px] font-black text-white bg-slate-900 hover:bg-slate-700 disabled:opacity-40"
                        >
                          메모 저장
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminInfluencerApplications;
