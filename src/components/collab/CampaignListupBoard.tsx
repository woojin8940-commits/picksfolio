import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon, formatNumberWithCommas } from '../../utils/formatters';
import { reelTrendOf, trendIsVolatile, trendTone } from '../../utils/reelTrend';

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
const profileLine = (c: any) => String(c?.profileLine || c?.snapshot?.categories || '').trim();

const CampaignListupBoard: React.FC<CampaignListupBoardProps> = ({ campaignId, onNotify }) => {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [campaign, setCampaign] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    await load();
    notify(`${selected.size}명으로 확정했습니다. 담당자가 조건을 정리해 제안합니다.`);
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
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
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
          <div className="p-3 md:p-4 bg-slate-50/60 grid grid-cols-2 gap-3">
            {[...openList, ...runningList].map((c) => {
              const snap = c.snapshot || {};
              const allReels = Array.isArray(snap.recentReels) ? snap.recentReels : [];
              const reels = allReels.slice(0, 3);
              const trend = reelTrendOf(allReels);
              // 피드 9칸은 톤을 보는 자리다. 수락 전에는 서버가 permalink 를 지우므로
              // 그림만 오고, 그래도 판단에 필요한 것은 다 온다.
              const feed = (Array.isArray(snap.recentFeed) ? snap.recentFeed : []).slice(0, 9);
              const outreach = OUTREACH_BADGE[c.outreachStatus] || OUTREACH_BADGE.not_sent;
              const locked = c.outreachStatus === 'accepted';
              const inList = selected.has(c.id);
              const line = profileLine(c);

              return (
                <div
                  key={c.id}
                  className={`bg-white rounded-2xl border p-3 md:p-4 flex flex-col ${
                    inList ? 'border-orange-300 ring-1 ring-orange-100' : 'border-slate-100'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* 프로필 사진은 받아 두지 않는다. 이름 끝 글자로 자리를 채운다. */}
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex-shrink-0 flex items-center justify-center text-[13px] font-black text-slate-300">
                      {String(snap.name || '?').slice(-1)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-black text-slate-900 truncate">
                          {snap.name || '비공개'}
                        </span>
                        {c.badge && (
                          <span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 text-[10px] font-black">
                            {c.badge}
                          </span>
                        )}
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

                  {reels.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-[9px] text-slate-400 font-black">최근 릴스 동향</p>
                        {trend && trend.percent !== null && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-black ${trendTone(trend.percent).cls}`}
                          >
                            {trendTone(trend.percent).label} {trend.percent > 0 ? '+' : ''}
                            {trend.percent}%
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {reels.map((r: any, i: number) => (
                          <div key={r?.id || i}>
                            {r?.thumbnailUrl ? (
                              <img
                                src={r.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="w-full aspect-[9/16] object-cover rounded-lg bg-slate-100"
                              />
                            ) : (
                              <div className="w-full aspect-[9/16] rounded-lg bg-slate-100 flex items-center justify-center">
                                <span className="text-[10px] text-slate-300 font-bold">영상</span>
                              </div>
                            )}
                            {r?.views ? (
                              <p className="text-[10px] text-slate-400 font-bold mt-0.5 truncate">
                                조회 {formatNumberWithCommas(r.views)}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {trend ? (
                        <p className="text-[10px] text-slate-400 font-medium mt-1 leading-relaxed">
                          최근 {formatNumberWithCommas(trend.recent)}회
                          {trend.previous > 0 ? ` ← 이전 ${formatNumberWithCommas(trend.previous)}회` : ''}
                          {' · '}최고 {formatNumberWithCommas(trend.best)} / 최저{' '}
                          {formatNumberWithCommas(trend.worst)}
                          {trendIsVolatile(trend) ? ' · 편차가 큰 계정입니다' : ''}
                        </p>
                      ) : (
                        // 조회수 권한을 못 받은 계정. "0회"로 적으면 아무도 안 본 영상이 된다.
                        <p className="text-[10px] text-slate-400 font-medium mt-1">조회수 비공개 · 동향 집계 전</p>
                      )}
                    </div>
                  )}

                  {feed.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[9px] text-slate-400 font-black mb-1">최근 피드 {feed.length}개</p>
                      <div className="grid grid-cols-3 gap-1">
                        {feed.map((f: any, i: number) => (
                          <div key={f?.id || i} className="relative">
                            {f?.thumbnailUrl ? (
                              <img
                                src={f.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="w-full aspect-square object-cover rounded-md bg-slate-100"
                              />
                            ) : (
                              // 메타의 미디어 주소는 만료된다. 회색 자리로 남겨 두면
                              // "게시물이 없는 계정"과 구분된다.
                              <div className="w-full aspect-square rounded-md bg-slate-100" />
                            )}
                            {String(f?.mediaType || '').toUpperCase() === 'VIDEO' && (
                              <span className="absolute bottom-1 right-1 text-[8px] font-black text-white bg-black/50 rounded px-1">
                                영상
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {c.managerNote && (
                    <div className="mt-3 bg-slate-50 rounded-xl px-3 py-2">
                      <p className="text-[10px] text-slate-400 font-black mb-0.5">추천 이유</p>
                      <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap line-clamp-4">
                        {c.managerNote}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="min-w-0">
                      <p className="text-[9px] text-slate-400 font-black">팔로워</p>
                      <p className="text-[13px] text-slate-900 font-black truncate">
                        {snap.followers ? formatNumberWithCommas(snap.followers) : '—'}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] text-slate-400 font-black">보장 조회수</p>
                      <p className="text-[13px] text-slate-900 font-black truncate">
                        {c.guaranteedViews ? formatNumberWithCommas(c.guaranteedViews) : '—'}
                      </p>
                      {c.cpv > 0 && (
                        <p className="text-[10px] text-slate-400 font-bold">CPV {c.cpv}원</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] text-slate-400 font-black">광고비</p>
                      <p className="text-[13px] text-slate-900 font-black truncate">
                        {c.quotedFee ? formatKoreanWon(c.quotedFee) : '협의'}
                      </p>
                      {c.quotedSecondUseFee > 0 && (
                        <p className="text-[10px] text-slate-400 font-bold truncate">
                          2차 활용 {formatKoreanWon(c.quotedSecondUseFee)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100">
                    {locked ? (
                      <p className="text-[11px] text-emerald-600 font-bold text-center py-1.5">
                        협업이 시작됐습니다. 진행 상황은 아래 협업 현황에서 확인하실 수 있습니다.
                      </p>
                    ) : (
                      <button
                        onClick={() => toggleSelect(c.id)}
                        className={`w-full py-2.5 rounded-xl text-[12px] font-black transition-colors ${
                          inList
                            ? 'bg-white border border-orange-400 text-orange-500 hover:bg-orange-50'
                            : 'bg-orange-500 text-white hover:bg-orange-600'
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
              지금 몇 명 · 얼마인지가 계속 보여야 하기 때문이다. */}
          <div className="sticky bottom-0 bg-slate-900 text-white px-4 md:px-5 py-3">
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
