import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { formatKoreanWon } from '../../utils/formatters';
import { contentFormatLabel } from '../../utils/campaignBrief';

/**
 * 인플루언서가 받은 리스트업 제안함.
 *
 * 지원해서 기다리는 것과, 담당자가 골라서 조건까지 들고 온 것은 다른 일이다.
 * 후자는 이미 브랜드가 "이 사람으로 하고 싶다"까지 정한 상태이므로, 여기서 필요한
 * 것은 조건을 보고 하겠다/못하겠다를 답하는 것 하나다.
 *
 * 그래서 화면에 조건을 전부 펼쳐 둔다. 접어 두고 "자세히"를 누르게 하면 단가만 보고
 * 수락하는 사람이 생기고, 마감일을 못 본 채로 계약이 시작된다.
 */

interface CreatorOfferInboxProps {
  userName: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  /** 받은 제안이 없을 때 아무것도 렌더하지 않는다 (캠페인 목록 위에 얹을 때). */
  hideWhenEmpty?: boolean;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  sent: { label: '답변 대기', cls: 'bg-amber-50 text-amber-600' },
  accepted: { label: '수락 · 협업 시작', cls: 'bg-emerald-50 text-emerald-600' },
  declined: { label: '거절함', cls: 'bg-slate-100 text-slate-400' },
  expired: { label: '기한 지남', cls: 'bg-slate-100 text-slate-400' },
};

const Row: React.FC<{ label: string; value?: string }> = ({ label, value }) =>
  value ? (
    <div className="min-w-0">
      <p className="text-[9px] text-slate-400 font-black uppercase">{label}</p>
      <p className="text-[12px] text-slate-800 font-bold truncate">{value}</p>
    </div>
  ) : null;

const CreatorOfferInbox: React.FC<CreatorOfferInboxProps> = ({ userName, onNotify, hideWhenEmpty }) => {
  const [offers, setOffers] = useState<any[]>([]);
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
    if (!userName) return;
    const res = await apiService.getMyListupOffers(userName);
    setLoading(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setOffers(res.offers || []);
  }, [userName, notify]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const respond = async (o: any, accept: boolean) => {
    if (
      accept &&
      !window.confirm(
        '수락하면 이 조건으로 광고 계약이 시작되고, 일정에 맞춰 대본과 영상을 올리게 됩니다. 진행하시겠습니까?',
      )
    ) {
      return;
    }
    setBusyId(o.id);
    const res = await apiService.listupAction(o.id, 'respond', {
      accept,
      note: noteFor === o.id ? note : '',
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
      accept
        ? '수락했습니다. 협업이 만들어졌으니 진행 상황에서 단계별로 확인해 주세요.'
        : '거절로 전달했습니다.',
    );
  };

  if (loading && offers.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
        <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">받은 제안을 불러오는 중...</p>
      </div>
    );
  }

  if (offers.length === 0 && hideWhenEmpty) return null;

  const waiting = offers.filter((o) => o.outreachStatus === 'sent');

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 md:px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-black text-slate-900">받은 광고 제안</h3>
          {waiting.length > 0 && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-amber-50 text-amber-600">
              답변 대기 {waiting.length}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400 font-medium mt-0.5">
          픽스폴리오 담당자가 브랜드와 조건을 정리해 보낸 제안입니다. 조건을 확인하고 진행 여부만
          알려주시면 됩니다.
        </p>
      </div>

      {offers.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-400 font-bold">아직 받은 제안이 없습니다.</p>
          <p className="text-[11px] text-slate-400 font-medium mt-1">
            인스타그램 계정을 등록해 두시면 브랜드 캠페인 후보 명단에 올라갈 확률이 높아집니다.
          </p>
        </div>
      ) : (
        <div className="p-4 md:p-5 bg-slate-50/60 space-y-3">
          {offers.map((o) => {
            const badge = STATUS_BADGE[o.outreachStatus] || STATUS_BADGE.sent;
            const offer = o.offer || {};
            const open = o.outreachStatus === 'sent';
            return (
              <div key={o.id} className="bg-white rounded-xl border border-slate-100 p-4">
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{o.campaignTitle}</p>
                    <p className="text-[11px] text-slate-400 font-bold truncate">
                      {o.brandName || '브랜드'}
                      {o.productName ? ` · ${o.productName}` : ''}
                      {o.managerUsername ? ` · 담당 @${o.managerUsername}` : ''}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black flex-shrink-0 ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>

                <div className="bg-slate-50 rounded-lg px-3 py-2.5 grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-3 mb-2.5">
                  <Row label="단가" value={offer.fee ? formatKoreanWon(offer.fee) : '협의'} />
                  <Row
                    label="2차 활용"
                    value={offer.secondUseFee ? formatKoreanWon(offer.secondUseFee) : ''}
                  />
                  <Row label="진행 시작" value={offer.startDate} />
                  <Row label="대본 마감" value={offer.scriptDue} />
                  <Row label="영상 마감" value={offer.contentDue} />
                  <Row
                    label="게시 기간"
                    value={
                      offer.uploadFrom
                        ? `${offer.uploadFrom}${offer.uploadTo ? ` ~ ${offer.uploadTo}` : ''}`
                        : ''
                    }
                  />
                  <Row label="채널" value={offer.uploadChannel} />
                  <Row label="형식" value={contentFormatLabel(offer.contentFormat)} />
                </div>

                {(offer.videoConcept || offer.guideNote || offer.note || offer.guideUrl) && (
                  <div className="space-y-1.5 mb-2.5">
                    {offer.videoConcept && (
                      <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap">
                        컨셉 · {offer.videoConcept}
                      </p>
                    )}
                    {offer.guideNote && (
                      <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap">
                        가이드 · {offer.guideNote}
                      </p>
                    )}
                    {offer.guideUrl && (
                      <a
                        href={offer.guideUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-600 font-bold hover:underline break-all block"
                      >
                        가이드라인 문서 열기
                      </a>
                    )}
                    {offer.note && (
                      <div className="bg-blue-50/70 border border-blue-100 rounded-lg px-3 py-2">
                        <p className="text-[10px] text-blue-500 font-black mb-0.5">담당자 메시지</p>
                        <p className="text-[11px] text-blue-700 font-medium whitespace-pre-wrap">
                          {offer.note}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {open ? (
                  <>
                    {offer.respondBy && (
                      <p className="text-[11px] text-amber-600 font-bold mb-2">
                        {offer.respondBy} 까지 답변 부탁드립니다.
                      </p>
                    )}
                    {noteFor === o.id && (
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        placeholder="담당자에게 전할 말 (예: 마감이 하루만 늦으면 가능합니다 / 단가는 이 선까지)"
                        className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400 mb-2"
                      />
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => respond(o, true)}
                        disabled={busyId === o.id}
                        className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-black hover:bg-slate-700 disabled:opacity-40"
                      >
                        이 조건으로 진행
                      </button>
                      <button
                        onClick={() => respond(o, false)}
                        disabled={busyId === o.id}
                        className="px-3.5 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[11px] font-black hover:bg-slate-200 disabled:opacity-40"
                      >
                        이번엔 어렵습니다
                      </button>
                      <button
                        onClick={() => {
                          setNoteFor(noteFor === o.id ? '' : o.id);
                          setNote('');
                        }}
                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-[11px] font-black hover:bg-slate-50"
                      >
                        {noteFor === o.id ? '메모 접기' : '조건 협의 메모'}
                      </button>
                    </div>
                  </>
                ) : o.outreachStatus === 'accepted' ? (
                  <p className="text-[11px] text-emerald-600 font-bold">
                    협업이 시작됐습니다. 대본·영상 제출은 아래 진행 화면에서 단계별로 하시면 됩니다.
                  </p>
                ) : (
                  o.responseNote && (
                    <p className="text-[11px] text-slate-500 font-medium">남긴 메모: {o.responseNote}</p>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CreatorOfferInbox;
