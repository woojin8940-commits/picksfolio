import React from 'react';
import { formatNumberWithCommas } from '../../utils/formatters';
import { reelTrendOf, trendIsVolatile, trendTone } from '../../utils/reelTrend';

/**
 * 인플루언서 후보 카드.
 *
 * 리스트업 화면 세 곳(브랜드 명단 · 담당자 풀 · 담당자 명단)이 같은 카드를 쓴다.
 * 브랜드가 사람을 고를 때 보는 숫자가 화면마다 다르게 생기면, 고른 근거를 나중에
 * 맞춰 볼 수 없다.
 *
 * 이 카드의 핵심은 숫자 옆의 출처 표시다. 팔로워·평균 조회수는 본인이 적은 값일
 * 수도 있고 메타 API 로 받아온 값일 수도 있다. 둘을 같은 굵기로 보여주면 브랜드는
 * 어느 숫자도 믿지 않게 된다.
 *
 * ── 피드 분위기 · 릴스 동향 ──
 *
 * 브랜드가 후보를 고를 때 실제로 확인하고 싶은 것은 평균 숫자가 아니라 "이 계정 톤이
 * 우리 브랜드와 맞는가"다. 그래서 두 가지를 함께 싣는다.
 *
 *  1. 피드 9개 그리드 — 최근 게시물 정사각 썸네일 딱 9칸(3×3). 개수를 9로 못 박는
 *     이유는 분위기 판단에 그 정도면 충분하고, 더 늘리면 카드가 프로필 페이지처럼
 *     길어져 후보끼리 비교하기 어려워지기 때문이다. 스크롤 없이 한 눈에 3줄.
 *  2. 릴스 동향 — 조회수 하나만 보면 터진 영상 한 개로 계정 전체를 잘못 판단한다.
 *     그래서 최근 3편과 그 이전 3편의 평균을 비교해 올라가는 계정인지 내려가는
 *     계정인지 보여주고, 평균 대비 최고·최저를 같이 적는다. 최고와 최저가 몇 배씩
 *     벌어지는 계정은 평균 조회수를 그대로 믿을 수 없다는 뜻이다.
 *
 * 두 값 모두 메타 API 로만 채워진다(recent_feed / recent_reels). 그래서 본인 입력
 * 계정에서는 이 영역이 아예 나오지 않는다 — 빈 칸을 그려 두면 "활동을 안 하는
 * 사람"으로 잘못 읽히므로, 데이터가 없으면 영역을 접는다.
 *
 * 명단에 올리기 전(제안 수락 전)에는 서버가 permalink 와 캡션을 지우고 썸네일만
 * 내려보낸다(campaign-listup.mts 의 maskSnapshot). 그래서 썸네일에 링크가 없는
 * 경우가 정상이고, 카드는 링크 없이도 그림이 보이게 그린다.
 */

export type CandidateMetrics = {
  username: string;
  name?: string;
  instagramHandle?: string;
  instagramUrl?: string;
  followers?: number;
  avgViews?: number;
  avgLikes?: number;
  avgComments?: number;
  reelsCount?: number;
  metricsSource?: string;
  recentReels?: any[];
  recentFeed?: any[];
  syncedAt?: string;
  intro?: string;
  categories?: string;
  adPrice?: string;
  postPrice?: string;
  shortPrice?: string;
};

/** 명단 행(snapshot)과 후보 풀 항목을 같은 모양으로 맞춘다. */
export const metricsFrom = (raw: any): CandidateMetrics => {
  const snap = raw?.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : raw || {};
  return {
    username: String(raw?.influencerUsername || raw?.username || snap.username || ''),
    name: snap.name || raw?.name || '',
    instagramHandle: snap.instagramHandle || raw?.instagramHandle || '',
    instagramUrl: snap.instagramUrl || raw?.instagramUrl || '',
    followers: Number(snap.followers || raw?.followers || 0),
    avgViews: Number(snap.avgViews || raw?.avgViews || 0),
    avgLikes: Number(snap.avgLikes || raw?.avgLikes || 0),
    avgComments: Number(snap.avgComments || raw?.avgComments || 0),
    reelsCount: Number(snap.reelsCount || raw?.reelsCount || 0),
    metricsSource: snap.metricsSource || raw?.metricsSource || '',
    recentReels: Array.isArray(snap.recentReels)
      ? snap.recentReels
      : Array.isArray(raw?.recentReels)
        ? raw.recentReels
        : [],
    recentFeed: Array.isArray(snap.recentFeed)
      ? snap.recentFeed
      : Array.isArray(raw?.recentFeed)
        ? raw.recentFeed
        : [],
    syncedAt: snap.syncedAt || raw?.syncedAt || '',
    intro: snap.intro || raw?.intro || '',
    categories: snap.categories || raw?.categories || '',
    adPrice: snap.adPrice || raw?.adPrice || '',
    postPrice: snap.postPrice || raw?.postPrice || '',
    shortPrice: snap.shortPrice || raw?.shortPrice || '',
  };
};

/** 지표 출처. 클래스 이름은 문자열 조립 없이 표에서 꺼내야 Tailwind 가 살려 둔다. */
const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  meta_api: { label: '메타 연동 확인', cls: 'bg-emerald-50 text-emerald-600' },
  self: { label: '본인 입력', cls: 'bg-amber-50 text-amber-600' },
  none: { label: '미등록', cls: 'bg-slate-100 text-slate-400' },
};

const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="min-w-0">
    <p className="text-[9px] text-slate-400 font-black uppercase">{label}</p>
    <p className="text-sm text-slate-900 font-black truncate">{value}</p>
    {hint && <p className="text-[10px] text-slate-400 font-medium truncate">{hint}</p>}
  </div>
);

interface InfluencerCandidateCardProps {
  /** 명단 행 또는 후보 풀 항목. 둘 다 그대로 넣을 수 있다. */
  data: any;
  /** 카드 오른쪽 위에 놓을 배지(선택 상태 · 제안 상태). */
  badges?: React.ReactNode;
  /** 카드 아래에 놓을 동작 영역. */
  children?: React.ReactNode;
  /** 담당자가 붙인 추천 이유. */
  note?: string;
}

const InfluencerCandidateCard: React.FC<InfluencerCandidateCardProps> = ({
  data,
  badges,
  children,
  note,
}) => {
  const m = metricsFrom(data);
  const source = SOURCE_BADGE[m.metricsSource || 'none'] || SOURCE_BADGE.none;
  const allReels = m.recentReels || [];
  const reels = allReels.slice(0, 3);
  const trend = reelTrendOf(allReels);
  const feed = (m.recentFeed || []).slice(0, 9);
  const priceLine = [
    m.adPrice ? `광고 ${m.adPrice}` : '',
    m.shortPrice ? `숏폼 ${m.shortPrice}` : '',
    m.postPrice ? `게시물 ${m.postPrice}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-black text-slate-900 truncate">
              {m.name || `@${m.username}`}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${source.cls}`}>
              {source.label}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-bold truncate">
            @{m.username}
            {m.instagramHandle && m.instagramHandle !== m.username ? ` · 인스타 @${m.instagramHandle}` : ''}
            {m.categories ? ` · ${m.categories}` : ''}
          </p>
        </div>
        {badges && <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">{badges}</div>}
      </div>

      {/* 좋아요는 싣지 않는다. 브랜드가 후보를 고를 때 쓰는 숫자는 도달(조회수)이고,
          좋아요를 나란히 두면 릴스 조회수와 사진 반응이 섞여 비교 기준이 흐려진다.
          평균 좋아요·댓글은 인사이트 점수 계산에는 그대로 쓰인다. */}
      <div className="grid grid-cols-2 gap-2 bg-slate-50 rounded-lg px-3 py-2.5 mb-3">
        <Stat label="팔로워" value={m.followers ? formatNumberWithCommas(m.followers) : '—'} />
        <Stat
          label="평균 조회수"
          value={m.avgViews ? formatNumberWithCommas(m.avgViews) : '—'}
          hint={m.reelsCount ? `최근 릴스 ${m.reelsCount}개 기준` : ''}
        />
      </div>

      {reels.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[9px] text-slate-400 font-black uppercase">최근 릴스 동향</p>
            {trend && trend.percent !== null && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${trendTone(trend.percent).cls}`}>
                {trendTone(trend.percent).label} {trend.percent > 0 ? '+' : ''}
                {trend.percent}%
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {reels.map((r: any, i: number) => {
              const views = Number(r?.views || 0);
              const inner = (
                <>
                  {r?.thumbnailUrl ? (
                    <img
                      src={r.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="w-full aspect-[9/16] object-cover rounded-lg bg-slate-100"
                    />
                  ) : (
                    <div className="w-full aspect-[9/16] rounded-lg bg-slate-100 flex items-center justify-center">
                      <span className="text-[10px] text-slate-400 font-bold">영상</span>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 font-bold mt-1">
                    {views ? `조회 ${formatNumberWithCommas(views)}` : '조회수 비공개'}
                  </p>
                </>
              );
              return r?.permalink ? (
                <a
                  key={r.id || i}
                  href={r.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block hover:opacity-80"
                >
                  {inner}
                </a>
              ) : (
                <div key={r?.id || i}>{inner}</div>
              );
            })}
          </div>
          {trend ? (
            <p className="text-[10px] text-slate-400 font-medium mt-1.5 leading-relaxed">
              최근 {formatNumberWithCommas(trend.recent)}회
              {trend.previous > 0 ? ` ← 이전 ${formatNumberWithCommas(trend.previous)}회` : ''}
              {' · '}최고 {formatNumberWithCommas(trend.best)} / 최저 {formatNumberWithCommas(trend.worst)}
              {trendIsVolatile(trend)
                ? ' · 편차가 커서 평균보다 최저값을 기준으로 보는 편이 안전합니다'
                : ''}
            </p>
          ) : (
            // 연동은 됐지만 조회수 권한을 못 받은 계정. "0회"로 적으면 안 본 영상이 된다.
            <p className="text-[10px] text-slate-400 font-medium mt-1.5">조회수 비공개 계정으로 동향은 집계 전입니다</p>
          )}
        </div>
      )}

      {feed.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] text-slate-400 font-black uppercase mb-1.5">최근 피드 {feed.length}개</p>
          <div className="grid grid-cols-3 gap-1">
            {feed.map((f: any, i: number) => {
              const isVideo = String(f?.mediaType || '').toUpperCase() === 'VIDEO';
              const inner = f?.thumbnailUrl ? (
                <div className="relative">
                  <img
                    src={f.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="w-full aspect-square object-cover rounded-md bg-slate-100"
                  />
                  {isVideo && (
                    <span className="absolute bottom-1 right-1 text-[8px] font-black text-white bg-black/50 rounded px-1">
                      영상
                    </span>
                  )}
                </div>
              ) : (
                // 메타의 미디어 URL 은 만료된다. 지난번에 받아 둔 주소가 죽었을 뿐이니
                // 빈 칸을 회색 자리로 그려 "게시물이 없는 계정"과 구분한다.
                <div className="w-full aspect-square rounded-md bg-slate-100" />
              );
              return f?.permalink ? (
                <a
                  key={f.id || i}
                  href={f.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block hover:opacity-80"
                >
                  {inner}
                </a>
              ) : (
                <div key={f?.id || i}>{inner}</div>
              );
            })}
          </div>
        </div>
      )}

      {(m.intro || priceLine) && (
        <div className="mb-3 space-y-1">
          {m.intro && (
            <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap line-clamp-3">{m.intro}</p>
          )}
          {priceLine && <p className="text-[11px] text-slate-500 font-bold">{priceLine}</p>}
        </div>
      )}

      {m.instagramUrl && (
        <a
          href={m.instagramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-blue-600 font-bold hover:underline break-all"
        >
          {m.instagramUrl}
        </a>
      )}

      {note && (
        <div className="mt-3 bg-blue-50/70 border border-blue-100 rounded-lg px-3 py-2">
          <p className="text-[10px] text-blue-500 font-black mb-0.5">담당자 추천 이유</p>
          <p className="text-[11px] text-blue-700 font-medium whitespace-pre-wrap">{note}</p>
        </div>
      )}

      {children && <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>}
    </div>
  );
};

export default InfluencerCandidateCard;
