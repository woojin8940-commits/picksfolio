import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, ArrowUpRight, ArrowDownRight, Minus, Clock, BarChart3 } from 'lucide-react';

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
  '50000000': { accent: 'from-purple-500 to-purple-600', bg: 'bg-purple-500/10', text: 'text-purple-400', badge: 'bg-purple-500/20 text-purple-300' },
  '50000002': { accent: 'from-pink-500 to-pink-600', bg: 'bg-pink-500/10', text: 'text-pink-400', badge: 'bg-pink-500/20 text-pink-300' },
  '50000003': { accent: 'from-blue-500 to-blue-600', bg: 'bg-blue-500/10', text: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300' },
  '50000004': { accent: 'from-amber-500 to-amber-600', bg: 'bg-amber-500/10', text: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-300' },
  '50000006': { accent: 'from-green-500 to-green-600', bg: 'bg-green-500/10', text: 'text-green-400', badge: 'bg-green-500/20 text-green-300' },
  '50000008': { accent: 'from-teal-500 to-teal-600', bg: 'bg-teal-500/10', text: 'text-teal-400', badge: 'bg-teal-500/20 text-teal-300' },
};

const DEFAULT_COLOR = { accent: 'from-slate-500 to-slate-600', bg: 'bg-slate-500/10', text: 'text-slate-400', badge: 'bg-slate-500/20 text-slate-300' };

const FALLBACK_CATEGORIES: CategoryBlock[] = [
  {
    cid: '50000000', label: '패션의류',
    rankings: [
      { rank: 1, keyword: '반팔티', ratio: 100, delta: 15, trend: 'up' },
      { rank: 2, keyword: '린넨셔츠', ratio: 85, delta: 8, trend: 'up' },
      { rank: 3, keyword: '와이드팬츠', ratio: 72, delta: -3, trend: 'down' },
      { rank: 4, keyword: '스니커즈', ratio: 65, delta: 5, trend: 'up' },
      { rank: 5, keyword: '바람막이', ratio: 58, delta: 12, trend: 'up' },
    ],
  },
  {
    cid: '50000002', label: '화장품/미용',
    rankings: [
      { rank: 1, keyword: '선크림', ratio: 100, delta: 22, trend: 'up' },
      { rank: 2, keyword: '톤업크림', ratio: 78, delta: 10, trend: 'up' },
      { rank: 3, keyword: '클렌징오일', ratio: 65, delta: -1, trend: 'flat' },
      { rank: 4, keyword: '쿠션팩트', ratio: 55, delta: 4, trend: 'up' },
      { rank: 5, keyword: '립틴트', ratio: 48, delta: -5, trend: 'down' },
    ],
  },
  {
    cid: '50000003', label: '디지털/가전',
    rankings: [
      { rank: 1, keyword: '노트북', ratio: 100, delta: 18, trend: 'up' },
      { rank: 2, keyword: '무선이어폰', ratio: 82, delta: 6, trend: 'up' },
      { rank: 3, keyword: '태블릿', ratio: 70, delta: 3, trend: 'up' },
      { rank: 4, keyword: '스마트워치', ratio: 60, delta: -2, trend: 'flat' },
      { rank: 5, keyword: '로봇청소기', ratio: 45, delta: 9, trend: 'up' },
    ],
  },
  {
    cid: '50000004', label: '가구/인테리어',
    rankings: [
      { rank: 1, keyword: '소파', ratio: 100, delta: 7, trend: 'up' },
      { rank: 2, keyword: '매트리스', ratio: 88, delta: 11, trend: 'up' },
      { rank: 3, keyword: '책상', ratio: 72, delta: -4, trend: 'down' },
      { rank: 4, keyword: '조명', ratio: 60, delta: 2, trend: 'flat' },
      { rank: 5, keyword: '커튼', ratio: 50, delta: 14, trend: 'up' },
    ],
  },
  {
    cid: '50000006', label: '식품',
    rankings: [
      { rank: 1, keyword: '닭가슴살', ratio: 100, delta: 20, trend: 'up' },
      { rank: 2, keyword: '프로틴', ratio: 85, delta: 16, trend: 'up' },
      { rank: 3, keyword: '커피', ratio: 75, delta: 1, trend: 'flat' },
      { rank: 4, keyword: '과일', ratio: 62, delta: -6, trend: 'down' },
      { rank: 5, keyword: '견과류', ratio: 50, delta: 3, trend: 'up' },
    ],
  },
  {
    cid: '50000008', label: '생활/건강',
    rankings: [
      { rank: 1, keyword: '비타민', ratio: 100, delta: 13, trend: 'up' },
      { rank: 2, keyword: '유산균', ratio: 90, delta: 8, trend: 'up' },
      { rank: 3, keyword: '칫솔', ratio: 68, delta: -2, trend: 'flat' },
      { rank: 4, keyword: '세제', ratio: 55, delta: 5, trend: 'up' },
      { rank: 5, keyword: '영양제', ratio: 48, delta: 10, trend: 'up' },
    ],
  },
];

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
          if (filtered.length >= 4) {
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
    <section className="py-16 md:py-32 bg-background">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="text-center mb-10 md:mb-16">
          <h2 className="text-2xl md:text-7xl font-black text-white mb-4 md:mb-8 font-display tracking-tighter">
            실시간 트렌드 보드
          </h2>
          <p className="text-sm md:text-xl text-slate-400 font-medium mb-3">
            네이버 데이터랩 쇼핑인사이트 분야별 인기검색어 TOP 5
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 bg-purple-500/20 text-purple-300 text-[10px] md:text-xs font-bold px-3 py-1 rounded-full">
              <Clock size={12} /> 매일 오후 2시 업데이트
            </span>
            {updatedAt && (
              <span className="flex items-center gap-1.5 bg-white/10 text-slate-400 text-[10px] md:text-xs font-bold px-3 py-1 rounded-full">
                <Clock size={12} /> {formatTime(updatedAt)} 기준
              </span>
            )}
          </div>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {loading && categories.length === 0 ? (
            <div className="col-span-full bg-surface rounded-2xl border border-white/5 p-8 text-center">
              <p className="text-slate-500 font-bold text-sm">데이터를 불러오는 중...</p>
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
                  <div className="p-5 md:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-xl ${color.bg} flex items-center justify-center`}>
                          <BarChart3 size={16} className={color.text} />
                        </div>
                        <h3 className="text-white font-black text-sm md:text-base">{cat.label}</h3>
                      </div>
                      <span className={`text-[9px] md:text-[10px] font-black px-2.5 py-1 rounded-full ${color.badge}`}>
                        TOP 5
                      </span>
                    </div>

                    <div className="space-y-1">
                      {cat.rankings.slice(0, 5).map((item) => (
                        <div
                          key={`${cat.cid}-${item.rank}`}
                          className="flex items-center justify-between p-2.5 md:p-3 rounded-xl hover:bg-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`w-5 text-center text-xs font-black tabular-nums ${item.rank <= 3 ? 'text-white' : 'text-slate-500'}`}>
                              {item.rank}
                            </span>
                            <span className="text-xs md:text-sm font-bold text-slate-300 truncate">
                              {item.keyword}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {item.trend === 'up' && (
                              <>
                                <ArrowUpRight size={12} className="text-emerald-400" />
                                <span className="text-[10px] font-black text-emerald-400 tabular-nums">
                                  +{item.delta}%
                                </span>
                              </>
                            )}
                            {item.trend === 'down' && (
                              <>
                                <ArrowDownRight size={12} className="text-red-400" />
                                <span className="text-[10px] font-black text-red-400 tabular-nums">
                                  {item.delta}%
                                </span>
                              </>
                            )}
                            {item.trend === 'flat' && (
                              <>
                                <Minus size={12} className="text-slate-500" />
                                <span className="text-[10px] font-black text-slate-500 tabular-nums">
                                  {item.delta >= 0 ? '+' : ''}{item.delta}%
                                </span>
                              </>
                            )}
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
