import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiService } from '../../services/apiService';
import { formatCountKo, formatKoreanWon, formatNumberWithCommas } from '../../utils/formatters';

/**
 * 캠페인 인사이트 — 올라간 게시물이 실제로 얼마나 보였는지.
 *
 * 숫자는 인플루언서가 적어 넣는 것이 아니라 플랫폼에서 받아온다(자기 신고 수치는
 * 광고비 정산 근거가 되지 못한다). 인플루언서가 캠페인용으로 연동해 둔 인스타그램
 * 계정의 토큰으로 자기 게시물의 좋아요·댓글과 인사이트 조회수를 읽어 저장하고,
 * 이 화면은 그 저장값을 그린다. 계산(합계·단가)은 서버 한 군데서만 한다 — 브랜드
 * 화면과 담당자 화면이 각자 계산하면 같은 캠페인이 두 개의 성과를 갖는다.
 *
 * ── 비어 있는 칸을 채우지 않는다 ──
 * 못 받은 값은 0 이 아니라 빈 칸이다. 조회수는 인사이트 권한이 있어야 나오는 값이라
 * 좋아요·댓글은 들어오고 조회수만 없는 경우가 흔하다. 그 자리에 0 을 쓰면 "아무도
 * 보지 않은 캠페인"이 되고, 추정치를 쓰면 나중에 실제 값이 들어올 때 사람은 둘 중
 * 무엇이 맞는지 알 수 없다. 그래서 왜 비었는지(연동 없음 · 게시물 못 찾음)를 적는다.
 *
 * ── CPV 가 없으면 대신 쓸 단가를 보여 준다 ──
 * 서버가 CPV(조회수당) → CPE(반응당) → 게시물당 순으로 만들 수 있는 단가를 내려가며
 * 고르고, 무엇으로 계산했는지(primary)를 함께 보낸다. 화면은 그 이름을 그대로 적는다.
 * "CPV"라고만 적으면 사람은 조회수가 집계됐다고 믿는다.
 */

interface CampaignInsightPanelProps {
  /** 이 캠페인의 총 집행 예산(원). 서버가 성과를 못 받은 동안에도 맥락으로 보여 준다. */
  budgetKrw: number;
  /** 업로드가 확인된 협업 수. 0이면 아직 집계할 게시물 자체가 없다. */
  uploadedCount: number;
  /** 진행 중인 협업 수. */
  totalCollabs: number;
  /**
   * 누가 보는 화면인지. 칸의 뜻이 보는 쪽에 따라 달라진다 — 브랜드·담당자는 캠페인
   * 전체의 합계와 단가를 보고, 인플루언서는 자기 게시물의 성과를 본다. 금액은
   * 인플루언서 화면에 오지 않는다(서버도 보내지 않는다).
   */
  viewer?: 'brand' | 'influencer' | 'manager';
  /**
   * 성과를 받아올 캠페인. 없으면 실제 수집을 시도하지 않고 "집계 전" 안내만 남는다 —
   * 아직 캠페인이 만들어지기 전 미리보기 자리에서도 이 화면을 쓰기 때문이다.
   */
  campaignId?: string;
  /** 운영 콘솔에서 열 때의 Netlify Identity 토큰. 서비스 화면에서는 넘기지 않는다. */
  token?: string;
}

type Post = {
  collabId: string;
  creatorUsername: string;
  permalink: string;
  thumbnailUrl: string;
  mediaType: string;
  postedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  source: 'meta_api' | 'channel_cache' | 'unlinked' | 'not_found' | 'error';
  note: string;
  collectedAt: string | null;
};

type Metrics = {
  role: string;
  posts: Post[];
  series: { date: string; views: number; likes: number; comments: number }[];
  totals: {
    collabCount: number;
    uploadedCount: number;
    measuredCount: number;
    views: number | null;
    likes: number | null;
    comments: number | null;
    engagements: number | null;
    viewsAvailable: boolean;
    unlinkedCount: number;
    cachedCount: number;
    notFoundCount: number;
    measuredSpend: number;
    totalSpend: number;
    collectedAt: string | null;
  };
  cost: { spend: number; cpv: number | null; cpe: number | null; cpp: number | null; primary: string } | null;
};

/** 단가 칸의 이름과 뜻. 무엇으로 계산한 값인지 이름에 드러나야 한다. */
const COST_LABEL: Record<string, { label: string; hint: string }> = {
  cpv: { label: 'CPV(조회수당)', hint: '집계된 게시물의 지급액 ÷ 그 게시물 조회수' },
  cpe: { label: 'CPE(반응당)', hint: '조회수를 받지 못해 좋아요·댓글 한 건당 비용으로 대체' },
  cpp: { label: '게시물당 비용', hint: '조회수·반응을 받지 못해 게시물 한 건당 비용으로 대체' },
};

const shortDate = (raw: string) => {
  const d = String(raw || '').slice(5, 10);
  return d ? d.replace('-', '/') : '';
};

const relTime = (iso: string | null) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '방금';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
};

/** 왜 이 게시물이 비어 있는지 한 마디로. 사람이 다음에 할 일을 알 수 있게 적는다. */
const REASON: Record<string, string> = {
  unlinked: '채널 연동 필요',
  not_found: '게시물 확인 필요',
  error: '수집 오류',
  channel_cache: '채널 자료 기준',
};

const CampaignInsightPanel: React.FC<CampaignInsightPanelProps> = ({
  budgetKrw,
  uploadedCount,
  totalCollabs,
  viewer = 'brand',
  campaignId,
  token,
}) => {
  const isCreator = viewer === 'influencer';
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(!!campaignId);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    const res = await apiService.getCampaignMetrics(campaignId, { token });
    if (res?.error) {
      setError(res.error);
      setData(null);
    } else {
      setError('');
      setData(res as Metrics);
    }
    setLoading(false);
  }, [campaignId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    if (!campaignId || refreshing) return;
    setRefreshing(true);
    const res = await apiService.refreshCampaignMetrics(campaignId, { token });
    if (res?.error) setError(res.error);
    else {
      setError('');
      setData(res as Metrics);
    }
    setRefreshing(false);
  };

  const totals = data?.totals;
  const posts = data?.posts || [];
  // 서버가 센 업로드 수가 있으면 그것을 쓴다. 호출부가 넘긴 값은 화면이 이미 알고
  // 있는 대략치라, 취소된 협업까지 포함될 수 있다.
  const uploaded = totals ? totals.uploadedCount : uploadedCount;
  const collabs = totals ? totals.collabCount : totalCollabs;
  const measured = totals?.measuredCount || 0;

  /** 반응율 — 조회수 대비 좋아요+댓글. 조회수가 없으면 만들지 않는다. */
  const engagementRate = useMemo(() => {
    if (!totals || !totals.views || !totals.engagements) return null;
    return Math.round((totals.engagements / totals.views) * 1000) / 10;
  }, [totals]);

  const cost = data?.cost;
  const costKind = cost && cost.primary !== 'none' ? cost.primary : '';
  const costValue = costKind === 'cpv' ? cost!.cpv : costKind === 'cpe' ? cost!.cpe : cost?.cpp ?? null;

  /** 값이 있는 칸은 숫자를, 없는 칸은 이유를 보여 준다. */
  const tile = (
    label: string,
    value: number | null,
    unit: string,
    hint: string,
    emptyNote: string,
  ) => (
    <div key={label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <p className="text-[10px] font-black text-slate-400">{label}</p>
      {value === null ? (
        <>
          <p className="text-lg font-black text-slate-300 mt-1.5">
            —<span className="text-[11px] font-bold ml-0.5">{unit}</span>
          </p>
          <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">
            {emptyNote}
          </span>
        </>
      ) : (
        <>
          <p className="text-lg font-black text-slate-900 mt-1.5" title={formatNumberWithCommas(value)}>
            {formatCountKo(value)}
            <span className="text-[11px] font-bold text-slate-400 ml-0.5">{unit}</span>
          </p>
          <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black">
            게시물 {measured}건 집계
          </span>
        </>
      )}
      <p className="text-[10px] text-slate-400 font-medium mt-2 leading-tight">{hint}</p>
    </div>
  );

  const emptyNote = uploaded === 0 ? '업로드 전' : loading ? '수집 중' : '집계 전';

  const headline = (() => {
    if (uploaded === 0) {
      return collabs > 0
        ? '아직 업로드가 확인된 게시물이 없습니다. 업로드가 끝나면 이곳에 성과가 쌓입니다.'
        : '인플루언서가 확정되고 업로드가 끝나면 이곳에 성과가 쌓입니다.';
    }
    if (measured === 0) {
      return isCreator
        ? '업로드한 게시물의 성과를 받아오려면 캠페인용 인스타그램 계정 연동이 필요합니다.'
        : `업로드된 게시물 ${uploaded}건 중 아직 집계된 게시물이 없습니다. 인플루언서가 채널을 연동하면 조회수·좋아요·댓글이 채워집니다.`;
    }
    if (measured < uploaded) {
      return `업로드된 게시물 ${uploaded}건 중 ${measured}건이 집계됐습니다. 아래 목록에서 나머지 게시물의 사유를 확인할 수 있습니다.`;
    }
    return `업로드된 게시물 ${uploaded}건 전부 집계됐습니다.${
      totals?.viewsAvailable ? '' : ' 조회수는 인사이트 권한이 없어 비어 있고, 단가는 반응 기준으로 계산했습니다.'
    }`;
  })();

  const allMeasured = measured > 0 && measured === uploaded;

  return (
    <div className="space-y-4">
      <div
        className={`border rounded-2xl p-5 flex items-start justify-between gap-4 ${
          allMeasured ? 'bg-slate-50 border-slate-200' : 'bg-blue-50 border-blue-100'
        }`}
      >
        <div className="min-w-0">
          <p className={`text-sm font-black ${allMeasured ? 'text-slate-800' : 'text-blue-800'}`}>
            {measured > 0 ? '게시물 성과' : '업로드 이후에 성과가 집계됩니다'}
          </p>
          <p
            className={`text-[11px] font-medium mt-1 leading-relaxed ${
              allMeasured ? 'text-slate-500' : 'text-blue-600'
            }`}
          >
            {headline}
          </p>
          {totals?.collectedAt && (
            <p className="text-[10px] font-bold text-slate-400 mt-1.5">
              마지막 수집 {relTime(totals.collectedAt)}
            </p>
          )}
        </div>
        {campaignId && (
          <button
            onClick={refresh}
            disabled={refreshing || loading}
            className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-black text-slate-600 hover:border-slate-300 disabled:opacity-50 flex-shrink-0"
          >
            {refreshing ? '수집 중…' : '지금 수집'}
          </button>
        )}
      </div>

      {error && (
        <p className="text-[11px] font-bold text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tile(
          isCreator ? '조회수' : '전체 조회수',
          totals?.views ?? null,
          '회',
          isCreator ? '내 게시물의 조회수' : '집계된 게시물의 조회수 합',
          totals && measured > 0 && !totals.viewsAvailable ? '조회수 권한 없음' : emptyNote,
        )}
        {tile(
          '좋아요',
          totals?.likes ?? null,
          '개',
          '집계된 게시물의 좋아요 합',
          emptyNote,
        )}
        {tile(
          '댓글',
          totals?.comments ?? null,
          '개',
          '집계된 게시물의 댓글 합',
          emptyNote,
        )}
        {isCreator ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-[10px] font-black text-slate-400">반응율</p>
            <p className={`text-lg font-black mt-1.5 ${engagementRate === null ? 'text-slate-300' : 'text-slate-900'}`}>
              {engagementRate === null ? '—' : engagementRate}
              <span className="text-[11px] font-bold text-slate-400 ml-0.5">%</span>
            </p>
            <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">
              {engagementRate === null ? '조회수 필요' : '조회수 대비 반응'}
            </span>
            <p className="text-[10px] text-slate-400 font-medium mt-2 leading-tight">
              (좋아요 + 댓글) ÷ 조회수
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
            <p className="text-[10px] font-black text-slate-400">
              {costKind ? COST_LABEL[costKind].label : '단가'}
            </p>
            <p className={`text-lg font-black mt-1.5 ${costValue === null ? 'text-slate-300' : 'text-slate-900'}`}>
              {costValue === null ? '—' : formatNumberWithCommas(costValue)}
              <span className="text-[11px] font-bold text-slate-400 ml-0.5">원</span>
            </p>
            <span
              className={`inline-block mt-2 px-2 py-0.5 rounded-full text-[10px] font-black ${
                costKind === 'cpv'
                  ? 'bg-blue-50 text-blue-600'
                  : costKind
                    ? 'bg-amber-50 text-amber-600'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {costKind === 'cpv' ? '조회수 기준' : costKind ? '대체 지표' : emptyNote}
            </span>
            <p className="text-[10px] text-slate-400 font-medium mt-2 leading-tight">
              {costKind
                ? COST_LABEL[costKind].hint
                : '지급액과 성과가 모두 들어오면 계산됩니다'}
            </p>
          </div>
        )}
      </div>

      {/* 일자별 추이. 하루 한 번 저장한 값으로 그린다 — 인스타그램은 과거 날짜를 알려 주지 않는다. */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-slate-900">일자별 조회수 추이</p>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-[10px] font-black">
            {(data?.series?.length || 0) >= 2 ? `${data!.series.length}일` : '집계 중'}
          </span>
        </div>
        {(data?.series?.length || 0) >= 2 ? (
          <div className="mt-4 h-[180px] md:h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data!.series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                  dy={8}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  tickFormatter={(v: number) => formatCountKo(v)}
                  width={44}
                />
                <Tooltip
                  cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                  contentStyle={{
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                  labelFormatter={(label) => shortDate(String(label ?? ''))}
                  formatter={(value, name) => [
                    `${Number(value ?? 0).toLocaleString()}`,
                    name === 'views' ? '조회수' : name === 'likes' ? '좋아요' : '댓글',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="views"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={data!.series.length <= 14 ? { r: 3, strokeWidth: 2, stroke: '#ffffff' } : false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: '#ffffff' }}
                />
                <Line
                  type="monotone"
                  dataKey="likes"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 h-40 relative">
            <div className="absolute inset-0 flex flex-col justify-between">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="h-px w-full bg-slate-100" />
              ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <p className="text-[11px] text-slate-300 font-black text-center leading-relaxed">
                하루 한 번 저장한 값으로 그립니다. 이틀치가 모이면 추이가 나타납니다.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 게시물별 성과. 비어 있는 줄은 이유를 함께 적는다. */}
      {posts.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-black text-slate-900">게시물별 성과</p>
            <span className="text-[10px] font-bold text-slate-400">{posts.length}건</span>
          </div>
          <div className="space-y-2">
            {posts.map((p) => {
              const dead = p.source !== 'meta_api' && p.source !== 'channel_cache';
              return (
                <div
                  key={p.collabId}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 hover:border-slate-200 transition-all"
                >
                  <div className="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                    {p.thumbnailUrl ? (
                      <img src={p.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] font-black text-slate-900 truncate">@{p.creatorUsername}</p>
                      {(dead || p.source === 'channel_cache') && (
                        <span
                          className={`px-1.5 py-0.5 rounded-md text-[9px] font-black flex-shrink-0 ${
                            dead ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {REASON[p.source]}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-medium text-slate-400 truncate mt-0.5">
                      {dead ? p.note : p.postedAt ? `${String(p.postedAt).slice(0, 10)} 업로드` : '업로드일 미확인'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-right">
                    {[
                      { label: '조회', value: p.views },
                      { label: '좋아요', value: p.likes },
                      { label: '댓글', value: p.comments },
                    ].map((m) => (
                      <div key={m.label} className="w-12">
                        <p
                          className={`text-[11px] font-black ${m.value === null ? 'text-slate-300' : 'text-slate-900'}`}
                          title={m.value === null ? '' : formatNumberWithCommas(m.value)}
                        >
                          {m.value === null ? '—' : formatCountKo(m.value)}
                        </p>
                        <p className="text-[9px] font-bold text-slate-400">{m.label}</p>
                      </div>
                    ))}
                    {p.permalink && (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black hover:bg-slate-200"
                      >
                        보기
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        성과는 {isCreator ? '내' : '인플루언서'} 인스타그램 계정 연동으로 받아옵니다. 직접 적어 낸 수치는
        정산 근거로 쓰지 않기 때문에, 연동 전에는 위 칸이 비어 있습니다.
        {totals && totals.unlinkedCount > 0 &&
          ` 연동이 없어 집계되지 않은 게시물이 ${totals.unlinkedCount}건 있습니다.`}
        {totals && totals.cachedCount > 0 &&
          ` ${totals.cachedCount}건은 채널에 저장된 최근 게시물 기준이라 연동으로 받은 값보다 오래될 수 있습니다.`}
        {!isCreator && budgetKrw > 0 &&
          ` 이 캠페인의 집행 예산은 ${formatKoreanWon(budgetKrw)}이며, 단가는 집계된 게시물에 실제로 나간 지급액으로 계산합니다.`}
      </p>
    </div>
  );
};

export default CampaignInsightPanel;
