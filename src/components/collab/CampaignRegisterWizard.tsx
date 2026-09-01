import React, { useState, useRef, useEffect, useMemo } from 'react';
import { formatNumberWithCommas, formatKoreanWon, digitsOnly, todayInSeoul, formatPhoneInput } from '../../utils/formatters';
import { authHeaders } from '../../services/apiService';
import ImageCropper from '../ImageCropper';
import DateRangeCalendar from './DateRangeCalendar';
import {
  REWARD_MODES, rewardModeOf, normalizeRewardMode, COMMISSION_RANGE,
  TIERS, tierFeeLabel, stageMarksFor,
  PRODUCT_PROVIDE, AD_OBJECTIVES, CHANNELS, CONTENT_FORMATS, GENDERS, AGE_BANDS,
  INFLUENCER_STYLES, EXCLUDE_KEYWORDS,
  parseTierCounts, serializeTierCounts, chosenTiers, totalHeadcount,
  allocatedFloor, allocatedCeiling, remainingBudget, canAddOne, affordableCount,
  derivedTitle, derivedRequirements, derivedUnitFee, contentFormatLabel,
  type TierCounts, type TierKey,
} from '../../utils/campaignBrief';

/**
 * 캠페인 등록.
 *
 * 묻는 것은 세 가지다.
 *   ① 제품 정보  — 무엇을 알릴 것인가
 *   ② 캠페인 설정 — 어떻게 진행하고, 얼마를 쓰고, 언제 올릴 것인가
 *   ③ 희망 인플루언서 — 누가 몇 명 올리면 좋겠는가
 *
 * ③ 은 진행 방식에 따라 아예 없어진다. 제품 협찬형·공동구매는 캠페인 협업 목록에
 * 걸어 두고 지원을 받는 방식이라, 브랜드가 규모(나노·매크로…)나 성별을 미리 못 박을 수
 * 없다. 지원자가 누구일지 모르는 상태에서 정한 구성은 지킬 수 없는 약속이고, 그 조건을
 * 목록에 걸어 두면 해당하지 않는 인플루언서는 아예 지원하지 않는다. 그래서 그 방식에서는
 * 인원(협찬 인원 / 모집 인원)만 받고 단계를 하나 줄인다 — 광고 목적도 담당자 리스트업에
 * 쓰는 값이라 같이 뺀다.
 *
 * 예전에는 여기에 패키지가 있었다. 브랜드가 패키지를 고르면 1인 단가가 정해지고,
 * 모집 인원은 예산 ÷ 단가로 계산됐다. 그런데 그 나눗셈이 실제 섭외와 맞지 않았다.
 * 예산 5,000만원을 시딩 단가로 나누면 500명이 나오는데, 브랜드가 실제로 원하는 것은
 * "메가 한 명을 중심에 두고 마이크로를 여러 명" 같은 구성이었다.
 *
 * 그래서 패키지를 없애고 두 가지를 직접 받는다. 예산과 규모별 인원이다. 인원을 계산해
 * 주는 대신, 각 규모의 최소 단가로 배분액을 계산해 예산을 넘기지 못하게 막는다. 브랜드는
 * 남은 예산을 보면서 구성을 직접 굴려 볼 수 있고, 나온 구성은 정의상 예산 안에 있다.
 *
 * 진행 방식은 세 갈래다. 광고비 지급형은 구성안·콘텐츠 검수를 거치고 정산이 붙는다.
 * 제품 협찬형은 광고비 없이 제품만 제공하므로 검수와 정산 단계가 없다. 공동구매는
 * 판매 콘텐츠라 검수를 거치고 수수료 정산이 붙는다 — 진행 단계 표시는 stageMarksFor()
 * 한 곳에서 만들고, 협업에 실제로 생기는 단계와 짝을 맞춰 둔다.
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
  reward_mode?: string;
  tier_counts?: string;
  product_provide?: string;
  ad_objective?: string;
  budget_krw?: number;
  seeding_count?: number;
  groupbuy_commission_rate?: number | string;
  influencer_gender?: string;
  influencer_ages?: string;
  sns_category?: string;
  follower_tiers?: string;
  min_views?: number;
  influencer_styles?: string;
  exclude_keywords?: string;
  target_audience?: string;
  contact_person?: string;
  contact_phone?: string;
  contact_email?: string;
}

interface CampaignRegisterWizardProps {
  businessUsername: string;
  companyName: string;
  /** 수정 모드면 기존 캠페인. 새로 만들면 null. */
  editing: CampaignBriefDraft | null;
  /**
   * 지난 캠페인에 적어 둔 담당자. 새 캠페인의 담당자 칸을 미리 채우지는 않고,
   * "지난 캠페인과 같은 담당자" 버튼으로만 쓴다 — 자동으로 채워 두면 담당이
   * 바뀐 캠페인에도 예전 사람의 번호가 그대로 저장된다.
   */
  lastContact?: { person: string; phone: string; email: string } | null;
  categories: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onSaved: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

/**
 * 단계 목록.
 *
 * '희망 인플루언서'는 광고비 지급형에서만 쓴다. 지원을 받아 고르는 방식에서는 물을
 * 것이 없어서 빈 단계가 되고, 빈 단계를 남겨 두면 브랜드는 "여기서 뭘 골라야 하지"에서
 * 멈춘다. 그래서 아래 목록을 진행 방식으로 걸러 쓴다 — 단계 번호가 아니라 key 로
 * 검사하는 이유도 이것이다. 걸러낸 뒤에는 인덱스가 뜻하는 단계가 달라진다.
 */
const ALL_STEPS = [
  { key: 'product', label: '제품 정보', hint: '무엇을 알릴까요' },
  { key: 'campaign', label: '캠페인 설정', hint: '어떻게 진행할까요' },
  { key: 'influencer', label: '희망 인플루언서', hint: '누가 몇 명 올릴까요' },
];

const INPUT =
  'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';
const LABEL = 'block text-xs font-black text-slate-700 mb-1.5';

/** 화면에 쉼표를 넣어 보여 주고, 서버에는 숫자만 보낸다(digitsOnly 는 공용 서식에서 온다). */

/** 쉼표로 이어 저장된 값 ↔ 배열. 수정 모드에서 기존 캠페인을 되읽을 때 쓴다. */
const splitCsv = (raw: unknown): string[] =>
  String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * 수정 모드에서 규모별 인원을 되읽는다.
 *
 * 규모별 인원이 생기기 전에 등록된 캠페인은 tier_counts 가 비어 있고 follower_tiers
 * 에 고른 구간만 남아 있다. 그 구간들을 인원 0 으로 골라 둔 상태로 살려 둔다 —
 * 그러지 않으면 수정 화면에서 브랜드가 예전에 고른 조건이 통째로 사라진 것처럼 보인다.
 */
const initialTierCounts = (editing: CampaignBriefDraft | null): TierCounts => {
  const parsed = parseTierCounts(editing?.tier_counts);
  if (Object.keys(parsed).length > 0) return parsed;
  const legacy: TierCounts = {};
  splitCsv(editing?.follower_tiers).forEach(key => {
    if (TIERS.some(t => t.key === key)) legacy[key as TierKey] = 0;
  });
  return legacy;
};

/** 단계별 작성 상태. 사이드바에서 완료/미입력으로 보여 준다. */
type FieldState = { label: string; done: boolean; required: boolean };

const CampaignRegisterWizard: React.FC<CampaignRegisterWizardProps> = ({
  businessUsername,
  companyName,
  editing,
  lastContact,
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
  const [savedAt, setSavedAt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  // 작성 중인 내용을 브라우저에 남겨 둔다. 캠페인 등록은 제품 이미지를 찾거나 예산을
  // 확인하러 자리를 뜨는 일이 흔하고, 그때 탭을 닫으면 처음부터 다시 적어야 했다.
  // 수정 모드에서는 쓰지 않는다 — 서버에 있는 값이 기준이어야 한다.
  const draftKey = `picks_campaign_draft_${businessUsername.replace(/^biz\//, '').toLowerCase()}`;

  const initialForm = {
    brand_name: editing?.brand_name || companyName,
    product_name: editing?.product_name || '',
    thumbnail_url: editing?.thumbnail_url || '',
    category: editing?.category || '',
    product_url: editing?.product_url || '',
    description: editing?.description || '',
    product_provide: editing?.product_provide || 'provide',

    // 캠페인마다 받는 담당자. 계정 가입자와 다를 수 있어(대행사, 담당 교체) 캠페인
    // 행에 따로 남긴다 — 픽스폴리오 담당자가 이 캠페인 건으로 연락할 상대다.
    contact_person: editing?.contact_person || '',
    contact_phone: formatPhoneInput(String(editing?.contact_phone || '')),
    contact_email: editing?.contact_email || '',

    reward_mode: normalizeRewardMode(editing?.reward_mode),
    upload_channel: editing?.upload_channel || CHANNELS[0],
    // 숏폼(릴스)인가 피드 게시물인가. 인플루언서의 지급 단가가 이 값으로 갈린다.
    content_format: editing?.content_format || CONTENT_FORMATS[0].value,
    budget_krw: formatNumberWithCommas(digitsOnly(editing?.budget_krw || '')),
    // 지원을 받아 고르는 방식의 인원. 제품 협찬형은 협찬 인원, 공동구매는 모집 인원이고
    // 세는 대상은 둘 다 사람이다 — 예전에는 제품 수(개)를 받았는데, 한 사람에게 제품
    // 하나를 보내는 캠페인에서 같은 수를 두 가지 이름으로 부르고 있었다.
    apply_headcount: String(editing?.seeding_count || editing?.max_applicants || ''),
    commission_rate: digitsOnly(editing?.groupbuy_commission_rate || ''),
    upload_from: editing?.upload_from || '',
    upload_to: editing?.upload_to || '',
    video_concept: editing?.video_concept || '',

    influencer_gender: editing?.influencer_gender || 'any',
    influencer_ages: splitCsv(editing?.influencer_ages),
    sns_category: editing?.sns_category || '',
    ad_objective: editing?.ad_objective || 'awareness',
    tier_counts: initialTierCounts(editing),
    min_views: formatNumberWithCommas(digitsOnly(editing?.min_views || '')),
    target_audience: editing?.target_audience || '',
    influencer_styles: splitCsv(editing?.influencer_styles),
    exclude_keywords: splitCsv(editing?.exclude_keywords),
  };

  const [form, setForm] = useState<typeof initialForm>(initialForm);

  /**
   * 저장된 초안. 되살리지 않고, 되살릴지 물어본다.
   *
   * 예전에는 등록 화면을 열면 저장된 초안이 그대로 채워져 있었다. 자리를 뜬 사람에게는
   * 편했지만, 지난 캠페인을 올리고 나서 다음 캠페인을 등록하러 온 사람에게는 남의
   * 내용처럼 보이는 값이 이미 들어 있었고, 어디가 예전 값인지 몰라 한 칸씩 지워야 했다.
   * 그래서 기본은 빈 폼이고, 초안이 있으면 배너로 "이어서 작성"을 고를 수 있게 한다.
   *
   * 초안은 첫 렌더에서 읽어 상태로 들고 있는다. 아래 자동 저장 useEffect 가 마운트
   * 직후 빈 폼을 저장해 버리므로, 그 시점 이후에 localStorage 를 읽으면 이미 늦다.
   */
  const [savedDraft, setSavedDraft] = useState<Partial<typeof initialForm> | null>(() => {
    if (editing) return null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<typeof initialForm>;
      // 열었다 닫은 흔적까지 물어보면 배너가 잡음이 된다. 적기 시작한 초안만 묻는다.
      const written = !!String(parsed.product_name || '').trim() || !!String(parsed.description || '').trim();
      return written ? parsed : null;
    } catch {
      return null; // 저장된 내용이 깨졌으면 없는 것으로 본다.
    }
  });

  const restoreDraft = () => {
    if (!savedDraft) return;
    setForm(p => ({ ...p, ...savedDraft, reward_mode: normalizeRewardMode(savedDraft.reward_mode) }));
    setThumbnailPreview(savedDraft.thumbnail_url || '');
    setSavedDraft(null);
  };

  useEffect(() => {
    if (editing) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(form));
      setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch { /* 용량이 찼으면 자동 저장만 포기한다. 작성은 계속할 수 있어야 한다. */ }
  }, [form, editing, draftKey]);

  const patch = (key: keyof typeof form, value: any) => setForm(p => ({ ...p, [key]: value }));

  /** 칩·체크박스처럼 여러 개를 고르는 항목. 이미 있으면 뺀다. */
  const toggle = (key: 'influencer_ages' | 'influencer_styles' | 'exclude_keywords', value: string) =>
    setForm(p => {
      const list = p[key] as string[];
      return { ...p, [key]: list.includes(value) ? list.filter(v => v !== value) : [...list, value] };
    });

  // ------------------------------------------------------------------ 파생값
  const mode = rewardModeOf(form.reward_mode);
  const isBarter = form.reward_mode === 'barter';
  const isGroupBuy = form.reward_mode === 'groupbuy';
  // 규모별 배분을 브랜드가 직접 정하는 방식인지. 단계 구성과 필수 항목이 여기서 갈린다.
  const picksInfluencer = mode.pickInfluencer;
  const budgetKrw = Number(digitsOnly(form.budget_krw) || 0);
  const applyHeadcount = Number(digitsOnly(form.apply_headcount) || 0);
  const commissionRate = Number(digitsOnly(form.commission_rate) || 0);
  // 담당자 연락처는 보기 좋게 하이픈을 넣은 채로 들고 있고, 검사와 저장은 숫자로 한다.
  const contactPhoneDigits = digitsOnly(form.contact_phone);
  const counts = form.tier_counts;
  // 모집 인원은 방식에 따라 다른 곳에서 나온다 — 배분한 인원 합계이거나, 직접 받은 인원이다.
  const headcount = picksInfluencer ? totalHeadcount(counts) : applyHeadcount;
  const floorSum = allocatedFloor(counts);
  const ceilingSum = allocatedCeiling(counts);
  const leftover = remainingBudget(budgetKrw, counts);
  const cheapestFee = Math.min(...TIERS.map(t => t.minFee));
  const overBudget = picksInfluencer && budgetKrw > 0 && floorSum > budgetKrw;
  const badCommission =
    isGroupBuy &&
    (commissionRate < COMMISSION_RANGE.min || commissionRate > COMMISSION_RANGE.max);

  // 진행 방식이 단계를 정한다. 지원을 받아 고르는 방식은 '희망 인플루언서'가 없다.
  const steps = useMemo(
    () => (picksInfluencer ? ALL_STEPS : ALL_STEPS.filter(s => s.key !== 'influencer')),
    [picksInfluencer],
  );

  // 마지막 단계에서 진행 방식을 바꿔 단계가 줄어들면 지금 보고 있는 단계가 사라진다.
  useEffect(() => {
    setStep(s => Math.min(s, steps.length - 1));
  }, [steps.length]);

  // 지금 단계의 key. 위 useEffect 가 반영되기 전 한 번은 범위를 넘을 수 있어 기본값을 둔다.
  const stepKey = steps[step]?.key || steps[0].key;

  // ------------------------------------------------------------------ 규모별 인원
  // 규모별 배분은 광고비 지급형에서만 쓰므로 기준은 예산 하나다. canAddOne 의 수량
  // 인자는 지원을 받아 고르는 방식용이라 여기서는 0 을 넘긴다.
  /** 카드를 누르면 그 구간을 고르거나 뺀다. 처음 고를 때 한 명으로 시작한다. */
  const toggleTier = (key: TierKey) =>
    setForm(p => {
      const next: TierCounts = { ...p.tier_counts };
      if (next[key] !== undefined) {
        delete next[key];
        return { ...p, tier_counts: next };
      }
      const tier = TIERS.find(t => t.key === key)!;
      const seed = canAddOne(tier, p.reward_mode, Number(digitsOnly(p.budget_krw) || 0), 0, next) ? 1 : 0;
      next[key] = seed;
      return { ...p, tier_counts: next };
    });

  const bumpTier = (key: TierKey, delta: number) =>
    setForm(p => {
      const next: TierCounts = { ...p.tier_counts };
      const current = next[key] || 0;
      if (delta > 0) {
        const tier = TIERS.find(t => t.key === key)!;
        const budget = Number(digitsOnly(p.budget_krw) || 0);
        if (!canAddOne(tier, p.reward_mode, budget, 0, next)) return p;
      }
      next[key] = Math.max(0, current + delta);
      return { ...p, tier_counts: next };
    });

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
   * 숏폼 캠페인인가.
   *
   * 컨셉 칸의 이름이 여기서 갈린다. 피드 게시물 캠페인에서 "영상 컨셉"을 물으면
   * 브랜드는 찍지도 않을 영상의 흐름을 적게 된다 — 실제로 받아야 하는 것은 사진에
   * 담길 장면과 본문의 결이다. 저장하는 칸(video_concept)은 하나로 둔다.
   */
  const isShortformFormat = form.content_format !== 'feed';
  const conceptLabel = isShortformFormat ? '영상 컨셉' : '게시물 컨셉';

  /**
   * 사이드바가 보여 주는 항목별 상태.
   *
   * 필수 항목이 어디에 남았는지 항목 단위로 보이지 않으면, 브랜드는 "다음"을 누른
   * 뒤에야 무엇이 비었는지 알게 된다. 단계 안에서 미리 보이도록 목록으로 만든다.
   * 단계가 방식에 따라 빠지므로 배열 대신 key 로 찾는다.
   */
  const fieldStates = useMemo<Record<string, FieldState[]>>(() => ({
    product: [
      { label: '브랜드명', done: !!form.brand_name.trim(), required: true },
      { label: '제품명', done: !!form.product_name.trim(), required: true },
      { label: '제품 대표 이미지', done: !!form.thumbnail_url, required: false },
      { label: '제품 카테고리', done: !!form.category, required: true },
      { label: '제품 URL', done: !!form.product_url.trim(), required: false },
      { label: '제품 소개', done: !!form.description.trim(), required: true },
      { label: '제품 제공 방식', done: !!form.product_provide, required: true },
      { label: '담당자 이름', done: !!form.contact_person.trim(), required: true },
      { label: '담당자 연락처', done: digitsOnly(form.contact_phone).length >= 9, required: true },
      { label: '담당자 이메일', done: !!form.contact_email.trim(), required: false },
    ],
    campaign: [
      { label: '진행 방식', done: !!form.reward_mode, required: true },
      { label: '업로드 채널', done: !!form.upload_channel, required: true },
      { label: '콘텐츠 형식', done: !!form.content_format, required: true },
      ...(picksInfluencer
        ? [{ label: '광고 집행 예산', done: budgetKrw >= cheapestFee, required: true }]
        : [{ label: mode.headcountLabel, done: applyHeadcount > 0, required: true }]),
      ...(isGroupBuy
        ? [{ label: '판매 수수료', done: commissionRate > 0 && !badCommission, required: true }]
        : []),
      { label: '희망 업로드 일정', done: !!form.upload_from, required: true },
      { label: conceptLabel, done: !!form.video_concept.trim(), required: true },
    ],
    influencer: [
      { label: '성별', done: !!form.influencer_gender, required: true },
      { label: '연령', done: form.influencer_ages.length > 0, required: true },
      { label: 'SNS 채널 카테고리', done: !!form.sns_category, required: true },
      { label: '광고 목적', done: !!form.ad_objective, required: true },
      { label: '규모별 모집 인원', done: headcount > 0 && !overBudget, required: true },
      { label: '희망 최소 조회수', done: Number(digitsOnly(form.min_views) || 0) > 0, required: false },
      { label: '타겟 오디언스', done: !!form.target_audience.trim(), required: false },
      { label: '인플루언서 스타일', done: form.influencer_styles.length > 0, required: false },
      { label: '제외 조건', done: form.exclude_keywords.length > 0, required: false },
    ],
  }), [
    form, mode, picksInfluencer, isGroupBuy, applyHeadcount, commissionRate,
    badCommission, budgetKrw, cheapestFee, headcount, overBudget,
  ]);

  /** 그 단계에서 반드시 있어야 하는 것. 없으면 다음으로 넘기지 않는다. */
  const stepError = (key: string): string => {
    if (key === 'product') {
      if (!form.brand_name.trim()) return '브랜드명을 입력해 주세요.';
      if (!form.product_name.trim()) return '제품명을 입력해 주세요.';
      if (!form.category) return '제품 카테고리를 선택해 주세요.';
      if (!form.description.trim()) return '제품 소개를 입력해 주세요. 인플루언서가 가장 먼저 읽는 내용입니다.';
      if (!form.contact_person.trim()) return '캠페인 담당자 이름을 입력해 주세요.';
      if (!contactPhoneDigits) return '캠페인 담당자 연락처를 입력해 주세요.';
      // 휴대폰(10~11)뿐 아니라 02 지역번호(9)로 적는 브랜드가 있어 9자리부터 받는다.
      if (contactPhoneDigits.length < 9) return '담당자 연락처를 끝까지 입력해 주세요.';
      return '';
    }
    if (key === 'campaign') {
      if (picksInfluencer) {
        if (budgetKrw < cheapestFee) {
          return `광고 집행 예산은 ${formatKoreanWon(cheapestFee)}부터 입력할 수 있습니다.`;
        }
      } else if (applyHeadcount < 1) {
        return `${mode.headcountLabel}을 1명 이상 입력해 주세요.`;
      }
      if (isGroupBuy && badCommission) {
        return `판매 수수료는 ${COMMISSION_RANGE.min}% ~ ${COMMISSION_RANGE.max}% 사이로 입력해 주세요.`;
      }
      if (!form.upload_from) return '희망 업로드 시작일을 선택해 주세요.';
      if (form.upload_from && form.upload_to && form.upload_from > form.upload_to) {
        return '희망 업로드 일정의 시작일이 마감일보다 늦습니다.';
      }
      if (!form.content_format) return '콘텐츠 형식을 골라 주세요.';
      if (!form.video_concept.trim()) return `원하는 ${conceptLabel}을 적어 주세요.`;
      return '';
    }
    if (key === 'influencer') {
      if (form.influencer_ages.length === 0) return '희망 연령대를 한 개 이상 선택해 주세요.';
      if (!form.sns_category) return 'SNS 채널 카테고리를 선택해 주세요.';
      if (headcount < 1) return '규모를 고르고 모집 인원을 1명 이상 배분해 주세요.';
      if (overBudget) return `배분한 인원의 최소 집행액이 예산을 ${formatKoreanWon(floorSum - budgetKrw)} 넘습니다.`;
      return '';
    }
    return '';
  };

  const goNext = () => {
    const err = stepError(steps[step].key);
    if (err) { onNotify(err, 'error'); return; }
    if (step === steps.length - 1) { submit(); return; }
    setStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goTo = (index: number) => {
    // 뒤로는 자유롭게, 앞으로는 지금 단계를 통과해야 한다.
    if (index <= step) { setStep(index); return; }
    const err = stepError(steps[step].key);
    if (err) { onNotify(err, 'error'); return; }
    setStep(index);
  };

  // ------------------------------------------------------------------ 제출
  const submit = async () => {
    for (let i = 0; i < steps.length; i++) {
      const err = stepError(steps[i].key);
      if (err) { setStep(i); onNotify(err, 'error'); return; }
    }

    setSubmitting(true);
    try {
      const requirements = derivedRequirements({
        mode: form.reward_mode,
        gender: form.influencer_gender,
        ages: form.influencer_ages,
        snsCategory: form.sns_category,
        tierCounts: counts,
        minViews: Number(digitsOnly(form.min_views) || 0),
        styles: form.influencer_styles,
        excludes: form.exclude_keywords,
        headcount: applyHeadcount,
        channel: form.upload_channel,
      });

      const payload = {
        // 캠페인 유형은 진행 방식이 정한다. 공동구매는 협업 단계 묶음 자체가 달라서
        // (상품 정보 전달 → 판매 시작 → 수수료 정산) 서버가 type 으로 갈라 본다.
        type: mode.campaignType,
        // 물어보지 않고 만드는 값들. 예전에는 브랜드가 직접 적었다.
        title: derivedTitle(form.product_name, form.brand_name),
        description: form.description,
        brand_name: form.brand_name,
        thumbnail_url: form.thumbnail_url,
        category: form.category,
        // 제품 협찬형은 지급할 광고비가 없다 — 보상 유형을 '제품 제공'으로 남기고
        // 금액은 비워 둔다. 0 을 넣으면 인플루언서 화면에 보상이 "0원"으로 크게 찍힌다.
        // 공동구매는 판매 수수료로 정산하므로 '수익 배분'으로 남긴다.
        reward_type: isBarter ? 'product' : isGroupBuy ? 'revenue_share' : 'fixed',
        reward_amount: picksInfluencer ? String(derivedUnitFee(form.reward_mode, counts)) : '',
        requirements,
        max_applicants: headcount,
        // 모집은 등록 즉시 시작하고, 희망 업로드 시작일까지 받는다.
        start_date: todayInSeoul(),
        end_date: form.upload_from || '',
        content_format: form.content_format,
        second_use_fee: 0,
        second_use_note: mode.secondUseNote,

        product_name: form.product_name,
        product_url: form.product_url,
        upload_channel: form.upload_channel,
        video_concept: form.video_concept,
        upload_from: form.upload_from,
        upload_to: form.upload_to,

        reward_mode: form.reward_mode,
        // 지원을 받아 고르는 방식에는 희망 인플루언서 조건이 없다. 폼에 남아 있는 값이
        // 있어도(방식을 바꾸기 전에 골라 둔 값) 보내지 않는다 — 조건으로 저장되면
        // 지원 화면에 "여성 20대 나노"가 걸려 지원 자체가 줄어든다.
        tier_counts: picksInfluencer ? serializeTierCounts(counts) : '',
        // 패키지를 걷어내기 전에 만들어진 화면들이 아직 이 값을 읽는다. 진행 방식에서
        // 짝이 되는 값을 남겨 둬야 그쪽에서 협업 단계를 엉뚱하게 잡지 않는다.
        package_tier: isBarter ? 'seeding' : 'full',
        product_provide: form.product_provide,
        ad_objective: picksInfluencer ? form.ad_objective : '',
        budget_krw: picksInfluencer ? budgetKrw : 0,
        // 제품 협찬형의 협찬 인원. 컬럼은 예전 시딩 건수 칸을 그대로 쓴다.
        seeding_count: isBarter ? applyHeadcount : 0,
        groupbuy_commission_rate: isGroupBuy ? commissionRate : 0,
        influencer_gender: picksInfluencer ? form.influencer_gender : 'any',
        influencer_ages: picksInfluencer ? form.influencer_ages : [],
        sns_category: picksInfluencer ? form.sns_category : '',
        // 담당자 리스트업은 고른 구간만 읽는다. 인원까지 필요한 화면은 tier_counts 를 본다.
        follower_tiers: picksInfluencer
          ? chosenTiers(counts).filter(t => (counts[t.key] || 0) > 0).map(t => t.key)
          : [],
        min_views: picksInfluencer ? Number(digitsOnly(form.min_views) || 0) : 0,
        influencer_styles: picksInfluencer ? form.influencer_styles : [],
        exclude_keywords: picksInfluencer ? form.exclude_keywords : [],
        target_audience: picksInfluencer ? form.target_audience : '',

        // 담당자는 진행 방식과 무관하게 항상 보낸다. 어떤 방식이든 담당자가 브랜드에
        // 확인할 일이 생긴다.
        contact_person: form.contact_person.trim(),
        contact_phone: contactPhoneDigits,
        contact_email: form.contact_email.trim(),
      };

      const res = await fetch('/api/campaigns', {
        method: editing ? 'PATCH' : 'POST',
        headers: await authHeaders(
          { 'Content-Type': 'application/json' },
          { account: businessUsername },
        ),
        body: JSON.stringify(
          editing
            ? { id: editing.id, ...payload }
            : { ...payload, business_username: businessUsername },
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // 인증에서 막힌 경우는 입력 문제가 아니다. 원문("다른 계정의 정보에는…")만
        // 보여 주면 브랜드는 무엇을 고쳐야 하는지 알 수 없으니, 다시 로그인하라고
        // 알려 준다. 작성 내용은 임시 저장에 남아 있어 로그인 후 이어서 쓸 수 있다.
        if (res.status === 401 || res.status === 403) {
          onNotify(
            '로그인 정보가 만료되었습니다. 비즈니스 계정으로 다시 로그인하면 작성한 내용은 그대로 남아 있습니다.',
            'error',
          );
          return;
        }
        onNotify(err.error || (editing ? '수정 실패' : '등록 실패'), 'error');
        return;
      }
      if (!editing) {
        try { localStorage.removeItem(draftKey); } catch { /* 지우지 못해도 등록은 끝났다. */ }
      }
      onNotify(
        editing
          ? '캠페인이 수정되었습니다.'
          : picksInfluencer
            ? '캠페인이 등록되었습니다. 담당자가 조건에 맞는 인플루언서를 찾아 리스트업해 드립니다.'
            : '캠페인이 등록되었습니다. 승인 후 캠페인 협업 목록에 올라가고, 지원자가 모이면 그 중에서 고르실 수 있습니다.',
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

  const stageMarks = stageMarksFor(form.reward_mode);

  /** 단계마다 하나씩. 단계가 빠질 수 있으니 목록이 아니라 key 로 찾는다. */
  const TIPS: Record<string, { title: string; body: string }> = {
    product: {
      title: '제품 소개는 왜 필요할까요?',
      body: '인플루언서가 지원 여부를 정할 때 가장 먼저 읽는 내용입니다. 제품의 특징과 꼭 강조하고 싶은 점을 두세 줄로 적어 주세요.',
    },
    campaign: {
      title: picksInfluencer
        ? '예산은 어떻게 정할까요?'
        : isGroupBuy
          ? '공동구매는 무엇이 다를까요?'
          : '제품 협찬형은 무엇이 다를까요?',
      body: picksInfluencer
        ? '쓸 수 있는 총액을 적어 주세요. 다음 단계에서 규모별로 인원을 배분할 때, 이 예산 안에서만 담을 수 있게 잔액을 보여 드립니다.'
        : isGroupBuy
          ? '캠페인 협업 목록에 올라가고, 판매를 함께할 인플루언서가 직접 지원합니다. 광고비 대신 판매 수수료로 정산하며, 콘텐츠 검수와 수수료 정산 단계가 있습니다.'
          : '캠페인 협업 목록에 올라가고, 인플루언서가 직접 지원합니다. 광고비 없이 제품만 제공하므로 구성안·콘텐츠 검수 단계가 없고, 가이드를 전달한 뒤 업로드를 확인하는 흐름으로 진행됩니다.',
    },
    influencer: {
      title: '규모는 섞는 게 좋을까요?',
      body: '메가 한 명으로 화제를 만들고 마이크로·나노로 후속 반응을 채우는 구성이 가장 흔합니다. 배분액은 각 규모의 최소 단가 기준이고, 실제 금액은 담당자가 후보를 확정할 때 정해집니다.',
    },
  };

  /** 예산 대비 배분 상태. 규모 카드 위에 한 줄로 얹는다. */
  const allocationBar = () => {
    const ratio = budgetKrw > 0 ? Math.min(100, Math.round((floorSum / budgetKrw) * 100)) : 0;
    return (
      <div className={`rounded-2xl border p-4 ${overBudget ? 'border-rose-200 bg-rose-50' : 'border-slate-100 bg-slate-50'}`}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-black text-slate-500">배분한 최소 집행액</p>
            <p className={`text-lg font-black ${overBudget ? 'text-rose-600' : 'text-slate-900'}`}>
              {formatKoreanWon(floorSum) || '0원'}
              <span className="text-[11px] font-bold text-slate-400 ml-1.5">
                / {formatKoreanWon(budgetKrw) || '0원'}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-black text-slate-500">남은 예산</p>
            <p className={`text-sm font-black ${overBudget ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatKoreanWon(leftover) || '0원'}
            </p>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-white mt-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${overBudget ? 'bg-rose-500' : 'bg-slate-900'}`}
            style={{ width: `${ratio}%` }}
          />
        </div>
        {headcount > 0 && (
          <p className="text-[11px] text-slate-400 font-medium mt-2">
            실제 집행액은 규모별 단가 구간에 따라 {formatKoreanWon(floorSum)} ~ {formatKoreanWon(ceilingSum)} 사이에서 확정됩니다.
          </p>
        )}
        {overBudget && (
          <p className="text-[11px] text-rose-600 font-black mt-2">
            예산을 넘었습니다. 인원을 줄이거나 예산을 늘려 주세요.
          </p>
        )}
      </div>
    );
  };

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
            {steps.length}단계만 채우면 담당자가 이어서 진행합니다. 제목과 지원 조건은 적으신 내용으로 자동 정리됩니다.
          </p>

          {/* 저장된 초안은 물어보고 되살린다. 새 캠페인을 등록하러 온 사람에게 지난
              내용이 이미 채워져 있으면 어디가 예전 값인지 몰라 한 칸씩 지워야 한다. */}
          {savedDraft && (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-black text-blue-900">
                작성하던 캠페인이 있습니다
                {savedDraft.product_name ? ` · ${savedDraft.product_name}` : ''}
              </p>
              <p className="text-[11px] text-blue-700 font-medium mt-1 leading-relaxed">
                이어서 작성하거나, 지금 화면(빈 폼)에서 새로 시작하실 수 있습니다.
              </p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={restoreDraft}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 text-white text-[11px] font-black hover:bg-blue-700"
                >
                  이어서 작성
                </button>
                <button
                  type="button"
                  onClick={() => setSavedDraft(null)}
                  className="px-3.5 py-2 rounded-xl bg-white border border-blue-200 text-blue-700 text-[11px] font-black hover:bg-blue-100"
                >
                  새로 시작
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 mt-5 overflow-x-auto">
            {steps.map((s, i) => (
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
                {i < steps.length - 1 && <span className="flex-1 h-px bg-slate-200 min-w-[16px]" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="px-5 md:px-7 py-6 space-y-5">
          {/* ---------------------------------------------- ① 제품 정보 */}
          {stepKey === 'product' && (
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

              {/*
                캠페인 담당자.

                계정 가입 정보에 적힌 연락처만으로는 부족했다. 대행사 계정 하나로 여러
                브랜드를 올리거나 가입한 사람이 이미 퇴사한 경우, 담당자가 전화를 걸면
                이 캠페인을 모르는 사람이 받는다. 그래서 캠페인마다 "이 건으로 물어볼
                사람"을 받는다.

                지난 캠페인 값을 자동으로 채우지 않고 버튼으로 두는 이유: 미리 채워
                두면 담당이 바뀐 캠페인에도 예전 사람의 번호가 그대로 저장된다. 대신
                한 번 누르면 채워지므로 매번 다시 적을 필요는 없다.
              */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs font-black text-slate-900">캠페인 담당자 *</p>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      이 캠페인 진행 중 픽스폴리오 담당자가 연락할 분입니다. 제품 발송,
                      촬영 일정, 2차 활용처럼 브리프로 답이 안 나오는 건을 여기로 확인합니다.
                    </p>
                  </div>
                  {!editing && lastContact?.person && lastContact?.phone && (
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({
                        ...prev,
                        contact_person: lastContact.person,
                        contact_phone: formatPhoneInput(lastContact.phone),
                        contact_email: lastContact.email || prev.contact_email,
                      }))}
                      className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-[11px] font-black text-slate-600 hover:border-slate-500 flex-shrink-0"
                    >
                      지난 캠페인과 동일
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL}>담당자 이름 *</label>
                    <input
                      type="text"
                      value={form.contact_person}
                      onChange={e => patch('contact_person', e.target.value.slice(0, 60))}
                      className={INPUT}
                      placeholder="김담당"
                    />
                  </div>
                  <div>
                    <label className={LABEL}>담당자 연락처 *</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={form.contact_phone}
                      onChange={e => patch('contact_phone', formatPhoneInput(e.target.value))}
                      className={INPUT}
                      placeholder="010-0000-0000"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className={LABEL}>담당자 이메일</label>
                  <input
                    type="email"
                    value={form.contact_email}
                    onChange={e => patch('contact_email', e.target.value.slice(0, 200))}
                    className={INPUT}
                    placeholder="비워 두면 계정 이메일을 사용합니다"
                  />
                </div>
              </div>
            </>
          )}

          {/* ---------------------------------------------- ② 캠페인 설정 */}
          {stepKey === 'campaign' && (
            <>
              <div>
                <label className={LABEL}>진행 방식 *</label>
                {/* 세 방식을 한 줄에 나란히 둔다 — 나란히 보이지 않으면 무엇을 고르는지
                    비교가 안 되고, 두 줄로 접히면 마지막 방식이 덤처럼 보인다. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {REWARD_MODES.map(m => {
                    const active = form.reward_mode === m.value;
                    return (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => patch('reward_mode', m.value)}
                        className={`text-left p-3 rounded-xl border-2 transition-colors ${
                          active ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <span className="inline-block px-1.5 py-0.5 rounded-full bg-slate-900 text-white text-[9px] font-black">
                          {m.tagline}
                        </span>
                        <p className="text-[13px] font-black text-slate-900 mt-1.5">{m.label}</p>
                        <p className="text-[10px] text-slate-500 font-medium mt-1 leading-snug">
                          {m.lines[0]}<br />{m.lines[1]}
                        </p>
                        {/* 지원을 받는 방식인지 아닌지가 이후 단계를 바꾼다. 고르기 전에 알려 준다. */}
                        <p className="text-[9px] font-black text-slate-400 mt-1.5 leading-snug">
                          {m.openApply ? '캠페인 협업 목록에 노출 · 인플루언서가 직접 지원' : '목록에 노출하지 않고 담당자가 후보를 리스트업'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 진행 방식이 정하는 단계. 협업 화면에 실제로 생기는 단계와 짝을 맞춰 둔다. */}
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-[11px] font-black text-slate-700 mb-3">{mode.label} 진행 단계</p>
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {stageMarks.map((s, i) => (
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
                      {i < stageMarks.length - 1 && <span className="w-4 h-px bg-slate-200 flex-shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 font-medium mt-2">
                  {mode.secondUseNote} · 제외된 단계는 협업에도 생기지 않습니다.
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
                {/* 유튜브·틱톡은 산출물 규격과 검수 기준이 달라 아직 받지 않는다. */}
                <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                  현재는 인스타그램 캠페인만 진행합니다.
                </p>
              </div>

              {/* 콘텐츠 형식. 인플루언서의 지급 단가(릴스 단가 · 피드 단가)가 이
                  선택으로 갈리므로, 예산을 적기 전에 고르는 자리에 둔다. */}
              <div>
                <label className={LABEL}>콘텐츠 형식 *</label>
                <div className="grid grid-cols-2 gap-2">
                  {CONTENT_FORMATS.map(f => {
                    const active = form.content_format === f.value;
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => patch('content_format', f.value)}
                        className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                          active
                            ? 'bg-slate-900 border-slate-900'
                            : 'bg-white border-slate-200 hover:border-slate-400'
                        }`}
                      >
                        <span className={`block text-xs font-black ${active ? 'text-white' : 'text-slate-700'}`}>
                          {f.label}
                        </span>
                        <span className={`block text-[11px] font-medium mt-0.5 leading-relaxed break-keep ${active ? 'text-white/60' : 'text-slate-400'}`}>
                          {f.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {picksInfluencer ? (
                <div>
                  <label className={LABEL}>광고 집행 예산 *</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.budget_krw}
                      onChange={e => patch('budget_krw', formatNumberWithCommas(digitsOnly(e.target.value)))}
                      className={`${INPUT} max-w-[220px]`}
                      placeholder="50,000,000"
                    />
                    <span className="text-sm font-black text-slate-500">원</span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                    쓸 수 있는 총액을 적어 주세요. 다음 단계에서 이 예산 안에서 규모별 인원을 배분합니다.
                  </p>
                </div>
              ) : (
                <div>
                  <label className={LABEL}>{mode.headcountLabel} *</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.apply_headcount}
                      onChange={e => patch('apply_headcount', digitsOnly(e.target.value))}
                      className={`${INPUT} max-w-[160px]`}
                      placeholder="20"
                    />
                    <span className="text-sm font-black text-slate-500">명</span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium mt-1.5">
                    {isBarter
                      ? '제품을 협찬할 인플루언서 수입니다. 지원자 중에서 이 인원만큼 골라 진행합니다.'
                      : '함께 판매할 인플루언서 수입니다. 지원자 중에서 이 인원만큼 골라 진행합니다.'}
                  </p>
                </div>
              )}

              {/* 수수료율은 담당자에게만 전달되는 값이다. 인플루언서 화면에는
                  "담당자와 협의"로만 나가고 숫자는 노출되지 않는다 — 실제 수수료는
                  담당자가 인플루언서와 이야기하며 정하기 때문에, 먼저 보여 준
                  숫자가 확정 조건처럼 읽히면 조율이 어려워진다. */}
              {isGroupBuy && (
                <div>
                  <label className={LABEL}>희망 판매 수수료 *</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.commission_rate}
                      onChange={e => patch('commission_rate', digitsOnly(e.target.value).slice(0, 2))}
                      className={`${INPUT} max-w-[120px]`}
                      placeholder="15"
                    />
                    <span className="text-sm font-black text-slate-500">%</span>
                  </div>
                  <p className={`text-[11px] font-medium mt-1.5 ${badCommission && form.commission_rate ? 'text-rose-500 font-black' : 'text-slate-400'}`}>
                    판매 금액에서 인플루언서에게 지급할 비율입니다. {COMMISSION_RANGE.min}% ~ {COMMISSION_RANGE.max}% 사이로 적어 주세요.
                    <br />
                    이 비율은 담당자에게만 전달되고 캠페인 화면에는 노출되지 않습니다. 최종 수수료는 담당자가 인플루언서와 협의해 정합니다.
                  </p>
                </div>
              )}

              <div>
                <label className={LABEL}>희망 업로드 일정 *</label>
                <DateRangeCalendar
                  from={form.upload_from}
                  to={form.upload_to}
                  onChange={(nextFrom, nextTo) =>
                    setForm(p => ({ ...p, upload_from: nextFrom, upload_to: nextTo }))
                  }
                />
              </div>

              <div>
                <label className={LABEL}>{conceptLabel} *</label>
                <textarea
                  value={form.video_concept}
                  onChange={e => patch('video_concept', e.target.value)}
                  rows={4}
                  maxLength={500}
                  className={INPUT}
                  placeholder={
                    isShortformFormat
                      ? '예) 아침 세안 후 바르는 장면으로 시작해, 발림성과 흡수력을 클로즈업으로 보여 주세요.'
                      : '예) 세면대에 제품을 놓고 찍은 사진 한 장과 텍스처 클로즈업을 함께 올려 주세요.'
                  }
                />
                <p className="text-[11px] text-slate-400 font-medium mt-1 text-right">
                  {form.video_concept.length}/500
                </p>
              </div>
            </>
          )}

          {/* ---------------------------------------------- ③ 희망 인플루언서 */}
          {stepKey === 'influencer' && (
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

              {/* ------------------------------------------ 규모별 모집 인원 */}
              <div>
                <label className={LABEL}>
                  규모별 모집 인원 * <span className="text-slate-400 font-bold">(예산 안에서 배분)</span>
                </label>

                {allocationBar()}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                  {TIERS.map(t => {
                    const chosen = counts[t.key] !== undefined;
                    const room = affordableCount(t, budgetKrw, counts);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => toggleTier(t.key)}
                        className={`text-left p-3 rounded-xl border-2 transition-colors ${
                          chosen ? 'border-slate-900 bg-slate-50' : 'border-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <span className="text-xs font-black text-slate-900">{t.label}</span>
                          {chosen && (
                            <span className="px-1.5 py-0.5 rounded-full bg-slate-900 text-white text-[9px] font-black">
                              {counts[t.key]}명
                            </span>
                          )}
                        </span>
                        <span className="block text-[10px] text-slate-400 font-bold mt-1">{t.followers}</span>
                        <span className="block text-[10px] text-slate-500 font-black mt-1">
                          1인 {tierFeeLabel(t)}
                        </span>
                        <span className="block text-[10px] text-slate-400 font-medium mt-1 leading-tight">
                          {chosen ? `${room}명 더 배분 가능` : t.note}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* 고른 규모마다 인원 조절 줄. 고르기 전에는 나오지 않는다. */}
                {chosenTiers(counts).length > 0 ? (
                  <div className="mt-3 rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                    {chosenTiers(counts).map(t => {
                      const n = counts[t.key] || 0;
                      const addable = canAddOne(t, form.reward_mode, budgetKrw, 0, counts);
                      return (
                        <div key={t.key} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-slate-900">
                              {t.label}
                              <span className="text-[10px] text-slate-400 font-bold ml-1.5">{t.followers}</span>
                            </p>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                              1인 {tierFeeLabel(t)} · 최소 {formatKoreanWon(t.minFee * n) || '0원'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => bumpTier(t.key, -1)}
                              disabled={n <= 0}
                              className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 font-black text-sm disabled:opacity-30 hover:border-slate-400"
                            >
                              −
                            </button>
                            <span className="w-10 text-center text-sm font-black text-slate-900">{n}</span>
                            <button
                              type="button"
                              onClick={() => bumpTier(t.key, 1)}
                              disabled={!addable}
                              className="w-8 h-8 rounded-lg border border-slate-200 text-slate-600 font-black text-sm disabled:opacity-30 hover:border-slate-400"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleTier(t.key)}
                              className="ml-1 text-[10px] font-black text-slate-400 hover:text-rose-500"
                            >
                              제거
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 font-medium mt-2">
                    규모를 고르면 인원을 배분할 수 있습니다.
                    {budgetKrw <= 0 && ' 먼저 캠페인 설정에서 예산을 입력해 주세요.'}
                  </p>
                )}
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
              : step === steps.length - 1
                ? (editing ? '수정 완료' : '캠페인 생성 완료')
                : '다음 →'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ 사이드바 */}
      <aside className="lg:sticky lg:top-6 space-y-3">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black text-slate-900">{steps[step]?.label}</p>
            <span className="text-[10px] font-black text-slate-400">{step + 1} / {steps.length}</span>
          </div>
          <p className="text-[11px] text-slate-400 font-medium mt-0.5">{steps[step]?.hint}</p>

          <div className="mt-4 space-y-1.5">
            {(fieldStates[stepKey] || []).map(f => (
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

        {/* 지금까지 고른 것으로 정해진 조건. 인원을 배분하면 바로 바뀐다. */}
        {step >= 1 && (
          <div className="bg-slate-900 rounded-2xl p-5 text-white">
            <p className="text-[11px] font-black text-white/60">현재 설정</p>
            <p className="text-sm font-black mt-2">{mode.label}</p>
            <div className="mt-3 space-y-1.5 text-[11px] font-bold">
              <div className="flex items-center justify-between">
                <span className="text-white/50">{mode.headcountLabel}</span>
                <span>{headcount}명</span>
              </div>
              {picksInfluencer ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-white/50">집행 예산</span>
                    <span>{formatKoreanWon(budgetKrw) || '0원'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/50">배분(최소)</span>
                    <span>{formatKoreanWon(floorSum) || '0원'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/50">잔액</span>
                    <span className={overBudget ? 'text-rose-300' : 'text-emerald-300'}>
                      {overBudget ? `-${formatKoreanWon(floorSum - budgetKrw)}` : formatKoreanWon(leftover) || '0원'}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {isGroupBuy && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/50">희망 판매 수수료</span>
                      <span>{commissionRate > 0 ? `${commissionRate}% (담당자 전달용)` : '-'}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-white/50">인플루언서</span>
                    <span>지원자 중 선택</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-white/50">채널</span>
                <span>{form.upload_channel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/50">형식</span>
                <span>{contentFormatLabel(form.content_format)}</span>
              </div>
              {form.upload_from && (
                <div className="flex items-center justify-between">
                  <span className="text-white/50">업로드</span>
                  <span>{form.upload_from}{form.upload_to ? ` ~ ${form.upload_to}` : ''}</span>
                </div>
              )}
            </div>
            {picksInfluencer && chosenTiers(counts).length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap gap-1.5">
                {chosenTiers(counts).map(t => (
                  <span key={t.key} className="px-2 py-1 rounded-full bg-white/10 text-[10px] font-black">
                    {t.label} {counts[t.key]}명
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 후보 수를 숫자로 약속하지 않는다. 리스트업은 담당자가 캠페인을 확인한 뒤
            만들고, 조건에 맞는 사람이 몇 명인지는 그때 정해진다. 등록 화면에서
            "약 N명"을 보여 주면 지키지 못할 약속이 된다. */}
        {stepKey === 'influencer' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-xs font-black text-slate-900">담당자에게 전달되는 조건</p>
            <p className="text-[11px] text-slate-500 font-medium mt-2 leading-relaxed">
              등록하시면 담당자가 아래 조건으로 후보를 찾아 리스트업해 드립니다.
              보시고 마음에 드는 후보만 남기면 됩니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                GENDERS.find(g => g.value === form.influencer_gender)?.label,
                ...form.influencer_ages,
                form.sns_category,
                ...chosenTiers(counts).map(t => `${t.label} ${counts[t.key]}명`),
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

        {/* 지원을 받아 고르는 방식은 리스트업이 없다. 대신 지원이 어떻게 들어오고
            누가 고르는지를 등록 전에 적어 둔다 — 등록 후 "지원자가 왜 없나요"를 가장
            많이 묻는 지점이다. */}
        {!picksInfluencer && stepKey === 'campaign' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <p className="text-xs font-black text-slate-900">지원은 이렇게 들어옵니다</p>
            <ol className="mt-3 space-y-2">
              {[
                '등록하시면 담당자 승인 후 캠페인 협업 목록에 올라갑니다.',
                '조건을 보고 인플루언서가 직접 지원합니다.',
                `지원자 목록에서 함께할 분을 ${mode.headcountLabel}만큼 고르시면 담당자가 협업을 만들어 드립니다.`,
              ].map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium leading-relaxed">{line}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
          <p className="text-[11px] font-black text-amber-700">작성 Tip</p>
          <p className="text-xs font-black text-amber-900 mt-2">{TIPS[stepKey].title}</p>
          <p className="text-[11px] text-amber-700 font-medium mt-1.5 leading-relaxed">{TIPS[stepKey].body}</p>
        </div>
      </aside>
    </div>
  );
};

export default CampaignRegisterWizard;
