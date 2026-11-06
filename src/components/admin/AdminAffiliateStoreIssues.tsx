import React, { useCallback, useEffect, useState } from 'react';
import { affiliateStoreService, won, FEE_KEY_LABEL, type AdminIssues, type FeeRates } from '../../services/affiliateStoreService';
import { AFFILIATE_STORE_TESTERS } from '../../utils/featureFlags';

/**
 * 어필리에이트 스토어 미처리 취소 · 반품.
 *
 * 브랜드가 3영업일(주말 제외) 넘게 처리하지 않은 반품 요청을 모은다. (구매자 문의는 브랜드 자사몰로
 * 연결되므로 미답변 문의 경고는 숨겼다.)
 * 운영자는 직접 전액 환불(포트원 취소 → 재고 복구 → 수수료 취소)하거나 브랜드에 재알림을 보낸다.
 * 승인 뒤 분쟁은 운영자만 처리한다(승인된 반품 거절 · 전액 환불). 구매확정된 주문도 주문번호로 환불할 수 있다.
 * 운영자 처리는 누가 · 언제 · 무엇을 했는지 기록되어 아래 "처리 기록"에 남는다.
 * 결제 가드(affiliate_store_checkout_open)도 여기서 켜고 끈다 — 꺼져 있으면 테스트 계정만 결제한다.
 */

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const ACTION_LABEL: Record<string, string> = {
  cancelled: '환불', remind_return: '반품 재알림', remind_inquiry: '문의 재알림', checkout_open: '결제 가드 변경',
  return_rejected: '반품 거절',
};

/**
 * 수수료율 설정. 바꾼 값은 다음에 생기는 주문부터 적용된다(주문에 그 시점 값을 고정 저장한다).
 * PG 수수료는 결제 금액(배송비 포함), 플랫폼 수수료는 상품 금액 기준이다. 변경 이력이 남는다.
 */
const FeeRateSettings: React.FC<{ token: string; rates: FeeRates; history: AdminIssues['feeHistory']; onSaved: () => void }> = ({ token, rates, history, onSaved }) => {
  const [form, setForm] = useState({ pgCard: String(rates.pgCard), pgKakaopay: String(rates.pgKakaopay) });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!window.confirm('수수료율을 바꿀까요? 이미 생긴 주문에는 적용되지 않고, 다음 주문부터 적용됩니다.')) return;
    setSaving(true);
    const res = await affiliateStoreService.adminAction(token, 'set_fee_rates', {
      pgCard: Number(form.pgCard), pgKakaopay: Number(form.pgKakaopay),
    });
    setSaving(false);
    if (res.error) window.alert(res.error);
    else onSaved();
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
      <div>
        <p className="text-sm font-black text-slate-900">수수료율 설정</p>
        <p className="text-[11px] text-slate-500 mt-0.5">브랜드 정산액 = 결제 금액(상품 + 배송비) − 인플루언서 수수료 − 플랫폼 수수료(상품 금액 기준) − PG 수수료(결제 금액 기준, 배송비 포함). 반품 환불(상품 금액만 환불)된 주문은 남은 배송비에서 PG 수수료만 빼고 브랜드에 정산됩니다. 주문 생성 시점 값이 주문에 고정됩니다.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-[11px] font-bold text-slate-500">
          플랫폼(픽스폴리오) 수수료
          <div className="mt-1 h-10 px-3 rounded-lg bg-slate-50 border border-slate-100 text-sm font-black text-slate-500 flex items-center justify-end">{rates.platform}% 고정</div>
        </div>
        {([['pgCard', 'PG 수수료 · 카드'], ['pgKakaopay', 'PG 수수료 · 카카오페이']] as const).map(([k, label]) => (
          <label key={k} className="text-[11px] font-bold text-slate-500">
            {label}
            <div className="relative mt-1">
              <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value.replace(/[^0-9.]/g, '') }))} inputMode="decimal" className="w-full h-10 px-3 pr-7 rounded-lg border border-slate-200 text-sm font-black text-slate-900 text-right" />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
            </div>
          </label>
        ))}
      </div>
      <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-50">저장</button>
      {history.length > 0 && (
        <div className="text-[11px] text-slate-500 space-y-0.5 pt-2 border-t border-slate-100">
          <p className="font-black text-slate-700">변경 이력</p>
          {history.map((h, i) => (
            <p key={i}>{dt(h.changedAt)} · {h.changedBy} · {FEE_KEY_LABEL[h.key] || h.key} {h.oldValue}% → {h.newValue}%</p>
          ))}
        </div>
      )}
    </div>
  );
};

const AdminAffiliateStoreIssues: React.FC<{ token: string }> = ({ token }) => {
  const [data, setData] = useState<AdminIssues | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const res = await affiliateStoreService.adminIssues(token);
    if (res.error) setError(res.error);
    else { setError(''); setData(res); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const [refundId, setRefundId] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const run = async (key: string, action: 'admin_refund' | 'admin_remind' | 'admin_return_reject' | 'set_checkout_open', payload: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key);
    const res = await affiliateStoreService.adminAction(token, action, payload);
    setBusy('');
    if (res.error) window.alert(res.error);
    else load();
  };

  if (error) return <p className="text-xs font-bold text-red-500 py-10 text-center">{error}</p>;
  if (!data) return <p className="text-xs font-bold text-slate-400 py-10 text-center">불러오는 중...</p>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-black text-slate-900">결제 가드</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {data.checkoutOpen ? '열림 — 누구나 결제할 수 있어요.' : `닫힘 — 테스트 계정(${AFFILIATE_STORE_TESTERS.join(', ')})만 결제할 수 있어요.`}
          </p>
        </div>
        <button
          disabled={busy === 'guard'}
          onClick={() => run('guard', 'set_checkout_open', { open: !data.checkoutOpen }, data.checkoutOpen ? '결제를 닫을까요? 테스트 계정만 결제할 수 있게 됩니다.' : '모든 구매자에게 결제를 열까요?')}
          className={`px-4 py-2 rounded-xl text-xs font-black ${data.checkoutOpen ? 'bg-slate-100 text-slate-600' : 'bg-blue-600 text-white'}`}
        >
          {data.checkoutOpen ? '결제 닫기' : '결제 열기'}
        </button>
      </div>

      {data.feeRates && <FeeRateSettings key={JSON.stringify(data.feeRates)} token={token} rates={data.feeRates} history={data.feeHistory || []} onSaved={load} />}

      <section className="space-y-3">
        <h3 className="text-sm font-black text-slate-900">3영업일 넘게 처리되지 않은 반품 {data.returns.length}</h3>
        {data.returns.length === 0 ? <p className="text-xs text-slate-400 bg-white rounded-2xl border border-slate-100 p-6 text-center">없습니다.</p> : data.returns.map(r => (
          <div key={r.orderId} className="bg-white rounded-2xl border border-orange-100 p-4 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 text-xs">
              <p className="text-sm font-black text-slate-900">{r.brandName} · {r.productName}</p>
              <p className="text-slate-500 mt-0.5">{r.status === 'requested' ? '승인 대기' : '승인 후 환불 대기'} · {r.businessDays}영업일 경과 · 요청 {dt(r.requestedAt)}</p>
              <p className="text-slate-600 mt-0.5">구매자 {r.buyerName} · {won(r.totalAmount)} · 사유 {r.reason}{r.memo ? ` · ${r.memo}` : ''}</p>
              <p className="text-[10px] text-slate-300 mt-0.5">{r.orderId}</p>
            </div>
            <div className="flex gap-1.5">
              <button disabled={!!busy} onClick={() => run(`rm-${r.orderId}`, 'admin_remind', { kind: 'return', id: r.orderId })} className="px-3 py-1.5 rounded-lg bg-slate-100 text-[11px] font-black text-slate-600">브랜드 재알림</button>
              <button
                disabled={!!busy}
                onClick={() => {
                  const reason = window.prompt('반품 거절 사유(구매자에게 보입니다)', '');
                  if (reason && reason.trim()) run(`rj-${r.orderId}`, 'admin_return_reject', { orderId: r.orderId, reason: reason.trim() });
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black text-slate-600"
              >
                반품 거절
              </button>
              <button disabled={!!busy} onClick={() => run(`rf-${r.orderId}`, 'admin_refund', { orderId: r.orderId, reason: '운영자 환불(반품 미처리)' }, `${won(r.totalAmount)}을 전액 환불할까요? 되돌릴 수 없습니다.`)} className="px-3 py-1.5 rounded-lg bg-red-500 text-[11px] font-black text-white">전액 환불</button>
            </div>
          </div>
        ))}
      </section>

      {/* 주문번호로 환불: 구매확정된 주문도 환불할 수 있다(이때 인플루언서 수수료는 취소된다). */}
      <section className="bg-white rounded-2xl border border-slate-100 p-5 space-y-2">
        <p className="text-sm font-black text-slate-900">주문번호로 전액 환불</p>
        <p className="text-[11px] text-slate-500">분쟁 처리용. 결제 완료 ~ 구매확정 주문을 전액 환불합니다(포트원 취소 → 재고 복구 → 수수료 취소).</p>
        <div className="flex gap-2 flex-wrap">
          <input value={refundId} onChange={e => setRefundId(e.target.value.trim())} placeholder="주문번호 (aff-...)" className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-slate-200 text-xs font-mono" />
          <input value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder="환불 사유" className="flex-1 min-w-[160px] h-10 px-3 rounded-lg border border-slate-200 text-xs" maxLength={200} />
          <button
            disabled={!!busy || !refundId}
            onClick={async () => {
              await run(`manual-${refundId}`, 'admin_refund', { orderId: refundId, reason: refundReason.trim() || '운영자 환불' }, `${refundId} 주문을 전액 환불할까요? 되돌릴 수 없습니다.`);
              setRefundId(''); setRefundReason('');
            }}
            className="h-10 px-4 rounded-lg bg-red-500 text-white text-xs font-black disabled:opacity-40"
          >
            전액 환불
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-black text-slate-900">운영자 처리 기록</h3>
        {data.operatorActions.length === 0 ? <p className="text-xs text-slate-400">아직 없습니다.</p> : (
          <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50 text-xs">
            {data.operatorActions.map((a, i) => (
              <div key={i} className="p-3 flex gap-3 flex-wrap">
                <span className="text-slate-400 w-32 shrink-0">{dt(a.created_at)}</span>
                <span className="font-bold text-slate-800">{a.actor}</span>
                <span className="text-slate-700">{ACTION_LABEL[a.action] || a.action}</span>
                <span className="text-slate-500 truncate">{a.note}</span>
                <span className="text-slate-300 truncate">{a.order_id}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default AdminAffiliateStoreIssues;
