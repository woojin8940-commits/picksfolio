import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../../services/apiService';
import { formatNumberWithCommas } from '../../utils/formatters';

/**
 * 담당자 "자동 디엠 이용자 관리".
 *
 * 인플루언서의 자동 디엠은 브랜드 매칭받기 등록으로 열리고, 시간이 지났다고 자동으로
 * 막히지 않는다. 제안을 못 받은 것은 리스트업이 밀린 운영 쪽 사정일 수 있어서다.
 * 대신 "등록만 하고 디엠만 쓰는" 사람을 담당자가 직접 판단할 수 있게, 받은 제안과
 * 그 응답을 한 줄에 모아 보여 준다.
 *
 *   · 주의 대상: 최근 3개월 받은 제안이 기준(기본 3건) 이상인데 수락이 0건
 *   · 제안 대기: 3개월 넘게 제안을 못 받은 사람 — 계속 이용하며, 리스트업 후보로 참고
 *   · 중단됨: 담당자가 막은 사람. 유가시딩 제안을 수락하면 자동으로 다시 열린다.
 *
 * 중단 사유는 인플루언서의 자동 디엠 화면에 그대로 보인다. 왜 막혔고 어떻게 다시
 * 여는지 모르면 같은 문의가 담당자에게 돌아온다.
 */

interface Props {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

type Filter = 'watch' | 'idle' | 'suspended' | 'all';

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: 'watch', label: '주의 대상', hint: '제안을 받고도 수락하지 않음' },
  { key: 'idle', label: '제안 대기', hint: '3개월 넘게 제안 없음 · 계속 이용' },
  { key: 'suspended', label: '중단됨', hint: '담당자가 중단' },
  { key: 'all', label: '전체', hint: '브랜드 매칭받기 등록자' },
];

const formatDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const handleOf = (url: string) => {
  const m = String(url || '').match(/instagram\.com\/([^/?#]+)/i);
  return m ? `@${m[1]}` : '';
};

const EVENT_LABEL: Record<string, string> = {
  suspend: '중단',
  reopen: '다시 열기',
  auto_reopen: '자동 재개',
  note: '메모',
};

const ManagerDmAccessPanel: React.FC<Props> = ({ onNotify }) => {
  const [filter, setFilter] = useState<Filter>('watch');
  const [q, setQ] = useState('');
  const [minOffers, setMinOffers] = useState(3);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<{ total: number; watch: number; idle: number; suspended: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [history, setHistory] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getManagerDmAccess({ filter, q: q.trim(), minOffers });
    setRows(res.rows || []);
    setSummary(res.summary || null);
    setError(res.error || null);
    setLoading(false);
  }, [filter, q, minOffers]);

  useEffect(() => {
    const timer = window.setTimeout(load, q ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, q]);

  const act = async (body: Parameters<typeof apiService.updateManagerDmAccess>[0], done: string) => {
    setBusy(body.username);
    const res = await apiService.updateManagerDmAccess(body);
    setBusy(null);
    if (res.error) {
      onNotify(res.error, 'error');
      return false;
    }
    onNotify(done);
    await load();
    return true;
  };

  const toggleRow = async (row: any) => {
    if (openRow === row.username) {
      setOpenRow(null);
      return;
    }
    setOpenRow(row.username);
    setNoteDraft(row.note || '');
    setHistory(null);
    const res = await apiService.getManagerDmAccessHistory(row.username);
    setHistory(res.events || []);
  };

  const confirmSuspend = async () => {
    if (!suspendTarget) return;
    const ok = await act(
      { action: 'suspend', username: suspendTarget.username, reason: reason.trim() },
      `@${suspendTarget.username} 자동 디엠을 중단했습니다.`,
    );
    if (ok) {
      setSuspendTarget(null);
      setReason('');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg md:text-xl font-black text-slate-900">자동 디엠 이용자 관리</h2>
        <p className="text-xs md:text-sm text-slate-500 font-medium mt-1 leading-relaxed">
          브랜드 매칭받기를 등록한 인플루언서는 자동 디엠을 무료로 씁니다. 제안을 못 받은 사람은 계속 이용하고,
          제안을 계속 거절하는 사람은 여기서 보고 중단할 수 있어요. 중단된 사람이 유가시딩 제안을 수락하면 자동으로 다시 열립니다.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {FILTERS.map((f) => {
          const count = summary ? (f.key === 'all' ? summary.total : summary[f.key]) : null;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`text-left rounded-xl border px-3.5 py-3 transition-all ${
                active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-black">{f.label}</span>
                <span className={`text-sm font-black ${active ? 'text-white' : f.key === 'watch' && count ? 'text-rose-500' : 'text-slate-400'}`}>
                  {count == null ? '—' : `${count}명`}
                </span>
              </div>
              <p className={`text-[11px] font-bold mt-0.5 ${active ? 'text-white/70' : 'text-slate-400'}`}>{f.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="아이디 · 이름 · 인스타 검색"
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold focus:outline-none focus:border-blue-400"
        />
        <label className="flex items-center gap-2 text-xs font-bold text-slate-500 shrink-0">
          주의 기준: 최근 3개월 제안
          <select
            value={minOffers}
            onChange={(e) => setMinOffers(Number(e.target.value))}
            className="px-2 py-2 rounded-lg border border-slate-200 text-sm font-black text-slate-700"
          >
            {[1, 2, 3, 4, 5, 7, 10].map((n) => (
              <option key={n} value={n}>{n}건</option>
            ))}
          </select>
          이상 · 수락 0건
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm font-bold text-slate-400">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm font-bold text-slate-400">해당하는 인플루언서가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const open = openRow === r.username;
            return (
              <div key={r.username} className={`rounded-2xl border bg-white ${r.suspended ? 'border-rose-200' : 'border-slate-200'}`}>
                <div className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                  <button type="button" onClick={() => toggleRow(r)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-slate-900">@{r.username}</span>
                      {r.name && <span className="text-xs font-bold text-slate-500">{r.name}</span>}
                      {handleOf(r.instagram) && <span className="text-xs font-bold text-slate-400">IG {handleOf(r.instagram)}</span>}
                      {r.followers > 0 && <span className="text-xs font-bold text-slate-400">팔로워 {formatNumberWithCommas(r.followers)}</span>}
                      {r.suspended ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-600">중단됨</span>
                      ) : r.watch ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-700">주의</span>
                      ) : r.idle ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-500">제안 대기</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">이용 중</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
                      <span>
                        최근 3개월 제안 <strong className="text-slate-800">{r.recent.offers}</strong> · 수락{' '}
                        <strong className="text-emerald-600">{r.recent.accepted}</strong> · 거절{' '}
                        <strong className="text-rose-500">{r.recent.declined}</strong> · 무응답{' '}
                        <strong className="text-amber-600">{r.recent.noResponse}</strong>
                      </span>
                      <span>전체 제안 {r.total.offers} · 수락 {r.total.accepted}</span>
                      <span>등록 {formatDate(r.registeredAt)}</span>
                      <span>마지막 제안 {formatDate(r.lastOfferAt)}</span>
                      <span>마지막 수락 {formatDate(r.lastAcceptedAt)}</span>
                      <span>
                        자동 디엠{' '}
                        {r.dm == null ? '—' : r.dm.enabled ? `켜짐 · 자동화 ${r.dm.automations}개` : '꺼짐'}
                      </span>
                    </div>
                    {r.suspended && r.reason && (
                      <p className="mt-1.5 text-[11px] font-bold text-rose-600">중단 사유: {r.reason}</p>
                    )}
                    {!r.suspended && r.lastDeclineNote && (
                      <p className="mt-1.5 text-[11px] font-bold text-slate-500">
                        최근 거절{r.lastDeclineCampaign ? ` (${r.lastDeclineCampaign})` : ''}: {r.lastDeclineNote}
                      </p>
                    )}
                  </button>
                  <div className="flex gap-2 shrink-0">
                    {r.suspended ? (
                      <button
                        type="button"
                        disabled={busy === r.username}
                        onClick={() => act({ action: 'reopen', username: r.username }, `@${r.username} 자동 디엠을 다시 열었습니다.`)}
                        className="px-3.5 py-2 rounded-xl text-xs font-black border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        다시 열기
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === r.username}
                        onClick={() => { setSuspendTarget(r); setReason(''); }}
                        className="px-3.5 py-2 rounded-xl text-xs font-black border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        사용 중단
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="border-t border-slate-100 p-4 grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] font-black text-slate-500 mb-1.5">담당자 메모</p>
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        rows={3}
                        placeholder="예: 단가가 맞지 않아 거절 — 고단가 캠페인 위주로 제안"
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-blue-400"
                      />
                      <button
                        type="button"
                        disabled={busy === r.username}
                        onClick={() => act({ action: 'note', username: r.username, note: noteDraft }, '메모를 저장했습니다.')}
                        className="mt-2 px-3.5 py-2 rounded-xl text-xs font-black bg-slate-900 text-white disabled:opacity-50"
                      >
                        메모 저장
                      </button>
                    </div>
                    <div>
                      <p className="text-[11px] font-black text-slate-500 mb-1.5">조치 이력</p>
                      {history == null ? (
                        <p className="text-xs font-bold text-slate-400">불러오는 중…</p>
                      ) : history.length === 0 ? (
                        <p className="text-xs font-bold text-slate-400">아직 조치한 기록이 없습니다.</p>
                      ) : (
                        <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                          {history.map((e, i) => (
                            <li key={i} className="text-[11px] font-bold text-slate-600">
                              <span className="text-slate-400">{formatDate(e.at)}</span>{' '}
                              <span className="text-slate-900">{EVENT_LABEL[e.action] || e.action}</span>
                              {e.actor && <span className="text-slate-400"> · {e.actor.startsWith('auto:') ? '자동' : e.actor}</span>}
                              {e.reason && <span> — {e.reason}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {suspendTarget && (
        <div className="fixed inset-0 z-[220] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            <h3 className="text-base font-black text-slate-900">@{suspendTarget.username} 자동 디엠 중단</h3>
            <p className="text-xs font-medium text-slate-500 leading-relaxed">
              만들어 둔 자동화는 지우지 않고 멈춰 둡니다. 아래 사유는 인플루언서의 자동 디엠 화면에 그대로 안내되며,
              유가시딩 캠페인 제안을 수락하면 자동으로 다시 열립니다.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="예: 최근 3개월 동안 받은 제안 5건을 모두 수락하지 않았어요."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-rose-400"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSuspendTarget(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600"
              >
                취소
              </button>
              <button
                type="button"
                disabled={!reason.trim() || busy === suspendTarget.username}
                onClick={confirmSuspend}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-black text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-50"
              >
                중단하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerDmAccessPanel;
