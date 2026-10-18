import React, { useCallback, useEffect, useState } from 'react';
import { Info, RefreshCw, Save } from 'lucide-react';
import { affiliateService, type PlatformSettings } from '../../services/affiliateService';

/**
 * 플랫폼 설정 — 판매 연동형 캠페인의 플랫폼 수수료율과 구매확정 간주 일수.
 *
 * 수수료율은 캠페인 등록 시점 값이 그 캠페인에 고정된다. 그래서 여기서 바꿔도
 * 이미 등록된 캠페인의 인플루언서 몫은 그대로이고, 이후 등록되는 캠페인부터 적용된다.
 */

interface Props {
  token: string;
}

const KEY_LABEL: Record<string, string> = {
  platformRate: '플랫폼 수수료율(%)',
  platform_rate: '플랫폼 수수료율(%)',
  autoConfirmDays: '구매확정 간주 일수',
  auto_confirm_days: '구매확정 간주 일수',
  attributionDays: '귀속 기간(일)',
  attribution_days: '귀속 기간(일)',
};

const fmtDateTime = (s?: string | null) => (s ? new Date(s).toLocaleString('ko-KR') : '-');

const AdminPlatformSettings: React.FC<Props> = ({ token }) => {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rate, setRate] = useState('5');
  const [days, setDays] = useState('14');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await affiliateService.getPlatformSettings(token);
    if (res.error || !res.settings) {
      setError(res.error || '설정을 불러오지 못했습니다.');
    } else {
      setSettings(res.settings);
      setRate(String(res.settings.platformRate ?? 5));
      setDays(String(res.settings.autoConfirmDays ?? 14));
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const rateNum = Number(rate);
  const daysNum = Number(days);
  const rateValid = rate.trim() !== '' && Number.isFinite(rateNum) && rateNum >= 0 && rateNum < 100;
  const daysValid = days.trim() !== '' && Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 90;
  const dirty = !!settings && (rateNum !== settings.platformRate || daysNum !== settings.autoConfirmDays);

  const save = async () => {
    if (!settings || !rateValid || !daysValid || !dirty) return;
    const patch: { platformRate?: number; autoConfirmDays?: number } = {};
    if (rateNum !== settings.platformRate) patch.platformRate = rateNum;
    if (daysNum !== settings.autoConfirmDays) patch.autoConfirmDays = daysNum;
    const lines = [
      patch.platformRate !== undefined ? `플랫폼 수수료율 ${settings.platformRate}% → ${patch.platformRate}%` : '',
      patch.autoConfirmDays !== undefined ? `구매확정 간주 ${settings.autoConfirmDays}일 → ${patch.autoConfirmDays}일` : '',
    ].filter(Boolean);
    if (!confirm(`다음과 같이 변경합니다.\n\n${lines.join('\n')}\n\n이미 등록된 캠페인에는 영향이 없습니다. 계속할까요?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    const res = await affiliateService.updatePlatformSettings(token, patch);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNotice('저장했습니다.');
    await load();
  };

  if (loading && !settings) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
        <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 font-bold text-sm">설정 불러오는 중...</p>
      </div>
    );
  }

  const history = settings?.history || [];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="font-black text-slate-900">판매 연동 캠페인 설정</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
              마지막 변경 {fmtDateTime(settings?.updatedAt)}{settings?.updatedBy ? ` · ${settings.updatedBy}` : ''}
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 text-[11px] font-black"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 새로고침
          </button>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">플랫폼 수수료율(%)</span>
            <input
              type="number"
              min={0}
              max={99}
              step={0.1}
              value={rate}
              onChange={e => setRate(e.target.value)}
              className={`mt-1 w-full px-3 py-2 rounded-xl border text-sm font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${rateValid ? 'border-slate-200' : 'border-red-300 bg-red-50'}`}
            />
            <span className="block text-[10px] font-bold text-slate-400 mt-1">
              인플루언서 몫 = 브랜드 총 수수료율 − 이 값. 기본 5%.
            </span>
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">구매확정 간주 일수</span>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 shrink-0">배송완료 후</span>
              <input
                type="number"
                min={1}
                max={90}
                step={1}
                value={days}
                onChange={e => setDays(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl border text-sm font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${daysValid ? 'border-slate-200' : 'border-red-300 bg-red-50'}`}
              />
              <span className="text-xs font-bold text-slate-500 shrink-0">일</span>
            </div>
            <span className="block text-[10px] font-bold text-slate-400 mt-1">
              구매확정이 오지 않아도 이 기간이 지나면 확정으로 봅니다. 기본 14일.
            </span>
          </label>
          <div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">귀속 기간(어트리뷰션)</span>
            <div className="mt-1 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50 text-sm font-black text-slate-500">
              클릭 후 {settings?.attributionDays ?? 7}일
            </div>
            <span className="block text-[10px] font-bold text-slate-400 mt-1">현재 고정값이라 바꿀 수 없습니다.</span>
          </div>
        </div>

        <div className="mx-4 mb-4 bg-amber-50/70 border border-amber-100 rounded-xl px-3 py-2.5 flex gap-2">
          <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
            플랫폼 수수료율은 캠페인 <span className="font-black text-slate-800">등록 시점</span> 값이 캠페인에 고정됩니다.
            변경해도 <span className="font-black text-slate-800">이미 등록된 캠페인</span>(심사 중 포함)의 수수료 배분은 바뀌지 않고,
            이후 새로 등록되는 캠페인부터 적용됩니다. 구매확정 간주 일수는 아직 확정되지 않은 주문의 판정부터 적용됩니다.
          </p>
        </div>

        <div className="px-4 pb-4 flex items-center justify-end gap-2">
          {error && <span className="text-[11px] font-bold text-red-500 mr-auto">{error}</span>}
          {notice && !error && <span className="text-[11px] font-bold text-green-600 mr-auto">{notice}</span>}
          <button
            onClick={() => { if (settings) { setRate(String(settings.platformRate)); setDays(String(settings.autoConfirmDays)); } }}
            disabled={!dirty || saving}
            className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 text-xs font-black disabled:opacity-40"
          >
            되돌리기
          </button>
          <button
            onClick={save}
            disabled={!dirty || !rateValid || !daysValid || saving}
            className="flex items-center gap-1 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-black disabled:opacity-40"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="font-black text-slate-900">변경 이력</h3>
        </div>
        <div className="hidden md:grid grid-cols-12 gap-2 px-5 py-3 border-b border-slate-100 bg-slate-50/50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
          <div className="col-span-3">일시</div>
          <div className="col-span-3">항목</div>
          <div className="col-span-3">변경</div>
          <div className="col-span-3">변경자</div>
        </div>
        <div className="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
          {history.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm font-bold">변경 이력이 없습니다.</div>
          ) : history.map((h, i) => (
            <div key={`${h.changedAt}-${h.key}-${i}`} className="md:grid md:grid-cols-12 gap-2 px-5 py-3 items-center">
              <div className="md:col-span-3 text-[11px] font-bold text-slate-500">{fmtDateTime(h.changedAt)}</div>
              <div className="md:col-span-3 text-xs font-black text-slate-900">{KEY_LABEL[h.key] || h.key}</div>
              <div className="md:col-span-3 text-xs font-bold text-slate-700">
                <span className="text-slate-400 line-through">{h.oldValue || '-'}</span> → <span className="font-black">{h.newValue}</span>
              </div>
              <div className="md:col-span-3 text-[11px] font-bold text-slate-500 truncate">{h.changedBy || '-'}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminPlatformSettings;
