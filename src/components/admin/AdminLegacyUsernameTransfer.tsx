import React, { useState } from 'react';
import { collabHeaders } from '../../services/apiService';

/**
 * 예전 아이디·비밀번호 계정 유저네임 이전.
 *
 * 인플루언서 로그인을 카카오 하나로 줄이면서, 예전 계정으로 쓰던 유저네임(페이지 주소)을
 * 카카오로 다시 가입한 본인이 그대로 이어받게 했다. 카카오 휴대폰 번호가 예전 계정
 * 번호와 같으면 링크 만들기 화면에서 바로 옮겨진다. 번호가 다르면 운영자가 연락해
 * 본인을 확인한 뒤 여기서 이전 코드를 발급해 전달한다 — 링크 만들기 화면에서 같은
 * 유저네임과 이 코드를 넣으면 옮겨진다. 코드는 발급할 때 한 번만 보인다.
 */

interface Props {
  token: string;
}

const formatDate = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
};

const AdminLegacyUsernameTransfer: React.FC<Props> = ({ token }) => {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<any | null>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clean = username.trim().toLowerCase().replace(/^@+/, '');

  const check = async () => {
    if (!clean) return;
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const res = await fetch(`/api/admin-legacy-username?username=${encodeURIComponent(clean)}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '조회하지 못했습니다.');
      setStatus(json);
    } catch (e: any) {
      setStatus(null);
      setError(e?.message || '조회하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin-legacy-username', {
        method: 'POST',
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        body: JSON.stringify({ username: clean }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '코드를 발급하지 못했습니다.');
      setIssued({ code: json.code, expiresAt: json.expiresAt });
    } catch (e: any) {
      setError(e?.message || '코드를 발급하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-black text-slate-900">예전 계정 유저네임 이전 (카카오 전환)</h3>
      <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
        예전 아이디·비밀번호로 가입한 인플루언서가 카카오로 다시 가입하면, 링크 만들기 화면에서 쓰던 유저네임을 그대로 이어받습니다.
        카카오 휴대폰 번호가 예전 번호와 같으면 바로 옮겨지고, 다르면 본인 확인 후 여기서 발급한 이전 코드(14일 유효)를 전달해 주세요.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={username}
          onChange={(e) => { setUsername(e.target.value); setStatus(null); setIssued(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
          placeholder="예전 유저네임"
          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold focus:outline-none focus:border-blue-400"
        />
        <button
          type="button"
          onClick={check}
          disabled={busy || !clean}
          className="px-4 py-2 rounded-xl text-xs font-black border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          조회
        </button>
      </div>

      {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}

      {status && (
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs font-bold text-slate-600 space-y-1">
          {!status.exists ? (
            <p>
              {status.movedAt
                ? `이미 카카오 계정으로 옮겨졌습니다 (${formatDate(status.movedAt)} · ${status.movedBy === 'phone' ? '휴대폰 번호 일치' : '이전 코드'}).`
                : '이 유저네임을 쓰는 계정이 없습니다. 카카오 가입 때 바로 쓸 수 있습니다.'}
            </p>
          ) : status.legacy ? (
            <>
              <p>예전 아이디·비밀번호 계정입니다{status.name ? ` · ${status.name}` : ''}{status.phone ? ` · ${status.phone}` : ''}</p>
              <p className="text-slate-400">이 번호와 카카오 번호가 같으면 코드 없이 바로 옮겨집니다.</p>
              <button
                type="button"
                onClick={issue}
                disabled={busy}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-black bg-slate-900 text-white disabled:opacity-50"
              >
                이전 코드 발급
              </button>
            </>
          ) : (
            <p>
              {status.kakao ? '이미 카카오로 가입한 계정입니다.' : '브랜드 · 운영자 계정이라 옮길 수 없습니다.'}
            </p>
          )}
          {Array.isArray(status.codes) && status.codes.length > 0 && (
            <p className="text-slate-400">
              최근 발급: {status.codes.map((c: any) => `${formatDate(c.createdAt)}${c.usedAt ? ' (사용됨)' : ''}`).join(' · ')}
            </p>
          )}
        </div>
      )}

      {issued && (
        <div className="mt-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[11px] font-black text-emerald-700">이전 코드 — 지금 한 번만 보입니다</p>
          <p className="text-2xl font-black tracking-[0.25em] text-emerald-800 mt-1 select-all">{issued.code}</p>
          <p className="text-[11px] font-bold text-emerald-700 mt-1">
            {formatDate(issued.expiresAt)}까지 유효 · 카카오로 가입한 뒤 링크 만들기 화면에서 유저네임 @{clean} 과 함께 입력하면 됩니다.
          </p>
        </div>
      )}
    </section>
  );
};

export default AdminLegacyUsernameTransfer;
