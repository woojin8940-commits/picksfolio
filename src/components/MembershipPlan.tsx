import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { toAsciiSafeId } from '../utils/formatters';
import { payClaudePlan, CLAUDE_PAY_METHODS, type ClaudePayMethod } from '../utils/claudeCharge';
import { startTossCardBilling } from '../utils/tossPayments';
import {
  PORTONE_STORE_ID,
  channelKeyFor,
  easyPayParam,
  portoneRedirectUrl,
  savePortOneIntent,
  clearPortOneIntent,
  genPortOneId,
} from '../utils/portonePayments';
import { isNativeApp } from '../utils/appEnv';
import type { SellerVerification } from '../types';

// 업로드된 사업자등록증이 PDF 인지 판별한다(이미지가 아니면 미리보기 대신 PDF 카드로 노출).
const isPdfUrl = (url: string) => /\.pdf(\?|$)/i.test(url);

interface MembershipPlanProps {
  userName: string;
}

// PortOne V2 — storeId and channelKey are public identifiers used by the
// browser SDK. The V2 API secret lives server-side only (PORTONE_V2_API_SECRET).
// 토스페이먼츠(카드)는 PortOne 을 거치지 않고 토스페이먼츠와 직접 연동한다(startTossCardBilling).
// PortOne 은 토스페이 / 카카오페이 간편결제 빌링키 발급에만 사용한다(리다이렉트 방식).

type MembershipTier = 'standard' | 'standard_ai' | 'commerce';
const STANDARD_PRICE = 4900;
const STANDARD_AI_PRICE = 6900;
const COMMERCE_PRICE = 13900;
// Claude plan (separate prepaid AI add-on) — activated by its own PortOne payment
// window opened from this page. Keep these figures in sync with the server's
// claude-credits pricing module.
const ACTIVATION_PRICE_KRW = 9900;
const ACTIVATION_GRANT_CREDITS = 3000;
const TIER_PRICE: Record<MembershipTier, number> = {
  standard: STANDARD_PRICE,
  standard_ai: STANDARD_AI_PRICE,
  commerce: COMMERCE_PRICE,
};
const TIER_LABEL: Record<MembershipTier, string> = {
  standard: '스탠다드 멤버십',
  standard_ai: '스탠다드 AI 멤버십',
  commerce: '커머스 멤버십',
};

const BANKS = [
  'KB국민은행',
  '신한은행',
  '우리은행',
  '하나은행',
  'NH농협은행',
  'IBK기업은행',
  'SC제일은행',
  '케이뱅크',
  '카카오뱅크',
  '토스뱅크',
  '새마을금고',
  '신협',
  '우체국',
  '수협은행',
  '부산은행',
  '대구은행',
  '광주은행',
  '전북은행',
  '경남은행',
  '제주은행',
];

const maskAccountNumber = (n: string) => {
  if (!n) return '';
  if (n.length <= 4) return n;
  return `${n.slice(0, 2)}${'*'.repeat(Math.max(n.length - 4, 0))}${n.slice(-2)}`;
};

const MembershipPlan: React.FC<MembershipPlanProps> = ({ userName }) => {
  const normalizedUserName = userName.replace(/^biz\//, '');
  const [verification, setVerification] = useState<SellerVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bizEditing, setBizEditing] = useState(false);
  const [acctEditing, setAcctEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<'CARD' | 'KAKAOPAY' | 'TOSSPAY'>('CARD');
  const [selectedTier, setSelectedTier] = useState<MembershipTier>('standard');

  // Claude plan (prepaid AI add-on, billed separately from the memberships above).
  // Activating it opens a PortOne payment window right here; the base monthly grant
  // of ACTIVATION_GRANT_CREDITS credits is added server-side once the payment clears.
  const [claudeOpen, setClaudeOpen] = useState(false);
  const [claudePayMethod, setClaudePayMethod] = useState<ClaudePayMethod>('CARD');
  const [claudePaying, setClaudePaying] = useState(false);
  const [claudeError, setClaudeError] = useState<string | null>(null);
  const [claudeActive, setClaudeActive] = useState(false);
  const [claudeBalance, setClaudeBalance] = useState<number | null>(null);

  // 사업자등록증 이미지 업로드 — 관리자가 이미지를 직접 확인하고 수락해야 인증이 완료된다.
  const [bizImageUploading, setBizImageUploading] = useState(false);
  const [bizImageError, setBizImageError] = useState('');

  const [biz, setBiz] = useState({
    registration_image_url: '',
  });

  const [acct, setAcct] = useState({
    bank_name: BANKS[0],
    account_number: '',
    account_holder: '',
  });

  const loadVerification = useCallback(async () => {
    setLoading(true);
    const data = await apiService.getSellerVerification(normalizedUserName);
    setVerification(data);
    if (data?.business) {
      setBiz({
        registration_image_url: data.business.registration_image_url || '',
      });
    }
    if (data?.settlement) {
      setAcct({
        bank_name: data.settlement.bank_name || BANKS[0],
        account_number: data.settlement.account_number || '',
        account_holder: data.settlement.account_holder || '',
      });
    }
    setLoading(false);
  }, [normalizedUserName]);

  useEffect(() => {
    loadVerification();
  }, [loadVerification]);

  const loadClaude = useCallback(async () => {
    const data = await apiService.getClaudeCredits(normalizedUserName);
    if (data?.credits) {
      setClaudeActive(!!data.credits.planActive);
      setClaudeBalance(data.credits.balanceCredits ?? 0);
    }
  }, [normalizedUserName]);

  useEffect(() => {
    loadClaude();
  }, [loadClaude]);

  // Open the Claude plan payment window and, once the payment is verified
  // server-side, mark the plan active and refresh the credit balance.
  const startClaudePlan = async () => {
    setClaudeError(null);
    setClaudePaying(true);
    try {
      const outcome = await payClaudePlan(normalizedUserName, 'activation', ACTIVATION_PRICE_KRW, claudePayMethod);
      if (!outcome.success) {
        setClaudeError(outcome.error || '결제에 실패했습니다. 다시 시도해 주세요.');
        return;
      }
      const granted = outcome.result?.credits;
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

  const businessVerified = !!verification?.business_verified;
  // 사업자등록증 수동 심사 상태. 'approved' 일 때만 라이브 송출이 가능하다.
  const businessReviewStatus: 'pending' | 'approved' | 'rejected' | null =
    verification?.business_review_status
    || (businessVerified ? 'approved' : (verification?.business ? 'pending' : null));
  const businessRejectReason = verification?.business_review_reason || '';
  const settlementRegistered = !!verification?.settlement_registered;
  const membershipActive = !!verification?.membership_active;

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 2500);
  };

  // 사업자등록증 이미지 업로드. 업로드된 이미지는 관리자 심사 콘솔에 노출된다.
  const handleBizImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isImage && !isPdf) {
      setBizImageError('이미지 또는 PDF 파일만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setBizImageError('파일 용량은 10MB 이하여야 합니다.');
      return;
    }
    setBizImageError('');
    setBizImageUploading(true);
    try {
      const url = await apiService.uploadImage(`biz-${normalizedUserName}`, file, file.name);
      if (url) {
        setBiz((prev) => ({ ...prev, registration_image_url: url }));
      } else {
        setBizImageError('이미지 업로드에 실패했습니다. 다시 시도해 주세요.');
      }
    } catch {
      setBizImageError('이미지 업로드 중 오류가 발생했습니다.');
    } finally {
      setBizImageUploading(false);
    }
  };

  const submitBusiness = async () => {
    setError(null);
    if (!biz.registration_image_url) {
      setError('사업자등록증(이미지 또는 PDF)을 첨부해 주세요. 관리자가 직접 확인 후 수락합니다.');
      return;
    }
    setSaving(true);
    const res = await apiService.saveSellerVerification(normalizedUserName, {
      business: { registration_image_url: biz.registration_image_url },
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error || '저장 중 오류가 발생했습니다.');
      return;
    }
    if (res.data) setVerification(res.data);
    setBizEditing(false);
    flashSuccess('사업자등록증이 제출되었습니다. 관리자 확인 후 수락되면 라이브 송출이 가능합니다.');
  };

  const submitSettlement = async () => {
    setError(null);
    if (!acct.bank_name || !acct.account_number.trim() || !acct.account_holder.trim()) {
      setError('은행/계좌번호/예금주명은 필수입니다.');
      return;
    }
    const cleanNum = acct.account_number.replace(/[^0-9-]/g, '');
    if (cleanNum.length < 6) {
      setError('계좌번호가 너무 짧습니다.');
      return;
    }
    setSaving(true);
    const res = await apiService.saveSellerVerification(normalizedUserName, {
      settlement: { ...acct, account_number: cleanNum },
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error || '저장 중 오류가 발생했습니다.');
      return;
    }
    if (res.data) setVerification(res.data);
    setAcctEditing(false);
    flashSuccess('정산 계좌가 저장되었습니다.');
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

    // 토스페이먼츠(카드) — PortOne 을 거치지 않고 토스페이먼츠 빌링 인증창으로 리다이렉트한다.
    // 돌아온 뒤 /toss/return 페이지가 빌링키 발급·첫 달 결제·멤버십 활성화를 마무리한다.
    if (payMethod === 'CARD') {
      setSaving(true);
      const out = await startTossCardBilling({
        type: 'membership',
        username: normalizedUserName,
        tier: selectedTier,
        amountKrw: tierAmount,
        orderName: `픽스폴리오 ${tierLabel} 정기결제`,
        payMethod: 'CARD',
        returnPath: window.location.pathname + window.location.search,
      });
      // 정상 흐름이면 위에서 페이지가 떠난다. 시작 전 오류만 여기서 처리한다.
      if (!out.success) {
        setError(out.error || '결제 요청을 시작하지 못했습니다. 다시 시도해 주세요.');
        setSaving(false);
      }
      return;
    }

    if (typeof window === 'undefined' || !window.PortOne) {
      setError('결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }

    setSaving(true);
    try {
      const safeUserName = toAsciiSafeId(normalizedUserName);
      const issueId = genPortOneId('billing', normalizedUserName);
      // CARD 는 위에서 이미 분기했으므로 여기서는 TOSSPAY / KAKAOPAY 뿐이다.
      const ppMethod = payMethod === 'KAKAOPAY' ? 'KAKAOPAY' : 'TOSSPAY';

      // 토스페이는 리다이렉트 전용 PG 다. redirectUrl 을 넣어 빌링 인증창으로 페이지를 넘기고,
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
        billingKeyMethod: 'EASY_PAY',
        issueId,
        issueName: `픽스폴리오 ${tierLabel} 정기결제`,
        displayAmount: tierAmount,
        currency: 'KRW',
        redirectUrl: portoneRedirectUrl(),
        ...easyPayParam(ppMethod),
        customer: {
          customerId: safeUserName,
          fullName: verification?.business?.representative_name || verification?.business?.company_name || undefined,
          phoneNumber: verification?.business?.contact_phone || undefined,
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
      const nextDate = verifyRes.data?.next_billing_date
        ? new Date(verifyRes.data.next_billing_date).toLocaleDateString('ko-KR')
        : null;
      flashSuccess(
        `${methodLabel} ${TIER_PRICE[selectedTier].toLocaleString()}원이 결제되어 ${tierLabel}이(가) 활성화되었습니다.`
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
  // setup — treat it as the new 'commerce' tier so existing subscribers don't lose access.
  const rawPlan = verification?.membership_plan || null;
  const currentPlan: MembershipTier | null =
    rawPlan === 'standard'
      ? 'standard'
      : rawPlan === 'standard_ai'
        ? 'standard_ai'
        : rawPlan === 'commerce' || rawPlan === 'live'
          ? 'commerce'
          : null;

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
        <h2 className="text-xl md:text-3xl font-black text-slate-900">멤버십 플랜</h2>
        <p className="text-slate-500 mt-2 text-sm md:text-base leading-relaxed max-w-3xl">
          콘텐츠 기능이 필요하면 <strong className="text-slate-700">스탠다드</strong>, 협업 AI까지 더하려면 <strong className="text-slate-700">스탠다드 AI</strong>, 라이브 커머스까지 모두 이용하려면 <strong className="text-slate-700">커머스</strong> 멤버십을 선택하세요. 모든 플랜은 월 단위 구독이며 언제든 해지할 수 있습니다.
        </p>
      </header>

      {successMsg && (
        <div className="mb-6 max-w-2xl bg-green-50 border border-green-200 text-green-700 text-sm font-bold rounded-xl px-4 py-3">
          ✓ {successMsg}
        </div>
      )}

      {/* Plan grid */}
      <section className="mb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 max-w-6xl">
          {/* Standard Plan */}
          <div className="relative rounded-2xl border-2 border-blue-200 bg-white p-6 md:p-8 shadow-sm">
            <div className="absolute -top-3 left-6">
              <span className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                스탠다드 멤버십
              </span>
            </div>
            <div className="flex items-end gap-1 mb-4 mt-2">
              <span className="text-3xl md:text-4xl font-black text-slate-900">4,900</span>
              <span className="text-slate-500 text-sm mb-1">원 / 월</span>
            </div>
            <h4 className="font-bold text-slate-800 text-lg mb-3">콘텐츠 풀 액세스</h4>
            <ul className="space-y-2 text-sm text-slate-600 mb-6">
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>포트폴리오 상단 커버 <strong>영상 업로드</strong></li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>상품·포트폴리오 <strong>영상 업로드</strong></li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>포트폴리오 <strong>콘텐츠 구성</strong>(텍스트·이미지 블록) 편집</li>
            </ul>

            {loading ? (
              <div className="text-slate-400 text-sm font-bold">상태 확인 중...</div>
            ) : membershipActive && currentPlan === 'standard' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 py-3 px-4 rounded-xl font-bold text-center bg-green-50 text-green-700 border border-green-200 text-sm">
                  ✓ 스탠다드 멤버십 구독 중
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
            ) : membershipActive && currentPlan === 'standard_ai' ? (
              <div className="py-3 px-4 rounded-xl font-bold text-center bg-slate-50 text-slate-500 border border-slate-200 text-sm">
                스탠다드 AI 멤버십에 포함되어 있습니다
              </div>
            ) : membershipActive && currentPlan === 'commerce' ? (
              <div className="py-3 px-4 rounded-xl font-bold text-center bg-slate-50 text-slate-500 border border-slate-200 text-sm">
                커머스 멤버십에 포함되어 있습니다
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleStartSubscribe('standard')}
                disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
              >
                4,900원으로 구독 시작
              </button>
            )}
          </div>

          {/* Standard + AI Plan */}
          <div className="relative rounded-2xl border-2 border-violet-200 bg-white p-6 md:p-8 shadow-sm">
            <div className="absolute -top-3 left-6">
              <span className="bg-gradient-to-r from-violet-500 to-blue-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                스탠다드 AI 멤버십 · ✨ AI
              </span>
            </div>
            <div className="flex items-end gap-1 mb-4 mt-2">
              <span className="text-3xl md:text-4xl font-black text-slate-900">6,900</span>
              <span className="text-slate-500 text-sm mb-1">원 / 월</span>
            </div>
            <h4 className="font-bold text-slate-800 text-lg mb-3">스탠다드 전체 + 협업 AI</h4>
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
                  ✓ 스탠다드 AI 멤버십 구독 중
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
            ) : membershipActive && currentPlan === 'commerce' ? (
              <div className="py-3 px-4 rounded-xl font-bold text-center bg-slate-50 text-slate-500 border border-slate-200 text-sm">
                커머스 멤버십에 포함되어 있습니다
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleStartSubscribe('standard_ai')}
                disabled={saving}
                className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 transition-all shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
              >
                {membershipActive && currentPlan === 'standard'
                  ? '스탠다드 AI 멤버십으로 업그레이드'
                  : '6,900원으로 구독 시작'}
              </button>
            )}
          </div>

          {/* Commerce Plan */}
          <div className="relative rounded-2xl border-2 border-pink-200 bg-white p-6 md:p-8 shadow-sm">
            <div className="absolute -top-3 left-6">
              <span className="bg-gradient-to-r from-blue-600 to-pink-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                커머스 멤버십 · 🎥 라이브
              </span>
            </div>
            <div className="flex items-end gap-1 mb-4 mt-2">
              <span className="text-3xl md:text-4xl font-black text-slate-900">13,900</span>
              <span className="text-slate-500 text-sm mb-1">원 / 월</span>
            </div>
            <h4 className="font-bold text-slate-800 text-lg mb-3">라이브 커머스 + 스탠다드 전체</h4>
            <ul className="space-y-2 text-sm text-slate-600 mb-6">
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>스탠다드 멤버십 모든 혜택 포함</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>협업 타임라인 AI 어시스턴트</strong> 포함</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>라이브 송출 월 3시간 포함</strong> · 초과분 시간당 8,900원 후불</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span><strong>라이브 매출 수수료 8.5%</strong> (PG 결제 수수료 포함)</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>실시간 채팅 &amp; 상품 연동</li>
              <li className="flex items-start gap-2"><span className="text-green-500 font-bold shrink-0">✓</span>방송 기록 &amp; 분석 리포트 · 라이브 시작 알림톡</li>
            </ul>

            {loading ? (
              <div className="text-slate-400 text-sm font-bold">상태 확인 중...</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
                  <StatusPill label="멤버십 구독" done={membershipActive && currentPlan === 'commerce'} />
                  <StatusPill label="사업자 인증" done={businessVerified} subLabel="라이브 방송용" />
                  <StatusPill label="정산 계좌 등록" done={settlementRegistered} subLabel="라이브 방송용" />
                </div>

                {membershipActive && currentPlan === 'commerce' ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 py-3 px-4 rounded-xl font-bold text-center bg-green-50 text-green-700 border border-green-200 text-sm">
                      {businessVerified && settlementRegistered
                        ? '✓ 구독 중 · 라이브 방송을 이용할 수 있습니다'
                        : '✓ 구독 중 · 라이브 방송은 사업자 인증 · 정산 계좌 등록 후 이용 가능'}
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
                    onClick={() => handleStartSubscribe('commerce')}
                    disabled={saving}
                    className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-700 hover:to-pink-600 transition-all shadow-md hover:shadow-lg cursor-pointer disabled:opacity-50"
                  >
                    {membershipActive && (currentPlan === 'standard' || currentPlan === 'standard_ai')
                      ? '커머스 멤버십으로 업그레이드'
                      : '13,900원으로 구독 시작'}
                  </button>
                )}
              </>
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
              <h4 className="font-bold text-slate-800 text-lg mb-2">협업 AI를 Claude로 — 월 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧</h4>
              <p className="text-sm text-slate-600 leading-relaxed mb-3">
                협업 타임라인 AI는 기본적으로 제미나이(무료, AI 멤버십 포함)로 동작합니다. 깊은 분석이나 문서·계약서 검토처럼 더 강력한 답변이 필요할 때는 <strong>Claude</strong>를 선택할 수 있어요. 클로드 플랜은 멤버십과 <strong>별도로 결제</strong>하며, 결제하면 바로 크레딧이 충전됩니다.
              </p>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>{ACTIVATION_PRICE_KRW.toLocaleString()}원 · <strong>월 1회 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧</strong> 충전</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>사용한 토큰만큼만 차감 · 남은 크레딧은 이월</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>크레딧을 더 쓰고 싶으면 <strong>추가 충전</strong>해서 사용</li>
              </ul>
            </div>
            <div className="shrink-0 mt-4 md:mt-0">
              {claudeActive ? (
                <div className="w-full md:w-auto md:text-right">
                  <div className="px-5 py-3 rounded-xl font-bold text-center bg-green-50 text-green-700 border border-green-200 text-sm">
                    ✓ 클로드 플랜 이용 중
                  </div>
                  {claudeBalance != null && (
                    <p className="text-[11px] text-slate-500 font-bold mt-2 text-center md:text-right">
                      보유 크레딧 {claudeBalance.toLocaleString()} 크레딧
                    </p>
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
                  <p className="text-[11px] text-slate-400 font-medium mt-2 text-center md:text-right">멤버십 없이도 이용 가능</p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Business Verification */}
      <section className="mb-10 max-w-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="text-xl">🧾</span> 사업자 인증
            {businessReviewStatus === 'approved' && (
              <span className="text-[10px] font-black text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">인증됨</span>
            )}
            {businessReviewStatus === 'pending' && (
              <span className="text-[10px] font-black text-orange-700 bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full">심사 중</span>
            )}
            {businessReviewStatus === 'rejected' && (
              <span className="text-[10px] font-black text-red-700 bg-red-100 border border-red-200 px-2 py-0.5 rounded-full">거절됨</span>
            )}
          </h3>
          {!bizEditing && (
            <button
              type="button"
              onClick={() => { setError(null); setBizEditing(true); }}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50"
            >
              {verification?.business ? '수정' : '등록하기'}
            </button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          {bizEditing ? (
            <div className="space-y-3">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              {/* 사업자등록증 이미지 업로드 */}
              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">사업자등록증 (이미지 또는 PDF) *</label>
                {biz.registration_image_url ? (
                  <div className="space-y-2">
                    <a href={biz.registration_image_url} target="_blank" rel="noreferrer" className="block">
                      {isPdfUrl(biz.registration_image_url) ? (
                        <div className="flex items-center gap-3 w-full px-4 py-5 rounded-xl border border-slate-200 bg-slate-50">
                          <span className="text-2xl">📄</span>
                          <span className="text-sm font-bold text-slate-600">사업자등록증 PDF · 새 창에서 보기</span>
                        </div>
                      ) : (
                        <img
                          src={biz.registration_image_url}
                          alt="사업자등록증"
                          className="w-full max-h-[320px] object-contain rounded-xl border border-slate-200 bg-slate-50"
                        />
                      )}
                    </a>
                    <label className="inline-block text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer">
                      {bizImageUploading ? '업로드 중...' : '다른 파일로 변경'}
                      <input type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={handleBizImageUpload} disabled={bizImageUploading} />
                    </label>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-1.5 w-full py-8 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
                    <span className="text-2xl">📎</span>
                    <span className="text-xs font-bold text-slate-500">
                      {bizImageUploading ? '업로드 중...' : '사업자등록증 첨부 (JPG·PNG·PDF, 10MB 이하)'}
                    </span>
                    <input type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={handleBizImageUpload} disabled={bizImageUploading} />
                  </label>
                )}
                {bizImageError && <p className="text-[11px] text-red-500 font-bold mt-1.5">{bizImageError}</p>}
                <p className="text-[10px] text-slate-400 font-bold mt-1.5">제출하신 사업자등록증은 관리자가 직접 확인 후 수락합니다. 수락되면 라이브 송출이 가능합니다. 심사에는 보통 1~2일 정도 소요됩니다.</p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setBizEditing(false); setError(null); }}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={submitBusiness}
                  disabled={saving || bizImageUploading || !biz.registration_image_url}
                  title={!biz.registration_image_url ? '사업자등록증(이미지 또는 PDF)을 먼저 첨부해 주세요.' : undefined}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-700 hover:to-pink-600 disabled:opacity-50"
                >
                  {saving ? '제출 중...' : '제출하기'}
                </button>
              </div>
            </div>
          ) : verification?.business ? (
            <div className="space-y-3">
              {businessReviewStatus === 'pending' && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs font-bold text-orange-700">
                  ⏳ 관리자 확인 대기 중입니다. 사업자등록증 검토 후 수락되면 라이브 송출이 가능합니다. 심사에는 보통 1~2일 정도 소요됩니다.
                </div>
              )}
              {businessReviewStatus === 'rejected' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs font-bold text-red-700">
                  사업자 인증이 거절되었습니다{businessRejectReason ? ` · ${businessRejectReason}` : ''}. 정보를 수정해 다시 제출해 주세요.
                </div>
              )}
              {(verification.business.company_name
                || verification.business.representative_name
                || verification.business.business_number
                || verification.business.contact_phone
                || verification.business.business_type
                || verification.business.business_item
                || verification.business.business_address) && (
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  {verification.business.company_name && <div><span className="text-slate-400">상호</span> · {verification.business.company_name}</div>}
                  {verification.business.representative_name && <div><span className="text-slate-400">대표자</span> · {verification.business.representative_name}</div>}
                  {verification.business.business_number && <div><span className="text-slate-400">등록번호</span> · {verification.business.business_number}</div>}
                  {verification.business.contact_phone && <div><span className="text-slate-400">연락처</span> · {verification.business.contact_phone}</div>}
                  {verification.business.business_type && <div><span className="text-slate-400">업태</span> · {verification.business.business_type}</div>}
                  {verification.business.business_item && <div><span className="text-slate-400">종목</span> · {verification.business.business_item}</div>}
                  {verification.business.business_address && <div className="col-span-2"><span className="text-slate-400">주소</span> · {verification.business.business_address}</div>}
                </div>
              )}
              {verification.business.registration_image_url && (
                <a href={verification.business.registration_image_url} target="_blank" rel="noreferrer" className="block">
                  {isPdfUrl(verification.business.registration_image_url) ? (
                    <div className="flex items-center gap-3 w-full px-4 py-5 rounded-xl border border-slate-200 bg-slate-50">
                      <span className="text-2xl">📄</span>
                      <span className="text-sm font-bold text-slate-600">사업자등록증 PDF · 새 창에서 보기</span>
                    </div>
                  ) : (
                    <img
                      src={verification.business.registration_image_url}
                      alt="사업자등록증"
                      className="w-full max-h-[280px] object-contain rounded-xl border border-slate-200 bg-slate-50"
                    />
                  )}
                </a>
              )}
              {businessReviewStatus === 'approved' && (
                <div><span className="text-[10px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">✓ 관리자 확인 완료 · 인증됨</span></div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              라이브 방송 송출을 위해 사업자등록증(이미지 또는 PDF)을 제출해 주세요. 관리자 확인 후 수락되면 라이브 송출이 가능합니다.
              <span className="block text-[11px] text-slate-400 font-bold mt-1">※ 심사에는 보통 1~2일 정도 소요됩니다.</span>
            </p>
          )}
        </div>
      </section>

      {/* Settlement Account */}
      <section className="mb-12 max-w-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="text-xl">🏦</span> 정산 계좌 등록
            {settlementRegistered && (
              <span className="text-[10px] font-black text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">등록됨</span>
            )}
          </h3>
          {!acctEditing && (
            <button
              type="button"
              onClick={() => { setError(null); setAcctEditing(true); }}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50"
            >
              {settlementRegistered ? '수정' : '등록하기'}
            </button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          {acctEditing ? (
            <div className="space-y-3">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">은행 *</label>
                <select
                  value={acct.bank_name}
                  onChange={(e) => setAcct({ ...acct, bank_name: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:border-blue-400"
                >
                  {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <Field label="계좌번호 * (숫자/하이픈만)" value={acct.account_number} onChange={(v) => setAcct({ ...acct, account_number: v.replace(/[^0-9-]/g, '') })} placeholder="00000000000000" inputMode="numeric" />
              <Field label="예금주명 *" value={acct.account_holder} onChange={(v) => setAcct({ ...acct, account_holder: v })} placeholder="사업자 대표자명과 동일해야 합니다" />
              <p className="text-[11px] text-slate-400 font-medium">※ 예금주명은 사업자등록증상의 대표자명 또는 법인명과 일치해야 정산이 정상 처리됩니다.</p>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setAcctEditing(false); setError(null); }}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={submitSettlement}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-700 hover:to-pink-600 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          ) : settlementRegistered && verification?.settlement ? (
            <div className="text-sm text-slate-600">
              <span className="font-bold text-slate-700">{verification.settlement.bank_name}</span>
              <span className="mx-2 text-slate-300">·</span>
              <span className="font-mono">{maskAccountNumber(verification.settlement.account_number)}</span>
              <span className="mx-2 text-slate-300">·</span>
              <span>{verification.settlement.account_holder}</span>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              판매 수익이 입금될 정산 계좌를 등록해 주세요. 예금주명은 사업자 대표자와 일치해야 합니다.
            </p>
          )}
        </div>
      </section>

      <section className="max-w-2xl">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 md:p-6">
          <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
            <span>ℹ️</span> 안내사항
          </h4>
          <ul className="list-disc pl-5 space-y-2 text-sm text-slate-500 marker:text-slate-400">
            <li>스탠다드 멤버십은 월 4,900원, 스탠다드 AI 멤버십은 월 6,900원, 커머스 멤버십은 월 13,900원이며, 언제든 해지할 수 있습니다.</li>
            <li>스탠다드 멤버십 구독 시 포트폴리오 상단 커버 영상 업로드 · 상품/포트폴리오 영상 업로드 · 콘텐츠 구성 편집을 이용할 수 있습니다.</li>
            <li>협업 타임라인 AI 어시스턴트(대화 요약 · 일정 정리 · 답장 초안)는 스탠다드 AI 멤버십(6,900원)과 커머스 멤버십(13,900원)에 포함됩니다. 스탠다드 멤버십(4,900원)에는 포함되지 않습니다.</li>
            <li>커머스 멤버십은 스탠다드 혜택을 모두 포함하며, 라이브 송출 월 3시간(180분)이 포함됩니다. 초과분은 시간당 8,900원(분당 약 148원)으로 후불 정산됩니다.</li>
            <li>라이브 매출 수수료는 결제액의 8.5%이며 PG 결제 수수료가 포함된 단일가입니다. 수수료를 차감한 금액이 등록된 정산 계좌로 입금됩니다.</li>
            <li>라이브 송출에는 사업자 인증과 정산 계좌 등록이 추가로 필요합니다. 등록된 정산 계좌로 라이브 판매 수익이 입금되며, 계좌 예금주명은 사업자 대표자와 일치해야 합니다.</li>
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
                onClick={() => { setConfirmOpen(false); setError(null); }}
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
                <p className="text-xs font-black text-blue-500 uppercase tracking-widest mb-1">월 구독료</p>
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
                    <span className="whitespace-nowrap">카드</span>
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
                  <p className="text-[11px] text-slate-400 font-medium mt-2">
                    토스페이먼츠 결제창을 통해 신용·체크카드로 결제됩니다.
                  </p>
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
                {selectedTier === 'commerce'
                  ? '구독을 시작하면 포트폴리오 영상 커버 · 상품/포트폴리오 영상 업로드 · 콘텐츠 구성 등 스탠다드 기능과 협업 타임라인 AI 어시스턴트가 즉시 활성화되고, 라이브 커머스 송출까지 이용할 수 있습니다.'
                  : selectedTier === 'standard_ai'
                    ? '구독을 시작하면 포트폴리오 영상 커버 · 상품/포트폴리오 영상 업로드 · 콘텐츠 구성 등 스탠다드 기능과 함께 협업 타임라인 AI 어시스턴트가 즉시 활성화됩니다. 라이브 커머스 송출은 커머스 멤버십에서 이용할 수 있습니다.'
                    : '구독을 시작하면 포트폴리오 영상 커버 · 상품/포트폴리오 영상 업로드 · 콘텐츠 구성 등 스탠다드 기능이 즉시 활성화됩니다. 협업 타임라인 AI 어시스턴트는 스탠다드 AI 멤버십, 라이브 커머스 송출은 커머스 멤버십에서 이용할 수 있습니다.'}
              </p>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setError(null); }}
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
                <p className="text-xs font-bold text-orange-500 mt-2">월 1회 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧 충전 · 더 필요하면 추가 충전</p>
              </div>

              <div>
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">결제 수단</p>
                <div className="grid grid-cols-3 gap-2">
                  {CLAUDE_PAY_METHODS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setClaudePayMethod(m.id)}
                      className={`py-3 px-2 rounded-xl border-2 text-xs font-bold transition-all ${
                        claudePayMethod === m.id
                          ? 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>✓ 결제 즉시 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧이 충전됩니다.</p>
                <p>✓ 협업 타임라인 AI에서 Claude를 선택해 사용할 수 있습니다.</p>
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

const StatusPill: React.FC<{ label: string; done: boolean; subLabel?: string }> = ({ label, done, subLabel }) => (
  <div className={`rounded-xl px-3 py-2 text-[11px] font-black flex items-center gap-2 ${
    done ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-50 text-slate-500 border border-slate-200'
  }`}>
    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${done ? 'bg-green-500 text-white' : 'bg-slate-300 text-white'}`}>
      {done ? '✓' : '•'}
    </span>
    <span className="flex-1 leading-tight">
      {label}
      {subLabel && <span className="block text-[9px] font-bold text-slate-400 mt-0.5">{subLabel}</span>}
    </span>
  </div>
);

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}> = ({ label, value, onChange, placeholder, inputMode }) => (
  <div>
    <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:border-blue-400"
    />
  </div>
);

export default MembershipPlan;
