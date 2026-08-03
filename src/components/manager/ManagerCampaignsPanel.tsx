import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import ListupWorkspace from '../collab/ListupWorkspace';
import CollabReviewRoom from '../collab/CollabReviewRoom';

/**
 * 브랜드 캠페인 — 목록에서 캠페인을 눌러 들어가 인플루언서를 배정한다.
 *
 * 목록은 담당자가 없는 캠페인을 위에 둔다. 아무도 맡지 않은 캠페인은 브랜드 쪽에서
 * 보면 아무 일도 일어나지 않는 것과 같으므로, 가장 먼저 눈에 띄어야 한다.
 *
 * 캠페인 하나를 열면 세 가지가 한 화면에 있다.
 *   1. 브리프 — 무엇을 원하는 캠페인인지
 *   2. 배정 — 후보를 명단에 올리고 브랜드가 고른 사람에게 제안
 *   3. 진행 중인 협업 — 인플루언서가 낸 대본·영상을 그 자리에서 확인
 *
 * 3번을 다른 화면으로 빼지 않는 이유는, 담당자가 "이 캠페인은 지금 어디까지 왔나"를
 * 물을 때 답이 두 화면에 나뉘어 있으면 안 되기 때문이다.
 */

interface ManagerCampaignsPanelProps {
  managerUsername: string;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const STAGE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '대기', cls: 'bg-slate-100 text-slate-400' },
  active: { label: '진행중', cls: 'bg-blue-50 text-blue-600' },
  submitted: { label: '검수 대기', cls: 'bg-amber-50 text-amber-600' },
  revision: { label: '수정중', cls: 'bg-orange-50 text-orange-600' },
  done: { label: '완료', cls: 'bg-emerald-50 text-emerald-600' },
  skipped: { label: '생략', cls: 'bg-slate-100 text-slate-400' },
};

const ManagerCampaignsPanel: React.FC<ManagerCampaignsPanelProps> = ({
  managerUsername,
  onNotify,
}) => {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDue, setConfirmDue] = useState('');

  const [collabs, setCollabs] = useState<any[]>([]);
  const [reviewTarget, setReviewTarget] = useState<{ collabId: string; target: 'script' | 'content' } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getManagerCampaigns({ mine: mineOnly });
    setLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setCampaigns(res.campaigns || []);
  }, [mineOnly, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  // 협업 목록은 캠페인을 열 때 한 번만 읽는다. 캠페인마다 부르면 목록 화면에서
  // 캠페인 수만큼 요청이 나간다.
  const loadCollabs = useCallback(async () => {
    const res = await apiService.getCollabs('manager');
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setCollabs(res.collabs || []);
  }, [onNotify]);

  const open = useMemo(() => campaigns.find((c) => c.id === openId) || null, [campaigns, openId]);

  const openCampaign = async (c: any) => {
    setOpenId(c.id);
    setConfirmDue(c.listupConfirmDue ? String(c.listupConfirmDue).slice(0, 10) : '');
    await loadCollabs();
  };

  const act = async (campaignId: string, action: any, payload: Record<string, any> = {}) => {
    setBusy(true);
    const res = await apiService.managerCampaignAction(campaignId, action, payload);
    setBusy(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return false;
    }
    // PATCH 응답은 항상 전체 목록이다. "내 캠페인만" 상태에서는 그대로 쓰면
    // 방금 켜 둔 필터가 풀려 버리므로 다시 읽는다.
    if (mineOnly) await load();
    else setCampaigns(res.campaigns || []);
    return true;
  };

  const publish = async () => {
    if (!open) return;
    // 날짜만 받고 그날 끝까지로 본다. 시각까지 물으면 담당자가 매번 임의의
    // 시간을 찍게 되고, 브랜드 화면의 남은 시간은 그만큼 들쭉날쭉해진다.
    const iso = confirmDue ? new Date(`${confirmDue}T23:59:59`).toISOString() : '';
    if (await act(open.id, 'publish_listup', { confirmDue: iso })) {
      onNotify(
        confirmDue
          ? `${confirmDue}까지로 확정 기한을 정했습니다. 브랜드 화면에 남은 시간이 표시됩니다.`
          : '명단을 브랜드에 넘겼습니다. 확정 기한은 정하지 않았습니다.',
      );
    }
  };

  const campaignCollabs = useMemo(
    () => (open ? collabs.filter((c) => c.campaignId === open.id) : []),
    [collabs, open],
  );

  if (reviewTarget) {
    return (
      <CollabReviewRoom
        collabId={reviewTarget.collabId}
        target={reviewTarget.target}
        onClose={() => setReviewTarget(null)}
        onChanged={loadCollabs}
      />
    );
  }

  // ── 캠페인 상세 ───────────────────────────────────────────────────────────
  if (open) {
    const mine = open.managerUsername === managerUsername;
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
          <button
            onClick={() => setOpenId('')}
            className="text-[11px] text-slate-400 font-black hover:text-slate-600 mb-2"
          >
            ← 캠페인 목록
          </button>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900">{open.title}</h3>
              <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                {open.brandName || open.businessUsername}
                {open.category ? ` · ${open.category}` : ''}
                {open.managerUsername ? ` · 담당 @${open.managerUsername}` : ' · 담당자 없음'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {mine ? (
                <button
                  onClick={async () => {
                    if (await act(open.id, 'release')) onNotify('담당에서 내려놓았습니다.');
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                >
                  담당 해제
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (await act(open.id, 'claim')) onNotify('이 캠페인을 맡았습니다.');
                  }}
                  disabled={busy}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
                >
                  내가 맡기
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 bg-slate-50 rounded-xl px-4 py-3 flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-[11px] text-slate-600 font-bold">
              1인 단가 {open.rewardAmount ? formatKoreanWon(open.rewardAmount) : '미정'}
            </span>
            {open.secondUseFee > 0 && (
              <span className="text-[11px] text-slate-500 font-bold">
                2차 활용 {formatKoreanWon(open.secondUseFee)}
              </span>
            )}
            {open.uploadChannel && (
              <span className="text-[11px] text-slate-500 font-bold">채널 {open.uploadChannel}</span>
            )}
            {open.contentFormat && (
              <span className="text-[11px] text-slate-500 font-bold">형식 {open.contentFormat}</span>
            )}
            {open.uploadFrom && (
              <span className="text-[11px] text-slate-500 font-bold">
                희망 게시 {open.uploadFrom}
                {open.uploadTo ? ` ~ ${open.uploadTo}` : ''}
              </span>
            )}
          </div>

          {open.description && (
            <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap mt-2.5">
              {open.description}
            </p>
          )}

          {/* 확정 기한. 브랜드 화면의 남은 시간이 이 값을 읽는다. 기한을 정하지
              않아도 명단은 이미 브랜드에게 보인다 — 여기서 정하는 것은 표시뿐이다. */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <label className="text-[10px] text-slate-400 font-black">브랜드 확정 기한</label>
            <input
              type="date"
              value={confirmDue}
              onChange={(e) => setConfirmDue(e.target.value)}
              className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={publish}
              disabled={busy}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
            >
              명단 넘기기
            </button>
            {open.listupConfirmDue && (
              <button
                onClick={async () => {
                  if (await act(open.id, 'clear_due')) {
                    setConfirmDue('');
                    onNotify('확정 기한을 없앴습니다.');
                  }
                }}
                disabled={busy}
                className="text-[10px] text-slate-400 font-bold hover:text-slate-600"
              >
                기한 없애기
              </button>
            )}
          </div>
        </div>

        <ListupWorkspace campaignId={open.id} onNotify={onNotify} />

        {/* 진행 중인 협업 — 인플루언서가 올린 가이드·대본·영상 확인 */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100">
            <h4 className="text-sm font-black text-slate-900">
              진행 중인 협업 ({campaignCollabs.length})
            </h4>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              인플루언서가 제출한 대본과 영상을 여기서 바로 검수합니다.
            </p>
          </div>
          <div className="p-3 space-y-2 bg-slate-50/60">
            {campaignCollabs.length === 0 ? (
              <p className="text-[11px] text-slate-400 font-bold text-center py-6">
                아직 시작된 협업이 없습니다. 제안을 수락하면 이 자리에 생깁니다.
              </p>
            ) : (
              campaignCollabs.map((c) => {
                const stage = STAGE_STATUS[c.currentStageStatus] || STAGE_STATUS.pending;
                return (
                  <div key={c.id} className="bg-white rounded-xl border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-slate-900 truncate">
                          @{c.creatorUsername}
                        </p>
                        <p className="text-[11px] text-slate-400 font-bold truncate">
                          {c.currentStageTitle || '단계 없음'}
                          {c.dueDate ? ` · 마감 ${c.dueDate}` : ''}
                          {c.progress !== undefined ? ` · ${c.progress}%` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${stage.cls}`}>
                          {stage.label}
                        </span>
                        {c.openFeedbackCount > 0 && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-red-50 text-red-500">
                            브랜드 의견 {c.openFeedbackCount}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
                      <button
                        onClick={() => setReviewTarget({ collabId: c.id, target: 'script' })}
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                      >
                        대본 확인
                      </button>
                      <button
                        onClick={() => setReviewTarget({ collabId: c.id, target: 'content' })}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
                      >
                        영상 확인
                      </button>
                      {c.uploadUrl && (
                        <a
                          href={c.uploadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-600 font-black hover:underline ml-auto"
                        >
                          게시물 보기
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── 캠페인 목록 ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-black text-slate-900">브랜드 캠페인</h3>
          <p className="text-[11px] text-slate-400 font-medium mt-0.5">
            캠페인을 눌러 들어가면 인플루언서를 배정할 수 있습니다. 담당자가 없는 캠페인이 위에 옵니다.
          </p>
        </div>
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={`px-3 py-2 rounded-lg text-[10px] font-black ${
            mineOnly ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
          }`}
        >
          내 캠페인만
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">캠페인을 불러오는 중...</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">진행할 캠페인이 없습니다.</p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {mineOnly
              ? '아직 맡은 캠페인이 없습니다. 전체 목록에서 하나 맡아 보세요.'
              : '운영자가 캠페인을 승인하면 이 자리에 올라옵니다.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {campaigns.map((c) => {
            const unassigned = !c.managerUsername;
            return (
              <button
                key={c.id}
                onClick={() => openCampaign(c)}
                className={`text-left bg-white rounded-2xl border p-4 hover:border-slate-300 transition-colors ${
                  unassigned ? 'border-amber-200' : 'border-slate-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{c.title}</p>
                    <p className="text-[11px] text-slate-400 font-bold truncate">
                      {c.brandName || c.businessUsername}
                      {c.category ? ` · ${c.category}` : ''}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-black flex-shrink-0 ${
                      unassigned
                        ? 'bg-amber-50 text-amber-600'
                        : c.managerUsername === managerUsername
                          ? 'bg-blue-50 text-blue-600'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {unassigned
                      ? '담당자 없음'
                      : c.managerUsername === managerUsername
                        ? '내 담당'
                        : `@${c.managerUsername}`}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 mt-3">
                  {[
                    { label: '명단', value: c.counts?.listed || 0 },
                    { label: '브랜드 선택', value: c.counts?.picked || 0 },
                    { label: '제안', value: c.counts?.sent || 0 },
                    { label: '협업', value: c.counts?.collabs || 0 },
                  ].map((s) => (
                    <div key={s.label} className="bg-slate-50 rounded-lg px-2 py-1.5">
                      <p className="text-[9px] text-slate-400 font-black">{s.label}</p>
                      <p className="text-[13px] text-slate-900 font-black leading-tight">{s.value}</p>
                    </div>
                  ))}
                </div>

                {c.counts?.applications > 0 && (
                  <p className="text-[10px] text-blue-600 font-black mt-2">
                    직접 지원 {c.counts.applications}명 — 명단에 먼저 올려 보세요.
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ManagerCampaignsPanel;
