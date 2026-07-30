import React, { useState, useRef, useEffect, useMemo } from 'react';
import { formatNumberWithCommas, formatKoreanWon, todayInSeoul } from '../../utils/formatters';
import { authHeaders } from '../../services/apiService';
import ImageCropper from '../ImageCropper';
import {
  PACKAGES, packageOf, PRODUCT_PROVIDE, AD_OBJECTIVES, CHANNELS, GENDERS, AGE_BANDS,
  FOLLOWER_TIERS, INFLUENCER_STYLES, EXCLUDE_KEYWORDS,
  totalBudget, derivedHeadcount, derivedTitle, derivedRequirements,
  type PackageTier,
} from '../../utils/campaignPackages';

/**
 * 캠페인 등록.
 *
 * 예전 화면은 다섯 단계에 걸쳐 스무 칸을 받았다. 제목, 보상 유형, 1인 광고비, 모집
 * 인원, 모집 시작일, 모집 종료일, 콘텐츠 형식, 2차 활용 비용... 브랜드가 처음
 * 캠페인을 올릴 때 이 값들을 스스로 정할 수 있는 경우는 거의 없어서, 대부분 비워 둔
 * 채로 제출하고 담당자가 다시 물었다. 등록을 두 번 하는 셈이었다.
 *
 * 그래서 묻는 것을 세 가지로 줄였다.
 *   ① 제품 정보  — 무엇을 알릴 것인가
 *   ② 캠페인 설정 — 어떤 패키지로, 얼마에, 언제까지
 *   ③ 희망 인플루언서 — 누가 올리면 좋겠는가
 *
 * 나머지는 계산한다. 제목은 제품명에서, 1인 단가와 진행 단계와 2차 활용 조건은
 * 패키지에서, 모집 인원은 예산에서 나온다(campaignPackages.ts). 사라진 칸이 아니라
 * 물어보지 않게 된 칸이다 — 서버로 가는 값은 예전과 같다.
 *
 * 가이드라인은 등록에서 빼서 등록 직후 상세 화면의 배너로 옮겼다. 가이드라인은
 * 인플루언서가 정해진 뒤에 쓰는 것이 자연스럽고, 등록 단계에서 필수로 두면 "아직
 * 안 정했는데"로 등록 자체가 멈춘다.
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
  package_tier?: string;
  product_provide?: string;
  ad_objective?: string;
  budget_krw?: number;
  seeding_count?: number;
  fast_track?: boolean;
  influencer_gender?: string;
  influencer_ages?: string;
  sns_category?: string;
  follower_tiers?: string;
  min_views?: number;
  influencer_styles?: string;
  exclude_keywords?: string;
  target_audience?: string;
}

interface CampaignRegisterWizardProps {
  businessUsername: string;
  companyName: string;
  /** 수정 모드면 기존 캠페인. 새로 만들면 null. */
  editing: CampaignBriefDraft | null;
  categories: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onSaved: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

const STEPS = [
  { key: 'product', label: '제품 정보', hint: '무엇을 알릴까요' },
  { key: 'campaign', label: '캠페인 설정', hint: '어떻게 진행할까요' },
  { key: 'influencer', label: '희망 인플루언서', hint: '누가 올리면 좋을까요' },
];

const INPUT =
  'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
const LABEL = 'block text-xs font-black text-slate-700 mb-1.5';

/** 화면에 쉼표를 넣어 보여 주고, 서버에는 숫자만 보낸다. */
const digitsOnly = (raw: unknown) => String(raw ?? '').replace(/[^\d]/g, '');

/** 쉼표로 이어 저장된 값 ↔ 배열. 수정 모드에서 기존 캠페인을 되읽을 때 쓴다. */
const splitCsv = (raw: unknown): string[] =>
  String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** 단계별 작성 상태. 사이드바에서 완료/미입력으로 보여 준다. */
type FieldState = { label: string; done: boolean; required: boolean };

const CampaignRegisterWizard: React.FC<CampaignRegisterWizardProps> = ({
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
  const [showDetail, setShowDetail] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  // 작성 중인 내용을 브라우저에 남겨 둔다. 캠페인 등록은 제품 이미지를 찾거나 예산을
  // 확인하러 자리를 뜨는 일이 흔하고, 그때 탭을 닫으면 처음부터 다시 적어야 했다.
  // 수정 모드에서는 쓰지 않는다 — 서버에 있는 값이 기준이어야 한다.
  const draftKey = `picks_campaign_draft_${businessUsername.replace(/^biz\//, '').toLowerCase()}`;

  const initialForm = {
    type: editing?.type || 'ad_collab',
    brand_name: editing?.brand_name || companyName,
    product_name: editing?.product_name || '',
    thumbnail_url: editing?.thumbnail_url || '',
    category: editing?.category || '',
    product_url: editing?.product_url || '',
    description: editing?.description || '',
    product_provide: editing?.product_provide || 'provide',

    package_tier: (editing?.package_tier || 'full') as PackageTier,
    upload_channel: editing?.upload_channel || '인스타그램',
    budget_krw: formatNumberWithCommas(digitsOnly(editing?.budget_krw || '')),
    seeding_count: String(editing?.seeding_count || ''),
    upload_from: editing?.upload_from || '',
    upload_to: editing?.upload_to || '',
    fast_track: Boolean(editing?.fast_track),
    video_concept: editing?.video_concept || '',

    influencer_gender: editing?.influencer_gender || 'any',
    influencer_ages: splitCsv(editing?.influencer_ages),
    sns_category: editing?.sns_category || '',
    ad_objective: editing?.ad_objective || 'awareness',
    follower_tiers: splitCsv(editing?.follower_tiers),
    min_views: formatNumberWithCommas(digitsOnly(editing?.min_views || '')),
    target_audience: editing?.target_audience || '',
    influencer_styles: splitCsv(editing?.influencer_styles),
    exclude_keywords: splitCsv(editing?.exclude_keywords),
  };

  const [form, setForm] = useState<typeof initialForm>(() => {
    if (editing) return initialForm;
    try {
      const raw = localStorage.getItem(draftKey);
      // 저장된 초안은 예전 버전의 폼일 수 있다. 빠진 항목은 initialForm 값으로 채운다.
      if (raw) return { ...initialForm, ...(JSON.parse(raw) as Partial<typeof initialForm>) };
    } catch { /* 저장된 내용이 깨졌으면 빈 폼으로 시작한다. */ }
    return initialForm;
  });

  useEffect(() => {
    if (editing) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(form));
      setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch { /* 용량이 찼으면 자동 저장만 포기한다. 작성은 계속할 수 있어야 한다. */ }
  }, [form, editing, draftKey]);

  const patch = (key: keyof typeof form, value: any) => setForm(p => ({ ...p, [key]: value }));

  /** 칩·체크박스처럼 여러 개를 고르는 항목. 이미 있으면 뺀다. */
  const toggle = (key: 'influencer_ages' | 'follower_tiers' | 'influencer_styles' | 'exclude_keywords', value: string) =>
    setForm(p => {
      const list = p[key] as string[];
      return { ...p, [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] };
    });

  // ------------------------------------------------------------------ 파생값
  const pkg = packageOf(form.package_tier);
  const isSeeding = form.package_tier === 'seeding';
  const budgetKrw = Number(digitsOnly(form.budget_krw) || 0);
  const seedingCount = Number(digitsOnly(form.seeding_count) || 0);
  const budget = totalBudget(form.package_tier, budgetKrw, seedingCount);
  const headcount = derivedHeadcount(form.package_tier, budgetKrw, seedingCount);

  // ------------------------------------------------------------------ 이미지
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

  // ------------------------------------------------------------------ 작성 상태
  /**
   * 사이드바가 보여 주는 항목별 상태.
   *
   * 필수 항목이 어디에 남았는지 항목 단위로 보이지 않으면, 브랜드는 "다음"을 누른
   * 뒤에야 무엇이 비었는지 알게 된다. 단계 안에서 미리 보이도록 목록으로 만든다.
   */
  const fieldStates = useMemo<FieldState[][]>(() => [
    [
      { label: '브랜드명', done: !!form.brand_name.trim(), required: true },
      { label: '제품명', done: !!form.product_name.trim(), required: true },
      { label: '제품 대표 이미지', done: !!form.thumbnail_url, required: false },
      { label: '제품 카테고리', done: !!form.category, required: true },
      { label: '제품 URL', done: !!form.product_url.trim(), required: false },
      { label: '제품 소개', done: !!form.description.trim(), required: true },
      { label: '제품 제공 방식', done: !!form.product_provide, required: true },
    ],
    [
      { label: '패키지', done: !!form.package_tier, required: true },
      { label: '업로드 채널', done: !!form.upload_channel, required: true },
      {
        label: isSeeding ? '광고 집행 건수' : '광고 집행 예산',
        done: isSeeding ? seedingCount > 0 : budgetKrw >= pkg.minBudget,
        required: true,
      },
      { label: '희망 업로드 일정', done: !!form.upload_from, required: true },
      { label: '영상 컨셉', done: !!form.video_concept.trim(), required: true },
    ],
    [
      { label: '성별', done: !!form.influencer_gender, required: true },
      { label: '연령', done: form.influencer_ages.length > 0, required: true },
      { label: 'SNS 채널 카테고리', done: !!form.sns_category, required: true },
      { label: '광고 목적', done: !!form.ad_objective, required: true },
      { label: '채널 규모', done: form.follower_tiers.length > 0, required: false },
      { label: '희망 최소 조회수', done: Number(digitsOnly(form.min_views) || 0) > 0, required: false },
      { label: '타겟 오디언스', done: !!form.target_audience.trim(), required: false },
      { label: '인플루언서 스타일', done: form.influencer_styles.length > 0, required: false },
      { label: '제외 조건', done: form.exclude_keywords.length > 0, required: false },
    ],
  ], [form, isSeeding, seedingCount, budgetKrw, pkg.minBudget]);

  /** 그 단계에서 반드시 있어야 하는 것. 없으면 다음으로 넘기지 않는다. */
  const stepError = (index: number): string => {
    if (index === 0) {
      if (!form.brand_name.trim()) return '브랜드명을 입력해 주세요.';
      if (!form.product_name.trim()) return '제품명을 입력해 주세요.';
      if (!form.category) return '제품 카테고리를 선택해 주세요.';
      if (!form.description.trim()) return '제품 소개를 입력해 주세요. 인플루언서가 가장 먼저 읽는 내용입니다.';
      return '';
    }
    if (index === 1) {
      if (isSeeding) {
        if (seedingCount < 1) return '광고 집행 건수를 입력해 주세요.';
        if (budget < pkg.minBudget) {
          return `유가 시딩은 ${formatKoreanWon(pkg.minBudget)}(${pkg.minBudget / pkg.unitPrice}건)부터 진행할 수 있습니다.`;
        }
      } else if (budgetKrw < pkg.minBudget) {
        return `${pkg.name}는 ${formatKoreanWon(pkg.minBudget)}부터 진행할 수 있습니다.`;
      }
      if (!form.upload_from) return '희망 업로드 시작일을 선택해 주세요.';
      if (form.upload_from && form.upload_to && form.upload_from > form.upload_to) {
        return '희망 업로드 일정의 시작일이 종료일보다 늦습니다.';
      }
      if (!form.video_concept.trim()) return '원하는 영상 컨셉을 적어 주세요.';
      return '';
    }
    if (index === 2) {
      if (form.influencer_ages.length === 0) return '희망 연령대를 한 개 이상 선택해 주세요.';
      if (!form.sns_category) return 'SNS 채널 카테고리를 선택해 주세요.';
      return '';
    }
    return '';
  };

  const goNext = () => {
    const err = stepError(step);
    if (err) { onNotify(err, 'error'); return; }
    if (step === STEPS.length - 1) { submit(); return; }
    setStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goTo = (index: number) => {
    // 뒤로는 자유롭게, 앞으로는 지금 단계를 통과해야 한다.
    if (index <= step) { setStep(index); return; }
    const err = stepError(step);
    if (err) { onNotify(err, 'error'); return; }
    setStep(index);
  };

  // ------------------------------------------------------------------ 제출
  const submit = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      const err = stepError(i);
      if (err) { setStep(i); onNotify(err, 'error'); return; }
    }

    setSubmitting(true);
    try {
      const requirements = derivedRequirements({
        gender: form.influencer_gender,
        ages: form.influencer_ages,
        snsCategory: form.sns_category,
        followerTiers: form.follower_tiers,
        minViews: Number(digitsOnly(form.min_views) || 0),
        styles: form.influencer_styles,
        excludes: form.exclude_keywords,
      });

      const payload = {
        type: form.type,
        // 물어보지 않고 만드는 값들. 예전에는 브랜드가 직접 적었다.
        title: derivedTitle(form.product_name, form.brand_name),
        description: form.description,
        brand_name: form.brand_name,
        thumbnail_url: form.thumbnail_url,
        category: form.category,
        reward_type: 'fixed',
        reward_amount: String(pkg.unitPrice),
        requirements,
        max_applicants: headcount,
        // 모집은 등록 즉시 시작하고, 희망 업로드 시작일까지 받는다.
        start_date: todayInSeoul(),
        end_date: form.upload_from || '',
        content_format: 'shortform',
        second_use_fee: 0,
        second_use_note: pkg.secondUseNote,

        product_name: form.product_name,
        product_url: form.product_url,
        upload_channel: form.upload_channel,
        video_concept: form.video_concept,
        upload_from: form.upload_from,
        upload_to: form.upload_to,

        package_tier: form.package_tier,
        product_provide: form.product_provide,
        ad_objective: form.ad_objective,
        budget_krw: budget,
        seeding_count: seedingCount,
        fast_track: form.fast_track,
        influencer_gender: form.influencer_gender,
        influencer_ages: form.influencer_ages,
        sns_category: form.sns_category,
        follower_tiers: form.follower_tiers,
        min_views: Number(digitsOnly(form.min_views) || 0),
        influencer_styles: form.influencer_styles,
        exclude_keywords: form.exclude_keywords,
        target_audience: form.target_audience,
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
      if (!editing) {
        try { localStorage.removeItem(draftKey); } catch { /* 지우지 못해도 등록은 끝났다. */ }
      }
      onNotify(
        editing
          ? '캠페인이 수정되었습니다.'
          : '캠페인이 등록되었습니다. 담당자가 조건에 맞는 인플루언서를 찾아 리스트업해 드립니다.',
      );
      onSaved();
    } catch {
      onNotify('서버 오류가 발생했습니다.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ------------------------------------------------------------------ 렌더 조각
  const chip = (active: boolean) =>
    `px-3 py-2 rounded-xl text-xs font-black border transition-colors ${
      active
        ? 'bg-slate-900 text-white border-slate-900'
        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
    }`;

  const TIPS = [
    {
      title: '제품 소개는 왜 필요할까요?',
      body: '인플루언서가 지원 여부를 정할 때 가장 먼저 읽는 내용입니다. 제품의 특징과 꼭 강조하고 싶은 점을 두세 줄로 적어 주세요.',
    },
    {
      title: '예산은 어떻게 정할까요?',
      body: `${pkg.name}는 1인 ${formatKoreanWon(pkg.unitPrice)}${pkg.priceNote === '부터~' ? '부터' : ''} 기준입니다. 예산을 적으면 모집 인원이 자동으로 계산됩니다.`,
    },
    {
      title: '조건은 좁을수록 좋을까요?',
      body: '너무 좁히면 후보가 줄어듭니다. 꼭 필요한 조건만 남기고, 나머지는 담당자가 제안하는 후보를 보며 조율하세요.',
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      {cropperSrc && (
        <ImageCropper src={cropperSrc} onCrop={handleCropConfirm} onCancel={handleCropCancel} aspectRatio={1} />
      )}

      {/* ------------------------------------------------------------ 본문 */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 md:px-7 pt-6 pb-4 border-b border-slate-100">
          <h2 className="text-xl font-black text-slate-900">
            {editing ? '캠페인 수정' : '캠페인 등록'}
          </h2>
          <p className="text-xs text-slate-400 font-medium mt-1">
            세 단계만 채우면 담당자가 이어서 진행합니다. 제목·모집 인원·1인 단가는 자동으로 정해집니다.
          </p>

          <div className="flex items-center gap-1 mt-5 overflow-x-auto">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.key}>
                <button type="button" onClick={() => goTo(i)} className="flex items-center gap-2 flex-shrink-0 group">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-colors ${
                      i === step ? 'bg-slate-900 text-white' : i < step ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {i < step ? '✓' : i + 1}
                  </span>
                  <span className={`text-[11px] font-black whitespace-nowrap ${i === step ? 'text-slate-900' : 'text-slate-400 group-hover:text-slate-600'}`}>
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && <span className="flex-1 h-px bg-slate-200 min-w-[16px]" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="px-5 md:px-7 py-6 space-y-5">
          {/* ---------------------------------------------- ① 제품 정보 */}
          {step === 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>브랜드명 *</label>
                  <input
                    type="text"
                    value={form.brand_name}
                    onChange={e => patch('brand_name', e.target.value)}
                    className={INPUT}
                    placeholder="픽스폴리오"
                  />
                </div>
                <div>
                  <label className={LABEL}>제품명 *</label>
                  <input
                    type="text"
                    value={form.product_name}
                    onChange={e => patch('product_name', e.target.value)}
                    className={INPUT}
                    placeholder="수분 진정 크림 50ml"
                  />
                </div>
              </div>

              <div>
                <label className={LABEL}>제품 대표 이미지</label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {thumbnailPreview ? (
                      <img src={thumbnailPreview} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-black text-slate-300">이미지</span>
                    )}
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                      className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black disabled:opacity-50"
                    >
                      {uploadingImage ? '업로드 중...' : thumbnailPreview ? '이미지 변경' : '이미지 선택'}
                    </button>
                    <p className="text-[11px] text-slate-400 font-medium mt-1.5">JPG · PNG · 5MB 이하</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>제품 카테고리 *</label>
                  <select value={form.category} onChange={e => patch('category', e.target.value)} className={INPUT}>
                    {categories.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>제품 URL</label>
                  <input
                    type="url"
                    value={form.product_url}
                    onChange={e => patch('product_url', e.target.value)}
                    className={INPUT}
                    placeholder="https://"
                  />
                </div>
              </div>

              <div>
                <label className={LABEL}>제품 소개 *</label>
                <textarea
                  value={form.description}
                  onChange={e => patch('description', e.target.value)}
                  rows={5}
                  maxLength={1000}
                  className={INPUT}
                  placeholder="제품의 특징과 꼭 강조하고 싶은 점을 적어 주세요."
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1 text-right">
                  {form.description.length}/1,000
                </p>
              </div>

              <div>
                <label className={LABEL}>제품 제공 방식 *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PRODUCT_PROVIDE.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => patch('product_provide', p.value)}
                      className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                        form.product_provide === p.value
                          ? 'border-slate-900 bg-slate-50'
                          : 'border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`w-4 h-4 rounded-full border-[5px] flex-shrink-0 ${
                            form.product_provide === p.value ? 'border-slate-900' : 'border-slate-200'
                          }`}
                        />
                        <span className="text-sm font-black text-slate-900">{p.label}</span>
                      </span>
                      <span className="block text-[11px] text-slate-400 font-medium mt-1 pl-6">{p.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ---------------------------------------------- ② 캠페인 설정 */}
          {step === 1 && (
            <>
              <div>
                <label className={LABEL}>패키지 *</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {PACKAGES.map(p => {
                    const active = form.package_tier === p.tier;
                    return (
                      <button
                        key={p.tier}
                        type="button"
                        onClick={() => patch('package_tier', p.tier)}
                        className={`text-left p-4 rounded-2xl border-2 transition-colors ${
                          active ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <span className="inline-block px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-black">
                          {p.badge}
                        </span>
                        <p className="text-sm font-black text-slate-900 mt-2">{p.name}</p>
                        <p className="text-[11px] text-slate-500 font-medium mt-1 leading-relaxed">
                          {p.lines[0]}<br />{p.lines[1]}
                        </p>
                        <p className="text-base font-black text-slate-900 mt-3">
                          {formatKoreanWon(p.unitPrice)}
                          <span className="text-[11px] font-bold text-slate-400 ml-1">{p.priceNote}</span>
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold mt-1">{p.usageNote}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 포함/제외 단계. 협업 화면에 실제로 생기는 단계와 짝을 맞춰 둔다. */}
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-[11px] font-black text-slate-700 mb-3">
                  {pkg.name} 진행 단계
                </p>
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {pkg.stages.map((s, i) => (
                    <React.Fragment key={s.label}>
                      <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-[76px]">
                        <span
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black ${
                            s.included ? 'bg-slate-900 text-white' : 'bg-white text-slate-300 border border-slate-200'
                          }`}
                        >
                          {s.included ? '✓' : '—'}
                        </span>
                        <span className={`text-[10px] font-black text-center leading-tight ${s.included ? 'text-slate-700' : 'text-slate-300'}`}>
                          {s.label}
                        </span>
                      </div>
                      {i < pkg.stages.length - 1 && <span className="w-4 h-px bg-slate-200 flex-shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 font-medium mt-2">
                  {pkg.secondUseNote} · 제외된 단계는 협업에도 생기지 않습니다.
                </p>
              </div>

              <div>
                <label className={LABEL}>업로드 채널 *</label>
                <div className="flex gap-2">
                  {CHANNELS.map(c => (
                    <button key={c} type="button" onClick={() => patch('upload_channel', c)} className={chip(form.upload_channel === c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {isSeeding ? (
                <div>
                  <label className={LABEL}>광고 집행 건수 *</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.seeding_count}
                      onChange={e => patch('seeding_count', digitsOnly(e.target.value))}
                      className={`${INPUT} max-w-[160px]`}
                      placeholder="10"
                    />
                    <span className="text-sm font-black text-slate-500">건</span>
                  </div>
                  <p className="text-xs font-black text-slate-900 mt-2">
                    {formatKoreanWon(pkg.unitPrice)} × {seedingCount || 0}건 = {formatKoreanWon(budget)}
                  </p>
                  <p className="text-[11px] text-slate-400 font-medium mt-1">
                    최소 {formatKoreanWon(pkg.minBudget)}({pkg.minBudget / pkg.unitPrice}건)부터 진행할 수 있습니다.
                  </p>
                </div>
              ) : (
                <div>
                  <label className={LABEL}>광고 집행 예산 *</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.budget_krw}
                      onChange={e => patch('budget_krw', formatNumberWithCommas(digitsOnly(e.target.value)))}
                      className={`${INPUT} max-w-[220px]`}
                      placeholder={String(pkg.minBudget)}
                    />
                    <span className="text-sm font-black text-slate-500">원</span>
                  </div>
                  <p className="text-xs font-black text-slate-900 mt-2">
                    {formatKoreanWon(budget)} ÷ 1인 {formatKoreanWon(pkg.unitPrice)} = 약 {headcount}명 모집
                  </p>
                  <p className="text-[11px] text-slate-400 font-medium mt-1">
                    최소 {formatKoreanWon(pkg.minBudget)}부터 진행할 수 있습니다. 인원은 담당자와 조율할 수 있습니다.
                  </p>
                </div>
              )}

              <div>
                <label className={LABEL}>희망 업로드 일정 *</label>
                <div className="flex items-center gap-2">
                  <input type="date" value={form.upload_from} onChange={e => patch('upload_from', e.target.value)} className={INPUT} />
                  <span className="text-xs font-black text-slate-400">~</span>
                  <input type="date" value={form.upload_to} onChange={e => patch('upload_to', e.target.value)} className={INPUT} />
                </div>
              </div>

              <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 cursor-pointer hover:border-slate-400 transition-colors">
                <input
                  type="checkbox"
                  checked={form.fast_track}
                  onChange={e => patch('fast_track', e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-slate-900"
                />
                <span>
                  <span className="block text-sm font-black text-slate-900">패스트 트랙</span>
                  <span className="block text-[11px] text-slate-400 font-medium mt-0.5">
                    일정이 급합니다. 담당자가 섭외와 검수를 최우선으로 진행합니다.
                  </span>
                </span>
              </label>

              <div>
                <label className={LABEL}>영상 컨셉 *</label>
                <textarea
                  value={form.video_concept}
                  onChange={e => patch('video_concept', e.target.value)}
                  rows={4}
                  maxLength={500}
                  className={INPUT}
                  placeholder="예) 아침 세안 후 바르는 장면으로 시작해, 발림성과 흡수력을 클로즈업으로 보여 주세요."
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1 text-right">
                  {form.video_concept.length}/500
                </p>
              </div>
            </>
          )}

          {/* ---------------------------------------------- ③ 희망 인플루언서 */}
          {step === 2 && (
            <>
              <div>
                <label className={LABEL}>성별 *</label>
                <div className="flex gap-2">
                  {GENDERS.map(g => (
                    <button key={g.value} type="button" onClick={() => patch('influencer_gender', g.value)} className={chip(form.influencer_gender === g.value)}>
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={LABEL}>연령 * <span className="text-slate-400 font-bold">(복수 선택)</span></label>
                <div className="flex flex-wrap gap-2">
                  {AGE_BANDS.map(a => (
                    <button key={a} type="button" onClick={() => toggle('influencer_ages', a)} className={chip(form.influencer_ages.includes(a))}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={LABEL}>SNS 채널 카테고리 *</label>
                <select value={form.sns_category} onChange={e => patch('sns_category', e.target.value)} className={INPUT}>
                  {categories.map(c => (
                    <option key={c.value} value={c.label === '카테고리 선택' ? '' : c.label}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={LABEL}>광고 목적 *</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {AD_OBJECTIVES.map(o => {
                    const active = form.ad_objective === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => patch('ad_objective', o.value)}
                        className={`text-left p-4 rounded-2xl border-2 transition-colors ${
                          active ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <span className="text-lg">{o.icon}</span>
                        <p className="text-sm font-black text-slate-900 mt-1">{o.label}</p>
                        <p className="text-[11px] text-slate-500 font-medium mt-1 leading-relaxed">
                          {o.lines[0]}<br />{o.lines[1]}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] font-bold text-blue-600 bg-blue-50 rounded-xl px-3 py-2 mt-2">
                  💡 {AD_OBJECTIVES.find(o => o.value === form.ad_objective)?.tip}
                </p>
              </div>

              {/* 상세 조건은 접어 둔다. 필수가 아니고, 처음 올리는 브랜드에게는
                  선택지가 많은 것 자체가 등록을 멈추게 하는 이유가 된다. */}
              <button
                type="button"
                onClick={() => setShowDetail(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 text-xs font-black text-slate-600 hover:border-slate-400 transition-colors"
              >
                <span>상세 조건 {showDetail ? '접기' : '더 지정하기'} <span className="text-slate-400 font-bold">(선택)</span></span>
                <span className="text-slate-400">{showDetail ? '▲' : '▼'}</span>
              </button>

              {showDetail && (
                <div className="space-y-5 pt-1">
                  <div>
                    <label className={LABEL}>채널 규모 (팔로워)</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {FOLLOWER_TIERS.map(t => {
                        const active = form.follower_tiers.includes(t.value);
                        return (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => toggle('follower_tiers', t.value)}
                            className={`text-left p-3 rounded-xl border-2 transition-colors ${
                              active ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300'
                            }`}
                          >
                            <span className="inline-block px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-black">
                              {t.badge}
                            </span>
                            <p className="text-xs font-black text-slate-900 mt-1.5">{t.label}</p>
                            <p className="text-[10px] text-slate-400 font-bold">{t.range}</p>
                            <p className="text-[10px] text-slate-400 font-medium mt-1">{t.unit}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className={LABEL}>희망 최소 조회수</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={form.min_views}
                        onChange={e => patch('min_views', formatNumberWithCommas(digitsOnly(e.target.value)))}
                        className={`${INPUT} max-w-[200px]`}
                        placeholder="10,000"
                      />
                      <span className="text-sm font-black text-slate-500">회 이상</span>
                    </div>
                  </div>

                  <div>
                    <label className={LABEL}>타겟 오디언스</label>
                    <input
                      type="text"
                      value={form.target_audience}
                      onChange={e => patch('target_audience', e.target.value)}
                      className={INPUT}
                      placeholder="예) 민감성 피부로 고민하는 20대 후반 직장인"
                    />
                    <p className="text-[11px] text-slate-400 font-medium mt-1">
                      제품을 쓸 사람을 적어 주세요. 인플루언서 조건과 함께 담당자에게 전달됩니다.
                    </p>
                  </div>

                  <div>
                    <label className={LABEL}>인플루언서 스타일</label>
                    <div className="flex flex-wrap gap-2">
                      {INFLUENCER_STYLES.map(s => (
                        <button key={s} type="button" onClick={() => toggle('influencer_styles', s)} className={chip(form.influencer_styles.includes(s))}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={LABEL}>제외하고 싶은 인플루언서</label>
                    <div className="flex flex-wrap gap-2">
                      {EXCLUDE_KEYWORDS.map(s => (
                        <button key={s} type="button" onClick={() => toggle('exclude_keywords', s)} className={chip(form.exclude_keywords.includes(s))}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 md:px-7 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => (step === 0 ? onCancel() : setStep(s => s - 1))}
            className="px-4 py-2.5 rounded-xl text-xs font-black text-slate-500 hover:bg-slate-100 transition-colors"
          >
            {step === 0 ? '취소' : '이전으로'}
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={submitting}
            className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {submitting
              ? '저장 중...'
              : step === STEPS.length - 1
                ? (editing ? '수정 완료' : '캠페인 생성 완료')
                : '다음 →'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ 사이드바 */}
      <aside className="lg:sticky lg:top-6 space-y-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-900">{STEPS[step].label}</p>
            <span className="text-[10px] font-black text-slate-400">{step + 1} / {STEPS.length}</span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium mt-0.5">{STEPS[step].hint}</p>

          <div className="mt-4 space-y-1.5">
            {fieldStates[step].map(f => (
              <div key={f.label} className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-500 truncate">
                  {f.label}
                  {f.required && <span className="text-rose-400 ml-0.5">*</span>}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black flex-shrink-0 ${
                    f.done
                      ? 'bg-emerald-50 text-emerald-600'
                      : f.required
                        ? 'bg-rose-50 text-rose-500'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {f.done ? '완료' : '미입력'}
                </span>
              </div>
            ))}
          </div>

          {!editing && savedAt && (
            <p className="text-[10px] font-black text-emerald-600 mt-4">✓ 자동 저장됨 · {savedAt}</p>
          )}
        </div>

        {/* 지금까지 고른 것으로 정해진 조건. 예산을 적으면 인원이 바로 바뀐다. */}
        {step >= 1 && (
          <div className="bg-slate-900 rounded-2xl p-5 text-white">
            <p className="text-[11px] font-black text-white/60">현재 설정</p>
            <p className="text-sm font-black mt-2">{pkg.name}</p>
            <div className="mt-3 space-y-1.5 text-[11px] font-bold">
              <div className="flex items-center justify-between">
                <span className="text-white/50">1인 단가</span>
                <span>{formatKoreanWon(pkg.unitPrice)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50">{isSeeding ? '집행 건수' : '모집 인원'}</span>
                <span>{headcount}명</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50">총 예산</span>
                <span>{formatKoreanWon(budget)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50">채널</span>
                <span>{form.upload_channel}</span>
              </div>
              {form.upload_from && (
                <div className="flex items-center justify-between">
                  <span className="text-white/50">업로드</span>
                  <span>{form.upload_from}{form.upload_to ? ` ~ ${form.upload_to}` : ''}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 후보 수를 숫자로 약속하지 않는다. 리스트업은 담당자가 캠페인을 확인한 뒤
            만들고, 조건에 맞는 사람이 몇 명인지는 그때 정해진다. 등록 화면에서
            "약 N명"을 보여 주면 지키지 못할 약속이 된다. */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-xs font-black text-slate-900">매칭 가능 인플루언서</p>
            <p className="text-[11px] text-slate-500 font-medium mt-2 leading-relaxed">
              등록하시면 담당자가 아래 조건으로 후보를 찾아 리스트업해 드립니다.
              보시고 마음에 드는 후보만 남기면 됩니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                GENDERS.find(g => g.value === form.influencer_gender)?.label,
                ...form.influencer_ages,
                form.sns_category,
                ...form.follower_tiers.map(t => FOLLOWER_TIERS.find(f => f.value === t)?.label),
                ...form.influencer_styles,
              ]
                .filter(Boolean)
                .map((label, i) => (
                  <span key={`${label}-${i}`} className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black">
                    {label}
                  </span>
                ))}
            </div>
          </div>
        )}

        <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
          <p className="text-[11px] font-black text-amber-700">작성 Tip</p>
          <p className="text-xs font-black text-amber-900 mt-2">{TIPS[step].title}</p>
          <p className="text-[11px] text-amber-700 font-medium mt-1.5 leading-relaxed">{TIPS[step].body}</p>
        </div>
      </aside>
    </div>
  );
};

export default CampaignRegisterWizard;
