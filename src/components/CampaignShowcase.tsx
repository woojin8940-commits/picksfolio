import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Handshake,
  Megaphone,
  ClipboardCheck,
  UserCheck,
  Search,
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

  /* 담당자가 실제로 해 주는 일 세 가지.

     예전에는 이 자리에 보상 방식(제품 협찬 · 판매 수수료 · 확정 보수)을 늘어놓았다.
     그런데 첫 칸이 "광고비 없음"이라, 이 서비스가 제품만 받고 콘텐츠를 만드는
     시딩 창구로 읽혔다. 실제 운영은 그 반대다 — 담당자가 채널에 맞는 브랜드 광고를
     찾아 조건까지 정리해 제안하고, 진행과 정산까지 함께 본다. 그래서 보상 종류가
     아니라 담당자가 해 주는 일을 적는다. */
  const managerRoles = [
    {
      icon: Search,
      name: en ? 'Matched by your manager' : '채널을 보고 매칭',
      body: en
        ? 'Your manager reviews your channel, audience and rate, then picks the brands that actually fit.'
        : '담당자가 채널 성격과 시청자, 단가를 확인한 뒤 맞는 브랜드를 골라 연결합니다.',
      chip: en ? 'Manager assigned' : '담당자 배정',
      tint: '#EDF2FF',
      iconColor: '#2563EB',
    },
    {
      icon: Megaphone,
      name: en ? 'Ad offers come to you' : '광고 제안이 도착',
      body: en
        ? 'Offers arrive with the fee, scope and schedule already written down — you only decide yes or no.'
        : '광고비와 업무 범위, 일정이 적힌 제안이 도착합니다. 수락할지만 정하면 됩니다.',
      chip: en ? 'Terms written up front' : '조건 정리 후 제안',
      tint: '#E7F3EE',
      iconColor: '#0F9D6E',
    },
    {
      icon: Handshake,
      name: en ? 'Managed to the last step' : '진행·정산까지 관리',
      body: en
        ? 'Revisions, schedule and settlement are coordinated with the brand by your manager.'
        : '수정 요청과 일정, 정산까지 담당자가 브랜드와 조율합니다.',
      chip: en ? 'Manager handles it' : '담당자가 조율',
      tint: '#FDF4E3',
      iconColor: '#B4780B',
    },
  ];

  /* 담당자가 광고를 제안하는 순서. 대시보드의 캠페인 · 캠페인 협업 · 정산 화면이
     각각 이 단계를 맡는다. */
  const flow = [
    {
      icon: UserCheck,
      title: en ? 'Manager assigned' : '담당자 배정',
      body: en ? 'Sign up and connect your channel — a manager takes a look.' : '가입하고 채널을 연결하면 담당자가 채널을 확인합니다.',
    },
    {
      icon: Megaphone,
      title: en ? 'Offer proposed' : '광고 제안',
      body: en ? 'Your manager finds a fitting brand and sends the offer.' : '담당자가 채널에 맞는 브랜드 광고를 찾아 제안합니다.',
    },
    {
      icon: ClipboardCheck,
      title: en ? 'Terms agreed' : '조건 협의',
      body: en ? 'Fee, scope and schedule are settled with the brand for you.' : '광고비와 업무 범위, 일정을 담당자가 브랜드와 정리합니다.',
    },
    {
      icon: Receipt,
      title: en ? 'Run & settle' : '진행·정산',
      body: en ? 'Each step and the settlement date stay in your dashboard.' : '단계별 진행과 정산 일정이 대시보드에서 그대로 이어집니다.',
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
                Your manager brings
                <br />
                the brand offers to you
              </>
            ) : (
              <>
                담당자가 브랜드 광고를
                <br />
                직접 제안합니다
              </>
            )}
          </h2>
          <p className="mt-4 text-sm md:text-lg text-[#4A5273] font-medium leading-relaxed">
            {en
              ? 'A manager is assigned to your channel, finds brands that fit and proposes the ad with the fee and scope already agreed. Negotiation, progress and settlement are managed with you.'
              : '채널마다 담당자가 배정됩니다. 담당자가 맞는 브랜드를 찾아 광고비와 업무 범위까지 정리해 제안하고, 협의부터 진행 관리와 정산까지 함께 챙깁니다.'}
          </p>
        </div>

        <div>
          {/* 담당자가 해 주는 일 세 가지 + 제안부터 정산까지의 단계 */}
          <div className="grid sm:grid-cols-3 gap-3.5 md:gap-5">
            {managerRoles.map((type, idx) => (
              <motion.div
                key={type.name}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08, duration: 0.4 }}
                className="rounded-3xl sm:rounded-[1.75rem] p-4 sm:p-5 md:p-6 border border-transparent"
                style={{ backgroundColor: type.tint }}
              >
                <span className="w-11 h-11 md:w-12 md:h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm">
                  <type.icon size={20} style={{ color: type.iconColor }} strokeWidth={2.4} />
                </span>
                <h3 className="mt-3.5 sm:mt-4 text-[15px] sm:text-base md:text-xl font-black text-[#0B0F1A] tracking-tight">{type.name}</h3>
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

          {/* 제안부터 정산까지 네 단계. 좁은 화면에서는 두 칸씩 접힌다. */}
          <div className="mt-3.5 md:mt-5 bg-white rounded-3xl sm:rounded-[1.75rem] border border-[#0B0F1A]/[0.07] p-4 sm:p-5 md:p-7 shadow-[0_20px_50px_-40px_rgba(11,15,26,0.7)]">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm md:text-lg font-black text-[#0B0F1A] tracking-tight">
                {en ? 'From offer to payout' : '제안부터 정산까지'}
              </h3>
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-black text-[#5B6382] bg-[#F1F3F9] px-2.5 py-1 rounded-full">
                <MessageSquare size={12} strokeWidth={2.8} />
                {en ? 'Your manager runs every step' : '전 과정 담당자 관리'}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-4 sm:gap-4 md:gap-3">
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
              className="mt-6 md:mt-8 w-full sm:w-auto flex sm:inline-flex items-center justify-center gap-2 bg-[#0B0F1A] hover:bg-[#1B2236] text-white px-6 py-3.5 rounded-full text-sm md:text-base font-black transition-all active:scale-[0.97] shadow-[0_16px_34px_-18px_rgba(11,15,26,0.8)]"
            >
              {en ? 'Sign up and get matched' : '가입하고 담당자 매칭받기'}
              <ArrowRight size={16} strokeWidth={2.8} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default CampaignShowcase;
