import React, { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../services/apiService';

/**
 * 캠페인 진행 프로세스 — 다섯 단계 하나의 화면.
 *
 *   1. 콘텐츠 가이드   브랜드가 가이드 파일을 올리고, 인플루언서가 확인한다
 *   2. 제품 배송       인플루언서가 주소를 적고, 브랜드가 보낸다
 *   3. 기획안 피드백   인플루언서 기획안 입력칸 "바로 밑"에 브랜드 피드백칸
 *   4. 영상 피드백     초안 영상 "바로 밑"에 브랜드 피드백칸
 *   5. 업로드          게시물 링크 · 업로드 확인 · 광고 파트너십 코드
 *
 * 브랜드와 인플루언서가 같은 컴포넌트를 쓴다. 예전에는 양쪽 화면이 따로 있어서 같은
 * 단계를 서로 다른 이름과 다른 순서로 보고 있었다 — 브랜드는 "대본 피드백", 인플루언서는
 * "구성안 제출"이 같은 칸이라는 걸 알 방법이 없었다. 한 파일에서 그리면 그 어긋남이
 * 생길 자리가 없다.
 *
 * 펼침은 한 번에 하나. 다섯 단계를 전부 펼쳐 두면 지금 할 일이 어느 것인지가 다시
 * 사라진다. 기본값은 "지금 단계"다.
 */

type BoardRole = 'influencer' | 'brand' | 'manager';

type Props = {
  collabId: string;
  role: BoardRole;
  detail: any;
  onRefresh: () => Promise<any> | void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
};

type StepKey = 'guide' | 'shipping' | 'plan' | 'video' | 'upload';

const STEPS: { key: StepKey; title: string; lead: string }[] = [
  { key: 'guide', title: '콘텐츠 가이드', lead: '브랜드가 올린 가이드를 확인합니다.' },
  { key: 'shipping', title: '제품 배송', lead: '받을 주소를 남기면 브랜드가 발송합니다.' },
  { key: 'plan', title: '기획안 피드백', lead: '기획안을 쓰면 바로 아래에 피드백이 붙습니다.' },
  { key: 'video', title: '영상 피드백', lead: '초안 영상에 브랜드가 피드백을 남깁니다.' },
  { key: 'upload', title: '업로드', lead: '게시물 링크와 광고 파트너십 코드를 남깁니다.' },
];

/** 예전 아홉 단계 협업의 단계 이름까지 같은 칸으로 끌어온다(서버와 같은 표). */
const STAGE_KEYS: Record<StepKey, string[]> = {
  guide: ['guide'],
  shipping: ['shipping'],
  plan: ['plan', 'script', 'script_review'],
  video: ['video', 'content', 'content_review'],
  upload: ['upload', 'confirm', 'settlement'],
};

const inputCls =
  'w-full text-xs font-medium border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:border-slate-400 transition-colors';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-[10px] font-black text-slate-400 mb-1">{label}</span>
    {children}
  </label>
);

const fmtDate = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

const CampaignProcessBoard: React.FC<Props> = ({ collabId, role, detail, onRefresh, onNotify }) => {
  const stages = useMemo(() => (Array.isArray(detail?.stages) ? detail.stages : []), [detail]);
  const deliverables = useMemo(() => (Array.isArray(detail?.deliverables) ? detail.deliverables : []), [detail]);
  const feedbacks = useMemo(() => (Array.isArray(detail?.feedbacks) ? detail.feedbacks : []), [detail]);
  const guideline = detail?.guideline || {};
  const guideFiles: any[] = Array.isArray(guideline.files) ? guideline.files : [];
  const shipping = detail?.shipping || {};
  const collab = detail?.collab || {};
  const isInfluencer = role === 'influencer';
  const isBrandSide = role === 'brand' || role === 'manager';

  const stageOf = (step: StepKey) =>
    stages.find((s: any) => STAGE_KEYS[step].includes(String(s.stageKey))) || null;

  /** 그 단계의 마지막 제출물. 버전을 쌓으므로 항상 최신 하나만 본다. */
  const workOf = (step: StepKey) => {
    const rows = deliverables.filter(
      (d: any) => STAGE_KEYS[step].includes(String(d.stageKey)) || String(d.kind) === step,
    );
    return rows.length ? rows[rows.length - 1] : null;
  };

  const feedbacksOf = (step: StepKey) =>
    feedbacks.filter(
      (f: any) => String(f.anchor) === step || STAGE_KEYS[step].includes(String(f.stageKey)),
    );

  const doneOf = (step: StepKey): boolean => {
    const stage = stageOf(step);
    const stageDone = stage ? ['done', 'skipped'].includes(String(stage.status)) : false;
    if (step === 'guide') return stageDone;
    if (step === 'shipping') return stageDone || String(shipping.status) === 'shipped';
    if (step === 'upload') return stageDone || Boolean(collab.uploadConfirmedAt);
    return stageDone;
  };

  const states = useMemo(() => {
    const done = STEPS.map(s => doneOf(s.key));
    const currentIndex = done.findIndex(d => !d);
    return STEPS.map((s, i) => ({
      ...s,
      done: done[i],
      current: i === currentIndex,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const currentKey = states.find(s => s.current)?.key || 'upload';
  const [open, setOpen] = useState<StepKey | ''>(currentKey);
  useEffect(() => {
    setOpen(currentKey);
  }, [currentKey]);

  const [busy, setBusy] = useState(false);

  const act = async (action: string, payload: Record<string, any>, okMessage: string) => {
    setBusy(true);
    const res = await apiService.collabAction(collabId, action, payload);
    setBusy(false);
    if (res.error) {
      onNotify(res.error, 'error');
      return false;
    }
    onNotify(okMessage);
    await onRefresh();
    return true;
  };

  // ── 1. 콘텐츠 가이드 ─────────────────────────────────────────────────
  const [guideFile, setGuideFile] = useState<File | null>(null);

  const uploadGuide = async () => {
    if (!guideFile) return;
    setBusy(true);
    const fileUrl = await apiService.uploadProposalAttachment(`collab-${collabId}`, guideFile);
    setBusy(false);
    if (!fileUrl) {
      onNotify('파일 업로드에 실패했습니다.', 'error');
      return;
    }
    const ok = await act(
      'add_asset',
      { kind: 'guide', title: guideFile.name, fileUrl, fileName: guideFile.name, mimeType: guideFile.type },
      '가이드 파일을 올렸습니다.',
    );
    if (ok) setGuideFile(null);
  };

  // ── 2. 제품 배송 ────────────────────────────────────────────────────
  const [ship, setShip] = useState({
    recipient: '', phone: '', postcode: '', address1: '', address2: '', memo: '',
  });
  const [tracking, setTracking] = useState({ courier: '', trackingNumber: '' });

  useEffect(() => {
    setShip({
      recipient: shipping.recipient || '',
      phone: shipping.phone || '',
      postcode: shipping.postcode || '',
      address1: shipping.address1 || '',
      address2: shipping.address2 || '',
      memo: shipping.memo || '',
    });
    setTracking({ courier: shipping.courier || '', trackingNumber: shipping.trackingNumber || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipping.recipient, shipping.phone, shipping.address1, shipping.courier, shipping.trackingNumber]);

  // ── 3·4·5. 기획안 · 영상 · 업로드 ────────────────────────────────────
  const planWork = workOf('plan');
  const videoWork = workOf('video');
  const [planText, setPlanText] = useState('');
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [videoLink, setVideoLink] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadLink, setUploadLink] = useState('');
  const [adCode, setAdCode] = useState('');
  const [reply, setReply] = useState<Record<string, string>>({ plan: '', video: '', upload: '' });

  useEffect(() => {
    setPlanText(String(planWork?.payload?.body || ''));
    setVideoLink(String(videoWork?.payload?.link || ''));
    setUploadLink(String(collab.uploadUrl || ''));
    setAdCode(String(collab.adCode || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planWork?.id, videoWork?.id, collab.uploadUrl, collab.adCode]);

  const saveWork = async (step: 'plan' | 'video' | 'upload', extra: Record<string, any>, file: File | null) => {
    let fileUrl = '';
    let fileName = '';
    if (file) {
      setBusy(true);
      const url = await apiService.uploadProposalAttachment(`collab-${collabId}`, file);
      setBusy(false);
      if (!url) {
        onNotify('파일 업로드에 실패했습니다.', 'error');
        return;
      }
      fileUrl = url;
      fileName = file.name;
    }
    const ok = await act('save_step_work', { stepKey: step, fileUrl, fileName, ...extra }, '등록했습니다. 브랜드가 확인하면 알려 드릴게요.');
    if (ok) {
      if (step === 'plan') setPlanFile(null);
      if (step === 'video') setVideoFile(null);
    }
  };

  const sendFeedback = async (step: StepKey) => {
    const text = (reply[step] || '').trim();
    if (!text) return;
    const ok = await act('step_feedback', { stepKey: step, body: text }, '피드백을 전달했습니다.');
    if (ok) setReply(prev => ({ ...prev, [step]: '' }));
  };

  // ── 공통 조각 ───────────────────────────────────────────────────────
  // 컴포넌트가 아니라 함수로 둔다. 컴포넌트로 만들면 입력할 때마다 상태가 바뀌면서
  // 새 타입으로 인식돼 통째로 다시 마운트되고, 피드백을 한 글자 칠 때마다 커서가
  // 칸 밖으로 튀어나간다.
  const renderFeedbackThread = (step: StepKey) => {
    const rows = feedbacksOf(step);
    if (rows.length === 0) return null;
    return (
      <div className="space-y-1.5">
        {rows.map((f: any) => (
          <div key={f.id} className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-black text-amber-700">
                {f.authorType === 'brand' ? '브랜드 피드백' : '담당자 피드백'}
              </span>
              <span className="text-[10px] text-slate-400 font-bold">{fmtDate(f.createdAt)}</span>
              {f.status === 'applied' && <span className="text-[10px] font-black text-emerald-600">반영 완료</span>}
            </div>
            <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">{f.body}</p>
            {/* 반영 여부는 인플루언서가 표시한다. 피드백 밑에 두는 이유는, 다른 화면에
                모아 두면 "무엇에 대한 반영인지"가 사라지기 때문이다. */}
            {isInfluencer && ['open', 'relayed'].includes(String(f.status)) && (
              <div className="flex gap-1.5 mt-2">
                <button
                  onClick={() => act('resolve_feedback', { feedbackId: f.id, status: 'applied' }, '반영 완료로 표시했습니다.')}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-black disabled:opacity-40"
                >
                  반영했어요
                </button>
                <button
                  onClick={() => {
                    const note = window.prompt('반영이 어려운 이유를 적어 주세요.')?.trim();
                    if (note) act('resolve_feedback', { feedbackId: f.id, status: 'wont_apply', note }, '전달했습니다.');
                  }}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-600 text-[10px] font-black disabled:opacity-40"
                >
                  어려워요
                </button>
              </div>
            )}
            {f.resolutionNote && String(f.status) === 'wont_apply' && (
              <p className="text-[10px] text-slate-400 font-bold mt-1.5">미반영 사유: {f.resolutionNote}</p>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderFeedbackBox = (step: StepKey, placeholder: string) => (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <p className="text-[10px] font-black text-slate-500 mb-1.5">브랜드 피드백 남기기</p>
      <textarea
        value={reply[step] || ''}
        onChange={e => setReply(prev => ({ ...prev, [step]: e.target.value }))}
        rows={3}
        placeholder={placeholder}
        className={`${inputCls} resize-none`}
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => sendFeedback(step)}
          disabled={busy || !(reply[step] || '').trim()}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          피드백 보내기
        </button>
        <button
          onClick={() => act('confirm_step', { stepKey: step }, '확인 완료로 표시했습니다.')}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-[11px] font-black hover:bg-emerald-500 disabled:opacity-40 transition-colors"
        >
          확인 완료
        </button>
      </div>
    </div>
  );

  const renderFileLink = (url: string, name: string) => (
    <a
      key={url}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-900 transition-colors"
    >
      <span className="text-sm">📄</span>
      <span className="min-w-0 flex-1 text-xs font-bold text-slate-800 truncate">{name}</span>
      <span className="text-[10px] font-black text-slate-500 flex-shrink-0">열기</span>
    </a>
  );

  // ── 단계별 본문 ─────────────────────────────────────────────────────
  const renderStep = (step: StepKey) => {
    switch (step) {
      case 'guide':
        return (
          <div className="space-y-3">
            {guideFiles.length === 0 && !String(guideline.note || '').trim() ? (
              <p className="text-xs text-slate-400 font-medium">
                {isBrandSide ? '가이드 파일을 올리면 인플루언서가 바로 확인합니다.' : '브랜드가 가이드를 올리면 여기에 표시됩니다.'}
              </p>
            ) : (
              <>
                {guideFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {guideFiles.map((f: any) => renderFileLink(f.url, f.name || '가이드 파일'))}
                  </div>
                )}
                {String(guideline.note || '').trim() && (
                  <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed rounded-lg bg-slate-50 p-3">
                    {guideline.note}
                  </p>
                )}
                {String(guideline.url || '').trim() && (
                  <a href={guideline.url} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-black text-blue-600 hover:underline break-all">
                    가이드 문서 열기
                  </a>
                )}
              </>
            )}

            {isBrandSide && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="file"
                  accept="image/*,video/*,application/pdf"
                  onChange={e => setGuideFile(e.target.files?.[0] || null)}
                  className="min-w-0 flex-1 text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-md file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[10px] file:font-black"
                />
                <button
                  onClick={uploadGuide}
                  disabled={busy || !guideFile}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                >
                  가이드 올리기
                </button>
              </div>
            )}

            {isInfluencer && guideFiles.length > 0 && !doneOf('guide') && (
              <button
                onClick={() => act('confirm_step', { stepKey: 'guide' }, '가이드 확인을 표시했습니다.')}
                disabled={busy}
                className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
              >
                가이드 확인했어요
              </button>
            )}
          </div>
        );

      case 'shipping':
        return isInfluencer ? (
          <div className="space-y-3">
            {String(shipping.status) === 'shipped' ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                <p className="text-xs font-black text-emerald-700">제품이 발송됐습니다</p>
                <p className="text-[11px] text-emerald-600 font-bold mt-0.5">
                  {[shipping.courier, shipping.trackingNumber].filter(Boolean).join(' ') || '송장 정보 없음'}
                  {shipping.shippedAt ? ` · ${fmtDate(shipping.shippedAt)}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">
                입력한 주소는 이 캠페인의 브랜드에게만 보입니다.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="받는 분"><input value={ship.recipient} onChange={e => setShip({ ...ship, recipient: e.target.value })} className={inputCls} /></Field>
              <Field label="연락처"><input value={ship.phone} onChange={e => setShip({ ...ship, phone: e.target.value })} placeholder="010-0000-0000" className={inputCls} /></Field>
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <Field label="우편번호"><input value={ship.postcode} onChange={e => setShip({ ...ship, postcode: e.target.value })} className={inputCls} /></Field>
              <Field label="주소"><input value={ship.address1} onChange={e => setShip({ ...ship, address1: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="상세주소"><input value={ship.address2} onChange={e => setShip({ ...ship, address2: e.target.value })} className={inputCls} /></Field>
            <Field label="배송 요청사항 (선택)"><input value={ship.memo} onChange={e => setShip({ ...ship, memo: e.target.value })} placeholder="부재 시 문 앞에 놓아주세요" className={inputCls} /></Field>
            <button
              onClick={() => act('save_shipping', ship, '배송 정보를 저장했습니다.')}
              disabled={busy}
              className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
            >
              배송 정보 저장
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {shipping.filled ? (
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-black text-slate-900">
                  {shipping.recipient} · {shipping.phone}
                </p>
                <p className="text-xs text-slate-600 font-medium mt-1 leading-relaxed">
                  {[shipping.postcode && `(${shipping.postcode})`, shipping.address1, shipping.address2].filter(Boolean).join(' ')}
                </p>
                {shipping.memo && <p className="text-[11px] text-slate-400 font-bold mt-1">요청사항: {shipping.memo}</p>}
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      `${shipping.recipient} ${shipping.phone} ${[shipping.postcode && `(${shipping.postcode})`, shipping.address1, shipping.address2].filter(Boolean).join(' ')}`,
                    )
                  }
                  className="mt-2 text-[10px] font-black text-blue-600"
                >
                  주소 복사
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">인플루언서가 주소를 입력하면 여기에 표시됩니다.</p>
            )}

            {shipping.filled && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <Field label="택배사"><input value={tracking.courier} onChange={e => setTracking({ ...tracking, courier: e.target.value })} placeholder="CJ대한통운" className={inputCls} /></Field>
                <Field label="송장번호"><input value={tracking.trackingNumber} onChange={e => setTracking({ ...tracking, trackingNumber: e.target.value })} className={inputCls} /></Field>
                <button
                  onClick={() => act('mark_shipped', tracking, '발송 완료로 표시했습니다.')}
                  disabled={busy}
                  className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-black disabled:opacity-40 hover:bg-emerald-500 transition-colors"
                >
                  {String(shipping.status) === 'shipped' ? '송장 수정' : '발송 완료'}
                </button>
              </div>
            )}
          </div>
        );

      case 'plan':
        return (
          <div className="space-y-3">
            {isInfluencer ? (
              <>
                <textarea
                  value={planText}
                  onChange={e => setPlanText(e.target.value)}
                  rows={7}
                  placeholder={'기획안을 자유롭게 적어 주세요.\n\n· 어떤 흐름으로 찍을지\n· 강조할 제품 포인트\n· 촬영 장소와 분위기'}
                  className={`${inputCls} resize-none leading-relaxed`}
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={e => setPlanFile(e.target.files?.[0] || null)}
                    className="min-w-0 flex-1 text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-md file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[10px] file:font-black"
                  />
                  <button
                    onClick={() => saveWork('plan', { body: planText }, planFile)}
                    disabled={busy}
                    className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                  >
                    {planWork ? '기획안 다시 올리기' : '기획안 등록'}
                  </button>
                </div>
              </>
            ) : planWork ? (
              <div className="rounded-lg bg-slate-50 p-3 space-y-2">
                {String(planWork.payload?.body || '').trim() && (
                  <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap leading-relaxed">{planWork.payload.body}</p>
                )}
                {planWork.payload?.fileUrl && renderFileLink(planWork.payload.fileUrl, planWork.payload.fileName || '기획안 파일')}
                <p className="text-[10px] text-slate-400 font-bold">{planWork.version}번째 안 · {fmtDate(planWork.createdAt)}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">인플루언서가 기획안을 올리면 여기에 표시됩니다.</p>
            )}

            {/* 기획안 바로 아래에 피드백. 이 순서가 이 단계의 전부다. */}
            {renderFeedbackThread('plan')}
            {isBrandSide && planWork && renderFeedbackBox('plan', '고쳤으면 하는 부분을 적어 주세요.')}
          </div>
        );

      case 'video':
        return (
          <div className="space-y-3">
            {isInfluencer ? (
              <>
                <Field label="초안 영상 링크">
                  <input
                    value={videoLink}
                    onChange={e => setVideoLink(e.target.value)}
                    placeholder="유튜브 · 구글드라이브 등 볼 수 있는 링크"
                    className={inputCls}
                  />
                </Field>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={e => setVideoFile(e.target.files?.[0] || null)}
                    className="min-w-0 flex-1 text-[11px] text-slate-500 file:mr-2 file:border-0 file:rounded-md file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-[10px] file:font-black"
                  />
                  <button
                    onClick={() => saveWork('video', { link: videoLink }, videoFile)}
                    disabled={busy}
                    className="px-4 py-2.5 rounded-lg bg-slate-900 text-white text-[11px] font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                  >
                    {videoWork ? '영상 다시 올리기' : '초안 영상 올리기'}
                  </button>
                </div>
              </>
            ) : videoWork ? (
              <div className="rounded-lg bg-slate-50 p-3 space-y-2">
                {videoWork.payload?.link && (
                  <a href={videoWork.payload.link} target="_blank" rel="noopener noreferrer" className="block text-xs font-black text-blue-600 hover:underline break-all">
                    초안 영상 열기
                  </a>
                )}
                {videoWork.payload?.fileUrl && renderFileLink(videoWork.payload.fileUrl, videoWork.payload.fileName || '초안 영상')}
                <p className="text-[10px] text-slate-400 font-bold">{videoWork.version}번째 안 · {fmtDate(videoWork.createdAt)}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-medium">인플루언서가 초안 영상을 올리면 여기에 표시됩니다.</p>
            )}

            {renderFeedbackThread('video')}
            {isBrandSide && videoWork && renderFeedbackBox('video', '수정이 필요한 장면과 이유를 적어 주세요.')}
          </div>
        );

      case 'upload':
      default:
        return (
          <div className="space-y-3">
            <div className={`rounded-lg px-3 py-2.5 ${collab.uploadConfirmedAt ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50'}`}>
              <p className={`text-xs font-black ${collab.uploadConfirmedAt ? 'text-emerald-700' : 'text-slate-500'}`}>
                {collab.uploadConfirmedAt
                  ? `업로드 확인 완료 · ${fmtDate(collab.uploadConfirmedAt)}`
                  : collab.uploadUrl
                    ? '게시물 등록됨 · 브랜드 확인 대기'
                    : '아직 업로드 전'}
              </p>
              {collab.uploadUrl && (
                <a href={collab.uploadUrl} target="_blank" rel="noopener noreferrer" className="block text-[11px] font-bold text-blue-600 hover:underline break-all mt-1">
                  {collab.uploadUrl}
                </a>
              )}
            </div>

            {isInfluencer ? (
              <>
                <Field label="게시물 링크">
                  <input value={uploadLink} onChange={e => setUploadLink(e.target.value)} placeholder="https://" className={inputCls} />
                </Field>
                <Field label="광고 파트너십 코드">
                  <input value={adCode} onChange={e => setAdCode(e.target.value)} placeholder="브랜디드 콘텐츠 파트너십 코드" className={inputCls} />
                </Field>
                <button
                  onClick={() => saveWork('upload', { link: uploadLink, adCode }, null)}
                  disabled={busy}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-40 hover:bg-slate-700 transition-colors"
                >
                  업로드 정보 등록
                </button>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-black text-slate-400 mb-1">광고 파트너십 코드</p>
                  {collab.adCode ? (
                    <div className="flex items-center justify-between gap-3">
                      <code className="text-xs font-bold text-slate-800 break-all">{collab.adCode}</code>
                      <button onClick={() => navigator.clipboard?.writeText(collab.adCode)} className="text-[10px] font-black text-blue-600 flex-shrink-0">복사</button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 font-medium">인플루언서가 코드를 공유하면 여기에 표시됩니다.</p>
                  )}
                </div>
                {collab.uploadUrl && !collab.uploadConfirmedAt && (
                  <button
                    onClick={() => act('confirm_step', { stepKey: 'upload' }, '업로드를 확인했습니다.')}
                    disabled={busy}
                    className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-black disabled:opacity-40 hover:bg-emerald-500 transition-colors"
                  >
                    업로드 확인 완료
                  </button>
                )}
              </>
            )}

            {renderFeedbackThread('upload')}
          </div>
        );
    }
  };

  /** 단계 한 줄에 붙는 상태 한 마디. 길면 읽지 않는다. */
  const statusText = (step: StepKey, done: boolean, current: boolean) => {
    if (done) return '완료';
    if (step === 'shipping' && shipping.filled) return isInfluencer ? '브랜드 발송 대기' : '발송해 주세요';
    if (step === 'plan' && planWork) return isInfluencer ? '브랜드 확인 대기' : '확인해 주세요';
    if (step === 'video' && videoWork) return isInfluencer ? '브랜드 확인 대기' : '확인해 주세요';
    if (step === 'upload' && collab.uploadUrl) return isInfluencer ? '브랜드 확인 대기' : '확인해 주세요';
    if (step === 'guide' && guideFiles.length === 0) return isBrandSide ? '가이드를 올려 주세요' : '브랜드 준비 중';
    return current ? '진행 중' : '진행 전';
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {states.map((s, i) => {
        const isOpen = open === s.key;
        const stage = stageOf(s.key);
        return (
          <div key={s.key} className={i === 0 ? '' : 'border-t border-slate-100'}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? '' : s.key)}
              aria-expanded={isOpen}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50/60'}`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                  s.done
                    ? 'bg-emerald-500 text-white'
                    : s.current
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {s.done ? '✓' : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-black ${s.done || s.current ? 'text-slate-900' : 'text-slate-400'}`}>
                  {s.title}
                </span>
                <span className="block text-[11px] font-bold text-slate-400 truncate">
                  {isOpen ? s.lead : statusText(s.key, s.done, s.current)}
                </span>
              </span>
              {!isOpen && stage?.dueDate && !s.done && (
                <span className="text-[10px] font-black text-slate-400 flex-shrink-0">{fmtDate(stage.dueDate)}까지</span>
              )}
              <span className={`text-slate-300 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {isOpen && <div className="px-4 pb-4">{renderStep(s.key)}</div>}
          </div>
        );
      })}
    </div>
  );
};

export default CampaignProcessBoard;
