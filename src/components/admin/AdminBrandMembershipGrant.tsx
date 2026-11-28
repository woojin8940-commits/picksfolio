import React, { useState } from 'react';
import { collabHeaders } from '../../services/apiService';

/**
 * 브랜드 멤버십 부여 — 결제 없이 라이트 · 그로스를 켜고 끄거나, 엔터프라이즈 협의 한도(별도 한도)를 넣는다.
 * 테스트 계정 · 엔터프라이즈 계약 · 보상용. 결제로 구독 중인 계정은 등급을 바꾸지 않는다(별도 한도만).
 */

type View = {
  company: string;
  exists: boolean;
  tier: 'brand_campaign' | 'brand_growth' | null;
  paid: boolean;
  grantedByOperator: boolean;
  nextBillingDate: string | null;
  override: { campaigns: number; selected: number };
  quota: {
    remaining: { campaigns: number; selected: number };
    limits: { campaigns: number; selected: number };
    addons: { campaigns: number; selected: number };
    used: { campaigns: number; selected: number };
  } | null;
};

const TIER_NAME: Record<string, string> = { brand_campaign: '라이트', brand_growth: '그로스' };

const AdminBrandMembershipGrant: React.FC<{ token: string }> = ({ token }) => {
  const [company, setCompany] = useState('');
  const [data, setData] = useState<View | null>(null);
  const [months, setMonths] = useState(1);
  const [override, setOverride] = useState({ campaigns: '', selected: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const call = async (init?: RequestInit) => {
    const name = company.trim().toLowerCase().replace(/^biz\//, '');
    if (!name) { setMessage({ text: '브랜드 아이디를 입력해 주세요.', error: true }); return null; }
    setBusy(true);
    try {
      const res = await fetch(init ? '/api/admin/brand-membership' : `/api/admin/brand-membership?company=${encodeURIComponent(name)}`, {
        credentials: 'same-origin',
        headers: await collabHeaders(token),
        ...init,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage({ text: json?.error || '처리하지 못했습니다.', error: true }); return null; }
      setData(json);
      setOverride({ campaigns: json.override?.campaigns ? String(json.override.campaigns) : '', selected: json.override?.selected ? String(json.override.selected) : '' });
      return json;
    } finally {
      setBusy(false);
    }
  };

  const grant = async (tier: 'brand_campaign' | 'brand_growth' | null) => {
    const name = company.trim().toLowerCase().replace(/^biz\//, '');
    const ok = tier
      ? window.confirm(`${name} 계정에 ${TIER_NAME[tier]} 멤버십을 결제 없이 ${months}개월 부여할까요?`)
      : window.confirm(`${name} 계정의 운영자 부여 멤버십을 끌까요?`);
    if (!ok) return;
    const res = await call({ method: 'POST', body: JSON.stringify({ company: name, tier, months }) });
    if (res) setMessage({ text: res.notice || (tier ? `${TIER_NAME[tier]} 멤버십을 부여했어요.` : '운영자 부여 멤버십을 껐어요.'), error: !!res.notice });
  };

  const saveOverride = async () => {
    const name = company.trim().toLowerCase().replace(/^biz\//, '');
    const res = await call({
      method: 'POST',
      body: JSON.stringify({ company: name, override: { campaigns: Number(override.campaigns) || 0, selected: Number(override.selected) || 0 } }),
    });
    if (res) setMessage({ text: '별도 한도를 저장했어요.' });
  };

  const input = 'h-9 border border-slate-200 rounded-lg px-2.5 text-xs font-bold text-slate-800';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="브랜드 아이디 (예: inplace)" className={`${input} w-56`} />
        <button type="button" disabled={busy} onClick={async () => { setMessage(null); await call(); }}
          className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-40">조회</button>
      </div>
      {message && <p className={`text-[11px] font-bold rounded-lg px-3 py-2 ${message.error ? 'text-red-600 bg-red-50' : 'text-emerald-700 bg-emerald-50'}`}>{message.text}</p>}
      {data && (
        <div className="space-y-4">
          <div className="text-xs text-slate-600 font-medium space-y-1">
            <p className="font-black text-slate-900">
              {`${data.company} · ${data.tier ? TIER_NAME[data.tier] : '멤버십 없음'}`}
              {data.paid ? ' · 결제 구독 중' : data.grantedByOperator ? ' · 운영자 부여' : ''}
            </p>
            {data.nextBillingDate && <p>{`다음 결제일(부여 만료일): ${data.nextBillingDate.slice(0, 10)}`}</p>}
            {data.quota && (
              <p>{`이번 달 남은 한도: 캠페인 ${data.quota.remaining.campaigns}건 · 선정 ${data.quota.remaining.selected}명 (사용 ${data.quota.used.campaigns}건 · ${data.quota.used.selected}명)`}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
              기간
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className={input}>
                {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{`${m}개월`}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy || data.paid} onClick={() => grant('brand_campaign')}
              className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-black text-slate-700 disabled:opacity-40">라이트 부여</button>
            <button type="button" disabled={busy || data.paid} onClick={() => grant('brand_growth')}
              className="h-9 px-3 rounded-lg bg-blue-600 text-white text-xs font-black disabled:opacity-40">그로스 부여</button>
            {data.grantedByOperator && data.tier && (
              <button type="button" disabled={busy} onClick={() => grant(null)}
                className="h-9 px-3 rounded-lg border border-red-200 text-xs font-black text-red-600 disabled:opacity-40">부여 끄기</button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black text-slate-500">별도 한도(엔터프라이즈 협의분, 등급 한도에 더함)</span>
            <input value={override.campaigns} onChange={(e) => setOverride((p) => ({ ...p, campaigns: e.target.value.replace(/\D/g, '') }))} placeholder="캠페인" className={`${input} w-20`} />
            <input value={override.selected} onChange={(e) => setOverride((p) => ({ ...p, selected: e.target.value.replace(/\D/g, '') }))} placeholder="선정 인원" className={`${input} w-24`} />
            <button type="button" disabled={busy} onClick={saveOverride} className="h-9 px-3 rounded-lg border border-slate-200 text-xs font-black text-slate-700 disabled:opacity-40">저장</button>
          </div>
          <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
            결제 수단이 없는 계정은 정기결제가 청구되지 않아요. 결제로 구독 중인 계정은 등급을 바꿀 수 없고 별도 한도만 넣을 수 있어요.
          </p>
        </div>
      )}
    </div>
  );
};

export default AdminBrandMembershipGrant;
