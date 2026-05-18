import React, { useState } from 'react';
import { ArrowLeft, Check, CreditCard } from 'lucide-react';

interface MembershipPageProps {
  userName: string;
  isLoggedIn: boolean;
  onNavigateHome: () => void;
  onNavigateLogin: () => void;
  onNavigateBack: () => void;
}

const plans = [
  {
    id: 'standard',
    name: '스탠다드 멤버십',
    price: '4,900',
    period: '월',
    features: [
      '포트폴리오 영상 커버 업로드',
      '콘텐츠 구성 편집',
      '비즈니스 타임라인',
      '비즈니스 수신함',
    ],
    color: 'from-purple-600 to-indigo-600',
    btnColor: 'bg-purple-600 hover:bg-purple-500',
  },
  {
    id: 'commerce',
    name: '커머스 멤버십',
    price: '13,900',
    period: '월',
    badge: '인기',
    features: [
      '스탠다드 멤버십 모든 혜택',
      '라이브 커머스 송출',
      '실시간 상품 관리',
      '라이브 채팅 & 판매 기능',
      '정산 관리 시스템',
    ],
    color: 'from-amber-500 to-orange-600',
    btnColor: 'bg-amber-600 hover:bg-amber-500',
  },
];

const paymentMethods = [
  { id: 'card', label: '신용/체크카드', icon: '💳' },
  { id: 'kakao', label: '카카오페이', icon: '🟡' },
  { id: 'toss', label: '토스페이', icon: '🔵' },
];

const MembershipPage: React.FC<MembershipPageProps> = ({ userName, isLoggedIn, onNavigateLogin, onNavigateBack }) => {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState('card');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubscribe = async () => {
    if (!isLoggedIn) {
      alert('로그인이 필요합니다.');
      onNavigateLogin();
      return;
    }
    if (!selectedPlan) {
      alert('멤버십을 선택해 주세요.');
      return;
    }

    setIsProcessing(true);
    try {
      const PortOne = (window as any).PortOne;
      if (!PortOne) {
        alert('결제 시스템을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
        setIsProcessing(false);
        return;
      }

      const plan = plans.find(p => p.id === selectedPlan);
      const amount = selectedPlan === 'standard' ? 4900 : 13900;

      const response = await PortOne.requestPayment({
        storeId: import.meta.env.VITE_PORTONE_STORE_ID || '',
        channelKey: import.meta.env.VITE_PORTONE_CHANNEL_KEY || '',
        paymentId: `picks_${userName}_${selectedPlan}_${Date.now()}`,
        orderName: `PICKS ${plan?.name}`,
        totalAmount: amount,
        currency: 'KRW',
        payMethod: selectedPayment === 'kakao' ? 'EASY_PAY' : selectedPayment === 'toss' ? 'EASY_PAY' : 'CARD',
        customer: { customerId: userName },
      });

      if (response?.code === 'FAILURE') {
        alert('결제가 취소되었습니다.');
      } else if (response?.paymentId) {
        alert('결제가 완료되었습니다! 멤버십이 활성화됩니다.');
        onNavigateBack();
      }
    } catch (err: any) {
      console.error('Payment error:', err);
      alert('결제 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-midnight">
      <div className="container mx-auto px-6 py-12 max-w-4xl">
        <button onClick={onNavigateBack} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-8">
          <ArrowLeft size={20} strokeWidth={3} />
          <span className="text-sm font-bold">돌아가기</span>
        </button>

        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-black text-white mb-3">멤버십 플랜</h1>
          <p className="text-slate-400 font-medium">더 강력한 기능으로 수익을 극대화하세요.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {plans.map((plan) => (
            <div
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`relative bg-slate-900/60 backdrop-blur-xl border-2 rounded-[2rem] p-8 cursor-pointer transition-all hover:-translate-y-1 ${
                selectedPlan === plan.id ? 'border-purple-500 shadow-[0_0_40px_rgba(124,58,237,0.2)]' : 'border-white/10 hover:border-white/20'
              }`}
            >
              {plan.badge && (
                <div className="absolute -top-3 right-6 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-black px-4 py-1 rounded-full">
                  {plan.badge}
                </div>
              )}
              {selectedPlan === plan.id && (
                <div className="absolute top-6 right-6 w-6 h-6 bg-purple-600 rounded-full flex items-center justify-center">
                  <Check size={14} className="text-white" strokeWidth={3} />
                </div>
              )}
              <div className={`inline-block bg-gradient-to-r ${plan.color} text-white text-xs font-black px-3 py-1 rounded-lg mb-4`}>
                {plan.name}
              </div>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-3xl font-black text-white">{plan.price}원</span>
                <span className="text-slate-400 font-bold text-sm">/ {plan.period}</span>
              </div>
              <ul className="space-y-3">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                      <Check size={12} className="text-purple-400" strokeWidth={3} />
                    </div>
                    <span className="text-slate-300 text-sm font-medium">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {selectedPlan && (
          <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h3 className="text-lg font-black text-white mb-6">결제 수단 선택</h3>
            <div className="grid grid-cols-3 gap-3 mb-8">
              {paymentMethods.map((method) => (
                <button
                  key={method.id}
                  onClick={() => setSelectedPayment(method.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                    selectedPayment === method.id
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <span className="text-2xl">{method.icon}</span>
                  <span className="text-xs font-bold text-slate-300">{method.label}</span>
                </button>
              ))}
            </div>

            <button
              onClick={handleSubscribe}
              disabled={isProcessing}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white py-5 rounded-2xl font-black text-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_10px_40px_rgba(124,58,237,0.3)]"
            >
              {isProcessing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  결제 처리 중...
                </>
              ) : (
                <>
                  <CreditCard size={20} />
                  구독 시작하기
                </>
              )}
            </button>
            <p className="text-center text-slate-500 text-[11px] font-medium mt-4">
              이후 매월 같은 날짜에 자동결제됩니다. 언제든지 해지할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MembershipPage;
