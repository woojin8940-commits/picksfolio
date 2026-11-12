import React from 'react';
import { Sparkles } from 'lucide-react';
import {
  won,
  SALE_STATE_LABEL,
  SALE_STATE_STYLE,
  type AffiliateRecommendation,
  type StoreProduct,
} from '../../services/affiliateStoreService';

/**
 * MY 어필리에이트 › 추천 어필리에이트 — 담당자가 이 인플루언서에게 어울린다고 골라 둔 상품.
 *
 * 상품 목록과 같은 카드로 늘어놓고, 담당자의 한마디(추천 메모)를 카드 아래에 붙인다.
 * 카드를 누르면 상품 둘러보기와 같은 상세가 열려 그 자리에서 판매 신청한다.
 * 지금 판매하지 않는 상품(판매 예정 · 중지 · 종료)은 흐리게 두고 열지 않는다.
 */

const REQUEST_BADGE: Record<string, { label: string; style: string }> = {
  pending: { label: '신청 완료', style: 'bg-amber-500 text-white' },
  approved: { label: '선정됨', style: 'bg-emerald-500 text-white' },
  rejected: { label: '미선정', style: 'bg-slate-500 text-white' },
};

const RecommendedAffiliates: React.FC<{
  items: AffiliateRecommendation[];
  onOpen?: (p: StoreProduct) => void;
}> = ({ items, onOpen }) => {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
        <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-sm font-black text-slate-700">아직 추천된 상품이 없어요</p>
        <p className="text-xs text-slate-400 mt-1">담당자가 나에게 어울리는 어필리에이트 상품을 골라 주면 여기에 보여요.</p>
      </div>
    );
  }

  return (
    <>
      <p className="text-[11px] text-slate-400 mb-3">담당자가 나에게 어울리는 상품을 골랐어요. 상품을 누르면 상세를 보고 바로 판매 신청할 수 있어요.</p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
        {items.map(rec => {
          const p = rec.product;
          const state = p.saleState || 'on_sale';
          const openable = state === 'on_sale' || state === 'sold_out' || !!rec.requestStatus;
          const badge = rec.requestStatus ? REQUEST_BADGE[rec.requestStatus] : undefined;
          return (
            <button
              key={rec.id}
              type="button"
              disabled={!openable || !onOpen}
              onClick={() => onOpen?.(p)}
              className="text-left bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col hover:bg-slate-50/60 transition-colors disabled:cursor-default"
            >
              <div className="relative aspect-square bg-slate-100">
                {p.imageUrls[0] && <img src={p.imageUrls[0]} alt="" className="w-full h-full object-cover" loading="lazy" />}
                {!openable && <div className="absolute inset-0 bg-white/50" />}
                <span className="absolute top-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg bg-violet-600 text-white flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> 추천
                </span>
                {!rec.seen && <span className="absolute top-2 right-2 text-[10px] font-black px-2 py-1 rounded-lg bg-red-500 text-white">NEW</span>}
                {badge && <span className={`absolute bottom-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg ${badge.style}`}>{badge.label}</span>}
                {!badge && state !== 'on_sale' && (
                  <span className={`absolute bottom-2 left-2 text-[10px] font-black px-2 py-1 rounded-lg ${SALE_STATE_STYLE[state]}`}>{SALE_STATE_LABEL[state]}</span>
                )}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                <p className="text-[10px] font-bold text-slate-400 truncate">{p.brandName}</p>
                <p className="text-xs md:text-sm font-black text-slate-900 line-clamp-2 min-h-[2.5em]">{p.name}</p>
                <p className="text-[11px] text-slate-500 mt-1 truncate">
                  {won(p.salePrice)} · 수수료 <b className="text-blue-600">{p.commissionRate}%</b>
                </p>
                {rec.note && (
                  <p className="mt-2 text-[11px] font-bold text-violet-700 bg-violet-50 rounded-lg px-2 py-1.5 leading-snug line-clamp-3">
                    “{rec.note}”
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default RecommendedAffiliates;
