import React from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react';
import type { MetaPage } from '../utils/metaAdsApi';

/**
 * 광고 페이지 고르기 — 연동한 메타 계정이 관리하는 페이스북 페이지(GET /me/accounts).
 *
 * 광고는 이 페이지 이름으로 나간다. 목록은 메타가 돌려준 그대로이고, 카드를 눌러 고른다.
 * 미리 골라 두지 않는다 — 페이지가 하나뿐이어도 브랜드가 직접 눌러야 선택된다.
 * 광고 작업 권한(ADVERTISE)이 없는 페이지도 보여 주되 고를 수 없게 하고 이유를 적는다 —
 * 목록에서 빼면 브랜드는 "내 페이지가 왜 없지" 를 광고 관리자에서 찾아야 한다.
 */
interface MetaPagePickerProps {
  pages: MetaPage[];
  selectedId?: string;
  onSelect: (pageId: string) => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** 한 줄 가로 목록(좁은 자리)인지. 기본은 세로 목록이다. */
  compact?: boolean;
}

const MetaPagePicker: React.FC<MetaPagePickerProps> = ({
  pages,
  selectedId,
  onSelect,
  loading,
  error,
  onRetry,
  compact,
}) => {
  if (loading && pages.length === 0) {
    return (
      <div className="mt-1.5 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Meta에서 페이지 목록을 불러오는 중
      </div>
    );
  }

  if (error && pages.length === 0) {
    return (
      <div className="mt-1.5 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
        <p className="text-[11px] font-black text-rose-700 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          페이지 목록을 불러오지 못했습니다
        </p>
        <p className="text-[10px] text-rose-600 font-medium mt-1 leading-relaxed break-words">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 text-[10px] font-black text-rose-600"
          >
            <RefreshCw className="w-3 h-3" />
            다시 불러오기
          </button>
        )}
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="mt-1.5 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
        <p className="text-[11px] font-black text-amber-800">연동한 Meta 계정에 관리 중인 페이지가 없습니다</p>
        <p className="text-[10px] text-amber-700 font-medium mt-1 leading-relaxed">
          광고는 페이스북 페이지 이름으로 나갑니다. 페이지를 만들거나 관리자 권한을 받은 뒤, 연동할 때 그
          페이지를 허용해 주세요.
        </p>
      </div>
    );
  }

  const hasSelection = !!selectedId && pages.some((p) => p.id === selectedId);

  return (
    <>
    {!hasSelection && (
      <p className="mt-1.5 text-[11px] font-black text-blue-600">
        광고를 집행할 페이지를 선택해 주세요 · 불러온 페이지 {pages.length}개
      </p>
    )}
    <div
      className={compact ? 'mt-1.5 flex gap-2 overflow-x-auto pb-1' : 'mt-1.5 space-y-1.5'}
      role="radiogroup"
      aria-label="광고 페이지"
    >
      {pages.map((p) => {
        const on = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!p.canAdvertise}
            onClick={() => onSelect(p.id)}
            className={`${compact ? 'min-w-[200px] flex-shrink-0' : 'w-full'} flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
              on
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {p.pictureUrl ? (
              <img src={p.pictureUrl} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-100 flex-shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-[12px] font-black text-slate-400 flex-shrink-0">
                {p.name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-black text-slate-900 truncate">{p.name}</p>
              <p className="text-[10px] text-slate-400 font-bold truncate">
                {p.category || '페이지'} · 팔로워 {p.followers.toLocaleString()}
                {p.instagramUsername ? ` · @${p.instagramUsername}` : ''}
              </p>
              {!p.canAdvertise && (
                <p className="text-[10px] text-amber-600 font-bold mt-0.5">이 페이지의 광고 권한이 없습니다</p>
              )}
            </div>
            <span
              className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
                on ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
              }`}
            >
              {on && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
            </span>
          </button>
        );
      })}
    </div>
    </>
  );
};

export default MetaPagePicker;
