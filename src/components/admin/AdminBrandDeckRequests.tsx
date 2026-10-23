import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { formatPhone } from '../../utils/formatters';
import { csvCell } from '../../utils/csv';

/**
 * 브랜드 신청자 — 메타 광고로 받은 서비스 소개서 신청(/brand-deck) 목록.
 *
 * 신청서는 계정과 묶이지 않은 브랜드 담당자 연락처 한 줄이다. 운영자가 소개서를 메일로
 * 보내고 전화로 상담한 뒤, 진행 상태와 상담 메모를 여기 남긴다. 아직 대응하지 못한
 * 신청이 제일 중요해서 기본 필터는 "새 신청"이다.
 */

type Status = 'new' | 'sent' | 'done';
type Filter = 'all' | Status;

interface DeckRequest {
  id: number;
  company: string;
  name: string;
  phone: string;
  position: string;
  email: string;
  status: Status;
  memo: string;
  created_at: string;
}

const STATUS_LABEL: Record<Status, string> = {
  new: '새 신청',
  sent: '소개서 발송',
  done: '완료',
};

const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-blue-50 text-blue-600',
  sent: 'bg-amber-50 text-amber-600',
  done: 'bg-emerald-50 text-emerald-600',
};

const toCsv = (rows: DeckRequest[]) => {
  const esc = csvCell;
  const head = ['신청일시', '회사명', '담당자 이름', '직책', '전화번호', '이메일', '상태', '메모'];
  const body = rows.map((r) =>
    [new Date(r.created_at).toLocaleString('ko-KR'), r.company, r.name, r.position, r.phone, r.email, STATUS_LABEL[r.status], r.memo]
      .map(esc)
      .join(','),
  );
  return '\uFEFF' + [head.map(esc).join(','), ...body].join('\n');
};

interface Props {
  token: string;
}

const AdminBrandDeckRequests: React.FC<Props> = ({ token }) => {
  const [items, setItems] = useState<DeckRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('new');
  const [query, setQuery] = useState('');
  const [memos, setMemos] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getBrandDeckRequests(token);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setError('');
    setItems(res.requests || []);
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (id: number, patch: { status?: Status; memo?: string }) => {
    setBusyId(id);
    const res = await apiService.updateBrandDeckRequest(id, patch, token);
    setBusyId(null);
    if (res.error || !res.request) {
      setError(res.error || '신청서를 저장하지 못했습니다.');
      return;
    }
    setError('');
    setItems((prev) => prev.map((r) => (r.id === id ? res.request : r)));
    if (patch.memo !== undefined) {
      setMemos((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const counts = {
    all: items.length,
    new: items.filter((r) => r.status === 'new').length,
    sent: items.filter((r) => r.status === 'sent').length,
    done: items.filter((r) => r.status === 'done').length,
  };

  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      (!q ||
        [r.company, r.name, r.position, r.phone, r.email, r.memo].some((v) => String(v || '').toLowerCase().includes(q))),
  );

  const downloadCsv = () => {
    const blob = new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brand-deck-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-black text-slate-900">브랜드 신청자</h3>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
              새 신청 {counts.new}건
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/brand-deck"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg text-[11px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200"
            >
              신청 페이지 열기
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
          {(['new', 'sent', 'done', 'all'] as Filter[]).map((key) => (
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
            placeholder="회사 · 담당자 · 연락처 · 이메일 · 메모 검색"
            className="ml-auto w-full sm:w-64 text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>

        {error && (
          <p className="mt-3 text-[11px] font-bold text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <p className="text-[11px] text-slate-400 font-bold text-center py-10">신청자 목록을 불러오는 중...</p>
        ) : visible.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-slate-500 font-black">
              {items.length === 0 ? '아직 신청한 브랜드가 없습니다.' : '조건에 맞는 신청이 없습니다.'}
            </p>
            {items.length === 0 && (
              <p className="mt-1 text-[11px] font-medium text-slate-400">
                신청 페이지(/brand-deck)로 들어온 서비스 소개서 신청이 여기에 쌓입니다.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visible.map((r) => {
              const memoDraft = memos[r.id];
              const memoDirty = memoDraft !== undefined && memoDraft !== r.memo;
              return (
                <div key={r.id} className="px-4 py-3 flex flex-col md:flex-row md:items-start gap-3">
                  <div className="min-w-0 md:w-72 flex-shrink-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[13px] font-black text-slate-900">{r.company}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <p className="text-[12px] font-bold text-slate-700 mt-0.5">
                      {r.name}
                      <span className="ml-1 font-medium text-slate-400">{r.position}</span>
                    </p>
                    <a
                      href={`tel:${r.phone.replace(/[^0-9+]/g, '')}`}
                      className="block text-[12px] font-bold text-slate-700 hover:text-blue-600"
                    >
                      {formatPhone(r.phone) || r.phone}
                    </a>
                    <a
                      href={`mailto:${r.email}`}
                      className="block text-[11px] font-bold text-blue-600 hover:underline truncate"
                    >
                      {r.email}
                    </a>
                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                      {new Date(r.created_at).toLocaleString('ko-KR')}
                    </p>
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col gap-2">
                    <textarea
                      value={memoDraft ?? r.memo}
                      onChange={(e) => setMemos((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="상담 메모 (예: 10/24 소개서 발송, 뷰티 브랜드, 다음 주 미팅)"
                      rows={2}
                      className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400 resize-y"
                    />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['new', 'sent', 'done'] as Status[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => save(r.id, { status: s })}
                          disabled={busyId === r.id || r.status === s}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-black disabled:cursor-default ${
                            r.status === s ? STATUS_STYLE[s] : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          } ${busyId === r.id ? 'opacity-40' : ''}`}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                      {memoDirty && (
                        <button
                          onClick={() => save(r.id, { memo: memoDraft })}
                          disabled={busyId === r.id}
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

export default AdminBrandDeckRequests;
