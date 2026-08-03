import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { formatNumberWithCommas } from '../../utils/formatters';

/**
 * 인플루언서 명부 — 픽스폴리오에 등록된 사람 전체를 카테고리로 본다.
 *
 * 캠페인 안의 후보 풀과 다른 화면이다. 저쪽은 "이 캠페인에 누구를 넣을까"이고,
 * 여기는 캠페인과 무관하게 "우리에게 누가 있는가"다. 담당자는 캠페인을 받기 전에
 * 먼저 이쪽을 본다 — 명부를 캠페인 안에만 두면 캠페인을 고르기 전에는 아무도 볼 수
 * 없게 된다.
 *
 * 카테고리 칩의 숫자는 필터를 걸어도 바뀌지 않는다. 필터 결과로 세면 "뷰티"를 고른
 * 순간 다른 카테고리가 목록에서 사라져 되돌아갈 길이 없어진다.
 */

interface ManagerInfluencerDirectoryProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  meta_api: { label: '메타 연동', cls: 'bg-emerald-50 text-emerald-600' },
  self: { label: '본인 입력', cls: 'bg-amber-50 text-amber-600' },
  none: { label: '지표 미등록', cls: 'bg-slate-100 text-slate-400' },
};

const ManagerInfluencerDirectory: React.FC<ManagerInfluencerDirectoryProps> = ({ onNotify }) => {
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [loading, setLoading] = useState(true);
  const [openUser, setOpenUser] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiService.getManagerInfluencers({ q: submitted, category });
    setLoading(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return;
    }
    setInfluencers(res.influencers || []);
    // 카테고리 집계는 필터와 무관하게 전체 기준으로 오므로 그대로 덮어써도 된다.
    setCategories(res.categories || []);
  }, [submitted, category, onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-black text-slate-900">인플루언서 명부</h3>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              픽스폴리오에 등록된 인플루언서 {formatNumberWithCommas(influencers.length)}명
              {category ? ` · ${category}` : ''}
            </p>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSubmitted(query.trim());
              }}
              placeholder="계정 · 이름 · 카테고리 · 소개 검색"
              className="text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 w-56 focus:outline-none focus:border-blue-400"
            />
            <button
              onClick={() => setSubmitted(query.trim())}
              className="px-3 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
            >
              검색
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          <button
            onClick={() => setCategory('')}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
              category === '' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            전체
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              onClick={() => setCategory(category === c.name ? '' : c.name)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                category === c.name
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {c.name} {c.count}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">명부를 불러오는 중...</p>
        </div>
      ) : influencers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">해당하는 인플루언서가 없습니다.</p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            검색어를 바꾸거나 카테고리를 풀어 보세요.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {influencers.map((p) => {
            const source = SOURCE_BADGE[p.metricsSource || 'none'] || SOURCE_BADGE.none;
            const open = openUser === p.username;
            const reels = (p.recentReels || []).slice(0, 3);
            return (
              <div key={p.username} className="bg-white rounded-2xl border border-slate-100 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">
                      {p.name || `@${p.username}`}
                    </p>
                    <p className="text-[11px] text-slate-400 font-bold truncate">
                      @{p.username}
                      {p.instagramHandle && p.instagramHandle !== p.username
                        ? ` · 인스타 @${p.instagramHandle}`
                        : ''}
                    </p>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-black flex-shrink-0 ${source.cls}`}>
                    {source.label}
                  </span>
                </div>

                {p.categoryTags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {p.categoryTags.slice(0, 4).map((tag: string) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-black"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-lg px-3 py-2.5 mt-3">
                  <div className="min-w-0">
                    <p className="text-[9px] text-slate-400 font-black">팔로워</p>
                    <p className="text-[13px] text-slate-900 font-black truncate">
                      {p.followers ? formatNumberWithCommas(p.followers) : '—'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-slate-400 font-black">평균 조회수</p>
                    <p className="text-[13px] text-slate-900 font-black truncate">
                      {p.avgViews ? formatNumberWithCommas(p.avgViews) : '—'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] text-slate-400 font-black">진행 중</p>
                    <p className="text-[13px] text-slate-900 font-black truncate">
                      {p.runningCollabs}건
                    </p>
                    {p.completedCollabs > 0 && (
                      <p className="text-[10px] text-slate-400 font-bold">완료 {p.completedCollabs}</p>
                    )}
                  </div>
                </div>

                {reels.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                    {reels.map((r: any, i: number) => {
                      const inner = r?.thumbnailUrl ? (
                        <img
                          src={r.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="w-full aspect-[9/16] object-cover rounded-lg bg-slate-100"
                        />
                      ) : (
                        <div className="w-full aspect-[9/16] rounded-lg bg-slate-100 flex items-center justify-center">
                          <span className="text-[10px] text-slate-300 font-bold">영상</span>
                        </div>
                      );
                      return r?.permalink ? (
                        <a
                          key={r.id || i}
                          href={r.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block hover:opacity-80"
                        >
                          {inner}
                        </a>
                      ) : (
                        <div key={r?.id || i}>{inner}</div>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={() => setOpenUser(open ? '' : p.username)}
                  className="w-full mt-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                >
                  {open ? '접기' : '자세히'}
                </button>

                {open && (
                  <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5">
                    {p.intro && (
                      <p className="text-[11px] text-slate-600 font-medium whitespace-pre-wrap">{p.intro}</p>
                    )}
                    {(p.adPrice || p.shortPrice || p.postPrice) && (
                      <p className="text-[11px] text-slate-500 font-bold">
                        {[
                          p.adPrice ? `광고 ${p.adPrice}` : '',
                          p.shortPrice ? `숏폼 ${p.shortPrice}` : '',
                          p.postPrice ? `게시물 ${p.postPrice}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {p.contact && (
                      <p className="text-[11px] text-slate-500 font-bold">연락처 {p.contact}</p>
                    )}
                    {p.note && (
                      <p className="text-[11px] text-slate-500 font-medium whitespace-pre-wrap">
                        등록서 메모: {p.note}
                      </p>
                    )}
                    {p.instagramUrl && (
                      <a
                        href={p.instagramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[11px] text-blue-600 font-bold hover:underline break-all"
                      >
                        {p.instagramUrl}
                      </a>
                    )}
                    {!p.registered && (
                      <p className="text-[11px] text-amber-600 font-bold">
                        채널 지표를 직접 등록하지 않은 계정입니다. 숫자는 등록서에 적힌 값입니다.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ManagerInfluencerDirectory;
