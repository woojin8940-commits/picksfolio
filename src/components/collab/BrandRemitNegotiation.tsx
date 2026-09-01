import React, { useState } from 'react';
import { apiService } from '../../services/apiService';
import type { BrandRemitSchedule } from '../../types';

/**
 * 한 회차의 "브랜드 → 픽스폴리오 입금일" 조율.
 *
 * 이 자리에는 원래 날짜가 하나 박혀 있었다 — "입금 예정 2026년 9월 30일". 그 날짜는
 * 브랜드와 약속한 날이 아니라 인플루언서 지급 예정일(업로드를 확인한 달의 익월 말일)을
 * 옮겨 적은 것이었다. 브랜드가 픽스폴리오에 보내는 날은 브랜드의 세금계산서 발행과
 * 내부 지급 규정(말일 마감 · 익월 10일 지급 등)에 달려 있어서 우리가 정할 수 없다.
 *
 * 그래서 정해 두지 않고 조율한다. 어느 쪽이든 날짜를 내고, 상대가 동의하면 그때
 * 확정된다. 자기 제안에 자기가 동의할 수는 없다 — 그건 조율이 아니라 통보이고,
 * 화면에 "확정"으로 남으면 상대는 합의한 적 없는 날짜를 지키라는 말을 듣는다.
 *
 * 실제 대화는 카카오톡·유선으로 오간다(브랜드와 담당자 사이에는 앱 안 타임라인을
 * 두지 않았다). 이 칸은 그 대화의 결론만 붙잡아 두는 자리다 — 통화가 끝난 뒤
 * "며칠이라고 했었지"를 서로 다시 묻지 않도록.
 */

interface BrandRemitNegotiationProps {
  /** 'biz/' 접두사가 붙어 넘어와도 된다. */
  businessUsername: string;
  /** 회차 키(YYYY-MM). 비어 있으면 조율할 수 없다 — 회차가 아직 정해지지 않았다. */
  roundKey: string;
  schedule: BrandRemitSchedule | null;
  /** 어느 쪽으로 말하는지. 담당자만 입금 확인을 할 수 있다. */
  viewer: 'brand' | 'manager';
  /** 저장 후 바뀐 상태. 목록을 다시 읽지 않고 그 줄만 갈아 끼운다. */
  onChanged: (schedule: BrandRemitSchedule | null) => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  /** 운영 콘솔에서 부를 때의 담당자 토큰. */
  token?: string;
}

/** 2026년 9월 25일. 송금하는 날짜라 숫자만으로는 잘못 읽기 쉽다. */
const korFullDate = (raw: string) => {
  const key = String(raw || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  return `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`;
};

const SIDE_LABEL: Record<string, string> = {
  brand: '브랜드',
  manager: '픽스폴리오 담당자',
};

const BrandRemitNegotiation: React.FC<BrandRemitNegotiationProps> = ({
  businessUsername,
  roundKey,
  schedule,
  viewer,
  onChanged,
  onNotify,
  token,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const agreed = schedule?.agreedDate || '';
  const proposed = schedule?.proposedDate || '';
  const proposedSide = schedule?.proposedSide || '';
  const received = schedule?.receivedAt || '';
  /** 상대가 낸 제안인가. 동의 버튼은 이때만 있다. */
  const theirProposal = !!proposed && !agreed && proposedSide !== viewer;
  const myProposal = !!proposed && !agreed && proposedSide === viewer;

  const send = async (
    action: 'propose' | 'agree' | 'reset' | 'receive' | 'unreceive',
    date?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    const res = await apiService.updateBrandSettlementRound({
      businessUsername,
      roundKey,
      action,
      side: viewer,
      date,
      note: action === 'propose' ? note : '',
      token,
    });
    setBusy(false);
    if (res.error) {
      onNotify?.(res.error, 'error');
      return;
    }
    onChanged(res.schedule ?? null);
    setOpen(false);
    setNote('');
    onNotify?.(
      action === 'propose'
        ? '입금일을 제안했습니다.'
        : action === 'agree'
          ? '입금일을 확정했습니다.'
          : action === 'receive'
            ? '입금을 확인했습니다.'
            : '입금일 조율을 다시 시작합니다.',
      'success',
    );
  };

  // 회차가 정해지지 않은 건들(담당자가 인플루언서 지급일을 아직 잡지 않음)은 조율
  // 대상이 아니다. 여기서 날짜를 정해도 어느 회차의 약속인지 붙일 곳이 없다.
  if (!roundKey) {
    return (
      <p className="text-[11px] text-slate-400 font-bold">
        회차가 정해지면 입금일을 조율합니다.
      </p>
    );
  }

  if (received) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-600">
          입금 확인
        </span>
        <span className="text-[11px] font-bold text-slate-500">
          {korFullDate(String(received).slice(0, 10)) || korFullDate(agreed)}
        </span>
        {viewer === 'manager' && (
          <button
            onClick={() => send('unreceive')}
            disabled={busy}
            className="text-[10px] font-black text-slate-400 hover:text-slate-600 disabled:opacity-40"
          >
            확인 취소
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {agreed ? (
          <>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-50 text-blue-600">
              입금일 확정
            </span>
            <span className="text-[11px] font-black text-slate-700">{korFullDate(agreed)}</span>
          </>
        ) : theirProposal ? (
          <>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-600">
              조율 중
            </span>
            <span className="text-[11px] font-bold text-slate-500">
              {SIDE_LABEL[proposedSide] || '상대'} 제안 {korFullDate(proposed)}
            </span>
          </>
        ) : myProposal ? (
          <>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-600">
              동의 대기
            </span>
            <span className="text-[11px] font-bold text-slate-500">
              {korFullDate(proposed)} 제안 · {viewer === 'brand' ? '담당자' : '브랜드'} 동의를 기다립니다
            </span>
          </>
        ) : (
          <>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-500">
              입금일 미정
            </span>
            <span className="text-[11px] font-bold text-slate-400">
              {viewer === 'brand' ? '담당자와 조율해 정합니다' : '브랜드와 조율해 정합니다'}
            </span>
          </>
        )}
      </div>

      {/* 제안에 붙은 사정은 날짜만큼 중요하다 — "세금계산서 발행 후", "익월 10일 규정". */}
      {!!schedule?.proposedNote && !agreed && (
        <p className="text-[11px] text-slate-500 font-medium bg-slate-50 rounded-lg px-2.5 py-1.5">
          {schedule.proposedNote}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {theirProposal && (
          <button
            onClick={() => send('agree')}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {korFullDate(proposed)}로 동의
          </button>
        )}
        {viewer === 'manager' && agreed && (
          <button
            onClick={() => send('receive')}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            입금 확인
          </button>
        )}
        <button
          onClick={() => {
            setOpen(v => !v);
            setDraft(proposed || agreed || '');
          }}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40"
        >
          {open ? '닫기' : agreed || proposed ? '다른 날짜 제안' : '입금일 제안'}
        </button>
        {(agreed || proposed) && !received && (
          <button
            onClick={() => send('reset')}
            disabled={busy}
            className="text-[10px] font-black text-slate-400 hover:text-slate-600 disabled:opacity-40"
          >
            조율 초기화
          </button>
        )}
      </div>

      {open && (
        <div className="bg-slate-50 rounded-xl p-3 space-y-2">
          <input
            type="date"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-400"
          />
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={300}
            placeholder="예: 세금계산서 발행 후 입금 / 내부 규정상 익월 10일 지급"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-400"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => send('propose', draft)}
              disabled={busy || !draft}
              className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
            >
              이 날짜로 제안
            </button>
            {/* 제안은 상대의 동의로만 확정된다. 여기서 바로 "확정" 버튼을 주면
                조율 없이 날짜가 박히고, 예전과 같은 상태로 돌아간다. */}
            <p className="text-[10px] text-slate-400 font-bold">
              {viewer === 'brand' ? '담당자' : '브랜드'}가 동의하면 확정됩니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandRemitNegotiation;
