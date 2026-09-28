import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { formatKoreanWon } from '../utils/formatters';
import {
  AD_OBJECTIVES,
  AdCta,
  AdObjective,
  DEFAULT_AD_OBJECTIVE,
  ctaLabel,
  ctasForObjective,
  findObjective,
} from '../utils/adBoosts';
import { MetaAdAccount } from '../utils/adAccounts';
import { formatFileSize, makeCreativeThumbnail } from '../utils/creativeThumbnail';
import {
  MetaAdRecord,
  createMetaAd,
  notifyMetaAdsChanged,
  resumeMetaAd,
  runRemainingSteps,
  uploadAdImage,
  uploadAdVideo,
} from '../utils/metaAdsApi';
import { useMetaPages } from '../hooks/useMetaPages';
import { AdDeliveryFields, inputCls, labelCls, selectCls, useAdDelivery } from './AdDeliveryFields';
import MetaAdProgress from './MetaAdProgress';
import MetaPagePicker from './MetaPagePicker';
import StartPausedToggle from './StartPausedToggle';
import ResumeNotice from './MetaAdResumeNotice';

/**
 * 직접 소재 업로드 창 — 브랜드가 만든 소재로 광고를 만드는 설정.
 *
 * 부스팅은 이력에 게시물이 있어야 시작된다. 그런데 브랜드가 광고로 돌리고 싶은 소재가
 * 캠페인에서만 나오는 것은 아니다 — 자체 촬영물, 이전에 쓰던 영상, 인플루언서 콘텐츠가
 * 아직 없는 신제품. 그 경우 지금까지는 광고 현황에서 할 수 있는 일이 없었고, 브랜드는
 * 메타 광고 관리자로 넘어가야 했다. 이 창은 그 길을 광고 현황 안으로 가져온다.
 *
 * 부스팅과 다른 점은 위쪽뿐이다. 무엇을 광고할지(소재), 무엇을 목적으로 돌릴지, 어떤
 * 문구로 보일지, 눌렀을 때 어디로 갈지를 여기서 다 정해야 한다 — 게시물이 대신 정해
 * 주는 값이 없기 때문이다. 아래쪽(예산 · 기간 · 타겟 · 노출 위치)은 부스팅과 같은
 * 값이라 같은 컴포넌트(AdDeliveryFields)를 그대로 쓴다.
 *
 * 목적을 맨 위에 둔다. 목적이 CTA 문구 순서와 창 위쪽 안내를 바꾸고, 집행 후 광고
 * 현황에서 어떤 지표를 봐야 하는지도 목적이 정한다. 기본값은 전환 — 부스팅과 같은
 * 이유로, 소재에 돈을 붙이는 이유가 대개 판매다.
 *
 * '집행하기' 를 누르면 실제로 메타에 광고가 만들어진다(ads_management):
 *   1) 파일을 광고 계정에 올린다 — 이미지는 adimages, 영상은 advideos 분할 업로드.
 *   2) 캠페인 → 광고 세트 → 소재 → 광고를 한 단계씩 만든다(api-meta-ads-ads).
 * 단계마다 메타가 돌려준 ID 를 창에 바로 적는다. 광고 페이지는 연동한 메타 계정이 관리하는
 * 실제 페이지 목록(GET /me/accounts)에서 고른다.
 */

interface AdCreateModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * 이 광고가 들어갈 광고 계정. 광고 현황에서 보고 있는 계정을 그대로 받는다 —
   * 계정을 고르는 드롭다운은 바로 위 화면에 이미 있어서 여기서 또 묻지 않는다.
   */
  account?: MetaAdAccount | null;
  /** 광고를 만들 비즈니스 계정(서버가 이 계정에 저장된 메타 토큰을 쓴다). */
  username: string;
  /** 메타에 광고 기록이 만들어졌을 때(중간 실패 포함). 부모가 목록을 다시 읽는다. */
  onSubmitted?: (record: MetaAdRecord) => void;
  /**
   * 중간 단계에서 멈춘 광고. 넘기면 그 광고의 설정을 채운 채로 창이 열리고, 브랜드가
   * 확인·수정한 뒤 누르면 고친 설정으로 다시 만든다(광고 현황의 '이어서 만들기').
   * 멈춘 이유는 대개 설정(예산·기간·타겟·링크)이라, 같은 값으로 다시 시도만 하면 같은
   * 자리에서 또 멈춘다.
   */
  resume?: MetaAdRecord | null;
}

type UploadState = { state: 'idle' | 'running' | 'done' | 'error'; label: string; detail?: string };

/** 소재로 받는 파일. 메타가 광고 소재로 받는 형식만 둔다. */
const ACCEPT = 'image/*,video/*';

const AdCreateModal: React.FC<AdCreateModalProps> = ({ open, onClose, account, username, onSubmitted, resume: resumeProp }) => {
  const [objective, setObjective] = useState<AdObjective>(resumeProp?.objective || DEFAULT_AD_OBJECTIVE);
  const [file, setFile] = useState<File | null>(null);
  /** 창이 열려 있는 동안의 미리보기(blob URL). 저장하는 값과는 다르다. */
  const [previewUrl, setPreviewUrl] = useState('');
  /** 목록에 남기는 작은 미리보기(data URL). 파일을 고른 뒤 만들어 둔다. */
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [headline, setHeadline] = useState(resumeProp?.headline || '');
  const [bodyText, setBodyText] = useState(resumeProp?.bodyText || '');
  const [cta, setCta] = useState<AdCta>(
    resumeProp?.cta || ctasForObjective(resumeProp?.objective || DEFAULT_AD_OBJECTIVE)[0].value,
  );
  /** 브랜드가 CTA 를 직접 골랐는지. 고른 뒤에는 목적을 바꿔도 그 문구를 지킨다. */
  const [ctaPicked, setCtaPicked] = useState(!!resumeProp?.cta);
  const [linkUrl, setLinkUrl] = useState(resumeProp?.linkUrl || '');
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  /** PAUSED 로 만들면 광고가 만들어져도 노출·과금이 시작되지 않는다(검증용). */
  const [startPaused, setStartPaused] = useState(resumeProp?.initialStatus === 'PAUSED');
  /** 집행 진행 화면. 한 번 누르면 폼 대신 단계 목록을 보여 준다. */
  const [phase, setPhase] = useState<'form' | 'running' | 'finished'>('form');
  const [upload, setUpload] = useState<UploadState>({ state: 'idle', label: 'Meta 광고 계정에 소재 올리기' });
  const [record, setRecord] = useState<MetaAdRecord | null>(null);
  /**
   * 이어서 만드는 광고. 광고 현황에서 넘긴 멈춘 광고이거나, 이 창에서 만들다 멈춘 뒤
   * '설정 고치기' 를 누른 기록이다. 어느 쪽이든 고친 설정으로 다시 만든다(같은 값으로
   * 다시 시도만 하면 같은 자리에서 또 멈춘다).
   */
  const [fixing, setFixing] = useState(false);
  const resume = resumeProp || (fixing && record && record.step !== 'done' ? record : null);
  const [runError, setRunError] = useState('');
  const [runNote, setRunNote] = useState('');
  /** 이미 올린 소재. 다시 시도할 때 같은 파일을 또 올리지 않는다. */
  const uploadedRef = useRef<{ file: File; imageHash: string; videoId?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const delivery = useAdDelivery();
  const pagesState = useMetaPages(username, open && !!account);
  /**
   * 이어서 만들 때는 그 광고가 쓰던 페이지를 기본으로 둔다. 여기서 고른 값은 이 창에만
   * 둔다 — 광고 현황·이력이 같이 보는 '고른 페이지' 를 멈춘 광고 하나 때문에 바꾸지 않는다.
   */
  const [resumePageId, setResumePageId] = useState(resumeProp?.pageId || '');
  const page = (resume && pagesState.pages.find((p) => p.id === resumePageId)) || pagesState.page;
  const selectPage = resume ? setResumePageId : pagesState.selectPage;

  // 멈춘 광고의 예산·기간·타겟·노출 위치를 한 번 채운다.
  useEffect(() => {
    if (resume) delivery.fill(resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.id]);

  useCloseOnBack(open, onClose);

  // blob URL 은 창을 닫을 때 놓아 준다 — 파일을 여러 번 바꿔 고르면 그만큼 쌓인다.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const objectiveNotice = findObjective(objective)?.notice;
  const ctaOptions = ctasForObjective(objective);
  const isVideo = !!file?.type.startsWith('video/');

  /**
   * 목적을 바꾸면 추천 문구가 바뀐다. 아직 직접 고르지 않았다면 맨 위 문구로 따라가고,
   * 골라 둔 뒤에는 그대로 둔다 — 브랜드가 정한 문구를 목적 때문에 되돌리지 않는다.
   */
  const pickObjective = (next: AdObjective) => {
    setObjective(next);
    if (!ctaPicked) setCta(ctasForObjective(next)[0].value);
  };

  const takeFile = (next: File | null) => {
    if (!next) return;
    if (!next.type.startsWith('image/') && !next.type.startsWith('video/')) {
      setError('영상 또는 이미지 파일만 올릴 수 있습니다.');
      return;
    }
    setError('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(next);
    setFile(next);
    setPreviewUrl(url);
    setThumbnailUrl('');
    // 목록에 남길 작은 미리보기는 여기서 미리 만들어 둔다. 실패해도 그냥 둔다 —
    // 썸네일이 없다고 집행을 막지는 않는다.
    makeCreativeThumbnail(next, url).then(setThumbnailUrl).catch(() => {});
  };

  const clearFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl('');
    setThumbnailUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** 주소를 적기만 하면 되도록, http(s) 가 없으면 https 로 붙여 준다. */
  const normalizedLink = (): string => {
    const raw = linkUrl.trim();
    if (!raw) return '';
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(withScheme);
      return parsed.hostname.includes('.') ? parsed.toString() : '';
    } catch {
      return '';
    }
  };

  /** 파일을 광고 계정에 올린다. 영상은 대표 이미지도 한 장 올린다(메타가 요구한다). */
  const uploadCreative = async (target: MetaAdAccount, source: File) => {
    if (uploadedRef.current?.file === source) return uploadedRef.current;
    setUpload({ state: 'running', label: 'Meta 광고 계정에 소재 올리기' });
    if (source.type.startsWith('video/')) {
      const video = await uploadAdVideo(username, target.id, source, (ratio) =>
        setUpload({ state: 'running', label: 'Meta 광고 계정에 영상 올리기', detail: `${Math.round(ratio * 100)}%` }),
      );
      if (!video.ok) throw new Error(video.error);
      const frame = await makeCreativeThumbnail(source, previewUrl, 1080);
      if (!frame) throw new Error('영상에서 대표 이미지를 뜨지 못했습니다. 다른 형식(mp4)으로 올려 주세요.');
      const image = await uploadAdImage(username, target.id, frame);
      if (!image.ok) throw new Error(image.error);
      uploadedRef.current = { file: source, imageHash: image.hash, videoId: video.videoId };
    } else {
      const image = await uploadAdImage(username, target.id, source);
      if (!image.ok) throw new Error(image.error);
      uploadedRef.current = { file: source, imageHash: image.hash };
    }
    setUpload({
      state: 'done',
      label: 'Meta 광고 계정에 소재 올리기',
      detail: uploadedRef.current.videoId
        ? `영상 ID ${uploadedRef.current.videoId}`
        : `이미지 해시 ${uploadedRef.current.imageHash}`,
    });
    return uploadedRef.current;
  };

  /** 기록이 만들어진 뒤 남은 단계를 진행한다. 다시 시도도 여기로 온다. */
  const runSteps = async (from: MetaAdRecord) => {
    setRunError('');
    setSubmitting(true);
    setPhase('running');
    const result = await runRemainingSteps(username, from, (next, note) => {
      setRecord(next);
      setRunNote(note || '');
    });
    setRecord(result.record);
    setRunNote('');
    setSubmitting(false);
    notifyMetaAdsChanged();
    onSubmitted?.(result.record);
    if (result.error) {
      setRunError(result.error);
      return;
    }
    setPhase('finished');
    setDone(true);
  };

  const submit = async () => {
    if (!account) {
      setError('광고를 만들 Meta 광고 계정을 먼저 골라 주세요.');
      return;
    }
    if (!page) {
      setError('광고를 내보낼 페이스북 페이지를 골라 주세요.');
      return;
    }
    if (!file && !resume) {
      setError('광고로 쓸 영상 또는 이미지를 올려 주세요.');
      return;
    }
    if (!headline.trim()) {
      setError('광고 제목을 입력해 주세요.');
      return;
    }
    const link = normalizedLink();
    if (!link) {
      setError('연결 URL 을 확인해 주세요. 예: https://brand.co.kr/summer');
      return;
    }
    const invalid = delivery.validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setError('');
    setRunError('');
    setSubmitting(true);
    setPhase('running');

    // 이어서 만들 때 파일을 바꾸지 않았으면 이미 광고 계정에 올라간 소재를 그대로 쓴다.
    let media: { imageHash: string; videoId?: string } | null = null;
    try {
      if (file) media = await uploadCreative(account, file);
      else setUpload({ state: 'done', label: 'Meta 광고 계정에 소재 올리기', detail: '이전에 올린 소재 사용' });
    } catch (e) {
      setUpload({ state: 'error', label: 'Meta 광고 계정에 소재 올리기', detail: (e as Error)?.message });
      setRunError((e as Error)?.message || '소재를 올리지 못했습니다.');
      setSubmitting(false);
      return;
    }

    const settings = {
      pageId: page.id,
      initialStatus: (startPaused ? 'PAUSED' : 'ACTIVE') as 'PAUSED' | 'ACTIVE',
      objective,
      headline: headline.trim(),
      bodyText: bodyText.trim(),
      cta,
      linkUrl: link,
      ...(media
        ? { imageHash: media.imageHash, videoId: media.videoId, creativeKind: isVideo ? 'video' as const : 'image' as const, thumbnailUrl }
        : {}),
      ...delivery.payload(),
    };
    const created = resume
      ? await resumeMetaAd(username, resume.id, settings)
      : await createMetaAd(username, { source: 'own', adAccountId: account.id, ...settings });
    if (!created.ok) {
      if (created.record) {
        setRecord(created.record);
        notifyMetaAdsChanged();
        onSubmitted?.(created.record);
      }
      setRunError(created.error);
      setSubmitting(false);
      return;
    }
    setRecord(created.record);
    await runSteps(created.record);
  };

  /** 실패한 단계부터 다시. 기록이 아직 없으면(업로드·캠페인 전) 처음부터 다시 누른다. */
  const retry = () => {
    if (record) void runSteps(record);
    else void submit();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 max-h-[90vh] modal-maxh-90 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-black text-slate-900">{resume ? '멈춘 광고 이어서 만들기' : '직접 소재 업로드'}</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {resume ? '설정을 확인하고 고친 뒤 다시 만듭니다' : '브랜드가 가진 영상·이미지로 광고를 만듭니다'}
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

        {phase !== 'form' ? (
          <div className="p-5 md:p-6 overflow-y-auto space-y-4">
            {done ? (
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6 text-emerald-600" strokeWidth={3} />
                </div>
                <p className="text-sm font-black text-slate-900 mt-3">Meta에 광고가 만들어졌습니다</p>
                <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed">
                  {headline.trim()} · {findObjective(objective)?.label}
                  <br />
                  예산 {formatKoreanWon(delivery.budgetKrw)} · {delivery.startDate} ~ {delivery.endDate}
                  <br />
                  {page?.name} · {ctaLabel(cta)}
                  {account && (
                    <>
                      <br />
                      {account.name} · {account.id}
                    </>
                  )}
                </p>
                <p className="text-[11px] text-blue-600 font-bold mt-3 leading-relaxed">
                  {startPaused
                    ? '일시중지 상태로 만들어 노출·과금은 시작되지 않습니다. 광고 현황에서 재개할 수 있습니다.'
                    : 'Meta 광고 검토가 끝나면 노출이 시작됩니다. 검토 상태는 광고 현황에 Meta가 알려 주는 그대로 표시됩니다.'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-black text-slate-900">
                  {runError ? '광고를 만드는 중 멈췄습니다' : 'Meta에 광고를 만드는 중'}
                </p>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                  창을 닫아도 만들어진 단계는 남습니다. 광고 현황에서 이어서 만들 수 있습니다.
                </p>
              </div>
            )}

            <MetaAdProgress
              upload={upload}
              record={record}
              running={submitting}
              error={runError}
              note={runNote}
            />

            {runError && !submitting && (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
                <p className="text-[11px] font-black text-rose-700">Meta 응답</p>
                <p className="text-[11px] text-rose-600 font-medium mt-0.5 leading-relaxed break-words">{runError}</p>
              </div>
            )}

            <div className="flex gap-2">
              {runError && !submitting && (
                <button
                  type="button"
                  onClick={retry}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[12px] font-black hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {record ? '멈춘 단계부터 다시 시도' : '다시 시도'}
                </button>
              )}
              {runError && !submitting && (
                <button
                  type="button"
                  onClick={() => { setPhase('form'); setRunError(''); if (record) setFixing(true); }}
                  className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black hover:bg-slate-50 transition-colors"
                >
                  설정 고치기
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl bg-slate-900 text-white text-[12px] font-black hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                광고 현황으로 돌아가기
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto px-5 py-4 space-y-5">
              {resume && <ResumeNotice record={resume} />}

              {/* 목적이 먼저다 — CTA 문구 순서와 아래 안내가 이 값에 따라 바뀐다. */}
              <div>
                <p className={labelCls}>광고 목적</p>
                <div className="grid grid-cols-3 gap-1.5 mt-1.5" role="radiogroup" aria-label="광고 목적">
                  {AD_OBJECTIVES.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={objective === o.value}
                      onClick={() => pickObjective(o.value)}
                      className={`py-2 rounded-xl text-[11px] font-black border transition-colors ${
                        objective === o.value
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 고른 목적으로 메타가 무엇을 하는지. 부스팅 창의 같은 자리·같은 모양이다. */}
              {objectiveNotice && (
                <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
                  <p className="text-[12px] font-black text-blue-800">{objectiveNotice.title}</p>
                  <p className="text-[11px] text-blue-600 font-medium mt-1 leading-relaxed">
                    {objectiveNotice.body}
                  </p>
                </div>
              )}

              {/* 소재. 집행하기를 누르면 이 파일이 광고 계정에 올라간다. */}
              <div>
                <p className={labelCls}>광고 소재</p>
                {file ? (
                  <div className="mt-1.5 flex items-start gap-3 bg-slate-50 rounded-2xl p-3">
                    {isVideo ? (
                      <video
                        src={previewUrl}
                        muted
                        playsInline
                        controls
                        className="w-20 aspect-[9/16] rounded-xl object-cover bg-slate-900 flex-shrink-0"
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt=""
                        className="w-20 aspect-[9/16] rounded-xl object-cover bg-slate-200 flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-black text-slate-900 break-all leading-snug">{file.name}</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                        {isVideo ? '영상' : '이미지'}
                        {formatFileSize(file.size) ? ` · ${formatFileSize(file.size)}` : ''}
                      </p>
                      <div className="flex items-center gap-1.5 mt-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-500 hover:bg-slate-50 transition-colors"
                        >
                          파일 바꾸기
                        </button>
                        <button
                          type="button"
                          onClick={clearFile}
                          aria-label="소재 삭제"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-400 hover:bg-slate-50 transition-colors flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                ) : resume ? (
                  // 이어서 만들 때는 이미 광고 계정에 올라간 소재가 있다. 바꿀 때만 새로 올린다.
                  <div className="mt-1.5 flex items-start gap-3 bg-slate-50 rounded-2xl p-3">
                    {resume.thumbnailUrl ? (
                      <img
                        src={resume.thumbnailUrl}
                        alt=""
                        className="w-20 aspect-[9/16] rounded-xl object-cover bg-slate-200 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-20 aspect-[9/16] rounded-xl bg-slate-200 flex-shrink-0 flex items-center justify-center">
                        <span className="text-[9px] text-slate-400 font-black">소재</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-black text-slate-900 leading-snug">이전에 올린 소재를 그대로 씁니다</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                        {resume.creativeKind === 'video' ? '영상' : '이미지'} · Meta 광고 계정에 올라가 있음
                      </p>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="mt-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black text-slate-500 hover:bg-slate-50 transition-colors"
                      >
                        파일 바꾸기
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      takeFile(e.dataTransfer.files?.[0] || null);
                    }}
                    className={`mt-1.5 w-full rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
                      dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <Upload className={`w-5 h-5 mx-auto ${dragging ? 'text-blue-500' : 'text-slate-400'}`} />
                    <p className="text-[12px] font-black text-slate-600 mt-2">
                      영상 또는 이미지를 끌어다 놓으세요
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold mt-1">
                      눌러서 파일을 고를 수도 있습니다 · mp4 · jpg · png
                    </p>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => takeFile(e.target.files?.[0] || null)}
                />
                <p className="text-[10px] text-slate-400 font-medium mt-1.5 leading-relaxed">
                  집행하기를 누르면 이 파일이 선택한 Meta 광고 계정에 소재로 올라갑니다.
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-headline">광고 제목</label>
                <input
                  id="create-headline"
                  value={headline}
                  maxLength={40}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="예: 여름 신상 원피스 30% 할인"
                  className={inputCls}
                />
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  소재 아래 굵게 보이는 한 줄입니다 · {headline.length}/40
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-body">광고 본문</label>
                <textarea
                  id="create-body"
                  value={bodyText}
                  maxLength={300}
                  rows={4}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="소재와 함께 보여 줄 설명을 적어 주세요."
                  className={`${inputCls} leading-relaxed resize-none`}
                />
                <p className="text-[10px] text-slate-400 font-bold mt-1">{bodyText.length}/300</p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-cta">CTA 버튼 문구</label>
                <div className="relative mt-1.5">
                  <select
                    id="create-cta"
                    value={cta}
                    onChange={(e) => { setCta(e.target.value as AdCta); setCtaPicked(true); }}
                    className={selectCls}
                  >
                    {ctaOptions.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  {findObjective(objective)?.label} 목적에 맞는 문구가 위에 있습니다
                  {ctaOptions[0].value !== cta ? ` · 추천 ${ctaOptions[0].label}` : ''}
                </p>
              </div>

              <div>
                <label className={labelCls} htmlFor="create-link">연결 URL</label>
                <input
                  id="create-link"
                  type="url"
                  inputMode="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://brand.co.kr/summer"
                  className={inputCls}
                />
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  '{ctaLabel(cta)}' 를 누르면 가는 주소입니다. 필수입니다.
                </p>
              </div>

              <div>
                <p className={labelCls}>광고 페이지</p>
                {account && (
                  <MetaPagePicker
                    pages={pagesState.pages}
                    selectedId={page?.id}
                    onSelect={selectPage}
                    loading={pagesState.loading}
                    error={pagesState.error}
                    onRetry={pagesState.refresh}
                  />
                )}
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  연동한 Meta 계정이 관리하는 페이스북 페이지입니다. 이 페이지 이름으로 광고가 보입니다
                  {account ? ` · ${account.name} 계정으로 집행` : ''}
                </p>
              </div>

              {!account && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                  <p className="text-[11px] font-black text-amber-800">
                    Meta 광고 계정이 아직 정해지지 않았습니다
                  </p>
                  <p className="text-[10px] text-amber-700 font-medium mt-0.5 leading-relaxed">
                    광고 현황에서 Meta 계정을 연동하고 광고 계정을 고르면 이 창에서 바로 집행할 수 있습니다.
                  </p>
                </div>
              )}

              {/* 여기서부터는 부스팅 창과 같은 항목·같은 검증이다. */}
              <AdDeliveryFields delivery={delivery} idPrefix="create" />

              <StartPausedToggle checked={startPaused} onChange={setStartPaused} />
            </div>

            <div className="border-t border-slate-100 px-5 py-4 bg-white">
              {error && <p className="text-[11px] text-rose-500 font-black mb-2">{error}</p>}
              {account && !page && !submitting && (
                <p className="text-[11px] text-blue-600 font-black mb-2">광고 페이지를 선택해 주세요</p>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !account || !page}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? '집행 중' : resume ? '이 설정으로 이어서 만들기' : '집행하기'}
              </button>
              <p className="text-[10px] text-slate-400 font-medium mt-2 text-center leading-relaxed">
                {resume
                  ? '멈출 때까지 만들어 둔 캠페인은 지우고, 이 설정으로 캠페인부터 다시 만듭니다.'
                  : startPaused
                  ? 'Meta에 캠페인·광고 세트·소재·광고를 일시중지 상태로 만듭니다(과금 없음).'
                  : 'Meta에 캠페인·광고 세트·소재·광고가 바로 만들어지고, Meta 검토 후 노출·과금이 시작됩니다.'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdCreateModal;
