import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Clock, BarChart3, LineChart } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { readTrendCache, writeTrendCache } from '../utils/trendCache';

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

/* 분야마다 파스텔 한 색. 홈이 종이색이라 예전의 형광 배지 대신 옅은 면과
   진한 글씨로 구분한다. */
const CATEGORY_COLORS: Record<string, { tint: string; icon: string; badge: string }> = {
  '50000000': { tint: '#EDF2FF', icon: '#2563EB', badge: '#2563EB' },
  '50000002': { tint: '#FCEBEF', icon: '#C4405F', badge: '#C4405F' },
  '50000003': { tint: '#E8F1FB', icon: '#1E6FA8', badge: '#1E6FA8' },
  '50000004': { tint: '#FDF4E3', icon: '#B4780B', badge: '#B4780B' },
  '50000006': { tint: '#E7F3EE', icon: '#0F9D6E', badge: '#0F9D6E' },
  '50000008': { tint: '#EAF2F3', icon: '#0E7C86', badge: '#0E7C86' },
};

const DEFAULT_COLOR = { tint: '#F1F3F9', icon: '#5B6382', badge: '#5B6382' };

const FALLBACK_CATEGORIES: CategoryBlock[] = [];

const DISPLAY_CIDS = ['50000000', '50000002', '50000003', '50000004', '50000006', '50000008'];

const CATEGORY_ENGLISH_NAMES: Record<string, string> = {
  '50000000': 'Fashion / Apparel',
  '50000002': 'Beauty / Cosmetics',
  '50000003': 'Digital / Appliances',
  '50000004': 'Furniture / Interior',
  '50000006': 'Food',
  '50000008': 'Living / Health',
};

const DataBoardSection: React.FC = () => {
  const { language } = useLanguage();
  const cachedTrend = readTrendCache<CategoryBlock>(language);
  const [categories, setCategories] = useState<CategoryBlock[]>(() => cachedTrend?.categories.slice(0, 6) || FALLBACK_CATEGORIES);
  const [updatedAt, setUpdatedAt] = useState<string | null>(() => cachedTrend?.updatedAt || null);
  const [loading, setLoading] = useState(() => !cachedTrend?.categories.length);

  useEffect(() => {
    const controller = new AbortController();
    const cached = readTrendCache<CategoryBlock>(language);
    const hasCached = Boolean(cached?.categories.length);
    if (hasCached) {
      setCategories(cached!.categories.slice(0, 6));
      setUpdatedAt(cached!.updatedAt || null);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const fetchData = async () => {
      if (!hasCached) setLoading(true);
      try {
        const res = await fetch(`/.netlify/functions/api-naver-category-rankings?lang=${language}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          const apiCategories: CategoryBlock[] = data.categories || [];
          const filtered = apiCategories.filter((c) => DISPLAY_CIDS.includes(c.cid));
          if (filtered.length > 0) {
            setCategories(filtered.slice(0, 6));
            if (data.updatedAt) setUpdatedAt(data.updatedAt);
            writeTrendCache(language, filtered, data.updatedAt || null);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) console.error('Failed to fetch trend data for home', err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    fetchData();
    return () => controller.abort();
  }, [language]);

  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch {
      return iso;
    }
  };

  const en = language === 'en';

  return (
    <section className="relative py-14 md:py-24 overflow-hidden">
      {/* 트렌드 보드는 종이보다 살짝 밝은 면 위에 올려 앞 섹션과 구분한다. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-white" />
      <div aria-hidden className="absolute inset-0 -z-10 home-dotgrid opacity-40" />

      <div className="container mx-auto px-4 sm:px-6">
        <div className="text-center mb-9 md:mb-14">
          <span className="text-[11px] md:text-xs font-black tracking-[0.25em] text-[#2563EB]">LIVE TREND</span>
          <h2 className="mt-3 text-[1.5rem] leading-tight md:text-[3rem] md:leading-[1.1] font-black text-[#0B0F1A] font-display tracking-tighter">
            {en ? 'Real-Time Trend Board' : '실시간 트렌드 보드'}
          </h2>
          <p className="mt-3 text-sm md:text-lg text-[#4A5273] font-medium">
            {en ? 'Naver DataLab Shopping Insights Top 5 Search Keywords' : '네이버 데이터랩 쇼핑인사이트 분야별 인기검색어 TOP 5'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 bg-[#EDF2FF] text-[#2563EB] text-[10px] md:text-xs font-black px-3 py-1.5 rounded-full">
              <Clock size={12} strokeWidth={2.6} /> {en ? 'Updated daily at 2 PM' : '매일 오후 2시 업데이트'}
            </span>
            {updatedAt && (
              <span className="inline-flex items-center gap-1.5 bg-[#F1F3F9] text-[#5B6382] text-[10px] md:text-xs font-black px-3 py-1.5 rounded-full">
                <Clock size={12} strokeWidth={2.6} /> {en ? `As of ${formatTime(updatedAt)}` : `${formatTime(updatedAt)} 기준`}
              </span>
            )}
          </div>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-5">
          {loading ? (
            /* 불러오는 동안에는 카드와 같은 모양의 자리를 그려 둔다. 데이터가
               들어와도 레이아웃이 흔들리지 않는다. */
            Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={`skeleton-${idx}`}
                className="bg-white rounded-2xl md:rounded-[2rem] border border-[#0B0F1A]/[0.07] p-2.5 sm:p-3 md:p-6 animate-pulse"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl bg-[#EFF1F7]" />
                  <div className="h-3 md:h-4 w-20 md:w-28 rounded-full bg-[#EFF1F7]" />
                </div>
                <div className="space-y-2 md:space-y-3">
                  {Array.from({ length: 5 }).map((__, row) => (
                    <div key={row} className="flex items-center gap-2 md:gap-3">
                      <div className="w-4 h-3 rounded bg-[#F3F4F9]" />
                      <div className="h-3 rounded-full bg-[#F3F4F9]" style={{ width: `${72 - row * 8}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : categories.length === 0 ? (
            <div className="col-span-full bg-white rounded-[2rem] border border-[#0B0F1A]/[0.07] px-6 py-12 text-center shadow-[0_20px_50px_-40px_rgba(11,15,26,0.6)]">
              <span className="w-12 h-12 rounded-2xl bg-[#EDF2FF] flex items-center justify-center mx-auto mb-4">
                <LineChart size={22} className="text-[#2563EB]" strokeWidth={2.4} />
              </span>
              <p className="text-[#0B0F1A] font-black text-sm md:text-base">
                {en ? 'No trend data collected yet.' : '트렌드 데이터가 아직 수집되지 않았습니다.'}
              </p>
              <p className="mt-2 text-[#8B93AE] font-bold text-xs md:text-sm">
                {en ? 'The board fills in at the 2 PM update.' : '매일 오후 2시 업데이트에 채워집니다.'}
              </p>
            </div>
          ) : (
            categories.map((cat, catIdx) => {
              const color = CATEGORY_COLORS[cat.cid] ?? DEFAULT_COLOR;
              const label = en ? (CATEGORY_ENGLISH_NAMES[cat.cid] || cat.label) : cat.label;
              return (
                <motion.div
                  key={cat.cid}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: catIdx * 0.08, duration: 0.4 }}
                  className="bg-white rounded-2xl md:rounded-[2rem] border border-[#0B0F1A]/[0.07] overflow-hidden shadow-[0_24px_60px_-45px_rgba(11,15,26,0.75)]"
                >
                  <div className="p-2.5 sm:p-3 md:p-6">
                    <div className="flex items-center justify-between mb-3 md:mb-4">
                      <div className="flex items-center gap-1.5 md:gap-2.5 min-w-0">
                        <div
                          className="w-6 h-6 md:w-8 md:h-8 rounded-lg md:rounded-xl flex items-center justify-center shrink-0"
                          style={{ backgroundColor: color.tint }}
                        >
                          <BarChart3 size={14} style={{ color: color.icon }} strokeWidth={2.6} />
                        </div>
                        <h3 className="text-[#0B0F1A] font-black text-xs md:text-base leading-tight line-clamp-2">{label}</h3>
                      </div>
                      <span
                        className="hidden md:inline text-[9px] md:text-[10px] font-black px-2.5 py-1 rounded-full"
                        style={{ backgroundColor: color.tint, color: color.badge }}
                      >
                        TOP 5
                      </span>
                    </div>

                    <div className="space-y-0.5 md:space-y-1">
                      {cat.rankings.slice(0, 5).map((item) => (
                        <div
                          key={`${cat.cid}-${item.rank}`}
                          className="flex items-center justify-between px-1 py-1.5 sm:p-1.5 md:p-2.5 rounded-lg md:rounded-xl hover:bg-[#F6F7FC] transition-colors"
                        >
                          <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 min-w-0">
                            <span
                              className="w-4 h-4 md:w-5 md:h-5 rounded md:rounded-md text-center text-[10px] md:text-[11px] font-black tabular-nums flex items-center justify-center shrink-0"
                              style={
                                item.rank <= 3
                                  ? { backgroundColor: color.icon, color: '#FFFFFF' }
                                  : { backgroundColor: '#F1F3F9', color: '#98A0BC' }
                              }
                            >
                              {item.rank}
                            </span>
                            <span className="text-xs md:text-sm font-bold text-[#39415C] leading-tight line-clamp-2">
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

        <div className="text-center mt-7 md:mt-10">
          <p className="text-[#A6ADC6] text-[10px] md:text-xs font-bold">
            {en ? 'Source: Naver DataLab Shopping Insights' : '출처: 네이버 데이터랩 쇼핑인사이트'}
          </p>
        </div>
      </div>
    </section>
  );
};

export default DataBoardSection;
