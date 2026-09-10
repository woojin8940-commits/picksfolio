import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Package,
  Percent,
  Wallet,
  Search,
  UserCheck,
  Upload,
  Receipt,
  MessageSquare,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface CampaignShowcaseProps {
  onSignup?: () => void;
}

const CampaignShowcase: React.FC<CampaignShowcaseProps> = ({ onSignup }) => {
  const { language } = useLanguage();
  const en = language === 'en';

  /* 캠페인 보상 방식 세 가지. 캠페인 화면에서 실제로 구분해 보여주는 기준과
     같게 적는다(제품 협찬 / 판매 수수료 협의 / 확정 보수). */
  const rewardTypes = [
    {
      icon: Package,
      name: en ? 'Product sponsorship' : '제품 협찬',
      body: en
        ? 'Receive the product itself instead of an ad fee, with the required content agreed up front.'
        : '광고비 대신 제품을 제공받습니다. 만들어야 하는 콘텐츠는 미리 합의합니다.',
      chip: en ? 'No ad fee' : '광고비 없음',
      tint: '#EDF2FF',
      iconColor: '#2563EB',
    },
    {
      icon: Percent,
      name: en ? 'Sales commission' : '판매 수수료 협의',
      body: en
        ? 'Commerce campaigns where the rate is settled with your manager before the campaign starts.'
        : '커머스 캠페인은 담당자와 수수료 조건을 정한 뒤 시작합니다.',
      chip: en ? 'Commerce' : '커머스',
      tint: '#E7F3EE',
      iconColor: '#0F9D6E',
    },
    {
      icon: Wallet,
      name: en ? 'Fixed payout' : '확정 보수',
      body: en
        ? 'The amount is fixed when you are selected and paid once the activity is complete.'
        : '선정 시 금액이 확정되고, 활동을 마치면 그대로 지급됩니다.',
      chip: en ? 'Paid on completion' : '완료 시 지급',
      tint: '#FDF4E3',
      iconColor: '#B4780B',
    },
  ];

  /* 지원부터 정산까지 실제로 지나는 단계. 대시보드의 캠페인 · 캠페인 협업 ·
     정산 화면이 각각 이 단계를 맡는다. */
  const flow = [
    {
      icon: Search,
      title: en ? 'Find & apply' : '찾아서 지원',
      body: en ? 'Search recruiting campaigns by category and apply directly.' : '모집 중인 캠페인을 분야별로 찾아 바로 지원합니다.',
    },
    {
      icon: UserCheck,
      title: en ? 'Get selected' : '선정',
      body: en ? 'Selection and the agreed terms arrive in your dashboard.' : '선정 결과와 확정된 조건을 대시보드에서 받습니다.',
    },
    {
      icon: Upload,
      title: en ? 'Run the campaign' : '진행',
      body: en ? 'Each step, revision request and insight sits in one place.' : '단계별 진행과 수정 요청, 인사이트가 한자리에 모입니다.',
    },
    {
      icon: Receipt,
      title: en ? 'Settle up' : '정산',
      body: en ? 'The settlement schedule is added as soon as terms are accepted.' : '조건이 수락되면 정산 일정이 자동으로 추가됩니다.',
    },
  ];

  return (
    <section className="relative py-14 md:py-24 overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-10 bg-[#F4F5FA]" />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-24 w-[300px] h-[300px] md:w-[520px] md:h-[520px] rounded-full -z-10 blur-[90px]"
        style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.12), transparent 70%)' }}
      />

      <div className="container mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mb-9 md:mb-14 text-center lg:text-left mx-auto lg:mx-0">
          <span className="text-[11px] md:text-xs font-black tracking-[0.25em] text-[#2563EB]">CAMPAIGN</span>
          <h2 className="mt-3 text-[1.5rem] leading-tight md:text-[3rem] md:leading-[1.1] font-black text-[#0B0F1A] font-display tracking-tighter">
            {en ? (
              <>
                Stop waiting for offers,
                <br />
                apply to campaigns yourself
              </>
            ) : (
              <>
                제안을 기다리지 않고
                <br />
                캠페인에 직접 지원
              </>
            )}
          </h2>
          <p className="mt-4 text-sm md:text-lg text-[#4A5273] font-medium leading-relaxed">
            {en
              ? 'Product sponsorship and commerce campaigns are open to apply. What happens after you are selected — steps, insights, settlement — stays in the same dashboard.'
              : '제품 협찬과 커머스 캠페인에 직접 지원할 수 있습니다. 선정 이후의 진행 단계와 인사이트, 정산까지 같은 대시보드에서 이어집니다.'}
          </p>
        </div>

        <div>
          {/* 보상 방식 세 가지 + 지원부터 정산까지의 단계 */}
          <div className="grid sm:grid-cols-3 gap-3.5 md:gap-5">
            {rewardTypes.map((type, idx) => (
              <motion.div
                key={type.name}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08, duration: 0.4 }}
                className="rounded-[1.75rem] p-5 md:p-6 border border-transparent"
                style={{ backgroundColor: type.tint }}
              >
                <span className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm">
                  <type.icon size={20} style={{ color: type.iconColor }} strokeWidth={2.4} />
                </span>
                <h3 className="mt-4 text-base md:text-xl font-black text-[#0B0F1A] tracking-tight">{type.name}</h3>
                <p className="mt-2 text-[12px] md:text-sm font-medium text-[#4A5273] leading-relaxed">{type.body}</p>
                <span
                  className="mt-4 inline-flex items-center gap-1 text-[10px] md:text-[11px] font-black px-2.5 py-1 rounded-lg bg-white/80"
                  style={{ color: type.iconColor }}
                >
                  <BadgeCheck size={12} strokeWidth={2.8} />
                  {type.chip}
                </span>
              </motion.div>
            ))}
          </div>

          {/* 지원부터 정산까지 네 단계. 좁은 화면에서는 두 칸씩 접힌다. */}
          <div className="mt-3.5 md:mt-5 bg-white rounded-[1.75rem] border border-[#0B0F1A]/[0.07] p-5 md:p-7 shadow-[0_20px_50px_-40px_rgba(11,15,26,0.7)]">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm md:text-lg font-black text-[#0B0F1A] tracking-tight">
                {en ? 'From applying to getting paid' : '지원부터 정산까지'}
              </h3>
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-black text-[#5B6382] bg-[#F1F3F9] px-2.5 py-1 rounded-full">
                <MessageSquare size={12} strokeWidth={2.8} />
                {en ? 'Manager in every step' : '단계마다 담당자와 대화'}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-3">
              {flow.map((step, idx) => (
                <div key={step.title} className="relative">
                  {/* 단계 사이를 잇는 선. 마지막 칸에는 그리지 않는다. */}
                  {idx < flow.length - 1 && (
                    <span aria-hidden className="hidden md:block absolute top-4 left-11 right-0 h-[2px] bg-[#EDEFF6]" />
                  )}
                  <div className="relative flex items-center gap-2 mb-2.5">
                    <span className="w-8 h-8 rounded-xl bg-[#EDF2FF] flex items-center justify-center shrink-0">
                      <step.icon size={15} className="text-[#2563EB]" strokeWidth={2.6} />
                    </span>
                    <span className="text-[10px] md:text-[11px] font-black text-[#A6ADC6] tabular-nums">
                      STEP {idx + 1}
                    </span>
                  </div>
                  <p className="text-[13px] md:text-sm font-black text-[#0B0F1A]">{step.title}</p>
                  <p className="mt-1 text-[11px] md:text-[12px] font-medium text-[#5B6382] leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
          </div>

          {onSignup && (
            <button
              type="button"
              onClick={onSignup}
              className="mt-6 md:mt-8 inline-flex items-center gap-2 bg-[#0B0F1A] hover:bg-[#1B2236] text-white px-6 py-3.5 rounded-full text-sm md:text-base font-black transition-all active:scale-[0.97] shadow-[0_16px_34px_-18px_rgba(11,15,26,0.8)]"
            >
              {en ? 'Sign up and browse campaigns' : '가입하고 캠페인 둘러보기'}
              <ArrowRight size={16} strokeWidth={2.8} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default CampaignShowcase;
