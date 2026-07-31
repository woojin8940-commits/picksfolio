import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import InfluencerCandidateCard from '../collab/InfluencerCandidateCard';

/**
 * 담당자 리스트업 콘솔 — 후보를 찾아 명단에 올리고, 골라진 후보에게 제안한다.
 *
 * 담당자가 이 화면에서 하는 일은 순서가 있다.
 *
 *   1. 캠페인을 고른다
 *   2. 후보 풀에서 어울리는 사람을 골라 명단에 올린다 (추천 이유를 함께)
 *   3. 브랜드가 "진행 요청"으로 표시한 후보에게 조건을 담아 제안을 보낸다
 *   4. 인플루언서가 답하면 그 자리에서 협업이 생긴다 — 전화로 받은 답은 대신 기록한다
 *
 * 3번의 조건 폼은 캠페인 브리프에서 미리 채워진다. 담당자가 같은 값을 다시 적게
 * 만들면 브리프와 제안이 조금씩 달라지고, 그 차이는 항상 나중에 문제가 된다.
 */

interface AdminCampaignListupProps {
  token: string;
}

const DECISION_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '브랜드 검토 중', cls: 'bg-slate-100 text-slate-500' },
  pick: { label: '브랜드 진행 요청', cls: 'bg-blue-50 text-blue-600' },
  pass: { label: '브랜드 넘김', cls: 'bg-slate-100 text-slate-400' },
};

const OUTREACH_BADGE: Record<string, { label: string; cls: string }> = {
  not_sent: { label: '제안 전', cls: 'bg-slate-100 text-slate-400' },
  sent: { label: '응답 대기', cls: 'bg-amber-50 text-amber-600' },
  accepted: { label: '수락 · 협업 생성', cls: 'bg-emerald-50 text-emerald-600' },
  declined: { label: '거절', cls: 'bg-red-50 text-red-500' },
  expired: { label: '기한 지남', cls: 'bg-slate-100 text-slate-400' },
};

const emptyOffer = {
  fee: '',
  secondUseFee: '',
  startDate: '',
  scriptDue: '',
  contentDue: '',
  uploadFrom: '',
  uploadTo: '',
  uploadChannel: '',
  contentFormat: '',
  videoConcept: '',
  guideUrl: '',
  guideNote: '',
  note: '',
  respondBy: '',
};

type OfferForm = typeof emptyOffer;

const asForm = (raw: any): OfferForm => ({
  fee: raw?.fee ? String(raw.fee) : '',
  secondUseFee: raw?.secondUseFee ? String(raw.secondUseFee) : '',
  startDate: raw?.startDate || '',
  scriptDue: raw?.scriptDue || '',
  contentDue: raw?.contentDue || '',
  uploadFrom: raw?.uploadFrom || '',
  uploadTo: raw?.uploadTo || '',
  uploadChannel: raw?.uploadChannel || '',
  contentFormat: raw?.contentFormat || '',
  videoConcept: raw?.videoConcept || '',
  guideUrl: raw?.guideUrl || '',
  guideNote: raw?.guideNote || '',
  note: raw?.note || '',
  respondBy: raw?.respondBy || '',
});

const AdminCampaignListup: React.FC<AdminCampaignListupProps> = ({ token }) => {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [pool, setPool] = useState<any[]>([]);
  const [offerDraft, setOfferDraft] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [addNote, setAddNote] = useState('');

  const [offerFor, setOfferFor] = useState('');
  const [offer, setOffer] = useState<OfferForm>(emptyOffer);
  const [noteFor, setNoteFor] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [responseNote, setResponseNote] = useState<Record<string, string>>({});

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    window.setTimeout(() => setMessage(null), 4000);
  };

  // 승인된 캠페인만 리스트업 대상으로 노출한다. 승인 전 후보를 먼저 만들면
  // 브랜드가 볼 수 없는 캠페인에 운영 작업이 쌓이므로 승인과 리스트업 순서를 고정한다.
  useEffect(() => {
    (async () => {
      const res = await apiService.getAdminCampaigns(token);
      const list = (res.campaigns || [])
        .filter((c: any) => c.status === 'active')
        .sort((a: any, b: any) => {
          const aAssigned = a.manager_username ? 1 : 0;
          const bAssigned = b.manager_username ? 1 : 0;
          if (aAssigned !== bAssigned) return aAssigned - bAssigned;
          return new Date(b.admin_approved_at || b.created_at).getTime()
            - new Date(a.admin_approved_at || a.created_at).getTime();
        });
      setCampaigns(list);
    })();
  }, [token]);

  const load = useCallback(
    async (id: string, q = '') => {
      if (!id) return;
      setLoading(true);
      const res = await apiService.getCampaignListup(id, { token, pool: true, q });
      setLoading(false);
      if (res.error) {
        notify(res.error, 'error');
        return;
      }
      setCandidates(res.candidates || []);
      setPool(res.pool || []);
      setOfferDraft(res.offerDraft || null);
    },
    [token],
  );

  useEffect(() => {
    if (campaignId) load(campaignId);
  }, [campaignId, load]);

  const selected = useMemo(
    () => campaigns.find((c) => c.id === campaignId) || null,
    [campaigns, campaignId],
  );

  const addCandidates = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    const res = await apiService.addListupCandidates(campaignId, picked, { token, note: addNote });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setPicked([]);
    setAddNote('');
    await load(campaignId, query);
    notify(`${res.added}명을 명단에 올렸습니다.${res.skipped ? ` (이미 있던 ${res.skipped}명 제외)` : ''}`);
  };

  const act = async (id: string, action: any, payload: Record<string, any> = {}) => {
    setBusy(true);
    const res = await apiService.listupAction(id, action, payload, token);
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return null;
    }
    await load(campaignId, query);
    return res;
  };

  const openOffer = (c: any) => {
    if (offerFor === c.id) {
      setOfferFor('');
      return;
    }
    setOfferFor(c.id);
    // 이미 보낸 제안이 있으면 그 값을, 없으면 캠페인 브리프에서 온 초안을 채운다.
    setOffer(asForm(c.offer?.fee ? c.offer : offerDraft));
  };

  const sendOffer = async (c: any) => {
    const res = await act(c.id, 'send_offer', { offer });
    if (!res) return;
    setOfferFor('');
    notify(`@${c.influencerUsername} 에게 제안을 보냈습니다.`);
  };

  const recordResponse = async (c: any, accept: boolean) => {
    const note = responseNote[c.id] || '';
    if (
      accept &&
      !window.confirm(
        `@${c.influencerUsername} 수락으로 처리하면 계약(협업)이 바로 생성됩니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }
    const res = await act(c.id, 'respond', { accept, note });
    if (!res) return;
    setResponseNote((p) => ({ ...p, [c.id]: '' }));
    notify(accept ? '수락으로 기록했습니다. 협업이 생성됐습니다.' : '거절로 기록했습니다.');
  };

  const field = (key: keyof OfferForm, label: string, type: 'text' | 'date' | 'number' = 'text') => (
    <div>
      <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">{label}</label>
      <input
        type={type}
        value={offer[key]}
        onChange={(e) => setOffer((p) => ({ ...p, [key]: e.target.value }))}
        className="w-full text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 캠페인 선택 */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900">리스트업</h3>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
                승인 캠페인 {campaigns.length}건
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              캠페인을 고르면 후보 풀에서 명단을 만들고, 브랜드가 고른 후보에게 조건을 담아 제안합니다.
            </p>
          </div>
          <select
            value={campaignId}
            onChange={(e) => {
              setCampaignId(e.target.value);
              setPicked([]);
              setOfferFor('');
              setQuery('');
            }}
            className="text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-blue-400 max-w-full"
          >
            <option value="">캠페인 선택...</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.brand_name || c.business_username}
                {c.manager_username ? ` (담당 @${c.manager_username})` : ' (담당자 없음)'}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div className="mt-3 bg-slate-50 rounded-xl px-4 py-3 flex flex-wrap gap-x-5 gap-y-1">
            <span className="text-[11px] text-slate-600 font-bold">
              보상 {selected.reward_amount ? formatKoreanWon(selected.reward_amount) : '미정'}
            </span>
            {selected.upload_channel && (
              <span className="text-[11px] text-slate-500 font-bold">채널 {selected.upload_channel}</span>
            )}
            {selected.content_format && (
              <span className="text-[11px] text-slate-500 font-bold">형식 {selected.content_format}</span>
            )}
            {selected.upload_from && (
              <span className="text-[11px] text-slate-500 font-bold">
                희망 게시 {selected.upload_from}
                {selected.upload_to ? ` ~ ${selected.upload_to}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {message && (
        <div
          className={`rounded-xl px-4 py-2.5 text-[11px] font-bold ${
            message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {!campaignId ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">
            {campaigns.length > 0 ? '승인된 캠페인을 먼저 선택해 주세요.' : '리스트업할 승인 캠페인이 없습니다.'}
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            {campaigns.length > 0
              ? '담당자가 없는 캠페인은 목록 위쪽에 표시됩니다.'
              : '먼저 캠페인 승인 탭에서 캠페인을 승인하고 담당자를 배정해 주세요.'}
          </p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* 후보 풀 */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-100">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h4 className="text-sm font-black text-slate-900">후보 풀 ({pool.length})</h4>
                {picked.length > 0 && (
                  <span className="text-[11px] text-blue-600 font-black">{picked.length}명 선택</span>
                )}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') load(campaignId, query);
                  }}
                  placeholder="계정 · 이름 · 카테고리 검색"
                  className="flex-1 text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
                />
                <button
                  onClick={() => load(campaignId, query)}
                  className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                >
                  검색
                </button>
              </div>
            </div>

            {picked.length > 0 && (
              <div className="px-4 py-3 bg-blue-50/70 border-b border-blue-100">
                <textarea
                  value={addNote}
                  onChange={(e) => setAddNote(e.target.value)}
                  rows={2}
                  placeholder="브랜드에게 보일 추천 이유 (예: 홈카페 리뷰 반응이 좋고 평균 조회수가 안정적입니다)"
                  className="w-full text-[11px] font-medium text-slate-700 border border-blue-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                />
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={addCandidates}
                    disabled={busy}
                    className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
                  >
                    {picked.length}명 명단에 올리기
                  </button>
                </div>
              </div>
            )}

            <div className="p-3 space-y-2.5 max-h-[720px] overflow-y-auto bg-slate-50/60">
              {pool.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-bold text-center py-8">
                  조건에 맞는 후보가 없습니다. 검색어를 바꿔 보세요.
                </p>
              ) : (
                pool.map((p) => {
                  const on = picked.includes(p.username);
                  return (
                    <InfluencerCandidateCard
                      key={p.username}
                      data={p}
                      badges={
                        <>
                          {p.isApplicant && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-50 text-blue-600">
                              이 캠페인 지원자
                            </span>
                          )}
                          <button
                            onClick={() =>
                              setPicked((prev) =>
                                on ? prev.filter((u) => u !== p.username) : [...prev, p.username],
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                              on
                                ? 'bg-slate-900 text-white hover:bg-slate-700'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {on ? '선택 해제' : '명단 후보'}
                          </button>
                        </>
                      }
                    />
                  );
                })
              )}
            </div>
          </div>

          {/* 명단 */}
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-100">
              <h4 className="text-sm font-black text-slate-900">명단 ({candidates.length})</h4>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                브랜드가 진행 요청한 후보에게만 제안을 보낼 수 있습니다.
              </p>
            </div>

            <div className="p-3 space-y-2.5 max-h-[720px] overflow-y-auto bg-slate-50/60">
              {candidates.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-bold text-center py-8">
                  아직 명단이 비어 있습니다. 왼쪽에서 후보를 골라 올려 주세요.
                </p>
              ) : (
                candidates.map((c) => {
                  const decision = DECISION_BADGE[c.brandDecision] || DECISION_BADGE.pending;
                  const outreach = OUTREACH_BADGE[c.outreachStatus] || OUTREACH_BADGE.not_sent;
                  const canSend = c.brandDecision === 'pick' && c.outreachStatus !== 'accepted';
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
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${outreach.cls}`}>
                            {outreach.label}
                          </span>
                        </>
                      }
                    >
                      {c.brandDecisionNote && (
                        <p className="text-[11px] text-slate-500 font-medium mb-2">
                          브랜드 메모: {c.brandDecisionNote}
                        </p>
                      )}

                      {c.outreachStatus === 'accepted' ? (
                        <p className="text-[11px] text-emerald-600 font-bold">
                          협업 생성 완료{c.collabId ? ` · ${c.collabId}` : ''} — 이후 진행은 협업 목록에서 봅니다.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => openOffer(c)}
                              disabled={!canSend}
                              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700 disabled:opacity-40"
                            >
                              {offerFor === c.id
                                ? '조건 접기'
                                : c.outreachStatus === 'sent'
                                  ? '조건 다시 보내기'
                                  : '일정·가이드·단가 제안'}
                            </button>
                            {c.outreachStatus === 'sent' && (
                              <button
                                onClick={() => act(c.id, 'withdraw_offer')}
                                disabled={busy}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
                              >
                                제안 회수
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setNoteFor(noteFor === c.id ? '' : c.id);
                                setNoteDraft(c.managerNote || '');
                              }}
                              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-50"
                            >
                              추천 이유
                            </button>
                            {!c.collabId && (
                              <button
                                onClick={() => act(c.id, 'remove')}
                                disabled={busy}
                                className="text-[10px] text-slate-400 font-bold hover:text-red-500 ml-auto"
                              >
                                명단에서 빼기
                              </button>
                            )}
                          </div>

                          {noteFor === c.id && (
                            <div>
                              <textarea
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                rows={2}
                                className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                              />
                              <div className="flex justify-end mt-1.5">
                                <button
                                  onClick={async () => {
                                    const res = await act(c.id, 'note', { managerNote: noteDraft });
                                    if (res) {
                                      setNoteFor('');
                                      notify('추천 이유를 저장했습니다.');
                                    }
                                  }}
                                  disabled={busy}
                                  className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-500 disabled:opacity-40"
                                >
                                  저장
                                </button>
                              </div>
                            </div>
                          )}

                          {offerFor === c.id && (
                            <div className="bg-white rounded-xl border border-slate-200 p-3">
                              <p className="text-[10px] text-slate-400 font-black uppercase mb-2">
                                제안 조건 — 인플루언서가 이 내용을 그대로 봅니다
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                {field('fee', '단가(원)')}
                                {field('secondUseFee', '2차 활용(원)')}
                                {field('startDate', '진행 시작일', 'date')}
                                {field('respondBy', '응답 기한', 'date')}
                                {field('scriptDue', '대본 마감', 'date')}
                                {field('contentDue', '영상 마감', 'date')}
                                {field('uploadFrom', '게시 시작', 'date')}
                                {field('uploadTo', '게시 종료', 'date')}
                                {field('uploadChannel', '업로드 채널')}
                                {field('contentFormat', '콘텐츠 형식')}
                              </div>
                              <div className="mt-2 space-y-2">
                                {field('guideUrl', '가이드라인 링크')}
                                <div>
                                  <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
                                    가이드 요약
                                  </label>
                                  <textarea
                                    value={offer.guideNote}
                                    onChange={(e) => setOffer((p) => ({ ...p, guideNote: e.target.value }))}
                                    rows={2}
                                    className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
                                    담당자 메시지
                                  </label>
                                  <textarea
                                    value={offer.note}
                                    onChange={(e) => setOffer((p) => ({ ...p, note: e.target.value }))}
                                    rows={2}
                                    placeholder="이 캠페인을 왜 제안하는지, 협의 가능한 부분은 무엇인지"
                                    className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end mt-2">
                                <button
                                  onClick={() => sendOffer(c)}
                                  disabled={busy}
                                  className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-500 disabled:opacity-40"
                                >
                                  제안 보내기
                                </button>
                              </div>
                            </div>
                          )}

                          {c.outreachStatus === 'sent' && (
                            <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-3">
                              <p className="text-[10px] text-amber-700 font-black mb-1.5">
                                답을 대신 기록 — 전화·디엠으로 받은 답도 여기에 남겨야 기록이 됩니다
                              </p>
                              <input
                                type="text"
                                value={responseNote[c.id] || ''}
                                onChange={(e) =>
                                  setResponseNote((p) => ({ ...p, [c.id]: e.target.value }))
                                }
                                placeholder="답변 요약 (예: 단가 조정 후 수락 / 일정이 겹쳐 거절)"
                                className="w-full text-[11px] font-medium text-slate-700 border border-amber-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
                              />
                              <div className="flex gap-1.5 justify-end mt-2">
                                <button
                                  onClick={() => recordResponse(c, false)}
                                  disabled={busy}
                                  className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-50 disabled:opacity-40"
                                >
                                  거절로 기록
                                </button>
                                <button
                                  onClick={() => recordResponse(c, true)}
                                  disabled={busy}
                                  className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-500 disabled:opacity-40"
                                >
                                  수락으로 기록
                                </button>
                              </div>
                            </div>
                          )}

                          {c.outreachStatus === 'accepted' && (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                              <p className="text-[11px] font-black text-emerald-700">협업이 생성되었습니다.</p>
                              <p className="mt-0.5 text-[10px] font-bold text-emerald-600/80">
                                선정 인플루언서 관리 탭에서 일정, 제출물, 브랜드 피드백과 정산을 이어서 관리하세요.
                              </p>
                            </div>
                          )}

                          {c.outreachStatus === 'declined' && c.responseNote && (
                            <p className="text-[11px] text-slate-500 font-medium">
                              거절 사유: {c.responseNote}
                            </p>
                          )}
                        </div>
                      )}
                    </InfluencerCandidateCard>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCampaignListup;
