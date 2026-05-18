import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, RefreshCw, Sparkles, BarChart3, ArrowUpRight } from 'lucide-react';

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

const aiTrendInsights = [
  {
    keyword: '러닝코어',
    summary: '운동복을 일상복으로 재해석한 러닝코어 트렌드가 소셜 미디어에서 급부상 중',
    change: '+127%',
    tip: '러닝코어 룩북 콘텐츠 적용 시 클릭률 약 18% 상승 예측',
  },
  {
    keyword: '쿨톤 메이크업',
    summary: '쿨톤 기반 메이크업 키워드가 뷰티 카테고리 검색량 1위를 기록',
    change: '+89%',
    tip: '올리브영 쿨톤 제품 큐레이션으로 전환율 극대화 가능',
  },
  {
    keyword: '리조트웨어',
    summary: '초여름 시즌 리조트웨어 관련 검색이 전주 대비 대폭 상승',
    change: '+64%',
    tip: '해변/풀사이드 스타일링 콘텐츠 추천',
  },
];

const catStylesDark: Record<string, { dot: string; chip: string; border: string; gradient: string }> = {
  '50000000': { dot: 'bg-purple-400', chip: 'bg-purple-500/20 text-purple-300', border: 'border-purple-500/20', gradient: 'from-purple-600/10 to-transparent' },
  '50000002': { dot: 'bg-pink-400', chip: 'bg-pink-500/20 text-pink-300', border: 'border-pink-500/20', gradient: 'from-pink-600/10 to-transparent' },
};

const DataBoardSection: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [activeInsight, setActiveInsight] = useState(0);

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

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveInsight(prev => (prev + 1) % aiTrendInsights.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return '방금 전';
      if (diffMin < 60) return `${diffMin}분 전`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours}시간 전`;
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

  const insight = aiTrendInsights[activeInsight];

  return (
    <section className="py-16 md:py-32 bg-background relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-purple-primary/5 blur-[120px] rounded-full -z-10"></div>

      <div className="container mx-auto px-6">
        <div className="text-center mb-12 md:mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-full px-4 py-1.5 mb-6">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
              <span className="text-purple-300 text-xs font-bold">LIVE DATA</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-white mb-4 font-display tracking-tighter">
              실시간 트렌드 보드
            </h2>
            <p className="text-slate-400 font-medium max-w-lg mx-auto">
              무신사·올리브영 데이터 기반, 지금 가장 핫한 키워드와 상품 순위를 확인하세요.
            </p>
            {updatedAt && (
              <p className="text-slate-500 text-xs font-bold mt-3 flex items-center justify-center gap-1">
                <RefreshCw size={10} />
                업데이트: {formatTime(updatedAt)}
              </p>
            )}
          </motion.div>
        </div>

        {/* AI Trend Insight Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto mb-10 md:mb-16"
        >
          <div className="bg-gradient-to-br from-indigo-600/20 via-purple-600/10 to-transparent border border-purple-500/10 rounded-[2rem] p-6 md:p-10 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-purple-400" />
              <h3 className="text-white font-black text-sm md:text-lg">AI 트렌드 요약</h3>
              <span className="text-[10px] font-bold text-slate-500 ml-auto">현재 소셜 미디어에서 가장 핫한 패션 키워드 분석</span>
            </div>

            <div className="min-h-[100px]">
              <motion.div
                key={activeInsight}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
              >
                <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl md:text-3xl font-black text-gradient">#{insight.keyword}</span>
                      <span className="text-emerald-400 text-sm font-black bg-emerald-400/10 px-2 py-0.5 rounded-lg">{insight.change}</span>
                    </div>
                    <p className="text-slate-300 font-medium text-sm md:text-base mb-3">{insight.summary}</p>
                    <div className="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-2 w-fit">
                      <BarChart3 className="w-4 h-4 text-purple-400" />
                      <span className="text-purple-300 text-xs font-bold">{insight.tip}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            <div className="flex gap-2 mt-6">
              {aiTrendInsights.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveInsight(idx)}
                  className={`h-1.5 rounded-full transition-all ${idx === activeInsight ? 'bg-purple-500 w-8' : 'bg-white/10 w-4 hover:bg-white/20'}`}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Category Rankings */}
        {categories.length > 1 ? (
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

        {/* Refresh Button */}
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
