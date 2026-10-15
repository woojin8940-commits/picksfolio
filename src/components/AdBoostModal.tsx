import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Handshake,
  Heart,
  Loader2,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  RotateCcw,
  Send,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { useMetaAdConnection } from '../hooks/useMetaAdConnection';
import { useMetaPages } from '../hooks/useMetaPages';
import { formatKoreanWon } from '../utils/formatters';
import {
  MetaAdRecord,
  createMetaAd,
  estimateMetaAudience,
  notifyMetaAdsChanged,
  resumeMetaAd,
  runRemainingSteps,
} from '../utils/metaAdsApi';
import {
  AdCta,
  BID_STRATEGIES,
  BOOST_OBJECTIVES,
  BoostObjective,
  CONVERSION_EVENTS,
  PERFORMANCE_GOALS,
  ctaLabel,
  ctasForObjective,
  placementSummary,
  targetSummary,
} from '../utils/adBoosts';
import { AdDeliveryFields, AdSection, Segmented, fieldCls, inputCls, labelCls, selectCls, useAdDelivery } from './AdDeliveryFields';
import MetaAdProgress from './MetaAdProgress';
import MetaPagePicker from './MetaPagePicker';
import MetaPixelField from './MetaPixelField';
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
 * 광고 단계는 광고 관리자의 광고 화면 순서를 따른다 — 광고 이름 → 아이덴티티(페이지 ·
 * 인스타그램 계정) → 도착 위치(웹사이트 / 게시물) → 웹사이트 URL · 표시 링크 · CTA ·
 * URL 매개변수 → 미리보기. 도착 위치를 먼저 고르게 해서 CTA 버튼이 붙는지, 누르면 어디로
 * 가는지가 입력하기 전부터 보이게 한다(예전처럼 URL 을 넣어야 CTA 칸이 나타나면 브랜드는
 * 버튼을 붙일 수 있다는 것 자체를 모른다).
 *
 * 이 창은 파트너십 광고만 만든다. 그래서 광고 관리자의 단계를 그대로 늘어놓지 않고, 파트너십
 * 광고에서 브랜드가 실제로 정해야 하는 것만 한 화면에 위에서 아래로 둔다 — 무엇을 늘릴지(목표) →
 * 브랜드 계정 → 버튼과 링크 → 예산 · 기간 → 타겟. 성과 목표 · 픽셀 · 입찰 · 노출 위치 · 이름 같은
 * 광고 관리자 세부 값은 '고급 설정' 에 접어 두고, 펼치지 않으면 Meta 권장값(기본값)으로 나간다.
 * 오른쪽(모바일에서는 버튼 아래)에는 Instagram 피드 모양 미리보기를 띄워서 버튼 문구와 이동 주소가
 * 어떻게 나가는지 바로 보이게 한다. 버튼은 드롭다운 대신 실제 버튼 모양으로 늘어놓는다.
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

/** 파트너십 광고에서 브랜드가 실제로 원하는 결과의 말로 적은 목표. 괄호 안이 광고 관리자 이름이다. */
const SIMPLE_OBJECTIVES: Record<BoostObjective, { label: string; hint: string; Icon: React.ElementType }> = {
  conversions: { label: '구매 늘리기', hint: '웹사이트 구매 · 장바구니 (Meta: 판매)', Icon: ShoppingBag },
  traffic: { label: '방문 늘리기', hint: '웹사이트 · 상품 페이지 방문 (Meta: 트래픽)', Icon: MousePointerClick },
  engagement: { label: '반응 늘리기', hint: '좋아요 · 댓글 · 영상 조회 (Meta: 참여)', Icon: MessageCircle },
  awareness: { label: '많이 알리기', hint: '최대한 많은 사람에게 노출 (Meta: 인지도)', Icon: Megaphone },
};
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
  const [adSetName, setAdSetName] = useState('');
  const [adName, setAdName] = useState('');
  /** 광고 관리자의 '도착 위치'. 웹사이트면 CTA 버튼이 붙고, 게시물이면 버튼 없이 게시물 그대로 나간다. */
  const [destination, setDestination] = useState<'website' | 'post'>('website');
  const [linkUrl, setLinkUrl] = useState('');
  const [displayLink, setDisplayLink] = useState('');
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
  const [showAllCtas, setShowAllCtas] = useState(false);
  /** 광고 관리자 세부 값(성과 목표 · 입찰 · 노출 위치 · 이름 …). 대부분 기본값이 맞아서 접어 둔다. */
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  // 광고에 쓸 수 있는 페이지가 하나뿐이면 고를 것도 없다 — 바로 채운다.
  useEffect(() => {
    if (!open || pageId) return;
    const usable = pagesState.pages.filter((p) => p.canAdvertise && p.instagramUsername);
    if (usable.length === 1) setPageId(usable[0].id);
  }, [open, pageId, pagesState.pages]);
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
    setAdSetName(resume.adSetName || '');
    setAdName(resume.adName || '');
    setDestination(resume.linkUrl ? 'website' : 'post');
    setLinkUrl(resume.linkUrl || '');
    setDisplayLink(resume.displayLink || '');
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
    setCta(next === 'conversions' ? 'shop_now' : next === 'traffic' ? 'see_more' : 'learn_more');
    // 판매 · 트래픽은 웹사이트로 보내야 성과가 측정된다. 다른 목표는 고른 도착 위치를 둔다.
    if (next === 'conversions' || next === 'traffic') setDestination('website');
  };

  const goals = PERFORMANCE_GOALS[objective];
  const goal = goals.find((g) => g.value === optimizationGoal) || goals[0];
  /** 픽셀이 필요한 성과 목표. 판매 목표의 전환 최적화와 랜딩 페이지 조회가 그렇다. */
  const needsPixel = ['OFFSITE_CONVERSIONS', 'VALUE', 'LANDING_PAGE_VIEWS'].includes(goal.value);
  /** 웹사이트로 보내는 목표. 연결 URL 이 있어야 성과가 측정된다. */
  const needsUrl = objective === 'conversions' || objective === 'traffic';
  /** 빈도 제한은 메타가 도달 최적화에서만 받는다. */
  const canCapFrequency = goal.value === 'REACH';

  /**
   * 데이터 세트(픽셀) 칸. 판매는 이 픽셀로 최적화하고, 다른 목적은 광고의 웹사이트 이벤트
   * 추적(tracking_specs)으로만 붙인다 — 광고 관리자처럼 어느 목적이든 광고를 보고 들어온 사람의
   * 구매 · 장바구니가 광고 현황에 잡힌다.
   */
  const pixelMode = objective === 'conversions' ? 'optimize' : 'track';

  /** 웹사이트로 보낼 때만 URL · CTA 를 싣는다. 게시물로 보내면 버튼 없이 나간다. */
  const toWebsite = destination === 'website';
  const cleanUrl = toWebsite ? linkUrl.trim() : '';
  const cleanTags = urlTags.trim().replace(/^\?/, '');
  /** 버튼을 눌렀을 때 실제로 열리는 주소 — 메타가 URL 매개변수를 붙인 결과와 같다. */
  const finalUrl = cleanUrl ? `${cleanUrl}${cleanTags ? `${cleanUrl.includes('?') ? '&' : '?'}${cleanTags}` : ''}` : '';
  const urlDomain = (() => {
    try {
      return cleanUrl ? new URL(cleanUrl).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  })();
  const ctaOptions = ctasForObjective(objective === 'engagement' ? 'awareness' : objective);

  /** 광고 관리자와 같은 설정 묶음. 집행 · 이어서 만들기 · 타겟 규모 추정이 같은 값을 쓴다. */
  const settings = () => ({
    objective,
    optimizationGoal: goal.value,
    conversionEvent: goal.value === 'OFFSITE_CONVERSIONS' ? conversionEvent : goal.value === 'VALUE' ? 'PURCHASE' : undefined,
    pixelId: pixelId || undefined,
    campaignName: campaignName.trim() || undefined,
    adSetName: adSetName.trim() || undefined,
    adName: adName.trim() || undefined,
    linkUrl: cleanUrl || undefined,
    displayLink: (cleanUrl && displayLink.trim()) || undefined,
    cta: cleanUrl ? cta : undefined,
    urlTags: (cleanUrl && cleanTags) || undefined,
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
      { k: '목표', v: SIMPLE_OBJECTIVES[objective].label },
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
      { k: '브랜드', v: page?.instagramUsername ? `@${page.instagramUsername} × @${creatorHandle}` : '-' },
      { k: '버튼', v: toWebsite ? ctaLabel(cta) : '버튼 없음' },
      ...(toWebsite
        ? [
            { k: '이동 주소', v: finalUrl || '-' },
            ...(displayLink.trim() ? [{ k: '표시 링크', v: displayLink.trim() }] : []),
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objective, page, creatorHandle, objectiveLabel, goal, conversionEvent, delivery, toWebsite, finalUrl, cta, displayLink],
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

  /** 아직 채우지 않은 필수 항목. 위에서부터 순서대로 하나씩 안내한다. */
  const problems = [
    !selectedAccount ? '광고를 만들 Meta 광고 계정이 필요합니다. 광고 현황에서 Meta 계정을 연동해 주세요.' : '',
    !page ? '브랜드 계정(페이스북 페이지)을 골라 주세요.' : '',
    page && !page.instagramUsername ? 'Instagram 계정이 연결된 브랜드 페이지를 골라 주세요.' : '',
    toWebsite && !cleanUrl ? '버튼을 누르면 이동할 주소를 입력해 주세요.' : '',
    cleanUrl && !/^https?:\/\/\S+\.\S+/i.test(cleanUrl) ? '이동할 주소는 https:// 로 시작하는 주소로 입력해 주세요.' : '',
    goal.value === 'LANDING_PAGE_VIEWS' && !cleanUrl ? '랜딩 페이지 조회 최적화는 이동할 주소가 있어야 합니다.' : '',
    delivery.validate(),
  ].filter(Boolean);

  const submit = async () => {
    if (problems.length || !selectedAccount || !page) {
      setError(problems[0] || '설정을 확인해 주세요.');
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


  /** 처음에는 목표에 어울리는 버튼만 보여 주고, 고른 버튼이 뒤쪽이면 같이 둔다. */
  const visibleCtas = showAllCtas
    ? ctaOptions
    : (() => {
        const top = ctaOptions.slice(0, 6);
        const picked = ctaOptions.find((c) => c.value === cta);
        return picked && !top.includes(picked) ? [...top, picked] : top;
      })();
  const recommendedCtas = new Set(ctaOptions.slice(0, 3).map((c) => c.value));
  const urlReady = /^https?:\/\/\S+\.\S+/i.test(finalUrl);
  const defaultName = `[PICKSfolio] ${campaignTitle || '부스팅'} · ${delivery.startDate}`;

  /** 인스타그램 피드에서 보이는 모양 그대로의 미리보기. */
  const adPreview = (
    <div>
      <div className="mx-auto w-full max-w-[300px] rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="relative w-9 h-8 flex-shrink-0">
            <div className="absolute left-0 top-0 w-7 h-7 rounded-full bg-gradient-to-br from-fuchsia-400 to-amber-300 p-[2px]">
              <div className="w-full h-full rounded-full bg-slate-200 overflow-hidden">
                {thumbnailUrl && <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />}
              </div>
            </div>
            <div className="absolute right-0 bottom-0 w-5 h-5 rounded-full bg-slate-300 border-2 border-white overflow-hidden">
              {page?.pictureUrl && <img src={page.pictureUrl} alt="" className="w-full h-full object-cover" />}
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black text-slate-900 truncate">
              {creatorHandle} <span className="font-bold text-slate-500">및</span>{' '}
              {page?.instagramUsername || page?.name || '브랜드'}
            </p>
            <p className="text-[9px] text-slate-400 font-bold">광고 · 파트너십</p>
          </div>
        </div>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full aspect-[4/5] object-cover bg-slate-100" />
        ) : (
          <div className="w-full aspect-[4/5] bg-slate-100 flex items-center justify-center text-[10px] text-slate-400 font-black">
            게시물 소재
          </div>
        )}
        {toWebsite && (
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-blue-600 text-white">
            <span className="text-[12px] font-black">{ctaLabel(cta)}</span>
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          </div>
        )}
        <div className="px-3 pt-2.5 pb-3">
          <div className="flex items-center gap-3 text-slate-700">
            <Heart className="w-4 h-4" />
            <MessageCircle className="w-4 h-4" />
            <Send className="w-4 h-4" />
          </div>
          <p className="text-[10px] text-slate-600 font-medium mt-1.5 leading-snug">
            <span className="font-black text-slate-900">{creatorHandle}</span> 게시물 글과 해시태그가 그대로 노출됩니다
          </p>
          {toWebsite && (displayLink.trim() || urlDomain) && (
            <p className="text-[9px] text-slate-400 font-bold mt-1 truncate">
              표시 링크 · {displayLink.trim() || urlDomain}
            </p>
          )}
        </div>
      </div>
      <div
        className={`mt-2.5 rounded-xl px-3 py-2 text-[10px] font-bold leading-relaxed break-all ${
          toWebsite && finalUrl ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-500'
        }`}
      >
        {toWebsite
          ? finalUrl
            ? <>‘{ctaLabel(cta)}’ 버튼을 누르면 이동 → {finalUrl}</>
            : '웹사이트 URL을 입력하면 버튼을 눌렀을 때 이동할 주소가 여기에 표시됩니다'
          : '버튼 없이 게시물 그대로 노출 · 누르면 인스타그램 게시물로 연결'}
      </div>
    </div>
  );

  /** 광고 관리자 오른쪽 패널 자리 — 타겟 규모와 지금 설정 한눈에 보기. */
  const summaryPanel = (
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
      <dl className="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5">
        {summaryRows.filter((row) => !['성과 목표', '입찰 전략', '노출 위치'].includes(row.k)).map((row) => (
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
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`relative w-full ${phase === 'form' ? 'max-w-5xl' : 'max-w-2xl'} bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 max-h-[90vh] modal-maxh-90 flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <p className="text-sm font-black text-slate-900">{resume ? '멈춘 광고 이어서 만들기' : '파트너십 광고 만들기'}</p>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              {resume
                ? '설정을 확인하고 고친 뒤 다시 만듭니다'
                : `@${creatorHandle}의 게시물을 브랜드와 함께 Meta 광고로 내보냅니다`}
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
                  {toWebsite && (
                    <>
                      <br />‘{ctaLabel(cta)}’ 버튼 → {urlDomain || cleanUrl}
                    </>
                  )}
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
            <div className="overflow-y-auto flex-1 bg-slate-50/60">
              <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 px-4 sm:px-5 py-4">
                <div className="space-y-4 min-w-0">
                  {resume && <ResumeNotice record={resume} />}

                  {/* 이 광고가 무엇인지 — 크리에이터 게시물 × 브랜드. 고르는 항목이 아니라 확인용이다. */}
                  <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-2xl p-3">
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="w-12 aspect-[9/16] rounded-xl object-cover bg-slate-200 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 aspect-[9/16] rounded-xl bg-slate-200 flex-shrink-0 flex items-center justify-center">
                        <span className="text-[9px] text-slate-400 font-black">소재</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-black text-slate-900 leading-snug">
                        @{creatorHandle}의 게시물을 파트너십 광고로 내보냅니다
                      </p>
                      <p className="text-[11px] text-slate-500 font-bold mt-1 truncate">{campaignTitle}</p>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                        게시물 사진·영상·글은 크리에이터가 올린 그대로 나가고, 브랜드 계정이 함께 표시됩니다
                      </p>
                    </div>
                  </div>

                  <AdSection title="무엇을 늘리고 싶나요?" desc="고른 목표에 맞춰 Meta가 광고를 보여 줄 사람을 찾습니다." done>
                    <div className="grid grid-cols-2 gap-2">
                      {BOOST_OBJECTIVES.map((o) => {
                        const on = objective === o.value;
                        const meta = SIMPLE_OBJECTIVES[o.value];
                        return (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => changeObjective(o.value)}
                            aria-pressed={on}
                            className={`flex items-start gap-2.5 text-left px-3 py-3 rounded-xl border transition-colors ${
                              on ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' : 'bg-white border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? 'bg-blue-100' : 'bg-slate-100'}`}>
                              <meta.Icon className={`w-4 h-4 ${on ? 'text-blue-700' : 'text-slate-600'}`} />
                            </span>
                            <span className="min-w-0">
                              <span className={`block text-[13px] font-black ${on ? 'text-blue-700' : 'text-slate-800'}`}>{meta.label}</span>
                              <span className="block text-[10px] text-slate-400 font-bold mt-0.5 leading-snug">{meta.hint}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </AdSection>

                  {/* 브랜드 계정 — 파트너십 광고에서 크리에이터 옆에 표시될 쪽. */}
                  <AdSection title="브랜드 계정" desc="광고에 크리에이터와 함께 표시될 브랜드 계정입니다." done={!!page && !!page.instagramUsername}>
                    {connected ? (
                      <>
                        <MetaPagePicker
                          pages={pagesState.pages}
                          selectedId={page?.id}
                          onSelect={selectPage}
                          loading={pagesState.loading}
                          error={pagesState.error}
                          onRetry={pagesState.refresh}
                        />
                        <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                          <div className="flex-1 min-w-0 text-center">
                            <p className="text-[10px] font-black text-slate-400">크리에이터</p>
                            <p className="text-[12px] font-black text-slate-900 truncate">@{creatorHandle}</p>
                          </div>
                          <Handshake className="w-5 h-5 text-blue-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0 text-center">
                            <p className="text-[10px] font-black text-slate-400">브랜드</p>
                            <p className={`text-[12px] font-black truncate ${page?.instagramUsername ? 'text-slate-900' : 'text-slate-400'}`}>
                              {page?.instagramUsername ? `@${page.instagramUsername}` : page ? 'Instagram 연결 필요' : '위에서 선택'}
                            </p>
                          </div>
                        </div>
                        {page && !page.instagramUsername && (
                          <p className="text-[10px] text-amber-600 font-bold">
                            이 페이지에 연결된 Instagram 프로페셔널 계정이 없어 파트너십 광고를 만들 수 없습니다
                          </p>
                        )}
                        {accounts.length > 1 && (
                          <div>
                            <label className={labelCls} htmlFor="boost-ad-account">광고비를 결제할 광고 계정</label>
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
                          </div>
                        )}
                      </>
                    ) : (
                      // 연동이 없으면 고를 계정도 없다 — 연동은 광고 현황에서 한 번만 하면 된다.
                      <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5">
                        <p className="text-[11px] font-black text-amber-800">Meta 계정이 연동되지 않았습니다</p>
                        <p className="text-[10px] text-amber-700 font-medium mt-0.5 leading-relaxed">
                          광고 현황 화면에서 Meta 계정을 연동하면 브랜드 계정을 고르고 바로 광고를 올릴 수 있습니다.
                        </p>
                      </div>
                    )}
                  </AdSection>

                  <AdSection
                    title="버튼과 링크"
                    desc="광고 아래에 버튼을 달고, 누르면 이동할 주소를 정합니다."
                    done={!toWebsite || urlReady}
                  >
                    <Segmented
                      value={destination}
                      onChange={(v) => !(v === 'post' && needsUrl) && setDestination(v)}
                      options={[
                        { value: 'website', label: '버튼 달기' },
                        { value: 'post', label: '버튼 없이 게시물만' },
                      ]}
                    />
                    {needsUrl && (
                      <p className="text-[10px] text-slate-400 font-bold -mt-2">
                        '{SIMPLE_OBJECTIVES[objective].label}' 목표는 웹사이트로 보내야 성과가 측정되어 버튼이 필요합니다
                      </p>
                    )}

                    {toWebsite ? (
                      <>
                        <div>
                          <p className={labelCls}>버튼 문구</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                            {visibleCtas.map((c) => {
                              const on = cta === c.value;
                              return (
                                <button
                                  key={c.value}
                                  type="button"
                                  onClick={() => setCta(c.value)}
                                  aria-pressed={on}
                                  className={`relative flex items-center justify-between gap-1 px-3 py-2.5 rounded-xl border text-[12px] font-black transition-colors ${
                                    on
                                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                      : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/40'
                                  }`}
                                >
                                  <span className="truncate">{c.label}</span>
                                  {on ? (
                                    <Check className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={3} />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-slate-300" />
                                  )}
                                  {recommendedCtas.has(c.value) && !on && (
                                    <span className="absolute -top-1.5 left-2 px-1 rounded bg-emerald-50 border border-emerald-100 text-[8px] font-black text-emerald-700">
                                      추천
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowAllCtas((v) => !v)}
                            className="mt-2 inline-flex items-center gap-1 text-[11px] font-black text-blue-600 hover:text-blue-700"
                          >
                            {showAllCtas ? '추천 버튼만 보기' : `다른 버튼 문구 보기 (${ctaOptions.length}개)`}
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllCtas ? 'rotate-180' : ''}`} />
                          </button>
                        </div>

                        <div>
                          <label className={labelCls} htmlFor="boost-url">버튼을 누르면 이동할 주소 *</label>
                          <div className="flex gap-1.5 mt-1.5">
                            <input
                              id="boost-url"
                              type="url"
                              value={linkUrl}
                              onChange={(e) => setLinkUrl(e.target.value)}
                              placeholder="https://brand.com/product"
                              className={`${fieldCls} flex-1 min-w-0`}
                            />
                            <a
                              href={urlReady ? finalUrl : undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-disabled={!urlReady}
                              className={`flex-shrink-0 inline-flex items-center gap-1 px-3 rounded-xl border text-[11px] font-black ${
                                urlReady
                                  ? 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                  : 'border-slate-100 text-slate-300 pointer-events-none'
                              }`}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              열어 보기
                            </a>
                          </div>
                          <p className="text-[10px] text-slate-400 font-bold mt-1">
                            상품 상세 페이지처럼 바로 구매·신청할 수 있는 주소가 좋습니다
                          </p>
                        </div>
                      </>
                    ) : (
                      <p className="text-[11px] text-slate-500 font-bold rounded-xl bg-slate-50 px-3 py-2.5 leading-relaxed">
                        버튼 없이 크리에이터 게시물 그대로 나갑니다. 광고를 누르면 Instagram 게시물로 연결됩니다.
                      </p>
                    )}
                  </AdSection>

                  {/* 좁은 화면에는 오른쪽 패널이 없어서, 버튼을 고른 바로 아래에 미리보기를 둔다. */}
                  <div className="lg:hidden">
                    <AdSection title="광고 미리보기" desc="Instagram 피드에서 보이는 모습입니다.">
                      {adPreview}
                    </AdSection>
                  </div>

                  <AdDeliveryFields
                    delivery={delivery}
                    idPrefix="boost"
                    username={connected ? businessUsername : undefined}
                    adAccountId={connected ? adAccountId : undefined}
                    part="basic"
                  />

                  {/* 광고 관리자에만 있던 세부 값. 기본값 그대로 두면 Meta 권장 설정으로 나간다. */}
                  <section className="rounded-2xl border border-slate-100 bg-white">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      aria-expanded={showAdvanced}
                      className="w-full flex items-center gap-2 px-4 py-3.5 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-black text-slate-900">
                          고급 설정 <span className="ml-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-black text-slate-500">선택</span>
                        </span>
                        <span className="block text-[10px] text-slate-400 font-bold mt-0.5 truncate">
                          {goal.label} · {BID_STRATEGIES.find((b) => b.value === delivery.bidStrategy)?.label} ·{' '}
                          {delivery.placementMode === 'auto' ? '자동 노출 위치' : '수동 노출 위치'} · 그대로 두면 Meta 권장값
                        </span>
                      </span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                    </button>
                    {showAdvanced && (
                      <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-4">
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

                        {connected && adAccountId && (
                          <MetaPixelField
                            businessUsername={businessUsername}
                            adAccountId={adAccountId}
                            pixelId={pixelId}
                            onChange={setPixelId}
                            mode={pixelMode}
                          />
                        )}

                        {objective === 'conversions' && needsPixel && connected && goal.value === 'OFFSITE_CONVERSIONS' && (
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

                        <AdDeliveryFields
                          delivery={delivery}
                          idPrefix="boost-adv"
                          username={connected ? businessUsername : undefined}
                          adAccountId={connected ? adAccountId : undefined}
                          part="advanced"
                        />

                        {toWebsite && (
                          <>
                            <div>
                              <label className={labelCls} htmlFor="boost-display-link">표시 링크</label>
                              <input
                                id="boost-display-link"
                                value={displayLink}
                                onChange={(e) => setDisplayLink(e.target.value)}
                                maxLength={100}
                                placeholder={urlDomain || 'brand.com'}
                                className={inputCls}
                              />
                              <p className="text-[10px] text-slate-400 font-bold mt-1">
                                광고에 보이기만 하는 주소입니다. 실제 이동은 위 주소로 합니다
                              </p>
                            </div>
                            <div>
                              <label className={labelCls} htmlFor="boost-utm">URL 매개변수</label>
                              <input
                                id="boost-utm"
                                value={urlTags}
                                onChange={(e) => setUrlTags(e.target.value)}
                                placeholder="key1=value1&key2=value2"
                                className={inputCls}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setUrlTags(
                                    `utm_source=meta&utm_medium=paid_social&utm_campaign=${encodeURIComponent(
                                      (campaignTitle || 'boost').replace(/\s+/g, '_').slice(0, 40),
                                    )}&utm_content=${encodeURIComponent(creatorHandle)}`,
                                  )
                                }
                                className="mt-1.5 text-[11px] font-black text-blue-600 hover:text-blue-700"
                              >
                                URL 매개변수 자동으로 만들기
                              </button>
                            </div>
                          </>
                        )}

                        <div>
                          <p className={labelCls}>광고 관리자에 보일 이름</p>
                          <div className="space-y-1.5 mt-1.5">
                            <input
                              aria-label="캠페인 이름"
                              value={campaignName}
                              onChange={(e) => setCampaignName(e.target.value)}
                              maxLength={150}
                              placeholder={`캠페인 · ${defaultName}`}
                              className={fieldCls}
                            />
                            <input
                              aria-label="광고 세트 이름"
                              value={adSetName}
                              onChange={(e) => setAdSetName(e.target.value)}
                              maxLength={150}
                              placeholder={`광고 세트 · ${campaignName.trim() || defaultName} · 광고 세트`}
                              className={fieldCls}
                            />
                            <input
                              aria-label="광고 이름"
                              value={adName}
                              onChange={(e) => setAdName(e.target.value)}
                              maxLength={150}
                              placeholder={`광고 · ${campaignName.trim() || defaultName}`}
                              className={fieldCls}
                            />
                          </div>
                          <p className="text-[10px] text-slate-400 font-bold mt-1">비워 두면 회색 이름으로 만들어집니다</p>
                        </div>
                      </div>
                    )}
                  </section>

                  <div className="lg:hidden">{summaryPanel}</div>

                  <StartPausedToggle checked={startPaused} onChange={setStartPaused} />
                </div>

                <aside className="hidden lg:block">
                  <div className="sticky top-0 space-y-4">
                    <div className="rounded-2xl border border-slate-100 bg-white p-4">
                      <p className="text-[12px] font-black text-slate-900">광고 미리보기</p>
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5 mb-3">Instagram 피드에서 보이는 모습입니다</p>
                      {adPreview}
                    </div>
                    {summaryPanel}
                  </div>
                </aside>
              </div>
            </div>

            <div className="border-t border-slate-100 px-5 py-4 bg-white">
              {error ? (
                <p className="text-[11px] text-rose-500 font-black mb-2">{error}</p>
              ) : (
                problems.length > 0 && (
                  <p className="text-[11px] text-blue-600 font-black mb-2">남은 항목: {problems[0]}</p>
                )
              )}
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-[13px] font-black hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? '광고 만드는 중' : resume ? '이 설정으로 이어서 만들기' : '파트너십 광고 올리기'}
              </button>
              <p className="text-[10px] text-slate-400 font-medium mt-2 text-center leading-relaxed">
                {resume
                  ? '멈출 때까지 만들어 둔 캠페인은 지우고, 이 설정으로 캠페인부터 다시 만듭니다.'
                  : startPaused
                  ? 'Meta에 일시중지 상태로 만듭니다(과금 없음).'
                  : 'Meta 검토가 끝나면 노출과 과금이 시작됩니다.'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdBoostModal;
