import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, RefreshCw } from 'lucide-react';

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

const fallbackKeywords: CategoryItem[] = [
  { rank: 1, text: '바람막이 코디', trend: 'up' },
  { rank: 2, text: '올리브영 세일 추천', trend: 'up' },
  { rank: 3, text: '와이드 데님 팬츠', trend: 'down' },
  { rank: 4, text: '살로몬 XT-6', trend: 'up' },
  { rank: 5, text: '봄 자켓 추천', trend: 'up' },
];

const catStylesDark: Record<string, { dot: string; chip: string; border: string }> = {
  '50000000': { dot: 'bg-purple-400', chip: 'bg-purple-500/20 text-purple-300', border: 'border-purple-500/20' },
  '50000002': { dot: 'bg-pink-400', chip: 'bg-pink-500/20 text-pink-300', border: 'border-pink-500/20' },
};

const DataBoardSection: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/.netlify/functions/api-naver-category-rankings');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        if (data.updatedAt) setUpdatedAt(data.updatedAt);
      }
    } catch (err) {
      console.error('Failed to fetch homepage trend data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

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

  const displayKeywords = categories.length > 0
    ? categories[0].items
    : fallbackKeywords;

  return (
    <section className="py-16 md:py-24 bg-background">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-6 font-display tracking-tighter">
            실시간 트렌드 보드
          </h2>
          <p className="text-slate-400 font-medium">
            지금 가장 핫한 키워드와 상품 순위를 확인하세요.
          </p>
          {updatedAt && (
            <p className="text-slate-500 text-xs font-bold mt-2">업데이트: {formatTime(updatedAt)}</p>
          )}
        </div>

        {categories.length > 1 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {categories.map(cat => {
              const style = catStylesDark[cat.cid] || { dot: 'bg-slate-400', chip: 'bg-slate-500/20 text-slate-300', border: 'border-slate-500/20' };
              return (
                <div key={cat.cid} className="bg-surface rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl p-8">
                  <div className="flex items-center gap-2 mb-6 justify-center">
                    <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                    <h3 className="text-lg text-white font-black">{cat.name}</h3>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-2 ${style.chip}`}>TOP 5</span>
                  </div>
                  <div className="space-y-3">
                    {cat.items.map((k, idx) => (
                      <motion.div
                        key={k.rank}
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-gradient font-black text-lg w-6 text-center">{k.rank}</span>
                          <span className="text-white font-bold text-sm">{k.text}</span>
                        </div>
                        <div className={`text-xs font-bold px-3 py-1 rounded-full ${k.trend === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'}`}>
                          {k.trend === 'up' ? '▲' : '▼'}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto bg-surface rounded-[3rem] border border-white/5 overflow-hidden shadow-2xl">
            <div className="p-10">
              <div className="flex items-center gap-2 mb-10 justify-center">
                <TrendingUp className="w-6 h-6 text-purple-primary" />
                <h3 className="text-xl text-white font-black">실시간 급상승 키워드</h3>
              </div>

              <div className="space-y-4">
                {displayKeywords.map((k, idx) => (
                  <motion.div
                    key={k.rank}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="flex items-center justify-between p-5 bg-white/5 rounded-2xl hover:bg-white/10 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-6">
                      <span className="text-gradient font-black text-xl w-6">{k.rank}</span>
                      <span className="text-white font-bold text-lg">{k.text}</span>
                    </div>
                    <div className={`text-xs font-bold px-3 py-1 rounded-full ${k.trend === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'}`}>
                      {k.trend === 'up' ? '▲' : '▼'}
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-12 pt-10 border-t border-white/5 text-center">
                <button onClick={fetchData} disabled={loading}
                  className="text-slate-500 font-bold hover:text-white transition-colors flex items-center gap-2 mx-auto disabled:opacity-50">
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                  실시간 분석 업데이트
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default DataBoardSection;
