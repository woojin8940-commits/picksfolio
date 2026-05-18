import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, ExternalLink } from 'lucide-react';

const keywords = [
  { rank: 1, text: '바람막이 코디', trend: 'up' },
  { rank: 2, text: '올리브영 세일 추천', trend: 'up' },
  { rank: 3, text: '와이드 데님 팬츠', trend: 'down' },
  { rank: 4, text: '살로몬 XT-6', trend: 'up' },
  { rank: 5, text: '봄 자켓 추천', trend: 'up' },
];

const DataBoardSection: React.FC = () => {
  return (
    <section className="py-32 bg-background">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-6 font-display tracking-tighter">
            실시간 트렌드 보드
          </h2>
          <p className="text-slate-400 font-medium">
            지금 가장 핫한 키워드와 상품 순위를 확인하세요.
          </p>
        </div>

        <div className="max-w-2xl mx-auto bg-surface rounded-[3rem] border border-white/5 overflow-hidden shadow-2xl">
          <div className="p-10">
            <div className="flex items-center gap-2 mb-10 justify-center">
              <TrendingUp className="w-6 h-6 text-purple-primary" />
              <h3 className="text-xl text-white font-black">실시간 급상승 키워드</h3>
            </div>
            
            <div className="space-y-4">
              {keywords.map((k) => (
                <motion.div 
                  key={k.rank} 
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: k.rank * 0.1 }}
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
              <button className="text-slate-500 font-bold hover:text-white transition-colors flex items-center gap-2 mx-auto">
                전체 순위 더보기 <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DataBoardSection;
