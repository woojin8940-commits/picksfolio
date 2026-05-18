
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

const TemplateShowcase: React.FC<TemplateShowcaseProps> = ({ onSignup }) => {
  const [activeTab, setActiveTab] = useState('shoppable');
  const activeTemplate = templates.find(t => t.id === activeTab)!;

  return (
    <section className="py-32 bg-background">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-6 font-display tracking-tighter">
            당신의 무드에 맞는 2가지 템플릿
          </h2>
          <p className="text-slate-400 font-medium">
            콘텐츠 성격에 따라 가장 효과적인 레이아웃을 선택하세요.
          </p>
        </div>

        <div className="flex justify-center mb-20">
          <div className="inline-flex p-1.5 bg-[#11141D] rounded-2xl border border-white/5">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setActiveTab(template.id)}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                  activeTab === template.id 
                    ? 'bg-gradient-to-r from-purple-primary to-purple-secondary text-white shadow-lg' 
                    : 'text-slate-500 hover:text-white'
                }`}
              >
                <template.icon className="w-4 h-4" />
                {template.name}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Mobile Mockup */}
          <div className="relative flex justify-center lg:justify-end">
            <div className="w-[320px] h-[640px] bg-[#050505] rounded-[3rem] border-[8px] border-[#1A1D26] shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden relative">
              {/* Mockup Content */}
              <div className="p-4 pt-12 h-full flex flex-col">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-primary to-purple-secondary"></div>
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-1">
                      picks_official <CheckCircle2 className="w-3 h-3 text-purple-400 fill-purple-400" />
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
                            <div className="text-[8px] text-purple-primary font-bold">picks.me/product/1</div>
                          </div>
                        </div>
                        <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-4 border border-white/5">
                          <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden">
                            <img src="https://picsum.photos/seed/m2/100/100" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-bold text-white">Wide Denim Pants</div>
                            <div className="text-[8px] text-purple-primary font-bold">picks.me/product/2</div>
                          </div>
                        </div>
                        <div className="bg-white/5 rounded-2xl p-3 flex items-center gap-4 border border-white/5">
                          <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden">
                            <img src="https://picsum.photos/seed/m3/100/100" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-bold text-white">Salomon XT-6</div>
                            <div className="text-[8px] text-purple-primary font-bold">picks.me/product/3</div>
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

          {/* Template Info */}
          <div className="text-left">
            <div className="flex items-center gap-2 text-purple-primary font-bold text-xs uppercase tracking-widest mb-4">
              <Grid className="w-4 h-4" />
              TEMPLATE STYLE
            </div>
            
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
              >
                <h3 className="text-4xl font-black text-white mb-6 font-display">
                  {activeTemplate.title}
                </h3>
                <p className="text-slate-400 text-lg font-medium mb-10 leading-relaxed max-w-md">
                  {activeTemplate.subtitle}
                </p>

                <div className="space-y-4 mb-12">
                  {activeTemplate.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full border border-purple-primary flex items-center justify-center">
                        <CheckCircle2 className="w-3.5 h-3.5 text-purple-primary" />
                      </div>
                      <span className="text-white font-bold">{feature}</span>
                    </div>
                  ))}
                </div>

                <button 
                  onClick={onSignup}
                  className="bg-gradient-to-r from-purple-primary to-purple-secondary text-white hover:opacity-90 px-10 py-4 rounded-full text-lg font-bold transition-all active:scale-95 shadow-lg shadow-purple-primary/20"
                >
                  이 템플릿으로 시작
                </button>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TemplateShowcase;
