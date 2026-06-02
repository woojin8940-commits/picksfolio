import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Clock, BarChart3 } from 'lucide-react';

interface RankingItem {
  rank: number;
  keyword: string;
  ratio: number;
  delta: number;
  trend: 'up' | 'down' | 'flat';
}

interface CategoryBlock {
  cid: string;
  label: string;
  rankings: RankingItem[];
}

const CATEGORY_COLORS: Record<string, { accent: string; bg: string; text: string; badge: string }> = {
  '50000000': { accent: 'from-blue-500 to-blue-600', bg: 'bg-blue-500/10', text: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300' },
  '50000002': { accent: 'from-pink-500 to-pink-600', bg: 'bg-pink-500/10', text: 'text-pink-400', badge: 'bg-pink-500/20 text-pink-300' },
  '50000003': { accent: 'from-blue-500 to-blue-600', bg: 'bg-blue-500/10', text: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300' },
  '50000004': { accent: 'from-amber-500 to-amber-600', bg: 'bg-amber-500/10', text: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-300' },
  '50000006': { accent: 'from-green-500 to-green-600', bg: 'bg-green-500/10', text: 'text-green-400', badge: 'bg-green-500/20 text-green-300' },
  '50000008': { accent: 'from-teal-500 to-teal-600', bg: 'bg-teal-500/10', text: 'text-teal-400', badge: 'bg-teal-500/20 text-teal-300' },
};

const DEFAULT_COLOR = { accent: 'from-slate-500 to-slate-600', bg: 'bg-slate-500/10', text: 'text-slate-400', badge: 'bg-slate-500/20 text-slate-300' };

const FALLBACK_CATEGORIES: CategoryBlock[] = [];

const DISPLAY_CIDS = ['50000000', '50000002', '50000003', '50000004', '50000006', '50000008'];

const DataBoardSection: React.FC = () => {
  const [categories, setCategories] = useState<CategoryBlock[]>(FALLBACK_CATEGORIES);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/.netlify/functions/api-naver-category-rankings');
        if (res.ok) {
          const data = await res.json();
          const apiCategories: CategoryBlock[] = data.categories || [];
          const filtered = apiCategories.filter((c) => DISPLAY_CIDS.includes(c.cid));
          if (filtered.length > 0) {
            setCategories(filtered.slice(0, 6));
            if (data.updatedAt) setUpdatedAt(data.updatedAt);
          }
        }
      } catch (err) {
        console.error('Failed to fetch trend data for home', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      return iso;
    }
  };

  return (
    <section className="py-12 md:py-24 bg-background">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-xl md:text-5xl font-black text-white mb-3 md:mb-6 font-display tracking-tighter">
            실시간 트렌드 보드
          </h2>
          <p className="text-sm md:text-base text-slate-400 font-medium mb-3">
            네이버 데이터랩 쇼핑인사이트 분야별 인기검색어 TOP 5
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 bg-blue-500/20 text-blue-300 text-[10px] md:text-xs font-bold px-3 py-1 rounded-full">
              <Clock size={12} /> 매일 오후 2시 업데이트
            </span>
            {updatedAt && (
              <span className="flex items-center gap-1.5 bg-white/10 text-slate-400 text-[10px] md:text-xs font-bold px-3 py-1 rounded-full">
                <Clock size={12} /> {formatTime(updatedAt)} 기준
              </span>
            )}
          </div>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-5">
          {loading ? (
            <div className="col-span-full bg-surface rounded-2xl border border-white/5 p-8 text-center">
              <p className="text-slate-500 font-bold text-sm">데이터를 불러오는 중...</p>
            </div>
          ) : categories.length === 0 ? (
            <div className="col-span-full bg-surface rounded-2xl border border-white/5 p-8 text-center">
              <p className="text-slate-500 font-bold text-sm">트렌드 데이터가 아직 수집되지 않았습니다. 매일 오후 2시에 업데이트됩니다.</p>
            </div>
          ) : (
            categories.map((cat, catIdx) => {
              const color = CATEGORY_COLORS[cat.cid] ?? DEFAULT_COLOR;
              return (
                <motion.div
                  key={cat.cid}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: catIdx * 0.08, duration: 0.4 }}
                  className="bg-surface rounded-2xl md:rounded-[2rem] border border-white/5 overflow-hidden shadow-xl"
                >
                  <div className="p-3 md:p-6">
                    <div className="flex items-center justify-between mb-3 md:mb-4">
                      <div className="flex items-center gap-1.5 md:gap-2.5 min-w-0">
                        <div className={`w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl ${color.bg} flex items-center justify-center shrink-0`}>
                          <BarChart3 size={14} className={color.text} />
                        </div>
                        <h3 className="text-white font-black text-xs md:text-base truncate">{cat.label}</h3>
                      </div>
                      <span className={`hidden md:inline text-[9px] md:text-[10px] font-black px-2.5 py-1 rounded-full ${color.badge}`}>
                        TOP 5
                      </span>
                    </div>

                    <div className="space-y-0.5 md:space-y-1">
                      {cat.rankings.slice(0, 5).map((item) => (
                        <div
                          key={`${cat.cid}-${item.rank}`}
                          className="flex items-center justify-between p-1.5 md:p-3 rounded-lg md:rounded-xl hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-2 md:gap-3 min-w-0">
                            <span className={`w-4 md:w-5 text-center text-[11px] md:text-xs font-black tabular-nums ${item.rank <= 3 ? 'text-white' : 'text-slate-500'}`}>
                              {item.rank}
                            </span>
                            <span className="text-[11px] md:text-sm font-bold text-slate-300 truncate">
                              {item.keyword}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>

        <div className="text-center mt-6 md:mt-10">
          <p className="text-slate-600 text-[10px] md:text-xs font-medium">
            출처: 네이버 데이터랩 쇼핑인사이트
          </p>
        </div>
      </div>
    </section>
  );
};

export default DataBoardSection;
