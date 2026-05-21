import React, { useState, useEffect } from 'react';
import { Sparkles, BarChart3, ArrowUpRight, ArrowDownRight, Minus, Clock } from 'lucide-react';

interface AITrendAnalysisProps {
  userName: string;
  embedded?: boolean;
}

interface CategoryRanking {
  rank: number;
  keyword: string;
  ratio: number;
  delta: number;
  trend: 'up' | 'down' | 'flat';
}

interface CategoryBlock {
  cid: string;
  label: string;
  rankings: CategoryRanking[];
}

const CATEGORY_ACCENTS: Record<string, { dot: string; chip: string }> = {
  '50000000': { dot: 'bg-purple-600', chip: 'bg-purple-50 text-purple-700' },
  '50000002': { dot: 'bg-pink-500', chip: 'bg-pink-50 text-pink-700' },
  '50000003': { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700' },
  '50000004': { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700' },
  '50000006': { dot: 'bg-green-500', chip: 'bg-green-50 text-green-700' },
  '50000008': { dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-700' },
  '50000009': { dot: 'bg-indigo-500', chip: 'bg-indigo-50 text-indigo-700' },
};

const DEFAULT_ACCENT = { dot: 'bg-slate-500', chip: 'bg-slate-50 text-slate-700' };

const AITrendAnalysis: React.FC<AITrendAnalysisProps> = ({ embedded = false }) => {
  const [categories, setCategories] = useState<CategoryBlock[]>([]);
  const [categoriesUpdatedAt, setCategoriesUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const formatUpdatedAt = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${month}/${day} ${hours}:${minutes}`;
    } catch {
      return isoString;
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/.netlify/functions/api-naver-category-rankings');
        if (res.ok) {
          const data = await res.json();
          setCategories(data.categories || []);
          if (data.updatedAt) setCategoriesUpdatedAt(data.updatedAt);
        }
      } catch (error) {
        console.error('Failed to fetch trend data', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className={embedded ? 'animate-in fade-in duration-500' : 'p-4 md:p-14 max-w-6xl mx-auto animate-in fade-in duration-500'}>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
        <div>
          <h2 className="text-lg md:text-3xl font-black text-slate-900 mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            AI 트렌드 분석 <Sparkles className="text-purple-600 w-5 h-5 md:w-6 md:h-6" />
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-slate-500 font-medium text-[10px] md:text-base">카테고리별 인기 키워드 트렌드를 분석합니다.</p>
            <span className="flex items-center gap-1 bg-purple-100 text-purple-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
              <Clock size={10} /> 매일 오후 2시 업데이트
            </span>
            {categoriesUpdatedAt && (
              <span className="flex items-center gap-1 bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <Clock size={10} /> {formatUpdatedAt(categoriesUpdatedAt)} 기준
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        {loading && categories.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 bg-white p-4 md:p-8 rounded-xl md:rounded-[2rem] border border-slate-100 shadow-sm text-[11px] text-slate-400 font-bold py-4 text-center">
            카테고리 데이터를 불러오는 중...
          </div>
        )}
        {categories.map((cat) => {
          const accent = CATEGORY_ACCENTS[cat.cid] ?? DEFAULT_ACCENT;
          return (
            <div key={cat.cid} className="bg-white p-4 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-3 md:mb-4">
                <h4 className="font-black text-slate-900 flex items-center gap-2 text-xs md:text-sm">
                  <BarChart3 size={16} className="text-purple-600" />
                  <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`}></span>
                  {cat.label}
                </h4>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${accent.chip}`}>
                  TOP 5
                </span>
              </div>
              <div className="space-y-1.5">
                {cat.rankings.map((item) => (
                  <div
                    key={`${cat.cid}-${item.rank}`}
                    className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-4 text-xs font-black text-slate-400 tabular-nums shrink-0">
                        {item.rank}
                      </span>
                      <span className="text-xs font-bold text-slate-700 truncate">
                        {item.keyword}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.trend === 'up' && (
                        <>
                          <ArrowUpRight size={12} className="text-emerald-500" />
                          <span className="text-[9px] font-black text-emerald-600 tabular-nums">
                            +{item.delta}%
                          </span>
                        </>
                      )}
                      {item.trend === 'down' && (
                        <>
                          <ArrowDownRight size={12} className="text-red-500" />
                          <span className="text-[9px] font-black text-red-500 tabular-nums">
                            {item.delta}%
                          </span>
                        </>
                      )}
                      {item.trend === 'flat' && (
                        <>
                          <Minus size={12} className="text-slate-400" />
                          <span className="text-[9px] font-black text-slate-400 tabular-nums">
                            {item.delta >= 0 ? '+' : ''}{item.delta}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AITrendAnalysis;
