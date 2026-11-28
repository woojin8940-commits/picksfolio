import React, { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../../services/apiService';

/**
 * 관리자 캠페인 메뉴의 "회사 전체" 탭 — 직원이 맡은 캠페인까지 포함한 진행 예정 요약.
 *
 * 관리자는 회사 전체 일정을 한눈에 봐야 하지만, 상세 진행과 인플루언서 연락은 각 캠페인 담당자의
 * 일이다. 그래서 캠페인명 · 담당자 · 업로드 기간과, 진행이 확정된 인플루언서(업로드 예정일 · 업로드
 * 여부)만 보여 준다. 연락처와 금액은 없다. 담당자 변경(퇴사 · 업무 조정)은 여기서 한다.
 */

type Influencer = { username: string; instagramHandle: string; uploadDue: string; uploaded: boolean };
type UpcomingCampaign = {
  id: string;
  title: string;
  status: string;
  ownerMember: string;
  ownerName: string;
  uploadFrom: string;
  uploadTo: string;
  influencers: Influencer[];
};

interface Props {
  businessUsername: string;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
}

const dateText = (v: string) => (v ? v.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2.$3') : '');
const periodText = (from: string, to: string) => {
  if (from && to) return `${dateText(from)} ~ ${dateText(to)}`;
  if (from || to) return dateText(from || to);
  return '미정';
};

const CompanyUpcomingCampaigns: React.FC<Props> = ({ businessUsername, onNotify }) => {
  const [campaigns, setCampaigns] = useState<UpcomingCampaign[]>([]);
  const [members, setMembers] = useState<{ username: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns?business=${encodeURIComponent(businessUsername)}&view=company_upcoming`, {
        headers: await authHeaders({}, { account: businessUsername }),
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '');
      setCampaigns(Array.isArray(json.campaigns) ? json.campaigns : []);
      setMembers(Array.isArray(json.members) ? json.members : []);
      setError('');
    } catch (e) {
      setError((e as Error)?.message || '회사 전체 캠페인을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [businessUsername]);

  useEffect(() => { void load(); }, [load]);

  const assign = async (campaign: UpcomingCampaign, ownerMember: string) => {
    if (ownerMember === campaign.ownerMember) return;
    setBusyId(campaign.id);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }, { account: businessUsername }),
        body: JSON.stringify({ id: campaign.id, action: 'assign_owner', owner_member: ownerMember }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || '담당자를 바꾸지 못했습니다.');
      const name = ownerMember ? members.find((m) => m.username === ownerMember)?.name || ownerMember : '관리자';
      setCampaigns((prev) => prev.map((c) => (c.id === campaign.id ? { ...c, ownerMember, ownerName: name } : c)));
      onNotify?.(`담당자를 ${name}(으)로 바꿨어요.`);
    } catch (e) {
      onNotify?.((e as Error)?.message || '담당자를 바꾸지 못했습니다.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const owners = Array.from(new Map(campaigns.map((c) => [c.ownerMember, c.ownerName])).entries());
  const visible = ownerFilter === 'all' ? campaigns : campaigns.filter((c) => c.ownerMember === ownerFilter);

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-400 font-bold">회사 전체 캠페인을 불러오는 중...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="py-12 text-center text-sm text-red-600">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="mt-3 font-bold">다시 시도</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        <button
          type="button"
          onClick={() => setOwnerFilter('all')}
          className={`px-3.5 py-1.5 rounded-full text-sm font-black whitespace-nowrap border ${ownerFilter === 'all' ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
        >
          {`전체 ${campaigns.length}`}
        </button>
        {owners.map(([key, name]) => (
          <button
            key={key || 'owner'}
            type="button"
            onClick={() => setOwnerFilter(key)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-black whitespace-nowrap border ${ownerFilter === key ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
          >
            {`${name} ${campaigns.filter((c) => c.ownerMember === key).length}`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-100">
          <p className="text-sm font-black text-slate-700">진행 예정인 캠페인이 없어요</p>
          <p className="text-xs text-slate-400 font-medium mt-1">직원이 등록한 캠페인도 진행이 잡히면 여기에 모여요.</p>
        </div>
      ) : (
        visible.map((c) => {
          const pending = c.influencers.filter((i) => !i.uploaded).length;
          return (
            <div key={c.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[15px] font-black text-slate-900 break-words">{c.title || '제목 없는 캠페인'}</p>
                  <p className="text-xs text-slate-500 font-bold mt-0.5">
                    {`업로드 기간 ${periodText(c.uploadFrom, c.uploadTo)} · 진행 예정 ${pending}명`}
                    {c.status === 'pending_approval' ? ' · 승인 대기' : ''}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                  담당자
                  <select
                    value={c.ownerMember}
                    disabled={busyId === c.id}
                    onChange={(e) => void assign(c, e.target.value)}
                    className="h-8 border border-slate-200 rounded-lg px-2 text-xs font-black text-slate-800 bg-white"
                  >
                    <option value="">관리자</option>
                    {members.map((m) => (
                      <option key={m.username} value={m.username}>{m.name}</option>
                    ))}
                    {c.ownerMember && !members.some((m) => m.username === c.ownerMember) && (
                      <option value={c.ownerMember} disabled>{c.ownerName}</option>
                    )}
                  </select>
                </label>
              </div>

              {c.influencers.length === 0 ? (
                <p className="text-xs text-slate-400 font-medium mt-3">아직 진행이 확정된 인플루언서가 없어요.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 border border-slate-100 rounded-xl">
                  {[...c.influencers]
                    .sort((a, b) => Number(a.uploaded) - Number(b.uploaded) || (a.uploadDue || '9999').localeCompare(b.uploadDue || '9999'))
                    .map((i) => (
                      <li key={i.username} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="text-[13px] font-bold text-slate-800 truncate">
                          {i.instagramHandle ? `@${i.instagramHandle.replace(/^@/, '')}` : i.username}
                        </span>
                        <span className={`text-[11px] font-black whitespace-nowrap ${i.uploaded ? 'text-emerald-600' : 'text-slate-600'}`}>
                          {i.uploaded ? '업로드 완료' : i.uploadDue ? `${dateText(i.uploadDue)} 업로드 예정` : '업로드일 미정'}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default CompanyUpcomingCampaigns;
