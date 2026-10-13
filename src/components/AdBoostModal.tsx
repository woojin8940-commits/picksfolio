import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, ChevronDown, Loader2, RotateCcw, Users } from 'lucide-react';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { useMetaAdConnection } from '../hooks/useMetaAdConnection';
import { useMetaPages } from '../hooks/useMetaPages';
import { formatKoreanWon } from '../utils/formatters';
import {
  MetaAdRecord,
  MetaPixel,
  createMetaAd,
  estimateMetaAudience,
  fetchMetaPixels,
  notifyMetaAdsChanged,
  resumeMetaAd,
  runRemainingSteps,
} from '../utils/metaAdsApi';
import {
  AD_CTAS,
  AdCta,
  BID_STRATEGIES,
  BOOST_OBJECTIVES,
  BoostObjective,
  CONVERSION_EVENTS,
  PERFORMANCE_GOALS,
  placementSummary,
  targetSummary,
} from '../utils/adBoosts';
import { AdDeliveryFields, AdSection, inputCls, labelCls, selectCls, useAdDelivery } from './AdDeliveryFields';
import MetaAdProgress from './MetaAdProgress';
import MetaPagePicker from './MetaPagePicker';
import StartPausedToggle from './StartPausedToggle';
import ResumeNotice from './MetaAdResumeNotice';

/**
 * 콘텐츠 부스팅 창 — 이력에서 고른 게시물을 광고로 돌리는 설정.
 *
 * 메타 광고 관리자와 같은 순서로 나눈다 — 캠페인(이름 · 목표) → 광고 세트(성과 목표 ·
 * 전환 이벤트 · 예산 및 일정 · 입찰 · 타겟 · 노출 위치) → 광고(페이지 · 웹사이트 URL ·
 * CTA · URL 매개변수). 마케터가 광고 관리자에서 자주 만지는 값만 옮겨 왔고, 모두
 * 광고 관리자의 기본값으로 채워져 있어서 예산만 넣어도 집행된다. 맨 아래 요약은 광고
 * 관리자 오른쪽의 '타겟 규모'와 설정 요약 자리다.
 *
 * 무엇을 광고할지(콘텐츠)와 누구 이름으로 나갈지(인플루언서)는 이미 정해져 있다 —
 * 이력에서 그 게시물을 눌러 들어왔고, 브랜디드 콘텐츠 광고는 게시물 소유자가 고정이다.
 * 그래서 그 둘은 고르는 항목이 아니라 창 위쪽의 확인용 카드로 둔다.
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
 * '집행하기' 를 누르면 메타에 캠페인 → 광고 세트 → 소재 → 광고가 실제로 만들어진다
 * (api-meta-ads-ads). 소재는 파트너십 광고 코드로 찾은 인플루언서 게시물이고, 광고는
 * 고른 페이스북 페이지(브랜드)와 인플루언서가 함께 표시되는 파트너십 광고로 나간다.
 * 파트너십 코드 조회에는 메타 쪽 추가 권한이 필요해서, 막히면 메타의 문장을 그대로 보여
 * 주고 그 단계부터 다시 시도할 수 있게 한다.
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
  /** 메타에 광고 기록이 만들어졌을 때(중간 실패 포함). */
  onSubmitted?: (record: MetaAdRecord) => void;
  /** 성공 화면에서 광고 현황으로 넘어갈 수 있으면 넘겨준다. */
  onViewAdStatus?: () => void;
  /**
   * 중간 단계에서 멈춘 부스팅 광고(광고 현황의 '이어서 만들기'). 넘기면 그 광고의 설정을
   * 채운 채로 열리고, 고친 설정으로 다시 만든다. 광고 계정은 그 광고의 계정으로 고정한다.
   */
  resume?: MetaAdRecord | null;
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
  resume: resumeProp,
}) => {
  // 예산 · 기간 · 타겟 · 노출 위치는 '새 광고 만들기' 창과 같은 값·같은 검증을 쓴다.
  const delivery = useAdDelivery();
  const [objective, setObjective] = useState<BoostObjective>('conversions');
  const [optimizationGoal, setOptimizationGoal] = useState(PERFORMANCE_GOALS.conversions[0].value);
  const [conversionEvent, setConversionEvent] = useState('PURCHASE');
  const [pixelId, setPixelId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [cta, setCta] = useState<AdCta>('shop_now');
  const [urlTags, setUrlTags] = useState('');
  const [freqOn, setFreqOn] = useState(false);
  const [freqImpressions, setFreqImpressions] = useState(2);
  const [freqDays, setFreqDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [startPaused, setStartPaused] = useState(resumeProp?.initialStatus === 'PAUSED');
  const [phase, setPhase] = useState<'form' | 'running'>('form');
  const [record, setRecord] = useState<MetaAdRecord | null>(null);
  /**
   * 이어서 만드는 광고. 광고 현황에서 넘긴 멈춘 광고이거나, 이 창에서 만들다 멈춘 뒤
   * '설정 고치기' 를 누른 기록이다. 어느 쪽이든 고친 설정으로 다시 만든다(같은 값으로
   * 다시 시도만 하면 같은 자리에서 또 멈춘다).
   */
  const [fixing, setFixing] = useState(false);
  const resume = resumeProp || (fixing && record && record.step !== 'done' ? record : null);
  const [runError, setRunError] = useState('');

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
      if (resume) return resume.adAccountId;
      if (prev && accounts.some((a) => a.id === prev)) return prev;
      return currentAccount?.id || accounts[0]?.id || '';
    });
  }, [open, accounts, currentAccount, resume]);

  useCloseOnBack(open, onClose);

  /** 이 요청이 들어갈 계정. 성공 화면에서 어느 계정으로 갔는지 같이 적는다. */
  const selectedAccount = accounts.find((a) => a.id === adAccountId) || null;
  const pagesState = useMetaPages(businessUsername, open && connected);
  /**
   * 광고 페이지는 이 창에서 직접 고른다. 페이지 게시물 참여·광고 현황에서 고른 페이지를
   * 끌어오지 않는다 — 창을 열 때마다 비어 있고(이어서 만들 때만 그 광고가 쓰던 페이지),
   * 여기서 고른 값도 이 창에만 둔다.
   */
  const [pageId, setPageId] = useState(resumeProp?.pageId || '');
  useEffect(() => {
    if (open) setPageId(resumeProp?.pageId || '');
  }, [open, resumeProp?.pageId]);
  const page = pagesState.pages.find((p) => p.id === pageId && (p.canAdvertise || p.id === resumeProp?.pageId)) || null;
  const selectPage = setPageId;

  // 멈춘 광고의 예산·기간·타겟·노출 위치를 한 번 채운다.
  useEffect(() => {
    if (!resume) return;
    delivery.fill(resume);
    const obj = (BOOST_OBJECTIVES.find((o) => o.value === resume.objective)?.value || 'conversions') as BoostObjective;
    setObjective(obj);
    setOptimizationGoal(
      PERFORMANCE_GOALS[obj].some((g) => g.value === resume.optimizationGoal)
        ? String(resume.optimizationGoal)
        : PERFORMANCE_GOALS[obj][0].value,
    );
    setConversionEvent(resume.conversionEvent || 'PURCHASE');
    setPixelId(resume.pixelId || '');
    setCampaignName(resume.campaignName || '');
    setLinkUrl(resume.linkUrl || '');
    if (resume.cta) setCta(resume.cta);
    setUrlTags(resume.urlTags || '');
    setFreqOn(!!resume.frequencyCap);
    if (resume.frequencyCap) {
      setFreqImpressions(resume.frequencyCap.impressions);
      setFreqDays(resume.frequencyCap.days);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.id]);

  /** 목표를 바꾸면 성과 목표를 그 목표의 기본값으로, CTA 를 어울리는 문구로 맞춘다. */
  const changeObjective = (next: BoostObjective) => {
    setObjective(next);
    setOptimizationGoal(PERFORMANCE_GOALS[next][0].value);
    setCta(next === 'conversions' ? 'shop_now' : 'learn_more');
  };

  const goals = PERFORMANCE_GOALS[objective];
  const goal = goals.find((g) => g.value === optimizationGoal) || goals[0];
  /** 픽셀이 필요한 성과 목표. 판매 목표의 전환 최적화와 랜딩 페이지 조회가 그렇다. */
  const needsPixel = ['OFFSITE_CONVERSIONS', 'VALUE', 'LANDING_PAGE_VIEWS'].includes(goal.value);
  /** 웹사이트로 보내는 목표. 연결 URL 이 있어야 성과가 측정된다. */
  const needsUrl = objective === 'conversions' || objective === 'traffic';
  /** 빈도 제한은 메타가 도달 최적화에서만 받는다. */
  const canCapFrequency = goal.value === 'REACH';

  // 광고 계정의 픽셀. 고르지 않으면 서버가 첫 번째 픽셀을 쓴다(예전 동작).
  const [pixels, setPixels] = useState<MetaPixel[]>([]);
  const [pixelsLoading, setPixelsLoading] = useState(false);
  useEffect(() => {
    if (!open || !adAccountId || !connected) return;
    let alive = true;
    setPixelsLoading(true);
    fetchMetaPixels(businessUsername, adAccountId).then((res) => {
      if (!alive) return;
      setPixelsLoading(false);
      const list = res.ok ? res.pixels : [];
      setPixels(list);
      setPixelId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id || ''));
    });
    return () => {
      alive = false;
    };
  }, [open, adAccountId, connected, businessUsername]);

  /** 광고 관리자와 같은 설정 묶음. 집행 · 이어서 만들기 · 타겟 규모 추정이 같은 값을 쓴다. */
  const settings = () => ({
    objective,
    optimizationGoal: goal.value,
    conversionEvent: goal.value === 'OFFSITE_CONVERSIONS' ? conversionEvent : goal.value === 'VALUE' ? 'PURCHASE' : undefined,
    pixelId: needsPixel ? pixelId || undefined : undefined,
    campaignName: campaignName.trim() || undefined,
    linkUrl: linkUrl.trim() || undefined,
    cta: linkUrl.trim() ? cta : undefined,
    urlTags: urlTags.trim().replace(/^\?/, '') || undefined,
    frequencyCap: canCapFrequency && freqOn ? { impressions: freqImpressions, days: freqDays } : null,
    ...delivery.payload(),
  });

  // 타겟 규모. 타겟을 바꿀 때마다 잠깐 기다렸다가 다시 묻는다.
  const [estimate, setEstimate] = useState<{ lower: number; upper: number } | null>(null);
  const [estimateState, setEstimateState] = useState<'idle' | 'loading' | 'error'>('idle');
  const estimateKey = JSON.stringify([
    adAccountId,
    goal.value,
    delivery.regions,
    delivery.ageMin,
    delivery.ageMax,
    delivery.gender,
    delivery.interests.map((i) => i.id),
    delivery.audiences.map((a) => a.id),
    delivery.excludedAudiences.map((a) => a.id),
    delivery.advantageAudience,
    delivery.placementMode,
    delivery.placements,
  ]);
  useEffect(() => {
    if (!open || !connected || !adAccountId || phase !== 'form') return;
    let alive = true;
    setEstimateState('loading');
    const timer = window.setTimeout(async () => {
      const res = await estimateMetaAudience(businessUsername, adAccountId, settings());
      if (!alive) return;
      if (res.ok && (res.lower || res.upper)) {
        setEstimate({ lower: res.lower, upper: res.upper });
        setEstimateState('idle');
      } else {
        setEstimate(null);
        setEstimateState('error');
      }
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected, estimateKey, phase]);

  const objectiveLabel = BOOST_OBJECTIVES.find((o) => o.value === objective)?.label || '';
  const summaryRows = useMemo(
    () => [
      { k: '캠페인 목표', v: objectiveLabel },
      {
        k: '성과 목표',
        v:
          goal.label +
          (goal.value === 'OFFSITE_CONVERSIONS'
            ? ` · ${CONVERSION_EVENTS.find((e) => e.value === conversionEvent)?.label || ''}`
            : ''),
      },
      {
        k: '예산',
        v:
          delivery.budgetType === 'daily'
            ? `일일 ${formatKoreanWon(delivery.dailyBudget) || '-'}${delivery.budgetKrw ? ` (최대 ${formatKoreanWon(delivery.budgetKrw)})` : ''}`
            : `총 ${formatKoreanWon(delivery.budgetKrw) || '-'}${delivery.dailyBudget ? ` (하루 약 ${formatKoreanWon(delivery.dailyBudget)})` : ''}`,
      },
      { k: '일정', v: `${delivery.startDate} ~ ${delivery.endDate} · ${delivery.days}일` },
      {
        k: '입찰 전략',
        v:
          (BID_STRATEGIES.find((b) => b.value === delivery.bidStrategy)?.label || '') +
          (delivery.bidStrategy !== 'lowest_cost' && delivery.bidAmount ? ` · ${delivery.bidAmount}원` : ''),
      },
      {
        k: '타겟',
        v:
          targetSummary({ ...delivery.payload(), ageBands: [] }) +
          (delivery.advantageAudience ? ' · Advantage+ 타겟' : '') +
          (delivery.excludedAudiences.length ? ` · 제외 ${delivery.excludedAudiences.length}개` : ''),
      },
      {
        k: '노출 위치',
        v: delivery.placementMode === 'auto' ? 'Advantage+ 노출 위치' : placementSummary(delivery),
      },
      {
        k: '연결',
        v: linkUrl.trim()
          ? `${AD_CTAS.find((c) => c.value === cta)?.label} · ${linkUrl.trim()}${urlTags.trim() ? `?${urlTags.trim().replace(/^\?/, '')}` : ''}`
          : '게시물로 연결(웹사이트 URL 없음)',
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objectiveLabel, goal, conversionEvent, delivery, linkUrl, cta, urlTags],
  );

  const runSteps = async (from: MetaAdRecord) => {
    setRunError('');
    setSubmitting(true);
    const result = await runRemainingSteps(businessUsername, from, (next) => setRecord(next));
    setRecord(result.record);
    setSubmitting(false);
    notifyMetaAdsChanged();
    onSubmitted?.(result.record);
    if (result.error) setRunError(result.error);
    else setDone(true);
  };

  const submit = async () => {
    if (!selectedAccount) {
      setError('광고를 만들 Meta 광고 계정을 골라 주세요.');
      return;
    }
    if (!page) {
      setError('광고를 내보낼 페이스북 페이지를 골라 주세요.');
      return;
    }
    const invalid = delivery.validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    if (linkUrl.trim() && !/^https?:\/\/\S+\.\S+/i.test(linkUrl.trim())) {
      setError('웹사이트 URL은 https:// 로 시작하는 주소로 입력해 주세요.');
      return;
    }
    if (goal.value === 'LANDING_PAGE_VIEWS' && !linkUrl.trim()) {
      setError('랜딩 페이지 조회 최적화는 웹사이트 URL이 있어야 합니다.');
      return;
    }
    if (needsPixel && !pixelId && goal.value !== 'OFFSITE_CONVERSIONS') {
      setError('이 성과 목표는 Meta 픽셀이 있어야 합니다. 다른 성과 목표를 골라 주세요.');
      return;
    }
    setError('');
    setRunError('');
    setSubmitting(true);
    setPhase('running');

    const created = resume
      ? await resumeMetaAd(businessUsername, resume.id, {
          pageId: page.id,
          initialStatus: startPaused ? 'PAUSED' : 'ACTIVE',
          ...settings(),
        })
      : await createMetaAd(businessUsername, {
          source: 'partnership',
          adAccountId: selectedAccount.id,
          pageId: page.id,
          initialStatus: startPaused ? 'PAUSED' : 'ACTIVE',
          campaignTitle,
          campaignRef: campaignId,
          collabId,
          creatorHandle,
          partnershipCode,
          thumbnailUrl: /^https:\/\//.test(thumbnailUrl) ? thumbnailUrl : '',
          ...settings(),
        });
    if (!created.ok) {
      if (created.record) {
        setRecord(created.record);
        notifyMetaAdsChanged();
      }
      setRunError(created.error);
      setSubmitting(false);
      return;
    }
    setRecord(created.record);
    await runSteps(created.record);
  };

  const retry = () => {
    if (record) void runSteps(record);
    else void submit();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 max-h-[90vh] modal-maxh-90 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-black text-slate-900">{resume ? '멈춘 광고 이어서 만들기' : '메타 광고로 부스팅'}</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {resume ? '설정을 확인하고 고친 뒤 다시 만듭니다' : '이력에서 고른 게시물을 그대로 광고 소재로 씁니다'}
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

        {phase === 'running' ? (
          <div className="p-5 md:p-6 overflow-y-auto space-y-4">
            {done ? (
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6 text-emerald-600" strokeWidth={3} />
                </div>
                <p className="text-sm font-black text-slate-900 mt-3">Meta에 광고가 만들어졌습니다</p>
                <p className="text-[12px] text-slate-500 font-bold mt-1.5 leading-relaxed">
                  {campaignTitle} · @{creatorHandle}
                  <br />
                  {objectiveLabel} · {goal.label}
                  <br />
                  {delivery.budgetType === 'daily'
                    ? `일일 예산 ${formatKoreanWon(delivery.dailyBudget)}`
                    : `총 예산 ${formatKoreanWon(delivery.budgetKrw)}`}{' '}
                  · {delivery.startDate} ~ {delivery.endDate}
                  {selectedAccount && (
                    <>
                      <br />
                      {page?.name} · {selectedAccount.name} · {selectedAccount.id}
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

            <MetaAdProgress record={record} running={submitting} error={runError} />

            {runError && !submitting && (
              <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5">
                <p className="text-[11px] font-black text-rose-700">Meta 응답</p>
                <p className="text-[11px] text-rose-600 font-medium mt-0.5 leading-relaxed break-words">{runError}</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              {runError && !submitting && (
                <button
                  type="button"
                  onClick={retry}
                  className="w-full py-3 rounded-xl bg-blue-600 text-white text-[12px] font-black hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {record ? '멈춘 단계부터 다시 시도' : '다시 시도'}
                </button>
              )}
              {runError && !submitting && (
                <button
                  type="button"
                  onClick={() => { setPhase('form'); setRunError(''); if (record) setFixing(true); }}
                  className="w-full py-3 rounded-xl border border-slate-200 text-slate-600 text-[12px] font-black hover:bg-slate-50 transition-colors"
                >
                  설정 고치기
                </button>
              )}
              {onViewAdStatus && !submitting && (
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
                disabled={submitting}
                className="w-full py-3 rounded-xl border border-slate-200 text-slate-500 text-[12px] font-black hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-y-auto px-5 py-4 space-y-5">
              {resume && <ResumeNotice record={resume} />}

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

              <AdSection title="캠페인">
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
                        disabled={!!resume}
                        className={`${selectCls} disabled:bg-slate-50 disabled:text-slate-500`}
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
                  // 연동이 없으면 고를 계정도 없다 — 연동은 광고 현황에서 한 번만 하면 된다.
                  <div className="mt-1.5 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                    <p className="text-[11px] font-black text-amber-800">
                      Meta 계정이 연동되지 않았습니다
                    </p>
                    <p className="text-[10px] text-amber-700 font-medium mt-0.5 leading-relaxed">
                      광고 현황 화면에서 Meta 계정을 연동하면 광고 계정과 페이지를 고르고 바로 집행할 수
                      있습니다.
                    </p>
                  </div>
                )}
              </div>


                <div>
                  <label className={labelCls} htmlFor="boost-campaign-name">캠페인 이름</label>
                  <input
                    id="boost-campaign-name"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    maxLength={150}
                    placeholder={`[PICKSfolio] ${campaignTitle || '부스팅'} · ${delivery.startDate}`}
                    className={inputCls}
                  />
                  <p className="text-[10px] text-slate-400 font-bold mt-1">비워 두면 위 이름으로 만들어집니다. 광고 관리자에서 이 이름으로 찾습니다.</p>
                </div>

                <div>
                  <p className={labelCls}>캠페인 목표</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-1.5">
                    {BOOST_OBJECTIVES.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => changeObjective(o.value)}
                        aria-pressed={objective === o.value}
                        className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                          objective === o.value
                            ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span className={`block text-[12px] font-black ${objective === o.value ? 'text-blue-700' : 'text-slate-800'}`}>
                          {o.label}
                        </span>
                        <span className="block text-[10px] text-slate-400 font-bold mt-0.5 leading-snug">{o.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </AdSection>

              <AdSection title="광고 세트">
                <div>
                  <label className={labelCls} htmlFor="boost-goal">성과 목표</label>
                  <div className="relative mt-1.5">
                    <select
                      id="boost-goal"
                      value={goal.value}
                      onChange={(e) => setOptimizationGoal(e.target.value)}
                      className={selectCls}
                    >
                      {goals.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold mt-1">{goal.hint}</p>
                </div>

                {needsPixel && connected && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls} htmlFor="boost-pixel">데이터 세트(픽셀)</label>
                      <div className="relative mt-1.5">
                        <select
                          id="boost-pixel"
                          value={pixelId}
                          onChange={(e) => setPixelId(e.target.value)}
                          disabled={pixelsLoading || pixels.length === 0}
                          className={`${selectCls} disabled:bg-slate-50 disabled:text-slate-400`}
                        >
                          {pixels.length === 0 && (
                            <option value="">{pixelsLoading ? '불러오는 중...' : '이 광고 계정에 픽셀이 없습니다'}</option>
                          )}
                          {pixels.map((px) => (
                            <option key={px.id} value={px.id}>{px.name} · {px.id}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    {goal.value === 'OFFSITE_CONVERSIONS' && (
                      <div>
                        <label className={labelCls} htmlFor="boost-event">전환 이벤트</label>
                        <div className="relative mt-1.5">
                          <select
                            id="boost-event"
                            value={conversionEvent}
                            onChange={(e) => setConversionEvent(e.target.value)}
                            className={selectCls}
                          >
                            {CONVERSION_EVENTS.map((ev) => (
                              <option key={ev.value} value={ev.value}>{ev.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>
                    )}
                    {!pixelsLoading && pixels.length === 0 && (
                      <p className="sm:col-span-2 text-[10px] text-amber-600 font-bold leading-relaxed">
                        {goal.value === 'OFFSITE_CONVERSIONS'
                          ? '픽셀이 없으면 전환 대신 링크 클릭 최적화로 집행하고, 그 사실을 진행 화면에 적습니다.'
                          : '이 성과 목표는 픽셀이 있어야 합니다. 링크 클릭수 최대화를 골라 주세요.'}
                      </p>
                    )}
                  </div>
                )}

                {canCapFrequency && (
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={freqOn}
                        onChange={(e) => setFreqOn(e.target.checked)}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span className="text-[11px] font-black text-slate-600">빈도 제한</span>
                    </label>
                    {freqOn && (
                      <div className="flex items-center gap-2 mt-1.5 text-[12px] font-bold text-slate-600">
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={freqDays}
                          onChange={(e) => setFreqDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                          aria-label="빈도 제한 기간(일)"
                          className="w-16 px-2 py-2 rounded-xl border border-slate-200 text-center"
                        />
                        일마다 최대
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={freqImpressions}
                          onChange={(e) => setFreqImpressions(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
                          aria-label="최대 노출 횟수"
                          className="w-16 px-2 py-2 rounded-xl border border-slate-200 text-center"
                        />
                        회 노출
                      </div>
                    )}
                  </div>
                )}
              </AdSection>

              <AdDeliveryFields
                delivery={delivery}
                idPrefix="boost"
                username={connected ? businessUsername : undefined}
                adAccountId={connected ? adAccountId : undefined}
              />

              <AdSection title="광고">
                {connected && (
                <div>
                  <p className={labelCls}>광고 페이지</p>
                  <MetaPagePicker
                    pages={pagesState.pages}
                    selectedId={page?.id}
                    onSelect={selectPage}
                    loading={pagesState.loading}
                    error={pagesState.error}
                    onRetry={pagesState.refresh}
                  />
                  <p className="text-[10px] text-slate-400 font-bold mt-1">
                    브랜드 쪽으로 표시될 페이스북 페이지입니다(연동한 Meta 계정이 관리하는 페이지)
                  </p>
                </div>
              )}


                <div>
                  <label className={labelCls} htmlFor="boost-url">
                    웹사이트 URL{needsUrl ? '' : ' (선택)'}
                  </label>
                  <input
                    id="boost-url"
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://brand.com/product"
                    className={inputCls}
                  />
                  <p className="text-[10px] text-slate-400 font-bold mt-1">
                    {linkUrl.trim()
                      ? '파트너십 광고 아래에 버튼이 붙고, 누르면 이 주소로 이동합니다'
                      : needsUrl
                      ? '비워 두면 인플루언서 게시물로 연결됩니다. 판매 · 트래픽은 URL을 넣어야 성과가 측정됩니다'
                      : '넣으면 게시물 아래에 버튼이 붙습니다'}
                  </p>
                </div>

                {linkUrl.trim() && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls} htmlFor="boost-cta">클릭 유도 문구(CTA)</label>
                      <div className="relative mt-1.5">
                        <select id="boost-cta" value={cta} onChange={(e) => setCta(e.target.value as AdCta)} className={selectCls}>
                          {AD_CTAS.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="boost-utm">URL 매개변수</label>
                      <input
                        id="boost-utm"
                        value={urlTags}
                        onChange={(e) => setUrlTags(e.target.value)}
                        placeholder="utm_source=meta&utm_medium=paid"
                        className={inputCls}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setUrlTags(
                          `utm_source=meta&utm_medium=paid_social&utm_campaign=${encodeURIComponent(
                            (campaignTitle || 'boost').replace(/\s+/g, '_').slice(0, 40),
                          )}&utm_content=${encodeURIComponent(creatorHandle)}`,
                        )
                      }
                      className="sm:col-span-2 justify-self-start text-[10px] font-black text-blue-600 hover:text-blue-700"
                    >
                      UTM 기본값 채우기
                    </button>
                  </div>
                )}
              </AdSection>


              {/* 광고 관리자 오른쪽 패널 자리 — 타겟 규모와 지금 설정 한눈에 보기. */}
              <section className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <p className="text-[12px] font-black text-slate-900">예상 타겟 규모</p>
                  <span className="ml-auto text-[12px] font-black text-blue-700">
                    {!connected
                      ? '-'
                      : estimateState === 'loading'
                      ? '계산 중...'
                      : estimate
                      ? `${estimate.lower.toLocaleString()} ~ ${estimate.upper.toLocaleString()}명`
                      : '계산할 수 없음'}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-[84px_1fr] gap-x-3 gap-y-1.5">
                  {summaryRows.map((row) => (
                    <React.Fragment key={row.k}>
                      <dt className="text-[11px] font-black text-slate-400">{row.k}</dt>
                      <dd className="text-[11px] font-bold text-slate-700 break-all">{row.v}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                <p className="text-[10px] text-slate-400 font-medium mt-2 leading-relaxed">
                  타겟 규모는 Meta가 알려 주는 추정치이며 실제 결과를 보장하지 않습니다.
                </p>
              </section>

              <StartPausedToggle checked={startPaused} onChange={setStartPaused} />
            </div>

            <div className="border-t border-slate-100 px-5 py-4 bg-white">
              {error && <p className="text-[11px] text-rose-500 font-black mb-2">{error}</p>}
              {connected && !page && !submitting && (
                <p className="text-[11px] text-blue-600 font-black mb-2">광고 페이지를 선택해 주세요</p>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !selectedAccount || !page}
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

export default AdBoostModal;
