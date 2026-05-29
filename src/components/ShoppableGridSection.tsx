import React from 'react';
import { motion } from 'motion/react';
import { Instagram, ShoppingBag, Layers } from 'lucide-react';

const ShoppableGridSection: React.FC = () => {
  return (
    <section className="py-16 md:py-32 bg-background overflow-hidden">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 md:gap-20 items-center">
          {/* Left: Mobile Mockup */}
          <motion.div 
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative"
          >
            <div className="relative w-[240px] md:w-[300px] aspect-[9/19] bg-surface rounded-[3rem] border-[8px] border-surface-light shadow-2xl mx-auto overflow-hidden">
              {/* Insta Feed Style Content */}
              <div className="p-4 border-b border-white/5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-yellow-400 to-blue-primary"></div>
                <div className="w-24 h-3 bg-white/10 rounded-full"></div>
              </div>
              <div className="grid grid-cols-3 gap-1 p-1">
                {[...Array(9)].map((_, i) => (
                  <div key={i} className="aspect-square bg-surface-light relative group">
                    <div className="absolute inset-0 bg-blue-primary/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    {i === 0 && (
                      <div className="absolute bottom-1 right-1">
                        <ShoppingBag className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Floating Product Tag */}
              <motion.div 
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity }}
                className="absolute top-1/2 left-1/2 bg-white text-black px-4 py-2 rounded-full text-[10px] font-bold shadow-xl flex items-center gap-2"
              >
                <div className="w-4 h-4 bg-blue-primary rounded-full"></div>
                MUSINSA Item #241
              </motion.div>
            </div>
            
            {/* Decorative Elements */}
            <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-primary/20 blur-3xl rounded-full -z-10"></div>
          </motion.div>

          {/* Right: Feature Description */}
          <motion.div 
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="space-y-10"
          >
            <div>
              <h2 className="text-2xl md:text-7xl font-black text-white mb-4 md:mb-8 leading-tight font-display">
                인스타 피드 동기화,<br />
                <span className="text-blue-primary">쇼퍼블 그리드</span>
              </h2>
              <p className="text-slate-400 text-sm md:text-2xl leading-relaxed font-medium">
                인스타그램 피드를 실시간으로 불러오고,<br />
                각 포스트에 상품 정보를 오버레이하여 나만의 샵을 완성하세요.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
              <div className="p-5 md:p-8 bg-surface rounded-2xl border border-white/5">
                <Instagram className="w-8 h-8 md:w-10 md:h-10 text-blue-primary mb-4 md:mb-5" />
                <h3 className="text-white font-bold text-base md:text-xl mb-2 md:mb-3">실시간 동기화</h3>
                <p className="text-slate-500 text-sm md:text-lg">인스타그램 포스팅이 즉시 페이지에 반영됩니다.</p>
              </div>
              <div className="p-5 md:p-8 bg-surface rounded-2xl border border-white/5">
                <Layers className="w-8 h-8 md:w-10 md:h-10 text-blue-primary mb-4 md:mb-5" />
                <h3 className="text-white font-bold text-base md:text-xl mb-2 md:mb-3">상품 오버레이</h3>
                <p className="text-slate-500 text-sm md:text-lg">이미지 위로 상품 가격과 링크를 감각적으로 노출합니다.</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default ShoppableGridSection;
