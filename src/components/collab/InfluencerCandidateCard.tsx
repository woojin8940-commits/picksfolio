import React, { useState } from 'react';
import { formatCountKo, formatNumberWithCommas } from '../../utils/formatters';
import { reelTrendOf, trendIsVolatile, trendTone } from '../../utils/reelTrend';

/**
 * 인플루언서 후보 카드.
 *
 * 리스트업 화면 세 곳(브랜드 명단 · 담당자 풀 · 담당자 명단)과 지원자 목록이 같은
 * 카드를 쓴다. 브랜드가 사람을 고를 때 보는 숫자가 화면마다 다르게 생기면, 고른
 * 근거를 나중에 맞춰 볼 수 없다.
 *
 * ── 그림을 크게 두는 이유 ──
 *
 * 예전에는 카드 하나를 한 줄로 접어 두고 썸네일을 42px 조각으로 오른쪽에 붙였다.
 * 한 화면에 여러 명을 담는 데는 좋았지만, 그 크기로는 어떤 영상인지 알아볼 수 없어
 * 그림을 실은 뜻이 사라졌다 — 브랜드는 결국 숫자만 보고 고르거나, 계정 하나하나를
 * 인스타그램에서 다시 열어 봐야 했다. 사람을 고르는 마지막 판단은 "이 계정 톤이
 * 우리 제품과 맞는가"이고, 그건 숫자가 아니라 그림이 답한다.
 *
 * 그래서 릴스 3편을 카드 폭을 셋으로 나눠 채운다. 세로 9:16 을 그대로 늘리면 카드
 * 하나가 화면을 다 먹으므로 4:5 로 잘라, 알아볼 수 있는 크기와 여러 명을 견주는
 * 스크롤 사이를 맞춘다.
 *
 *   겉(항상 보임): 인스타 아이디·출처 배지 · 최근 릴스 3편(크게) · 릴스 동향 배지 ·
 *                  담당자 추천 이유 · 팔로워 / 평균 조회수 / 광고비
 *   안(펼쳐야 보임): 릴스 동향 설명, 피드 그림, 소개, 나머지 단가, 링크,
 *                  그리고 부르는 쪽이 넘긴 details(연락처처럼 고른 뒤에 필요한 것)
 *
 * 고르는 동작(children)은 접지 않는다. 수락 버튼을 펼침 안에 두면 결정한 사람이
 * 버튼을 찾느라 한 번 더 눌러야 한다.
 *
 * ── 숫자 옆의 출처 표시 ──
 *
 * 팔로워·평균 조회수는 본인이 적은 값일 수도 있고 메타 API 로 받아온 값일 수도 있다.
 * 둘을 같은 굵기로 보여주면 브랜드는 어느 숫자도 믿지 않게 된다.
 *
 * ── 릴스 3편과 동향 ──
 *
 * 조회수 하나만 보면 터진 영상 한 개로 계정 전체를 잘못 판단한다. 그래서 최근 3편을
 * 편별 조회수와 함께 싣고, 최근 절반과 그 이전 절반을 비교한 동향을 배지로 붙인다.
 * 최고와 최저가 몇 배씩 벌어지는 계정은 평균 조회수를 그대로 믿을 수 없다는 뜻이라
 * 펼침 안에 그 경고를 적는다.
 *
 * 릴스·피드는 메타 API 로만 채워진다(recent_feed / recent_reels). 본인 입력 계정에는
 * 이 영역이 아예 나오지 않는다 — 빈 칸을 그려 두면 "활동을 안 하는 사람"으로 잘못
 * 읽히므로, 데이터가 없으면 자리를 접는다.
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

/** 정렬에 쓰는 값. 목록을 정렬하는 쪽과 카드가 같은 규칙으로 숫자를 꺼내야 한다. */
export const candidateSortValues = (raw: any) => {
  const m = metricsFrom(raw);
  return { followers: m.followers || 0, avgViews: m.avgViews || 0 };
};

/**
 * 릴스 칸 수. Tailwind 는 클래스 문자열을 빌드 시점에 훑으므로 `grid-cols-${n}` 조립은
 * 사라진다 — 표에서 꺼낸다.
 *
 * 연동한 지 얼마 안 된 계정은 릴스가 한두 편만 온다. 그때도 칸을 셋으로 나눠 두면
 * 그림 하나가 카드 구석의 조각으로 남아 무엇이 찍혔는지 알 수 없다. 대신 한 편일 때도
 * 폭을 다 주지는 않는다 — 4:5 그림 하나가 카드 높이를 다 먹으면 아래 숫자가 화면 밖으로
 * 밀린다.
 */
export const reelGridCols = (count: number) =>
  count <= 2 ? 'grid-cols-2' : 'grid-cols-3';

/** 지표 출처. 클래스 이름은 문자열 조립 없이 표에서 꺼내야 Tailwind 가 살려 둔다. */
const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  meta_api: { label: '메타 연동 확인', cls: 'bg-emerald-50 text-emerald-600' },
  self: { label: '본인 입력', cls: 'bg-amber-50 text-amber-600' },
  none: { label: '미등록', cls: 'bg-slate-100 text-slate-400' },
};

/**
 * 가로로 붙는 지표 칸.
 *
 * 값은 만 단위로 접어 짧게 적고(2.4만), 정확한 숫자는 title 로 단다. 후보를 나란히
 * 놓고 비교하는 자리라 자릿수보다 크기가 먼저 읽혀야 한다. 값에 색을 주는 이유도
 * 같다 — 카드를 훑을 때 눈이 먼저 닿는 곳이 팔로워·조회수여야 한다.
 *
 * 여기에는 자릿수가 정해진 숫자만 넣는다. 광고비처럼 길이를 알 수 없는 자유 문장은
 * 이 칸에 넣으면 잘리므로 아래 폭 전체 줄에 따로 적는다.
 */
const Stat: React.FC<{ label: string; value: string; title?: string; hint?: string }> = ({
  label,
  value,
  title,
  hint,
}) => (
  <div className="min-w-0">
    <p className="text-[10px] text-slate-400 font-black uppercase truncate">{label}</p>
    <p className="text-[17px] md:text-[19px] text-orange-500 font-black truncate" title={title}>
      {value}
    </p>
    {hint ? <p className="text-[10px] text-slate-400 font-medium truncate">{hint}</p> : null}
  </div>
);

interface InfluencerCandidateCardProps {
  /** 명단 행 또는 후보 풀 항목. 둘 다 그대로 넣을 수 있다. */
  data: any;
  /** 카드 오른쪽 위에 놓을 배지(선택 상태 · 제안 상태). */
  badges?: React.ReactNode;
  /** 카드 아래에 놓을 동작 영역. 접히지 않는다. */
  children?: React.ReactNode;
  /** 펼쳤을 때만 나오는 부가 정보(연락처·링크처럼 고른 뒤에 필요한 것). */
  details?: React.ReactNode;
  /** 담당자가 붙인 추천 이유. */
  note?: string;
  /** 처음부터 펼친 상태로 그린다. 후보가 한 명뿐인 화면에서 쓴다. */
  defaultExpanded?: boolean;
}

const InfluencerCandidateCard: React.FC<InfluencerCandidateCardProps> = ({
  data,
  badges,
  children,
  details,
  note,
  defaultExpanded,
}) => {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const m = metricsFrom(data);
  const source = SOURCE_BADGE[m.metricsSource || 'none'] || SOURCE_BADGE.none;
  const allReels = m.recentReels || [];
  const reels = allReels.slice(0, 3);
  const trend = reelTrendOf(allReels);
  const feed = (m.recentFeed || []).slice(0, 9);

  /**
   * 단가.
   *
   * 브랜드가 후보를 고를 때 마지막으로 보는 값이라 잘려서는 안 된다. 예전에는
   * 팔로워·조회수와 나란히 3분할 칸에 넣고 넘치면 말줄임(...)으로 잘랐는데,
   * 단가는 "게시물 30만원 / 숏폼 50만원" 같은 자유 문장이라 실제로는 대부분
   * 잘려 나갔다 — 값이 있는데 못 읽는 상태가 제일 나쁘다. 그래서 단가는 숫자 칸에서
   * 빼내 아래 한 줄(폭 전체)로 내리고, 항목마다 줄을 나눠 전부 적는다.
   *
   * 게시물·숏폼 단가가 따로 있으면 그것이 원본이고, 광고비(ad_price)는 그 둘을
   * 합쳐 만든 문장이므로 같이 적지 않는다(같은 값이 두 번 보인다). 둘 다 없을 때만
   * 광고비 문장을 '/' 로 갈라 줄별로 적는다.
   */
  const priceLines: Array<{ label: string; value: string }> =
    m.postPrice || m.shortPrice
      ? ([
          m.postPrice ? { label: '게시물', value: m.postPrice } : null,
          m.shortPrice ? { label: '숏폼', value: m.shortPrice } : null,
        ].filter(Boolean) as Array<{ label: string; value: string }>)
      : String(m.adPrice || '')
          .split('/')
          .map(part => part.trim())
          .filter(Boolean)
          .map(part => {
            // "게시물 30만원" 처럼 앞에 항목 이름이 붙어 오면 그대로 라벨로 쓴다.
            const matched = part.match(/^(게시물|숏폼|릴스|스토리|영상|광고)\s+(.+)$/);
            return matched
              ? { label: matched[1], value: matched[2] }
              : { label: '광고', value: part };
          });

  /**
   * 카드 맨 위 한 줄은 인스타 아이디다.
   *
   * 예전에는 등록 이름을 먼저 뒀는데, 브랜드가 이 사람을 다시 찾아보는 단서는
   * 이름이 아니라 계정이다("김하실"로는 아무 데서도 못 찾는다). 그래서 아이디를
   * 크게 올리고, 이름·카테고리는 그 아래 한 줄로 접는다. 리스트업처럼 서버가
   * 아이디를 지워 보내는 화면에서는 가려진 이름이 그 자리를 대신한다.
   */
  const handle = m.instagramHandle || m.username;
  const idLine = handle ? `@${handle}` : m.name || '비공개';
  const subLine = [
    m.name && handle ? m.name : '',
    m.instagramHandle && m.username && m.instagramHandle !== m.username
      ? `픽스폴리오 @${m.username}`
      : '',
    m.categories || '',
  ]
    .filter(Boolean)
    .join(' · ');

  // 펼침 안에 실을 것이 하나도 없으면 버튼을 만들지 않는다. 눌러도 아무 일이 없는
  // 버튼이 목록에 줄줄이 있으면 다른 카드의 펼침까지 안 눌러 보게 된다.
  // 추천 이유(note)는 겉에 두므로 여기서 세지 않는다.
  const hasMore = !!(
    feed.length > 0 ||
    trend ||
    m.intro ||
    m.instagramUrl ||
    details
  );

  /**
   * 릴스 썸네일 한 칸. 폭은 카드를 셋으로 나눈 칸이 정하고, 그림은 4:5 로 자른다.
   * 9:16 을 그대로 두면 카드 하나가 화면을 다 먹어 여러 명을 견줄 수 없고, 폭을
   * 고정한 조각으로 두면 무슨 영상인지 알아볼 수 없다.
   */
  const reelThumb = (r: any, i: number) => {
    const views = Number(r?.views || 0);
    const inner = (
      <>
        {r?.thumbnailUrl ? (
          <img
            src={r.thumbnailUrl}
            alt=""
            loading="lazy"
            className="w-full aspect-[4/5] object-cover rounded-lg bg-slate-100"
          />
        ) : (
          <div className="w-full aspect-[4/5] rounded-lg bg-slate-100 flex items-center justify-center">
            <span className="text-[10px] text-slate-400 font-bold">영상</span>
          </div>
        )}
        <p
          className="text-[11px] text-slate-500 font-bold mt-1 truncate text-center"
          title={views ? `조회 ${formatNumberWithCommas(views)}` : '조회수 비공개'}
        >
          {views ? `조회 ${formatCountKo(views)}` : '비공개'}
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
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-3 md:p-4 flex flex-col h-full">
      {/* 인스타 아이디 · 출처 · 상태 배지를 한 줄에 둔다. 목록에서 사람을 구분하는
          것은 이 줄 하나뿐이고, 그 구분자는 계정 아이디다. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* 프로필 사진은 받아 두지 않는다. 아이디 첫 글자로 자리를 채워 카드마다
              같은 위치에서 시선이 시작되게 한다. */}
          <div className="w-9 h-9 rounded-full bg-slate-100 flex-shrink-0 flex items-center justify-center text-[13px] font-black text-slate-300">
            {String(handle || m.name || '?')
              .replace('@', '')
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-black text-slate-900 truncate" title={idLine}>
                {idLine}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${source.cls}`}>
                {source.label}
              </span>
            </div>
            {subLine && (
              <p className="text-[11px] text-slate-400 font-bold truncate">{subLine}</p>
            )}
          </div>
        </div>
        {badges && (
          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">{badges}</div>
        )}
      </div>

      {/* 최근 릴스 3편. 카드 폭을 꽉 채운다 — 계정 톤은 숫자가 아니라 그림이 답한다. */}
      {reels.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[10px] text-slate-400 font-black uppercase">
              최근 릴스 {reels.length}편
            </p>
            {trend && trend.percent !== null && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-black ${trendTone(trend.percent).cls}`}
              >
                {trendTone(trend.percent).label} {trend.percent > 0 ? '+' : ''}
                {trend.percent}%
              </span>
            )}
          </div>
          <div className={`grid ${reelGridCols(reels.length)} gap-2`}>
            {reels.map((r: any, i: number) => reelThumb(r, i))}
          </div>
        </div>
      )}

      {/* 담당자 추천 이유는 그림 바로 아래 겉에 둔다. 왜 이 사람을 올렸는지가
          펼침 안에 숨어 있으면 브랜드는 그 이유를 못 보고 숫자만으로 거른다. */}
      {note && (
        <div className="mt-3 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          <p className="text-[10px] text-slate-400 font-black mb-0.5">추천 이유</p>
          <p className="text-[12px] text-slate-600 font-medium whitespace-pre-wrap leading-relaxed">
            {note}
          </p>
        </div>
      )}

      {/* 좋아요는 싣지 않는다. 브랜드가 후보를 고를 때 쓰는 숫자는 도달(조회수)과
          그 값을 사는 가격이고, 좋아요를 나란히 두면 릴스 조회수와 사진 반응이
          섞여 비교 기준이 흐려진다. 평균 좋아요·댓글은 인사이트 점수 계산에는
          그대로 쓰인다. */}
      <div className="bg-slate-50 rounded-lg px-3 py-2 mt-3">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="팔로워"
            value={m.followers ? formatCountKo(m.followers) : '—'}
            title={m.followers ? formatNumberWithCommas(m.followers) : ''}
          />
          <Stat
            label="평균 조회수"
            value={m.avgViews ? formatCountKo(m.avgViews) : '—'}
            title={m.avgViews ? formatNumberWithCommas(m.avgViews) : ''}
            hint={m.reelsCount ? `릴스 ${m.reelsCount}편 기준` : ''}
          />
        </div>

        {/* 광고비는 폭 전체를 쓴다. 자유 문장이라 길이를 정할 수 없으므로 자르지 않고
            줄을 늘린다 — 단가를 못 읽으면 브랜드는 이 카드에서 결정을 못 한다. */}
        <div className="mt-2 pt-2 border-t border-slate-200/70">
          <p className="text-[10px] text-slate-400 font-black uppercase">광고비</p>
          {priceLines.length > 0 ? (
            <div className="mt-0.5 space-y-0.5">
              {priceLines.map((p, i) => (
                <div key={`${p.label}-${i}`} className="flex items-baseline gap-1.5">
                  <span className="shrink-0 text-[10px] text-slate-400 font-black">{p.label}</span>
                  <span className="text-[15px] md:text-[17px] text-orange-500 font-black break-keep leading-snug">
                    {p.value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[15px] md:text-[17px] text-slate-300 font-black">미기재</p>
          )}
        </div>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-slate-600"
        >
          {expanded ? '접기' : '자세히 보기'}
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      {expanded && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-3">
          {/* 그림은 이미 겉에 크게 실었으므로 여기서는 숫자로 읽는 동향만 적는다. */}
          {reels.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-400 font-black uppercase mb-1">최근 릴스 동향</p>
              {trend ? (
                <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                  최근 {formatNumberWithCommas(trend.recent)}회
                  {trend.previous > 0 ? ` ← 이전 ${formatNumberWithCommas(trend.previous)}회` : ''}
                  {' · '}최고 {formatNumberWithCommas(trend.best)} / 최저{' '}
                  {formatNumberWithCommas(trend.worst)}
                  {trendIsVolatile(trend)
                    ? ' · 편차가 커서 평균보다 최저값을 기준으로 보는 편이 안전합니다'
                    : ''}
                </p>
              ) : (
                // 연동은 됐지만 조회수 권한을 못 받은 계정. "0회"로 적으면 안 본 영상이 된다.
                <p className="text-[11px] text-slate-500 font-medium">
                  조회수 비공개 계정으로 동향은 집계 전입니다
                </p>
              )}
            </div>
          )}

          {feed.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-400 font-black uppercase mb-1.5">
                최근 피드 {feed.length}개
              </p>
              {/* 한 줄에 아홉 칸으로 늘어놓으면 칸 하나가 손톱만 해져 무엇이 찍혔는지
                  알 수 없다. 세 칸(넓은 화면은 다섯 칸)으로 줄여 그림을 키운다. */}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {feed.map((f: any, i: number) => {
                  const isVideo = String(f?.mediaType || '').toUpperCase() === 'VIDEO';
                  const inner = f?.thumbnailUrl ? (
                    <div className="relative">
                      <img
                        src={f.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="w-full aspect-square object-cover rounded-lg bg-slate-100"
                      />
                      {isVideo && (
                        <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-white/80" />
                      )}
                    </div>
                  ) : (
                    // 메타의 미디어 URL 은 만료된다. 지난번에 받아 둔 주소가 죽었을 뿐이니
                    // 빈 칸을 회색 자리로 그려 "게시물이 없는 계정"과 구분한다.
                    <div className="w-full aspect-square rounded-lg bg-slate-100" />
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

          {m.intro && (
            <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap">{m.intro}</p>
          )}

          {m.instagramUrl && (
            <a
              href={m.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[11px] text-blue-600 font-bold hover:underline break-all"
            >
              {m.instagramUrl}
            </a>
          )}

          {details}
        </div>
      )}

      {/* 카드 높이는 한 줄에 놓인 옆 카드에 따라 달라진다. 고르는 버튼을 카드 아래에
          붙여 두지 않으면 두 카드의 버튼 높이가 어긋나 훑으면서 누르기 어렵다. */}
      {children && (
        <div className="mt-auto">
          <div className="mt-2.5 border-t border-slate-100 pt-2.5">{children}</div>
        </div>
      )}
    </div>
  );
};

export default InfluencerCandidateCard;
