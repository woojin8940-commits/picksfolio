import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, MessageCircle, RefreshCw, Share2, ThumbsUp } from 'lucide-react';
import { useMetaPages } from '../hooks/useMetaPages';
import { MetaPageEngagement as Engagement, fetchPageEngagement } from '../utils/metaAdsApi';
import MetaPagePicker from './MetaPagePicker';

/**
 * 페이지 게시물 참여 — 고른 페이스북 페이지의 최근 게시물 반응·댓글·공유 수.
 *
 * 광고 현황과 캠페인 이력에 같이 붙는다. 광고로 돌릴 게시물을 고를 때, 그리고 광고를
 * 돌린 뒤 페이지 반응이 어떻게 움직였는지 볼 때 같은 숫자를 봐야 해서 한 컴포넌트로 둔다.
 * 숫자는 메타가 돌려준 그대로다(pages_read_engagement) — 조회 시각을 같이 적는다.
 */
interface MetaPageEngagementProps {
  username: string;
  /** 페이지 목록을 부를지. 연동 전에는 부르지 않는다. */
  enabled: boolean;
  /** 위쪽 제목. 화면마다 문맥이 달라 바꿀 수 있게 둔다. */
  title?: string;
}

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({ icon, label, value }) => (
  <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
    <p className="text-[10px] text-slate-400 font-black flex items-center gap-1">
      {icon}
      {label}
    </p>
    <p className="text-[15px] font-black text-slate-900 mt-0.5">{value.toLocaleString()}</p>
  </div>
);

const MetaPageEngagementPanel: React.FC<MetaPageEngagementProps> = ({ username, enabled, title }) => {
  const pagesState = useMetaPages(username, enabled);
  const { page } = pagesState;
  const [data, setData] = useState<Engagement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!page) return;
    setLoading(true);
    const res = await fetchPageEngagement(username, page.id);
    if (res.ok) {
      setData(res);
      setError('');
    } else {
      setData(null);
      setError(res.error);
    }
    setLoading(false);
  }, [username, page?.id]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  if (!enabled) return null;

  return (
    <div className="bg-white rounded-3xl border border-slate-100 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">{title || '페이지 게시물 참여'}</p>
          <p className="text-[11px] text-slate-400 font-bold mt-0.5">
            Meta 그래프 API에서 실시간으로 읽은 최근 게시물 반응입니다
            {data?.fetchedAt ? ` · ${new Date(data.fetchedAt).toLocaleString()} 조회` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void pagesState.refresh(); if (page) void load(); }}
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

      {!page && pagesState.pages.length > 0 && (
        <div className="mt-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {['반응(좋아요 등)', '댓글', '공유', '팔로워'].map((label) => (
              <div key={label} className="rounded-2xl bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] text-slate-400 font-black">{label}</p>
                <p className="text-[15px] font-black text-slate-300 mt-0.5">—</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 font-bold py-3">
            페이지를 선택하면 반응·댓글·공유·팔로워와 최근 게시물이 표시됩니다.
          </p>
        </div>
      )}

      {page && (
        <div className="mt-3">
          {loading && !data ? (
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 py-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {page.name} 게시물 반응을 불러오는 중
            </div>
          ) : error ? (
            <p className="text-[11px] text-rose-600 font-bold py-2 break-words">{error}</p>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat icon={<ThumbsUp className="w-3 h-3" />} label="반응(좋아요 등)" value={data.totals.reactions} />
                <Stat icon={<MessageCircle className="w-3 h-3" />} label="댓글" value={data.totals.comments} />
                <Stat icon={<Share2 className="w-3 h-3" />} label="공유" value={data.totals.shares} />
                <Stat icon={<ThumbsUp className="w-3 h-3" />} label="팔로워" value={data.page.followers} />
              </div>
              <p className="text-[10px] text-slate-400 font-bold mt-2">최근 게시물 {data.totals.posts}개 합계</p>

              {data.posts.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-bold py-3">이 페이지에 게시물이 없습니다.</p>
              ) : (
                <div className="mt-2 divide-y divide-slate-100">
                  {data.posts.map((post) => (
                    <div key={post.id} className="flex items-center gap-3 py-2.5">
                      {post.pictureUrl ? (
                        <img src={post.pictureUrl} alt="" className="w-11 h-11 rounded-xl object-cover bg-slate-100 flex-shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-slate-100 flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-bold text-slate-700 truncate">
                          {post.message || '(텍스트 없는 게시물)'}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                          {post.createdTime ? new Date(post.createdTime).toLocaleDateString() : ''} · 반응{' '}
                          {post.reactions.toLocaleString()} · 댓글 {post.comments.toLocaleString()} · 공유{' '}
                          {post.shares.toLocaleString()}
                        </p>
                      </div>
                      {post.permalinkUrl && (
                        <a
                          href={post.permalinkUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="게시물 열기"
                          className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default MetaPageEngagementPanel;
