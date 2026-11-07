import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  affiliatePayoutService,
  saveBlob,
  scheduleText,
  type AdminPayoutData,
  type PayoutParty,
  type PayoutRequest,
  type PayoutStatus,
} from '../../services/affiliatePayoutService';
import { PayoutRequestCard } from '../affiliateStore/AffiliatePayouts';

/**
 * 운영자 어필리에이트 정산.
 *
 *   - 지급 신청 목록(브랜드 / 인플루언서 탭 · 상태 · 지급 예정일 필터)
 *   - "지급 완료"(은행에서 이체한 뒤 누른다) · "반려"(사유 필수 → 금액이 지급 가능 금액으로 돌아감)
 *   - 이체용 CSV(지급 예정일 기준 · 계좌번호 전체) · 원천징수 신고용 CSV(지급 완료월 · 주민등록번호)
 *   - 주민등록번호 "보기" · 통장 사본 보기
 *   CSV 다운로드 · 주민번호 보기 · 통장 사본 보기는 모두 개인정보 열람 기록에 남는다.
 *   - 최소 신청 금액 설정
 */

const won = (n: number) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const thisMonth = () => {
  const k = new Date(Date.now() + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
};

const AdminAffiliatePayouts: React.FC<{ token: string }> = ({ token }) => {
  const [party, setParty] = useState<PayoutParty>('influencer');
  const [status, setStatus] = useState<PayoutStatus | ''>('requested');
  const [scheduledDate, setScheduledDate] = useState('');
  const [data, setData] = useState<AdminPayoutData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rrn, setRrn] = useState<Record<string, string>>({});
  const [csvDate, setCsvDate] = useState('');
  const [csvMonth, setCsvMonth] = useState(thisMonth());
  const [mins, setMins] = useState({ minInfluencer: '', minBrand: '' });

  const load = useCallback(async () => {
    const res = await affiliatePayoutService.adminList(token, { partyType: party, status, scheduledDate });
    if (res.error) { setError(res.error); return; }
    setError('');
    setData(res);
    setCsvDate(d => d || res.scheduledDates[0] || res.nextScheduledDate);
    setMins(m => (m.minInfluencer === '' ? { minInfluencer: String(res.settings.minInfluencer), minBrand: String(res.settings.minBrand) } : m));
  }, [token, party, status, scheduledDate]);
  useEffect(() => { load(); }, [load]);

  const markPaid = async (r: PayoutRequest) => {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const input = window.prompt(
      `${r.displayName || r.party} 님에게 ${won(r.netAmount)}을(를) ${r.bankName} ${r.accountMasked}(예금주 ${r.accountHolder})로 이체했나요?\n이체한 날짜를 확인하고 확인을 누르면 지급 완료로 바뀌고 신청자에게 알림이 가요.`,
      today,
    );
    if (input === null) return;
    setBusy(r.id);
    const res = await affiliatePayoutService.adminAction(token, 'admin_mark_paid', { id: r.id, paidDate: input.trim() });
    setBusy('');
    if (res.error) window.alert(res.error);
    load();
  };

  const reject = async (r: PayoutRequest) => {
    const reason = window.prompt('반려 사유를 적어 주세요(신청자에게 보여요). 예: 계좌 정보 오류', '');
    if (reason === null) return;
    if (!reason.trim()) { window.alert('반려 사유를 입력해 주세요.'); return; }
    setBusy(r.id);
    const res = await affiliatePayoutService.adminAction(token, 'admin_reject', { id: r.id, reason: reason.trim() });
    setBusy('');
    if (res.error) window.alert(res.error);
    load();
  };

  const viewRrn = async (r: PayoutRequest) => {
    if (rrn[r.party]) { setRrn(m => { const n = { ...m }; delete n[r.party]; return n; }); return; }
    if (!window.confirm('주민등록번호를 볼까요? 열람 기록이 남아요.')) return;
    setBusy(`rrn:${r.id}`);
    const res = await affiliatePayoutService.adminViewRrn(token, r.party);
    setBusy('');
    if (res.error) { window.alert(res.error); return; }
    setRrn(m => ({ ...m, [r.party]: res.rrn }));
  };

  const viewBankbook = async (r: PayoutRequest) => {
    setBusy(`bb:${r.id}`);
    const res = await affiliatePayoutService.adminBankbook(token, r.party);
    setBusy('');
    if (res.error || !res.blob) { window.alert(res.error || '통장 사본을 열지 못했어요.'); return; }
    const url = URL.createObjectURL(res.blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const download = async (kind: 'transfer' | 'withholding') => {
    const label = kind === 'transfer' ? `지급 예정일 ${csvDate} 이체용 파일(계좌번호 전체)` : `${csvMonth} 지급분 원천징수 신고 파일(주민등록번호 포함)`;
    if (!window.confirm(`${label}을 내려받을까요? 열람 기록이 남아요.`)) return;
    setBusy(kind);
    const res = kind === 'transfer'
      ? await affiliatePayoutService.adminTransferCsv(token, csvDate)
      : await affiliatePayoutService.adminWithholdingCsv(token, csvMonth);
    setBusy('');
    if (res.error || !res.blob) { window.alert(res.error || '파일을 받지 못했어요.'); return; }
    saveBlob(res.blob, res.filename || `${kind}.csv`);
  };

  const saveMins = async () => {
    setBusy('mins');
    const res = await affiliatePayoutService.adminAction(token, 'admin_set_settings', { minInfluencer: mins.minInfluencer, minBrand: mins.minBrand });
    setBusy('');
    if (res.error) window.alert(res.error);
    else if (res.settings) { setMins({ minInfluencer: String(res.settings.minInfluencer), minBrand: String(res.settings.minBrand) }); window.alert('저장했어요.'); }
  };

  if (error && !data) return <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>;
  if (!data) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;

  const dates = Array.from(new Set([data.nextScheduledDate, ...data.scheduledDates])).sort().reverse();
  const total = data.requests.reduce((a, r) => ({ gross: a.gross + r.grossAmount, net: a.net + r.netAmount }), { gross: 0, net: 0 });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2">
          <p className="text-sm font-black text-slate-900">이체용 파일 (CSV)</p>
          <p className="text-[11px] text-slate-500">지급 대기 중인 신청 · 은행, 계좌번호 전체, 예금주, 금액(인플루언서는 실지급액)</p>
          <div className="flex gap-2">
            <select value={csvDate} onChange={e => setCsvDate(e.target.value)} className="flex-1 h-9 px-2 rounded-lg border border-slate-200 text-xs font-bold">
              {dates.map(d => <option key={d} value={d}>{scheduleText(d)}</option>)}
            </select>
            <button disabled={busy === 'transfer' || !csvDate} onClick={() => download('transfer')} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-black flex items-center gap-1 disabled:opacity-50">
              <Download className="w-3.5 h-3.5" /> 받기
            </button>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2">
          <p className="text-sm font-black text-slate-900">원천징수 신고용 파일 (CSV)</p>
          <p className="text-[11px] text-slate-500">지급 완료월 기준 인플루언서 · 실명, 주민등록번호, 지급 총액, 소득세, 지방소득세, 지급일</p>
          <div className="flex gap-2">
            <input type="month" value={csvMonth} onChange={e => setCsvMonth(e.target.value)} className="flex-1 h-9 px-2 rounded-lg border border-slate-200 text-xs font-bold" />
            <button disabled={busy === 'withholding' || !csvMonth} onClick={() => download('withholding')} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-xs font-black flex items-center gap-1 disabled:opacity-50">
              <Download className="w-3.5 h-3.5" /> 받기
            </button>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2">
          <p className="text-sm font-black text-slate-900">최소 신청 금액</p>
          <div className="grid grid-cols-2 gap-2">
            {([['minInfluencer', '인플루언서(원천징수 전)'], ['minBrand', '브랜드']] as const).map(([k, label]) => (
              <label key={k} className="text-[11px] font-bold text-slate-500">
                {label}
                <input value={mins[k]} onChange={e => setMins(m => ({ ...m, [k]: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" className="mt-1 w-full h-9 px-2 rounded-lg border border-slate-200 text-xs font-black text-right" />
              </label>
            ))}
          </div>
          <button disabled={busy === 'mins'} onClick={saveMins} className="h-8 px-3 rounded-lg bg-slate-100 text-slate-700 text-xs font-black disabled:opacity-50">저장</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['influencer', 'brand'] as const).map(p => (
            <button key={p} onClick={() => setParty(p)} className={`h-9 px-4 rounded-lg text-xs font-black ${party === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {p === 'brand' ? '브랜드' : '인플루언서'}
              {(data.waiting[p] || 0) > 0 && <span className="ml-1 bg-red-500 text-white text-[9px] px-1.5 rounded-full">{data.waiting[p]}</span>}
            </button>
          ))}
        </div>
        <select value={status} onChange={e => setStatus(e.target.value as PayoutStatus | '')} className="h-9 px-2 rounded-lg border border-slate-200 text-xs font-bold">
          <option value="">전체 상태</option>
          <option value="requested">지급 대기</option>
          <option value="paid">지급 완료</option>
          <option value="rejected">반려</option>
          <option value="cancelled">신청 취소</option>
        </select>
        <select value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-200 text-xs font-bold">
          <option value="">전체 지급 예정일</option>
          {dates.map(d => <option key={d} value={d}>{scheduleText(d)}</option>)}
        </select>
        <span className="text-[11px] text-slate-500 font-bold">
          {data.requests.length}건 · {party === 'influencer' ? `총액 ${won(total.gross)} · 실지급 ${won(total.net)}` : won(total.net)}
        </span>
      </div>

      {data.requests.length === 0 ? (
        <p className="text-xs text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">해당하는 지급 신청이 없어요.</p>
      ) : (
        <div className="space-y-2.5">
          {data.requests.map(r => (
            <div key={r.id}>
              <PayoutRequestCard r={r} showParty loadDetails={(id, kind, cursorId) => affiliatePayoutService.adminRequestDetails(token, id, kind, cursorId)} actions={
                <>
                  {r.partyType === 'influencer' && (
                    <button disabled={busy === `rrn:${r.id}`} onClick={() => viewRrn(r)} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-black text-slate-600 disabled:opacity-50">
                      {rrn[r.party] ? '주민번호 숨기기' : '주민번호 보기'}
                    </button>
                  )}
                  {r.partyType === 'brand' && (
                    <button disabled={busy === `bb:${r.id}`} onClick={() => viewBankbook(r)} className="h-8 px-3 rounded-lg border border-slate-200 text-[11px] font-black text-slate-600 disabled:opacity-50">통장 사본</button>
                  )}
                  {r.status === 'requested' && (
                    <>
                      <button disabled={busy === r.id} onClick={() => reject(r)} className="h-8 px-3 rounded-lg border border-red-200 text-[11px] font-black text-red-500 disabled:opacity-50">반려</button>
                      <button disabled={busy === r.id} onClick={() => markPaid(r)} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-[11px] font-black disabled:opacity-50">지급 완료</button>
                    </>
                  )}
                </>
              } />
              {rrn[r.party] && (
                <p className="mt-1 ml-2 text-[11px] font-bold text-slate-700">주민등록번호: <span className="font-mono">{rrn[r.party]}</span> <span className="text-slate-400">(열람 기록됨)</span></p>
              )}
              {r.status === 'paid' && <p className="mt-1 ml-2 text-[10px] text-slate-400">처리자 {r.paidBy} · {r.paidDate}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminAffiliatePayouts;
