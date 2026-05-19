import React from 'react';

interface PrivacyPolicyProps {
  onNavigateHome: () => void;
}

const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onNavigateHome }) => {
  return (
    <div className="min-h-screen bg-midnight text-white">
      <div className="container mx-auto px-4 sm:px-6 py-16 max-w-4xl">
        <button
          onClick={onNavigateHome}
          className="text-slate-400 hover:text-white text-sm font-bold mb-8 inline-flex items-center gap-2 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          홈으로 돌아가기
        </button>

        <h1 className="text-3xl md:text-4xl font-black mb-4 tracking-tight">
          픽스폴리오(Picksfolio) 개인정보처리방침
        </h1>
        <p className="text-slate-500 text-sm font-bold mb-12">시행일: 2026년 4월 1일</p>

        {/* 1. 개인정보처리방침이란? */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">1. 개인정보처리방침이란?</h2>
          <div className="space-y-4 text-slate-400 text-sm leading-relaxed">
            <p>
              픽스폴리오(이하 "회사")는 회원의 개인정보보호를 매우 중요시하며, 이용자가 회사의 서비스(이하 "서비스")를 이용함과 동시에 온라인상에서 회사에 제공한 개인정보가 보호 받을 수 있도록 최선을 다하고 있습니다. 이에 회사는 개인정보보호법 등 관련 법규를 준수하고 있습니다.
            </p>
            <p>
              회사는 아래와 같이 개인정보처리방침을 명시하여 회원이 제공한 개인정보가 어떠한 용도와 방식으로 이용되고 있는지 알려드립니다. 본 방침은 정부의 지침이나 회사의 내부 정책에 따라 변경될 수 있으며, 개정 시 즉시 서비스 화면에 게시합니다.
            </p>
          </div>
        </section>

        {/* 2. 개인정보의 수집 및 이용목적 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">2. 개인정보의 수집 및 이용목적</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            회사는 더욱 향상된 사용자 경험과 원활한 커머스 환경을 제공하기 위해 최소한의 개인정보를 수집하며, 다음의 목적 이외의 용도로는 이용하지 않습니다.
          </p>
          <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
            <li><span className="text-slate-300 font-bold">회원관리 및 이용자 식별:</span> 회원 가입의사 확인, 카카오 로그인을 통한 본인 식별, 멤버십 구독 서비스 제공 및 유지관리</li>
            <li><span className="text-slate-300 font-bold">라이브 커머스 운영(셀러):</span> 라이브 방송 송출, 방송 알림톡 발송, 인스타그램 자동 DM 전송, 장바구니 및 주문 내역 관리, 일괄 결제 처리</li>
            <li><span className="text-slate-300 font-bold">상품 구매 및 배송 지원(시청자):</span> 시청자(구매자)의 상품 주문 접수, 결제 처리, 배송지 확인 및 판매자에게 주문 정보 제공</li>
            <li><span className="text-slate-300 font-bold">거래 및 정산:</span> 유료 구독료 결제, 시청자 상품 대금의 결제대행(PG) 처리, 멤버십 회원(셀러) 정산 계좌 입금 및 세무 신고</li>
            <li><span className="text-slate-300 font-bold">고객지원:</span> 민원 사항 확인 및 사실 조사를 위한 연락, 처리 결과 통보</li>
            <li><span className="text-slate-300 font-bold">마케팅 및 품질 개선:</span> 신규 기능 개발, 서비스 이용 패턴 분석, 광고성 정보(이벤트 등) 제공(마케팅 수신은 별도 동의를 받아 처리)</li>
          </ul>
        </section>

        {/* 3. 수집하는 개인정보 항목과 수집방법 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">3. 수집하는 개인정보 항목과 수집방법</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            회사는 서비스 제공을 위해 아래와 같은 개인정보를 수집합니다.
          </p>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">회원가입 및 로그인 시</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">필수:</span> (카카오 로그인 시) 카카오 계정 고유 식별값, 이름(닉네임), 휴대폰 번호(알림톡 발송용), 프로필 사진</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">라이브 커머스 이용 시 (시청자/구매자)</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">수집 항목:</span> 이름, 휴대폰 번호, 배송지 주소, 이메일 주소, 장바구니 담기 내역, 주문·결제 기록</li>
              <li><span className="text-slate-300 font-bold">수집 시점:</span> 상품 주문·결제 시점에 한하여 최소한의 정보만 수집합니다.</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">멤버십 구독 및 정산 시 (셀러)</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">필수:</span> 이름, 사업자 정보(사업자등록번호·상호·대표자명·업태·종목·사업장 주소), 계좌번호, 예금주명, 이메일 주소, 연락처</li>
              <li><span className="text-slate-300 font-bold">세무 신고용:</span> 주민등록번호(원천징수 의무 이행 등 법령에 근거하여 수집하는 경우에 한함)</li>
              <li><span className="text-slate-300 font-bold">결제 정보:</span> 구독료 결제를 위한 카드/간편결제 식별값(결제대행사 보관, 회사는 직접 보관하지 않음)</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">서비스 이용 과정에서 자동 수집</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              IP주소, 쿠키, 방문 일시, 서비스 이용 기록, 기기 정보(OS, 모델명 등)
            </p>
          </div>
        </section>

        {/* 4. 개인정보의 제3자 제공 및 취급위탁 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">4. 개인정보의 제3자 제공 및 취급위탁</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            회사는 회원의 동의 없이 개인정보를 외부에 제공하지 않으나, 거래 이행 및 서비스 운영을 위해 아래와 같이 위탁 및 제공하고 있습니다.
          </p>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">개인정보의 제3자 제공</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-3">
              시청자(구매자)가 라이브 방송을 통해 상품을 주문·결제하는 경우, 주문 이행을 위해 다음과 같이 해당 방송의 멤버십 회원(셀러)에게 개인정보를 제공합니다.
            </p>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">제공받는 자:</span> 해당 라이브 방송의 멤버십 회원(셀러, 판매자)</li>
              <li><span className="text-slate-300 font-bold">제공 목적:</span> 구매 상품의 배송, 주문 내역 확인, 교환·환불 등 CS 처리</li>
              <li><span className="text-slate-300 font-bold">제공 항목:</span> 이름, 휴대폰 번호, 배송지 주소, 주문 상품 정보</li>
              <li><span className="text-slate-300 font-bold">보유 기간:</span> 배송 완료 및 전자상거래법에 따른 보존 기간 종료 시까지</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">개인정보의 취급위탁</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-4">
              회사는 원활한 서비스 제공을 위해 아래 업체에 업무를 위탁합니다.
            </p>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">솔라피(Solapi):</span> 카카오 알림톡 및 SMS 발송 대행</li>
              <li><span className="text-slate-300 font-bold">포트원(PortOne):</span> 신용카드·토스페이·카카오페이 등 결제 대행, 정기 구독 빌링 및 시청자 상품 결제 처리</li>
              <li><span className="text-slate-300 font-bold">수파베이스(Supabase):</span> 회원 계정 및 서비스 데이터 보관</li>
              <li><span className="text-slate-300 font-bold">아마존웹서비스(AWS):</span> 라이브 방송 송출 인프라 및 클라우드 서버 운영</li>
            </ul>
          </div>
        </section>

        {/* 5. 개인정보의 처리 및 보유기간 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">5. 개인정보의 처리 및 보유기간</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            회사는 수집 시 동의 받은 보유 기간 또는 법령에 따른 기간 내에서 개인정보를 처리합니다.
          </p>
          <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
            <li><span className="text-slate-300 font-bold">회원 탈퇴 시:</span> 탈퇴 요청 5일 후 지체 없이 파기 (단, 재가입 방지를 위한 아이디 정보는 30일간 보관)</li>
            <li><span className="text-slate-300 font-bold">전자상거래 결제 기록:</span> 5년 (전자상거래법)</li>
            <li><span className="text-slate-300 font-bold">접속 로그 및 IP:</span> 3개월 (통신비밀보호법)</li>
          </ul>
        </section>

        {/* 6. 이용자의 권리와 행사 방법 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">6. 이용자의 권리와 행사 방법</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            이용자는 언제든지 자신의 개인정보를 열람, 정정하거나 삭제 요청(회원 탈퇴)을 할 수 있습니다.
          </p>
          <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
            <li>사이트 내 '프로필 수정' 또는 '회원 탈퇴' 기능을 통해 직접 처리 가능합니다.</li>
            <li>고객센터를 통해 서면, 이메일로 요청 시 지체 없이 조치하겠습니다.</li>
          </ul>
        </section>

        {/* 7. 쿠키 안내 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">7. 개인정보 자동 수집 장치(쿠키) 안내</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            회사는 개인화된 맞춤 서비스를 제공하기 위해 쿠키(Cookie)를 사용합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 라이브 커머스 일부 기능(장바구니 등) 이용에 어려움이 있을 수 있습니다.
          </p>
        </section>

        {/* 8. 개인정보 보호책임자 안내 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">8. 개인정보 보호책임자 안내</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            회사는 이용자의 개인정보를 보호하고 관련 불만을 처리하기 위해 책임자를 지정하고 있습니다.
          </p>
          <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
            <li><span className="text-slate-300 font-bold">책임자:</span> 신우진</li>
            <li><span className="text-slate-300 font-bold">연락처:</span> 010-3563-8940</li>
            <li><span className="text-slate-300 font-bold">이메일:</span> woojin8940@inplace-ad.com</li>
          </ul>
        </section>

        {/* 부칙 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">부칙</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            본 개인정보처리방침은 2026년 4월 1일부터 적용됩니다.
          </p>
        </section>

        <div className="border-t border-white/10 pt-8 mt-16">
          <p className="text-slate-600 text-xs font-bold">&copy; {new Date().getFullYear()} Picksfolio. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
