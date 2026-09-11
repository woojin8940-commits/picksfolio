import React, { useState } from 'react';
import { ArrowRight, BarChart3, Briefcase, Hash, Link2, Search, TrendingUp } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface HeroProps {
  onSignup: (id: string) => void;
}

/* 히어로에 나란히 놓는 개인페이지 예시 두 장.

   예시는 직접 만든 그림(public/hero-example-*.webp)이다. 예전에는 같은 화면을
   마크업으로 다시 지어 올렸는데, 실제 페이지와 조금씩 어긋나는 짝퉁 페이지가 하나
   더 늘어나는 일이었다 — 페이지가 바뀔 때마다 이쪽도 같이 고쳐야 했고, 고치지
   않으면 예시가 거짓이 됐다. 그림 한 장이면 어긋날 자리가 없다.

   그림에는 카테고리 버튼 줄 아래에 빈 띠를 한 칸 비워 두었다. 그 자리에 #머리글과
   상품명 검색바만 글자로 얹는다(둘은 언어에 따라 문구가 바뀌어야 해서 그림에
   구워 넣지 않았다). 얹는 위치는 그림 높이 기준 퍼센트라 어떤 크기로 줄여도 띠
   안에 그대로 들어가고, 글자 크기는 컨테이너 너비 기준(cqw)이라 그림 속 글자와
   같은 비율로 줄어든다.

   검색바는 한 장에만 얹는다. 검색바는 켜고 끌 수 있는 것이라(편집기의 버튼 칸에
   on/off 가 있다), 켠 페이지와 끈 페이지를 나란히 두면 그 선택이 있다는 사실이
   설명 없이 보인다. */
type HeroExample = {
  id: string;
  src: string;
  /** 어두운 배경의 페이지인가. 얹는 글자·검색바 색이 이걸 본다. */
  dark: boolean;
  /** 그림 속 포인트 색. #머리글의 해시 기호에 쓴다. */
  accent: string;
  /** 그림 속 카테고리 이름. 머리글은 실제 페이지처럼 '# 이름 ———' 꼴이다. */
  groupKo: string;
  groupEn: string;
  /** 비워 둔 띠 안에서 #머리글이 앉는 높이(그림 높이 기준). */
  headerTop: string;
  /** 검색바를 얹을 높이. 없으면 검색바를 끈 페이지다. */
  searchTop?: string;
};

const HERO_EXAMPLES: HeroExample[] = [
  {
    id: 'dark',
    src: '/hero-example-dark.webp',
    dark: true,
    accent: '#FFFFFF',
    groupKo: 'TOP',
    groupEn: 'TOP',
    headerTop: '50.9%',
  },
  {
    id: 'light',
    src: '/hero-example-light.webp',
    dark: false,
    accent: '#4156AF',
    groupKo: '캠페인',
    groupEn: 'CAMPAIGN',
    searchTop: '50.2%',
    headerTop: '57.4%',
  },
];

/** 그림에서 카테고리 버튼 줄이 시작하는 자리. 얹는 글자도 같은 선에서 시작한다. */
const EXAMPLE_INSET = '7.5%';

const SAMPLE_TREND = [
  { ko: '린넨 셔츠', en: 'Linen shirt', delta: '+38.4%' },
  { ko: '쿨링 마스크팩', en: 'Cooling mask', delta: '+21.7%' },
  { ko: '캠핑 랜턴', en: 'Camping lantern', delta: '+12.3%' },
];

const Hero: React.FC<HeroProps> = ({ onSignup }) => {
  const { language } = useLanguage();
  const en = language === 'en';
  const [handle, setHandle] = useState('');

  return (
    <section className="relative overflow-hidden pt-20 pb-12 md:pt-32 md:pb-24">
      {/* 배경: 종이색 위에 옅은 점 격자와 파스텔 얼룩 두 개. 스크롤하지 않는
          고정 레이어라 매 프레임 다시 그리지 않는다. */}
      <div aria-hidden className="absolute inset-0 -z-10 home-dotgrid opacity-70" />
      <div
        aria-hidden
        className="absolute -top-24 -right-16 w-[320px] h-[320px] md:w-[560px] md:h-[560px] rounded-full -z-10 blur-[90px]"
        style={{ background: 'radial-gradient(circle, rgba(37,99,235,0.16), transparent 70%)' }}
      />
      <div
        aria-hidden
        className="absolute top-1/3 -left-24 w-[260px] h-[260px] md:w-[420px] md:h-[420px] rounded-full -z-10 blur-[90px]"
        style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.13), transparent 70%)' }}
      />

      <div className="container mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] xl:grid-cols-[0.78fr_1.22fr] gap-10 lg:gap-10 items-center">
          {/* ── 왼쪽: 문구와 시작 입력칸 ── */}
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] text-[11px] md:text-xs font-black px-3.5 py-1.5 rounded-full shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
              {en ? 'The all-in-one service for creators' : '크리에이터를 위한 올인원 서비스'}
            </span>

            <h1 className="mt-5 md:mt-7 text-[1.5rem] leading-[1.25] sm:text-[2.25rem] sm:leading-[1.15] md:text-[4rem] md:leading-[1.06] font-black tracking-tighter text-[#0B0F1A] font-display">
              {en ? (
                <>
                  Pick today&rsquo;s trend,
                  <br />
                  connect it with{' '}
                  <span className="relative inline-block">
                    <span className="relative z-10 text-[#2563EB]">one link</span>
                    <span
                      aria-hidden
                      className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-3 md:h-4 -z-0 rounded-full"
                      style={{ background: 'rgba(37,99,235,0.16)' }}
                    />
                  </span>
                </>
              ) : (
                <>
                  오늘의 트렌드로 픽하고
                  <br />
                  <span className="relative inline-block">
                    <span className="relative z-10 text-[#2563EB]">개인 링크</span>
                    <span
                      aria-hidden
                      className="absolute left-0 right-0 bottom-0.5 h-2 sm:h-3 md:h-4 -z-0 rounded-full"
                      style={{ background: 'rgba(37,99,235,0.16)' }}
                    />
                  </span>{' '}
                  하나로 연결
                </>
              )}
            </h1>

            <p className="mt-4 md:mt-6 text-sm md:text-lg text-[#4A5273] font-medium leading-relaxed max-w-xl mx-auto lg:mx-0">
              {en
                ? 'Popular keywords, sorted by category every day. Put them on your own profile link and introduce them.'
                : '인기검색어를 분야별로 매일 정리해 보여줍니다. 나만의 프로필링크에 담아 소개해보세요.'}
            </p>

            {/* 시작 입력칸 — 아이디를 적고 누르면 그대로 가입 화면으로 넘어간다. */}
            <div className="mt-7 md:mt-9 max-w-xl mx-auto lg:mx-0">
              <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 bg-white border border-[#0B0F1A]/10 p-2 md:p-2.5 rounded-[1.5rem] md:rounded-full shadow-[0_18px_45px_-28px_rgba(11,15,26,0.45)]">
                <div className="flex items-center px-2.5 sm:px-3 md:px-5 flex-1 min-w-0">
                  <span className="text-[#98A0BC] font-bold text-[13px] sm:text-sm md:text-base whitespace-nowrap">picks-folio.com/</span>
                  <input
                    type="text"
                    placeholder={en ? 'yourname' : '아이디'}
                    aria-label={en ? 'Your page address' : '내 페이지 주소'}
                    className="bg-transparent border-none outline-none text-[#0B0F1A] text-sm md:text-base font-bold px-1 sm:px-1.5 py-2 flex-1 min-w-0 placeholder:text-[#C3C9DC]"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSignup(handle);
                    }}
                  />
                </div>
                <button
                  onClick={() => onSignup(handle)}
                  className="w-full md:w-auto bg-[#2563EB] hover:bg-[#1d4ed8] text-white px-6 py-3.5 md:px-8 md:py-3.5 rounded-[1.1rem] md:rounded-full text-sm md:text-base font-black transition-all active:scale-[0.97] flex items-center justify-center gap-1.5 shadow-[0_12px_28px_-12px_rgba(37,99,235,0.8)]"
                >
                  {en ? 'Create now' : '바로 만들기'}
                  <ArrowRight size={17} strokeWidth={2.8} />
                </button>
              </div>
              <p className="mt-3 text-[11px] md:text-xs text-[#8B93AE] font-bold">
                {en ? 'Pick an address and your page is live.' : '주소만 정하면 내 페이지가 바로 열립니다.'}
              </p>
            </div>

            {/* 이 서비스가 실제로 해 주는 것 세 가지. 숫자 자랑 대신 기능으로 적는다. */}
            <div className="mt-8 md:mt-10 flex flex-wrap justify-center lg:justify-start gap-2 md:gap-2.5">
              {[
                { icon: BarChart3, ko: '네이버 데이터랩 트렌드', en: 'Naver DataLab trends' },
                { icon: Link2, ko: '개인 링크 · 홈페이지', en: 'Personal link & homepage' },
                { icon: Briefcase, ko: '비즈니스 제안 수신', en: 'Brand inquiries' },
              ].map((item) => (
                <span
                  key={item.ko}
                  className="inline-flex items-center gap-1.5 bg-white/80 border border-[#0B0F1A]/[0.07] text-[#39415C] text-[11px] md:text-xs font-bold px-3 py-1.5 rounded-xl"
                >
                  <item.icon size={13} className="text-[#2563EB]" strokeWidth={2.5} />
                  {en ? item.en : item.ko}
                </span>
              ))}
            </div>
          </div>

          {/* ── 오른쪽: 개인페이지 예시 두 장과 트렌드 보드를 겹친 미리보기 ── */}
          <div className="relative mx-auto w-full max-w-[640px] lg:max-w-none">
            {/* 예시 두 장을 나란히 둔다. 어두운 테마 · 밝은 테마 한 장씩이라, 페이지
                생김새가 정해져 있지 않다는 것이 설명 없이 보인다. 아래쪽은 원래도
                잘려 있어 "더 이어진다"는 느낌이 남는다. */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4">
              {HERO_EXAMPLES.map((ex, idx) => (
                <div
                  key={ex.id}
                  className={`relative overflow-hidden rounded-2xl sm:rounded-[1.25rem] md:rounded-[1.75rem] shadow-[0_26px_50px_-28px_rgba(11,15,26,0.38)] md:shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] ${
                    idx === 0 ? 'home-float-slow-lg' : 'home-float-lg'
                  }`}
                  /* 얹는 글자 크기를 이 카드 너비 기준(cqw)으로 재기 위한 선언.
                     px 로 두면 카드가 좁아질 때 그림 속 글자만 작아지고 얹은 글자는
                     그대로 남아, 둘의 크기가 어긋난다. */
                  style={{ containerType: 'inline-size' }}
                >
                  <img
                    src={ex.src}
                    alt={en ? 'Example of a personal page' : '개인페이지 예시'}
                    width={620}
                    height={773}
                    className="block w-full h-auto"
                    loading={idx === 0 ? undefined : 'lazy'}
                    decoding="async"
                  />

                  {/* 상품명 검색바 — 그림에 비워 둔 띠의 위쪽 칸. */}
                  {ex.searchTop && (
                    <div className="absolute" style={{ top: ex.searchTop, left: EXAMPLE_INSET, right: EXAMPLE_INSET }}>
                      {/* 얹는 글자 크기는 index.css 의 .hero-ex-* 에 있다. 테일윈드의
                          text-[8px] 류로 적으면 '휴대폰 최소 12px' 규칙에 걸려
                          그림 위에서 글자만 13px 로 커진다. */}
                      <div
                        className={`flex items-center gap-1 px-1.5 py-1 rounded-lg border ${ex.dark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200'}`}
                        style={{
                          gap: 'max(1px, 1.8cqw)',
                          padding: 'max(1px, 1.7cqw) max(3px, 2.4cqw)',
                          borderRadius: 'max(4px, 3.4cqw)',
                        }}
                      >
                        <Search
                          className={`shrink-0 w-1.5 h-1.5 md:w-2 md:h-2 ${ex.dark ? 'text-white/40' : 'text-slate-400'}`}
                          style={{ width: 'max(5px, 2.7cqw)', height: 'max(5px, 2.7cqw)' }}
                          strokeWidth={2.6}
                        />
                        <span className={`hero-ex-search font-bold truncate ${ex.dark ? 'text-white/40' : 'text-slate-400'}`}>
                          {en ? 'Search products...' : '상품명 검색...'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* 카테고리 머리글 — 사진 그리드 바로 위, 실제 페이지와 같은 '# 이름 ———' 꼴. */}
                  <div
                    className="absolute flex items-center gap-0.5"
                    style={{ top: ex.headerTop, left: EXAMPLE_INSET, right: EXAMPLE_INSET, gap: 'max(1px, 1.2cqw)' }}
                  >
                    <Hash
                      className="shrink-0 w-2 h-2 md:w-2.5 md:h-2.5"
                      style={{ width: 'max(6px, 2.9cqw)', height: 'max(6px, 2.9cqw)', color: ex.accent }}
                      strokeWidth={3}
                    />
                    <span
                      className="hero-ex-head font-black uppercase tracking-wider whitespace-nowrap"
                      style={{ color: ex.dark ? '#FFFFFF' : '#0F172A' }}
                    >
                      {en ? ex.groupEn : ex.groupKo}
                    </span>
                    <span
                      aria-hidden
                      className={`flex-1 h-px ${ex.dark ? 'bg-white/15' : 'bg-slate-200'}`}
                      style={{ height: 'max(1px, 0.25cqw)' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 트렌드 보드 미니 카드. 좁은 화면에서는 예시 카드 아래에 그대로 놓고,
                넓은 화면에서만 왼쪽 아래로 걸쳐 카드가 겹친 모양을 만든다. 예시의
                커버 사진과 카테고리 줄을 가리지 않도록 아래쪽에 붙인다. */}
            <div className="mt-4 lg:mt-0 lg:absolute lg:-bottom-10 lg:-left-12 w-full lg:w-[248px] bg-white rounded-[1.5rem] border border-[#0B0F1A]/[0.08] shadow-[0_28px_60px_-30px_rgba(11,15,26,0.5)] p-3.5 md:p-4 home-float-lg">
              <div className="flex items-center justify-between mb-2.5">
                <span className="inline-flex items-center gap-1.5 text-[11px] md:text-xs font-black text-[#0B0F1A]">
                  <TrendingUp size={13} className="text-[#10B981]" strokeWidth={2.8} />
                  {en ? 'Trend board' : '실시간 트렌드 보드'}
                </span>
                <span className="text-[9px] md:text-[10px] font-black text-[#A6ADC6] bg-[#F1F3F9] px-1.5 py-0.5 rounded-md">
                  {en ? 'SAMPLE' : '예시'}
                </span>
              </div>
              <div className="space-y-1.5">
                {SAMPLE_TREND.map((row, idx) => (
                  <div key={row.ko} className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 rounded-md text-[9px] md:text-[10px] font-black flex items-center justify-center shrink-0 ${
                        idx === 0 ? 'bg-[#2563EB] text-white' : 'bg-[#EAF0FF] text-[#2563EB]'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-[11px] md:text-xs font-bold text-[#39415C] truncate flex-1">{en ? row.en : row.ko}</span>
                    <span className="text-[10px] md:text-[11px] font-black text-[#10B981] tabular-nums shrink-0">{row.delta}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
