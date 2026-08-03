
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Grid, List, Briefcase, ExternalLink } from 'lucide-react';

interface TemplateShowcaseProps {
  onSignup: () => void;
  userName: string;
}

const templates = [
  {
    id: 'shoppable',
    name: '쇼퍼블 그리드',
    icon: Grid,
    description: '인스타그램 피드와 상품 정보를 하나로',
    title: '쇼퍼블 그리드',
    subtitle: '인스타그램 피드와 동일한 경험을 제공합니다. 클릭 시 상품 정보가 하단에서 스윽 올라옵니다.',
    features: ['인스타 피드 동기화', '상품 정보 오버레이', '끊김 없는 쇼핑 경험']
  },
  {
    id: 'minimal',
    name: '미니멀 브랜드',
    icon: List,
    description: '깔끔하고 정돈된 브랜드 아이덴티티',
    title: '미니멀 브랜드',
    subtitle: '브랜드 공식 사이트와 동일한 경험을 제공합니다. 클릭 시 브랜드 스토리가 하단에서 스윽 올라옵니다.',
    features: ['미니멀 디자인', '브랜드 스토리텔링', '깔끔한 상품 목록']
  },
];

const ACCENT = '#2563EB';
const SCREEN_BG = '#1E1E2E';

/** 실제 공개 페이지(UserPage)의 dense 그리드와 동일한 span 규칙: 1=풀폭, 2=1/2, 3=1/3 */
const gridItems = [
  { seed: 'pfg1', span: 3, title: 'Spring Layering', category: 'FASHION', count: 4 },
  { seed: 'pfg2', span: 3, title: 'Daily Glow Kit', category: 'BEAUTY', count: 3 },
  { seed: 'pfg3', span: 2, title: 'Desk Setup', category: 'LIFE', count: 5 },
  { seed: 'pfg4', span: 2, title: 'Running Gear', category: 'SPORTS', count: 2 },
  { seed: 'pfg5', span: 2, title: 'Cafe Picks', category: 'FOOD', count: 6 },
];

const minimalItems = [
  { seed: 'pfm1', name: 'Spring Windbreaker' },
  { seed: 'pfm2', name: 'Wide Denim Pants' },
  { seed: 'pfm3', name: 'Salomon XT-6' },
  { seed: 'pfm4', name: 'Cotton Half Zip-up' },
  { seed: 'pfm5', name: 'Leather Card Wallet' },
];

const categories = ['전체', 'FASHION', 'BEAUTY', 'LIFE'];

const TemplateShowcase: React.FC<TemplateShowcaseProps> = () => {
  const [activeTab, setActiveTab] = useState('shoppable');

  return (
    <section className="py-8 md:py-16 bg-background">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="text-center mb-6 md:mb-10">
          <h2 className="text-xl md:text-5xl font-black text-white mb-3 md:mb-6 font-display tracking-tighter">
            당신의 무드에 맞는 2가지 템플릿
          </h2>
          <p className="text-sm md:text-base text-slate-400 font-medium">
            콘텐츠 성격에 따라 가장 효과적인 레이아웃을 선택하세요.
          </p>
        </div>

        <div className="flex justify-center mb-6 md:mb-10">
          <div className="inline-flex p-1.5 bg-[#11141D] rounded-2xl border border-white/5">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setActiveTab(template.id)}
                className={`flex items-center gap-2 md:gap-3 px-4 py-2.5 md:px-6 md:py-3 rounded-xl text-sm md:text-base font-bold transition-all ${
                  activeTab === template.id
                    ? 'bg-gradient-to-r from-blue-primary to-blue-secondary text-white shadow-lg'
                    : 'text-slate-500 hover:text-white'
                }`}
              >
                <template.icon className="w-4 h-4 md:w-5 md:h-5" />
                {template.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-center">
          {/* Mobile Mockup — 실제 공개 페이지와 동일한 구성으로 렌더링한다. */}
          <div className="relative flex justify-center">
            <div
              className="relative w-[300px] md:w-[380px] aspect-[9/19.5] bg-[#050505] rounded-[2.5rem] md:rounded-[3rem] border-[8px] md:border-[10px] border-[#1A1D26] shadow-[0_0_120px_rgba(37,99,235,0.15)] overflow-hidden"
            >
              <div className="w-full h-full flex flex-col overflow-hidden" style={{ backgroundColor: SCREEN_BG }}>
                {/* Cover Header — 실제 페이지와 동일한 4:5 커버 + 하단 페이드 */}
                <div className="relative aspect-[4/5] flex-shrink-0">
                  <img
                    src="https://picsum.photos/seed/pfcover/720/900"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    alt=""
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: `linear-gradient(to top, ${SCREEN_BG} 0%, ${SCREEN_BG}88 18%, transparent 50%)` }}
                  />
                  {/* Dynamic Island */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-4 md:w-20 md:h-5 bg-black rounded-full" />
                  <div className="absolute bottom-3 left-4 right-4">
                    <h3 className="text-lg md:text-xl font-black tracking-tighter text-white mb-0.5">picks_official</h3>
                    <p className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: ACCENT }}>
                      Daily Curator & Lifestyle
                    </p>
                  </div>
                </div>

                {/* Action Buttons — 실제 페이지 헤더의 버튼 세트 */}
                <div className="flex gap-1.5 px-3 pt-2 pb-1 justify-center flex-wrap flex-shrink-0">
                  <span
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[8px] md:text-[9px] font-bold text-white whitespace-nowrap"
                    style={{ backgroundColor: ACCENT }}
                  >
                    <Briefcase size={9} strokeWidth={2.5} />
                    비즈니스 제안
                  </span>
                </div>

                {/* Curation Section Header */}
                <div className="px-3 pt-2.5 pb-1.5 flex-shrink-0">
                  <div className="flex justify-between items-end">
                    <div>
                      <h4 className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.15em] mb-0.5" style={{ color: ACCENT }}>
                        My Curations
                      </h4>
                      <h3 className="text-xs md:text-sm font-black tracking-tighter text-white">Explore My Picks</h3>
                    </div>
                    <div className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-white/20">
                      {activeTab === 'shoppable' ? gridItems.length : minimalItems.length} Items
                    </div>
                  </div>
                </div>

                {/* Category Tabs */}
                <div className="px-3 pb-2 flex gap-1.5 overflow-hidden flex-shrink-0">
                  {categories.map((cat) => (
                    <span
                      key={cat}
                      className={`px-2 py-0.5 text-[8px] md:text-[9px] font-black whitespace-nowrap rounded-full border ${
                        cat === '전체' ? 'text-white border-transparent' : 'bg-white/10 border-white/20 text-white/50'
                      }`}
                      style={cat === '전체' ? { backgroundColor: ACCENT } : {}}
                    >
                      {cat}
                    </span>
                  ))}
                </div>

                {/* Content — 탭에 따라 실제 템플릿과 동일한 레이아웃 */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3 }}
                      className="h-full"
                    >
                      {activeTab === 'shoppable' ? (
                        /* 쇼퍼블 그리드: 6칼럼 dense 그리드 + 상품 수 배지 + 하단 그라데이션 캡션 */
                        <div className="px-2 pb-4">
                          <div
                            className="grid grid-flow-dense"
                            style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}
                          >
                            {gridItems.map((item) => (
                              <div
                                key={item.seed}
                                className="relative overflow-hidden aspect-square shadow-sm border border-white/5"
                                style={{ gridColumn: `span ${item.span}`, borderRadius: '1rem' }}
                              >
                                <img
                                  src={`https://picsum.photos/seed/${item.seed}/400/400`}
                                  className="w-full h-full object-cover opacity-90"
                                  referrerPolicy="no-referrer"
                                  alt=""
                                />
                                <div className="absolute top-2 right-2">
                                  <span className="bg-black/60 backdrop-blur-md text-[8px] font-black px-1.5 py-0.5 rounded-md text-white border border-white/10 shadow-lg">
                                    {item.count}
                                  </span>
                                </div>
                                <div className="absolute bottom-0 left-0 right-0 p-2.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                                  <div className="text-[9px] md:text-[10px] font-black truncate text-white uppercase tracking-tight">
                                    {item.title}
                                  </div>
                                  <div className="text-[7px] md:text-[8px] font-bold text-white/50 uppercase tracking-widest mt-0.5">
                                    {item.category}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        /* 미니멀 브랜드: 실제 페이지와 동일한 전체폭 상품 리스트 행 */
                        <div className="px-3 pb-4 space-y-2">
                          {minimalItems.map((item) => (
                            <div
                              key={item.seed}
                              className="flex items-center justify-between p-2.5 border bg-white/5 border-white/10 shadow-sm"
                              style={{ borderRadius: '1rem' }}
                            >
                              <div className="flex items-center gap-2.5 flex-1 min-w-0 mr-2">
                                <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                                  <img
                                    src={`https://picsum.photos/seed/${item.seed}/120/120`}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                    alt=""
                                  />
                                </div>
                                <span className="text-[10px] md:text-[11px] font-black truncate text-white">{item.name}</span>
                              </div>
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white"
                                style={{ backgroundColor: ACCENT }}
                              >
                                <ExternalLink size={10} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Home Indicator */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 md:w-32 h-1 bg-white/30 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TemplateShowcase;
