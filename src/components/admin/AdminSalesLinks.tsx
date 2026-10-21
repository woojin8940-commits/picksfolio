import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { copyText } from '../../utils/clipboard';
import { formatCountKo, formatKRW, formatNumberWithCommas } from '../../utils/formatters';
import { instagramPostUrl } from '../../utils/instagramPostUrl';

/**
 * 브랜드 영업용 링크 관리.
 *
 * 링크 하나 = 브랜드에게 보낼 인플루언서 명단 하나(/pick/<토큰>). 명단에는 브랜드
 * 매칭 등록자를 골라 넣을 수도, 등록하지 않은 계정을 프로필 링크만으로 넣을 수도
 * 있다. 프로필 링크를 넣으면 팔로워·팔로잉·최근 릴스 3편을 불러오고, 못 불러온
 * 값은 여기서 손으로 채운다.
 *
 * 단가는 피드 / 릴스 두 가지다. 각각 원가(인플루언서에게 주는 금액)와 마진으로 나눠 적고,
 * 브랜드에게는 둘을 더한 제안 단가만 보인다.
 *
 * 매칭 등록자의 단가 칸은 손대기 전까지 등록서의 지금 단가를 따라간다. 운영자가 그 칸을
 * 저장하면 저장한 금액으로 고정되고, 등록서 단가가 바뀌어도 브랜드에게는 정한 금액이 보인다.
 */

interface Reel { id?: string; permalink: string; thumbnailUrl: string; views?: number }

interface Item {
  id: string;
  link_id: string;
  source: 'registered' | 'external';
  application_id: string;
  instagram_handle: string;
  profile_url: string;
  display_name: string;
  profile_image_url: string;
  category: string;
  followers: number;
  following: number;
  recent_reels: Reel[];
  base_price: number;
  /** 피드 단가 (base_price = 원가, price = 브랜드 노출) */
  price: number;
  /** 릴스 단가 */
  reels_base_price: number;
  reels_price: number;
  price_note: string;
  memo: string;
  fetch_error: string;
  synced_at: string | null;
  /** 매칭 등록자 — 최근 릴스·조회수를 연동된 채널 지표에서 자동으로 가져옴 */
  reels_live?: boolean;
  /** 운영자가 저장해 고정한 단가 칸 */
  price_locked?: boolean;
  reels_price_locked?: boolean;
  /** 매칭 등록자 — 손대지 않은 단가 칸이 등록서 단가를 따르는 중 */
  price_live?: boolean;
  reels_price_live?: boolean;
  /** 지금 등록서에 적힌 원가 */
  registered_price?: number;
  registered_reels_price?: number;
}

interface SalesLink {
  id: string;
  token: string;
  title: string;
  brand_name: string;
  intro: string;
  is_active: boolean;
  created_at: string;
  items: Item[];
}

interface DirEntry {
  id: string;
  name: string;
  applicant_username: string;
  instagram_url: string;
  instagram_handle?: string;
  follower_count: number;
  category: string;
  ad_price: string;
}

const digits = (v: string) => v.replace(/[^\d]/g, '');
const num = (v: string | number) => Number(digits(String(v ?? ''))) || 0;
const publicUrl = (token: string) => `${window.location.origin}/pick/${token}`;

const AdminSalesLinks: React.FC<{ token: string }> = ({ token }) => {
  const [links, setLinks] = useState<SalesLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const headers = useCallback(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/sales-links', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || '요청에 실패했습니다.');
    return data;
  }, [headers]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/sales-links', { credentials: 'same-origin', headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setLinks(data.links || []);
      setSelectedId(prev => prev && (data.links || []).some((l: SalesLink) => l.id === prev) ? prev : data.links?.[0]?.id || null);
    } catch {
      setNotice({ tone: 'warn', text: '영업 링크를 불러오지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const selected = links.find(l => l.id === selectedId) || null;

  /** 화면의 명단 순서를 먼저 바꾼다. 서버 응답을 기다리면 누른 뒤 한참 그대로라 안 눌린 것처럼 보인다. */
  const moveLocal = useCallback((linkId: string, itemId: string, direction: 'up' | 'down') => {
    setLinks(prev => prev.map(l => {
      if (l.id !== linkId) return l;
      const items = [...l.items];
      const at = items.findIndex(i => i.id === itemId);
      const to = direction === 'up' ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= items.length) return l;
      [items[at], items[to]] = [items[to], items[at]];
      return { ...l, items };
    }));
  }, []);

  const createLink = async () => {
    try {
      const data = await call({ action: 'create_link', title: '인플루언서 제안' });
      await load();
      setSelectedId(data.link.id);
    } catch (e) {
      setNotice({ tone: 'warn', text: (e as Error).message });
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <div className="w-7 h-7 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400 font-bold">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div className={`rounded-xl px-4 py-3 text-xs font-bold flex items-center justify-between gap-3 ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">닫기</button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        {links.map(l => (
          <button
            key={l.id}
            onClick={() => setSelectedId(l.id)}
            className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${selectedId === l.id ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}
          >
            {l.brand_name || l.title}
            <span className="ml-1.5 opacity-60">{l.items.length}</span>
            {!l.is_active && <span className="ml-1.5 text-[10px] text-rose-400">비공개</span>}
          </button>
        ))}
        <button onClick={createLink} className="px-4 py-2 rounded-xl text-sm font-black bg-blue-600 text-white hover:bg-blue-700">
          + 새 영업 링크
        </button>
      </div>

      {!selected ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <p className="text-sm text-slate-400 font-bold">아직 영업 링크가 없습니다. '새 영업 링크'로 시작하세요.</p>
        </div>
      ) : (
        <LinkEditor
          key={selected.id}
          link={selected}
          call={call}
          headers={headers}
          reload={load}
          notify={setNotice}
          moveLocal={moveLocal}
        />
      )}
    </div>
  );
};

const LinkEditor: React.FC<{
  link: SalesLink;
  call: (b: Record<string, unknown>) => Promise<any>;
  headers: () => Record<string, string>;
  reload: () => Promise<void>;
  notify: (n: { tone: 'ok' | 'warn'; text: string } | null) => void;
  moveLocal: (linkId: string, itemId: string, direction: 'up' | 'down') => void;
}> = ({ link, call, headers, reload, notify, moveLocal }) => {
  const [title, setTitle] = useState(link.title);
  const [brand, setBrand] = useState(link.brand_name);
  const [intro, setIntro] = useState(link.intro);
  const [active, setActive] = useState(link.is_active);
  const [savingLink, setSavingLink] = useState(false);

  const [profileUrl, setProfileUrl] = useState('');
  const [newBase, setNewBase] = useState('');
  const [newMargin, setNewMargin] = useState('');
  const [newReelsBase, setNewReelsBase] = useState('');
  const [newReelsMargin, setNewReelsMargin] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 추가 결과는 추가 칸 바로 아래에 띄운다. 페이지 맨 위 알림은 스크롤을 내린 상태에서 보이지 않는다.
  const [addNotice, setAddNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const dirty = title !== link.title || brand !== link.brand_name || intro !== link.intro || active !== link.is_active;

  const saveLink = async () => {
    setSavingLink(true);
    try {
      await call({ action: 'update_link', id: link.id, title, brand_name: brand, intro, is_active: active });
      await reload();
      notify({ tone: 'ok', text: '링크 정보를 저장했습니다.' });
    } catch (e) {
      notify({ tone: 'warn', text: (e as Error).message });
    } finally {
      setSavingLink(false);
    }
  };

  const deleteLink = async () => {
    if (!confirm(`'${link.brand_name || link.title}' 영업 링크를 삭제할까요? 공개 주소도 더는 열리지 않습니다.`)) return;
    try {
      await call({ action: 'delete_link', id: link.id });
      await reload();
    } catch (e) {
      notify({ tone: 'warn', text: (e as Error).message });
    }
  };

  const addExternal = async () => {
    if (!profileUrl.trim()) return;
    setAdding(true);
    setAddNotice(null);
    try {
      const base = num(newBase);
      const reelsBase = num(newReelsBase);
      const data = await call({
        action: 'add_external',
        link_id: link.id,
        profile_url: profileUrl,
        base_price: base,
        price: base + num(newMargin),
        reels_base_price: reelsBase,
        reels_price: reelsBase + num(newReelsMargin),
        category: newCategory,
        price_note: newNote,
      });
      setProfileUrl(''); setNewBase(''); setNewMargin(''); setNewReelsBase(''); setNewReelsMargin(''); setNewCategory(''); setNewNote('');
      await reload();
      setAddNotice(data.warning
        ? { tone: 'warn', text: `@${data.item.instagram_handle} 를 추가했지만 정보를 불러오지 못했습니다: ${data.warning} 아래 카드에서 직접 입력해 주세요.` }
        : { tone: 'ok', text: `@${data.item.instagram_handle} 를 추가했습니다.` });
    } catch (e) {
      setAddNotice({ tone: 'warn', text: (e as Error).message });
    } finally {
      setAdding(false);
    }
  };

  const url = publicUrl(link.token);
  const totalFeed = link.items.reduce((s, i) => s + i.price, 0);
  const totalFeedBase = link.items.reduce((s, i) => s + i.base_price, 0);
  const totalReels = link.items.reduce((s, i) => s + i.reels_price, 0);
  const totalReelsBase = link.items.reduce((s, i) => s + i.reels_base_price, 0);

  return (
    <div className="space-y-4">
      {/* 링크 정보 */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
            {active ? '공개 중' : '비공개'}
          </span>
          <code className="text-xs font-bold text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1 truncate max-w-full">{url}</code>
          <button
            onClick={async () => notify((await copyText(url)) ? { tone: 'ok', text: '링크를 복사했습니다.' } : { tone: 'warn', text: '복사하지 못했습니다.' })}
            className="px-3 py-1 rounded-lg bg-slate-900 text-white text-xs font-black hover:bg-blue-600"
          >
            링크 복사
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="px-3 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-black hover:bg-slate-200">
            브랜드 화면 보기
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="브랜드명">
            <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="예: 라운드랩" className={inputCls} />
          </Field>
          <Field label="제목">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 여름 선케어 캠페인 추천 인플루언서" className={inputCls} />
          </Field>
        </div>
        <Field label="소개 문구 (브랜드 화면 상단)">
          <textarea value={intro} onChange={e => setIntro(e.target.value)} rows={2} className={`${inputCls} resize-y`} placeholder="브랜드에 전할 한두 줄" />
        </Field>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            링크 공개 (끄면 브랜드가 열 수 없습니다)
          </label>
          <div className="flex gap-2">
            <button onClick={deleteLink} className="px-3 py-2 rounded-xl text-xs font-black text-rose-500 hover:bg-rose-50">링크 삭제</button>
            <button onClick={saveLink} disabled={!dirty || savingLink} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black disabled:opacity-40">
              {savingLink ? '저장 중...' : '링크 정보 저장'}
            </button>
          </div>
        </div>
      </section>

      {/* 인플루언서 추가 */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-black text-slate-900">인플루언서 추가</p>
          <button onClick={() => { setAddNotice(null); setPickerOpen(true); }} className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-black hover:bg-slate-200">
            브랜드 매칭 등록자에서 가져오기
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            value={profileUrl}
            onChange={e => setProfileUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addExternal(); }}
            placeholder="인스타 프로필 링크 또는 @아이디"
            className={`${inputCls} md:col-span-6`}
          />
          <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="분야 (예: 뷰티, 육아)" className={`${inputCls} md:col-span-4`} />
          <button onClick={addExternal} disabled={adding || !profileUrl.trim()} className="md:col-span-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-40 hover:bg-blue-600">
            {adding ? '불러오는 중...' : '추가'}
          </button>
          <input value={formatNumberWithCommas(newBase)} onChange={e => setNewBase(digits(e.target.value))} placeholder="피드 원가(원)" inputMode="numeric" className={`${inputCls} md:col-span-3`} />
          <input value={formatNumberWithCommas(newMargin)} onChange={e => setNewMargin(digits(e.target.value))} placeholder="피드 마진(원)" inputMode="numeric" className={`${inputCls} md:col-span-3`} />
          <input value={formatNumberWithCommas(newReelsBase)} onChange={e => setNewReelsBase(digits(e.target.value))} placeholder="릴스 원가(원)" inputMode="numeric" className={`${inputCls} md:col-span-3`} />
          <input value={formatNumberWithCommas(newReelsMargin)} onChange={e => setNewReelsMargin(digits(e.target.value))} placeholder="릴스 마진(원)" inputMode="numeric" className={`${inputCls} md:col-span-3`} />
          <input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="단가 설명 (예: 스토리 1회 포함)" className={`${inputCls} md:col-span-8`} />
          <p className="md:col-span-4 self-center text-[11px] font-bold text-slate-400">
            제안 단가 · 피드 {formatKRW(num(newBase) + num(newMargin))} · 릴스 {formatKRW(num(newReelsBase) + num(newReelsMargin))}
          </p>
        </div>
        {addNotice && (
          <p className={`rounded-lg px-3 py-2 text-xs font-bold ${addNotice.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {addNotice.text}
          </p>
        )}
        <p className="text-[11px] font-medium text-slate-400">
          프로필 링크를 넣으면 팔로워·팔로잉·최근 릴스 3편을 불러옵니다. 인스타그램이 응답하지 않으면 카드에서 직접 입력할 수 있습니다.
        </p>
      </section>

      {/* 명단 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
          <span>명단 {link.items.length}명</span>
          <span>
            피드 제안가 합계 {formatKRW(totalFeed)} (마진 {formatKRW(totalFeed - totalFeedBase)}) · 릴스 제안가 합계 {formatKRW(totalReels)} (마진 {formatKRW(totalReels - totalReelsBase)})
          </span>
        </div>
        {link.items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center text-sm text-slate-400 font-bold">아직 담긴 인플루언서가 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {link.items.map((it, i) => (
              <ItemCard
                key={`${it.id}-${it.synced_at}-${it.base_price}-${it.price}-${it.reels_base_price}-${it.reels_price}-${it.price_locked}-${it.reels_price_locked}-${it.followers}`}
                item={it}
                first={i === 0}
                last={i === link.items.length - 1}
                call={call}
                reload={reload}
                notify={notify}
                onMove={direction => moveLocal(link.id, it.id, direction)}
              />
            ))}
          </div>
        )}
      </section>

      {pickerOpen && (
        <RegisteredPicker
          headers={headers}
          existingIds={new Set(link.items.map(i => i.application_id).filter(Boolean))}
          onClose={() => setPickerOpen(false)}
          onPick={async ids => {
            // 실패 문구는 창 안에 띄운다. 창 뒤(페이지 맨 위)에 띄우면 어두운 배경에 가려
            // 버튼을 눌러도 아무 일도 없는 것처럼 보인다.
            try {
              const data = await call({ action: 'add_registered', link_id: link.id, application_ids: ids });
              setPickerOpen(false);
              await reload();
              const notes = [
                data.skipped?.length ? `이미 있는 계정 ${data.skipped.map((h: string) => '@' + h).join(', ')} 은(는) 건너뛰었습니다.` : '',
                data.failed ? `${data.failed}명은 추가하지 못했습니다. 다시 시도해 주세요.` : '',
              ].filter(Boolean).join(' ');
              setAddNotice({ tone: notes ? 'warn' : 'ok', text: `${data.added}명을 추가했습니다.${notes ? ` ${notes}` : ''}` });
              return '';
            } catch (e) {
              return (e as Error).message;
            }
          }}
        />
      )}
    </div>
  );
};

const ItemCard: React.FC<{
  item: Item;
  first: boolean;
  last: boolean;
  call: (b: Record<string, unknown>) => Promise<any>;
  reload: () => Promise<void>;
  notify: (n: { tone: 'ok' | 'warn'; text: string } | null) => void;
  onMove: (direction: 'up' | 'down') => void;
}> = ({ item, first, last, call, reload, notify, onMove }) => {
  const [name, setName] = useState(item.display_name);
  const [category, setCategory] = useState(item.category);
  const [followers, setFollowers] = useState(String(item.followers || ''));
  const [following, setFollowing] = useState(String(item.following || ''));
  const [reels, setReels] = useState<string[]>(() => [0, 1, 2].map(i => item.recent_reels[i]?.permalink || ''));
  const [reelViews, setReelViews] = useState<string[]>(() => [0, 1, 2].map(i => String(item.recent_reels[i]?.views || '')));
  const [base, setBase] = useState(String(item.base_price || ''));
  const [margin, setMargin] = useState(String(Math.max(0, item.price - item.base_price) || ''));
  const [reelsBase, setReelsBase] = useState(String(item.reels_base_price || ''));
  const [reelsMargin, setReelsMargin] = useState(String(Math.max(0, item.reels_price - item.reels_base_price) || ''));
  const [note, setNote] = useState(item.price_note);
  const [memo, setMemo] = useState(item.memo);
  const [busy, setBusy] = useState<'' | 'save' | 'refresh'>('');

  const price = num(base) + num(margin);
  const reelsPrice = num(reelsBase) + num(reelsMargin);
  const dirty = useMemo(() => (
    name !== item.display_name || category !== item.category || num(followers) !== item.followers ||
    num(following) !== item.following || note !== item.price_note || memo !== item.memo ||
    num(base) !== item.base_price || price !== item.price ||
    num(reelsBase) !== item.reels_base_price || reelsPrice !== item.reels_price ||
    reels.join('|') !== [0, 1, 2].map(i => item.recent_reels[i]?.permalink || '').join('|') ||
    reelViews.map(num).join('|') !== [0, 1, 2].map(i => Number(item.recent_reels[i]?.views || 0)).join('|')
  ), [name, category, followers, following, note, memo, base, price, reelsBase, reelsPrice, reels, reelViews, item]);

  const marginOf = (b: string, pct: number) => String(Math.round((num(b) * pct) / 100 / 1000) * 1000);
  const applyPercent = (pct: number) => {
    setMargin(marginOf(base, pct));
    setReelsMargin(marginOf(reelsBase, pct));
  };

  // 매칭 등록자의 단가 칸을 고쳐 저장하면 그 금액으로 고정한다. 고정하지 않으면 다음에 열 때
  // 등록서 단가로 다시 바뀌어, 운영자가 정한 금액과 브랜드가 보는 금액이 어긋난다.
  const feedLocked = !!item.price_locked || num(base) !== item.base_price || price !== item.price;
  const reelsLocked = !!item.reels_price_locked || num(reelsBase) !== item.reels_base_price || reelsPrice !== item.reels_price;

  const save = async () => {
    setBusy('save');
    try {
      await call({
        action: 'update_item', id: item.id,
        display_name: name, category, followers: num(followers), following: num(following),
        recent_reels: reels
          .map((permalink, i) => ({ permalink: permalink.trim(), views: num(reelViews[i]) }))
          .filter(r => r.permalink),
        base_price: num(base), price,
        reels_base_price: num(reelsBase), reels_price: reelsPrice,
        ...(item.source === 'registered' ? { price_locked: feedLocked, reels_price_locked: reelsLocked } : {}),
        price_note: note, memo,
      });
      await reload();
      notify({ tone: 'ok', text: `@${item.instagram_handle} 정보를 저장했습니다.` });
    } catch (e) {
      notify({ tone: 'warn', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  /** 고정을 풀고 등록서 단가를 다시 따른다. 마진은 지운다(원가 = 제안가). */
  const followRegistered = async (kind: 'feed' | 'reels') => {
    setBusy('save');
    try {
      await call(kind === 'feed'
        ? { action: 'update_item', id: item.id, price_locked: false, base_price: 0, price: 0 }
        : { action: 'update_item', id: item.id, reels_price_locked: false, reels_base_price: 0, reels_price: 0 });
      await reload();
      notify({ tone: 'ok', text: `@${item.instagram_handle} 의 ${kind === 'feed' ? '피드' : '릴스'} 단가가 등록서 단가를 따릅니다.` });
    } catch (e) {
      notify({ tone: 'warn', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      await call({ action: 'refresh_item', id: item.id });
      await reload();
      notify({ tone: 'ok', text: `@${item.instagram_handle} 의 팔로워·릴스를 새로 불러왔습니다.` });
    } catch (e) {
      notify({ tone: 'warn', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const move = async (direction: 'up' | 'down') => {
    onMove(direction);
    try { await call({ action: 'move_item', id: item.id, direction }); }
    catch (e) {
      // 서버에 못 남겼으면 화면도 서버 순서로 되돌린다.
      await reload();
      notify({ tone: 'warn', text: `순서를 바꾸지 못했습니다: ${(e as Error).message}` });
    }
  };

  const remove = async () => {
    if (!confirm(`@${item.instagram_handle} 를 이 링크에서 뺄까요?`)) return;
    try { await call({ action: 'delete_item', id: item.id }); await reload(); }
    catch (e) { notify({ tone: 'warn', text: (e as Error).message }); }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-full bg-slate-100 overflow-hidden shrink-0">
          {item.profile_image_url && <img src={item.profile_image_url} alt="" className="w-full h-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <a href={item.profile_url} target="_blank" rel="noopener noreferrer" className="font-black text-sm text-slate-900 hover:text-blue-600 truncate">
              @{item.instagram_handle || '(아이디 없음)'}
            </a>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${item.source === 'registered' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
              {item.source === 'registered' ? '매칭 등록자' : '미등록'}
            </span>
          </div>
          <p className="text-[11px] font-medium text-slate-400">
            {formatCountKo(item.followers)} 팔로워 · {item.synced_at ? `불러온 날 ${new Date(item.synced_at).toLocaleDateString('ko-KR')}` : '자동으로 불러오지 못함'}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconBtn label="위로" disabled={first} onClick={() => move('up')}>↑</IconBtn>
          <IconBtn label="아래로" disabled={last} onClick={() => move('down')}>↓</IconBtn>
          <IconBtn label="삭제" onClick={remove}>✕</IconBtn>
        </div>
      </div>

      {item.fetch_error && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">{item.fetch_error}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label="이름"><input value={name} onChange={e => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="분야"><input value={category} onChange={e => setCategory(e.target.value)} placeholder="뷰티, 육아" className={inputCls} /></Field>
        <Field label="팔로워"><input value={formatNumberWithCommas(followers)} onChange={e => setFollowers(digits(e.target.value))} inputMode="numeric" className={inputCls} /></Field>
        <Field label="팔로잉"><input value={formatNumberWithCommas(following)} onChange={e => setFollowing(digits(e.target.value))} inputMode="numeric" className={inputCls} /></Field>
      </div>

      <div>
        <p className="text-[10px] font-black text-slate-400 mb-1.5">
          {item.reels_live
            ? '최근 릴스 3편 · 조회수 (매칭 등록자 — 연동된 채널의 최근 릴스·조회수가 자동으로 표시됨)'
            : '최근 릴스 3편 · 조회수 (비우면 브랜드 화면에 안 보임)'}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map(i => {
            const saved = item.recent_reels.find(r => r.permalink === reels[i]);
            return (
              <div key={i} className="space-y-1">
                <a
                  href={reels[i] ? instagramPostUrl(reels[i]) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-[9/16] max-h-40 w-full rounded-lg overflow-hidden bg-slate-100"
                >
                  {saved?.thumbnailUrl ? (
                    <img src={saved.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-slate-300">{reels[i] ? 'REELS' : '비어 있음'}</div>
                  )}
                </a>
                <input
                  value={reels[i]}
                  onChange={e => setReels(prev => prev.map((r, j) => (j === i ? e.target.value : r)))}
                  placeholder="릴스 링크"
                  readOnly={item.reels_live}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-medium text-slate-700 placeholder:text-slate-400 read-only:bg-slate-50 read-only:text-slate-500"
                />
                <input
                  value={formatNumberWithCommas(reelViews[i])}
                  onChange={e => setReelViews(prev => prev.map((v, j) => (j === i ? digits(e.target.value) : v)))}
                  placeholder="조회수"
                  readOnly={item.reels_live}
                  inputMode="numeric"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-medium text-slate-700 placeholder:text-slate-400 read-only:bg-slate-50 read-only:text-slate-500"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 p-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Field label={item.price_live ? '피드 원가 (등록서 게시물 단가 연동)' : '피드 원가 (운영자만)'}><input value={formatNumberWithCommas(base)} onChange={e => setBase(digits(e.target.value))} inputMode="numeric" className={inputCls} /></Field>
          <Field label="피드 마진"><input value={formatNumberWithCommas(margin)} onChange={e => setMargin(digits(e.target.value))} inputMode="numeric" className={inputCls} /></Field>
          <Field label="피드 단가 (브랜드 노출)">
            <div className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-black">{price > 0 ? formatKRW(price) : '협의'}</div>
          </Field>
          <Field label={item.reels_price_live ? '릴스 원가 (등록서 숏폼 단가 연동)' : '릴스 원가 (운영자만)'}><input value={formatNumberWithCommas(reelsBase)} onChange={e => setReelsBase(digits(e.target.value))} inputMode="numeric" className={inputCls} /></Field>
          <Field label="릴스 마진"><input value={formatNumberWithCommas(reelsMargin)} onChange={e => setReelsMargin(digits(e.target.value))} inputMode="numeric" className={inputCls} /></Field>
          <Field label="릴스 단가 (브랜드 노출)">
            <div className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-black">{reelsPrice > 0 ? formatKRW(reelsPrice) : '협의'}</div>
          </Field>
        </div>
        {item.source === 'registered' && (
          <div className="space-y-1">
            <RegisteredPriceNote label="피드" locked={!!item.price_locked} live={!!item.price_live} registered={item.registered_price || 0} base={item.base_price} disabled={!!busy} onFollow={() => followRegistered('feed')} onApply={() => setBase(String(item.registered_price || ''))} />
            <RegisteredPriceNote label="릴스" locked={!!item.reels_price_locked} live={!!item.reels_price_live} registered={item.registered_reels_price || 0} base={item.reels_base_price} disabled={!!busy} onFollow={() => followRegistered('reels')} onApply={() => setReelsBase(String(item.registered_reels_price || ''))} />
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold text-slate-400">원가 기준 마진</span>
          {[20, 30, 50, 100].map(p => (
            <button key={p} onClick={() => applyPercent(p)} disabled={!num(base) && !num(reelsBase)} className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-black text-slate-600 disabled:opacity-40 hover:border-slate-400">
              +{p}%
            </button>
          ))}
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="단가 설명 (브랜드 노출, 예: 스토리 1회 포함)" className={inputCls} />
        <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={1} placeholder="운영자 메모 (브랜드에게 보이지 않음)" className={`${inputCls} resize-y`} />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={refresh} disabled={!!busy} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black disabled:opacity-40 hover:bg-slate-200">
          {busy === 'refresh' ? '불러오는 중...' : '인스타에서 새로고침'}
        </button>
        <button onClick={save} disabled={!dirty || !!busy} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black disabled:opacity-40">
          {busy === 'save' ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
};

const handleOf = (d: DirEntry) => {
  const linked = String(d.instagram_handle || '').replace(/^@/, '');
  if (linked) return linked;
  return String(d.instagram_url || '').match(/instagram\.com\/([^/?#]+)/i)?.[1] || d.applicant_username || '';
};

const RegisteredPicker: React.FC<{
  headers: () => Record<string, string>;
  existingIds: Set<string>;
  onClose: () => void;
  /** 실패하면 이유 문구를, 성공하면 빈 문자열을 돌려준다. */
  onPick: (ids: string[]) => Promise<string>;
}> = ({ headers, existingIds, onClose, onPick }) => {
  const [list, setList] = useState<DirEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/collab-directory?role=influencer&sort=followers', { credentials: 'same-origin', headers: headers() })
      .then(r => r.json())
      .then(d => setList(d.applications || []))
      .catch(() => setList([]));
  }, [headers]);

  const q = query.trim().toLowerCase();
  const shown = (list || []).filter(d =>
    !q || [handleOf(d), d.name, d.category].some(v => String(v || '').toLowerCase().includes(q)));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 space-y-2">
          <p className="font-black text-slate-900">브랜드 매칭 등록자에서 가져오기</p>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="아이디·이름·분야 검색" className={inputCls} autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {list === null ? (
            <p className="p-8 text-center text-sm font-bold text-slate-400">불러오는 중...</p>
          ) : shown.length === 0 ? (
            <p className="p-8 text-center text-sm font-bold text-slate-400">해당하는 등록자가 없습니다.</p>
          ) : shown.map(d => {
            const already = existingIds.has(d.id);
            return (
              <label key={d.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl ${already ? 'opacity-40' : 'hover:bg-slate-50 cursor-pointer'}`}>
                <input
                  type="checkbox"
                  disabled={already}
                  checked={already || picked.has(d.id)}
                  onChange={e => setPicked(prev => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(d.id); else next.delete(d.id);
                    return next;
                  })}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 truncate">@{handleOf(d)} <span className="font-medium text-slate-400">{d.name}</span></p>
                  <p className="text-[11px] font-bold text-slate-400 truncate">
                    {formatCountKo(d.follower_count)} 팔로워{d.category ? ` · ${d.category}` : ''}{d.ad_price ? ` · 희망 단가 ${d.ad_price}` : ''}
                  </p>
                </div>
                {already && <span className="text-[10px] font-black text-slate-400">추가됨</span>}
              </label>
            );
          })}
        </div>
        {error && <p className="mx-4 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>}
        <div className="p-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-500">{picked.size}명 선택</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-black">취소</button>
            <button
              disabled={!picked.size || busy}
              onClick={async () => { setBusy(true); setError(''); setError(await onPick([...picked])); setBusy(false); }}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black disabled:opacity-40"
            >
              {busy ? '불러오는 중...' : '추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:border-blue-400';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] font-black text-slate-400 mb-1">{label}</span>
    {children}
  </label>
);

/** 매칭 등록자 단가 칸 하나가 등록서를 따르는지, 운영자 금액으로 고정됐는지 알려 준다. */
const RegisteredPriceNote: React.FC<{
  label: string;
  locked: boolean;
  live: boolean;
  registered: number;
  base: number;
  disabled: boolean;
  onFollow: () => void;
  onApply: () => void;
}> = ({ label, locked, live, registered, base, disabled, onFollow, onApply }) => {
  const btn = 'px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-black text-slate-600 disabled:opacity-40 hover:border-slate-400';
  if (live) {
    return (
      <p className="text-[10px] font-bold text-blue-600">
        {label}: 등록서 단가 {formatKRW(registered)} 연동 중 · 고쳐 저장하면 그 금액으로 고정됩니다
      </p>
    );
  }
  if (locked) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold text-slate-500">
        <span>{label}: 운영자가 정한 금액으로 고정</span>
        {registered > 0 && registered !== base && (
          <>
            <span className="text-amber-600">· 지금 등록서 단가 {formatKRW(registered)}</span>
            <button type="button" onClick={onApply} disabled={disabled} className={btn}>원가에 넣기</button>
          </>
        )}
        {registered > 0 && <button type="button" onClick={onFollow} disabled={disabled} className={btn}>등록서 단가 따르기</button>}
      </div>
    );
  }
  return <p className="text-[10px] font-bold text-slate-400">{label}: 등록서에 적힌 단가가 없습니다</p>;
};

const IconBtn: React.FC<{ label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }> = ({ label, disabled, onClick, children }) => (
  <button
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="w-7 h-7 rounded-lg bg-slate-50 text-slate-500 text-xs font-black hover:bg-slate-200 disabled:opacity-30"
  >
    {children}
  </button>
);

export default AdminSalesLinks;
