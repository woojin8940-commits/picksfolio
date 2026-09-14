import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';
import { digitsOnly, formatNumberWithCommas } from '../../utils/formatters';
import InfluencerCandidateCard from '../collab/InfluencerCandidateCard';

/**
 * 브랜드 선택 — 브랜드가 고른 인플루언서와, 담당자가 눌러야 할 버튼 하나.
 *
 * 브랜드의 선택은 캠페인 안쪽 명단에만 남는다. 그래서 담당자는 캠페인을 하나씩 열어
 * 봐야 "브랜드가 골랐는데 아직 아무 일도 일어나지 않은 사람"을 찾을 수 있었고, 그
 * 사이 브랜드 화면에는 며칠씩 아무 변화가 없었다. 선택은 기록이 아니라 답을 기다리는
 * 요청이므로 담당자 대시보드의 첫 화면이 이것이다.
 *
 * 여기서 하는 일은 둘이다 — 금액을 맞추고, 진행하기.
 *
 * 금액은 브랜드가 고른 다음에도 움직인다. 담당자가 전화로 협의하면서 "이 사람은
 * 조금 더" 가 되는 것이 보통이라, 그때마다 캠페인 명단으로 들어가 고치고 다시
 * 이 화면으로 돌아와 진행을 눌러야 했다. 진행하기가 있는 자리에서 그 금액을 고칠
 * 수 있어야 한다 — 협업이 만들어지는 순간 굳는 값이 바로 이 두 칸이다.
 *
 * 진행하기는 여러 명을 한 번에 누른다. 선택은 캠페인 단위로 내려오는데(브랜드가
 * 후보 다섯 명을 한꺼번에 고른다) 버튼이 카드마다 하나뿐이면 담당자는 확인창을
 * 다섯 번 지나야 했다. 캠페인 머리줄에서 고른 사람 전체를 한 번에 넘긴다.
 *
 * 제안서를 다듬어 보내는 일은 여전히 캠페인 안의 명단에서 한다. 이 화면에 제안
 * 폼까지 얹으면 "빨리 진행"과 "조건 협의" 가 한 칸에 섞여 둘 다 반쯤 하게 된다.
 */

interface ManagerBrandPicksPanelProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
  /** 캠페인 안 명단으로 보내기. 조건을 손봐야 하는 건은 그쪽에서 처리한다. */
  onOpenCampaign?: (campaignId: string) => void;
}

const OUTREACH_BADGE: Record<string, { label: string; cls: string }> = {
  not_sent: { label: '제안 전', cls: 'bg-slate-100 text-slate-400' },
  sent: { label: '응답 대기', cls: 'bg-amber-50 text-amber-600' },
  declined: { label: '거절', cls: 'bg-red-50 text-red-500' },
  expired: { label: '기한 지남', cls: 'bg-slate-100 text-slate-400' },
};

const ManagerBrandPicksPanel: React.FC<ManagerBrandPicksPanelProps> = ({
  onNotify,
  onOpenCampaign,
}) => {
  const [picks, setPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  /**
   * 목록 범위. 예전에는 "내 캠페인만" 버튼 하나였는데, 캠페인이 많아지면 끈 상태는
   * 남의 캠페인까지 섞인 벽이 되고 켠 상태에서는 주인 없는 캠페인의 선택 — 아무도
   * 답하지 않는 요청 — 이 보이지 않는다. 담당자가 오가는 두 화면에 각각 자리를 준다.
   */
  const [scope, setScope] = useState<'mine' | 'unassigned' | 'all'>('all');
  const [query, setQuery] = useState('');
  /** 담당자가 직접 접거나 펼친 캠페인. 손대지 않은 캠페인은 기본값을 따른다. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  /**
   * 한 번에 진행할 후보. 캠페인이 섞이지 않게 id 만 담고, 버튼은 캠페인 머리줄에서
   * 자기 그룹에 속한 id 만 골라 쓴다.
   */
  const [checked, setChecked] = useState<string[]>([]);
  /** 금액을 펼쳐 고치고 있는 후보 하나. 두 칸 모두 숫자만 담는다(쉼표는 화면에서만). */
  const [feeFor, setFeeFor] = useState('');
  const [feeDraft, setFeeDraft] = useState({ quotedFee: '', payoutFee: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getManagerCampaigns({ mine: scope === 'mine' });
    setLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setPicks(res.brandPicks || []);
  }, [scope, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 캠페인별로 묶는다. 담당자가 연락을 돌릴 때의 단위가 캠페인이다.
   *
   * 순서는 내 담당 → 담당자 없음 → 나머지다. 선택이 여러 캠페인에 걸쳐 쌓이면
   * 화면 맨 위에 있어야 하는 것은 내가 답할 차례인 캠페인이고, 그다음이 아무도
   * 답하지 않는 캠페인이다.
   */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (pick: any) =>
      !q ||
      [
        pick.campaignTitle,
        pick.brandName,
        pick.businessUsername,
        pick.influencerUsername,
        pick.snapshot?.instagramHandle,
      ].some((v) => String(v || '').toLowerCase().includes(q));

    const map = new Map<string, { campaignId: string; title: string; brand: string; mine: boolean; unassigned: boolean; rows: any[] }>();
    for (const pick of picks) {
      if (scope === 'unassigned' && !pick.unassigned) continue;
      if (!matches(pick)) continue;
      const key = String(pick.campaignId || '');
      if (!map.has(key)) {
        map.set(key, {
          campaignId: key,
          title: pick.campaignTitle || '(제목 없음)',
          brand: pick.brandName || pick.businessUsername || '',
          mine: !!pick.mine,
          unassigned: !!pick.unassigned,
          rows: [],
        });
      }
      map.get(key)!.rows.push(pick);
    }
    const rank = (g: { mine: boolean; unassigned: boolean }) => (g.mine ? 0 : g.unassigned ? 1 : 2);
    return Array.from(map.values()).sort((a, b) => rank(a) - rank(b));
  }, [picks, scope, query]);

  const totalRows = useMemo(() => groups.reduce((sum, g) => sum + g.rows.length, 0), [groups]);

  /**
   * 캠페인 하나를 펼쳐 둘지. 후보 카드는 크므로, 캠페인이 셋을 넘으면 접은 채로
   * 시작한다 — 어느 캠페인에 몇 명이 걸려 있는지는 접힌 머리줄만으로 읽히고,
   * 카드가 필요한 것은 그중 지금 처리할 한 캠페인뿐이다.
   */
  const isOpen = (campaignId: string) =>
    toggled[campaignId] !== undefined ? toggled[campaignId] : groups.length <= 3;

  /**
   * 금액 고치기. 저장은 명단 화면과 같은 quote 액션을 쓴다 — 브랜드 제시가는 컬럼,
   * 지급 단가는 제안 초안으로 들어가는 그 처리 그대로다. 이미 제안을 보낸 건의
   * 지급 단가는 서버가 막고 warning 을 돌려주므로, 그 문장을 그대로 띄운다.
   */
  const openFeeEditor = (pick: any) => {
    setFeeFor(pick.id);
    setFeeDraft({
      quotedFee: String(pick.quotedFee || ''),
      payoutFee: String(pick.payoutFee || ''),
    });
  };

  const saveFee = async (pick: any) => {
    setBusyId(pick.id);
    const res = await apiService.listupAction(pick.id, 'quote', {
      quote: { fee: Number(feeDraft.quotedFee || 0), secondUseFee: Number(pick.quotedSecondUseFee || 0) },
      // 지급 단가는 아직 제안을 보내지 않은 건에서만 함께 보낸다. 보낸 건에 실어
      // 보내면 서버가 경고를 돌려주는데, 담당자가 고친 것도 없이 경고를 읽게 된다.
      ...(pick.outreachStatus === 'not_sent'
        ? {
            payout: {
              fee: Number(feeDraft.payoutFee || 0),
              secondUseFee: Number(pick.payoutSecondUseFee || 0),
            },
          }
        : {}),
    });
    setBusyId('');
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setFeeFor('');
    onNotify(res.warning || '금액을 저장했습니다.', res.warning ? 'error' : 'success');
    await load();
  };

  const startCollab = async (pick: any) => {
    if (
      !window.confirm(
        `@${pick.influencerUsername} 협업을 시작합니다. 브랜드와 인플루언서 진행사항에 바로 표시되고 되돌릴 수 없습니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }
    setBusyId(pick.id);
    const res = await apiService.listupAction(pick.id, 'start_collab', {});
    setBusyId('');
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    onNotify(
      res.alreadyAccepted
        ? '이미 진행 중인 협업입니다.'
        : `@${pick.influencerUsername} 협업을 시작했습니다. 양쪽 진행사항에 표시됩니다.`,
    );
    await load();
  };

  /**
   * 고른 후보를 순서대로 진행한다. 한 건이 막혀도(이미 수락된 건, 브랜드 선택이
   * 풀린 건) 나머지는 넘긴다 — 다섯 명 중 하나 때문에 전부 멈추면 담당자는 어디까지
   * 됐는지 모른 채 다시 눌러야 한다. 끝에 된 수와 막힌 사유를 함께 알린다.
   */
  const startCollabBatch = async (rows: any[]) => {
    const targets = rows.filter((r) => checked.includes(r.id));
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `선택한 ${targets.length}명의 협업을 시작합니다.\n` +
          `${targets.map((r) => `@${r.influencerUsername}`).join(', ')}\n\n` +
          '브랜드와 인플루언서 진행사항에 바로 표시되고 되돌릴 수 없습니다. 계속하시겠습니까?',
      )
    ) {
      return;
    }
    setBusyId('batch');
    let done = 0;
    const failed: string[] = [];
    for (const pick of targets) {
      const res = await apiService.listupAction(pick.id, 'start_collab', {});
      if (res.error) failed.push(`@${pick.influencerUsername} ${res.error}`);
      else done += 1;
    }
    setBusyId('');
    setChecked((prev) => prev.filter((id) => !targets.some((t) => t.id === id)));
    if (done > 0) onNotify(`${done}명의 협업을 시작했습니다. 양쪽 진행사항에 표시됩니다.`);
    if (failed.length > 0) onNotify(failed.join(' / '), 'error');
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900">
            브랜드가 선택한 인플루언서 ({totalRows}
            {totalRows !== picks.length ? ` / ${picks.length}` : ''})
          </h3>
          <p className="text-[11px] text-slate-400 font-medium mt-0.5">
            브랜드가 진행을 요청한 사람들입니다. 금액은 이 자리에서 바로 고칠 수 있고, 여러 명을 골라
            한 번에 진행할 수 있습니다. 진행하기를 누르면 협업이 만들어지고 브랜드·인플루언서
            진행사항에 함께 표시됩니다.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {[
            { key: 'mine' as const, label: '내 담당' },
            { key: 'unassigned' as const, label: '담당자 없음' },
            { key: 'all' as const, label: '전체' },
          ].map(sc => (
            <button
              key={sc.key}
              onClick={() => setScope(sc.key)}
              className={`px-3 py-2 rounded-lg text-[10px] font-black ${
                scope === sc.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {sc.label}
            </button>
          ))}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-slate-100 text-slate-500 text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
          >
            새로고침
          </button>
        </div>
        </div>
        {/* 검색은 캠페인과 인플루언서 계정을 함께 본다. 담당자가 이 화면을 다시 여는
            이유는 대개 "그 사람 건이 어디 있었지"이고, 그때 기억하는 것은 계정이다. */}
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="캠페인 · 브랜드 · 인플루언서 계정 검색"
          className="mt-3 w-full text-[12px] font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">선택 내역을 불러오는 중...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">아직 브랜드가 고른 후보가 없습니다.</p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {query
              ? '검색어에 맞는 선택이 없습니다. 검색어를 지워 보세요.'
              : scope === 'mine'
                ? '내가 맡은 캠페인에는 선택이 없습니다. 전체로 바꿔 보세요.'
                : scope === 'unassigned'
                  ? '주인 없는 캠페인의 선택은 없습니다.'
                  : '캠페인에 명단을 올리면 브랜드가 이 자리에서 고릅니다.'}
          </p>
        </div>
      ) : (
        groups.map(group => (
          <div key={group.campaignId} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-100 flex items-start justify-between gap-2 flex-wrap">
              {/* 머리줄을 눌러 접고 펼친다. 캠페인이 많을 때 필요한 것은 카드가 아니라
                  "어느 캠페인에 몇 명이 걸려 있는지"다. */}
              <button
                onClick={() =>
                  setToggled(prev => ({ ...prev, [group.campaignId]: !isOpen(group.campaignId) }))
                }
                className="min-w-0 text-left flex items-center gap-2"
              >
                <span className="text-[10px] font-black text-slate-300 flex-shrink-0">
                  {isOpen(group.campaignId) ? '▾' : '▸'}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-slate-900 truncate">
                    {group.title}
                  </span>
                  <span className="block text-[11px] text-slate-400 font-bold truncate">
                    {group.brand} · 선택 {group.rows.length}명
                    {!isOpen(group.campaignId) ? ' · 눌러서 펼치기' : ''}
                  </span>
                </span>
              </button>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 담당자가 없는 캠페인의 선택은 아무도 답하지 않는다. 눈에 띄게 둔다. */}
                {group.unassigned ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-50 text-amber-600">
                    담당자 없음
                  </span>
                ) : group.mine ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-50 text-blue-600">
                    내 담당
                  </span>
                ) : null}
                {onOpenCampaign && (
                  <button
                    onClick={() => onOpenCampaign(group.campaignId)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200"
                  >
                    캠페인 열기
                  </button>
                )}
              </div>
            </div>

            {/* 한 번에 진행하기. 캠페인 머리줄 바로 아래에 둔다 — 고른 카드가
                화면 밖으로 밀려도 버튼과 선택 인원이 같은 자리에 남아 있어야 한다. */}
            {isOpen(group.campaignId) && (() => {
              const startable = group.rows.filter(r => r.outreachStatus !== 'accepted');
              const picked = startable.filter(r => checked.includes(r.id));
              if (startable.length === 0) return null;
              return (
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() =>
                      setChecked(prev =>
                        picked.length === startable.length
                          ? prev.filter(id => !startable.some(r => r.id === id))
                          : [...prev.filter(id => !startable.some(r => r.id === id)), ...startable.map(r => r.id)],
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-black hover:bg-slate-100"
                  >
                    {picked.length === startable.length ? '전체 해제' : `전체 선택 (${startable.length})`}
                  </button>
                  <span className="text-[11px] font-black text-slate-400">
                    {picked.length > 0 ? `${picked.length}명 선택` : '진행할 후보를 고르세요'}
                  </span>
                  <button
                    onClick={() => startCollabBatch(group.rows)}
                    disabled={picked.length === 0 || busyId === 'batch'}
                    className="ml-auto px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                  >
                    {busyId === 'batch' ? '진행 중...' : `선택한 ${picked.length}명 진행하기`}
                  </button>
                </div>
              );
            })()}

            {isOpen(group.campaignId) && (
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch bg-slate-50/60">
              {group.rows.map(pick => {
                const outreach = OUTREACH_BADGE[pick.outreachStatus] || OUTREACH_BADGE.not_sent;
                return (
                  <InfluencerCandidateCard
                    key={pick.id}
                    data={pick}
                    note={pick.managerNote}
                    contentFormat={pick.contentFormat}
                    badges={
                      <>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-50 text-blue-600">
                          브랜드 선택
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${outreach.cls}`}>
                          {outreach.label}
                        </span>
                      </>
                    }
                  >
                    <div className="space-y-2">
                      {/* 금액 칸을 눌러 그 자리에서 고친다. 브랜드 제시가는 브랜드
                          화면에 찍히는 값이고, 지급 단가는 협업이 만들어질 때 계약
                          금액이 되는 값이다. 이미 제안을 보낸 건의 지급 단가는 서버가
                          막으므로 칸을 잠근다. */}
                      {feeFor === pick.id ? (
                        <div className="bg-white border border-blue-200 rounded-lg px-3 py-2.5 space-y-2">
                          <label className="block">
                            <span className="block text-[10px] font-black text-slate-400 mb-1">
                              브랜드 제시가 (원)
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatNumberWithCommas(feeDraft.quotedFee)}
                              onChange={e =>
                                setFeeDraft(prev => ({ ...prev, quotedFee: digitsOnly(e.target.value) }))
                              }
                              placeholder="비우면 협의"
                              className="w-full text-[12px] font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                            />
                          </label>
                          <label className="block">
                            <span className="block text-[10px] font-black text-slate-400 mb-1">
                              지급 단가 (원)
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatNumberWithCommas(feeDraft.payoutFee)}
                              onChange={e =>
                                setFeeDraft(prev => ({ ...prev, payoutFee: digitsOnly(e.target.value) }))
                              }
                              disabled={pick.outreachStatus !== 'not_sent'}
                              placeholder={
                                pick.registeredPayoutFee
                                  ? `등록 단가 ${formatNumberWithCommas(pick.registeredPayoutFee)}`
                                  : '비우면 등록 단가'
                              }
                              className="w-full text-[12px] font-bold text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
                            />
                            {pick.outreachStatus !== 'not_sent' && (
                              <span className="block text-[10px] font-bold text-slate-400 mt-1">
                                제안을 보낸 뒤에는 회수 후에 고칠 수 있습니다.
                              </span>
                            )}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => saveFee(pick)}
                              disabled={busyId === pick.id}
                              className="flex-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
                            >
                              {busyId === pick.id ? '저장 중...' : '금액 저장'}
                            </button>
                            <button
                              onClick={() => setFeeFor('')}
                              className="px-3 py-1.5 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-200"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-0.5">
                          <span className="text-[11px] text-slate-700 font-bold">
                            브랜드 제시가{' '}
                            {pick.quotedFee ? `${formatNumberWithCommas(pick.quotedFee)}원` : '협의'}
                          </span>
                          <span className="text-[11px] text-slate-500 font-bold">
                            지급 단가{' '}
                            {pick.payoutFee ? `${formatNumberWithCommas(pick.payoutFee)}원` : '미입력'}
                          </span>
                          <button
                            onClick={() => openFeeEditor(pick)}
                            className="ml-auto px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200"
                          >
                            금액 수정
                          </button>
                        </div>
                      )}

                      {pick.brandDecisionNote && (
                        <p className="text-[11px] text-slate-500 font-medium">
                          브랜드 메모: {pick.brandDecisionNote}
                        </p>
                      )}

                      {/* 지급 단가가 비어 있으면 캠페인 1인 단가가 그대로 계약 금액이
                          된다. 눌러도 되지만, 모르고 누르는 일은 없어야 한다. */}
                      {!pick.payoutFee && (
                        <p className="text-[11px] text-amber-600 font-bold">
                          지급 단가가 비어 있습니다. 캠페인 단가로 협업이 만들어집니다.
                        </p>
                      )}

                      <div className="flex items-center gap-1.5">
                        {/* 한 번에 진행할 후보 고르기. 이미 수락된 건은 고를 것이 없다. */}
                        {pick.outreachStatus !== 'accepted' && (
                          <button
                            onClick={() =>
                              setChecked(prev =>
                                prev.includes(pick.id)
                                  ? prev.filter(x => x !== pick.id)
                                  : [...prev, pick.id],
                              )
                            }
                            className={`px-2.5 py-2 rounded-lg text-[11px] font-black flex-shrink-0 ${
                              checked.includes(pick.id)
                                ? 'bg-slate-900 text-white hover:bg-slate-700'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {checked.includes(pick.id) ? '선택됨' : '선택'}
                          </button>
                        )}
                        <button
                          onClick={() => startCollab(pick)}
                          disabled={busyId === pick.id || busyId === 'batch'}
                          className="flex-1 px-3.5 py-2 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-500 disabled:opacity-40"
                        >
                          {busyId === pick.id ? '진행 중...' : '진행하기'}
                        </button>
                      </div>
                    </div>
                  </InfluencerCandidateCard>
                );
              })}
            </div>
            )}
          </div>
        ))
      )}
    </div>
  );
};

export default ManagerBrandPicksPanel;
