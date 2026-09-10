import React, { useState } from 'react';
import { ArrowRight, BarChart3, Briefcase, Hash, Link2, TrendingUp } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface HeroProps {
  onSignup: (id: string) => void;
}

/* 히어로의 미리보기 카드에 들어가는 값. 아래 실시간 트렌드 보드와 달리 이쪽은
   화면 구성을 보여주는 예시라서 카드에 '예시' 표시를 함께 달아 둔다.
   span 은 실제 개인페이지 그리드와 같은 규칙(6칸 기준, 3=2단·2=3단)이다. */
const SAMPLE_GRID = [
  { id: 'g1', img: 'photo-1483985988355-763728e1935b', span: 3, ko: '봄 레이어드', en: 'Spring Layering', cat: 'FASHION', count: 4 },
  { id: 'g2', img: 'photo-1515886657613-9f3515b0c78f', span: 3, ko: '데일리 스트릿', en: 'Daily Street', cat: 'STREET', count: 3 },
  { id: 'g3', img: 'photo-1496747611176-843222e1e57c', span: 2, ko: '여름 원피스', en: 'Summer Dress', cat: 'FASHION', count: 5 },
  { id: 'g4', img: 'photo-1487222477894-8943e31ef7b2', span: 2, ko: '가을 아웃터', en: 'Autumn Outer', cat: 'OUTER', count: 2 },
  { id: 'g5', img: 'photo-1509631179647-0177331693ae', span: 2, ko: '무드 스튜디오', en: 'Studio Mood', cat: 'LOOKBOOK', count: 6 },
];

const SAMPLE_CATEGORIES = [
  { ko: '전체', en: 'All' },
  { ko: '패션', en: 'Fashion' },
  { ko: '아웃터', en: 'Outer' },
  { ko: '룩북', en: 'Lookbook' },
];

const unsplash = (id: string, w: number, h: number) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}&q=70`;

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
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-center">
          {/* ── 왼쪽: 문구와 시작 입력칸 ── */}
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 bg-white border border-[#0B0F1A]/10 text-[#2563EB] text-[11px] md:text-xs font-black px-3.5 py-1.5 rounded-full shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
              {en ? 'The all-in-one service for creators' : '크리에이터를 위한 올인원 서비스'}
            </span>

            <h1 className="mt-5 md:mt-7 text-[1.75rem] leading-[1.2] md:text-[4rem] md:leading-[1.06] font-black tracking-tighter text-[#0B0F1A] font-display">
              {en ? (
                <>
                  Pick today&rsquo;s trend,
                  <br />
                  connect it with{' '}
                  <span className="relative inline-block">
                    <span className="relative z-10 text-[#2563EB]">one link</span>
                    <span
                      aria-hidden
                      className="absolute left-0 right-0 bottom-0.5 h-2.5 md:h-4 -z-0 rounded-full"
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
                      className="absolute left-0 right-0 bottom-0.5 h-2.5 md:h-4 -z-0 rounded-full"
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
                <div className="flex items-center px-3 md:px-5 flex-1 min-w-0">
                  <span className="text-[#98A0BC] font-bold text-sm md:text-base whitespace-nowrap">picks-folio.com/</span>
                  <input
                    type="text"
                    placeholder={en ? 'yourname' : '아이디'}
                    aria-label={en ? 'Your page address' : '내 페이지 주소'}
                    className="bg-transparent border-none outline-none text-[#0B0F1A] text-sm md:text-base font-bold px-1.5 py-2 flex-1 min-w-0 placeholder:text-[#C3C9DC]"
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

          {/* ── 오른쪽: 개인 링크 페이지와 트렌드 보드를 겹친 미리보기 ── */}
          <div className="relative mx-auto w-full max-w-[420px] lg:max-w-none">
            {/* 개인 링크 카드. 커버 사진 → 프로필 → 카테고리 줄 → 그리드 순서로,
                실제 개인페이지(큐레이션 레이아웃)와 같은 짜임을 축소해 둔 것이다. */}
            <div className="relative bg-white rounded-[1.75rem] md:rounded-[2.25rem] border border-[#0B0F1A]/[0.08] shadow-[0_40px_80px_-40px_rgba(11,15,26,0.4)] overflow-hidden home-float-slow-lg">
              <div className="relative h-32 md:h-44">
                <img
                  src={unsplash('photo-1485231183945-fffde7cc051e', 900, 500)}
                  alt=""
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-white via-white/35 to-transparent" />
              </div>
              <div className="px-4 md:px-6 pb-5 md:pb-7 -mt-9 md:-mt-12 relative">
                <div className="flex items-end justify-between gap-3">
                  <div className="flex items-end gap-3 min-w-0">
                    <img
                      src={unsplash('photo-1488426862026-3ee34a7d66df', 200, 200)}
                      alt=""
                      className="w-14 h-14 md:w-16 md:h-16 rounded-2xl object-cover border-[3px] border-white shadow-md shrink-0"
                      referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0 pb-0.5">
                      <p className="text-sm md:text-base font-black text-[#0B0F1A] truncate">picks-folio.com/picks</p>
                      <p className="text-[11px] md:text-xs font-bold text-[#8B93AE] truncate">
                        {en ? 'Picks · fashion curator' : '픽스 · 패션 큐레이터'}
                      </p>
                    </div>
                  </div>
                  <span className="hidden md:inline-flex items-center gap-1 bg-[#EAF0FF] text-[#2563EB] text-[10px] font-black px-2.5 py-1 rounded-full shrink-0">
                    <Briefcase size={11} strokeWidth={2.8} />
                    {en ? 'Inquiry' : '제안받기'}
                  </span>
                </div>

                {/* 카테고리 줄 — 실제 페이지처럼 첫 칸이 선택된 상태다. */}
                <div className="mt-4 flex items-center gap-1.5 overflow-hidden">
                  {SAMPLE_CATEGORIES.map((cat, idx) => (
                    <span
                      key={cat.ko}
                      className={`text-[10px] md:text-[11px] font-black px-2.5 py-1 rounded-full border whitespace-nowrap ${
                        idx === 0
                          ? 'bg-[#2563EB] text-white border-transparent'
                          : 'bg-white text-[#A6ADC6] border-[#0B0F1A]/[0.08]'
                      }`}
                    >
                      {en ? cat.en : cat.ko}
                    </span>
                  ))}
                </div>

                {/* 사진 그리드 — 6칸 기준으로 타일이 채워지는 실제 개인페이지 방식 */}
                <div
                  className="mt-3 grid grid-flow-dense"
                  style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: '5px' }}
                >
                  {SAMPLE_GRID.map((item) => (
                    <div
                      key={item.id}
                      className="relative overflow-hidden aspect-square border border-[#0B0F1A]/[0.06] shadow-sm"
                      style={{ gridColumn: `span ${item.span}`, borderRadius: '1rem' }}
                    >
                      <img
                        src={unsplash(item.img, 400, 400)}
                        alt=""
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <span className="absolute top-2 right-2 bg-black/55 backdrop-blur-md text-white text-[9px] font-black px-1.5 py-0.5 rounded-md border border-white/10">
                        {item.count}
                      </span>
                      <div className="absolute bottom-0 left-0 right-0 p-2 md:p-2.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                        <p className="text-[10px] md:text-[11px] font-black text-white truncate tracking-tight">
                          {en ? item.en : item.ko}
                        </p>
                        <p className="hidden md:flex items-center gap-0.5 text-[8px] font-bold text-white/60 tracking-widest mt-0.5">
                          <Hash size={7} strokeWidth={3} />
                          {item.cat}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 트렌드 보드 미니 카드. 좁은 화면에서는 링크 카드 아래에 그대로 놓고,
                넓은 화면에서만 커버 사진 위 왼쪽으로 걸쳐 카드 두 장이 겹친 모양을
                만든다. 사진 그리드를 가리지 않도록 위쪽에 붙인다. */}
            <div className="mt-4 lg:mt-0 lg:absolute lg:-top-8 lg:-left-14 w-full lg:w-[248px] bg-white rounded-[1.5rem] border border-[#0B0F1A]/[0.08] shadow-[0_28px_60px_-30px_rgba(11,15,26,0.5)] p-3.5 md:p-4 home-float-lg">
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
