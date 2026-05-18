import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, MessageCircle, Video, Briefcase, BarChart3, Zap } from 'lucide-react';

interface FeatureShowcaseProps {
  onSignup: () => void;
}

const features = [
  {
    icon: TrendingUp,
    title: 'AI 트렌드 분석',
    description: '무신사·올리브영 실시간 데이터로 트렌드를 파악하고, AI가 최적의 콘텐츠 전략을 추천합니다.',
    highlight: '클릭률 약 15% 상승 예측',
    gradient: 'from-purple-600 to-indigo-600',
    glow: 'bg-purple-500/20',
  },
  {
    icon: MessageCircle,
    title: 'DM 자동화',
    description: '인스타그램 DM으로 들어오는 상품 문의에 AI가 자동으로 답변합니다. 24시간 자동 응답으로 전환율을 높이세요.',
    highlight: '하루 평균 42건 자동 응답',
    gradient: 'from-blue-600 to-cyan-600',
    glow: 'bg-blue-500/20',
  },
  {
    icon: Video,
    title: '라이브 커머스',
    description: '실시간 방송으로 팬들과 소통하며 상품을 판매하세요. 라이브 채팅과 실시간 판매 기능을 제공합니다.',
    highlight: '라이브 시작 시 카카오 알림톡 발송',
    gradient: 'from-rose-600 to-pink-600',
    glow: 'bg-rose-500/20',
  },
  {
    icon: Briefcase,
    title: '비즈니스 협업',
    description: '브랜드로부터 협업 제안을 받고, 캘린더로 일정을 관리하고, 정산까지 한번에 처리합니다.',
    highlight: '협업 일정·정산 통합 관리',
    gradient: 'from-emerald-600 to-teal-600',
    glow: 'bg-emerald-500/20',
  },
  {
    icon: BarChart3,
    title: '실시간 분석 대시보드',
    description: '방문자 수, 링크 클릭률, TOP 아이템을 실시간으로 확인하고 데이터 기반 의사결정을 하세요.',
    highlight: '1시간마다 자동 집계',
    gradient: 'from-amber-600 to-orange-600',
    glow: 'bg-amber-500/20',
  },
  {
    icon: Zap,
    title: '포트폴리오 & 소개 페이지',
    description: '나만의 스타일로 포트폴리오를 구성하고, 영상 커버와 디자인 테마로 브랜딩하세요.',
    highlight: '2가지 프리미엄 템플릿 제공',
    gradient: 'from-violet-600 to-purple-600',
    glow: 'bg-violet-500/20',
  },
];

const FeatureShowcase: React.FC<FeatureShowcaseProps> = ({ onSignup }) => {
  return (
    <section className="py-20 md:py-32 bg-background relative overflow-hidden">
      <div className="absolute bottom-0 left-1/4 w-[600px] h-[400px] bg-purple-primary/5 blur-[120px] rounded-full -z-10"></div>

      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-16 md:mb-20"
        >
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-6">
            <Zap className="w-3 h-3 text-purple-400" />
            <span className="text-slate-400 text-xs font-bold">ALL-IN-ONE PLATFORM</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-white mb-6 font-display tracking-tighter">
            크리에이터를 위한<br className="md:hidden" /> 모든 도구
          </h2>
          <p className="text-slate-400 font-medium max-w-xl mx-auto">
            데이터 분석부터 콘텐츠 관리, 라이브 커머스, 비즈니스 협업까지.<br className="hidden md:block" />
            PICKS 하나로 수익을 극대화하세요.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 max-w-6xl mx-auto mb-16">
          {features.map((feature, idx) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1, duration: 0.5 }}
              viewport={{ once: true }}
              className="group relative bg-surface rounded-[1.5rem] md:rounded-[2rem] border border-white/5 p-6 md:p-8 hover:border-white/10 transition-all hover:-translate-y-1 cursor-pointer"
            >
              <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity rounded-t-[2rem]`}></div>

              <div className={`w-12 h-12 rounded-2xl ${feature.glow} flex items-center justify-center mb-5`}>
                <feature.icon className="w-6 h-6 text-white" />
              </div>

              <h3 className="text-lg font-black text-white mb-2">{feature.title}</h3>
              <p className="text-slate-400 text-sm font-medium leading-relaxed mb-4">{feature.description}</p>

              <div className="inline-flex items-center gap-1.5 bg-white/5 rounded-lg px-3 py-1.5">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
                <span className="text-emerald-400 text-[11px] font-bold">{feature.highlight}</span>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          viewport={{ once: true }}
          className="text-center"
        >
          <button
            onClick={onSignup}
            className="bg-gradient-to-r from-purple-primary to-purple-secondary text-white hover:opacity-90 px-10 py-4 rounded-full text-lg font-bold transition-all active:scale-95 shadow-lg shadow-purple-primary/20"
          >
            지금 무료로 시작하기
          </button>
          <p className="text-slate-500 text-xs font-medium mt-4">신용카드 없이 바로 시작할 수 있습니다</p>
        </motion.div>
      </div>
    </section>
  );
};

export default FeatureShowcase;
