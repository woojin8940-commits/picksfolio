import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/apiService';
import { toAsciiSafeId } from '../utils/formatters';
import type { SellerVerification } from '../types';

interface MembershipPlanProps {
  userName: string;
}

// PortOne V2 — storeId and channelKey are public identifiers used by the
// browser SDK. The V2 API secret lives server-side only (PORTONE_V2_API_SECRET).
// 토스페이먼츠 채널 (MID: iamporttest_4) — 카드·토스페이 결제
const PORTONE_STORE_ID = 'store-1e85edf9-8f37-490c-9419-5a1f15db9ab5';
const PORTONE_CARD_CHANNEL_KEY = 'channel-key-4e4b5bcd-12b4-48b1-ac74-50e634d1a0e2';
const PORTONE_KAKAOPAY_CHANNEL_KEY = 'channel-key-0abb70ff-069a-4a4f-9939-5e0c60298182';
const PORTONE_TOSSPAY_CHANNEL_KEY = 'channel-key-4e4b5bcd-12b4-48b1-ac74-50e634d1a0e2';

type MembershipTier = 'standard' | 'standard_ai' | 'commerce';
const STANDARD_PRICE = 4900;
const STANDARD_AI_PRICE = 6900;
const COMMERCE_PRICE = 13900;
// Claude plan (separate prepaid AI add-on) — display figures only; the wallet and
// payments are handled in the 협업 타임라인 AI. Keep in sync with the server's
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

const formatBusinessNumber = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};

const formatPhone = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
};

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

  // 국세청 사업자등록번호 상태조회 — 조회에 성공해야 사업자 정보를 저장할 수 있다.
  const [bizVerifying, setBizVerifying] = useState(false);
  const [bizNtsVerified, setBizNtsVerified] = useState(false);
  const [bizNtsMsg, setBizNtsMsg] = useState('');
  const [bizNtsError, setBizNtsError] = useState('');

  const [biz, setBiz] = useState({
    company_name: '',
    business_number: '',
    representative_name: '',
    contact_phone: '',
    business_type: '',
    business_item: '',
    business_address: '',
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
        company_name: data.business.company_name || '',
        business_number: data.business.business_number || '',
        representative_name: data.business.representative_name || '',
        contact_phone: data.business.contact_phone || '',
        business_type: data.business.business_type || '',
        business_item: data.business.business_item || '',
        business_address: data.business.business_address || '',
      });
      // 이미 인증된 사업자라면 국세청 조회 통과 상태로 간주한다.
      if (data.business_verified || data.business.nts_verified) {
        setBizNtsVerified(true);
        setBizNtsMsg(`국세청 확인 완료 · ${data.business.nts_status || '계속사업자'}`);
      }
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

  const businessVerified = !!verification?.business_verified;
  const settlementRegistered = !!verification?.settlement_registered;
  const membershipActive = !!verification?.membership_active;

  const flashSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 2500);
  };

  // 사업자등록번호가 바뀌면 국세청 조회 상태를 초기화한다.
  const handleBizNumberChange = (v: string) => {
    setBiz({ ...biz, business_number: formatBusinessNumber(v) });
    setBizNtsVerified(false);
    setBizNtsMsg('');
    setBizNtsError('');
  };

  // 국세청 사업자등록정보 상태조회. 조회에 성공(계속사업자)하면 등록이 가능해진다.
  const verifyBusinessNts = async () => {
    const digits = biz.business_number.replace(/[^0-9]/g, '');
    if (digits.length !== 10) {
      setBizNtsError('사업자등록번호 10자리를 정확히 입력해 주세요.');
      return;
    }
    setBizVerifying(true);
    setBizNtsError('');
    setBizNtsMsg('');
    try {
      const response = await fetch('/.netlify/functions/business-verify-nts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_number: digits }),
      });
      const result = await response.json();
      if (result.verified) {
        setBizNtsVerified(true);
        setBizNtsMsg(`국세청 확인 완료 · ${result.status || '계속사업자'}`);
      } else {
        setBizNtsVerified(false);
        setBizNtsError(result.error || '국세청에 등록되지 않은 사업자등록번호입니다.');
      }
    } catch {
      setBizNtsError('국세청 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBizVerifying(false);
    }
  };

  const submitBusiness = async () => {
    setError(null);
    if (!biz.company_name.trim() || !biz.business_number.trim() || !biz.representative_name.trim() || !biz.contact_phone.trim()) {
      setError('상호/사업자등록번호/대표자명/연락처는 필수입니다.');
      return;
    }
    const digits = biz.business_number.replace(/[^0-9]/g, '');
    if (digits.length !== 10) {
      setError('사업자등록번호는 10자리 숫자여야 합니다.');
      return;
    }
    if (!bizNtsVerified) {
      setError('국세청 사업자 조회를 먼저 완료해 주세요. 조회 결과 정상 영업 중인 사업자만 등록할 수 있습니다.');
      return;
    }
    setSaving(true);
    const res = await apiService.saveSellerVerification(normalizedUserName, {
      business: { ...biz, nts_verified: true, nts_status: (bizNtsMsg.split('·')[1] || '계속사업자').trim() },
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error || '저장 중 오류가 발생했습니다.');
      return;
    }
    if (res.data) setVerification(res.data);
    setBizEditing(false);
    flashSuccess('사업자 정보가 저장되었습니다.');
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

    if (typeof window === 'undefined' || !window.PortOne) {
      setError('결제 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      return;
    }

    setSaving(true);
    try {
      const tierLabel = TIER_LABEL[selectedTier];
      const tierAmount = TIER_PRICE[selectedTier];
      const safeUserName = toAsciiSafeId(normalizedUserName);
      const issueId = `billing-${safeUserName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const channelKey =
        payMethod === 'KAKAOPAY'
          ? PORTONE_KAKAOPAY_CHANNEL_KEY
          : payMethod === 'TOSSPAY'
            ? PORTONE_TOSSPAY_CHANNEL_KEY
            : PORTONE_CARD_CHANNEL_KEY;

      const billingKeyMethod = payMethod === 'CARD' ? 'CARD' : 'EASY_PAY';

      const response = await window.PortOne.requestIssueBillingKey({
        storeId: PORTONE_STORE_ID,
        channelKey,
        billingKeyMethod,
        issueId,
        issueName: `픽스폴리오 ${tierLabel} 정기결제`,
        displayAmount: tierAmount,
        currency: 'KRW',
        ...(payMethod === 'KAKAOPAY' && {
          easyPay: { easyPayProvider: 'KAKAOPAY' },
        }),
        ...(payMethod === 'TOSSPAY' && {
          easyPay: { easyPayProvider: 'TOSSPAY' },
        }),
        customer: {
          customerId: safeUserName,
          fullName: verification?.business?.representative_name || verification?.business?.company_name || undefined,
          phoneNumber: verification?.business?.contact_phone || undefined,
        },
      });

      if (!response || response.code) {
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
        setError('빌링키를 받지 못했습니다. 다시 시도해 주세요.');
        setSaving(false);
        return;
      }

      const verifyRes = await apiService.issueBillingKeyPayment(normalizedUserName, billingKey, selectedTier);
      if (!verifyRes.success) {
        setError(verifyRes.error || '빌링 결제에 실패했습니다. 고객센터로 문의해 주세요.');
        setSaving(false);
        return;
      }

      if (verifyRes.data) setVerification(verifyRes.data);
      setConfirmOpen(false);
      const methodLabel = payMethod === 'KAKAOPAY' ? '카카오페이가' : payMethod === 'TOSSPAY' ? '토스페이가' : '카드가';
      flashSuccess(`${methodLabel} 등록되어 ${tierLabel}이(가) 활성화되었습니다. 매월 자동결제됩니다.`);
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
              <h4 className="font-bold text-slate-800 text-lg mb-2">협업 AI를 Claude로 — 선불 크레딧</h4>
              <p className="text-sm text-slate-600 leading-relaxed mb-3">
                협업 타임라인 AI는 기본적으로 제미나이(무료, AI 멤버십 포함)로 동작합니다. 깊은 분석이나 문서·계약서 검토처럼 더 강력한 답변이 필요할 때는 <strong>Claude</strong>를 선택할 수 있어요. 클로드 플랜은 멤버십과 <strong>별도로 결제</strong>하는 선불 크레딧이며, 결제 시 기본 크레딧이 지급됩니다.
              </p>
              <ul className="space-y-1.5 text-sm text-slate-600">
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>{ACTIVATION_PRICE_KRW.toLocaleString()}원으로 시작 · 기본 크레딧 {ACTIVATION_GRANT_CREDITS.toLocaleString()} 크레딧 지급</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>사용한 토큰만큼만 차감 · 남은 크레딧은 이월(매월 소멸 없음)</li>
                <li className="flex items-start gap-2"><span className="text-orange-500 font-bold shrink-0">✓</span>크레딧 소진 시 <strong>재충전</strong> 또는 <strong>자동충전</strong> 선택</li>
              </ul>
            </div>
            <div className="shrink-0 mt-4 md:mt-0">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('navigate-timeline'))}
                className="w-full md:w-auto px-6 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all shadow-md hover:shadow-lg"
              >
                협업 AI에서 클로드 플랜 시작
              </button>
              <p className="text-[11px] text-slate-400 font-medium mt-2 text-center md:text-right">멤버십 없이도 이용 가능</p>
            </div>
          </div>
        </div>
      </section>

      {/* Business Verification */}
      <section className="mb-10 max-w-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg md:text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="text-xl">🧾</span> 사업자 인증
            {businessVerified && (
              <span className="text-[10px] font-black text-green-700 bg-green-100 border border-green-200 px-2 py-0.5 rounded-full">인증됨</span>
            )}
          </h3>
          {!bizEditing && (
            <button
              type="button"
              onClick={() => { setError(null); setBizEditing(true); }}
              className="text-xs font-bold text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50"
            >
              {businessVerified ? '수정' : '등록하기'}
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
              <Field label="상호(사업자명) *" value={biz.company_name} onChange={(v) => setBiz({ ...biz, company_name: v })} placeholder="픽스폴리오" />
              <div>
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">사업자등록번호 *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={biz.business_number}
                    onChange={(e) => handleBizNumberChange(e.target.value)}
                    placeholder="000-00-00000"
                    inputMode="numeric"
                    disabled={bizNtsVerified}
                    className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={verifyBusinessNts}
                    disabled={bizVerifying || bizNtsVerified}
                    className="px-4 rounded-lg text-xs font-black whitespace-nowrap border border-slate-200 text-slate-700 bg-slate-50 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {bizVerifying ? '조회 중...' : bizNtsVerified ? '확인 완료' : '조회'}
                  </button>
                </div>
                {bizNtsMsg && <p className="text-[11px] text-emerald-600 font-bold mt-1.5">✓ {bizNtsMsg}</p>}
                {bizNtsError && <p className="text-[11px] text-red-500 font-bold mt-1.5">{bizNtsError}</p>}
                {!bizNtsVerified && !bizNtsMsg && (
                  <p className="text-[10px] text-slate-400 font-bold mt-1.5">국세청에 등록된 사업자만 등록할 수 있습니다. 조회 후 저장이 활성화됩니다.</p>
                )}
              </div>
              <Field label="대표자명 *" value={biz.representative_name} onChange={(v) => setBiz({ ...biz, representative_name: v })} placeholder="홍길동" />
              <Field label="연락처 *" value={biz.contact_phone} onChange={(v) => setBiz({ ...biz, contact_phone: formatPhone(v) })} placeholder="010-0000-0000" inputMode="tel" />
              <Field label="업태" value={biz.business_type} onChange={(v) => setBiz({ ...biz, business_type: v })} placeholder="소매업" />
              <Field label="종목" value={biz.business_item} onChange={(v) => setBiz({ ...biz, business_item: v })} placeholder="전자상거래" />
              <Field label="사업장 주소" value={biz.business_address} onChange={(v) => setBiz({ ...biz, business_address: v })} placeholder="서울특별시 ..." />
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
                  disabled={saving || !bizNtsVerified}
                  title={!bizNtsVerified ? '국세청 사업자 조회를 먼저 완료해 주세요.' : undefined}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-700 hover:to-pink-600 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          ) : businessVerified && verification?.business ? (
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
              <div><span className="text-slate-400">상호</span> · {verification.business.company_name}</div>
              <div><span className="text-slate-400">대표자</span> · {verification.business.representative_name}</div>
              <div><span className="text-slate-400">등록번호</span> · {verification.business.business_number}</div>
              <div><span className="text-slate-400">연락처</span> · {verification.business.contact_phone}</div>
              {verification.business.business_type && <div><span className="text-slate-400">업태</span> · {verification.business.business_type}</div>}
              {verification.business.business_item && <div><span className="text-slate-400">종목</span> · {verification.business.business_item}</div>}
              {verification.business.business_address && <div className="col-span-2"><span className="text-slate-400">주소</span> · {verification.business.business_address}</div>}
              {(verification.business.nts_verified || businessVerified) && (
                <div className="col-span-2 mt-1"><span className="text-[10px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">✓ 국세청 확인 · {verification.business.nts_status || '계속사업자'}</span></div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              라이브 방송 송출을 위해 사업자등록증 기반의 사업자 정보를 등록해 주세요.
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
                <p className="text-xs font-bold text-blue-500 mt-2">매월 자동결제, 언제든 해지 가능</p>
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
