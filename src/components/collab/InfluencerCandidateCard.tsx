import React from 'react';
import { formatNumberWithCommas } from '../../utils/formatters';

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
 * ── 아직 만들지 않은 것: 피드 분위기 · 릴스 동향 (메타 API 심사 통과 후) ──
 *
 * 브랜드가 후보를 고를 때 실제로 확인하고 싶은 것은 평균 숫자가 아니라 "이 계정 톤이
 * 우리 브랜드와 맞는가"다. 그래서 아래 두 가지를 이 카드에 붙일 예정이다.
 *
 *  1. 피드 9개 그리드 — 최근 게시물 정사각 썸네일 딱 9칸(3×3). 개수를 9로 못 박는
 *     이유는 분위기 판단에 그 정도면 충분하고, 더 늘리면 카드가 프로필 페이지처럼
 *     길어져 후보끼리 비교하기 어려워지기 때문이다. 스크롤 없이 한 눈에 3줄.
 *  2. 최근 릴스 동향 — 지금은 최근 릴스 3개의 조회수만 나열한다. 여기에 회차별
 *     조회수 추이(올라가는 계정인지 내려가는 계정인지)와 평균 대비 최고/최저를
 *     더한다. 조회수 하나만 보면 터진 영상 한 개로 계정 전체를 잘못 판단한다.
 *
 * 필요한 데이터 경로는 이미 깔려 있다: netlify/functions/_shared/instagram-metrics.mts
 * 가 릴스를 받아 creator_channels.recent_reels 에 저장하고, campaign-listup.mts 가
 * 명단 snapshot 으로 복사한다. 추가할 것은 (a) 릴스가 아닌 일반 피드 미디어 9개를
 * 함께 받아 recent_feed 로 저장하는 것, (b) 그 값을 snapshot 과 metricsFrom 에
 * 통과시키는 것뿐이다.
 *
 * 착수 조건: 메타 앱 심사(instagram_basic / instagram_manage_insights)가 끝나야
 * 한다. 심사 전 토큰으로는 본인 계정 외의 미디어를 읽을 수 없어, 화면을 먼저
 * 만들어 두면 대부분의 후보에게서 빈 칸만 보인다 — 데이터 없는 자리는 "이 사람은
 * 활동을 안 한다"로 잘못 읽힌다. 그래서 화면도 그때 함께 붙인다.
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
  const reels = (m.recentReels || []).slice(0, 3);
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

      <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-lg px-3 py-2.5 mb-3">
        <Stat label="팔로워" value={m.followers ? formatNumberWithCommas(m.followers) : '—'} />
        <Stat
          label="평균 조회수"
          value={m.avgViews ? formatNumberWithCommas(m.avgViews) : '—'}
          hint={m.reelsCount ? `최근 릴스 ${m.reelsCount}개 기준` : ''}
        />
        <Stat
          label="평균 좋아요"
          value={m.avgLikes ? formatNumberWithCommas(m.avgLikes) : '—'}
          hint={m.avgComments ? `댓글 ${formatNumberWithCommas(m.avgComments)}` : ''}
        />
      </div>

      {reels.length > 0 && (
        <div className="mb-3">
          <p className="text-[9px] text-slate-400 font-black uppercase mb-1.5">최근 릴스</p>
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
