import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { affiliateStoreService, won, type MyAffiliateItem } from '../../services/affiliateStoreService';

/**
 * 인플루언서 대시보드 홈의 어필리에이트 요약(예전 캠페인 지원 · 협업 캠페인 자리).
 *
 * 진행 중인 어필리에이트 수 · 판매액 · 수수료와, 지금 해야 할 일(선정돼 배송정보 입력 대기 ·
 * 업로드 마감이 다가오는 협업)을 보여 준다. 크리에이터 승인 전이거나 불러오지 못하면 숫자 없이
 * 둘러보기 버튼만 남는다.
 */
interface Props {
  onBrowse?: () => void;
  onMyAffiliate?: () => void;
}

const AffiliateHomeSummary: React.FC<Props> = ({ onBrowse, onMyAffiliate }) => {
  const [items, setItems] = useState<MyAffiliateItem[] | null>(null);
  const [totals, setTotals] = useState({ sales: 0, commission: 0, orders: 0 });
  const [awaitingShipping, setAwaitingShipping] = useState(0);

  useEffect(() => {
    let alive = true;
    void affiliateStoreService.myAffiliate().then(res => {
      if (!alive || res.error) return;
      setItems(res.items || []);
      setTotals({ sales: res.totals?.sales || 0, commission: res.totals?.commission || 0, orders: res.totals?.orders || 0 });
    });
    void affiliateStoreService.myRequestStatuses().then(res => {
      if (alive && !res.error) setAwaitingShipping(res.awaitingShippingCount || 0);
    });
    return () => { alive = false; };
  }, []);

  // 업로드가 남은 협업(업로드 일정은 담당자가 조율한다).
  const todo = (items || [])
    .filter(i => !i.contentUrl && i.shippingStatus !== 'declined')
    .slice(0, 3);

  return (
    <section className="mb-6 md:mb-8 space-y-3">
      {onBrowse && (
        <button
          onClick={onBrowse}
          className="w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-pink-500 text-white py-4 md:py-5 rounded-2xl font-black text-sm md:text-lg shadow-[0_8px_30px_rgba(124,58,237,0.25)] hover:shadow-[0_12px_40px_rgba(124,58,237,0.35)] transition-all active:scale-[0.99] flex items-center justify-center gap-3"
        >
          <span className="text-xl">🏬</span>
          어필리에이트 상품 둘러보기
          <ChevronRight className="w-4 h-4 md:w-5 md:h-5" />
        </button>
      )}

      {awaitingShipping > 0 && onMyAffiliate && (
        <button
          onClick={onMyAffiliate}
          className="w-full flex items-center justify-between gap-3 rounded-2xl bg-blue-600 text-white px-4 py-3.5 text-left shadow-lg shadow-blue-600/20"
        >
          <span className="text-sm font-black">브랜드에 선정된 어필리에이트가 {awaitingShipping}건 있어요! 배송정보를 입력해 협업을 시작하세요.</span>
          <ChevronRight className="w-4 h-4 shrink-0" />
        </button>
      )}

      {items && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm md:text-lg font-black text-slate-900">🤝 MY 어필리에이트</h4>
            {onMyAffiliate && (
              <button onClick={onMyAffiliate} className="text-xs font-black text-blue-600 flex items-center gap-0.5">
                전체 보기 <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {[
              ['진행 중', `${items.length}건`],
              ['판매액', won(totals.sales)],
              ['수수료', won(totals.commission)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] font-black text-slate-400">{label}</p>
                <p className={`text-sm md:text-lg font-black ${label === '수수료' ? 'text-blue-600' : 'text-slate-900'}`}>{value}</p>
              </div>
            ))}
          </div>
          {todo.length > 0 ? (
            <div className="mt-3 divide-y divide-slate-50">
              {todo.map(i => {
                const s = i.shippingStatus === 'awaiting_info' ? '배송정보 입력' : i.shippingStatus === 'info_submitted' ? '발송 대기' : '업로드 전';
                return (
                  <button key={i.id} onClick={onMyAffiliate} className="w-full flex items-center gap-3 py-2.5 text-left">
                    {i.productImage && <img src={i.productImage} alt="" className="w-10 h-10 rounded-lg object-cover bg-slate-100 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-slate-400 truncate">{i.brandName}</p>
                      <p className="text-xs font-black text-slate-900 truncate">{i.productName}</p>
                    </div>
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-600">{s}</span>
                  </button>
                );
              })}
              <p className="pt-2 text-[11px] text-slate-400">업로드 일정은 픽스폴리오 담당자가 연락드려 조율해요. 업로드한 뒤 MY 어필리에이트에 업로드 링크 · 파트너십 코드를 올려 주세요.</p>
            </div>
          ) : items.length === 0 ? (
            <p className="mt-3 text-xs text-slate-400">아직 진행 중인 어필리에이트가 없어요. 상품을 둘러보고 판매 신청해 보세요.</p>
          ) : null}
        </div>
      )}
    </section>
  );
};

export default AffiliateHomeSummary;
