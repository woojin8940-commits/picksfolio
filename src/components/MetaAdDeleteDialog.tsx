import React, { useState } from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { MetaAdRecord } from '../utils/metaAdsApi';

/**
 * 광고 삭제 확인.
 *
 * 픽스폴리오의 광고 기록은 메타에 만든 캠페인을 가리키는 표지일 뿐이라, 기록만 지우면
 * 광고는 메타에서 계속 돌고 돈도 계속 나간다. 그래서 기본은 메타 캠페인까지 같이 지우고
 * (캠페인을 지우면 그 아래 광고 세트·광고도 메타가 같이 지운다), 메타에는 남겨 두고 싶을
 * 때만 체크를 풀게 한다. 메타에서 지우지 못하면 그 문장을 그대로 보여 주고, 기록만
 * 지우는 길을 따로 연다.
 */
interface MetaAdDeleteDialogProps {
  record: MetaAdRecord;
  busy: boolean;
  onCancel: () => void;
  /** 지우고 실패 문장을 돌려준다(성공이면 빈 문자열). */
  onConfirm: (removeFromMeta: boolean) => Promise<string>;
}

const MetaAdDeleteDialog: React.FC<MetaAdDeleteDialogProps> = ({ record, busy, onCancel, onConfirm }) => {
  const onMeta = !!record.campaignId;
  const [removeFromMeta, setRemoveFromMeta] = useState(true);
  const [error, setError] = useState('');

  const run = async (fromMeta: boolean) => {
    setError('');
    const failed = await onConfirm(fromMeta);
    if (failed) setError(failed);
  };

  const title = record.headline || record.campaignTitle || record.name;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-slate-100 p-5">
        <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center">
          <Trash2 className="w-5 h-5 text-rose-600" />
        </div>
        <p className="text-sm font-black text-slate-900 mt-3">이 광고를 삭제할까요?</p>
        <p className="text-[12px] text-slate-500 font-bold mt-1 break-words">{title}</p>

        {onMeta ? (
          <button
            type="button"
            onClick={() => setRemoveFromMeta((v) => !v)}
            aria-pressed={removeFromMeta}
            className="mt-4 w-full flex items-start gap-2 text-left rounded-xl border border-slate-200 px-3 py-2.5 hover:bg-slate-50 transition-colors"
          >
            <span
              className={`mt-0.5 w-4 h-4 rounded-[5px] border flex items-center justify-center flex-shrink-0 ${
                removeFromMeta ? 'bg-rose-600 border-rose-600' : 'border-slate-300'
              }`}
            >
              {removeFromMeta && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
            </span>
            <span>
              <span className="block text-[12px] font-black text-slate-800">Meta 광고 관리자에서도 삭제</span>
              <span className="block text-[10px] text-slate-400 font-medium mt-0.5 leading-relaxed">
                캠페인 ID {record.campaignId}와 그 아래 광고 세트·광고가 함께 삭제되어 노출·과금이 멈춥니다.
                체크를 풀면 픽스폴리오 목록에서만 사라지고 Meta의 광고는 그대로 집행됩니다.
              </span>
            </span>
          </button>
        ) : (
          <p className="mt-3 text-[11px] text-slate-400 font-medium leading-relaxed">
            Meta에는 아직 만들어진 것이 없어 픽스폴리오 목록에서만 지웁니다.
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
            <p className="text-[11px] font-black text-rose-700">Meta에서 삭제하지 못했습니다</p>
            <p className="text-[11px] text-rose-600 font-medium mt-0.5 leading-relaxed break-words">{error}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(false)}
              className="mt-2 px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 text-[10px] font-black text-rose-600 disabled:opacity-60"
            >
              픽스폴리오 목록에서만 지우기
            </button>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void run(onMeta && removeFromMeta)}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white text-[12px] font-black hover:bg-rose-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            삭제
          </button>
        </div>
      </div>
    </div>
  );
};

export default MetaAdDeleteDialog;
