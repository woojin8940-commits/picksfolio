import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2, UserCheck } from 'lucide-react';
import { useMetaPages } from '../hooks/useMetaPages';
import { ApprovedCreator, changeApprovedCreator, fetchApprovedCreators } from '../utils/metaAdsApi';
import MetaPagePicker from './MetaPagePicker';

/**
 * 승인된 크리에이터 — 브랜드 인스타그램 계정의 파트너십 광고 크리에이터 목록.
 *
 * 고른 페이스북 페이지에 연결된 브랜드 인스타그램 계정 기준으로, 메타의
 * branded_content_ad_permissions 를 그대로 보여 준다(instagram_branded_content_ads_brand).
 * 추가하면 크리에이터에게 권한 요청이 가고, 삭제하면 권한을 거둔다. 목록은 저장하지 않고
 * 바꿀 때마다 메타에서 다시 읽는다.
 */
interface MetaApprovedCreatorsProps {
  username: string;
  enabled: boolean;
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: '승인됨', tone: 'bg-emerald-50 text-emerald-700' },
  ACTIVE: { label: '승인됨', tone: 'bg-emerald-50 text-emerald-700' },
  PENDING: { label: '수락 대기', tone: 'bg-amber-50 text-amber-700' },
  REJECTED: { label: '거절됨', tone: 'bg-rose-50 text-rose-700' },
};

const MetaApprovedCreators: React.FC<MetaApprovedCreatorsProps> = ({ username, enabled }) => {
  const pagesState = useMetaPages(username, enabled);
  const { page } = pagesState;
  const igUserId = page?.instagramUserId || '';
  const [creators, setCreators] = useState<ApprovedCreator[]>([]);
  const [fetchedAt, setFetchedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');

  const apply = (res: Awaited<ReturnType<typeof fetchApprovedCreators>>) => {
    if (res.ok) {
      setCreators(res.creators);
      setFetchedAt(res.fetchedAt);
      setError('');
    } else {
      setError(res.error);
    }
    return res.ok;
  };

  const load = useCallback(async () => {
    if (!igUserId) return;
    setLoading(true);
    apply(await fetchApprovedCreators(username, igUserId));
    setLoading(false);
  }, [username, igUserId]);

  useEffect(() => {
    setCreators([]);
    setFetchedAt('');
    setError('');
    void load();
  }, [load]);

  const change = async (action: 'add' | 'remove', creatorUsername: string) => {
    if (!igUserId || !creatorUsername) return;
    setBusy(`${action}:${creatorUsername}`);
    const ok = apply(await changeApprovedCreator(username, igUserId, action, creatorUsername));
    if (ok && action === 'add') setInput('');
    setBusy('');
  };

  if (!enabled) return null;

  const adding = busy.startsWith('add:');

  return (
    <div className="bg-white rounded-3xl border border-slate-100 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-blue-600" />
            승인된 크리에이터
          </p>
          <p className="text-[11px] text-slate-400 font-bold mt-0.5">
            파트너십 광고를 함께 집행할 크리에이터 목록입니다 · Meta 그래프 API에서 실시간으로 읽습니다
            {fetchedAt ? ` · ${new Date(fetchedAt).toLocaleString()} 조회` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void pagesState.refresh(); void load(); }}
          disabled={loading}
          aria-label="새로고침"
          className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <MetaPagePicker
        compact
        pages={pagesState.pages}
        selectedId={page?.id}
        onSelect={pagesState.selectPage}
        loading={pagesState.loading}
        error={pagesState.error}
        onRetry={pagesState.refresh}
      />

      {page && !igUserId && (
        <p className="mt-3 text-[11px] text-amber-700 font-bold rounded-2xl bg-amber-50 px-4 py-3">
          {page.name} 페이지에 브랜드 인스타그램 프로페셔널 계정이 연결돼 있지 않습니다. 인스타그램 계정이 연결된
          페이지를 골라 주세요.
        </p>
      )}

      {igUserId && (
        <div className="mt-3">
          <p className="text-[11px] text-slate-500 font-bold mb-2">
            브랜드 계정 <span className="text-slate-900">@{page?.instagramUsername}</span>
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void change('add', input.trim().replace(/^@/, ''));
            }}
            className="flex gap-2"
          >
            <div className="flex-1 flex items-center rounded-2xl border border-slate-200 bg-white px-3 focus-within:border-blue-500">
              <span className="text-[13px] font-bold text-slate-400">@</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="크리에이터 인스타그램 사용자 이름"
                aria-label="크리에이터 인스타그램 사용자 이름"
                className="flex-1 min-w-0 py-2.5 pl-1 text-[13px] font-bold text-slate-900 outline-none bg-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim() || !!busy}
              className="inline-flex items-center gap-1 px-4 rounded-2xl bg-blue-600 text-white text-[12px] font-black disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              추가
            </button>
          </form>

          {error && <p className="text-[11px] text-rose-600 font-bold py-2 break-words">{error}</p>}

          {loading && creators.length === 0 ? (
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              승인된 크리에이터를 불러오는 중
            </div>
          ) : creators.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-bold py-4">
              아직 승인된 크리에이터가 없습니다. 사용자 이름을 입력해 추가해 주세요.
            </p>
          ) : (
            <div className="mt-2 divide-y divide-slate-100">
              {creators.map((c) => {
                const status = STATUS_LABEL[c.status];
                const removing = busy === `remove:${c.username}`;
                return (
                  <div key={c.id || c.username} className="flex items-center gap-3 py-2.5">
                    {c.profilePictureUrl ? (
                      <img src={c.profilePictureUrl} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-100 flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[12px] font-black text-slate-400 flex-shrink-0">
                        {(c.username || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-black text-slate-900 truncate">
                        {c.username ? `@${c.username}` : c.id}
                      </p>
                      {status ? (
                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-black ${status.tone}`}>
                          {status.label}
                        </span>
                      ) : c.status ? (
                        <p className="text-[10px] text-slate-400 font-bold mt-0.5">{c.status}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void change('remove', c.username)}
                      disabled={!c.username || !!busy}
                      aria-label={`@${c.username} 삭제`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black text-slate-500 hover:text-rose-600 hover:border-rose-200 disabled:opacity-50"
                    >
                      {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MetaApprovedCreators;
