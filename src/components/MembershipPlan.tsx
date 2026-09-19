import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/apiService';
import { toAsciiSafeId } from '../utils/formatters';
import { loadPortOne } from '../utils/externalScripts';
import { payClaudePlan } from '../utils/claudeCharge';
import { useLanguage } from '../contexts/LanguageContext';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
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
  PROMO_CODE_LENGTH,
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
// 멤버십은 월 단위 정기결제(매월 자동결제)이며, 실결제 수단은 신용카드(나이스페이)와
// 카카오페이 두 가지다.
//   • 신용카드(나이스정보통신): PortOne V2 나이스정보통신은 결제창으로 카드 빌링키를 발급할 수
//     없다(결제창 빌링키 발급은 간편결제만 지원). 그래서 카드 정기결제는 카드 정보를 입력받아
//     서버에서 수기(키인) 빌링키를 발급하고, 이후 매월 그 빌링키로 자동결제한다.
//     카드 정보는 발급 요청에만 쓰고 어디에도 저장하지 않는다.
//   • 카카오페이: PortOne V2 브라우저 SDK 로 빌링키를 발급해 매월 자동결제한다.

// Claude plan (separate prepaid AI add-on) — activated by its own PortOne payment
// window opened from this page. Keep these figures in sync with the server's
// claude-credits pricing module.
const ACTIVATION_PRICE_KRW = 9900;
const ACTIVATION_GRANT_CREDITS = 3000;

const MembershipPlan: React.FC<MembershipPlanProps> = ({ userName }) => {
  const { language, t } = useLanguage();
  const normalizedUserName = userName.replace(/^biz\//, '');
  const cachedVerification = apiService.getCachedSellerVerification(normalizedUserName);
  const [verification, setVerification] = useState<SellerVerification | null>(() => cachedVerification);
  const [loading, setLoading] = useState(() => !cachedVerification);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 해지 안내 모달 — 해지하면 언제까지 이용할 수 있는지 먼저 안내한 뒤 확정한다.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // 실제 운영 결제수단은 신용카드(나이스정보통신)와 카카오페이 두 가지다.
  const [payMethod, setPayMethod] = useState<'CARD' | 'KAKAOPAY'>('CARD');
  // 자동결제 등록용 카드 정보. 입력값은 등록 요청에만 쓰고 화면을 닫을 때 비운다
  // (브라우저·서버 어디에도 저장하지 않는다).
  const [cardForm, setCardForm] = useState({ number: '', expiry: '', birth: '', pw2: '' });
  const birthRef = useRef<HTMLInputElement | null>(null);
  const pw2Ref = useRef<HTMLInputElement | null>(null);
  // 출시 혜택 코드(9자리 숫자). 코드를 확인하면 promo 에 "무엇을 주는 코드인지"가 담기고,
  // 결제 버튼은 첫 달 결제 대신 무료로 구독을 시작한다.
  const [promoInput, setPromoInput] = useState('');
  const [promoChecking, setPromoChecking] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promo, setPromo] = useState<{
    plan: MembershipTier;
    planLabel: string;
    freeMonths: number;
    freeUntil: string;
    monthlyPriceKrw: number;
  } | null>(null);
  // 결제 대상 플랜 — 멤버십 티어.
  const [selectedTier, setSelectedTier] = useState<MembershipTier>('standard');

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
    const cached = apiService.getCachedSellerVerification(normalizedUserName);
    if (cached) {
      setVerification(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
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

  /**
   * 브라우저 비밀번호 관리자가 카드 칸에 넣어 둔 값을 되돌린다.
   *
   * 카드 비밀번호 칸이 `type="password"` 라서, 크롬은 바로 앞의 생년월일 칸을
   * 로그인 아이디 칸으로 짐작하고 저장해 둔 아이디와 비밀번호를 두 칸에 채웠다.
   * 리액트가 들고 있는 값은 계속 빈 문자열이라, 화면에는 채워져 보이는데 결제를
   * 누르면 "생년월일 6자리를 입력해 주세요" 가 떴다.
   *
   * autoComplete 힌트만으로는 비밀번호 관리 확장 프로그램까지 막지 못해서,
   * 결제창이 열린 직후 DOM 에 들어온 값을 리액트 값에 맞춰 지운다. 비교 대상이
   * 리액트 값이므로 사용자가 직접 입력한 숫자는 건드리지 않는다.
   */
  useEffect(() => {
    if (!confirmOpen || payMethod !== 'CARD') return;
    const sync = () => {
      if (birthRef.current && birthRef.current.value !== cardForm.birth) birthRef.current.value = cardForm.birth;
      if (pw2Ref.current && pw2Ref.current.value !== cardForm.pw2) pw2Ref.current.value = cardForm.pw2;
    };
    sync();
    // 자동 채우기는 칸이 그려진 뒤에 들어오기도 한다 — 잠깐 동안 몇 번 더 확인한다.
    const timers = [50, 200, 600].map((ms) => window.setTimeout(sync, ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [confirmOpen, payMethod, cardForm.birth, cardForm.pw2]);

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

  // 해지 예약 상태. 해지는 즉시 차단이 아니라 결제한 이용 기간이 끝나는 날 종료되므로,
  // 예약이 걸린 동안에도 멤버십은 계속 활성(= 기능 이용 가능)이다.
  const cancelPending = membershipActive && !!verification?.membership_cancel_at_period_end;
  const membershipEndsAt = verification?.membership_ends_at || verification?.next_billing_date || null;

  // 무료 기간이 끝난 뒤 청구될 금액. 저장된 플랜을 현재 티어로 환산해 가격을 찾는다.
  const currentPlanPrice = (plan: unknown): number => {
    const tier = normalizeTier(plan);
    return tier ? TIER_PRICE[tier] : 0;
  };

  const formatDate = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(language === 'en' ? 'en-US' : 'ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };
  const endsAtLabel = formatDate(membershipEndsAt);

  // 출시 혜택으로 무료 이용 중인지. 무료 기간은 별도 상태가 아니라 "첫 청구일이 아직
  // 오지 않은 구독"으로 저장되므로(next_billing_date = 무료 종료일), 코드 등록 흔적과
  // 그 날짜가 아직 지나지 않았는지를 함께 본다.
  const promoFreeUntil = verification?.membership_promo_free_until || null;
  const promoFreeUntilLabel = formatDate(promoFreeUntil);
  const promoActive =
    membershipActive && !!promoFreeUntil && new Date(promoFreeUntil).getTime() > Date.now();
  const promoMonthlyPrice = currentPlanPrice(verification?.membership_plan);

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 2500);
  };

  const handleStartSubscribe = (tier: MembershipTier) => {
    setError(null);
    setSelectedTier(tier);
    setConfirmOpen(true);
  };

  // 결제창을 닫을 때 카드 정보와 코드를 함께 비운다 — 둘 다 화면에만 두는 값이다.
  const closeConfirm = () => {
    setConfirmOpen(false);
    setError(null);
    setCardForm({ number: '', expiry: '', birth: '', pw2: '' });
    setPromoInput('');
    setPromo(null);
    setPromoError(null);
  };

  // 휴대폰에서는 이 창들을 뒤로가기로도 닫을 수 있게 한다. 특히 결제 확인 창은
  // 내용이 길어 닫기 버튼이 위로 밀려나 있는 경우가 많아, 뒤로가기가 막혀 있으면
  // 앱을 떠나는 것 말고는 나올 길이 없다.
  useCloseOnBack(confirmOpen, closeConfirm);
  useCloseOnBack(cancelOpen, () => { setCancelOpen(false); setError(null); });
  useCloseOnBack(claudeOpen, () => { setClaudeOpen(false); setClaudeError(null); });

  /**
   * 코드를 확인한다. 여기서 코드가 소진되지는 않고(등록은 결제 요청에서 함께 처리된다),
   * 카드 정보를 넣기 전에 "며칠까지 무료인지"를 먼저 보여주기 위한 조회다.
   * 확인에 성공하면 결제 대상 플랜을 코드의 혜택 플랜으로 맞춘다.
   */
  const verifyPromoCode = async (): Promise<
    { ok: true; code: string } | { ok: false; error: string }
  > => {
    const digits = promoInput.replace(/[^0-9]/g, '');
    if (digits.length !== PROMO_CODE_LENGTH) {
      const message = `코드는 ${PROMO_CODE_LENGTH}자리 숫자입니다.`;
      setPromo(null);
      setPromoError(message);
      return { ok: false, error: message };
    }

    setPromoChecking(true);
    setPromoError(null);
    try {
      const res = await apiService.checkMembershipPromoCode(normalizedUserName, digits);
      if (!res.success || !res.promo) {
        const message = res.error || '사용할 수 없는 코드입니다.';
        setPromo(null);
        setPromoError(message);
        return { ok: false, error: message };
      }
      setPromo(res.promo);
      setPromoError(null);
      // 혜택은 코드에 적힌 플랜으로 제공된다(출시 혜택 = 프로 플랜).
      setSelectedTier(res.promo.plan);
      return { ok: true, code: digits };
    } finally {
      setPromoChecking(false);
    }
  };

  const confirmSubscribe = async () => {
    setError(null);

    const tierLabel = TIER_LABEL[selectedTier];
    const tierAmount = TIER_PRICE[selectedTier];
    const nextBillingOf = (v: SellerVerification | null | undefined) => v?.next_billing_date || null;

    // ── 카드(신용카드) · 매월 자동결제(정기결제) ──
    // 멤버십은 월 구독이므로 카드도 매월 같은 날 자동으로 청구된다. PortOne V2 나이스정보통신은
    // 결제창으로 카드 빌링키를 발급할 수 없어(결제창 빌링키 발급은 간편결제만 지원) 카드 자동결제는
    // 카드 정보를 서버로 보내 수기(키인) 빌링키를 발급받는 방식만 가능하다. 카드 정보는 서버에
    // 저장하지 않고 PortOne 으로만 전달하며, 첫 달 결제까지 성공하면 그 날짜를 기준으로 매월
    // 자동결제된다(이후 청구는 정기결제 스케줄러가 발급된 빌링키로 처리).
    if (payMethod === 'CARD') {
      // 코드를 입력했으면 먼저 확인한다(아직 확인을 누르지 않았을 수도 있다).
      // 쓸 수 없는 코드로 정상 결제가 그냥 진행되면 "무료인 줄 알았는데 결제됐다"가 된다.
      const typedPromo = promoInput.replace(/[^0-9]/g, '');
      let promoCodeToUse = '';
      if (typedPromo) {
        // promo 가 남아 있으면 지금 입력값을 확인한 결과다 — 코드를 고치면 onChange 가 지운다.
        const verified = promo
          ? { ok: true as const, code: typedPromo }
          : await verifyPromoCode();
        if (!verified.ok) {
          setError(verified.error);
          return;
        }
        promoCodeToUse = verified.code;
      }

      const number = cardForm.number.replace(/[^0-9]/g, '');
      const expiry = cardForm.expiry.replace(/[^0-9]/g, '');
      const birth = cardForm.birth.replace(/[^0-9]/g, '');
      const pw2 = cardForm.pw2.replace(/[^0-9]/g, '');
      if (number.length < 14 || number.length > 16) {
        setError('카드번호를 정확히 입력해 주세요.');
        return;
      }
      if (expiry.length !== 4) {
        setError('유효기간을 MM/YY 형식으로 입력해 주세요.');
        return;
      }
      if (Number(expiry.slice(0, 2)) < 1 || Number(expiry.slice(0, 2)) > 12) {
        setError('유효기간의 월(MM)을 확인해 주세요.');
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
        const res = await apiService.subscribeMembershipCard(
          normalizedUserName,
          {
            number,
            expiryMonth: expiry.slice(0, 2),
            expiryYear: expiry.slice(2, 4),
            birthOrBusinessRegistrationNumber: birth,
            passwordTwoDigits: pw2,
          },
          // 코드를 쓰면 혜택 플랜으로 시작한다(서버도 코드에 적힌 플랜을 기준으로 처리한다).
          promoCodeToUse && promo ? promo.plan : selectedTier,
          promoCodeToUse || undefined,
        );
        if (!res.success) {
          setError(res.error || '카드 등록·결제에 실패했습니다. 카드 정보를 확인해 주세요.');
          return;
        }
        if (res.data) setVerification(res.data);
        const grantedPromo = res.promo;
        closeConfirm();
        const nextDate = nextBillingOf(res.data)
          ? new Date(nextBillingOf(res.data) as string).toLocaleDateString('ko-KR')
          : null;
        if (grantedPromo) {
          // 무료로 시작한 구독 — 지금 빠져나간 금액이 없다는 점을 먼저 알린다.
          const promoLabel = TIER_LABEL[grantedPromo.plan] || tierLabel;
          flashSuccess(
            `출시 혜택 코드가 등록되어 ${promoLabel}을(를) ${grantedPromo.freeMonths}개월간 무료로 이용합니다. 지금 결제된 금액은 없습니다.`
              + (nextDate
                ? ` ${nextDate}부터 등록한 카드로 월 ${TIER_PRICE[grantedPromo.plan].toLocaleString()}원이 자동결제됩니다.`
                : ''),
          );
        } else {
          flashSuccess(
            `카드로 ${tierAmount.toLocaleString()}원이 결제되어 ${tierLabel}이(가) 활성화되었습니다.`
              + (nextDate
                ? ` 다음 결제일은 ${nextDate}이며, 가입일 기준 매월 자동결제됩니다.`
                : ' 가입일 기준 매월 자동결제됩니다.'),
          );
        }
      } catch (e) {
        console.error('[Membership] card billing key error:', e);
        setError('결제 처리 중 오류가 발생했습니다. 다시 시도해 주세요.');
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── 간편결제(카카오페이): PortOne 빌링키로 정기결제 등록 ──
    // SDK 는 여기서 받는다. 모든 페이지가 미리 받으면 결제를 열지 않는
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
      // 카카오페이는 PortOne V2 빌링키를 발급해 매월 자동결제(정기결제)로 동작한다.

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
        returnPath: '/admin?tab=membership',
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
      closeConfirm();
      const methodLabel = payMethod === 'KAKAOPAY' ? '카카오페이로' : '카드로';
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

  const handleCancelSubscription = () => {
    setError(null);
    setCancelOpen(true);
  };

  // 해지 확정 — 서버가 "결제한 이용 기간이 끝나는 날 종료"로 예약을 걸고,
  // 그 날짜까지는 membership_active 를 그대로 유지한다(남은 기간 이용).
  const confirmCancelSubscription = async () => {
    setSaving(true);
    const res = await apiService.saveSellerVerification(normalizedUserName, { membership_active: false });
    setSaving(false);
    if (!res.success) {
      setError(res.error || '해지 처리 중 오류가 발생했습니다.');
      return;
    }
    setCancelOpen(false);
    if (res.data) setVerification(res.data);
    const endsAt = res.data?.membership_ends_at || res.data?.next_billing_date;
    if (res.data?.membership_active && endsAt) {
      flashSuccess(
        `해지가 예약되었습니다. ${formatDate(endsAt)}까지 그대로 이용할 수 있고, 다음 결제는 진행되지 않습니다.`,
      );
    } else {
      flashSuccess('멤버십이 해지되었습니다.');
    }
  };

  // 해지 예약 취소(= 구독 계속하기). 아직 이용 기간이 남아 있을 때만 노출된다.
  const resumeSubscription = async () => {
    setError(null);
    setSaving(true);
    const res = await apiService.saveSellerVerification(normalizedUserName, {
      membership_cancel_at_period_end: false,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error || '해지 취소 처리 중 오류가 발생했습니다.');
      return;
    }
    if (res.data) setVerification(res.data);
    flashSuccess('해지 예약이 취소되었습니다. 멤버십이 계속 유지됩니다.');
  };

  // Legacy installs may carry membership_plan === 'live' from the previous single-tier
  // setup — normalizeTier maps it to the new 'commerce' tier so existing subscribers
  // don't lose access.
  const currentPlan: MembershipTier | null = normalizeTier(verification?.membership_plan);

  // 상위 플랜은 하위 플랜의 기능을 모두 포함한다. 현재 구독이 tier 를 이미
  // 포함하고 있으면(= 더 높은 등급) 카드에 "○○에 포함되어 있습니다"를 띄운다.
  const includedInCurrentPlan = (tier: MembershipTier) =>
    membershipActive && !!currentPlan && TIER_RANK[currentPlan] > TIER_RANK[tier];

  // 구독 중인 플랜 카드의 상태 + 해지 버튼. 해지 예약이 걸린 동안에는 남은 이용
  // 기간과 "해지 취소"를 대신 보여준다(세 플랜 카드가 같은 UI 를 쓴다).
  const subscribedActions = (subscribedLabel: string) => (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div
          className={`flex-1 py-3 px-4 rounded-xl font-bold text-center border text-sm ${
            cancelPending
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-green-50 text-green-700 border-green-200'
          }`}
        >
          {cancelPending
            ? `⏳ ${language === 'en' ? 'Cancellation scheduled' : '해지 예약됨'}`
            : `✓ ${subscribedLabel}`}
        </div>
        <button
          type="button"
          onClick={cancelPending ? resumeSubscription : handleCancelSubscription}
          disabled={saving}
          className={`px-4 py-3 rounded-xl font-bold text-sm border transition-all disabled:opacity-50 ${
            cancelPending
              ? 'text-blue-600 border-blue-200 hover:bg-blue-50'
              : 'text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {cancelPending
            ? language === 'en'
              ? 'Keep subscription'
              : '해지 취소'
            : language === 'en'
              ? 'Cancel'
              : '해지하기'}
        </button>
      </div>
      {cancelPending && (
        <p className="text-[11px] font-bold text-amber-700 leading-relaxed">
          {endsAtLabel
            ? language === 'en'
              ? `Available until ${endsAtLabel}. No further payments will be charged.`
              : `${endsAtLabel}까지 그대로 이용할 수 있고, 다음 결제는 진행되지 않습니다.`
            : language === 'en'
              ? 'Your membership ends when the paid period is over.'
              : '결제한 이용 기간이 끝나면 자동으로 해지됩니다.'}
        </p>
      )}
    </div>
  );

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
            ? 'Choose Standard for content features, AI Collaboration to add the timeline AI assistant and the content planning AI, or Pro Plan for all features including DM automation and the Insights menu. All plans are monthly subscriptions and include VAT.'
            : '콘텐츠 기능이 필요하면 스탠다드, 협업 AI와 콘텐츠 기획 AI까지 더하려면 AI 협업, 디엠 자동화와 인사이트 메뉴를 포함해 모든 기능을 쓰려면 프로 플랜을 선택하세요. 모든 플랜은 월 단위 구독이며 언제든 해지할 수 있고, 표시된 금액은 모두 부가세(VAT) 포함입니다.'}
        </p>
      </header>

      {/* 출시 혜택은 직접 연락한 인플루언서에게만 코드로 안내한다. 광고로 들어온 사용자가
          혜택의 존재를 알 필요는 없으므로 구독 전 화면에는 아무 안내도 두지 않는다. */}

      {successMsg && (
        <div className="mb-6 max-w-2xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold rounded-xl px-4 py-3">
          ✓ {successMsg}
        </div>
      )}

      {error && !confirmOpen && !cancelOpen && (
        <div className="mb-6 max-w-2xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* 현재 구독 상태 — 다음 결제일, 그리고 해지를 예약했다면 언제까지 쓸 수 있는지.
          플랜 카드가 없는 예전 커머스 멤버십도 여기서 해지할 수 있다. */}
      {!loading && membershipActive && currentPlan && (
        <section className="mb-10 max-w-3xl">
          <div
            className={`rounded-2xl border p-5 md:p-6 ${
              cancelPending
                ? 'bg-amber-50 border-amber-200'
                : promoActive
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-blue-50 border-blue-100'
            }`}
          >
            <div className="sm:flex sm:items-center sm:justify-between gap-4">
              <div>
                <p
                  className={`text-[11px] font-black uppercase tracking-widest ${
                    cancelPending ? 'text-amber-600' : promoActive ? 'text-emerald-600' : 'text-blue-500'
                  }`}
                >
                  {cancelPending
                    ? language === 'en'
                      ? 'Cancellation scheduled'
                      : '해지 예약'
                    : promoActive
                      ? language === 'en'
                        ? 'Launch benefit · free period'
                        : '출시 혜택 · 무료 이용 중'
                      : language === 'en'
                        ? 'Current subscription'
                        : '현재 구독'}
                </p>
                <h3 className="text-base md:text-lg font-black text-slate-900 mt-0.5">
                  {TIER_LABEL[currentPlan]}
                </h3>
                <p className="text-xs md:text-sm text-slate-600 font-medium mt-1 leading-relaxed">
                  {cancelPending
                    ? endsAtLabel
                      ? language === 'en'
                        ? `You keep full access until ${endsAtLabel}. After that the membership ends and no further payment is charged.`
                        : `이미 결제한 이용 기간인 ${endsAtLabel}까지는 모든 기능을 그대로 이용할 수 있습니다. 그 이후에는 자동으로 해지되며, 다음 달부터 결제되지 않습니다.`
                      : language === 'en'
                        ? 'Your membership ends when the paid period is over.'
                        : '결제한 이용 기간이 끝나면 자동으로 해지됩니다.'
                    : promoActive && promoFreeUntilLabel
                      ? language === 'en'
                        ? `Launch benefit — free until ${promoFreeUntilLabel}. From that date ₩${promoMonthlyPrice.toLocaleString()} is charged monthly to your registered card. Cancel before then and nothing is charged.`
                        : `출시 혜택으로 ${promoFreeUntilLabel}까지 무료로 이용합니다. 그 날부터 등록한 카드로 월 ${promoMonthlyPrice.toLocaleString()}원이 자동결제되며, 그 전에 해지하면 결제되지 않습니다.`
                      : endsAtLabel
                        ? language === 'en'
                          ? `Next payment on ${endsAtLabel} · billed monthly on your signup date.`
                          : `다음 결제일은 ${endsAtLabel}이며, 가입일 기준 매월 자동결제됩니다.`
                        : language === 'en'
                          ? 'Billed monthly on your signup date.'
                          : '가입일 기준 매월 자동결제됩니다.'}
                </p>
              </div>
              <div className="shrink-0 mt-4 sm:mt-0">
                <button
                  type="button"
                  onClick={cancelPending ? resumeSubscription : handleCancelSubscription}
                  disabled={saving}
                  className={`w-full sm:w-auto px-5 py-3 rounded-xl font-bold text-sm border transition-all disabled:opacity-50 ${
                    cancelPending
                      ? 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {cancelPending
                    ? language === 'en'
                      ? 'Keep subscription'
                      : '해지 취소하고 계속 이용'
                    : language === 'en'
                      ? 'Cancel membership'
                      : '멤버십 해지하기'}
                </button>
              </div>
            </div>
          </div>
        </section>
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
              subscribedActions(language === 'en' ? 'Subscribed to Standard' : '스탠다드 멤버십 구독 중')
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
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>콘텐츠 기획 AI</strong> 이용 — 브랜드 가이드를 읽고 캠페인 기획안 · 본문 작성</li>
            </ul>

            {loading ? (
              <div className="text-slate-400 text-sm font-bold">상태 확인 중...</div>
            ) : membershipActive && currentPlan === 'standard_ai' ? (
              subscribedActions('AI 협업 멤버십 구독 중')
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
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>협업 타임라인 AI 어시스턴트 포함</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>콘텐츠 기획 AI</strong> 포함 — 캠페인 기획안 · 본문 초안 작성</li>
            </ul>

            {loading ? (
              <div className="text-slate-400 text-sm font-bold">상태 확인 중...</div>
            ) : membershipActive && currentPlan === 'pro' ? (
              subscribedActions('프로 플랜 구독 중')
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
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>결제수단은 <strong>신용/체크카드만 가능</strong> · 네이버페이, 페이코, 카카오페이 등 간편결제 제외</li>
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
            <li><strong>멤버십은 가입일 기준 매월 자동결제(정기결제)됩니다.</strong> 신용·체크카드는 입력한 카드로, 카카오페이는 등록한 카카오페이로 매월 같은 날 자동 결제되며(첫 달은 가입 시 즉시 결제) 언제든 해지할 수 있습니다.</li>
            <li><strong>해지하면 이미 결제한 이용 기간까지는 그대로 이용</strong>할 수 있고, 그 다음 달부터 자동결제가 중단되면서 멤버십이 해지됩니다. 이미 결제한 이용료는 환불되지 않고 남은 기간 이용으로 대체됩니다. 종료일 전까지는 “해지 취소”로 구독을 계속할 수 있습니다.</li>
            <li><strong>표시된 모든 금액은 부가세(VAT 10%)가 포함된 금액</strong>입니다. 결제 시 추가로 청구되는 금액은 없습니다.</li>
            <li>스탠다드 멤버십 구독 시 영상 업로드와 콘텐츠 7개 이상 업로드를 이용할 수 있습니다.</li>
            <li>협업 타임라인 AI 어시스턴트(대화 요약 · 일정 정리 · 답장 초안)는 AI 협업 멤버십({STANDARD_AI_PRICE.toLocaleString()}원) 이상에 포함됩니다. 스탠다드 멤버십({STANDARD_PRICE.toLocaleString()}원)에는 포함되지 않습니다.</li>
            <li><strong>콘텐츠 기획 AI</strong>(브랜드 가이드를 읽고 캠페인 기획안 · 본문 작성)는 AI 협업 멤버십과 프로 플랜에 포함되며, 멤버십을 구독하지 않으면 이용할 수 없습니다.</li>
            <li>프로 플랜은 스탠다드 · AI 협업 멤버십 혜택을 포함하며, 인스타그램 디엠 자동화는 프로 플랜에서만 이용할 수 있습니다.</li>
            <li>디엠 자동화는 인스타그램 댓글에 반응해 자동으로 DM을 보내고, 키워드별 응답 문구와 발송 이력을 관리할 수 있습니다. 인스타그램 프로페셔널(비즈니스 · 크리에이터) 계정 연동이 필요합니다.</li>
            <li><strong>인사이트 메뉴</strong>: 릴스 조회 · 도달 · 저장 지표와 반응 좋은 릴스 TOP 5, AI 콘텐츠 코칭을 함께 제공합니다. 비즈니스 계정은 우리 계정을 태그한 인플루언서 콘텐츠까지 인사이트에서 볼 수 있습니다.</li>
          </ul>
        </div>
      </section>

      {/* 아래 세 창의 닫기(×) 버튼은 32px 이었다. 손끝이 닿는 최소 크기(44px)보다
          작아서 휴대폰에서는 눌렀다고 생각했는데 안 닫히는 일이 생긴다. 창을 닫는
          유일한 버튼이 그러면 사용자는 갇힌 것으로 받아들인다. 휴대폰에서만 44px 로
          키우고(마우스로는 32px 도 충분하니 md 부터는 그대로), 늘어난 12px 은 음수
          마진으로 머리말의 여백(px-5 py-4) 안으로 흘려보낸다 — 그래야 머리말이
          두꺼워져 본문이 볼 높이를 빼앗기지 않는다. */}
      {/* 해지 안내 모달 — 해지해도 결제한 이용 기간은 남는다는 점을 먼저 알린다. */}
      {cancelOpen && (
        <div className="modal-overlay fixed inset-0 z-[210] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
          <div className="modal-card bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-black text-amber-500 uppercase tracking-widest">
                  {currentPlan ? TIER_LABEL[currentPlan] : '멤버십'}
                </p>
                <h3 className="text-lg font-black text-slate-900">
                  {language === 'en' ? 'Cancel membership' : '멤버십 해지 안내'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => { setCancelOpen(false); setError(null); }}
                className="shrink-0 w-11 h-11 md:w-8 md:h-8 -my-1.5 -mr-2 md:my-0 md:mr-0 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-2xl md:text-xl"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="modal-body p-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {endsAtLabel ? (
                <>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-[11px] font-black text-amber-600 uppercase tracking-widest mb-1">
                      {language === 'en' ? 'Available until' : '이용 가능 기간'}
                    </p>
                    <p className="text-2xl font-black text-amber-700">{endsAtLabel}</p>
                    <p className="text-xs font-bold text-amber-600 mt-2">
                      {language === 'en'
                        ? 'Access continues to the end of the period you already paid for.'
                        : '이미 결제한 이용 기간까지는 그대로 이용할 수 있습니다.'}
                    </p>
                  </div>
                  <ul className="space-y-2 text-xs md:text-sm text-slate-600 font-medium">
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 font-bold shrink-0">•</span>
                      {language === 'en'
                        ? `You keep every membership feature until ${endsAtLabel} — this month's payment is not wasted.`
                        : <span><strong>{endsAtLabel}까지</strong> 멤버십 전용 기능을 모두 그대로 이용할 수 있습니다. 이번 달 결제분은 남은 기간 동안 사용됩니다.</span>}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 font-bold shrink-0">•</span>
                      {language === 'en'
                        ? 'From next month there is no automatic payment — the membership ends by itself.'
                        : <span><strong>다음 달부터 결제되지 않습니다.</strong> 종료일이 지나면 자동결제 없이 멤버십이 해지됩니다.</span>}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 font-bold shrink-0">•</span>
                      {language === 'en'
                        ? 'Already-paid months are not refunded; you use the remaining period instead.'
                        : '이미 결제한 이용료는 환불되지 않고, 남은 기간 이용으로 대체됩니다.'}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 font-bold shrink-0">•</span>
                      {language === 'en'
                        ? 'You can undo this any time before the end date with "Keep subscription".'
                        : '종료일 전까지는 “해지 취소”로 구독을 계속할 수 있습니다.'}
                    </li>
                  </ul>
                </>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs md:text-sm text-slate-600 font-medium leading-relaxed">
                  {language === 'en'
                    ? 'This membership has no remaining paid period, so it ends as soon as you cancel and membership-only features become unavailable.'
                    : '남은 결제 기간이 없는 멤버십이라 해지하면 바로 종료되며, 멤버십 전용 기능을 이용할 수 없습니다.'}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setCancelOpen(false); setError(null); }}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  {language === 'en' ? 'Keep my membership' : '멤버십 유지하기'}
                </button>
                <button
                  type="button"
                  onClick={confirmCancelSubscription}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-slate-800 hover:bg-slate-900 transition-all shadow-md disabled:opacity-50"
                >
                  {saving
                    ? language === 'en'
                      ? 'Processing...'
                      : '처리 중...'
                    : endsAtLabel
                      ? language === 'en'
                        ? 'Cancel at period end'
                        : '남은 기간 후 해지하기'
                      : language === 'en'
                        ? 'Cancel now'
                        : '해지하기'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 결제 확인 창. z-[210] 인 이유가 있다 — 대시보드의 모바일 아래 막대가
          z-[100], 그 서랍이 z-[200] 이라, 예전처럼 z-50 으로 두면 막대가 창의
          아래쪽을 덮어 결제 버튼을 가렸다(문의로 들어온 그 화면이다).
          크기는 .modal-overlay / .modal-card / .modal-body 세 클래스가 잡는다:
          내용이 길어도 본문만 스크롤하고 결제 버튼 줄은 화면 안에 남는다. */}
      {confirmOpen && (
        <div className="modal-overlay fixed inset-0 z-[210] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
          <div className="modal-card bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-black text-blue-500 uppercase tracking-widest">{TIER_LABEL[selectedTier]}</p>
                <h3 className="text-lg font-black text-slate-900">구독 결제 확인</h3>
              </div>
              <button
                type="button"
                onClick={closeConfirm}
                className="shrink-0 w-11 h-11 md:w-8 md:h-8 -my-1.5 -mr-2 md:my-0 md:mr-0 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-2xl md:text-xl"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="modal-body p-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              {promo ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <p className="text-xs font-black text-emerald-600 uppercase tracking-widest mb-1">오늘 결제 금액</p>
                  <p className="text-3xl font-black text-emerald-700">
                    0<span className="text-sm font-bold ml-1">원</span>
                  </p>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <p className="text-xs font-black text-blue-500 uppercase tracking-widest mb-1">월 구독료 (부가세 포함)</p>
                  <p className="text-3xl font-black text-blue-700">{TIER_PRICE[selectedTier].toLocaleString()}<span className="text-sm font-bold ml-1">원 / 월</span></p>
                  <p className="text-xs font-bold text-blue-500 mt-2">
                    지금 첫 달 결제 · 가입일 기준 매월 자동결제 · 언제든 해지 가능
                  </p>
                </div>
              )}

              <div>
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">결제 수단</p>
                <div className="grid grid-cols-2 gap-2">
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
                      type="text"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      maxLength={19}
                      value={cardForm.number}
                      onChange={(e) => setCardForm({ ...cardForm, number: e.target.value })}
                      placeholder="카드번호 (숫자만)"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-blue-400"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        maxLength={5}
                        value={cardForm.expiry}
                        onChange={(e) => setCardForm({ ...cardForm, expiry: e.target.value })}
                        placeholder="유효기간 MM/YY"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-blue-400"
                      />
                      <input
                        ref={birthRef}
                        type="text"
                        inputMode="numeric"
                        name="cardHolderBirth"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        maxLength={10}
                        value={cardForm.birth}
                        onChange={(e) => setCardForm({ ...cardForm, birth: e.target.value })}
                        placeholder="생년월일 6자리"
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <input
                      ref={pw2Ref}
                      type="password"
                      inputMode="numeric"
                      name="cardPasswordTwoDigits"
                      autoComplete="new-password"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      maxLength={2}
                      value={cardForm.pw2}
                      onChange={(e) => setCardForm({ ...cardForm, pw2: e.target.value })}
                      placeholder="카드 비밀번호 앞 2자리"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:border-blue-400"
                    />
                    <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
                      {promo
                        ? <>입력한 카드는 <strong className="text-slate-600">무료 기간이 끝난 뒤 자동결제</strong>에 사용됩니다(오늘은 결제되지 않습니다).</>
                        : <>입력한 카드로 <strong className="text-slate-600">매월 같은 날 자동으로 결제</strong>됩니다(첫 달은 지금 결제).</>}
                      {' '}카드 정보는 결제사로만 전달되어 자동결제용 결제키로 바뀌며 픽스폴리오에는 저장되지 않습니다.
                      법인카드는 생년월일 대신 사업자등록번호 10자리를 입력하세요.
                    </p>

                    {/* 코드 입력칸만 남긴다. 무슨 혜택이 있는 코드인지는 직접 연락받은
                        사람만 알아야 하므로 화면에 설명을 쓰지 않는다. */}
                    <div className="pt-3 mt-1 border-t border-dashed border-slate-200">
                      <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">
                        코드 <span className="text-slate-400 normal-case tracking-normal font-bold">(선택)</span>
                      </p>
                      <div className="flex gap-2">
                        {/* maxLength 에 여유를 둔 이유: 구분자가 섞인 붙여넣기(323-039-109)가
                            잘려 들어오면 앞자리만 남는다. 넉넉히 받고 숫자만 남긴다.

                            min-w-0 이 꼭 있어야 한다. flex 자식은 기본값이
                            min-width:auto 라 자기 내용 너비 밑으로는 줄어들지
                            않는다. 이 칸의 내용 너비는 placeholder('9자리 코드
                            입력') 가 정하는데, index.css 가 휴대폰 입력칸을
                            16px 로 못 박고 여기에 tracking-[0.2em] 까지 붙어서
                            332px 이 나온다 — 폭 390px 폰의 이 줄(326px)보다
                            넓다. 그래서 flex-1 만 있던 동안에는 줄이 89~159px
                            넘쳐서(320·360·390px 폰 모두) 옆의 '코드 확인'
                            버튼이 오른쪽으로 잘려 나갔고, 그 가로 넘침이 화면을
                            옆으로 밀어 아래 막대까지 잘려 보이게 했다.
                            min-w-0 으로 풀면 칸이 남는 폭까지 줄어 넘침이 0 이 된다. */}
                        <input
                          type="text"
                          inputMode="numeric"
                          name="membershipPromoCode"
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          maxLength={PROMO_CODE_LENGTH + 2}
                          value={promoInput}
                          onChange={(e) => {
                            setPromoInput(e.target.value.replace(/[^0-9]/g, '').slice(0, PROMO_CODE_LENGTH));
                            // 코드를 고치면 앞서 확인한 결과는 더 이상 이 값이 아니다.
                            setPromo(null);
                            setPromoError(null);
                          }}
                          placeholder={`${PROMO_CODE_LENGTH}자리 코드 입력`}
                          className={`flex-1 min-w-0 px-3 py-2.5 rounded-xl border text-sm font-bold tracking-[0.2em] focus:outline-none ${
                            promo
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : promoError
                                ? 'border-red-300 focus:border-red-400'
                                : 'border-slate-200 focus:border-blue-400'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={verifyPromoCode}
                          disabled={promoChecking || promoInput.replace(/[^0-9]/g, '').length !== PROMO_CODE_LENGTH}
                          className="px-4 py-2.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                        >
                          {promoChecking ? '확인 중…' : promo ? '확인됨' : '코드 확인'}
                        </button>
                      </div>
                      {promo && (
                        <p className="text-[11px] font-bold text-emerald-600 mt-2 leading-relaxed">
                          ✓ 코드가 적용되었습니다. 오늘 결제 금액 0원.
                        </p>
                      )}
                      {promoError && (
                        <p className="text-[11px] font-bold text-red-600 mt-2">{promoError}</p>
                      )}
                    </div>
                  </div>
                )}
                {payMethod === 'KAKAOPAY' && (
                  <p className="text-[11px] text-slate-400 font-medium mt-2 leading-relaxed">
                    카카오톡 앱에서 카카오페이로 간편하게 결제됩니다.
                    <br />
                    코드는 신용카드로 등록할 때 입력할 수 있습니다.
                  </p>
                )}
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>✓ 구독 즉시 멤버십 기능을 이용할 수 있습니다.</p>
                {promo ? (
                  <p>
                    ✓ {formatDate(promo.freeUntil) ? `${formatDate(promo.freeUntil)}부터 ` : '무료 기간이 끝나면 '}
                    월 {promo.monthlyPriceKrw.toLocaleString()}원이 자동결제되며, 그 전에 해지하면 결제되지 않습니다.
                  </p>
                ) : (
                  <p>✓ 가입일 기준 매월 자동결제되며, 해지하면 결제한 기간이 끝나는 날 종료됩니다.</p>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {selectedTier === 'pro'
                  ? '구독을 시작하면 영상 업로드 · 콘텐츠 업로드 등 스탠다드 기능과 협업 타임라인 AI 어시스턴트, 콘텐츠 기획 AI, 인스타그램 디엠 자동화, 인사이트 메뉴(릴스 지표 · 릴스 TOP 5 · AI 코칭)가 즉시 활성화됩니다.'
                  : selectedTier === 'standard_ai' || selectedTier === 'commerce'
                    ? '구독을 시작하면 영상 업로드 · 콘텐츠 업로드 등 스탠다드 기능과 함께 협업 타임라인 AI 어시스턴트와 콘텐츠 기획 AI가 즉시 활성화됩니다. 디엠 자동화는 프로 플랜에서 이용할 수 있습니다.'
                    : '구독을 시작하면 영상 업로드 · 콘텐츠 업로드 등 스탠다드 기능이 즉시 활성화됩니다. 협업 타임라인 AI 어시스턴트와 콘텐츠 기획 AI는 AI 협업 멤버십, 디엠 자동화는 프로 플랜에서 이용할 수 있습니다.'}
              </p>
            </div>
            <div className="shrink-0 px-5 py-4 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={closeConfirm}
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
                    : 'bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-700 hover:to-pink-600'
                }`}
              >
                {saving
                  ? '처리 중...'
                  : promo
                    ? '0원으로 구독 시작'
                    : payMethod === 'CARD'
                      ? `${TIER_PRICE[selectedTier].toLocaleString()}원 결제하고 자동결제 시작`
                      : `${TIER_PRICE[selectedTier].toLocaleString()}원으로 구독 시작`}
              </button>
            </div>
          </div>
        </div>
      )}
      {claudeOpen && (
        <div className="modal-overlay fixed inset-0 z-[210] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
          <div className="modal-card bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-black text-orange-500 uppercase tracking-widest">클로드 플랜 · 🤖 Claude</p>
                <h3 className="text-lg font-black text-slate-900">클로드 플랜 시작</h3>
              </div>
              <button
                type="button"
                onClick={() => { setClaudeOpen(false); setClaudeError(null); }}
                className="shrink-0 w-11 h-11 md:w-8 md:h-8 -my-1.5 -mr-2 md:my-0 md:mr-0 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 text-2xl md:text-xl"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="modal-body p-5 space-y-4">
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
                  클로드 플랜은 네이버페이, 페이코, 카카오페이 등 간편결제를 지원하지 않습니다.
                </p>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>✓ 결제 즉시 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧이 충전됩니다.</p>
                <p>✓ 협업 타임라인 AI에서 Claude를 선택해 사용할 수 있습니다.</p>
                <p>✓ 크레딧이 부족하면 협업 타임라인의 클로드 관리 화면에서 추가 충전할 수 있습니다.</p>
                <p>✓ 남은 크레딧은 멤버십 플랜 화면과 협업 타임라인 AI 입력창에서 확인할 수 있습니다.</p>
              </div>
            </div>
            <div className="shrink-0 px-5 py-4 border-t border-slate-100 flex gap-2">
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
