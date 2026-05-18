import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, RefreshCw, ArrowUpRight } from 'lucide-react';

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
  { rank: 1, text: '러닝코어 룩북', trend: 'up' },
  { rank: 2, text: '올리브영 여름 세일 추천', trend: 'up' },
  { rank: 3, text: '린넨 와이드 팬츠', trend: 'up' },
  { rank: 4, text: '무신사 여름 신상', trend: 'up' },
  { rank: 5, text: '쿨톤 블러셔 추천', trend: 'down' },
];

const catStylesDark: Record<string, { dot: string; chip: string; border: string; gradient: string }> = {
  '50000000': { dot: 'bg-purple-400', chip: 'bg-purple-500/20 text-purple-300', border: 'border-purple-500/20', gradient: 'from-purple-600/10 to-transparent' },
  '50000002': { dot: 'bg-pink-400', chip: 'bg-pink-500/20 text-pink-300', border: 'border-pink-500/20', gradient: 'from-pink-600/10 to-transparent' },
};

const DataBoardSection: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/.netlify/functions/api-naver-category-rankings');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      } else {
        setError(true);
      }
    } catch (err) {
      console.error('Failed to fetch homepage trend data', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const displayKeywords = categories.length > 0
    ? categories[0].items
    : fallbackKeywords;

  return (
    <section className="py-16 md:py-32 bg-background relative overflow-hidden">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12 md:mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-5xl font-black text-white mb-4 font-display tracking-tighter">
              <span className="underline decoration-purple-primary decoration-4 underline-offset-8">실시간 트렌드 보드</span>
            </h2>
            <p className="text-slate-400 font-medium max-w-lg mx-auto mt-6">
              지금 가장 핫한 키워드와 상품 순위를 확인하세요.
            </p>
          </motion.div>
        </div>

        {error ? (
          <div className="max-w-2xl mx-auto bg-surface rounded-[2rem] border border-white/5 p-8 md:p-10 text-center">
            <p className="text-orange-400 font-bold text-sm">네트워크 오류가 발생했습니다.</p>
          </div>
        ) : categories.length > 1 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-10">
            {categories.map((cat, catIdx) => {
              const style = catStylesDark[cat.cid] || { dot: 'bg-slate-400', chip: 'bg-slate-500/20 text-slate-300', border: 'border-slate-500/20', gradient: 'from-slate-600/10 to-transparent' };
              return (
                <motion.div
                  key={cat.cid}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: catIdx * 0.15 }}
                  viewport={{ once: true }}
                  className={`bg-gradient-to-b ${style.gradient} bg-surface rounded-[2rem] border border-white/5 overflow-hidden shadow-2xl p-6 md:p-8`}
                >
                  <div className="flex items-center gap-2 mb-6 justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${style.dot} animate-pulse`} />
                      <h3 className="text-lg text-white font-black">{cat.name}</h3>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${style.chip}`}>실시간 TOP 5</span>
                  </div>
                  <div className="space-y-3">
                    {cat.items.map((k, idx) => (
                      <motion.div
                        key={k.rank}
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.08 }}
                        viewport={{ once: true }}
                        className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-4">
                          <span className={`font-black text-lg w-6 text-center ${k.rank <= 3 ? 'text-gradient' : 'text-slate-500'}`}>{k.rank}</span>
                          <span className="text-white font-bold text-sm group-hover:text-purple-300 transition-colors">{k.text}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`text-xs font-bold px-2.5 py-1 rounded-full ${k.trend === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'}`}>
                            {k.trend === 'up' ? '▲' : '▼'}
                          </div>
                          <ArrowUpRight className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto bg-surface rounded-[2.5rem] border border-white/5 overflow-hidden shadow-2xl mb-10">
            <div className="p-8 md:p-10">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-purple-primary" />
                  <h3 className="text-lg md:text-xl text-white font-black">실시간 급상승 키워드</h3>
                </div>
                <span className="text-[9px] font-bold text-slate-500 bg-white/5 px-2.5 py-1 rounded-full">1시간마다 집계</span>
              </div>

              <div className="space-y-3">
                {displayKeywords.map((k, idx) => (
                  <motion.div
                    key={k.rank}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    viewport={{ once: true }}
                    className="flex items-center justify-between p-4 md:p-5 bg-white/5 rounded-2xl hover:bg-white/10 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-4 md:gap-6">
                      <span className={`font-black text-lg md:text-xl w-6 ${k.rank <= 3 ? 'text-gradient' : 'text-slate-500'}`}>{k.rank}</span>
                      <span className="text-white font-bold text-base md:text-lg group-hover:text-purple-300 transition-colors">{k.text}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`text-xs font-bold px-3 py-1 rounded-full ${k.trend === 'up' ? 'text-emerald-400 bg-emerald-400/10' : 'text-rose-400 bg-rose-400/10'}`}>
                        {k.trend === 'up' ? '▲' : '▼'}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="text-center">
          <button onClick={fetchData} disabled={loading}
            className="inline-flex items-center gap-2 text-slate-500 font-bold hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-6 py-3 rounded-full border border-white/5 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            실시간 분석 업데이트
          </button>
        </div>
      </div>
    </section>
  );
};

export default DataBoardSection;
