import React, { useEffect, useState } from 'react';
import { X, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { useMetaAdConnection } from '../hooks/useMetaAdConnection';
import { formatKoreanWon } from '../utils/formatters';
import { AdBoost } from '../utils/adBoosts';
import { AdDeliveryFields, labelCls, selectCls, useAdDelivery } from './AdDeliveryFields';

/**
 * 콘텐츠 부스팅 창 — 이력에서 고른 게시물을 광고로 돌리는 설정.
 *
 * 이 창에서 브랜드가 고르는 것은 네 가지뿐이다: 얼마를, 언제까지, 누구에게, 어디에.
 * 무엇을 광고할지(콘텐츠)와 누구 이름으로 나갈지(인플루언서), 무엇을 목적으로 돌릴지
 * (전환)는 이미 정해져 있다 — 이력에서 그 게시물을 눌러 들어왔고, 브랜디드 콘텐츠
 * 광고는 게시물 소유자가 고정이며, 이력에서 성과가 좋은 소재를 다시 돌리는 이유는
 * 전환이다. 그래서 그 셋은 고를 수 있는 항목이 아니라 창 위쪽의 안내로 둔다.
 * 선택지로 만들면 브랜드는 "무엇을 고르라는 건지" 를 한 번 더 생각해야 한다.
 *
 * 노출 위치는 자동이 기본이다. 메타에서도 자동 노출이 단가가 낮게 나오는 쪽이라,
 * 직접 고르는 것은 이유가 있을 때만 하는 선택이어야 한다. 그래서 자동을 켜 둔 채
 * 체크박스를 숨기고, '직접 선택'을 눌렀을 때만 펼친다.
 *
 * 고르는 항목이 하나 더 있다 — 어느 광고 계정으로 나가는지. 브랜드가 계정을 여러 개
 * 들고 있으면(본사/서브 브랜드) 같은 콘텐츠를 어느 계정으로 돌리는지가 예산이 어디서
 * 빠지는지를 결정한다. 이 목록은 광고 현황에서 연동한 계정(utils/adAccounts)을 그대로
 * 읽고, 기본값은 광고 현황에서 보고 있던 계정이다 — 두 화면이 다른 계정을 가리키면
 * 브랜드는 A 계정으로 요청하고 B 계정에서 결과를 찾는다.
 *
 * 집행은 아직 실제로 나가지 않는다(메타 광고 집행 권한 심사 전). 성공 화면에서
 * 그 사실을 분명히 적고, 광고 현황에는 '요청' 상태로만 올린다.
 */

interface AdBoostModalProps {
  open: boolean;
  onClose: () => void;
  /** 연동한 광고 계정을 읽을 때 쓴다. 연동 상태는 브랜드 계정 단위로 저장된다. */
  businessUsername: string;
  campaignId: string;
  campaignTitle: string;
  collabId: string;
  creatorHandle: string;
  partnershipCode: string;
  thumbnailUrl: string;
  /** 집행 요청이 만들어졌을 때. 광고 현황 목록에 올리는 일은 부모가 한다. */
  onSubmitted: (boost: AdBoost) => void;
  /** 성공 화면에서 광고 현황으로 넘어갈 수 있으면 넘겨준다. */
  onViewAdStatus?: () => void;
}

const AdBoostModal: React.FC<AdBoostModalProps> = ({
  open,
  onClose,
  businessUsername,
  campaignId,
  campaignTitle,
  collabId,
  creatorHandle,
  partnershipCode,
  thumbnailUrl,
  onSubmitted,
  onViewAdStatus,
}) => {
  // 예산 · 기간 · 타겟 · 노출 위치는 '새 광고 만들기' 창과 같은 값·같은 검증을 쓴다.
  const delivery = useAdDelivery();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // 광고 현황에서 연동·선택한 계정을 그대로 읽는다. 이 창에서 따로 연동하지는 않는다 —
  // 연동은 계정 단위의 설정이라 광고 현황의 '연동 설정' 한 군데에 둔다.
  const { accounts, account: currentAccount, connected } = useMetaAdConnection(businessUsername);
  const [adAccountId, setAdAccountId] = useState('');

  /**
   * 기본값은 광고 현황에서 보고 있던 계정, 없으면 연동된 첫 계정.
   *
   * 창을 열 때마다 맞춰 준다 — 창을 닫고 광고 현황에서 계정을 바꾼 뒤 다시 열면
   * 그 계정이 기본값이어야 한다.
   */
  useEffect(() => {
    if (!open) return;
    setAdAccountId((prev) => {
      if (prev && accounts.some((a) => a.id === prev)) return prev;
      return currentAccount?.id || accounts[0]?.id || '';
    });
  }, [open, accounts, currentAccount]);

  useCloseOnBack(open, onClose);

  /** 이 요청이 들어갈 계정. 성공 화면에서 어느 계정으로 갔는지 같이 적는다. */
  const selectedAccount = accounts.find((a) => a.id === adAccountId) || null;

  const submit = async () => {
    const invalid = delivery.validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setSubmitting(true);

    // 연동 전이라 실제 집행은 없다. 버튼을 누른 뒤의 흐름만 확인할 수 있게,
    // 잠깐 기다린 뒤 성공으로 넘긴다.
    await new Promise((r) => setTimeout(r, 700));

    onSubmitted({
      id: `boost_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      requestedAt: new Date().toISOString(),
      source: 'partnership',
      campaignId,
      campaignTitle,
      collabId,
      creatorHandle,
      partnershipCode,
      thumbnailUrl,
      // 연동 전이면 계정이 비어 나간다. 광고 현황이 그 요청을 어느 계정에서든
      // 보여 주므로, 연동을 안 했다는 이유로 집행 요청을 막지는 않는다.
      adAccountId: adAccountId || undefined,
      ...delivery.payload(),
    });

    setSubmitting(false);
    setDone(true);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 max-h-[90vh] modal-maxh-90 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-black text-slate-900">메타 광고로 부스팅</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              이력에서 고른 게시물을 그대로 광고 소재로 씁니다
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="p-6 md:p-8 text-center overflow-y-auto">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-emerald-600" strokeWidth={3} />
            </div>
            <p className="text-sm font-black text-slate-900 mt-3">집행 요청이 접수되었습니다</p>
            <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed">
              {campaignTitle} · @{creatorHandle}
              <br />
              예산 {formatKoreanWon(delivery.budgetKrw)} · {delivery.startDate} ~ {delivery.endDate}
              {selectedAccount && (
                <>
                  <br />
                  {selectedAccount.name} · {selectedAccount.id}
                </>
              )}
            </p>
            <p className="text-[11px] text-amber-600 font-bold mt-3 leading-relaxed">
              메타 광고 집행 권한 심사 전이라 실제 노출은 아직 시작되지 않습니다. 광고 현황에
              '요청' 상태로 올라가고, 심사가 끝나면 이 요청이 그대로 집행됩니다.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {onViewAdStatus && (
                <button
                  type="button"
                  onClick={() => { onClose(); onViewAdStatus(); }}
                  className="w-full py-3 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800 transition-colors"
                >
                  광고 현황에서 보기
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl border border-slate-200 text-slate-500 text-[12px] font-black hover:bg-slate-50 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto px-5 py-4 space-y-5">
              {/* 무엇을, 누구 이름으로 돌리는지. 고르는 항목이 아니라 확인용이다. */}
              <div className="flex items-center gap-3 bg-slate-50 rounded-2xl p-3">
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="w-14 aspect-[9/16] rounded-xl object-cover bg-slate-200 flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 aspect-[9/16] rounded-xl bg-slate-200 flex-shrink-0 flex items-center justify-center">
                    <span className="text-[9px] text-slate-400 font-black">소재</span>
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-[13px] font-black text-slate-900 leading-snug">
                    인플루언서 @{creatorHandle}로 광고 진행
                  </p>
                  <p className="text-[11px] text-slate-500 font-bold mt-1 truncate">{campaignTitle}</p>
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5 break-all">
                    파트너십 코드 {partnershipCode}
                  </p>
                </div>
              </div>

              {/* 목적은 전환으로 고정한다 — 이력에서 소재를 다시 돌리는 이유다. */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
                <p className="text-[12px] font-black text-blue-800">전환 목적으로 진행됩니다</p>
                <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
                  이 게시물의 브랜디드 콘텐츠 파트너십 코드를 광고 소재로 써서, 구매 전환을
                  목적으로 집행합니다. 성과는 광고 현황에서 전환수 · 전환당 비용 · ROAS 로 확인합니다.
                </p>
              </div>

              {/* 어느 계정에서 예산이 빠지는지. 광고 현황에서 연동한 계정을 그대로 읽는다. */}
              <div>
                <label className={labelCls} htmlFor="boost-ad-account">연동 광고 계정</label>
                {connected && accounts.length > 0 ? (
                  <>
                    <div className="relative mt-1.5">
                      <select
                        id="boost-ad-account"
                        value={adAccountId}
                        onChange={(e) => setAdAccountId(e.target.value)}
                        className={selectCls}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} · {a.id}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold mt-1">
                      이 계정으로 집행되고, 광고 현황에서 같은 계정을 골랐을 때 보입니다
                    </p>
                  </>
                ) : (
                  // 연동이 없으면 고를 계정도 없다. 집행 요청 자체는 막지 않고, 계정이
                  // 정해지는 시점만 알려 준다 — 연동은 광고 현황에서 한 번만 하면 된다.
                  <div className="mt-1.5 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                    <p className="text-[11px] font-black text-amber-800">
                      Meta 계정이 연동되지 않았습니다
                    </p>
                    <p className="text-[10px] text-amber-700 font-medium mt-0.5 leading-relaxed">
                      광고 현황 화면에서 Meta 계정을 연동하면 광고 계정을 고를 수 있습니다. 지금 요청한
                      집행은 연동 후 고른 계정으로 들어갑니다.
                    </p>
                  </div>
                )}
              </div>

              <AdDeliveryFields delivery={delivery} idPrefix="boost" />
            </div>

            <div className="border-t border-slate-100 px-5 py-4 bg-white">
              {error && <p className="text-[11px] text-rose-500 font-black mb-2">{error}</p>}
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? '집행 요청 중' : '집행하기'}
              </button>
              <p className="text-[10px] text-slate-400 font-medium mt-2 text-center leading-relaxed">
                메타 광고 집행 권한 심사 전이라 실제 노출은 시작되지 않습니다.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdBoostModal;
