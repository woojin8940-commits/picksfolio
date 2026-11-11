import React, { useState } from 'react';
import { CalendarClock, Loader2, PartyPopper, X } from 'lucide-react';
import { affiliateStoreService, UPLOAD_DAYS, type StoreRequest } from '../../services/affiliateStoreService';
import { openPostcodeSearch } from '../../utils/daumPostcode';
import { formatPhoneInput } from '../../utils/formatters';
import { useCloseOnBack } from '../../hooks/useCloseOnBack';

/**
 * 인플루언서: 브랜드에 선정된 협업의 협찬 상품 배송정보 입력.
 *
 * 입력하면 협업이 진행되고(브랜드에게 배송지가 간다), 브랜드가 송장번호를 입력하면 전용 판매 링크가 열린다.
 * 배송정보를 입력하지 않고 반려하면 협업이 진행되지 않는다. 반려는 배송정보 입력 전에만 할 수 있다.
 * 브랜드가 발송하기 전까지는 배송정보를 고칠 수 있다.
 */

interface Props {
  request: StoreRequest;
  onClose: () => void;
  onDone: (r: StoreRequest) => void;
}

const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-600';

const SelectionShippingSheet: React.FC<Props> = ({ request, onClose, onDone }) => {
  const prev = request.shipping;
  const [form, setForm] = useState({
    recipientName: prev?.recipientName || '',
    recipientPhone: prev?.recipientPhone || '',
    postcode: prev?.postcode || '',
    address1: prev?.address1 || '',
    address2: prev?.address2 || '',
    memo: prev?.memo || '',
  });
  const [postcodeFailed, setPostcodeFailed] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'decline'>('');
  const [error, setError] = useState('');
  const canDecline = request.shippingStatus === 'awaiting_info';

  useCloseOnBack(true, onClose);

  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const searchAddress = async () => {
    const ok = await openPostcodeSearch(({ postcode, address }) => {
      setForm(f => ({ ...f, postcode, address1: address }));
      setPostcodeFailed(false);
      setTimeout(() => document.getElementById('selection-address-detail')?.focus(), 100);
    });
    if (!ok) setPostcodeFailed(true);
  };

  const valid = form.recipientName.trim() && form.recipientPhone.replace(/\D/g, '').length >= 9
    && form.address1.trim() && form.address2.trim();

  const save = async () => {
    if (!valid) { setError('받는 분 · 연락처 · 주소 · 상세 주소를 모두 입력해 주세요.'); return; }
    setBusy('save');
    setError('');
    const res = await affiliateStoreService.submitShipping(request.id, {
      recipientName: form.recipientName.trim(),
      recipientPhone: form.recipientPhone.trim(),
      postcode: form.postcode.trim(),
      address1: form.address1.trim(),
      address2: form.address2.trim(),
      memo: form.memo.trim(),
    });
    setBusy('');
    if (res.error || !res.request) { setError(res.error || '배송정보를 저장하지 못했어요.'); return; }
    onDone(res.request);
  };

  const decline = async () => {
    const reason = window.prompt('협업을 반려할까요? 반려하면 이 협업은 진행되지 않고 다시 되돌릴 수 없어요.\n브랜드에게 전할 사유를 적어 주세요(선택).', '');
    if (reason === null) return;
    setBusy('decline');
    setError('');
    const res = await affiliateStoreService.declineSelection(request.id, reason.trim());
    setBusy('');
    if (res.error || !res.request) { setError(res.error || '반려하지 못했어요.'); return; }
    onDone(res.request);
  };

  return (
    <div className="fixed inset-0 z-[190] flex items-end md:items-center justify-center p-0 md:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="modal-card relative w-full md:max-w-lg bg-white rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[90vh] modal-maxh-85 overflow-hidden sheet-rise flex flex-col">
        <div className="shrink-0 px-5 pt-3 pb-4 border-b border-slate-100">
          <div className="md:hidden w-10 h-1.5 bg-slate-200 rounded-full mx-auto mb-3" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-1.5">
                <PartyPopper className="w-4 h-4 text-blue-600" /> {canDecline ? '브랜드에 선정되었어요!' : '배송정보 수정'}
              </h3>
              <p className="text-xs text-slate-400 font-medium mt-1 truncate">{request.brandName} · {request.productName}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="닫기" className="shrink-0 w-10 h-10 -mt-1 -mr-2 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="modal-body flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <p className="text-xs text-slate-600 leading-relaxed bg-blue-50 rounded-xl px-3.5 py-3">
            협찬 상품을 받을 배송정보를 입력하면 협업이 진행돼요. 브랜드가 상품을 보내고 송장번호를 입력하면 MY 어필리에이트에서 전용 판매 링크가 열려요.
            {canDecline && <><br /><span className="text-slate-500">진행하지 않으려면 아래 <b>협업 반려</b>를 눌러 주세요.</span></>}
          </p>
          <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <CalendarClock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-amber-800">
              <p className="font-black">상품 수령 후 {UPLOAD_DAYS}일 이내에 콘텐츠를 업로드하고 판매를 시작해야 해요.</p>
              <p className="mt-0.5 text-amber-700">업로드한 뒤에는 MY 어필리에이트에서 콘텐츠 링크와 파트너십 코드를 올려 주세요. 브랜드가 확인할 수 있어요.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="받는 분 이름" value={form.recipientName} onChange={e => set('recipientName', e.target.value)} maxLength={50} />
            <input className={inputCls} placeholder="휴대폰 번호" inputMode="tel" value={form.recipientPhone} onChange={e => set('recipientPhone', formatPhoneInput(e.target.value))} />
          </div>
          <div className="flex gap-2">
            <input
              className={`${inputCls} ${postcodeFailed ? '' : 'cursor-pointer bg-slate-50'}`}
              placeholder="우편번호"
              inputMode="numeric"
              value={form.postcode}
              readOnly={!postcodeFailed}
              onClick={postcodeFailed ? undefined : searchAddress}
              onChange={postcodeFailed ? e => set('postcode', e.target.value.replace(/\D/g, '').slice(0, 5)) : undefined}
            />
            <button type="button" onClick={searchAddress} className="shrink-0 h-11 px-4 rounded-xl bg-slate-900 text-white text-sm font-black">주소 검색</button>
          </div>
          <input
            className={`${inputCls} ${postcodeFailed ? '' : 'cursor-pointer bg-slate-50'}`}
            placeholder={postcodeFailed ? '주소' : '주소 검색을 눌러 주소를 선택해 주세요'}
            value={form.address1}
            readOnly={!postcodeFailed}
            onClick={postcodeFailed ? undefined : searchAddress}
            onChange={postcodeFailed ? e => set('address1', e.target.value) : undefined}
            maxLength={200}
          />
          <input id="selection-address-detail" className={inputCls} placeholder="상세 주소 (동·호수)" value={form.address2} onChange={e => set('address2', e.target.value)} maxLength={200} />
          {postcodeFailed && <p className="text-[11px] font-bold text-amber-600">주소 검색을 열지 못했어요. 우편번호와 주소를 직접 입력해 주세요.</p>}
          <input className={inputCls} placeholder="배송 메모 (선택)" value={form.memo} onChange={e => set('memo', e.target.value)} maxLength={200} />
          <p className="text-[11px] text-slate-400">배송정보는 이 협업의 브랜드와 픽스폴리오 담당자에게만 보여요.</p>
          {error && <p className="text-xs font-bold text-red-500">{error}</p>}
        </div>

        <div className="shrink-0 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-slate-100 flex gap-2">
          {canDecline ? (
            <button onClick={decline} disabled={!!busy} className="px-5 py-3.5 rounded-xl border border-slate-200 font-black text-sm text-slate-500 shrink-0 disabled:opacity-50 flex items-center gap-1.5">
              {busy === 'decline' && <Loader2 className="w-4 h-4 animate-spin" />} 협업 반려
            </button>
          ) : (
            <button onClick={onClose} className="px-6 py-3.5 bg-slate-100 rounded-xl font-black text-sm text-slate-600 shrink-0">취소</button>
          )}
          <button
            onClick={save}
            disabled={!!busy}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3.5 rounded-xl font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />}
            {canDecline ? '배송정보 입력하고 협업 진행' : '배송정보 저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SelectionShippingSheet;
