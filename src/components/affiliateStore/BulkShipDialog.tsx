import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { affiliateStoreService, SHIPPING_COURIERS, type BulkResult } from '../../services/affiliateStoreService';
import { downloadFailedRows, downloadOrdersExcel, parseShipExcel, type ParsedShipFile, type ShipRow } from './orderExcel';

/**
 * 송장 엑셀 일괄 등록.
 *   1) 발송 대상(결제 완료 · 배송 준비) 주문을 엑셀로 받는다.
 *   2) 택배사 · 송장번호를 채워 올리면 미리보기를 보여 준다.
 *   3) 확인하면 50건씩 나눠 발송 처리하고, 실패한 줄은 사유와 함께 다시 내려받을 수 있다.
 * 배송 중 주문의 송장을 바꿔 올리면 송장 수정이 되고, 같은 송장이면 건너뛴다(문자가 다시 가지 않음).
 */

const CHUNK = 50;
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

interface Props {
  businessUsername: string;
  onClose: () => void;
  onDone: () => void;
}

const BulkShipDialog: React.FC<Props> = ({ businessUsername, onClose, onDone }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [defaultCourier, setDefaultCourier] = useState(SHIPPING_COURIERS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedShipFile | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'template' | 'parse' | 'submit'>('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ ok: number; skipped: number; failed: (ShipRow & { error: string })[] } | null>(null);

  const downloadTemplate = async () => {
    setBusy('template'); setError('');
    const res = await affiliateStoreService.brandOrdersExport(businessUsername, 'to_ship');
    if (res.error) { setBusy(''); setError(res.error); return; }
    if (!res.orders?.length) { setBusy(''); setError('발송할 주문(결제 완료 · 배송 준비)이 없어요.'); return; }
    await downloadOrdersExcel(res.orders, `송장입력양식_${stamp()}.xlsx`).catch(() => setError('엑셀 파일을 만들지 못했어요.'));
    setBusy('');
  };

  const readFile = async (f: File, courier = defaultCourier) => {
    setFile(f); setBusy('parse'); setError(''); setParsed(null); setResults(null);
    try {
      setParsed(await parseShipExcel(f, courier));
    } catch (e: any) {
      setError(e?.message?.includes('열') ? e.message : '엑셀 파일(.xlsx)을 읽지 못했어요. 파일을 확인해 주세요.');
    }
    setBusy('');
  };

  const submit = async () => {
    if (!parsed?.rows.length) return;
    setBusy('submit'); setError(''); setProgress(0);
    const rows = parsed.rows;
    const byId = new Map(rows.map(r => [r.id, r]));
    let ok = 0, skipped = 0;
    const failed: (ShipRow & { error: string })[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const res = await affiliateStoreService.bulkOrderAction(businessUsername, 'bulk_ship', {
        items: chunk.map(r => ({ id: r.id, trackingCompany: r.trackingCompany, trackingNumber: r.trackingNumber })),
      });
      if (res.error) {
        chunk.forEach(r => failed.push({ ...r, error: res.error || '처리하지 못했어요.' }));
      } else {
        (res.results || []).forEach((x: BulkResult) => {
          if (x.ok && x.skipped) skipped++;
          else if (x.ok) ok++;
          else { const r = byId.get(x.id); if (r) failed.push({ ...r, error: x.error || '처리하지 못했어요.' }); }
        });
      }
      setProgress(Math.min(rows.length, i + CHUNK));
    }
    setResults({ ok, skipped, failed });
    setBusy('');
    if (ok > 0) onDone();
  };

  const close = () => { if (busy !== 'submit') onClose(); };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900">엑셀로 송장 일괄 등록</h3>
            <p className="text-xs text-slate-500 mt-0.5">여러 주문을 한 번에 발송 처리해요.</p>
          </div>
          <button onClick={close} className="p-1 text-slate-400" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        {!results && (
          <>
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <p><b>1.</b> 발송할 주문(결제 완료 · 배송 준비)을 엑셀로 받아요.</p>
              <p><b>2.</b> 파일의 <b>택배사 · 송장번호</b> 칸을 채워요. 송장번호가 빈 줄은 건너뛰어요.</p>
              <p><b>3.</b> 파일을 올리고 확인하면 발송 처리되고, 구매자에게 발송 알림 문자가 가요.</p>
            </div>
            <button onClick={downloadTemplate} disabled={!!busy} className="mt-3 w-full h-11 rounded-xl border border-slate-200 text-sm font-black text-slate-700 flex items-center justify-center gap-2 disabled:opacity-50">
              {busy === 'template' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              발송 대상 주문 엑셀 받기
            </button>

            <label className="block mt-4 text-[11px] font-black text-slate-500">택배사 칸이 비어 있을 때 쓸 택배사</label>
            <select
              value={defaultCourier}
              onChange={e => { setDefaultCourier(e.target.value); if (file) void readFile(file, e.target.value); }}
              className="mt-1 w-full h-11 px-3 rounded-xl border border-slate-200 text-sm"
            >
              {SHIPPING_COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readFile(f); }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy === 'submit'}
              className="mt-3 w-full rounded-xl border-2 border-dashed border-slate-200 p-5 text-center hover:border-blue-300 disabled:opacity-50"
            >
              {busy === 'parse' ? <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto" /> : <FileSpreadsheet className="w-6 h-6 text-slate-400 mx-auto" />}
              <p className="text-sm font-black text-slate-700 mt-1.5">{file ? file.name : '송장을 채운 엑셀 파일 올리기'}</p>
              <p className="text-[11px] text-slate-400">.xlsx · {file ? '다시 누르면 다른 파일을 고를 수 있어요' : '눌러서 파일 선택'}</p>
            </button>

            {parsed && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2 text-xs">
                  <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 font-black">발송 처리 {parsed.rows.length}건</span>
                  {parsed.noTrackingCount > 0 && <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-500 font-bold">송장 없음 {parsed.noTrackingCount}건 건너뜀</span>}
                  {parsed.problems.length > 0 && <span className="px-2 py-1 rounded-lg bg-red-50 text-red-600 font-bold">확인 필요 {parsed.problems.length}건</span>}
                </div>
                {parsed.problems.length > 0 && (
                  <ul className="rounded-xl bg-red-50 p-2.5 text-[11px] text-red-600 space-y-0.5 max-h-24 overflow-y-auto">
                    {parsed.problems.map(p => <li key={p}>{p}</li>)}
                  </ul>
                )}
                {parsed.rows.length > 0 && (
                  <div className="rounded-xl border border-slate-100 max-h-48 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-400 sticky top-0">
                        <tr><th className="text-left px-2 py-1.5">행</th><th className="text-left px-2">주문번호</th><th className="text-left px-2">택배사</th><th className="text-left px-2">송장번호</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {parsed.rows.map(r => (
                          <tr key={r.id}><td className="px-2 py-1 text-slate-400">{r.row}</td><td className="px-2 truncate max-w-[140px]">{r.id}</td><td className="px-2">{r.trackingCompany}</td><td className="px-2 font-bold">{r.trackingNumber}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-xs font-bold text-red-500 mt-2">{error}</p>}
            {busy === 'submit' && parsed && (
              <div className="mt-3">
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${(progress / parsed.rows.length) * 100}%` }} /></div>
                <p className="text-[11px] text-slate-400 mt-1">{progress} / {parsed.rows.length}건 처리 중… 창을 닫지 마세요.</p>
              </div>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={close} disabled={busy === 'submit'} className="flex-1 h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-600 disabled:opacity-50">닫기</button>
              <button
                onClick={submit}
                disabled={!!busy || !parsed?.rows.length}
                className="flex-1 h-11 rounded-xl bg-blue-600 text-white text-sm font-black disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy === 'submit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {parsed?.rows.length ? `${parsed.rows.length}건 발송 처리` : '발송 처리'}
              </button>
            </div>
          </>
        )}

        {results && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-emerald-50 p-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div className="text-sm">
                <p className="font-black text-slate-900">{results.ok}건 발송 처리했어요</p>
                <p className="text-xs text-slate-500">
                  {results.skipped > 0 ? `같은 송장으로 이미 발송된 ${results.skipped}건은 건너뛰었어요. ` : ''}
                  {results.failed.length > 0 ? `${results.failed.length}건은 처리하지 못했어요.` : ''}
                </p>
              </div>
            </div>
            {results.failed.length > 0 && (
              <>
                <ul className="rounded-xl bg-red-50 p-2.5 text-[11px] text-red-600 space-y-0.5 max-h-40 overflow-y-auto">
                  {results.failed.map(f => <li key={f.id}>{f.row}행 · {f.id}: {f.error}</li>)}
                </ul>
                <button onClick={() => { void downloadFailedRows(results.failed, `송장등록_실패_${stamp()}.xlsx`); }} className="w-full h-10 rounded-xl border border-slate-200 text-xs font-black text-slate-600 flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> 실패한 줄 엑셀로 받기
                </button>
              </>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setResults(null); setParsed(null); setFile(null); }} className="flex-1 h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-600">다른 파일 올리기</button>
              <button onClick={onClose} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-black">완료</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkShipDialog;
