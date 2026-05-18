import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

interface CategoryItem {
  rank: number;
  text: string;
  trend: string;
}

interface Category {
  cid: string;
  name: string;
  items: CategoryItem[];
}

const catStyles: Record<string, { dot: string; chip: string }> = {
  '50000000': { dot: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700' },
  '50000002': { dot: 'bg-pink-500', chip: 'bg-pink-50 text-pink-700' },
};

interface NaverCategoryRankingsProps {
  embedded?: boolean;
}

const NaverCategoryRankings: React.FC<NaverCategoryRankingsProps> = ({ embedded = false }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [source, setSource] = useState<string>('loading');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const h = d.getHours().toString().padStart(2, '0');
      const min = d.getMinutes().toString().padStart(2, '0');
      return `${m}/${day} ${h}:${min}`;
    } catch { return dateStr; }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/.netlify/functions/api-naver-category-rankings');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        setSource(data.source);
        if (data.updatedAt) setUpdatedAt(data.updatedAt);
      } else {
        setError('데이터를 불러오는데 실패했습니다.');
        setSource('error');
      }
    } catch (err) {
      console.error('Failed to fetch data', err);
      setError('네트워크 오류가 발생했습니다.');
      setSource('error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className={embedded ? 'animate-in fade-in duration-500' : 'p-4 md:p-14 max-w-6xl mx-auto animate-in fade-in duration-500'}>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-8">
        <div>
          <h3 className="text-lg md:text-2xl font-black text-slate-900 flex items-center gap-2">
            실시간 카테고리 랭킹
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-slate-400 text-xs md:text-sm font-bold">네이버 쇼핑 기준</p>
            {updatedAt && <span className="text-[10px] font-bold text-slate-300 bg-slate-50 px-2 py-0.5 rounded-md">{formatTime(updatedAt)}</span>}
            {source === 'fallback' && <span className="text-[10px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-md">샘플 데이터</span>}
          </div>
        </div>
        <button onClick={fetchData} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-xs font-black text-slate-500 hover:text-purple-600 bg-white border border-slate-200 rounded-xl hover:border-purple-300 transition-all disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-red-600 text-sm font-bold">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {categories.map(cat => {
          const style = catStyles[cat.cid] || { dot: 'bg-slate-500', chip: 'bg-slate-50 text-slate-700' };
          return (
            <div key={cat.cid} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 md:p-8">
              <div className="flex items-center gap-2 mb-5">
                <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                <h4 className="font-black text-slate-900">{cat.name}</h4>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto ${style.chip}`}>TOP 5</span>
              </div>
              <div className="space-y-3">
                {cat.items.map(item => (
                  <div key={item.rank} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-black w-5 text-center ${item.rank <= 2 ? 'text-purple-600' : 'text-slate-300'}`}>{item.rank}</span>
                      <span className="text-sm font-bold text-slate-700">{item.text}</span>
                    </div>
                    {item.trend === 'up' ? (
                      <span className="text-xs font-bold text-emerald-500">▲</span>
                    ) : (
                      <span className="text-xs font-bold text-rose-400">▼</span>
                    )}
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

export default NaverCategoryRankings;
