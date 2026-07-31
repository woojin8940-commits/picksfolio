import React, { useState, useMemo, useRef, useEffect } from 'react';
import { todayInSeoul } from '../../utils/formatters';

/**
 * 업로드 일정 달력.
 *
 * 예전에는 `<input type="date">` 두 칸이었다. 시작일을 고르고 달력을 닫고, 종료일 칸을
 * 다시 눌러 달력을 또 열고, 방금 고른 시작일이 언제였는지 기억해서 그 뒤 날짜를
 * 찾아야 했다. 브라우저마다 달력 모양도 달라서 "2주 뒤"를 고르는 데 손이 네 번 갔다.
 *
 * 그래서 달력 하나로 두 날짜를 잇는다. 시작일을 누르면 그 자리에서 마감일을 이어
 * 고르게 하고, 두 번째 클릭에서 닫는다. 고르는 동안 마우스를 올린 날짜까지 구간이
 * 미리 칠해지므로 며칠짜리 일정인지 세지 않아도 보인다.
 *
 * 시작일보다 앞선 날짜를 두 번째로 누르면 종료일로 받지 않고 시작일을 다시 잡는다 —
 * "잘못 골랐으니 다시"가 가장 흔한 다음 행동이다.
 */

interface DateRangeCalendarProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** 이 날짜보다 앞은 고를 수 없다. 기본은 오늘. */
  minDate?: string;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** 'YYYY-MM-DD' → '10월 4일 (금)'. 달력 밖에서는 요일까지 보여야 일정 감각이 온다. */
const humanize = (key: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const [y, m, d] = key.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${wd})`;
};

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

const DateRangeCalendar: React.FC<DateRangeCalendarProps> = ({ from, to, onChange, minDate }) => {
  const today = todayInSeoul();
  const floor = minDate || today;
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  // 보여 줄 달. 이미 고른 시작일이 있으면 그 달에서 시작한다.
  const anchor = from || floor;
  const [cursor, setCursor] = useState(() => {
    const [y, m] = anchor.split('-').map(Number);
    return { year: y, month: (m || 1) - 1 };
  });

  // 바깥을 누르면 닫는다. 시작일만 고른 채로 닫히면 절반만 고른 상태가 남으므로
  // 그때는 고른 시작일을 그대로 두고 마감일은 비워 둔다(선택 사항이다).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHovered('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openAt = (which: 'from' | 'to') => {
    const base = which === 'to' && to ? to : from || floor;
    const [y, m] = base.split('-').map(Number);
    setCursor({ year: y, month: (m || 1) - 1 });
    setOpen(true);
  };

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
    const lead = first.getUTCDay();
    const total = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    const out: Array<{ key: string; day: number } | null> = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= total; d++) out.push({ key: keyOf(cursor.year, cursor.month, d), day: d });
    return out;
  }, [cursor]);

  /**
   * 클릭 한 번의 의미는 지금 무엇이 고른 상태인지에 달려 있다.
   *   아무것도 없음 / 둘 다 있음 → 시작일을 새로 잡는다(마감일은 비운다)
   *   시작일만 있음            → 마감일로 받는다. 단, 시작일보다 앞이면 시작일을 다시 잡는다.
   */
  const pick = (key: string) => {
    if (key < floor) return;
    if (!from || (from && to)) {
      onChange(key, '');
      setHovered('');
      return;
    }
    if (key < from) {
      onChange(key, '');
      return;
    }
    onChange(from, key);
    setOpen(false);
    setHovered('');
  };

  const pendingEnd = !!from && !to;
  const rangeEnd = to || (pendingEnd ? hovered : '');
  const inRange = (key: string) => !!from && !!rangeEnd && key > from && key < rangeEnd;

  const shiftMonth = (delta: number) =>
    setCursor(c => {
      const next = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });

  const fieldBase =
    'flex-1 text-left px-4 py-3 rounded-xl border text-sm font-bold transition-colors min-w-0';

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openAt('from')}
          className={`${fieldBase} ${
            from ? 'border-slate-300 text-slate-900' : 'border-slate-200 text-slate-400'
          } ${open && !pendingEnd ? 'ring-2 ring-blue-500/20 border-blue-500' : ''}`}
        >
          <span className="block text-[10px] font-black text-slate-400 mb-0.5">시작일</span>
          {from ? humanize(from) : '날짜 선택'}
        </button>
        <span className="text-xs font-black text-slate-300 flex-shrink-0">~</span>
        <button
          type="button"
          onClick={() => openAt('to')}
          className={`${fieldBase} ${
            to ? 'border-slate-300 text-slate-900' : 'border-slate-200 text-slate-400'
          } ${open && pendingEnd ? 'ring-2 ring-blue-500/20 border-blue-500' : ''}`}
        >
          <span className="block text-[10px] font-black text-slate-400 mb-0.5">마감일</span>
          {to ? humanize(to) : pendingEnd ? '이어서 선택' : '날짜 선택'}
        </button>
      </div>

      {from && to && (
        <p className="text-[11px] font-bold text-slate-500 mt-1.5">
          업로드 기간 {daysBetween(from, to)}일 · {from} ~ {to}
        </p>
      )}

      {open && (
        <div className="absolute z-30 mt-2 w-[320px] max-w-[calc(100vw-2.5rem)] bg-white rounded-2xl border border-slate-200 shadow-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 font-black text-xs"
            >
              ‹
            </button>
            <p className="text-xs font-black text-slate-900">
              {cursor.year}년 {cursor.month + 1}월
            </p>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-500 font-black text-xs"
            >
              ›
            </button>
          </div>

          <p className="text-[11px] font-black text-blue-600 bg-blue-50 rounded-lg px-2.5 py-1.5 mb-3">
            {pendingEnd ? '마감일을 골라 주세요' : '시작일을 고르면 이어서 마감일을 고를 수 있어요'}
          </p>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map(w => (
              <span key={w} className="text-center text-[10px] font-black text-slate-400 py-1">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHovered('')}>
            {cells.map((cell, i) => {
              if (!cell) return <span key={`pad-${i}`} />;
              const disabled = cell.key < floor;
              const isStart = cell.key === from;
              const isEnd = cell.key === to;
              const between = inRange(cell.key);
              return (
                <button
                  key={cell.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(cell.key)}
                  onMouseEnter={() => pendingEnd && setHovered(cell.key)}
                  className={`h-9 rounded-lg text-xs font-black transition-colors ${
                    disabled
                      ? 'text-slate-200 cursor-not-allowed'
                      : isStart || isEnd
                        ? 'bg-slate-900 text-white'
                        : between
                          ? 'bg-slate-100 text-slate-700'
                          : cell.key === today
                            ? 'text-blue-600 hover:bg-slate-100'
                            : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                onChange('', '');
                setHovered('');
              }}
              className="text-[11px] font-black text-slate-400 hover:text-slate-600"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setHovered('');
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-[11px] font-black hover:bg-slate-200"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateRangeCalendar;
