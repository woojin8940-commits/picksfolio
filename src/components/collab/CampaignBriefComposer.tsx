import React, { useState, useRef } from 'react';
import { formatNumberWithCommas, formatKoreanWon } from '../../utils/formatters';
import { authHeaders } from '../../services/apiService';
import ImageCropper from '../ImageCropper';

/**
 * 캠페인 등록 — 브리프 작성.
 *
 * 예전 화면은 제목·설명·금액만 받는 한 장짜리 폼이었다. 그 결과 지원자를 선정한 뒤에
 * 담당자가 브랜드에게 "제품이 무엇인가요, 어느 채널에 올리나요, 언제까지 올려야 하나요,
 * 2차 활용은 되나요"를 처음부터 다시 물어야 했다. 캠페인 등록은 협업의 시작점이므로,
 * 협업을 진행하는 데 필요한 것을 그 자리에서 받아 둔다.
 *
 * 단계를 나눈 이유는 항목이 늘었기 때문이다. 한 화면에 다 세워 두면 어디까지 적었는지
 * 알 수 없고, 필수 항목이 화면 밖으로 밀려난다. 각 단계는 다음으로 넘어갈 때 그 단계의
 * 필수 항목만 확인한다 — 마지막에 몰아서 알려 주면 앞 단계로 되돌아가야 한다.
 */

export interface CampaignBriefDraft {
  id?: string;
  type: string;
  title: string;
  description: string;
  brand_name: string;
  thumbnail_url: string;
  category: string;
  reward_type: string;
  reward_amount: string;
  requirements: string;
  max_applicants: number;
  start_date: string;
  end_date: string;
  product_name?: string;
  product_url?: string;
  upload_channel?: string;
  content_format?: string;
  video_concept?: string;
  guideline_url?: string;
  guideline_note?: string;
  second_use_fee?: number | string;
  second_use_note?: string;
  upload_from?: string;
  upload_to?: string;
}

interface CampaignBriefComposerProps {
  businessUsername: string;
  companyName: string;
  /** 수정 모드면 기존 캠페인. 새로 만들면 null. */
  editing: CampaignBriefDraft | null;
  categories: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onSaved: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const UPLOAD_CHANNELS = ['인스타그램', '유튜브', '틱톡', '블로그', '기타'];
const CONTENT_FORMATS = [
  { value: 'shortform', label: '숏폼 (릴스/쇼츠)' },
  { value: 'longform', label: '롱폼 영상' },
  { value: 'image', label: '이미지 게시물' },
  { value: 'blog', label: '블로그 리뷰' },
  { value: 'mixed', label: '복합' },
];

const STEPS = [
  { key: 'basic', label: '기본 정보', hint: '어떤 캠페인인지' },
  { key: 'product', label: '제품 · 채널', hint: '무엇을 어디에' },
  { key: 'guide', label: '가이드라인', hint: '지켜야 할 것' },
  { key: 'budget', label: '비용 · 일정', hint: '얼마에 언제까지' },
  { key: 'review', label: '검토', hint: '확인하고 제출' },
];

const INPUT =
  'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
const LABEL = 'block text-xs font-black text-slate-700 mb-1.5';

/** 화면에 쉼표를 넣어 보여 주고, 서버에는 숫자만 보낸다. */
const digitsOnly = (raw: unknown) => String(raw ?? '').replace(/[^\d]/g, '');

const CampaignBriefComposer: React.FC<CampaignBriefComposerProps> = ({
  businessUsername,
  companyName,
  editing,
  categories,
  onCancel,
  onSaved,
  onNotify,
}) => {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [thumbnailPreview, setThumbnailPreview] = useState(editing?.thumbnail_url || '');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [cropperSrc, setCropperSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  const [form, setForm] = useState({
    type: editing?.type || 'ad_collab',
    title: editing?.title || '',
    description: editing?.description || '',
    brand_name: editing?.brand_name || companyName,
    thumbnail_url: editing?.thumbnail_url || '',
    category: editing?.category || '',
    reward_type: editing?.reward_type || 'fixed',
    reward_amount: editing?.reward_amount || '',
    requirements: editing?.requirements || '',
    max_applicants: editing?.max_applicants ?? 0,
    start_date: editing?.start_date || '',
    end_date: editing?.end_date || '',
    product_name: editing?.product_name || '',
    product_url: editing?.product_url || '',
    upload_channel: editing?.upload_channel || '인스타그램',
    content_format: editing?.content_format || 'shortform',
    video_concept: editing?.video_concept || '',
    guideline_url: editing?.guideline_url || '',
    guideline_note: editing?.guideline_note || '',
    second_use_fee: formatNumberWithCommas(digitsOnly(editing?.second_use_fee || '')),
    second_use_note: editing?.second_use_note || '',
    upload_from: editing?.upload_from || '',
    upload_to: editing?.upload_to || '',
  });

  const patch = (key: keyof typeof form, value: string | number) =>
    setForm(p => ({ ...p, [key]: value }));

  // ---------------------------------------------------------------- 이미지
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onNotify('이미지 크기는 5MB 이하만 가능합니다.', 'error');
      return;
    }
    pendingFileRef.current = file;
    setCropperSrc(URL.createObjectURL(file));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropConfirm = async (croppedBlob: Blob) => {
    const file = pendingFileRef.current;
    setCropperSrc(null);
    pendingFileRef.current = null;
    if (!file) return;
    setUploadingImage(true);
    try {
      setThumbnailPreview(URL.createObjectURL(croppedBlob));
      const fd = new FormData();
      fd.append(
        'image',
        new File([croppedBlob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }),
      );
      fd.append('username', businessUsername);
      const res = await fetch('/api/upload-image', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.url) {
        patch('thumbnail_url', data.url);
      } else {
        onNotify('이미지 업로드에 실패했습니다.', 'error');
        setThumbnailPreview('');
      }
    } catch {
      onNotify('이미지 업로드 중 오류가 발생했습니다.', 'error');
      setThumbnailPreview('');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCropCancel = () => {
    if (cropperSrc) URL.revokeObjectURL(cropperSrc);
    setCropperSrc(null);
    pendingFileRef.current = null;
  };

  // ---------------------------------------------------------------- 이동
  /** 그 단계에서 반드시 있어야 하는 것. 없으면 다음으로 넘기지 않는다. */
  const stepError = (index: number): string => {
    if (index === 0) {
      if (!form.title.trim()) return '캠페인 제목을 입력해 주세요.';
      return '';
    }
    if (index === 1) {
      if (!form.product_name.trim()) return '어떤 제품·서비스인지 적어 주세요.';
      if (!form.video_concept.trim()) return '원하는 영상 컨셉을 적어 주세요. 인플루언서가 가장 먼저 보는 항목입니다.';
      return '';
    }
    if (index === 3) {
      if (!digitsOnly(form.reward_amount) && form.reward_type === 'fixed') {
        return '광고비를 입력해 주세요.';
      }
      // 게시일 범위가 거꾸로면 담당자가 어느 날짜를 마감으로 잡아야 할지 알 수 없다.
      if (form.upload_from && form.upload_to && form.upload_from > form.upload_to) {
        return '희망 게시일의 시작일이 종료일보다 늦습니다.';
      }
      if (form.start_date && form.end_date && form.start_date > form.end_date) {
        return '모집 시작일이 종료일보다 늦습니다.';
      }
      return '';
    }
    return '';
  };

  const goNext = () => {
    const err = stepError(step);
    if (err) {
      onNotify(err, 'error');
      return;
    }
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  };

  const goTo = (index: number) => {
    // 뒤로는 자유롭게, 앞으로는 지금 단계를 통과해야 한다.
    if (index <= step) {
      setStep(index);
      return;
    }
    const err = stepError(step);
    if (err) {
      onNotify(err, 'error');
      return;
    }
    setStep(index);
  };

  // ---------------------------------------------------------------- 제출
  const submit = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      const err = stepError(i);
      if (err) {
        setStep(i);
        onNotify(err, 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        // 서버의 second_use_fee 는 숫자 컬럼이다. "150,000" 을 그대로 보내면 저장이 깨진다.
        second_use_fee: Number(digitsOnly(form.second_use_fee) || 0),
      };
      const res = await fetch('/api/campaigns', {
        method: editing ? 'PATCH' : 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(
          editing
            ? { id: editing.id, ...payload }
            : { ...payload, business_username: businessUsername },
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onNotify(err.error || (editing ? '수정 실패' : '등록 실패'), 'error');
        return;
      }
      onNotify(
        editing
          ? '캠페인이 수정되었습니다.'
          : '캠페인이 등록되었습니다. 픽스폴리오 검토 후 공개되고, 담당자가 배정됩니다.',
      );
      onSaved();
    } catch {
      onNotify('서버 오류가 발생했습니다.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------- 렌더
  const channelActive = (c: string) =>
    form.upload_channel === c
      ? 'bg-slate-900 text-white border-slate-900'
      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400';

  const feeNumber = Number(digitsOnly(form.reward_amount) || 0);
  const secondUseNumber = Number(digitsOnly(form.second_use_fee) || 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      {cropperSrc && (
        <ImageCropper src={cropperSrc} onCrop={handleCropConfirm} onCancel={handleCropCancel} aspectRatio={1} />
      )}

      {/* 단계 표시 */}
      <div className="px-5 md:px-7 pt-6 pb-4 border-b border-slate-100">
        <h2 className="text-xl font-black text-slate-900">
          {editing ? '캠페인 수정' : '캠페인 등록'}
        </h2>
        <p className="text-xs text-slate-400 font-medium mt-1">
          여기에 적으신 내용이 담당자와 인플루언서가 보는 브리프가 됩니다.
        </p>

        <div className="flex items-center gap-1 mt-5 overflow-x-auto">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.key}>
              <button
                type="button"
                onClick={() => goTo(i)}
                className="flex items-center gap-2 flex-shrink-0 group"
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-colors ${
                    i === step
                      ? 'bg-slate-900 text-white'
                      : i < step
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </span>
                <span
                  className={`text-[11px] font-black whitespace-nowrap ${
                    i === step ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && <span className="w-4 h-px bg-slate-200 flex-shrink-0" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="p-5 md:p-7 space-y-5">
        {/* ① 기본 정보 */}
        {step === 0 && (
          <>
            <div>
              <label className={LABEL}>캠페인 대표 이미지</label>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              {thumbnailPreview || form.thumbnail_url ? (
                <div className="relative w-full aspect-square max-w-[320px] rounded-xl overflow-hidden border border-slate-200 bg-slate-50 group">
                  <img
                    src={thumbnailPreview || form.thumbnail_url}
                    alt="캠페인 대표 이미지"
                    className="w-full h-full object-cover"
                  />
                  {uploadingImage && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                  <div className="absolute inset-0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-white rounded-xl text-xs font-black text-slate-700 shadow-lg"
                    >
                      변경
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setThumbnailPreview('');
                        patch('thumbnail_url', '');
                      }}
                      className="px-4 py-2 bg-red-500 text-white rounded-xl text-xs font-black shadow-lg"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-square max-w-[320px] border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center hover:border-blue-400 hover:bg-blue-50/50 transition-all group"
                >
                  <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-3 group-hover:bg-blue-100 transition-colors">
                    <svg className="w-6 h-6 text-slate-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-xs font-bold text-slate-400 group-hover:text-blue-500">클릭하여 이미지 업로드</p>
                  <p className="text-[10px] text-slate-300 mt-1">JPG, PNG (최대 5MB · 400×400 자동 리사이즈)</p>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>캠페인 유형</label>
                <select value={form.type} onChange={e => patch('type', e.target.value)} className={`${INPUT} bg-white`}>
                  <option value="ad_collab">광고 협업</option>
                  <option value="group_buy">공동구매</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>카테고리</label>
                <select value={form.category} onChange={e => patch('category', e.target.value)} className={`${INPUT} bg-white`}>
                  {categories.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={LABEL}>캠페인 제목 *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => patch('title', e.target.value)}
                className={INPUT}
                placeholder="예: 여름 신제품 선크림 숏폼 리뷰"
              />
            </div>

            <div>
              <label className={LABEL}>브랜드명</label>
              <input
                type="text"
                value={form.brand_name}
                onChange={e => patch('brand_name', e.target.value)}
                className={INPUT}
                placeholder="브랜드 이름"
              />
            </div>

            <div>
              <label className={LABEL}>캠페인 소개</label>
              <textarea
                value={form.description}
                onChange={e => patch('description', e.target.value)}
                className={`${INPUT} min-h-[110px] resize-y`}
                placeholder="어떤 캠페인인지 인플루언서에게 소개해 주세요."
              />
            </div>
          </>
        )}

        {/* ② 제품 · 채널 */}
        {step === 1 && (
          <>
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[11px] text-slate-500 font-bold">
                이 단계의 내용은 인플루언서가 지원 전에 보는 '요청 광고' 카드가 됩니다.
              </p>
            </div>

            <div>
              <label className={LABEL}>제품 · 서비스명 *</label>
              <input
                type="text"
                value={form.product_name}
                onChange={e => patch('product_name', e.target.value)}
                className={INPUT}
                placeholder="예: 데일리 톤업 선크림 50ml"
              />
            </div>

            <div>
              <label className={LABEL}>제품 링크</label>
              <input
                type="url"
                value={form.product_url}
                onChange={e => patch('product_url', e.target.value)}
                className={INPUT}
                placeholder="https://"
              />
              <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                상세 페이지가 있으면 넣어 주세요. 인플루언서가 제품을 직접 확인합니다.
              </p>
            </div>

            <div>
              <label className={LABEL}>업로드 채널</label>
              <div className="flex flex-wrap gap-1.5">
                {UPLOAD_CHANNELS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => patch('upload_channel', c)}
                    className={`px-3.5 py-2 rounded-xl border text-xs font-black transition-colors ${channelActive(c)}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={LABEL}>콘텐츠 형식</label>
              <select
                value={form.content_format}
                onChange={e => patch('content_format', e.target.value)}
                className={`${INPUT} bg-white`}
              >
                {CONTENT_FORMATS.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL}>영상 컨셉 *</label>
              <textarea
                value={form.video_concept}
                onChange={e => patch('video_concept', e.target.value)}
                className={`${INPUT} min-h-[130px] resize-y`}
                placeholder={
                  '어떤 그림을 기대하시는지 적어 주세요.\n예) 아침 세안 후 바르는 장면으로 시작 · 백탁 없이 발리는 모습을 클로즈업 · 마지막에 제품 전체 컷'
                }
              />
              <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                인플루언서는 이 내용으로 대본을 씁니다. 여기가 비어 있으면 대본 검수에서 처음부터 다시 맞춰야 합니다.
              </p>
            </div>
          </>
        )}

        {/* ③ 가이드라인 */}
        {step === 2 && (
          <>
            <div className="bg-slate-50 rounded-xl px-4 py-3">
              <p className="text-[11px] text-slate-500 font-bold">
                반드시 지켜야 하는 것만 적어 주세요. 담당자가 대본·영상 검수에서 이 기준으로 확인합니다.
              </p>
            </div>

            <div>
              <label className={LABEL}>가이드라인 문서 링크</label>
              <input
                type="url"
                value={form.guideline_url}
                onChange={e => patch('guideline_url', e.target.value)}
                className={INPUT}
                placeholder="https:// (노션, 구글 드라이브 등)"
              />
            </div>

            <div>
              <label className={LABEL}>필수 확인 사항</label>
              <textarea
                value={form.guideline_note}
                onChange={e => patch('guideline_note', e.target.value)}
                className={`${INPUT} min-h-[130px] resize-y`}
                placeholder={'예) 필수 해시태그 #브랜드명 #광고\n유료광고 표기 필수\n경쟁 브랜드 노출 금지\n제품명 정확히 발음'}
              />
            </div>

            <div>
              <label className={LABEL}>지원 조건</label>
              <textarea
                value={form.requirements}
                onChange={e => patch('requirements', e.target.value)}
                className={`${INPUT} min-h-[90px] resize-y`}
                placeholder="팔로워 수, 콘텐츠 스타일 등 지원 단계에서 걸러야 할 조건"
              />
            </div>
          </>
        )}

        {/* ④ 비용 · 일정 */}
        {step === 3 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>보상 유형</label>
                <select
                  value={form.reward_type}
                  onChange={e => patch('reward_type', e.target.value)}
                  className={`${INPUT} bg-white`}
                >
                  <option value="fixed">고정 금액</option>
                  <option value="product">제품 제공</option>
                  <option value="revenue_share">수익 배분</option>
                  <option value="mixed">복합</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>광고비 {form.reward_type === 'fixed' ? '*' : ''}</label>
                <input
                  type="text"
                  value={form.reward_amount}
                  onChange={e => {
                    const raw = e.target.value;
                    const digits = digitsOnly(raw);
                    if (digits && /^[\d,원]*$/.test(raw)) {
                      patch('reward_amount', formatNumberWithCommas(digits) + (raw.endsWith('원') ? '원' : ''));
                    } else {
                      patch('reward_amount', raw);
                    }
                  }}
                  className={INPUT}
                  placeholder="예: 500,000원 또는 제품 1세트"
                />
                {feeNumber > 0 && (
                  <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                    {formatKoreanWon(feeNumber)}
                  </p>
                )}
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 space-y-3">
              <div>
                <label className={LABEL}>2차 활용 비용</label>
                <input
                  type="text"
                  value={form.second_use_fee}
                  onChange={e => patch('second_use_fee', formatNumberWithCommas(digitsOnly(e.target.value)))}
                  className={`${INPUT} bg-white`}
                  placeholder="0"
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                  제작된 영상을 브랜드 채널·광고 소재로 다시 쓰려면 별도 비용입니다. 필요 없으면 비워 두세요.
                </p>
                {secondUseNumber > 0 && (
                  <p className="text-[11px] text-slate-500 font-bold mt-1">{formatKoreanWon(secondUseNumber)}</p>
                )}
              </div>
              <div>
                <label className={LABEL}>2차 활용 범위</label>
                <input
                  type="text"
                  value={form.second_use_note}
                  onChange={e => patch('second_use_note', e.target.value)}
                  className={`${INPUT} bg-white`}
                  placeholder="예: 자사몰·메타 광고 6개월"
                />
              </div>
            </div>

            <div>
              <label className={LABEL}>희망 게시일</label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={form.upload_from}
                  onChange={e => patch('upload_from', e.target.value)}
                  className={INPUT}
                />
                <span className="text-slate-300 font-black">~</span>
                <input
                  type="date"
                  value={form.upload_to}
                  onChange={e => patch('upload_to', e.target.value)}
                  className={INPUT}
                />
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                이 기간이 협업의 업로드 마감이 됩니다. 담당자가 대본·영상 일정을 여기에 맞춰 잡습니다.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>모집 시작일</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={e => patch('start_date', e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>모집 종료일</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={e => patch('end_date', e.target.value)}
                  className={INPUT}
                />
              </div>
            </div>

            <div>
              <label className={LABEL}>모집 인원 (0 = 무제한)</label>
              <input
                type="number"
                min={0}
                value={form.max_applicants}
                onChange={e => patch('max_applicants', parseInt(e.target.value) || 0)}
                className={INPUT}
              />
              <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                목표 인원입니다. 정원을 채워도 종료일까지 지원을 계속 받아, 더 많은 지원자 중에서 고를 수 있습니다.
              </p>
            </div>
          </>
        )}

        {/* ⑤ 검토 */}
        {step === 4 && (
          <>
            <div className="bg-blue-50/70 border border-blue-100 rounded-xl px-4 py-3.5">
              <p className="text-xs text-blue-700 font-black mb-1">등록하면 이렇게 진행됩니다</p>
              <ol className="text-[11px] text-blue-600 font-medium space-y-0.5 list-decimal list-inside">
                <li>픽스폴리오가 브리프를 확인하고 캠페인을 공개합니다</li>
                <li>담당자가 배정되고, 지원자 중에서 선정을 진행합니다</li>
                <li>대본과 영상이 올라오면 이 화면에서 피드백을 남기시면 됩니다</li>
              </ol>
            </div>

            <dl className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {[
                { label: '캠페인', value: form.title },
                { label: '브랜드', value: form.brand_name },
                { label: '제품', value: form.product_name },
                { label: '업로드 채널', value: form.upload_channel },
                {
                  label: '콘텐츠 형식',
                  value: CONTENT_FORMATS.find(f => f.value === form.content_format)?.label || form.content_format,
                },
                { label: '영상 컨셉', value: form.video_concept },
                { label: '가이드라인', value: form.guideline_url || form.guideline_note || '미작성' },
                { label: '광고비', value: form.reward_amount || '미입력' },
                {
                  label: '2차 활용',
                  value: secondUseNumber > 0
                    ? `${formatNumberWithCommas(String(secondUseNumber))}원 ${form.second_use_note}`.trim()
                    : '해당 없음',
                },
                {
                  label: '희망 게시일',
                  value: form.upload_from || form.upload_to
                    ? `${form.upload_from || '미정'} ~ ${form.upload_to || '미정'}`
                    : '담당자와 협의',
                },
                {
                  label: '모집 기간',
                  value: form.start_date || form.end_date
                    ? `${form.start_date || '미정'} ~ ${form.end_date || '미정'}`
                    : '상시',
                },
                { label: '모집 인원', value: form.max_applicants > 0 ? `${form.max_applicants}명` : '무제한' },
              ].map(row => (
                <div key={row.label} className="flex gap-3 px-4 py-2.5">
                  <dt className="text-[11px] font-black text-slate-400 w-20 flex-shrink-0 pt-0.5">{row.label}</dt>
                  <dd className="text-xs font-medium text-slate-700 whitespace-pre-wrap flex-1 min-w-0">
                    {row.value || <span className="text-slate-300">미입력</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>

      {/* 이동 버튼 */}
      <div className="px-5 md:px-7 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={step === 0 ? onCancel : () => setStep(s => s - 1)}
          className="px-5 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl font-black text-sm text-slate-600 transition-colors"
        >
          {step === 0 ? '취소' : '이전'}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 font-bold hidden md:inline">
            {STEPS[step].hint}
          </span>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="px-7 py-3 bg-slate-900 hover:bg-slate-700 text-white rounded-xl font-black text-sm transition-colors"
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || uploadingImage}
              className="px-7 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {submitting && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {editing ? '캠페인 수정' : '캠페인 등록'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CampaignBriefComposer;
