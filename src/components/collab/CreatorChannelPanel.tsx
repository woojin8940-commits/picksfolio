import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/apiService';
import { formatNumberWithCommas } from '../../utils/formatters';

/**
 * 인플루언서가 자기 인스타그램 계정을 등록하는 화면.
 *
 * 브랜드가 후보 명단에서 보는 숫자(팔로워 · 평균 조회수 · 최근 릴스)가 여기서
 * 나온다. 그래서 두 가지를 분명히 해 둔다.
 *
 *  - 지금은 본인이 적은 값도 받는다. 메타 API 승인이 나기 전까지 명단을 만들 수
 *    없으면 아무것도 시작되지 않는다.
 *  - 그 대신 출처를 감추지 않는다. "본인 입력"과 "메타 연동 확인"을 나란히 보여주고,
 *    연동이 되면 자기 입력 값은 더 이상 덮어쓰지 못한다(서버에서 막는다).
 *
 * 계정 연동은 이미 있는 인스타그램 로그인(디엠 자동화 연동)을 그대로 쓴다. 연동이
 * 안 된 상태에서 "지표 갱신"을 누르면 서버가 META_NOT_LINKED 로 답하고, 이 화면은
 * 연동부터 하라고 안내한다.
 */

interface CreatorChannelPanelProps {
  userName: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  meta_api: { label: '메타 연동 확인', cls: 'bg-emerald-50 text-emerald-600' },
  self: { label: '본인 입력', cls: 'bg-amber-50 text-amber-600' },
};

const emptyForm = {
  instagramHandle: '',
  instagramUrl: '',
  followers: '',
  avgViews: '',
  avgLikes: '',
  avgComments: '',
  reelsCount: '',
  intro: '',
  categories: '',
};

type Form = typeof emptyForm;

const CreatorChannelPanel: React.FC<CreatorChannelPanelProps> = ({ userName, onNotify }) => {
  const [channel, setChannel] = useState<any>(null);
  const [registered, setRegistered] = useState(false);
  const [metaLinked, setMetaLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);

  const notify = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      if (onNotify) onNotify(message, type);
    },
    [onNotify],
  );

  const load = useCallback(async () => {
    if (!userName) return;
    const res = await apiService.getCreatorChannel(userName);
    setLoading(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    const c = res.channel || null;
    setChannel(c);
    setRegistered(!!res.registered);
    setMetaLinked(!!res.metaLinked);
    if (c) {
      setForm({
        instagramHandle: c.instagramHandle || '',
        instagramUrl: c.instagramUrl || '',
        followers: c.followers ? String(c.followers) : '',
        avgViews: c.avgViews ? String(c.avgViews) : '',
        avgLikes: c.avgLikes ? String(c.avgLikes) : '',
        avgComments: c.avgComments ? String(c.avgComments) : '',
        reelsCount: c.reelsCount ? String(c.reelsCount) : '',
        intro: c.intro || '',
        categories: c.categories || '',
      });
    }
    // 아직 등록 전이면 폼을 펼쳐 둔다. 등록이 안 된 사람에게 접힌 카드를 주면
    // 무엇을 해야 하는지 알 수 없다.
    if (!res.registered) setOpen(true);
  }, [userName, notify]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    const res = await apiService.saveCreatorChannel({ username: userName, ...form });
    setBusy(false);
    if (res.error) {
      notify(res.error, 'error');
      return;
    }
    setOpen(false);
    await load();
    notify('인스타그램 계정을 저장했습니다. 브랜드 후보 명단에 이 정보가 보입니다.');
  };

  const sync = async () => {
    setBusy(true);
    const res = await apiService.syncCreatorChannel(userName);
    setBusy(false);
    if (res.error) {
      notify(
        res.code === 'META_NOT_LINKED'
          ? '인스타그램 계정 연동이 먼저 필요합니다. 디엠 자동화 설정에서 계정을 연결해 주세요.'
          : res.error,
        'error',
      );
      return;
    }
    await load();
    notify(
      res.viewsAvailable === false
        ? '최근 릴스를 불러왔습니다. 조회수는 이 계정에서 제공되지 않아 좋아요·댓글 기준으로 표시됩니다.'
        : '최근 릴스와 평균 조회수를 갱신했습니다.',
    );
  };

  const num = (key: keyof Form, label: string) => (
    <div>
      <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">{label}</label>
      <input
        type="number"
        value={form[key]}
        onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        disabled={channel?.metricsSource === 'meta_api'}
        className="w-full text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400"
      />
    </div>
  );

  if (loading) return null;

  const source = SOURCE_BADGE[channel?.metricsSource || 'self'] || SOURCE_BADGE.self;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 md:px-5 py-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-base font-black text-slate-900">내 인스타그램 계정</h3>
              {registered && (
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${source.cls}`}>
                  {source.label}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              등록해 두시면 브랜드가 캠페인 후보를 고를 때 최근 릴스와 평균 조회수를 함께 봅니다.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {registered && (
              <button
                onClick={sync}
                disabled={busy}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black hover:bg-slate-200 disabled:opacity-40"
              >
                {metaLinked ? '지표 갱신' : '연동 확인'}
              </button>
            )}
            <button
              onClick={() => setOpen(!open)}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-[10px] font-black hover:bg-slate-700"
            >
              {open ? '접기' : registered ? '수정' : '계정 등록'}
            </button>
          </div>
        </div>

        {registered && !open && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: '팔로워', value: channel?.followers },
              { label: '평균 조회수', value: channel?.avgViews },
              { label: '평균 좋아요', value: channel?.avgLikes },
              { label: '최근 릴스', value: channel?.reelsCount },
            ].map((s) => (
              <div key={s.label} className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-[9px] text-slate-400 font-black uppercase">{s.label}</p>
                <p className="text-sm text-slate-900 font-black">
                  {s.value ? formatNumberWithCommas(s.value) : '—'}
                </p>
              </div>
            ))}
          </div>
        )}

        {registered && !open && channel?.instagramUrl && (
          <a
            href={channel.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-600 font-bold hover:underline break-all mt-2 inline-block"
          >
            {channel.instagramUrl}
          </a>
        )}

        {registered && !metaLinked && (
          <p className="text-[11px] text-amber-600 font-medium mt-2">
            아직 계정 연동 전입니다. 지금은 직접 적어 주신 숫자가 "본인 입력"으로 표시되고, 연동 뒤에는
            메타에서 받아온 값으로 자동 갱신됩니다.
          </p>
        )}
      </div>

      {open && (
        <div className="p-4 md:p-5 bg-slate-50/60 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
                인스타그램 아이디
              </label>
              <input
                type="text"
                value={form.instagramHandle}
                onChange={(e) => setForm((p) => ({ ...p, instagramHandle: e.target.value }))}
                placeholder="@myaccount"
                className="w-full text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
                프로필 링크
              </label>
              <input
                type="url"
                value={form.instagramUrl}
                onChange={(e) => setForm((p) => ({ ...p, instagramUrl: e.target.value }))}
                placeholder="https://www.instagram.com/myaccount/"
                className="w-full text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>

          <div>
            <p className="text-[10px] text-slate-400 font-black uppercase mb-1.5">
              최근 릴스 기준 지표
              {channel?.metricsSource === 'meta_api' && ' · 메타 연동 값이라 직접 수정할 수 없습니다'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {num('followers', '팔로워')}
              {num('avgViews', '평균 조회수')}
              {num('avgLikes', '평균 좋아요')}
              {num('avgComments', '평균 댓글')}
              {num('reelsCount', '집계 릴스 수')}
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
              주요 카테고리
            </label>
            <input
              type="text"
              value={form.categories}
              onChange={(e) => setForm((p) => ({ ...p, categories: e.target.value }))}
              placeholder="뷰티 · 홈카페 · 일상"
              className="w-full text-[11px] font-bold text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
            />
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 font-black uppercase mb-1">
              소개
            </label>
            <textarea
              value={form.intro}
              onChange={(e) => setForm((p) => ({ ...p, intro: e.target.value }))}
              rows={3}
              placeholder="어떤 콘텐츠를 만드는지, 어떤 브랜드와 맞는지 적어주세요. 브랜드가 후보를 고를 때 이 글을 읽습니다."
              className="w-full text-[11px] font-medium text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:border-blue-400"
            />
          </div>

          <div className="flex justify-end gap-1.5">
            {registered && (
              <button
                onClick={() => setOpen(false)}
                className="px-3.5 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-[11px] font-black hover:bg-slate-50"
              >
                취소
              </button>
            )}
            <button
              onClick={save}
              disabled={busy}
              className="px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-[11px] font-black hover:bg-blue-500 disabled:opacity-40"
            >
              저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreatorChannelPanel;
