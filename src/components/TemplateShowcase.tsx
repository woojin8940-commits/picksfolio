
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Grid, List, CheckCircle2 } from 'lucide-react';

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
          {/* Mobile Mockup */}
          <div className="relative flex justify-center">
            <div className="w-[200px] h-[400px] md:w-[230px] md:h-[460px] bg-[#050505] rounded-[2rem] md:rounded-[2.5rem] border-[6px] md:border-[8px] border-[#1A1D26] shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden relative">
              {/* Mockup Content */}
              <div className="p-4 pt-12 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-primary to-blue-secondary"></div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1">
                      picks_official <CheckCircle2 className="w-3 h-3 text-blue-400 fill-blue-400" />
                    </div>
                    <div className="text-[10px] text-slate-500">Daily Curator & Lifestyle ✨</div>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="flex-1"
                  >
                    {activeTab === 'shoppable' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="aspect-[3/4] bg-slate-800 rounded-xl relative overflow-hidden group">
                          <img src="https://picsum.photos/seed/p1/300/400" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <div className="absolute bottom-2 left-2 bg-white/20 backdrop-blur-md text-[8px] font-bold px-2 py-1 rounded-full text-white">ITEM 5</div>
                        </div>
                        <div className="aspect-[3/4] bg-slate-800 rounded-xl relative overflow-hidden">
                          <img src="https://picsum.photos/seed/p2/300/400" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <div className="absolute top-2 right-2 bg-white/20 backdrop-blur-md text-[8px] font-bold px-2 py-1 rounded-full text-white">ITEM 2</div>
                        </div>
                        <div className="aspect-[3/4] bg-slate-800 rounded-xl relative overflow-hidden">
                          <img src="https://picsum.photos/seed/p3/300/400" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          <div className="absolute bottom-2 left-2 bg-white/20 backdrop-blur-md text-[8px] font-bold px-2 py-1 rounded-full text-white">ITEM 3</div>
                        </div>
                        <div className="aspect-[3/4] bg-slate-800 rounded-xl relative overflow-hidden">
                          <img src="https://picsum.photos/seed/p4/300/400" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-4 border border-white/5">
                          <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden">
                            <img src="https://picsum.photos/seed/m1/100/100" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-bold text-white">Spring Windbreaker</div>
                            <div className="text-[8px] text-blue-primary font-bold">picks-folio.com/product/1</div>
                          </div>
                        </div>
                        <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-4 border border-white/5">
                          <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden">
                            <img src="https://picsum.photos/seed/m2/100/100" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-bold text-white">Wide Denim Pants</div>
                            <div className="text-[8px] text-blue-primary font-bold">picks-folio.com/product/2</div>
                          </div>
                        </div>
                        <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-4 border border-white/5">
                          <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden">
                            <img src="https://picsum.photos/seed/m3/100/100" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-bold text-white">Salomon XT-6</div>
                            <div className="text-[8px] text-blue-primary font-bold">picks-folio.com/product/3</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
              {/* Home Indicator */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/20 rounded-full"></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TemplateShowcase;
