import React, { useEffect, useMemo, useState } from 'react';
import { formatCountKo, formatKRW } from '../utils/formatters';
import { instagramPostUrl } from '../utils/instagramPostUrl';

/**
 * 브랜드 영업용 링크 공개 화면(/pick/<토큰>).
 *
 * 운영자가 브랜드에게 보내는 인플루언서 제안 명단이다. 로그인 없이 열리고, 계정마다
 * 팔로워·팔로잉·최근 릴스 3편(조회수 포함)과 운영자가 정한 피드 / 릴스 단가(블러 처리)만 보인다. 미등록 계정의
 * 릴스 조회수는 운영자가 직접 넣는다. 평균 조회수·동향은 싣지 않는다.
 */

interface Reel {
  permalink: string;
  thumbnailUrl: string;
  /** 0 = 모름. 화면에 조회수를 띄우지 않는다. */
  views: number;
}

interface Influencer {
  id: string;
  handle: string;
  profile_url: string;
  display_name: string;
  profile_image_url: string;
  category: string;
  followers: number;
  following: number;
  /** 피드 단가. 0 = 협의 */
  price: number;
  /** 릴스 단가. 0 = 협의 */
  reels_price: number;
  price_note: string;
  recent_reels: Reel[];
}

interface LinkInfo {
  title: string;
  brand_name: string;
  intro: string;
  updated_at: string;
}

const splitTags = (raw: string) =>
  String(raw || '')
    .split(/[,/·|]/)
    .map(s => s.trim())
    .filter(Boolean);

const SalesLinkPage: React.FC<{ token: string }> = ({ token }) => {
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [items, setItems] = useState<Influencer[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [tag, setTag] = useState('all');

  useEffect(() => {
    let alive = true;
    fetch(`/api/sales-link/${encodeURIComponent(token)}`)
      .then(async res => {
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        if (!alive) return;
        setLink(data.link);
        setItems(data.influencers || []);
        setState('ready');
        document.title = `${data.link?.title || '인플루언서 제안'} · PICKSFOLIO`;
      })
      .catch(() => alive && setState('missing'));
    return () => { alive = false; };
  }, [token]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) for (const t of splitTags(it.category)) counts.set(t, (counts.get(t) || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const shown = tag === 'all' ? items : items.filter(it => splitTags(it.category).includes(tag));

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-[#f6f5f2] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (state === 'missing' || !link) {
    return (
      <div className="min-h-screen bg-[#f6f5f2] flex flex-col items-center justify-center p-8 text-center">
        <p className="text-xs font-black tracking-[0.3em] text-slate-400 mb-4">PICKSFOLIO</p>
        <h1 className="text-xl font-black text-slate-900 mb-2">링크를 찾을 수 없습니다</h1>
        <p className="text-sm text-slate-500">만료되었거나 비공개로 전환된 제안입니다. 담당자에게 문의해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f5f2] text-slate-900">
      <div className="bg-amber-300 text-slate-950">
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm">
          <span className="font-black">인플루언서 미리보기</span>
          <span className="text-slate-950/40">/</span>
          <span className="font-bold">가입하면 더 많은 인플루언서를 만날 수 있어요.</span>
        </div>
      </div>
      <header className="bg-slate-950 text-white">
        <div className="max-w-[1440px] mx-auto px-5 sm:px-8 pt-10 pb-12">
          <p className="text-[11px] font-black tracking-[0.35em] text-white/50">PICKSFOLIO · INFLUENCER PROPOSAL</p>
          {link.brand_name && (
            <p className="mt-6 text-sm font-bold text-amber-300">{link.brand_name} 담당자님께</p>
          )}
          <h1 className="mt-2 text-3xl sm:text-4xl font-black leading-tight tracking-tight">{link.title}</h1>
          {link.intro && (
            <p className="mt-4 max-w-2xl text-sm sm:text-base text-white/70 font-medium leading-relaxed whitespace-pre-wrap">{link.intro}</p>
          )}
          <div className="mt-8 flex gap-8">
            <div>
              <p className="text-[10px] font-black tracking-widest text-white/40">인플루언서 미리보기</p>
              <p className="mt-1 text-2xl font-black">{items.length}명</p>
            </div>
            <div>
              <p className="text-[10px] font-black tracking-widest text-white/40">합산 팔로워</p>
              <p className="mt-1 text-2xl font-black">{formatCountKo(items.reduce((s, i) => s + i.followers, 0))}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-5 sm:px-8 py-8">
        {tags.length > 1 && (
          <div className="flex gap-1.5 flex-wrap mb-6">
            <button
              onClick={() => setTag('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all ${tag === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-400'}`}
            >
              전체 {items.length}
            </button>
            {tags.map(([name, count]) => (
              <button
                key={name}
                onClick={() => setTag(tag === name ? 'all' : name)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-black transition-all ${tag === name ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-400'}`}
              >
                {name} {count}
              </button>
            ))}
          </div>
        )}

        {shown.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center text-sm font-bold text-slate-400">준비 중인 명단입니다.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {shown.map(it => <InfluencerCard key={it.id} it={it} />)}
          </div>
        )}

        <p className="mt-10 text-center text-[11px] font-bold text-slate-400">
          팔로워·팔로잉·최근 릴스·조회수는 인스타그램 공개 프로필 기준입니다.
        </p>
      </main>
    </div>
  );
};

const InfluencerCard: React.FC<{ it: Influencer }> = ({ it }) => {
  const reels = it.recent_reels.slice(0, 3);
  const price = <PriceBox it={it} />;
  return (
    <article className="bg-white rounded-3xl border border-slate-200/70 shadow-[0_1px_0_rgba(0,0,0,0.03)] overflow-hidden flex flex-col">
      <div className="flex flex-col">
      <div className="p-6 sm:p-7 pb-4 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 overflow-hidden shrink-0 ring-2 ring-white shadow">
          {it.profile_image_url ? (
            <img src={it.profile_image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm font-black text-slate-400">
              {(it.handle || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <a
            href={it.profile_url || `https://www.instagram.com/${it.handle}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="block font-black text-lg truncate hover:text-blue-600"
          >
            @{it.handle}
          </a>
          <p className="text-sm font-medium text-slate-400 truncate">{it.display_name || ' '}</p>
        </div>
      </div>

      {splitTags(it.category).length > 0 && (
        <div className="px-6 sm:px-7 -mt-1 mb-4 flex flex-wrap gap-1.5">
          {splitTags(it.category).map(t => (
            <span key={t} className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-500 text-xs font-black">{t}</span>
          ))}
        </div>
      )}

      <div className="px-6 sm:px-7 grid grid-cols-2 gap-3">
        <Stat label="팔로워" value={it.followers} />
        <Stat label="팔로잉" value={it.following} />
      </div>

      </div>

      <div className="px-6 sm:px-7 pt-5">
        <p className="text-xs font-black tracking-widest text-slate-400 mb-2.5">최근 릴스</p>
        <div className="grid grid-cols-3 gap-2.5 lg:gap-3">
          {[0, 1, 2].map(i => {
            const reel = reels[i];
            if (!reel) return <div key={i} className="aspect-[9/16] rounded-2xl bg-slate-50 border border-dashed border-slate-200" />;
            return (
              <a
                key={i}
                href={instagramPostUrl(reel.permalink) || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative aspect-[9/16] rounded-2xl overflow-hidden bg-slate-200"
              >
                {reel.thumbnailUrl ? (
                  <img src={reel.thumbnailUrl} alt={`최근 릴스 ${i + 1}`} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-slate-400">REELS</div>
                )}
                <span className="absolute inset-x-0 bottom-0 h-16 lg:h-24 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
                <span className="absolute bottom-2 left-2.5 right-2.5 lg:bottom-3.5 lg:left-4 flex items-center gap-1 lg:gap-1.5 text-white">
                  <svg className="w-3.5 h-3.5 lg:w-5 lg:h-5 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  {reel.views > 0 && (
                    <span className="text-sm lg:text-lg font-black drop-shadow" title={`조회수 ${reel.views.toLocaleString()}회`}>
                      {formatCountKo(reel.views)}
                    </span>
                  )}
                </span>
              </a>
            );
          })}
        </div>
      </div>

      <div className="mt-auto">{price}</div>
    </article>
  );
};

const PriceBox: React.FC<{ it: Influencer }> = ({ it }) => (
      <div className="p-6 sm:p-7 pt-5">
        <div className="rounded-2xl bg-slate-950 text-white px-5 py-4">
          <p className="text-xs font-black tracking-widest text-white/40">제안 단가</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <PriceCell label="피드" value={it.price} />
            <PriceCell label="릴스" value={it.reels_price} />
          </div>
          {it.price_note && <p className="mt-2 text-xs font-bold text-white/60 truncate blur-sm select-none" aria-hidden="true">{it.price_note}</p>}
        </div>
        <p className="mt-2.5 text-xs font-bold text-slate-500 leading-relaxed">
          정확한 견적은 픽스폴리오 가입 후 캠페인을 등록하면 안내해 드려요
        </p>
      </div>
);

const PriceCell: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-[11px] font-black text-white/50">{label}</p>
    <p className="text-xl font-black whitespace-nowrap blur-md select-none" aria-hidden="true">{value > 0 ? formatKRW(value) : '협의'}</p>
  </div>
);

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-2xl bg-slate-50 px-4 py-3.5">
    <p className="text-xs font-black text-slate-400">{label}</p>
    <p className="mt-1 text-xl font-black" title={Number(value || 0).toLocaleString()}>{formatCountKo(value)}</p>
  </div>
);

export default SalesLinkPage;
