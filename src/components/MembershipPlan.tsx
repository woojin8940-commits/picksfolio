import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { toAsciiSafeId } from '../utils/formatters';
import { loadPortOne } from '../utils/externalScripts';
import { payClaudePlan } from '../utils/claudeCharge';
import { useLanguage } from '../contexts/LanguageContext';
import {
  PORTONE_STORE_ID,
  channelKeyFor,
  easyPayParam,
  portoneBillingKeyMethod,
  portoneRedirectUrl,
  savePortOneIntent,
  clearPortOneIntent,
  genPortOneId,
} from '../utils/portonePayments';
import { isNativeApp } from '../utils/appEnv';
import {
  PRO_PRICE,
  STANDARD_AI_PRICE,
  STANDARD_PRICE,
  TIER_LABEL,
  TIER_PRICE,
  TIER_RANK,
  normalizeTier,
  type MembershipTier,
} from '../utils/membershipTiers';
import type { SellerVerification } from '../types';

interface MembershipPlanProps {
  userName: string;
}

// PortOne V2 — storeId and channelKey are public identifiers used by the
// browser SDK. The V2 API secret lives server-side only (PORTONE_V2_API_SECRET).
// 카드(나이스정보통신) / 토스페이 / 카카오페이 멤버십 빌링키 발급을 모두 PortOne V2
// 리다이렉트 방식으로 처리한다.

// Claude plan (separate prepaid AI add-on) — activated by its own PortOne payment
// window opened from this page. Keep these figures in sync with the server's
// claude-credits pricing module.
const ACTIVATION_PRICE_KRW = 9900;
const ACTIVATION_GRANT_CREDITS = 3000;

const MembershipPlan: React.FC<MembershipPlanProps> = ({ userName }) => {
  const { language, t } = useLanguage();
  const normalizedUserName = userName.replace(/^biz\//, '');
  const [verification, setVerification] = useState<SellerVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'CARD' | 'KAKAOPAY' | 'TOSSPAY'>('CARD');
  // 결제 대상 플랜 — 멤버십 티어.
  const [selectedTier, setSelectedTier] = useState<MembershipTier>('standard');
  // 카드(신용카드) 정기결제 등록용 카드 정보. NICE V2 는 카드 빌링키를 수기(키인) 방식으로만
  // 발급하므로 카드 정보를 직접 입력받아 서버로 전달한다(저장하지 않음).
  const [cardForm, setCardForm] = useState({ number: '', expiry: '', birth: '', pw2: '' });

  // Claude plan (prepaid AI add-on, billed separately from the memberships above).
  // Activating it opens a PortOne payment window right here; the base monthly grant
  // of ACTIVATION_GRANT_CREDITS credits is added server-side once the payment clears.
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [claudePaying, setClaudePaying] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [claudeActive, setClaudeActive] = useState(false);
  const [claudeBalance, setClaudeBalance] = useState<number | null>(null);
  // 환불(결제 취소)로 회수된 누적 크레딧. 0 보다 크면 잔액이 줄어든 이유를 함께 안내한다.
  const [claudeRefunded, setClaudeRefunded] = useState(0);
  const [claudeSyncing, setClaudeSyncing] = useState(false);

  const loadVerification = useCallback(async () => {
    setLoading(true);
    const data = await apiService.getSellerVerification(normalizedUserName);
    setVerification(data);
    setLoading(false);
  }, [normalizedUserName]);

  useEffect(() => {
    loadVerification();
  }, [loadVerification]);

  // 잔액 조회. refresh 를 주면 서버가 결제 취소(환불) 여부를 PG 에 즉시 확인한 뒤 잔액을
  // 돌려준다 — 환불한 만큼 포인트가 빠졌는지 사용자가 바로 확인할 수 있게 한다.
  const loadClaude = useCallback(async (refresh = false) => {
    const data = await apiService.getClaudeCredits(normalizedUserName, { refresh });
    if (data?.credits) {
      setClaudeActive(!!data.credits.planActive);
      setClaudeBalance(data.credits.balanceCredits ?? 0);
      setClaudeRefunded(data.credits.refundedCredits ?? 0);
    }
  }, [normalizedUserName]);

  const refreshClaude = async () => {
    setClaudeSyncing(true);
    try {
      await loadClaude(true);
    } finally {
      setClaudeSyncing(false);
    }
  };

  useEffect(() => {
    loadClaude();
  }, [loadClaude]);

  // Open the Claude plan payment window and, once the payment is verified
  // server-side, mark the plan active and refresh the credit balance.
  const startClaudePlan = async () => {
    setClaudeError(null);
    setClaudePaying(true);
    try {
      const result = await payClaudePlan(normalizedUserName, 'activation', ACTIVATION_PRICE_KRW, 'CARD');
      if (!result.success || !result.result) {
        setClaudeError(result.error || '결제에 실패했습니다. 다시 시도해 주세요.');
        return;
      }
      const granted = result.result.credits;
      setClaudeActive(true);
      setClaudeBalance(granted?.balanceCredits ?? ACTIVATION_GRANT_CREDITS);
      setClaudeOpen(false);
      flashSuccess(`클로드 플랜이 시작되었습니다. 기본 ${ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧이 충전되었습니다.`);
    } catch {
      setClaudeError('결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setClaudePaying(false);
    }
  };

  const membershipActive = !!verification?.membership_active;

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 2500);
  };

  const handleStartSubscribe = (tier: MembershipTier) => {
    setError(null);
    setSelectedTier(tier);
    setConfirmOpen(true);
  };

  const confirmSubscribe = async () => {
    setError(null);

    const tierLabel = TIER_LABEL[selectedTier];
    const tierAmount = TIER_PRICE[selectedTier];
    const nextBillingOf = (v: SellerVerification | null | undefined) => v?.next_billing_date || null;

    // ── 카드(신용카드): NICE 키인 방식으로 카드 빌링키를 발급해 정기결제로 등록 ──
    // NICE V2 는 브라우저 SDK(requestIssueBillingKey)로 카드 빌링키를 발급할 수 없어(간편결제만
    // 지원) 카드 정보를 서버로 보내 수기(키인) `POST /billing-keys` 로 빌링키를 발급받고, 첫 달을
    // 즉시 결제한 뒤 가입일 기준 매월 자동결제한다. 카드 정보는 저장하지 않고 PortOne 으로만
    // 전달된다. 토스페이·카카오페이는 아래 SDK 빌링키 경로를 그대로 사용한다.
    if (payMethod === 'CARD') {
      const number = cardForm.number.replace(/\D/g, '');
      const exp = cardForm.expiry.replace(/\D/g, ''); // MMYY
      const birth = cardForm.birth.replace(/\D/g, '');
      const pw2 = cardForm.pw2.replace(/\D/g, '');
      if (number.length < 13 || number.length > 16) {
        setError('카드 번호를 정확히 입력해 주세요.');
        return;
      }
      if (exp.length !== 4 || Number(exp.slice(0, 2)) < 1 || Number(exp.slice(0, 2)) > 12) {
        setError('카드 유효기간을 MM/YY 형식으로 입력해 주세요.');
        return;
      }
      if (birth.length !== 6 && birth.length !== 10) {
        setError('생년월일 6자리(개인) 또는 사업자등록번호 10자리를 입력해 주세요.');
        return;
      }
      if (pw2.length !== 2) {
        setError('카드 비밀번호 앞 2자리를 입력해 주세요.');
        return;
      }

      setSaving(true);
      try {
        const res = await apiService.subscribeMembershipCard(normalizedUserName, selectedTier, {
          number,
          expiryMonth: exp.slice(0, 2),
          expiryYear: exp.slice(2, 4),
          birthOrBusinessRegistrationNumber: birth,
          passwordTwoDigits: pw2,
        });
        if (!res.success) {
          setError(res.error || '카드 정기결제 등록에 실패했습니다. 카드 정보를 확인해 주세요.');
          setSaving(false);
          return;
        }
        if (res.data) setVerification(res.data);
        setConfirmOpen(false);
        setCardForm({ number: '', expiry: '', birth: '', pw2: '' });
        const nextDate = nextBillingOf(res.data)
          ? new Date(nextBillingOf(res.data) as string).toLocaleDateString('ko-KR')
          : null;
        flashSuccess(
          `카드로 ${tierAmount.toLocaleString()}원이 결제되어 ${tierLabel}이(가) 활성화되었습니다.`
            + (nextDate ? ` 다음 결제일은 ${nextDate}이며, 가입일 기준 매월 자동결제됩니다.` : ' 가입일 기준 매월 자동결제됩니다.'),
        );
      } catch (e) {
        console.error('[Membership] card billing error:', e);
        setError('카드 정기결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── 간편결제(토스페이 / 카카오페이): PortOne 빌링키로 정기결제 등록 ──
    // SDK 는 여기서 받는다. 모든 페이지가 미리 받으면 라이브도 결제도 열지 않는
    // 방문자까지 77KB 를 기다린다.
    try {
      await loadPortOne();
    } catch {
      setError('결제 모듈을 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.');
      return;
    }

    setSaving(true);
    try {
      const safeUserName = toAsciiSafeId(normalizedUserName);
      const ppMethod = payMethod;

      const issueId = genPortOneId('billing', normalizedUserName);
      // 토스페이·카카오페이는 PortOne V2 빌링키를 발급해 매월 자동결제(정기결제)로 동작한다.

      // 모두 리다이렉트 방식으로 호출한다. redirectUrl 을 넣어 빌링 인증창으로 페이지를 넘기고,
      // 돌아온 /portone/return 페이지가 발급된 billingKey 로 첫 달 결제·멤버십 활성화를
      // 마무리한다. intent 를 미리 저장한다. (PC 팝업으로 promise 가 resolve 되면 아래 인라인
      // 처리도 동작한다.)
      savePortOneIntent({
        type: 'membership',
        username: normalizedUserName,
        payMethod: ppMethod,
        tier: selectedTier,
        orderName: `픽스폴리오 ${tierLabel} 정기결제`,
        returnPath: window.location.pathname + window.location.search,
      });

      const response = await window.PortOne.requestIssueBillingKey({
        storeId: PORTONE_STORE_ID,
        channelKey: channelKeyFor(ppMethod),
        billingKeyMethod: portoneBillingKeyMethod(ppMethod),
        issueId,
        issueName: `픽스폴리오 ${tierLabel} 정기결제`,
        displayAmount: tierAmount,
        currency: 'KRW',
        redirectUrl: portoneRedirectUrl(),
        ...easyPayParam(ppMethod),
        customer: {
          customerId: safeUserName,
        },
      });

      if (!response || response.code) {
        clearPortOneIntent();
        if (response?.code) {
          const detail = response.code === 'PORTONE_ERROR'
            ? '결제 모듈 오류입니다. 채널 설정(결제모듈·PG상점아이디)을 확인해 주세요.'
            : response.message || `빌링키 발급 실패 (${response.code})`;
          setError(detail);
          console.error('[Membership] PortOne billing key error:', response.code, response.message);
        }
        setSaving(false);
        return;
      }

      const billingKey = response.billingKey;
      if (!billingKey) {
        clearPortOneIntent();
        setError('빌링키를 받지 못했습니다. 다시 시도해 주세요.');
        setSaving(false);
        return;
      }

      const verifyRes = await apiService.issueBillingKeyPayment(normalizedUserName, billingKey, selectedTier);
      clearPortOneIntent();
      if (!verifyRes.success) {
        setError(verifyRes.error || '빌링 결제에 실패했습니다. 고객센터로 문의해 주세요.');
        setSaving(false);
        return;
      }

      if (verifyRes.data) setVerification(verifyRes.data);
      setConfirmOpen(false);
      const methodLabel = payMethod === 'KAKAOPAY' ? '카카오페이로' : payMethod === 'TOSSPAY' ? '토스페이로' : '카드로';
      const nextDate = nextBillingOf(verifyRes.data)
        ? new Date(nextBillingOf(verifyRes.data) as string).toLocaleDateString('ko-KR')
        : null;
      flashSuccess(
        `${methodLabel} ${tierAmount.toLocaleString()}원이 결제되어 ${tierLabel}이(가) 활성화되었습니다.`
          + (nextDate ? ` 다음 결제일은 ${nextDate}이며, 가입일 기준 매월 자동결제됩니다.` : ' 가입일 기준 매월 자동결제됩니다.'),
      );
    } catch (e) {
      console.error('[Membership] PortOne billing key error:', e);
      setError('결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!window.confirm('멤버십 구독을 해지하시겠어요? 해지 후에는 멤버십 전용 기능을 이용할 수 없습니다.')) return;
    setSaving(true);
    const res = await apiService.saveSellerVerification(normalizedUserName, { membership_active: false });
    setSaving(false);
    if (!res.success) {
      setError(res.error || '해지 처리 중 오류가 발생했습니다.');
      return;
    }
    if (res.data) setVerification(res.data);
  };

  // Legacy installs may carry membership_plan === 'live' from the previous single-tier
  // setup — normalizeTier maps it to the new 'commerce' tier so existing subscribers
  // don't lose access.
  const currentPlan: MembershipTier | null = normalizeTier(verification?.membership_plan);

  // 상위 플랜은 하위 플랜의 기능을 모두 포함한다. 현재 구독이 tier 를 이미
  // 포함하고 있으면(= 더 높은 등급) 카드에 "○○에 포함되어 있습니다"를 띄운다.
  const includedInCurrentPlan = (tier: MembershipTier) =>
    membershipActive && !!currentPlan && TIER_RANK[currentPlan] > TIER_RANK[tier];

  // Inside the native app, membership and Claude-plan purchases are not offered
  // — digital goods are sold on the website only. Show a neutral notice instead
  // of any plan/pricing or payment UI (App Store / Play Store digital-goods
  // policy). Web behaviour is unchanged.
  if (isNativeApp()) {
    return (
      <main className="p-3 md:p-14 w-full animate-in fade-in duration-500">
        <div className="max-w-xl mx-auto mt-10 md:mt-16 bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl mx-auto mb-4">💎</div>
          <h2 className="text-lg md:text-xl font-black text-slate-900 mb-2">멤버십 안내</h2>
          <p className="text-slate-500 text-sm font-medium leading-relaxed">
            멤버십 구독과 변경은 PICKS Folio 웹사이트에서 관리할 수 있어요. 웹에서 가입한 멤버십은 앱에서도 그대로 이용됩니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="p-3 md:p-14 w-full animate-in fade-in duration-500">
      <header className="mb-8 md:mb-12">
        <h2 className="text-xl md:text-3xl font-black text-slate-900">{t('nav.membership', '멤버십 플랜', 'Membership Plans')}</h2>
        <p className="text-slate-500 mt-2 text-sm md:text-base leading-relaxed max-w-3xl">
          {language === 'en'
            ? 'Choose Standard for content features, AI Collaboration to add AI tools, or Pro Plan for all features including DM automation and the Insights menu. All plans are monthly subscriptions and include VAT.'
            : '콘텐츠 기능이 필요하면 스탠다드, 협업 AI까지 더하려면 AI 협업, 디엠 자동화와 인사이트 메뉴를 포함해 모든 기능을 쓰려면 프로 플랜을 선택하세요. 모든 플랜은 월 단위 구독이며 언제든 해지할 수 있고, 표시된 금액은 모두 부가세(VAT) 포함입니다.'}
        </p>
      </header>

      {successMsg && (
        <div className="mb-6 max-w-2xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold rounded-xl px-4 py-3">
          ✓ {successMsg}
        </div>
      )}

      {/* Plan grid */}
      <section className="mb-12">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 max-w-7xl">
          {/* Standard Plan */}
          <div className="relative rounded-2xl border-2 border-blue-200 bg-white p-6 md:p-8 shadow-sm">
            <div className="absolute -top-3 left-6">
              <span className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                {language === 'en' ? 'Standard Membership' : '스탠다드 멤버십'}
              </span>
            </div>
            <div className="flex items-end gap-1 mb-4 mt-2">
              <span className="text-3xl md:text-4xl font-black text-slate-900">₩{STANDARD_PRICE.toLocaleString()}</span>
              <span className="text-slate-500 text-sm mb-1">{language === 'en' ? '/ mo' : '원 / 월'}</span>
              <span className="text-slate-400 text-xs mb-1.5 ml-1">{language === 'en' ? 'VAT incl.' : '부가세 포함'}</span>
            </div>
            <h4 className="font-bold text-slate-800 text-lg mb-3">{language === 'en' ? 'Full Content Access' : '콘텐츠 풀 액세스'}</h4>
            <ul className="space-y-2 text-sm text-slate-600 mb-6">
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>{language === 'en' ? 'Video Uploads' : '영상 업로드'}</strong></li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>{language === 'en' ? 'Upload 7+ Content Blocks' : '콘텐츠 7개 이상 업로드'}</strong></li>
            </ul>

            {loading ? (
              <div className="text-slate-400 text-sm font-bold">{t('common.loading', '상태 확인 중...', 'Checking status...')}</div>
            ) : membershipActive && currentPlan === 'standard' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 py-3 px-4 rounded-xl font-bold text-center bg-green-50 text-green-700 border border-green-200 text-sm">
                  ✓ {language === 'en' ? 'Subscribed to Standard' : '스탠다드 멤버십 구독 중'}
                </div>
                <button
                  type="button"
                  onClick={handleCancelSubscription}
                  disabled={saving}
                  className="px-4 py-3 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  {language === 'en' ? 'Cancel' : '해지하기'}
                </button>
              </div>
            ) : includedInCurrentPlan('standard') ? (
              <div className="py-3 px-4 rounded-xl font-bold text-center bg-slate-50 text-slate-500 border border-slate-200 text-sm">
                {language === 'en' ? `Included in ${TIER_LABEL[currentPlan!]}` : `${TIER_LABEL[currentPlan!]}에 포함되어 있습니다`}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleStartSubscribe('standard')}
                disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
              >
                {language === 'en' ? `Subscribe for ₩${STANDARD_PRICE.toLocaleString()}` : `${STANDARD_PRICE.toLocaleString()}원으로 구독 시작`}
              </button>
            )}
          </div>

          {/* AI 협업 멤버십 (standard + AI) */}
          <div className="relative rounded-2xl border-2 border-violet-200 bg-white p-6 md:p-8 shadow-sm">
            <div className="absolute -top-3 left-6">
              <span className="bg-gradient-to-r from-violet-500 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                {language === 'en' ? 'AI Collaboration · ✨ AI' : 'AI 협업 멤버십 · ✨ AI'}
              </span>
            </div>
            <div className="flex items-end gap-1 mb-4 mt-2">
              <span className="text-3xl md:text-4xl font-black text-slate-900">₩{STANDARD_AI_PRICE.toLocaleString()}</span>
              <span className="text-slate-500 text-sm mb-1">{language === 'en' ? '/ mo' : '원 / 월'}</span>
              <span className="text-slate-400 text-xs mb-1.5 ml-1">{language === 'en' ? 'VAT incl.' : '부가세 포함'}</span>
            </div>
            <h4 className="font-bold text-slate-800 text-lg mb-3">{language === 'en' ? 'Standard + AI Collaboration Tools' : '스탠다드 + AI 사용할 수 있는 멤버십'}</h4>
            <ul className="space-y-2 text-sm text-slate-600 mb-6">
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>스탠다드 멤버십 모든 혜택 포함</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>협업 타임라인 AI 어시스턴트</strong> 이용</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>대화 요약 · 일정 정리 · 답장 초안 작성</li>
            </ul>

            {loading ? (
              <div className="text-slate-400 text-sm font-bold">상태 확인 중...</div>
            ) : membershipActive && currentPlan === 'standard_ai' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 py-3 px-4 rounded-xl font-bold text-center bg-green-50 text-green-700 border border-green-200 text-sm">
                  ✓ AI 협업 멤버십 구독 중
                </div>
                <button
                  type="button"
                  onClick={handleCancelSubscription}
                  disabled={saving}
                  className="px-4 py-3 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  해지하기
                </button>
              </div>
            ) : includedInCurrentPlan('standard_ai') ? (
              <div className="py-3 px-4 rounded-xl font-bold text-center bg-slate-50 text-slate-500 border border-slate-200 text-sm">
                {TIER_LABEL[currentPlan!]}에 포함되어 있습니다
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleStartSubscribe('standard_ai')}
                disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 transition-all shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
              >
                {membershipActive && currentPlan === 'standard'
                  ? 'AI 협업 멤버십으로 업그레이드'
                  : `${STANDARD_AI_PRICE.toLocaleString()}원으로 구독 시작`}
              </button>
            )}
          </div>

          {/* Pro Plan — 모든 멤버십 기능 + 디엠 자동화. 카드 형태(파스텔 테두리 ·
              흰 배경 · 그라데이션 배지와 CTA)뿐 아니라 색 계열도 다른 플랜과
              맞춘다. 초록 계열은 이 화면에서 "구독 중 · 완료" 상태 표시에 쓰이는
              색이라, 프로 플랜만 초록으로 두면 다른 상품처럼 튀어 보인다. */}
          <div className="relative rounded-2xl border-2 border-indigo-200 bg-white p-6 md:p-8 shadow-sm">
            <div className="absolute -top-3 left-6">
              <span className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                프로 플랜 · 🚀 전체 기능
              </span>
            </div>
            <div className="flex items-end gap-1 mb-4 mt-2">
              <span className="text-3xl md:text-4xl font-black text-slate-900">{PRO_PRICE.toLocaleString()}</span>
              <span className="text-slate-500 text-sm mb-1">원 / 월</span>
              <span className="text-slate-400 text-xs mb-1.5 ml-1">부가세 포함</span>
            </div>
            <h4 className="font-bold text-slate-800 text-lg mb-3">모든 멤버십 + 디엠 자동화 · 인사이트</h4>
            <ul className="space-y-2 text-sm text-slate-600 mb-6">
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>모든 멤버십 플랜</strong>(스탠다드 · AI 협업) 혜택 포함</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>디엠 자동화</strong>(인스타그램 댓글 → 자동 DM) 이용</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>키워드별 자동 응답 · 발송 이력 확인 · 수동 DM 발송</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>인사이트 메뉴</strong> 이용 — 릴스 조회 · 도달 · 저장 지표를 한눈에</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>반응 좋은 릴스 TOP 5 · AI 콘텐츠 코칭 제공</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>비즈니스 계정은 우리 계정을 태그한 콘텐츠까지 인사이트로 확인</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>협업 타임라인 AI 어시스턴트 포함</li>
            </ul>

            {loading ? (
              <div className="text-slate-400 text-sm font-bold">상태 확인 중...</div>
            ) : membershipActive && currentPlan === 'pro' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 py-3 px-4 rounded-xl font-bold text-center bg-green-50 text-green-700 border border-green-200 text-sm">
                  ✓ 프로 플랜 구독 중
                </div>
                <button
                  type="button"
                  onClick={handleCancelSubscription}
                  disabled={saving}
                  className="px-4 py-3 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  해지하기
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleStartSubscribe('pro')}
                disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 transition-all shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
              >
                {membershipActive && currentPlan
                  ? '프로 플랜으로 업그레이드'
                  : `${PRO_PRICE.toLocaleString()}원으로 구독 시작`}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Claude plan — sold SEPARATELY from the memberships above. It is not a
          membership tier; it is an optional premium AI add-on with its own prepaid
          credit wallet, activated and managed from the 협업 타임라인 AI. */}
      <section className="mb-12 max-w-6xl">
        <div className="relative rounded-2xl border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-6 md:p-8 shadow-sm">
          <div className="absolute -top-3 left-6">
            <span className="bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
              클로드 플랜 · 🤖 Claude (별도)
            </span>
          </div>
          <div className="md:flex md:items-center md:justify-between gap-6 mt-2">
            <div className="flex-1">
              <h4 className="font-bold text-slate-800 text-lg mb-2">협업 AI를 Claude로 — {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧</h4>
              <p className="text-sm text-slate-600 leading-relaxed mb-3">
                협업 타임라인 AI는 기본적으로 제미나이(무료, AI 멤버십 포함)로 동작합니다. 깊은 분석이나 문서·계약서 검토처럼 더 강력한 답변이 필요할 때는 <strong>Claude</strong>를 선택할 수 있어요. 클로드 플랜은 멤버십과 <strong>별도로 결제</strong>하며, 결제하면 바로 크레딧이 충전됩니다.
              </p>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>{ACTIVATION_PRICE_KRW.toLocaleString()}원 단건 결제 · <strong>{ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧</strong> 충전</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>사용한 토큰만큼만 차감 · 남은 크레딧은 이월</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>결제수단은 <strong>신용/체크카드만 가능</strong> · 네이버페이, 페이코, 토스페이, 카카오페이 등 간편결제 제외</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>크레딧 충전 경로: 이 플랜 화면에서 첫 결제 후 협업 타임라인 AI의 클로드 관리 화면에서 추가 충전</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>크레딧 사용 경로: 협업 타임라인 AI에서 Claude 선택 후 질문 시 답변별 사용량만큼 차감</li>
              </ul>
            </div>
            <div className="shrink-0 mt-4 md:mt-0">
              {claudeActive ? (
                <div className="w-full md:w-auto md:text-right">
                  <div className="px-5 py-3 rounded-xl font-bold text-center bg-green-50 text-green-700 border border-green-200 text-sm">
                    ✓ 클로드 플랜 이용 중
                  </div>
                  {claudeBalance != null && (
                    <div className="mt-2 rounded-xl border border-orange-200 bg-white/80 px-4 py-3 text-center md:text-right">
                      <p className="text-[11px] text-slate-400 font-black uppercase tracking-widest">남은 포인트</p>
                      <p className="text-2xl font-black text-orange-700">{claudeBalance.toLocaleString()}<span className="text-xs font-bold ml-1">크레딧</span></p>
                      <p className="text-[11px] text-slate-500 font-bold mt-1">
                        크레딧 소진 시 클로드 관리 화면에서 추가 충전
                      </p>
                      {claudeRefunded > 0 && (
                        <p className="text-[11px] text-slate-500 font-bold mt-1">
                          환불 반영 −{claudeRefunded.toLocaleString()} 크레딧
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={refreshClaude}
                        disabled={claudeSyncing}
                        className="mt-2 text-[11px] font-bold text-orange-700 hover:text-orange-800 underline disabled:opacity-50"
                      >
                        {claudeSyncing ? '결제 내역 확인 중...' : '결제·환불 내역 새로고침'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => { setClaudeError(null); setClaudeOpen(true); }}
                    className="w-full md:w-auto px-6 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all shadow-md hover:shadow-lg"
                  >
                    {ACTIVATION_PRICE_KRW.toLocaleString()}원으로 클로드 플랜 시작
                  </button>
                  <p className="text-[11px] text-slate-400 font-medium mt-2 text-center md:text-right">신용/체크카드 단건 결제</p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-2xl">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 md:p-6">
          <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span>ℹ️</span> 안내사항
          </h4>
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-500 marker:text-slate-400">
            <li>스탠다드 멤버십은 월 {STANDARD_PRICE.toLocaleString()}원, AI 협업 멤버십은 월 {STANDARD_AI_PRICE.toLocaleString()}원, 프로 플랜은 월 {PRO_PRICE.toLocaleString()}원이며, 언제든 해지할 수 있습니다.</li>
            <li><strong>표시된 모든 금액은 부가세(VAT 10%)가 포함된 금액</strong>입니다. 결제 시 추가로 청구되는 금액은 없습니다.</li>
            <li>스탠다드 멤버십 구독 시 영상 업로드와 콘텐츠 7개 이상 업로드를 이용할 수 있습니다.</li>
            <li>협업 타임라인 AI 어시스턴트(대화 요약 · 일정 정리 · 답장 초안)는 AI 협업 멤버십({STANDARD_AI_PRICE.toLocaleString()}원) 이상에 포함됩니다. 스탠다드 멤버십({STANDARD_PRICE.toLocaleString()}원)에는 포함되지 않습니다.</li>
            <li>프로 플랜은 스탠다드 · AI 협업 멤버십 혜택을 포함하며, 인스타그램 디엠 자동화는 프로 플랜에서만 이용할 수 있습니다.</li>
            <li>디엠 자동화는 인스타그램 댓글에 반응해 자동으로 DM을 보내고, 키워드별 응답 문구와 발송 이력을 관리할 수 있습니다. 인스타그램 프로페셔널(비즈니스 · 크리에이터) 계정 연동이 필요합니다.</li>
            <li><strong>인사이트 메뉴</strong>: 릴스 조회 · 도달 · 저장 지표와 반응 좋은 릴스 TOP 5, AI 콘텐츠 코칭을 함께 제공합니다. 비즈니스 계정은 우리 계정을 태그한 인플루언서 콘텐츠까지 인사이트에서 볼 수 있습니다.</li>
          </ul>
        </div>
      </section>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-black text-blue-500 uppercase tracking-widest">{TIER_LABEL[selectedTier]}</p>
                <h3 className="text-lg font-black text-slate-900">구독 결제 확인</h3>
              </div>
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setError(null); setCardForm({ number: '', expiry: '', birth: '', pw2: '' }); }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-xl"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-xs font-black text-blue-500 uppercase tracking-widest mb-1">월 구독료 (부가세 포함)</p>
                <p className="text-3xl font-black text-blue-700">{TIER_PRICE[selectedTier].toLocaleString()}<span className="text-sm font-bold ml-1">원 / 월</span></p>
                <p className="text-xs font-bold text-blue-500 mt-2">지금 첫 달 결제 · 가입일 기준 매월 자동결제 · 언제든 해지 가능</p>
              </div>

              <div>
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">결제 수단</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMethod('CARD')}
                    className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      payMethod === 'CARD'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span>💳</span>
                    <span className="whitespace-nowrap">신용카드</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('TOSSPAY')}
                    className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      payMethod === 'TOSSPAY'
                        ? 'border-blue-400 bg-blue-50 text-blue-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-black text-blue-600">toss</span>
                    <span className="whitespace-nowrap">토스페이</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayMethod('KAKAOPAY')}
                    className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      payMethod === 'KAKAOPAY'
                        ? 'border-yellow-400 bg-yellow-50 text-yellow-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="font-black text-yellow-700">pay</span>
                    <span className="whitespace-nowrap">카카오페이</span>
                  </button>
                </div>
                {payMethod === 'CARD' && (
                  <div className="mt-3 space-y-2">
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={cardForm.number}
                      onChange={(e) =>
                        setCardForm((f) => ({ ...f, number: e.target.value.replace(/[^\d\s-]/g, '').slice(0, 19) }))
                      }
                      placeholder="카드 번호 (숫자만)"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-blue-400 focus:outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        value={cardForm.expiry}
                        onChange={(e) =>
                          setCardForm((f) => ({ ...f, expiry: e.target.value.replace(/[^\d/]/g, '').slice(0, 5) }))
                        }
                        placeholder="유효기간 MM/YY"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-blue-400 focus:outline-none"
                      />
                      <input
                        type="password"
                        inputMode="numeric"
                        value={cardForm.pw2}
                        onChange={(e) =>
                          setCardForm((f) => ({ ...f, pw2: e.target.value.replace(/\D/g, '').slice(0, 2) }))
                        }
                        placeholder="비밀번호 앞 2자리"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-blue-400 focus:outline-none"
                      />
                    </div>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={cardForm.birth}
                      onChange={(e) =>
                        setCardForm((f) => ({ ...f, birth: e.target.value.replace(/\D/g, '').slice(0, 10) }))
                      }
                      placeholder="생년월일 6자리(YYMMDD) 또는 사업자번호 10자리"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-blue-400 focus:outline-none"
                    />
                    <p className="text-[11px] text-slate-400 font-medium">
                      신용·체크카드로 첫 달을 결제하고 가입일 기준 매월 자동결제됩니다. 카드 정보는 저장되지 않고 결제사(나이스정보통신)로만 전달됩니다.
                    </p>
                  </div>
                )}
                {payMethod === 'KAKAOPAY' && (
                  <p className="text-[11px] text-slate-400 font-medium mt-2">
                    카카오톡 앱에서 카카오페이로 간편하게 결제됩니다.
                  </p>
                )}
                {payMethod === 'TOSSPAY' && (
                  <p className="text-[11px] text-slate-400 font-medium mt-2">
                    토스 앱에서 토스페이로 간편하게 결제됩니다.
                  </p>
                )}
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>✓ 구독 즉시 멤버십 기능을 이용할 수 있습니다.</p>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {selectedTier === 'pro'
                  ? '구독을 시작하면 영상 업로드 · 콘텐츠 업로드 등 스탠다드 기능과 협업 타임라인 AI 어시스턴트, 인스타그램 디엠 자동화, 인사이트 메뉴(릴스 지표 · 릴스 TOP 5 · AI 코칭)가 즉시 활성화됩니다.'
                  : selectedTier === 'standard_ai' || selectedTier === 'commerce'
                    ? '구독을 시작하면 영상 업로드 · 콘텐츠 업로드 등 스탠다드 기능과 함께 협업 타임라인 AI 어시스턴트가 즉시 활성화됩니다. 디엠 자동화는 프로 플랜에서 이용할 수 있습니다.'
                    : '구독을 시작하면 영상 업로드 · 콘텐츠 업로드 등 스탠다드 기능이 즉시 활성화됩니다. 협업 타임라인 AI 어시스턴트는 AI 협업 멤버십, 디엠 자동화는 프로 플랜에서 이용할 수 있습니다.'}
              </p>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setError(null); setCardForm({ number: '', expiry: '', birth: '', pw2: '' }); }}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmSubscribe}
                disabled={saving}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50 ${
                  payMethod === 'KAKAOPAY'
                    ? 'bg-gradient-to-r from-yellow-400 to-amber-400 hover:from-yellow-500 hover:to-amber-500 text-yellow-900'
                    : payMethod === 'TOSSPAY'
                      ? 'bg-gradient-to-r from-blue-400 to-blue-500 hover:from-blue-500 hover:to-blue-600'
                      : 'bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-700 hover:to-pink-600'
                }`}
              >
                {saving
                  ? '처리 중...'
                  : `${TIER_PRICE[selectedTier].toLocaleString()}원으로 구독 시작`}
              </button>
            </div>
          </div>
        </div>
      )}
      {claudeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-black text-orange-500 uppercase tracking-widest">클로드 플랜 · 🤖 Claude</p>
                <h3 className="text-lg font-black text-slate-900">클로드 플랜 시작</h3>
              </div>
              <button
                type="button"
                onClick={() => { setClaudeOpen(false); setClaudeError(null); }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-xl"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              {claudeError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2">
                  {claudeError}
                </div>
              )}
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <p className="text-xs font-black text-orange-500 uppercase tracking-widest mb-1">결제 금액</p>
                <p className="text-3xl font-black text-orange-700">{ACTIVATION_PRICE_KRW.toLocaleString()}<span className="text-sm font-bold ml-1">원</span></p>
                <p className="text-xs font-bold text-orange-500 mt-2">결제 즉시 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧 충전 · 단건 결제</p>
              </div>

              <div>
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">결제 수단</p>
                <div className="rounded-xl border-2 border-orange-500 bg-orange-50 px-4 py-3 text-sm font-black text-orange-700 flex items-center justify-center gap-2">
                  <span>💳</span>
                  <span>신용/체크카드 전용</span>
                </div>
                <p className="text-[11px] text-slate-400 font-medium mt-2">
                  클로드 플랜은 네이버페이, 페이코, 토스페이, 카카오페이 등 간편결제를 지원하지 않습니다.
                </p>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>✓ 결제 즉시 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧이 충전됩니다.</p>
                <p>✓ 협업 타임라인 AI에서 Claude를 선택해 사용할 수 있습니다.</p>
                <p>✓ 크레딧이 부족하면 협업 타임라인의 클로드 관리 화면에서 추가 충전할 수 있습니다.</p>
                <p>✓ 남은 크레딧은 멤버십 플랜 화면과 협업 타임라인 AI 입력창에서 확인할 수 있습니다.</p>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => { setClaudeOpen(false); setClaudeError(null); }}
                disabled={claudePaying}
                className="px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={startClaudePlan}
                disabled={claudePaying}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all disabled:opacity-50"
              >
                {claudePaying ? '처리 중...' : `${ACTIVATION_PRICE_KRW.toLocaleString()}원 결제하기`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default MembershipPlan;
