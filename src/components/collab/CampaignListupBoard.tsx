import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import InfluencerCandidateCard from './InfluencerCandidateCard';

/**
 * 브랜드가 보는 리스트업 — 담당자가 올린 후보 명단.
 *
 * 브랜드가 여기서 하는 일은 하나다. 고르거나 넘기는 것. 제안을 보내고 단가를
 * 조율하는 것은 담당자이고, 답하는 것은 인플루언서다. 그래서 이 화면에는 "제안
 * 보내기" 버튼이 없다 — 있으면 브랜드가 직접 접촉하게 되고, 그 순간 중간에서
 * 조율하는 사람이 사라진다.
 *
 * 대신 고른 뒤에 무엇이 일어나는지는 상태로 계속 보여준다. 브랜드가 고르고 나서
 * 아무 표시도 없으면 "우리가 고른 건 어디 갔나"를 담당자에게 다시 물어보게 된다.
 */

interface CampaignListupBoardProps {
  campaignId: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

const DECISION_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '검토 중', cls: 'bg-slate-100 text-slate-500' },
  pick: { label: '진행 요청', cls: 'bg-blue-50 text-blue-600' },
  pass: { label: '넘김', cls: 'bg-slate-100 text-slate-400' },
};

const OUTREACH_BADGE: Record<string, { label: string; cls: string }> = {
  not_sent: { label: '제안 전', cls: 'bg-slate-100 text-slate-400' },
  sent: { label: '제안 발송 · 응답 대기', cls: 'bg-amber-50 text-amber-600' },
  accepted: { label: '수락 · 협업 시작', cls: 'bg-emerald-50 text-emerald-600' },
  declined: { label: '거절', cls: 'bg-red-50 text-red-500' },
  expired: { label: '기한 지남', cls: 'bg-slate-100 text-slate-400' },
};

const CampaignListupBoard: React.FC<CampaignListupBoardProps> = ({ campaignId, onNotify }) => {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [noteFor, setNoteFor] = useState('');
  const [note, setNote] = useState('');

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
    setCandidates(res.candidates || []);
  }, [campaignId, notify]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const decide = async (id: string, decision: 'pick' | 'pass' | 'pending') => {
    setBusyId(id);
    const res = await apiService.listupAction(id, 'brand_decision', {
      decision,
      note: noteFor === id ? note : '',
    });
    setBusyId('');
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setNoteFor('');
    setNote('');
    await load();
    notify(
      decision === 'pick'
        ? '이 인플루언서로 진행 요청했습니다. 담당자가 조건을 정리해 제안합니다.'
        : decision === 'pass'
          ? '이 후보를 넘겼습니다.'
          : '선택을 되돌렸습니다.',
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">후보 명단을 불러오는 중...</p>
      </div>
    );
  }

  const picked = candidates.filter((c) => c.brandDecision === 'pick');
  const waiting = candidates.filter((c) => c.brandDecision === 'pending');
  const passed = candidates.filter((c) => c.brandDecision === 'pass');
  const running = candidates.filter((c) => c.outreachStatus === 'accepted');

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 md:px-5 py-4 border-b border-slate-100">
        <h3 className="text-base font-black text-slate-900">인플루언서 리스트업</h3>
        <p className="text-[11px] text-slate-400 font-medium mt-0.5">
          담당자가 캠페인에 맞는 인플루언서를 찾아 올린 명단입니다. 진행하고 싶은 사람을 골라 주시면
          담당자가 일정·가이드·단가를 들고 직접 제안합니다.
        </p>

        {candidates.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {[
              { label: '전체 후보', value: candidates.length },
              { label: '검토 중', value: waiting.length },
              { label: '진행 요청', value: picked.length },
              { label: '협업 시작', value: running.length },
            ].map((s) => (
              <div key={s.label} className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-[9px] text-slate-400 font-black uppercase">{s.label}</p>
                <p className="text-lg text-slate-900 font-black leading-tight">{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {candidates.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-400 font-bold">아직 올라온 후보가 없습니다.</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            담당자가 캠페인 내용을 확인하고 어울리는 인플루언서를 찾아 이 자리에 올립니다.
          </p>
        </div>
      ) : (
        <div className="p-4 md:p-5 bg-slate-50/60 space-y-3">
          {[...waiting, ...picked, ...passed].map((c) => {
            const decision = DECISION_BADGE[c.brandDecision] || DECISION_BADGE.pending;
            const outreach = OUTREACH_BADGE[c.outreachStatus] || OUTREACH_BADGE.not_sent;
            const locked = c.outreachStatus === 'accepted';
            return (
              <InfluencerCandidateCard
                key={c.id}
                data={c}
                note={c.managerNote}
                badges={
                  <>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${decision.cls}`}>
                      {decision.label}
                    </span>
                    {c.outreachStatus !== 'not_sent' && (
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${outreach.cls}`}>
                        {outreach.label}
                      </span>
                    )}
                  </>
                }
              >
                {/* 제안이 나간 뒤에는 브랜드가 볼 조건을 그대로 보여준다. 담당자가
                    조정한 금액을 브랜드가 모르면 정산 때 문제가 된다. */}
                {c.outreachStatus !== 'not_sent' && c.offer?.fee ? (
                  <div className="bg-slate-50 rounded-lg px-3 py-2 mb-2.5">
                    <p className="text-[9px] text-slate-400 font-black uppercase mb-1">제안한 조건</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span className="text-[11px] text-slate-700 font-bold">
                        단가 {formatKoreanWon(c.offer.fee)}
                      </span>
                      {c.offer.secondUseFee ? (
                        <span className="text-[11px] text-slate-500 font-bold">
                          2차 활용 {formatKoreanWon(c.offer.secondUseFee)}
                        </span>
                      ) : null}
                      {c.offer.uploadFrom && (
                        <span className="text-[11px] text-slate-500 font-bold">
                          게시 {c.offer.uploadFrom}
                          {c.offer.uploadTo ? ` ~ ${c.offer.uploadTo}` : ''}
                        </span>
                      )}
                    </div>
                    {c.responseNote && (
                      <p className="text-[11px] text-slate-500 font-medium mt-1.5">
                        인플루언서 답변: {c.responseNote}
                      </p>
                    )}
                  </div>
                ) : null}

                {locked ? (
                  <p className="text-[11px] text-emerald-600 font-bold">
                    계약이 시작됐습니다. 진행 상황은 아래 협업 현황에서 단계별로 확인하실 수 있습니다.
                  </p>
                ) : (
                  <>
                    {noteFor === c.id && (
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="담당자에게 전할 말 (예: 이 톤으로 가고 싶어요 / 단가는 이 선까지)"
                        className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400 mb-2"
                      />
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => decide(c.id, 'pick')}
                        disabled={busyId === c.id || c.brandDecision === 'pick'}
                        className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 disabled:opacity-40"
                      >
                        이 사람으로 진행
                      </button>
                      <button
                        onClick={() => decide(c.id, 'pass')}
                        disabled={busyId === c.id || c.brandDecision === 'pass'}
                        className="px-3.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[11px] font-black hover:bg-slate-200 disabled:opacity-40"
                      >
                        넘기기
                      </button>
                      <button
                        onClick={() => {
                          setNoteFor(noteFor === c.id ? '' : c.id);
                          setNote(c.brandDecisionNote || '');
                        }}
                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-[11px] font-black hover:bg-slate-50"
                      >
                        {noteFor === c.id ? '메모 접기' : '메모 남기기'}
                      </button>
                      {c.brandDecision !== 'pending' && (
                        <button
                          onClick={() => decide(c.id, 'pending')}
                          disabled={busyId === c.id}
                          className="text-[11px] text-slate-400 font-bold hover:text-slate-600 ml-auto"
                        >
                          되돌리기
                        </button>
                      )}
                    </div>
                    {c.brandDecisionNote && noteFor !== c.id && (
                      <p className="text-[11px] text-slate-500 font-medium mt-2">
                        남긴 메모: {c.brandDecisionNote}
                      </p>
                    )}
                  </>
                )}
              </InfluencerCandidateCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CampaignListupBoard;
