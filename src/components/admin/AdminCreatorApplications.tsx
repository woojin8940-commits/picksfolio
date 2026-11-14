import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { affiliateStoreService, type CreatorRosterEntry } from '../../services/affiliateStoreService';
import { formatNumberWithCommas, formatPhone, parseWonText } from '../../utils/formatters';
import { CREATOR_CATEGORIES, parseCategoryList } from '../../utils/creatorCategories';
import InfluencerCandidateCard from '../collab/InfluencerCandidateCard';

/**
 * 크리에이터 명단 — 새로 들어온 인플루언서의 크리에이터 지원서와, 기존 크리에이터
 * (브랜드 매칭받기 등록자 · 픽스폴리오에서 인스타를 연동한 사람)를 함께 보여 준다.
 * 지원서는 승인하면 자동 디엠 · 어필리에이트가 바로 열린다. 기존 계정은 자동 승인이라 심사 버튼이 없다.
 *
 * 카드는 어필리에이트 · 캠페인 지원자 카드와 같다 — 인스타 계정 · 팔로워 · 최근 숏폼 3편.
 * 단가는 지원서에 적은 릴스 광고 단가를 보여 준다.
 */

type Status = CreatorRosterEntry['status'];
type Filter = 'all' | 'legacy' | Status;

const STATUS_LABEL: Record<Status, string> = { pending: '심사 대기', approved: '승인된 크리에이터', rejected: '반려', none: '미지원(연동만)' };
const STATUS_STYLE: Record<Status, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
  none: 'bg-slate-100 text-slate-500',
};
const FILTER_LABEL: Record<Filter, string> = { ...STATUS_LABEL, legacy: '기존 크리에이터', all: '전체' };
/** 인스타 주소에서 계정명을 뽑는다(instagram.com/<계정>/...). */
const handleFromUrl = (url?: string) => {
  const m = String(url || '').match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const h = m ? m[1] : '';
  return ['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(h.toLowerCase()) ? '' : h;
};
type Sort = 'recent' | 'followers' | 'price_desc' | 'price_asc';
const SORT_LABEL: Record<Sort, string> = { recent: '최신순', followers: '팔로워 많은 순', price_desc: '릴스 단가 높은 순', price_asc: '릴스 단가 낮은 순' };
/** 지원서 카테고리가 먼저, 없으면 인스타 스냅샷(매칭 등록) 카테고리. */
const categoriesOf = (r: CreatorRosterEntry) => parseCategoryList(r.categories || r.insights?.categories);
const followersOf = (r: CreatorRosterEntry) => Number(r.insights?.followers || 0);
/** 지원서 단가(원)가 먼저, 없으면 매칭 등록 단가 문구("50만원")를 숫자로. 없으면 0. */
const priceOf = (r: CreatorRosterEntry) => Number(r.shortPrice || 0) || parseWonText(r.insights?.shortPrice);
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

const AdminCreatorApplications: React.FC<{ token: string }> = ({ token }) => {
  const [rows, setRows] = useState<CreatorRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('pending');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [filterChosen, setFilterChosen] = useState(false);
  const [sort, setSort] = useState<Sort>('recent');
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await affiliateStoreService.listCreatorApplications(token);
    if (res.error) setError(res.error);
    else {
      setError('');
      const list = res.applications || [];
      setRows(list);
      // 처음 열 때 심사 대기가 없으면 승인된 명단부터 보여 준다.
      if (!filterChosen && !list.some(r => r.status === 'pending')) setFilter('approved');
    }
    setLoading(false);
  }, [token, filterChosen]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    none: rows.filter(r => r.status === 'none').length,
    legacy: rows.filter(r => r.source === 'legacy').length,
  }), [rows]);
  const needle = q.trim().toLowerCase().replace(/^@/, '');
  // 카테고리 목록: 기본 14개 중 명단에 있는 것 + 명단에만 있는 직접 입력 분야. 각 칸에 인원수를 붙인다.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => categoriesOf(r).forEach(c => m.set(c, (m.get(c) || 0) + 1)));
    const preset = CREATOR_CATEGORIES.filter(c => m.has(c)) as string[];
    const extra = Array.from(m.keys()).filter(c => !preset.includes(c)).sort((a, b) => a.localeCompare(b, 'ko'));
    return [...preset, ...extra].map(c => ({ name: c, count: m.get(c) || 0 }));
  }, [rows]);
  const uncategorized = useMemo(() => rows.filter(r => categoriesOf(r).length === 0).length, [rows]);
  const filtered = rows
    .filter(r => filter === 'all' || (filter === 'legacy' ? r.source === 'legacy' : r.status === filter))
    .filter(r => !category || (category === '__none' ? categoriesOf(r).length === 0 : categoriesOf(r).includes(category)))
    .filter(r => !needle || [r.username, r.name, r.instagramUrl, r.instagramHandle, r.insights?.instagramHandle].some(v => String(v || '').toLowerCase().includes(needle)));
  // 정렬. 값이 없는 사람(팔로워 · 단가 미입력)은 항상 맨 뒤로 보낸다.
  const visible = sort === 'recent' ? filtered : [...filtered].sort((a, b) => {
    const va = sort === 'followers' ? followersOf(a) : priceOf(a);
    const vb = sort === 'followers' ? followersOf(b) : priceOf(b);
    if (!va || !vb) return (vb ? 1 : 0) - (va ? 1 : 0);
    return sort === 'price_asc' ? va - vb : vb - va;
  });

  const review = async (r: CreatorRosterEntry, decision: 'approve' | 'reject') => {
    let reason = '';
    if (decision === 'reject') {
      const input = window.prompt(`@${r.username} 크리에이터 지원을 반려합니다. 인플루언서에게 보일 사유를 적어 주세요.`, '');
      if (input === null) return;
      reason = input;
    } else if (!window.confirm(`@${r.username} 님을 크리에이터로 승인할까요? 승인하면 자동 디엠과 어필리에이트가 바로 열립니다.`)) {
      return;
    }
    setBusy(r.username);
    const res = await affiliateStoreService.reviewCreator(token, r.username, decision, reason);
    setBusy('');
    if (res.error) window.alert(res.error);
    else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-black text-slate-900">크리에이터 명단</h3>
          <p className="text-[10px] font-bold text-slate-400 mt-0.5">새로 가입한 인플루언서는 크리에이터 지원 · 승인 후 자동 디엠 · 어필리에이트를 쓸 수 있습니다. 브랜드 매칭받기 등록자 · 인스타 연동한 기존 크리에이터도 함께 보여 줍니다(기존 크리에이터는 자동 승인).</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-black text-slate-600 hover:bg-slate-200">새로고침</button>
      </div>

      <div className="flex gap-1.5 flex-wrap items-center">
        {(['pending', 'approved', 'legacy', 'none', 'rejected', 'all'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setFilterChosen(true); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black ${filter === f ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}
          >
            {FILTER_LABEL[f]} {counts[f]}
          </button>
        ))}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="아이디 · 이름 · 인스타 검색"
          className="ml-auto h-8 w-52 px-3 rounded-lg border border-slate-200 text-[11px] focus:outline-none focus:border-blue-600"
        />
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[11px] font-black text-slate-600 focus:outline-none focus:border-blue-600"
          aria-label="카테고리"
        >
          <option value="">카테고리 전체</option>
          {categoryCounts.map(c => <option key={c.name} value={c.name}>{c.name} {c.count}</option>)}
          {uncategorized > 0 && <option value="__none">카테고리 없음 {uncategorized}</option>}
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as Sort)}
          className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[11px] font-black text-slate-600 focus:outline-none focus:border-blue-600"
          aria-label="정렬"
        >
          {(Object.keys(SORT_LABEL) as Sort[]).map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
        {category && (
          <button onClick={() => setCategory('')} className="text-[11px] font-black text-blue-600">카테고리 해제</button>
        )}
        <span className="ml-auto text-[11px] font-bold text-slate-400">{visible.length}명</span>
      </div>

      {loading ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center">불러오는 중...</p>
      ) : error ? (
        <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>
      ) : visible.length === 0 ? (
        <p className="text-xs font-bold text-slate-400 py-10 text-center bg-white rounded-2xl border border-slate-100">해당하는 크리에이터가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
          {visible.map(r => {
            const insights = r.insights || {};
            const igHandle = String(insights.instagramHandle || r.instagramHandle || handleFromUrl(insights.instagramUrl || r.instagramUrl) || '').replace(/^@/, '');
            const igUrl = insights.instagramUrl || r.instagramUrl || (igHandle ? `https://www.instagram.com/${igHandle}` : '');
            const price = r.shortPrice ? `${formatNumberWithCommas(r.shortPrice)}원` : insights.shortPrice || '미입력';
            return (
              <InfluencerCandidateCard
                key={r.username}
                data={{
                  ...insights,
                  username: r.username,
                  instagramHandle: igHandle,
                  name: insights.name || r.name,
                  instagramUrl: igUrl,
                  // 지원서에 적은 숏폼 광고 단가가 원본이다. 예전 지원서처럼 비어 있으면 매칭 등록 단가를 쓴다.
                  postPrice: r.shortPrice ? '' : insights.postPrice,
                  shortPrice: r.shortPrice ? `${formatNumberWithCommas(r.shortPrice)}원` : insights.shortPrice,
                  adPrice: r.shortPrice ? '' : insights.adPrice,
                }}
                mediaMode="reels"
                badgesPlacement="below"
                badges={
                  <>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black whitespace-nowrap ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    {r.source === 'legacy' && <span className="px-2 py-0.5 rounded-md text-[10px] font-black whitespace-nowrap bg-blue-50 text-blue-600">기존</span>}
                    {r.matchRegistered && <span className="px-2 py-0.5 rounded-md text-[10px] font-black whitespace-nowrap bg-violet-50 text-violet-600">매칭 등록</span>}
                    {r.instagramLinked && <span className="px-2 py-0.5 rounded-md text-[10px] font-black whitespace-nowrap bg-pink-50 text-pink-600">인스타 연동</span>}
                    <span className="ml-auto text-[10px] text-slate-400 font-bold whitespace-nowrap">{r.source === 'application' ? '지원' : '등록'} {dateTime(r.updatedAt || r.createdAt) || '-'}</span>
                  </>
                }
                details={
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    {r.source === 'application' && r.reviewedAt && <p>처리 {dateTime(r.reviewedAt)}{r.reviewedBy ? ` (${r.reviewedBy})` : ''}</p>}
                    <p>개인정보 동의 {r.privacyConsentedAt ? dateTime(r.privacyConsentedAt) : '-'}</p>
                    <a href={`/${r.username}`} target="_blank" rel="noreferrer" className="text-blue-600 font-bold">픽스폴리오 페이지 열기</a>
                  </div>
                }
              >
                <div className="space-y-2">
                <dl className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="font-black text-slate-400 whitespace-nowrap">이름</dt>
                  <dd className="text-slate-800 font-bold truncate">{r.name || insights.name || '-'}</dd>
                  <dt className="font-black text-slate-400 whitespace-nowrap">인스타</dt>
                  <dd className="truncate">
                    {igHandle ? (
                      <a href={igUrl} target="_blank" rel="noreferrer" className="text-blue-600 font-bold">@{igHandle}</a>
                    ) : <span className="text-slate-400">미연동</span>}
                  </dd>
                  <dt className="font-black text-slate-400 whitespace-nowrap">픽스폴리오</dt>
                  <dd className="text-slate-600 truncate">@{r.username}</dd>
                  <dt className="font-black text-slate-400 whitespace-nowrap">연락처</dt>
                  <dd className="text-slate-600 truncate">{r.contact ? formatPhone(r.contact) : '없음'}</dd>
                  <dt className="font-black text-slate-400 whitespace-nowrap">카테고리</dt>
                  <dd className="flex flex-wrap gap-1 min-w-0">
                    {categoriesOf(r).length ? categoriesOf(r).map(c => (
                      <span key={c} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-black text-slate-600">{c}</span>
                    )) : <span className="text-slate-400">미선택</span>}
                  </dd>
                  <dt className="font-black text-slate-400 whitespace-nowrap">팔로워</dt>
                  <dd className="text-slate-700 font-bold truncate">{followersOf(r) ? `${formatNumberWithCommas(followersOf(r))}명` : '-'}</dd>
                  <dt className="font-black text-slate-400 whitespace-nowrap">릴스 단가</dt>
                  <dd className="text-slate-700 font-bold truncate">{price}</dd>
                </dl>
                {r.status === 'rejected' && r.rejectReason && (
                  <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-3 py-2">반려 사유: {r.rejectReason}</p>
                )}
                {r.source === 'application' && (
                  <div className="flex items-center gap-2 pt-1">
                    {r.status !== 'approved' && (
                      <button disabled={busy === r.username} onClick={() => review(r, 'approve')} className="h-9 flex-1 px-3 rounded-lg bg-blue-600 text-white text-xs font-black disabled:opacity-50">승인</button>
                    )}
                    {r.status !== 'rejected' && (
                      <button disabled={busy === r.username} onClick={() => review(r, 'reject')} className="h-9 flex-1 px-3 rounded-lg border border-slate-200 text-slate-600 text-xs font-black disabled:opacity-50">{r.status === 'approved' ? '승인 취소(반려)' : '반려'}</button>
                    )}
                  </div>
                )}
                </div>
              </InfluencerCandidateCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminCreatorApplications;
