import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiService } from '../../services/apiService';
import { formatCountKo, formatKoreanWon, formatNumberWithCommas } from '../../utils/formatters';
import { reelTrendOf, trendIsVolatile, trendTone } from '../../utils/reelTrend';
import { buildMediaStrip } from './InfluencerCandidateCard';

/**
 * 브랜드가 보는 리스트업 — 담당자가 올린 추천 조합.
 *
 * 브랜드가 여기서 하는 일은 하나다. 담을 사람을 고르고 확정하는 것. 제안을 보내고
 * 단가를 조율하는 것은 담당자이고, 답하는 것은 인플루언서다. 그래서 이 화면에는
 * "제안 보내기" 버튼이 없다 — 있으면 브랜드가 직접 접촉하게 되고, 그 순간 중간에서
 * 조율하는 사람이 사라진다.
 *
 * 카드에 이름이 별표로 나오는 것은 화면 장식이 아니다. 서버가 수락 전까지 계정
 * 이름·인스타 주소·릴스 링크를 아예 실어 보내지 않는다. 지표와 영상 미리보기는
 * 그대로 오므로 고르는 데 필요한 판단 재료는 줄지 않는다.
 *
 * 확정은 한 번에 한다. 한 명씩 눌러 확정하면 중간에 끊겼을 때 절반만 확정된 명단이
 * 남는데, 그 상태는 화면 어디에도 보이지 않는다. 그래서 고르는 동안에는 화면 안에서만
 * 담고, 맨 아래 버튼을 누를 때 캠페인 단위로 한 번에 보낸다.
 */

interface CampaignListupBoardProps {
  campaignId: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  /** 확정을 마쳤을 때. 부모가 진행사항 탭으로 옮겨 선택 결과를 바로 보여 준다. */
  onConfirmed?: () => void;
}

const OUTREACH_BADGE: Record<string, { label: string; cls: string }> = {
  not_sent: { label: '', cls: '' },
  sent: { label: '제안 발송 · 응답 대기', cls: 'bg-amber-50 text-amber-600' },
  accepted: { label: '수락 · 협업 시작', cls: 'bg-emerald-50 text-emerald-600' },
  declined: { label: '거절', cls: 'bg-red-50 text-red-500' },
  expired: { label: '기한 지남', cls: 'bg-slate-100 text-slate-400' },
};

/** 남은 시간을 56:55:12 처럼 시:분:초로. 하루를 넘겨도 시간으로 이어 센다. */
const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

/**
 * 카드에 찍는 한 줄 소개. 담당자가 캠페인에 맞춰 적어 둔 줄이 우선이고, 비워
 * 뒀으면 채널에 등록된 카테고리로 되돌아간다.
 */
/**
 * 이름 아래 한 줄.
 *
 * 담당자가 직접 적던 "한 줄 소개" 입력칸은 없앴다 — 인플루언서가 등록해 둔 카테고리를
 * 사람이 다시 옮겨 적는 칸이었고, 옮기는 과정에서 등록서와 다른 말이 카드에 남았다.
 * 예전에 적어 둔 값이 있는 후보는 그것을 그대로 쓰고, 나머지는 등록 카테고리를 쓴다.
 */
const profileLine = (c: any) => String(c?.profileLine || c?.snapshot?.categories || '').trim();

const CampaignListupBoard: React.FC<CampaignListupBoardProps> = ({ campaignId, onNotify, onConfirmed }) => {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [campaign, setCampaign] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /**
   * 펼쳐 둔 카드. 기본은 접힘이다.
   *
   * 이 화면의 일은 후보를 견주는 것이라, 카드 하나가 화면을 다 차지하면 두 번째
   * 후보를 보려고 스크롤한 순간 첫 번째 숫자가 기억에서 사라진다. 그래서 겉에는
   * 고를 때 쓰는 것만(릴스 3편 · 추천 이유 · 숫자) 두고, 최근 피드 9칸과 조회수 동향
   * 설명은 눌러서 펼치게 한다.
   */
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  // 사용자가 화면에서 담고 있는 중이면 새로고침이 그 선택을 덮지 않게 한다.
  const touched = useRef(false);

  const notify = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      if (onNotify) onNotify(message, type);
    },
    [onNotify],
  );

  const load = useCallback(async () => {
    const res = await apiService.getCampaignListup(campaignId);
    setLoading(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    const list = res.candidates || [];
    setCandidates(list);
    setCampaign(res.campaign || null);
    if (!touched.current) {
      setSelected(
        new Set(list.filter((c: any) => c.brandDecision === 'pick').map((c: any) => c.id)),
      );
    }
  }, [campaignId, notify]);

  useEffect(() => {
    setLoading(true);
    touched.current = false;
    load();
  }, [load]);

  // 남은 시간 표시. 기한이 없는 캠페인에서는 타이머를 돌리지 않는다.
  const due = campaign?.listupConfirmDue ? new Date(campaign.listupConfirmDue).getTime() : 0;
  useEffect(() => {
    if (!due) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [due]);

  const toggleSelect = (id: string) => {
    touched.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFavorite = async (c: any) => {
    setBusyId(c.id);
    const res = await apiService.listupAction(c.id, 'favorite', { favorite: !c.brandFavorite });
    setBusyId('');
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setCandidates((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, brandFavorite: !c.brandFavorite } : x)),
    );
  };

  const confirmSelection = async () => {
    if (!selected.size) {
      notify('담은 인플루언서가 없습니다.', 'error');
      return;
    }
    setConfirming(true);
    const res = await apiService.confirmListupSelection(campaignId, Array.from(selected));
    setConfirming(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    touched.current = false;
    const picked = selected.size;
    await load();
    notify(`${picked}명으로 확정했습니다. 진행사항에서 선택한 인플루언서를 확인할 수 있습니다.`);
    // 확정 결과가 어디로 갔는지 말로만 알리면 브랜드는 명단 화면에 그대로 남아
    // 같은 사람을 다시 담는다. 결과가 쌓이는 자리로 화면을 옮겨 준다.
    if (onConfirmed) onConfirmed();
  };

  const openList = useMemo(
    () => candidates.filter((c) => c.outreachStatus !== 'accepted'),
    [candidates],
  );
  const runningList = useMemo(
    () => candidates.filter((c) => c.outreachStatus === 'accepted'),
    [candidates],
  );

  const totalFee = useMemo(
    () =>
      candidates
        .filter((c) => selected.has(c.id))
        .reduce((sum, c) => sum + Number(c.quotedFee || 0), 0),
    [candidates, selected],
  );

  const remaining = due ? due - now : 0;
  const expired = due > 0 && remaining <= 0;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">추천 조합을 불러오는 중...</p>
      </div>
    );
  }

  return (
    /* overflow-hidden 을 두지 않는다 — 스크롤 컨테이너가 하나 생기면 아래 확정 바의
       sticky 가 죽어(제자리에 그대로 남아) 화면 아래 고정 요약 바에 덮여 잘렸다.
       확정 바가 직접 rounded-b-2xl 로 카드 모서리를 맞춘다. */
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
      <div className="px-4 md:px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-black text-slate-900">담당자 추천 인플루언서</h3>
        <p className="text-[11px] text-slate-400 font-medium mt-0.5">
          픽스폴리오 담당자가 캠페인에 맞는 인플루언서를 찾아 올린 조합입니다. 함께하고 싶은 분을
          리스트에 담아 주시면 담당자가 일정·가이드·단가를 들고 직접 제안합니다.
        </p>
      </div>

      {candidates.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-400 font-bold">아직 올라온 추천이 없습니다.</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            담당자가 캠페인 내용을 확인하고 어울리는 인플루언서를 찾아 이 자리에 올립니다.
          </p>
        </div>
      ) : (
        <>
          {/* 넓은 화면에서도 한 줄에 둘까지만 놓는다. 셋으로 쪼개면 카드 폭이 좁아져
              릴스 썸네일이 알아볼 수 없는 크기가 되는데, 브랜드가 사람을 고르는 마지막
              판단은 그림이 한다. 모바일은 한 줄에 하나 — 폭이 반으로 갈리면
              팔로워·조회수·광고비 세 칸이 서로 줄바꿈돼 어느 숫자도 안 읽힌다. */}
          <div className="p-3 md:p-4 bg-slate-50/60 grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
            {[...openList, ...runningList].map((c) => {
              const snap = c.snapshot || {};
              const allReels = Array.isArray(snap.recentReels) ? snap.recentReels : [];
              const trend = reelTrendOf(allReels);
              // 피드 9칸은 톤을 보는 자리다. 수락 전에는 서버가 permalink 를 지우므로
              // 그림만 오고, 그래도 판단에 필요한 것은 다 온다.
              const feed = (Array.isArray(snap.recentFeed) ? snap.recentFeed : []).slice(0, 9);
              // 릴스로 시작해 피드로 잇는 그림 세 칸. 지원자 카드와 같은 규칙을 쓴다.
              const media = buildMediaStrip(allReels, feed);
              const reelSlots = media.filter(slot => slot.isReel).length;
              const outreach = OUTREACH_BADGE[c.outreachStatus] || OUTREACH_BADGE.not_sent;
              const locked = c.outreachStatus === 'accepted';
              const inList = selected.has(c.id);
              const line = profileLine(c);
              const open = openCards.has(c.id);
              // 펼침 안에 실을 것이 없으면 버튼을 만들지 않는다. 눌러도 아무 일이
              // 없는 버튼이 카드마다 붙어 있으면 다른 카드의 펼침도 안 눌러 보게 된다.
              // 추천 이유는 겉에 두므로 여기서 세지 않는다.
              const hasMore = feed.length > 0 || !!trend;

              return (
                <div
                  key={c.id}
                  className={`bg-white rounded-2xl border p-3 md:p-4 flex flex-col ${
                    inList ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-100'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {snap.profileImage ? (
                      <img
                        src={snap.profileImage}
                        alt={`${snap.instagramHandle ? `@${snap.instagramHandle}` : '인플루언서'} 프로필`}
                        loading="lazy"
                        className="w-10 h-10 rounded-full object-cover bg-slate-100 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex-shrink-0 flex items-center justify-center text-[13px] font-black text-slate-300">
                        {String(snap.instagramHandle || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* 계정명이 카드의 첫 줄이다. 이 시장에서 사람을 부르는 이름은
                            실명이 아니라 인스타 계정명이고, 브랜드가 나중에 담당자와
                            "그 계정"을 이야기할 때 쓰는 말도 이것이다. 실명은 여기 두지
                            않는다 — 고르는 데 쓰이지 않고, 서버도 수락 전까지 가려서
                            보낸다(campaign-listup.mts 의 maskSnapshot). */}
                        <span className="text-sm font-black text-slate-900 truncate">
                          {snap.instagramHandle ? `@${snap.instagramHandle}` : '비공개'}
                        </span>
                      </div>
                      {line && (
                        <p className="text-[11px] text-slate-400 font-bold truncate mt-0.5">{line}</p>
                      )}
                      {outreach.label && (
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-black ${outreach.cls}`}
                        >
                          {outreach.label}
                        </span>
                      )}
                    </div>

                    {/* 찜하기는 확정과 다른 뜻이다. "나중에 다시 볼게요"를 담을 곳이
                        없으면 브랜드는 고민 중인 후보까지 리스트에 담게 된다. */}
                    <button
                      onClick={() => toggleFavorite(c)}
                      disabled={busyId === c.id}
                      title="찜하기"
                      aria-label="찜하기"
                      aria-pressed={!!c.brandFavorite}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-50 disabled:opacity-40"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className={`w-4 h-4 ${c.brandFavorite ? 'text-red-500' : 'text-slate-300'}`}
                        fill={c.brandFavorite ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21.2l7.7-7.8 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
                      </svg>
                    </button>
                  </div>

                  {/* 릴스 세 칸이 카드에서 가장 큰 자리를 차지한다.

                      예전에는 이 세 칸이 팔로워·평균 조회수·광고비를 담은 3분할 칸
                      안에 들어가 있었다. 그러면 세 칸 중 한 칸(카드 폭의 1/3)을 다시
                      셋으로 쪼개게 되어 릴스 한 편이 카드 폭의 1/9로 줄었고, 무엇을
                      찍는 계정인지 알아볼 수 없었다. 그림을 숫자 칸에서 꺼내 카드 폭을
                      그대로 쓰게 한다.

                      자리도 숫자보다 위로 올렸다. 브랜드가 사람을 고르는 마지막 판단은
                      그림이 하고, 숫자는 그 뒤에 "예산 안에 들어오는가"를 확인하는
                      값이다. 계정명이 카드 첫 줄에 있으므로 그림이 먼저 와도 후보를
                      구별하는 데 어려움은 없다.

                      칸 수는 항상 셋이다. 릴스가 한 편뿐인 계정에서 칸을 줄이면 그 한
                      칸이 카드 폭 절반을 먹어 옆 카드와 높이가 달라져 후보를 나란히
                      견줄 수 없다. 모자란 칸은 최근 피드로 채운다.

                      비율은 릴스 원본과 같은 9:16 이다. 4:5 로 자르면 릴스가 위아래에
                      얹은 자막이 잘려 나가는데, 이 영상이 무엇을 말하는 영상인지는 그
                      자막이 알려 준다. 카드는 그만큼 길어지지만, 한 줄에 둘까지만 놓는
                      화면에서 이 세 칸은 한 편당 200px 이 넘어 휴대폰으로 릴스를 보는
                      크기에 가깝다. */}
                  {media.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-[10px] text-slate-400 font-black">
                          {reelSlots > 0 ? `최근 릴스 ${reelSlots}편` : '최근 게시물'}
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
                      <div className="grid grid-cols-3 gap-1.5 md:gap-2">
                        {media.map(slot => (
                          <div
                            key={slot.id}
                            className="relative aspect-[9/16] rounded-xl overflow-hidden bg-slate-100"
                          >
                            {slot.thumbnailUrl ? (
                              <img
                                src={slot.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                            ) : (
                              // 메타의 미디어 주소는 만료된다. 회색 자리로 남겨 두면
                              // "게시물이 없는 계정"과 구분된다.
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] text-slate-300 font-bold">
                                  {slot.isVideo ? '영상' : '사진'}
                                </span>
                              </div>
                            )}
                            {/* 조회수는 그림 아래 줄이 아니라 그림 위에 얹는다. 아래로
                                빼면 그만큼 그림이 작아진다. 이 줄은 릴스에만 붙는다 —
                                피드 사진에는 조회수 지표가 아예 없어 같은 자리에
                                '비공개'라 적으면 값을 숨긴 계정으로 잘못 읽힌다. */}
                            {slot.isReel && (
                              <span
                                className="absolute bottom-1.5 left-1.5 right-1.5 px-1.5 py-1 rounded-lg bg-black/55 text-white text-[10px] md:text-[11px] font-black text-center truncate"
                                title={slot.views ? `조회 ${formatNumberWithCommas(slot.views)}` : '조회수 비공개'}
                              >
                                {slot.views ? `조회 ${formatCountKo(slot.views)}` : '조회수 비공개'}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 담당자가 왜 이 사람을 골랐는지는 그림 바로 아래 겉에 둔다. 펼침
                      안에 숨겨 두면 브랜드는 그 이유를 못 보고 숫자만으로 거른다. */}
                  {c.managerNote && (
                    <div className="mt-3 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                      <p className="text-[10px] text-slate-400 font-black mb-0.5">추천 이유</p>
                      <p className="text-[12px] text-slate-600 font-medium whitespace-pre-wrap leading-relaxed">
                        {c.managerNote}
                      </p>
                    </div>
                  )}

                  {/* 그림과 추천 이유 다음이 값 자리다. 팔로워·평균 조회수·광고비를 한
                      줄에 나란히 두고 값에 색을 줘, 카드를 훑는 눈이 세 숫자에서 멈추게
                      한다. 이 셋이면 "예산 안에 들어오는 규모인가"가 카드를 펼치지 않고
                      끝난다. */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-lg px-3 py-2 mt-3">
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 font-black">팔로워</p>
                      <p
                        className="text-[17px] md:text-[19px] text-blue-600 font-black truncate"
                        title={snap.followers ? formatNumberWithCommas(snap.followers) : ''}
                      >
                        {snap.followers ? formatCountKo(snap.followers) : '—'}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 font-black">평균 조회수</p>
                      <p
                        className="text-[17px] md:text-[19px] text-blue-600 font-black truncate"
                        title={snap.avgViews ? formatNumberWithCommas(snap.avgViews) : ''}
                      >
                        {snap.avgViews ? formatCountKo(snap.avgViews) : '—'}
                      </p>
                      {snap.reelsCount > 0 && (
                        <p className="text-[10px] text-slate-400 font-bold truncate">릴스 {snap.reelsCount}편 기준</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-slate-400 font-black">광고비</p>
                      {/* 값을 자르지 않는다. "1억2,000만원"처럼 자릿수가 커질수록 문자열이
                          길어지는데, 브랜드가 이 카드에서 마지막으로 확인하는 값이 이것이라
                          말줄임으로 끊기면 카드를 열어 봐야 알 수 있게 된다. */}
                      <p className="text-[16px] md:text-[18px] text-blue-600 font-black leading-snug break-keep">
                        {c.quotedFee ? formatKoreanWon(c.quotedFee) : '협의'}
                      </p>
                      {c.quotedSecondUseFee > 0 && (
                        <p className="text-[10px] text-slate-400 font-bold break-keep leading-snug">
                          2차 활용 {formatKoreanWon(c.quotedSecondUseFee)}
                        </p>
                      )}
                    </div>
                  </div>


                  {hasMore && (
                    <button
                      onClick={() =>
                        setOpenCards((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      aria-expanded={open}
                      className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-slate-400 hover:text-slate-600"
                    >
                      {open ? '접기' : '자세히 보기'}
                      <svg
                        className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  )}

                  {open && (
                    <div className="mt-2 space-y-3">
                      {allReels.length > 0 &&
                        (trend ? (
                          <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                            최근 {formatNumberWithCommas(trend.recent)}회
                            {trend.previous > 0 ? ` ← 이전 ${formatNumberWithCommas(trend.previous)}회` : ''}
                            {' · '}최고 {formatNumberWithCommas(trend.best)} / 최저{' '}
                            {formatNumberWithCommas(trend.worst)}
                            {trendIsVolatile(trend) ? ' · 편차가 큰 계정입니다' : ''}
                          </p>
                        ) : (
                          // 조회수 권한을 못 받은 계정. "0회"로 적으면 아무도 안 본 영상이 된다.
                          <p className="text-[11px] text-slate-500 font-medium">조회수 비공개 · 동향 집계 전</p>
                        ))}

                      {feed.length > 0 && (
                        <div>
                          <p className="text-[10px] text-slate-400 font-black mb-1.5">최근 피드 {feed.length}개</p>
                          {/* 아홉 칸을 한 줄에 늘어놓으면 칸 하나가 손톱만 해진다.
                              세 줄로 나눠 그림을 알아볼 수 있는 크기로 키운다. */}
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            {feed.map((f: any, i: number) => (
                              <div key={f?.id || i} className="relative">
                                {f?.thumbnailUrl ? (
                                  <img
                                    src={f.thumbnailUrl}
                                    alt=""
                                    loading="lazy"
                                    className="w-full aspect-square object-cover rounded-lg bg-slate-100"
                                  />
                                ) : (
                                  // 메타의 미디어 주소는 만료된다. 회색 자리로 남겨 두면
                                  // "게시물이 없는 계정"과 구분된다.
                                  <div className="w-full aspect-square rounded-lg bg-slate-100" />
                                )}
                                {String(f?.mediaType || '').toUpperCase() === 'VIDEO' && (
                                  <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-white/80" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 카드 높이가 서로 다르므로 담기 버튼은 아래에 붙여 둔다. 한 줄에
                      놓인 카드의 버튼 높이가 어긋나면 훑으면서 누르기 어렵다. */}
                  <div className="mt-auto pt-3 border-t border-slate-100">
                    {locked ? (
                      <p className="text-[11px] text-emerald-600 font-bold text-center py-1.5">
                        협업이 시작됐습니다. 진행 상황은 아래 협업 현황에서 확인하실 수 있습니다.
                      </p>
                    ) : (
                      <button
                        onClick={() => toggleSelect(c.id)}
                        className={`w-full py-2.5 rounded-xl text-[12px] font-black transition-colors ${
                          inList
                            ? 'bg-white border border-blue-400 text-blue-600 hover:bg-blue-50'
                            : 'bg-blue-600 text-white hover:bg-blue-500'
                        }`}
                      >
                        {inList ? '리스트에 담김' : '리스트에 담기'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 확정 바. 화면 아래에 붙여 두는 이유는 카드를 훑어 내려가는 동안에도
              지금 몇 명 · 얼마인지가 계속 보여야 하기 때문이다.
              bottom-0 이 아니라 한 칸 위에 붙인다 — 캠페인 상세 화면은 맨 아래에
              고정 요약 바(약 64px, 휴대폰에서는 그 아래 탭 바까지)를 깔고 있어서
              화면 밑에 그대로 붙이면 '총 금액'과 확정 버튼이 그 바에 덮여 잘린다. */}
          <div className="sticky bottom-[calc(136px+env(safe-area-inset-bottom,0px))] md:bottom-16 z-10 bg-slate-900 text-white px-4 md:px-5 py-3 rounded-b-2xl">
            {due > 0 && (
              <div className="flex items-center justify-between gap-3 pb-2.5 mb-2.5 border-b border-white/10">
                <p className="text-[11px] text-white/60 font-bold truncate">
                  {expired
                    ? '확정 기한이 지났습니다. 담당자에게 기한 연장을 요청해 주세요.'
                    : '제한 시간이 지나면 이 추천 조합은 사라져요 ⌛'}
                </p>
                <p className="text-[11px] font-black flex-shrink-0">
                  <span className="text-white/60 font-bold mr-1.5">캠페인 확정까지 남은 시간</span>
                  <span className={expired ? 'text-red-400' : 'text-white'}>
                    {formatRemaining(remaining)}
                  </span>
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-white/60 font-bold">
                  선택한 인플루언서{' '}
                  <span className="text-white font-black">{selected.size}명</span>
                </p>
                <p className="text-[11px] text-white/60 font-bold">
                  총 금액{' '}
                  <span className="text-white font-black">
                    {formatNumberWithCommas(totalFee)}원
                  </span>
                </p>
              </div>
              <button
                onClick={confirmSelection}
                disabled={confirming || selected.size === 0}
                className="flex-shrink-0 px-4 py-2.5 bg-white text-slate-900 rounded-xl text-[12px] font-black hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {confirming ? '확정하는 중...' : '인플루언서 모두 선택 완료'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CampaignListupBoard;
