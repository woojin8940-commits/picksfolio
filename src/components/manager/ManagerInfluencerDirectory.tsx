import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { apiService } from '../../services/apiService';
import { formatContact, formatNumberWithCommas } from '../../utils/formatters';

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
 *
 * 카드는 모두 같은 크기다. 예전에는 카테고리 태그가 없는 사람, 최근 릴스를 아직
 * 못 받은 사람의 카드가 그만큼 짧아져서, 같은 줄에 선 카드끼리도 '자세히' 버튼과
 * 숫자 칸의 높이가 서로 달랐다 — 담당자는 한 명씩 눈으로 위치를 다시 찾아야 했고,
 * 카드가 짧다는 것이 "정보가 없다"가 아니라 "카드가 잘렸다"처럼 읽혔다. 그래서
 * 값이 없는 칸도 자리를 그대로 비워 두고(태그 · 릴스 세 칸), 버튼은 카드 맨 아래에
 * 붙인다(mt-auto). 그리드는 auto-rows-fr 로 모든 줄의 높이를 같게 맞춘다.
 *
 * '자세히'는 카드 위에 겹쳐 띄운다. 카드 안쪽에 펼치면 그 카드만 길어져 같은 줄의
 * 카드가 전부 늘어나므로, 위에서 맞춰 둔 크기가 한 번 누를 때마다 흐트러진다.
 */

interface ManagerInfluencerDirectoryProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  meta_api: { label: '메타 연동', cls: 'bg-emerald-50 text-emerald-600' },
  self: { label: '본인 입력', cls: 'bg-amber-50 text-amber-600' },
  none: { label: '지표 미등록', cls: 'bg-slate-100 text-slate-400' },
};

/**
 * 보기 순서.
 *
 * 서버는 팔로워 많은순으로 내려주지만 화면에 그 사실이 적혀 있지 않아서, 담당자는
 * 지금 목록이 무슨 기준으로 서 있는지 알 수 없었고 "팔로워 작은 계정부터",
 * "조회수가 잘 나오는 사람부터"처럼 관점을 바꿀 방법도 없었다. 기준을 칩으로
 * 내놓고 어느 것이 켜져 있는지 보이게 한다.
 *
 * 숫자가 없는 사람(연동 전 · 지표 미등록)은 어떤 기준에서도 맨 아래로 보낸다.
 * 0으로 섞으면 팔로워 적은순에서 지표가 없는 사람이 목록 앞을 다 차지한다.
 */
type SortKey = 'followers' | 'followersAsc' | 'avgViews' | 'running' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'followers', label: '팔로워 많은순' },
  { key: 'followersAsc', label: '팔로워 적은순' },
  { key: 'avgViews', label: '평균 조회수순' },
  { key: 'running', label: '진행 중 많은순' },
  { key: 'name', label: '계정명순' },
];

const ManagerInfluencerDirectory: React.FC<ManagerInfluencerDirectoryProps> = ({ onNotify }) => {
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [loading, setLoading] = useState(true);
  const [openUser, setOpenUser] = useState('');
  const [sort, setSort] = useState<SortKey>('followers');

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

  const sorted = useMemo(() => {
    const handleOf = (p: any) => String(p.instagramHandle || p.username || '').toLowerCase();
    const list = [...influencers];
    list.sort((a, b) => {
      if (sort === 'name') return handleOf(a).localeCompare(handleOf(b));
      if (sort === 'running') {
        const diff = Number(b.runningCollabs || 0) - Number(a.runningCollabs || 0);
        if (diff !== 0) return diff;
        return Number(b.followers || 0) - Number(a.followers || 0);
      }
      const field = sort === 'avgViews' ? 'avgViews' : 'followers';
      const av = Number(a[field] || 0);
      const bv = Number(b[field] || 0);
      // 값이 없는 사람은 방향과 무관하게 뒤로.
      if (!av && !bv) return handleOf(a).localeCompare(handleOf(b));
      if (!av) return 1;
      if (!bv) return -1;
      return sort === 'followersAsc' ? av - bv : bv - av;
    });
    return list;
  }, [influencers, sort]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-black text-slate-900">인플루언서 명부</h3>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              픽스폴리오에 등록된 인플루언서 {formatNumberWithCommas(influencers.length)}명
              {category ? ` · ${category}` : ''}
              {` · ${SORTS.find((s) => s.key === sort)?.label}`}
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

        {/* 보기 순서. 카테고리 칩과 줄을 나눠 둔다 — 같은 줄에 섞으면 둘 다 필터로
            읽혀서 카테고리를 고른 줄 알고 순서를 누른다. */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-slate-100">
          <span className="text-[10px] text-slate-400 font-black mr-0.5">정렬</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black ${
                sort === s.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-bold">명부를 불러오는 중...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <p className="text-sm text-slate-500 font-black">해당하는 인플루언서가 없습니다.</p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">
            검색어를 바꾸거나 카테고리를 풀어 보세요.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 auto-rows-fr">
          {sorted.map((p) => {
            const source = SOURCE_BADGE[p.metricsSource || 'none'] || SOURCE_BADGE.none;
            const open = openUser === p.username;
            // 릴스 칸은 늘 세 칸이다. 못 받은 자리는 빈 칸으로 남겨 카드 높이를 지킨다.
            const reels: any[] = (p.recentReels || []).slice(0, 3);
            const reelSlots = [reels[0] || null, reels[1] || null, reels[2] || null];
            const tags: string[] = (p.categoryTags || []).slice(0, 4);
            return (
              <div
                key={p.username}
                className="relative h-full flex flex-col bg-white rounded-2xl border border-slate-100 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  {/* 인스타 계정이 맨 위다. 등록 이름으로는 이 사람을 어디서도
                      다시 찾을 수 없어서, 담당자는 이름을 읽고 나서 계정을 한 번 더
                      찾아야 했다. 이름은 아래 한 줄로 접는다. */}
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">
                      @{p.instagramHandle || p.username}
                    </p>
                    <p className="text-[11px] text-slate-400 font-bold truncate">
                      {[
                        p.name || '',
                        p.instagramHandle && p.instagramHandle !== p.username
                          ? `픽스폴리오 @${p.username}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || `@${p.username}`}
                    </p>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-black flex-shrink-0 ${source.cls}`}>
                    {source.label}
                  </span>
                </div>

                {/* 카테고리. 없는 사람도 같은 높이의 자리를 쓴다. */}
                <div className="flex flex-wrap gap-1 mt-2 min-h-[20px]">
                  {tags.length > 0 ? (
                    tags.map((tag: string) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-black"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-slate-300 font-bold">카테고리 미등록</span>
                  )}
                </div>

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
                    {/* 완료 건수는 있는 사람만 적히지만, 자리는 늘 잡아 둔다. */}
                    <p className="text-[10px] text-slate-400 font-bold min-h-[14px]">
                      {p.completedCollabs > 0 ? `완료 ${p.completedCollabs}` : ''}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                  {reelSlots.map((r: any, i: number) => {
                    const inner = r?.thumbnailUrl ? (
                      <img
                        src={r.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="w-full aspect-[9/16] object-cover rounded-lg bg-slate-100"
                      />
                    ) : (
                      <div className="w-full aspect-[9/16] rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center">
                        <span className="text-[10px] text-slate-300 font-bold">{r ? '영상' : '—'}</span>
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
                      <div key={r?.id || `empty-${i}`}>{inner}</div>
                    );
                  })}
                </div>

                {/* 버튼은 언제나 카드 맨 아래다. */}
                <div className="mt-auto pt-3">
                  <button
                    onClick={() => setOpenUser(open ? '' : p.username)}
                    className="w-full py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200"
                  >
                    자세히
                  </button>
                </div>

                {open && (
                  /* 카드 위에 겹친다. 카드 크기를 건드리지 않으려면 흐름 밖에 있어야
                     하고, 내용이 길면 이 안에서만 스크롤한다. */
                  <div className="absolute inset-0 z-10 bg-white rounded-2xl border border-slate-200 shadow-lg p-4 overflow-y-auto">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-black text-slate-900 truncate">
                        @{p.instagramHandle || p.username}
                      </p>
                      <button
                        onClick={() => setOpenUser('')}
                        className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-black hover:bg-slate-200 flex-shrink-0"
                      >
                        접기
                      </button>
                    </div>
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
                        <p className="text-[11px] text-slate-500 font-bold">연락처 {formatContact(p.contact)}</p>
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
