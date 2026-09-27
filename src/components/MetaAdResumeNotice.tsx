import React from 'react';
import { MetaAdRecord, STEP_LABELS } from '../utils/metaAdsApi';

/**
 * 이어서 만들기 창 맨 위 — 이 광고가 어느 단계에서, 왜 멈췄는지.
 *
 * 멈춘 이유(메타 문장)를 설정 바로 위에 둔다. 브랜드는 이 문장을 보고 아래에서 고칠
 * 값을 찾는다 — 이유가 광고 현황 카드에만 있으면 창을 연 순간 무엇을 고쳐야 하는지 잊는다.
 */
const MetaAdResumeNotice: React.FC<{ record: MetaAdRecord }> = ({ record }) => {
  const stopped = STEP_LABELS.find((s) => s.step === record.step);
  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
      <p className="text-[12px] font-black text-rose-700">
        {stopped ? `'${stopped.label}' 단계에서 멈춘 광고입니다` : '다 만들지 못한 광고입니다'}
      </p>
      {record.error && (
        <p className="text-[11px] text-rose-600 font-medium mt-1 leading-relaxed break-words">{record.error}</p>
      )}
      <p className="text-[10px] text-rose-500 font-bold mt-1.5 leading-relaxed">
        저장된 설정을 채워 두었습니다. 확인하거나 고친 뒤 아래 버튼을 누르면 이 설정으로 다시 만듭니다.
      </p>
    </div>
  );
};

export default MetaAdResumeNotice;
