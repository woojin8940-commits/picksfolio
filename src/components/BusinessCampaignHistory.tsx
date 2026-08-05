import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders } from '../services/apiService';
import { formatKoreanWon, formatNumberWithCommas } from '../utils/formatters';

/**
 * 캠페인 이력 — 지난 캠페인에서 올라간 게시물의 성과.
 *
 * 브랜드가 두 번째 캠페인을 열 때 가장 먼저 하는 질문은 "지난번에 뭐가 잘 됐지"다.
 * 캠페인 관리 화면은 진행 중인 건을 다루는 곳이라 끝난 캠페인이 목록에서 사라지고,
 * 그래서 브랜드는 매번 처음부터 다시 고르게 된다. 이 화면은 그 반대편이다 — 끝난
 * 것부터 본다.
 *
 * 숫자는 추정하지 않는다. 게시물 지표는 인플루언서 채널의 메타 연동으로 받아온
 * 값만 쓰고, 맞춰지지 않은 게시물은 "집계 전"으로 두고 이유를 적는다(업로드 전 /
 * 연동 없음 / 최근 목록에서 밀려남). 절반만 집계된 조회수를 전체처럼 보여 주면
 * 브랜드는 그 CPV 를 근거로 다음 예산을 잘못 잡는다. 그래서 집계 커버리지
 * (게시물 N건 중 M건)를 숫자 옆에 항상 같이 적는다.
 *
 * 정렬·필터를 화면에서 하는 이유는 한 계정의 캠페인이 수백 건이 되지 않기 때문이다.
 * 서버가 한 번에 다 보내고 화면에서 추리는 편이, 필터를 누를 때마다 기다리는 것보다
 * 이력을 훑는 동작에 맞는다.
 */

interface BusinessCampaignHistoryProps {
  businessUsername: string;
  companyName: string;
}

type PostMetric = {
  views: number;
  likes: number;
  comments: number;
  thumbnailUrl: string;
  permalink: string;
  timestamp: string;
  from: 'reels' | 'feed';
};

type HistoryPost = {
  collabId: string;
  creatorUsername: string;
  instagramHandle: string;
  status: string;
  cancelled: boolean;
  uploadUrl: string;
  fee: number;
  followers: number;
  metricsSource: string;
  metrics: PostMetric | null;
  reason: string;
};

type HistoryCampaign = {
  id: string;
  title: string;
  category: string;
  type: string;
  status: string;
  rewardMode: string;
  thumbnailUrl: string;
  startDate: string;
  endDate: string;
  budgetKrw: number;
  createdAt: string | null;
  collabs: number;
  uploaded: number;
  matched: number;
  views: number;
  likes: number;
  comments: number;
  spend: number;
  cpv: number;
  posts: HistoryPost[];
};

type HistoryTotals = {
  campaigns: number;
  collabs: number;
  uploaded: number;
  matched: number;
  views: number;
  reactions: number;
  spend: number;
  cpv: number;
};

const EMPTY_TOTALS: HistoryTotals = {
  campaigns: 0, collabs: 0, uploaded: 0, matched: 0, views: 0, reactions: 0, spend: 0, cpv: 0,
};

/** 지표를 못 붙인 이유를 브랜드가 할 일로 바꿔서 적는다. */
const REASON_LABEL: Record<string, string> = {
  not_uploaded: '업로드 전',
  not_linked: '채널 연동 전',
  out_of_window: '집계 전',
  cancelled: '취소된 협업',
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active: { label: '모집중', cls: 'bg-emerald-50 text-emerald-600' },
  closed: { label: '마감', cls: 'bg-slate-100 text-slate-500' },
  completed: { label: '종료', cls: 'bg-slate-100 text-slate-500' },
  draft: { label: '작성 중', cls: 'bg-amber-50 text-amber-600' },
  pending: { label: '승인 대기', cls: 'bg-amber-50 text-amber-600' },
  rejected: { label: '반려', cls: 'bg-rose-50 text-rose-500' },
};

/** 모집중이 아니면 전부 '마감' 쪽으로 묶는다. 이력 화면에서 필요한 구분은 그 둘이다. */
type StatusFilter = '' | 'open' | 'closed';

const Kpi: React.FC<{ label: string; value: string; unit?: string; hint?: string; pending?: boolean }> = ({
  label, value, unit, hint, pending,
}) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
    <p className="text-[10px] font-black text-slate-400">{label}</p>
    <p className={`text-lg font-black mt-1.5 ${pending ? 'text-slate-300' : 'text-slate-900'}`}>
      {value}
      {unit && <span className="text-[11px] font-bold ml-0.5">{unit}</span>}
    </p>
    {pending && (
      <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">
        집계 전
      </span>
    )}
    {hint && <p className="text-[10px] text-slate-400 font-medium mt-2 leading-tight">{hint}</p>}
  </div>
);

const BusinessCampaignHistory: React.FC<BusinessCampaignHistoryProps> = ({ businessUsername }) => {
  const cleanUsername = (businessUsername || '').replace(/^biz\//, '').toLowerCase();
  const cacheKey = `picks_biz_campaign_history_${cleanUsername}`;

  const cached = (() => {
    try {
      const rawCache = localStorage.getItem(cacheKey);
      return rawCache ? JSON.parse(rawCache) : null;
    } catch { return null; }
  })();

  const [campaigns, setCampaigns] = useState<HistoryCampaign[]>(cached?.campaigns || []);
  const [totals, setTotals] = useState<HistoryTotals>(cached?.totals || EMPTY_TOTALS);
  const [categoryList, setCategoryList] = useState<string[]>(cached?.categories || []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [sort, setSort] = useState<'recent' | 'views'>('recent');
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/business/campaign-history/${encodeURIComponent(cleanUsername)}`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || '캠페인 이력을 불러오지 못했습니다.');
        return;
      }
      setCampaigns(data.campaigns || []);
      setTotals(data.totals || EMPTY_TOTALS);
      setCategoryList(data.categories || []);
      setError('');
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
    } catch {
      setError('네트워크 상태를 확인해 주세요.');
    } finally {
      setLoading(false);
    }
  }, [cleanUsername, cacheKey]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const visible = useMemo(() => {
    const rows = campaigns.filter((c) => {
      if (category && c.category !== category) return false;
      if (status === 'open' && c.status !== 'active') return false;
      if (status === 'closed' && c.status === 'active') return false;
      return true;
    });
    return sort === 'views'
      ? [...rows].sort((a, b) => b.views - a.views)
      : rows;
  }, [campaigns, category, status, sort]);

  // 필터를 걸면 위쪽 합계도 같이 움직여야 한다. 전체 합계만 남으면 "이 카테고리는
  // 얼마나 됐지"를 볼 수 없다.
  const shown = useMemo(() => {
    const base = { ...EMPTY_TOTALS };
    for (const c of visible) {
      base.campaigns++;
      base.collabs += c.collabs;
      base.uploaded += c.uploaded;
      base.matched += c.matched;
      base.views += c.views;
      base.reactions += c.likes + c.comments;
      base.spend += c.spend;
    }
    base.cpv = base.views > 0 && base.spend > 0 ? Math.round(base.spend / base.views) : 0;
    return base;
  }, [visible]);

  const filtered = !!category || !!status;
  const coverage = shown.uploaded > 0 ? `업로드 ${shown.uploaded}건 중 ${shown.matched}건 집계` : '';

  if (loading) {
    return (
      <div className="p-4 md:p-14 w-full">
        <div className="h-8 w-40 bg-slate-100 rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-14 w-full animate-in fade-in duration-500">
      <div className="mb-6 md:mb-10">
        <h2 className="text-xl md:text-3xl font-black text-slate-900">캠페인 이력</h2>
        <p className="text-slate-400 text-xs md:text-sm font-bold mt-1">
          지금까지 진행한 캠페인과 인플루언서 게시물의 성과를 확인합니다
        </p>
      </div>

      {error && (
        <div className="mb-5 bg-rose-50 border border-rose-100 rounded-2xl px-4 py-3">
          <p className="text-[12px] text-rose-600 font-bold">{error}</p>
          <button
            onClick={() => { setLoading(true); fetchHistory(); }}
            className="mt-1.5 text-[11px] text-rose-500 font-black underline"
          >
            다시 시도
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label={filtered ? '캠페인 (필터)' : '진행한 캠페인'}
          value={formatNumberWithCommas(shown.campaigns)}
          unit="건"
          hint={`확정 협업 ${formatNumberWithCommas(shown.collabs)}명 · 업로드 ${formatNumberWithCommas(shown.uploaded)}건`}
        />
        <Kpi
          label="전체 조회수"
          value={shown.views > 0 ? formatNumberWithCommas(shown.views) : '—'}
          unit={shown.views > 0 ? '회' : undefined}
          pending={shown.views === 0}
          hint={coverage || '업로드가 확인되면 여기에 쌓입니다'}
        />
        <Kpi
          label="좋아요 · 댓글"
          value={shown.reactions > 0 ? formatNumberWithCommas(shown.reactions) : '—'}
          unit={shown.reactions > 0 ? '건' : undefined}
          pending={shown.reactions === 0}
          hint={coverage}
        />
        <Kpi
          label="평균 CPV"
          value={shown.cpv > 0 ? formatNumberWithCommas(shown.cpv) : '—'}
          unit={shown.cpv > 0 ? '원' : undefined}
          pending={shown.cpv === 0}
          hint={
            shown.spend > 0
              ? `집행 ${formatKoreanWon(shown.spend)} ÷ 집계된 조회수`
              : '확정 지급액이 등록되면 계산됩니다'
          }
        />
      </div>

      {/* 필터를 걸면 위 숫자가 그 조건만의 합계로 바뀐다. 전체 기준을 잃어버리지
          않도록 계정 전체 합계를 한 줄로 남겨 둔다. */}
      {filtered && (
        <p className="text-[10px] text-slate-400 font-bold mt-2">
          계정 전체 기준: 캠페인 {formatNumberWithCommas(totals.campaigns)}건 · 조회수{' '}
          {totals.views > 0 ? `${formatNumberWithCommas(totals.views)}회` : '집계 전'}
        </p>
      )}

      <div className="mt-5 bg-blue-50 border border-blue-100 rounded-2xl p-4">
        <p className="text-[12px] font-black text-blue-800">게시물 지표는 인플루언서 채널 연동에서 받아옵니다</p>
        <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
          업로드된 게시물 주소를 인플루언서의 메타 계정 최근 게시물과 맞춰 조회수·반응을 가져옵니다.
          인플루언서가 직접 적은 숫자는 성과 근거로 쓰지 않기 때문에, 연동 전 게시물은 집계 전으로 남습니다.
          메타는 최근 게시물만 돌려주므로 오래된 캠페인의 게시물도 집계에서 빠질 수 있습니다.
        </p>
      </div>

      {/* 카테고리 · 상태 · 정렬. 이력을 훑는 동작이라 전부 한 줄에 둔다. */}
      <div className="mt-6 flex flex-wrap items-center gap-1.5">
        {[{ key: '', label: '전체' }, ...categoryList.map((c) => ({ key: c, label: c }))].map((tab) => (
          <button
            key={tab.key || 'all'}
            onClick={() => setCategory(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors ${
              category === tab.key
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="w-px h-5 bg-slate-200 mx-1" />
        {([['', '전체 상태'], ['open', '모집중'], ['closed', '마감']] as [StatusFilter, string][]).map(
          ([key, label]) => (
            <button
              key={key || 'any'}
              onClick={() => setStatus(key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors ${
                status === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ),
        )}
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <button
          onClick={() => setSort(sort === 'recent' ? 'views' : 'recent')}
          className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
        >
          {sort === 'recent' ? '최신순' : '조회수순'}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-400 font-bold">
            {campaigns.length === 0 ? '아직 진행한 캠페인이 없습니다.' : '이 조건에 맞는 캠페인이 없습니다.'}
          </p>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            {campaigns.length === 0
              ? '캠페인 협업에서 캠페인을 등록하면 진행 이력이 이 화면에 쌓입니다.'
              : '카테고리나 상태 필터를 풀고 다시 확인해 보세요.'}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((c) => {
            const open = openId === c.id;
            const badge = STATUS_LABEL[c.status] || { label: c.status || '상태 미정', cls: 'bg-slate-100 text-slate-500' };
            return (
              <div key={c.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : c.id)}
                  className="w-full text-left p-4 md:p-5 hover:bg-slate-50/60 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {c.thumbnailUrl ? (
                      <img
                        src={c.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="w-14 h-14 rounded-xl object-cover bg-slate-100 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-slate-100 flex-shrink-0" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-black text-slate-900 truncate">{c.title || '제목 없음'}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${badge.cls}`}>{badge.label}</span>
                        {c.category && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-black">
                            {c.category}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                        {c.startDate || '기간 미정'}
                        {c.endDate ? ` ~ ${c.endDate}` : ''}
                        {` · 협업 ${c.collabs}명 · 업로드 ${c.uploaded}건`}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                        <span className="text-[11px] font-black text-slate-900">
                          조회 {c.views > 0 ? formatNumberWithCommas(c.views) : '—'}
                        </span>
                        <span className="text-[11px] font-bold text-slate-500">
                          반응 {c.likes + c.comments > 0 ? formatNumberWithCommas(c.likes + c.comments) : '—'}
                        </span>
                        <span className="text-[11px] font-bold text-slate-500">
                          CPV {c.cpv > 0 ? `${formatNumberWithCommas(c.cpv)}원` : '—'}
                        </span>
                        {c.uploaded > 0 && c.matched < c.uploaded && (
                          <span className="text-[10px] font-black text-amber-600">
                            {c.uploaded - c.matched}건 집계 전
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="text-slate-300 text-[11px] font-black flex-shrink-0 mt-1">
                      {open ? '접기' : '게시물'}
                    </span>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-slate-100 p-4 md:p-5 bg-slate-50/50">
                    {c.posts.length === 0 ? (
                      <p className="text-[11px] text-slate-400 font-bold text-center py-4">
                        아직 확정된 협업이 없습니다.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {c.posts.map((p) => (
                          <div
                            key={p.collabId}
                            className={`bg-white rounded-xl border p-3 flex gap-3 ${
                              p.cancelled ? 'border-slate-100 opacity-60' : 'border-slate-100'
                            }`}
                          >
                            {p.metrics?.thumbnailUrl ? (
                              <img
                                src={p.metrics.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="w-16 aspect-[9/16] object-cover rounded-lg bg-slate-100 flex-shrink-0"
                              />
                            ) : (
                              <div className="w-16 aspect-[9/16] rounded-lg bg-slate-100 flex-shrink-0 flex items-center justify-center">
                                <span className="text-[9px] text-slate-400 font-black text-center px-1">
                                  {REASON_LABEL[p.reason] || '집계 전'}
                                </span>
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-black text-slate-900 truncate">
                                {p.instagramHandle ? `@${p.instagramHandle}` : `@${p.creatorUsername}`}
                              </p>
                              <p className="text-[10px] text-slate-400 font-bold">
                                {p.followers > 0 ? `팔로워 ${formatNumberWithCommas(p.followers)}` : '팔로워 미등록'}
                                {p.fee > 0 ? ` · ${formatKoreanWon(p.fee)}` : ''}
                              </p>

                              {p.metrics ? (
                                <div className="mt-1.5 space-y-0.5">
                                  <p className="text-[12px] font-black text-slate-900">
                                    {p.metrics.views > 0
                                      ? `조회 ${formatNumberWithCommas(p.metrics.views)}`
                                      : '조회수 비공개'}
                                  </p>
                                  <p className="text-[10px] text-slate-500 font-bold">
                                    좋아요 {formatNumberWithCommas(p.metrics.likes)} · 댓글{' '}
                                    {formatNumberWithCommas(p.metrics.comments)}
                                    {p.metrics.views > 0 && p.fee > 0
                                      ? ` · CPV ${formatNumberWithCommas(Math.round(p.fee / p.metrics.views))}원`
                                      : ''}
                                  </p>
                                </div>
                              ) : (
                                <p className="mt-1.5 text-[10px] text-slate-400 font-bold leading-relaxed">
                                  {p.reason === 'not_uploaded'
                                    ? '업로드가 확인되면 지표가 붙습니다.'
                                    : p.reason === 'not_linked'
                                      ? '이 인플루언서의 채널이 메타에 연동되면 지표가 붙습니다.'
                                      : p.reason === 'cancelled'
                                        ? '중간에 취소된 협업입니다.'
                                        : '메타 최근 게시물 목록에서 밀려나 아직 맞추지 못했습니다.'}
                                </p>
                              )}

                              {(p.metrics?.permalink || p.uploadUrl) && (
                                <a
                                  href={p.metrics?.permalink || p.uploadUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-block mt-1.5 text-[10px] text-blue-600 font-black hover:underline"
                                >
                                  게시물 보기
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {c.budgetKrw > 0 && (
                      <p className="text-[10px] text-slate-400 font-medium mt-3">
                        등록 예산 {formatKoreanWon(c.budgetKrw)}
                        {c.spend > 0 ? ` · 확정 지급액 합계 ${formatKoreanWon(c.spend)}` : ' · 확정 지급액은 담당자가 조건을 확정하면 채워집니다'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BusinessCampaignHistory;
