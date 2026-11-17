import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Gift,
  Wallet,
  ShoppingBag,
  Link2,
  UserCheck,
  Search,
  Receipt,
  Store,
} from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface CampaignShowcaseProps {
  onSignup?: () => void;
}

const CampaignShowcase: React.FC<CampaignShowcaseProps> = ({ onSignup }) => {
  const { language } = useLanguage();
  const en = language === 'en';

  /* 어필리에이트로 크리에이터가 얻는 것 세 가지.

     예전에는 이 자리에 담당자가 브랜드 광고(캠페인)를 제안하는 흐름을 적었다.
     브랜드 광고 캠페인은 더 이상 운영하지 않으므로, 지금 실제로 돌아가는
     어필리에이트(상품 판매 신청 → 브랜드 선정 · 협찬 상품 배송 → 전용 판매 링크
     → 판매 수수료 정산) 흐름을 소개한다. */
  const highlights = [
    {
      icon: Search,
      name: en ? 'Pick the products you like' : '팔고 싶은 상품을 직접 선택',
      body: en
        ? 'Browse products from partner brands by category and apply to sell the ones that fit your channel.'
        : '입점 브랜드의 상품을 카테고리별로 둘러보고, 내 채널에 맞는 상품에 판매 신청을 보냅니다.',
      chip: en ? 'Apply in one tap' : '간편 판매 신청',
      tint: '#EDF2FF',
      iconColor: '#2563EB',
    },
    {
      icon: Gift,
      name: en ? 'Sample product + your own link' : '협찬 상품과 전용 판매 링크',
      body: en
        ? 'Once the brand selects you, the product is shipped to you and your personal sales link opens.'
        : '브랜드에 선정되면 협찬 상품을 받아 보고, 나만의 전용 판매 링크가 열립니다.',
      chip: en ? 'Product shipped to you' : '협찬 상품 배송',
      tint: '#E7F3EE',
      iconColor: '#0F9D6E',
    },
    {
      icon: Wallet,
      name: en ? 'Earn commission on every sale' : '판매할 때마다 수수료',
      body: en
        ? 'Orders placed through your link count as your sales. Track visits, orders and commission, then request your payout.'
        : '내 링크로 들어온 주문은 모두 내 판매로 잡힙니다. 방문 · 주문 · 수수료를 확인하고 정산받으세요.',
      chip: en ? 'Monthly payout' : '매월 정산',
      tint: '#FDF4E3',
      iconColor: '#B4780B',
    },
  ];

  /* 판매 신청부터 정산까지. 대시보드의 어필리에이트 · MY 어필리에이트 · 정산 화면이
     각각 이 단계를 맡는다. */
  const flow = [
    {
      icon: ShoppingBag,
      title: en ? 'Apply to sell' : '판매 신청',
      body: en ? 'Choose a product and send your application.' : '마음에 드는 상품을 고르고 판매 신청을 보냅니다.',
    },
    {
      icon: UserCheck,
      title: en ? 'Brand selects you' : '브랜드 선정',
      body: en ? 'The brand reviews applications and picks its creators.' : '브랜드가 신청을 확인하고 함께할 크리에이터를 선정합니다.',
    },
    {
      icon: Link2,
      title: en ? 'Sell with your link' : '전용 링크로 판매',
      body: en ? 'Share your link on your page and content to start selling.' : '받은 상품을 소개하고 전용 링크를 개인페이지 · 콘텐츠에 올립니다.',
    },
    {
      icon: Receipt,
      title: en ? 'Get paid' : '수수료 정산',
      body: en ? 'Confirmed orders turn into commission you can request.' : '구매확정된 주문의 수수료를 정산 신청하면 지급됩니다.',
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
          <span className="text-[11px] md:text-xs font-black tracking-[0.25em] text-[#2563EB]">AFFILIATE</span>
          <h2 className="mt-3 text-[1.5rem] leading-tight md:text-[3rem] md:leading-[1.1] font-black text-[#0B0F1A] font-display tracking-tighter">
            {en ? (
              <>
                Pick a brand product,
                <br />
                sell it with your own link
              </>
            ) : (
              <>
                브랜드 상품을 골라
                <br />
                내 링크로 판매하세요
              </>
            )}
          </h2>
          <p className="mt-4 text-sm md:text-lg text-[#4A5273] font-medium leading-relaxed">
            {en
              ? 'Apply to sell products from partner brands. When a brand selects you, you receive the product and a personal sales link — every order through that link earns you commission.'
              : '입점 브랜드의 상품에 판매 신청을 보내 보세요. 선정되면 협찬 상품과 전용 판매 링크를 받고, 그 링크로 들어온 주문마다 판매 수수료가 쌓입니다.'}
          </p>
        </div>

        <div>
          {/* 어필리에이트 핵심 세 가지 + 판매 신청부터 정산까지의 단계 */}
          <div className="grid sm:grid-cols-3 gap-3.5 md:gap-5">
            {highlights.map((type, idx) => (
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

          {/* 판매 신청부터 정산까지 네 단계. 좁은 화면에서는 두 칸씩 접힌다. */}
          <div className="mt-3.5 md:mt-5 bg-white rounded-3xl sm:rounded-[1.75rem] border border-[#0B0F1A]/[0.07] p-4 sm:p-5 md:p-7 shadow-[0_20px_50px_-40px_rgba(11,15,26,0.7)]">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm md:text-lg font-black text-[#0B0F1A] tracking-tight">
                {en ? 'From application to payout' : '판매 신청부터 정산까지'}
              </h3>
              <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-black text-[#5B6382] bg-[#F1F3F9] px-2.5 py-1 rounded-full">
                <Store size={12} strokeWidth={2.8} />
                {en ? 'All in your dashboard' : '대시보드에서 한 번에'}
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
              {en ? 'Sign up and start selling' : '가입하고 어필리에이트 시작하기'}
              <ArrowRight size={16} strokeWidth={2.8} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default CampaignShowcase;
