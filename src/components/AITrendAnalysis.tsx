import React, { useState, useEffect } from 'react';
import { Sparkles, BarChart3, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Database, Clock } from 'lucide-react';

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
  '50000000': {
    dot: 'bg-purple-600',
    chip: 'bg-purple-50 text-purple-700',
  },
  '50000002': {
    dot: 'bg-pink-500',
    chip: 'bg-pink-50 text-pink-700',
  },
};

const AITrendAnalysis: React.FC<AITrendAnalysisProps> = ({ embedded = false }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryBlock[]>([]);
  const [categorySource, setCategorySource] = useState<string>('loading');
  const [categoriesUpdatedAt, setCategoriesUpdatedAt] = useState<string | null>(null);

  const formatUpdatedAt = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${month}/${day} ${hours}:${minutes}`;
    } catch (e) {
      return isoString;
    }
  };

  const fetchNaverData = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const categoryRes = await fetch('/.netlify/functions/api-naver-category-rankings');

      if (categoryRes.ok) {
        const data = await categoryRes.json();
        setCategories(data.categories || []);
        setCategorySource(data.source);
        if (data.updatedAt) setCategoriesUpdatedAt(data.updatedAt);
      } else {
        setError('데이터를 불러오는데 실패했습니다.');
        setCategorySource('error');
      }
    } catch (error) {
      console.error('Failed to fetch data', error);
      setError('네트워크 오류가 발생했습니다.');
      setCategorySource('error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    fetchNaverData();
  }, []);

  const handleAnalyze = () => {
    fetchNaverData();
  };

  return (
    <div className={embedded ? 'animate-in fade-in duration-500' : 'p-4 md:p-14 max-w-6xl mx-auto animate-in fade-in duration-500'}>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
        <div>
          <h2 className="text-lg md:text-3xl font-black text-slate-900 mb-1 md:mb-2 flex items-center gap-2 md:gap-3">
            AI 트렌드 분석 <Sparkles className="text-purple-600 w-5 h-5 md:w-6 md:h-6" />
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-slate-500 font-medium text-[10px] md:text-base">현재 소셜 미디어와 포털 검색 트렌드를 분석합니다.</p>
            {categorySource === 'naver_shopping_api' && (
              <span className="flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <Database size={10} /> 네이버 쇼핑 실시간 연동 중
              </span>
            )}
            {categoriesUpdatedAt && (
              <span className="flex items-center gap-1 bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                <Clock size={10} /> {formatUpdatedAt(categoriesUpdatedAt)} 업데이트
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className="bg-purple-600 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 hover:bg-purple-500 transition-all shadow-lg shadow-purple-200 disabled:opacity-50"
        >
          <RefreshCw size={18} className={isAnalyzing ? 'animate-spin' : ''} />
          <span>실시간 분석 업데이트</span>
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {categories.length === 0 && (
          <div className="md:col-span-2 bg-white p-4 md:p-8 rounded-xl md:rounded-[2rem] border border-slate-100 shadow-sm text-[11px] text-slate-400 font-bold py-4 text-center">
            카테고리 데이터를 불러오는 중...
          </div>
        )}
        {categories.map((cat) => {
          const accent = CATEGORY_ACCENTS[cat.cid] ?? CATEGORY_ACCENTS['50000000'];
          return (
            <div key={cat.cid} className="bg-white p-4 md:p-8 rounded-xl md:rounded-[2rem] border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <h4 className="font-black text-slate-900 flex items-center gap-2 text-sm md:text-base">
                  <BarChart3 size={18} className="text-purple-600" />
                  <span className={`w-1.5 h-1.5 rounded-full ${accent.dot}`}></span>
                  {cat.label} TOP 5
                </h4>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${accent.chip}`}>
                    TOP 5
                  </span>
                  {categorySource === 'naver_shopping_api' && (
                    <span className="text-[10px] font-black uppercase text-green-500">
                      ● Live
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-2.5">
                {cat.rankings.map((item) => (
                  <div
                    key={`${cat.cid}-${item.rank}`}
                    className="flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-5 text-sm font-black text-slate-400 tabular-nums shrink-0">
                        {item.rank}
                      </span>
                      <span className="text-xs md:text-sm font-black text-slate-700 truncate">
                        {item.keyword}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.trend === 'up' && (
                        <>
                          <ArrowUpRight size={13} className="text-emerald-500" />
                          <span className="text-[10px] font-black text-emerald-600 tabular-nums">
                            +{item.delta}%
                          </span>
                        </>
                      )}
                      {item.trend === 'down' && (
                        <>
                          <ArrowDownRight size={13} className="text-red-500" />
                          <span className="text-[10px] font-black text-red-500 tabular-nums">
                            {item.delta}%
                          </span>
                        </>
                      )}
                      {item.trend === 'flat' && (
                        <>
                          <Minus size={13} className="text-slate-400" />
                          <span className="text-[10px] font-black text-slate-400 tabular-nums">
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
