
import React, { useState, useEffect } from 'react';
import { History, Clock, Users, ShoppingBag, MessageCircle, ChevronDown, ChevronUp, Trash2, Package, TrendingUp } from 'lucide-react';
import { formatKRW } from '../utils/formatters';
import { apiService } from '../services/apiService';
import MediaAuto from './MediaAuto';

interface BroadcastRecord {
  id: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  products: {
    id: string;
    name: string;
    price?: string;
    image?: string;
    link: string;
    blockTitle?: string;
  }[];
  cartStats: {
    totalViewers: number;
    totalItems: number;
    totalRevenue?: number;
    productCounts: {
      productId: string;
      name: string;
      count: number;
      image?: string;
      link: string;
      price?: string;
      optionCounts?: Record<string, Record<string, number>>;
    }[];
  };
  peakViewers: number;
  totalMessages: number;
}

interface BroadcastHistoryProps {
  userName: string;
  embedded?: boolean;
}

const BroadcastHistory: React.FC<BroadcastHistoryProps> = ({ userName, embedded = false }) => {
  const [records, setRecords] = useState<BroadcastRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await apiService.getBroadcastHistory(userName);
      setRecords(data);
      setLoading(false);
    };
    load();
  }, [userName]);

  const handleDelete = async (recordId: string) => {
    if (!confirm('이 방송 기록을 삭제하시겠습니까?')) return;
    const ok = await apiService.deleteBroadcastRecord(userName, recordId);
    if (ok) {
      setRecords(prev => prev.filter(r => r.id !== recordId));
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 1) return '1분 미만';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  };

  const estimateSales = (cartStats: BroadcastRecord['cartStats'], products: BroadcastRecord['products']) => {
    // Use totalRevenue from API if available
    if (cartStats?.totalRevenue && cartStats.totalRevenue > 0) return cartStats.totalRevenue;
    let total = 0;
    for (const pc of (cartStats?.productCounts || [])) {
      const price = pc.price || products.find(p => p.id === pc.productId)?.price;
      if (price) {
        const numPrice = parseInt(price.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(numPrice)) {
          total += numPrice * pc.count;
        }
      }
    }
    return total;
  };

  if (loading) {
    return (
      <div className={embedded ? 'animate-in fade-in duration-500' : 'p-4 md:p-14 w-full animate-in fade-in duration-500'}>
        {!embedded && (
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-10">
            <div>
              <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-1 md:mb-2">방송 기록</h2>
              <p className="text-slate-500 font-medium text-[10px] md:text-base">라이브 방송 히스토리와 성과를 확인하세요.</p>
            </div>
          </header>
        )}
        <div className="bg-white p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-3 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'animate-in fade-in duration-500' : 'p-4 md:p-14 w-full animate-in fade-in duration-500'}>
      {!embedded && (
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 md:mb-10">
          <div>
            <h2 className="text-xl md:text-3xl font-black text-slate-900 mb-1 md:mb-2">방송 기록</h2>
            <p className="text-slate-500 font-medium text-[10px] md:text-base">라이브 방송 히스토리와 성과를 확인하세요.</p>
          </div>
          <span className="text-slate-400 text-xs md:text-sm font-bold">{records.length}회 방송</span>
        </header>
      )}

    <div className="bg-white p-6 md:p-10 rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-sm">
      <div className="flex items-center justify-between mb-4 md:mb-8">
        <h4 className="text-base md:text-xl font-black flex items-center gap-2 md:gap-3">
          <History className="w-4 h-4 md:w-5 md:h-5 text-indigo-500" /> 전체 방송 목록
        </h4>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 md:py-12 text-center">
          <div className="w-14 h-14 md:w-20 md:h-20 bg-slate-50 rounded-full flex items-center justify-center mb-3 md:mb-4">
            <History size={28} className="text-slate-300 md:hidden" />
            <History size={36} className="text-slate-300 hidden md:block" />
          </div>
          <p className="text-slate-400 font-bold text-xs md:text-sm">방송 기록이 없습니다</p>
          <p className="text-slate-300 font-medium text-[10px] md:text-xs mt-1">방송을 시작하면 기록이 자동으로 저장됩니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => {
            const isExpanded = expandedId === record.id;
            const sales = estimateSales(record.cartStats, record.products);

            return (
              <div key={record.id} className="bg-slate-50 rounded-xl md:rounded-2xl border border-slate-100 overflow-hidden">
                {/* Summary Row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : record.id)}
                  className="w-full flex items-center gap-3 md:gap-4 p-4 md:p-5 text-left hover:bg-slate-100/50 transition-all"
                >
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-indigo-100 text-indigo-600 rounded-xl md:rounded-2xl flex items-center justify-center flex-shrink-0">
                    <TrendingUp size={18} className="md:hidden" />
                    <TrendingUp size={22} className="hidden md:block" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm md:text-base text-slate-900">
                      {formatDate(record.startedAt)}
                    </p>
                    <div className="flex items-center gap-2 md:gap-3 flex-wrap mt-0.5">
                      <span className="text-slate-400 text-[10px] md:text-xs font-medium flex items-center gap-1">
                        <Clock size={10} /> {formatTime(record.startedAt)} ~ {formatTime(record.endedAt)}
                      </span>
                      <span className="text-slate-400 text-[10px] md:text-xs font-medium">
                        ({formatDuration(record.durationMinutes)})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 md:gap-5 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-[10px] md:text-xs text-slate-400 font-bold">시청자</p>
                      <p className="text-sm md:text-base font-black text-slate-700">{record.peakViewers}명</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-[10px] md:text-xs text-slate-400 font-bold">담은 수</p>
                      <p className="text-sm md:text-base font-black text-slate-700">{record.cartStats?.totalItems || 0}개</p>
                    </div>
                    {sales > 0 && (
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] md:text-xs text-slate-400 font-bold">예상 매출</p>
                        <p className="text-sm md:text-base font-black text-green-600">{formatKRW(sales)}</p>
                      </div>
                    )}
                    {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                  </div>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-4 md:px-5 pb-4 md:pb-5 border-t border-slate-200 space-y-4">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 pt-4">
                      <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Users size={14} className="text-red-500" />
                          <span className="text-[10px] md:text-xs font-bold text-slate-400">최대 시청자</span>
                        </div>
                        <p className="text-lg md:text-xl font-black text-slate-900">{record.peakViewers}명</p>
                      </div>
                      <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-1.5 mb-1">
                          <ShoppingBag size={14} className="text-green-500" />
                          <span className="text-[10px] md:text-xs font-bold text-slate-400">담은 상품</span>
                        </div>
                        <p className="text-lg md:text-xl font-black text-slate-900">{record.cartStats?.totalItems || 0}개</p>
                      </div>
                      <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-1.5 mb-1">
                          <MessageCircle size={14} className="text-blue-500" />
                          <span className="text-[10px] md:text-xs font-bold text-slate-400">채팅 수</span>
                        </div>
                        <p className="text-lg md:text-xl font-black text-slate-900">{record.totalMessages}개</p>
                      </div>
                      <div className="bg-white p-3 md:p-4 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Clock size={14} className="text-blue-500" />
                          <span className="text-[10px] md:text-xs font-bold text-slate-400">방송 시간</span>
                        </div>
                        <p className="text-lg md:text-xl font-black text-slate-900">{formatDuration(record.durationMinutes)}</p>
                      </div>
                    </div>

                    {/* Estimated Sales */}
                    {sales > 0 && (
                      <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                        <p className="text-xs font-bold text-green-600 mb-1">예상 매출</p>
                        <p className="text-2xl font-black text-green-700">{formatKRW(sales)}</p>
                        <p className="text-[10px] text-green-500 mt-1">* 담은 상품 수량 x 상품 가격 기준 추정치</p>
                      </div>
                    )}

                    {/* Product Performance */}
                    {record.cartStats?.productCounts && record.cartStats.productCounts.length > 0 && (
                      <div>
                        <h5 className="text-xs md:text-sm font-black text-slate-700 mb-2 flex items-center gap-1.5">
                          <ShoppingBag size={14} className="text-green-500" /> 상품별 담은 횟수
                        </h5>
                        <div className="space-y-2">
                          {record.cartStats.productCounts.map((pc, idx) => {
                            const product = record.products.find(p => p.id === pc.productId);
                            return (
                              <div key={pc.productId} className="bg-white p-3 rounded-xl border border-slate-100">
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 bg-green-100 text-green-700 rounded-lg flex items-center justify-center font-black text-xs flex-shrink-0">
                                    {idx + 1}
                                  </div>
                                  {pc.image ? (
                                    <MediaAuto src={pc.image} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                                  ) : (
                                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                                      <Package size={16} className="text-slate-300" />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-bold text-xs md:text-sm text-slate-900 truncate">{pc.name}</p>
                                    {(pc.price || product?.price) && <p className="text-[10px] text-slate-400">{pc.price || product?.price}</p>}
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="font-black text-sm text-green-600">{pc.count}회</p>
                                  </div>
                                </div>
                                {/* Option breakdown */}
                                {pc.optionCounts && Object.keys(pc.optionCounts).length > 0 && (
                                  <div className="mt-2 ml-10 space-y-1.5">
                                    {Object.entries(pc.optionCounts).map(([optName, values]) => (
                                      <div key={optName}>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">{optName}</p>
                                        <div className="flex flex-wrap gap-1">
                                          {Object.entries(values).sort((a, b) => b[1] - a[1]).map(([val, cnt]) => (
                                            <span key={val} className="text-[9px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold">
                                              {val} <span className="text-indigo-400">{cnt}</span>
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Products List */}
                    {record.products.length > 0 && (
                      <div>
                        <h5 className="text-xs md:text-sm font-black text-slate-700 mb-2 flex items-center gap-1.5">
                          <Package size={14} className="text-indigo-500" /> 방송 상품 ({record.products.length}개)
                        </h5>
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                          {record.products.map(product => (
                            <div key={product.id} className="flex-shrink-0 w-28 md:w-32 bg-white p-2 rounded-xl border border-slate-100">
                              {product.image ? (
                                <MediaAuto src={product.image} className="w-full aspect-square rounded-lg object-cover mb-1.5" />
                              ) : (
                                <div className="w-full aspect-square rounded-lg bg-slate-100 flex items-center justify-center mb-1.5">
                                  <Package size={20} className="text-slate-300" />
                                </div>
                              )}
                              <p className="font-bold text-[10px] md:text-xs text-slate-900 truncate">{product.name}</p>
                              {product.price && <p className="text-[9px] md:text-[10px] text-slate-400">{product.price}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-end items-center gap-2 pt-2">
                      <button
                        onClick={() => handleDelete(record.id)}
                        className="flex items-center gap-1.5 text-red-400 hover:text-red-600 text-xs font-bold px-3 py-2 rounded-lg hover:bg-red-50 transition-all"
                      >
                        <Trash2 size={14} /> 기록 삭제
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
};

export default BroadcastHistory;
