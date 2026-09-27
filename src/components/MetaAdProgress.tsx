import React from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2 } from 'lucide-react';
import { MetaAdRecord, STEP_LABELS, adsManagerUrl } from '../utils/metaAdsApi';

/**
 * 집행 진행 — 소재 업로드 → 캠페인 → 광고 세트 → 소재 → 광고.
 *
 * 단계마다 메타가 돌려준 ID 를 그대로 적는다. 브랜드는 광고 관리자에서 같은 ID 로 같은
 * 객체를 찾을 수 있고, 중간에 실패하면 어느 단계에서 왜 멈췄는지(메타 문장 그대로)를 본다.
 */
interface MetaAdProgressProps {
  /** 소재 업로드 단계의 상태. 부스팅처럼 올릴 파일이 없으면 넘기지 않는다. */
  upload?: { state: 'idle' | 'running' | 'done' | 'error'; label: string; detail?: string };
  record: MetaAdRecord | null;
  /** 지금 진행 중인지(마지막 완료 단계 다음에 스피너를 그린다). */
  running: boolean;
  error?: string;
  note?: string;
}

const Row: React.FC<{ state: 'idle' | 'running' | 'done' | 'error'; label: string; detail?: string }> = ({
  state,
  label,
  detail,
}) => (
  <li className="flex items-start gap-2.5 py-1.5">
    <span
      className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
        state === 'done'
          ? 'bg-emerald-500'
          : state === 'error'
            ? 'bg-rose-500'
            : state === 'running'
              ? 'bg-blue-50'
              : 'bg-slate-100'
      }`}
    >
      {state === 'done' && <Check className="w-3 h-3 text-white" strokeWidth={4} />}
      {state === 'error' && <AlertTriangle className="w-3 h-3 text-white" />}
      {state === 'running' && <Loader2 className="w-3 h-3 text-blue-600 animate-spin" />}
    </span>
    <div className="min-w-0">
      <p className={`text-[12px] font-black ${state === 'idle' ? 'text-slate-400' : 'text-slate-800'}`}>{label}</p>
      {detail && <p className="text-[10px] text-slate-500 font-bold break-all mt-0.5">{detail}</p>}
    </div>
  </li>
);

const MetaAdProgress: React.FC<MetaAdProgressProps> = ({ upload, record, running, error, note }) => {
  const uploading = upload && upload.state !== 'done';
  const current = record?.step || 'campaign';
  const currentIndex = current === 'done' ? STEP_LABELS.length : STEP_LABELS.findIndex((s) => s.step === current);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
      <p className="text-[11px] font-black text-slate-500">Meta Marketing API 진행 상황</p>
      <ol className="mt-1">
        {upload && <Row {...upload} />}
        {STEP_LABELS.map((s, i) => {
          const id = record ? s.idOf(record) : undefined;
          let state: 'idle' | 'running' | 'done' | 'error' = 'idle';
          if (id || i < currentIndex) state = 'done';
          else if (!uploading && i === currentIndex) state = error ? 'error' : running ? 'running' : 'idle';
          return (
            <Row
              key={s.step}
              state={state}
              label={`${s.label} 만들기`}
              detail={id ? `ID ${id}` : state === 'error' ? error : state === 'running' ? note : undefined}
            />
          );
        })}
      </ol>
      {error && (uploading ? upload?.state === 'error' : false) && (
        <p className="text-[10px] text-rose-600 font-bold mt-1 break-words">{error}</p>
      )}
      {record?.warnings?.length ? (
        <div className="mt-2 space-y-1">
          {record.warnings.map((w) => (
            <p key={w} className="text-[10px] text-amber-700 font-bold leading-relaxed">
              {w}
            </p>
          ))}
        </div>
      ) : null}
      {record?.campaignId && (
        <a
          href={adsManagerUrl(record)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:underline"
        >
          Meta 광고 관리자에서 보기
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
};

export default MetaAdProgress;
