import React from 'react';

interface TermsOfServiceProps {
  onNavigateHome: () => void;
}

const TermsOfService: React.FC<TermsOfServiceProps> = ({ onNavigateHome }) => {
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
          픽스폴리오(Picksfolio) 서비스 이용약관
        </h1>
        <p className="text-slate-500 text-sm font-bold mb-12">시행일: 2026년 4월 1일</p>

        {/* 제1장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 1장 총칙</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 1조 (목적)</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              본 약관은 픽스폴리오(이하 "회사")가 제공하는 멀티링크 관리 및 라이브 커머스 솔루션 "픽스폴리오(Picksfolio)"(이하 "서비스")와 관련하여 회사, 유료 멤버십 회원(셀러), 시청자(구매자) 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.
            </p>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 2조 (용어의 정의)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>
                <span className="text-slate-300 font-bold">픽스폴리오 서비스:</span> 회사가 제공하는 다음 각 호의 서비스를 총칭합니다.
                <ul className="mt-2 ml-4 space-y-2">
                  <li><span className="text-slate-300 font-bold">링크 관리 서비스:</span> 여러 개의 웹 주소 및 비즈니스 제안서를 하나의 프로필 링크로 통합 관리할 수 있는 무료 서비스</li>
                  <li><span className="text-slate-300 font-bold">라이브 커머스 서비스:</span> 셀러의 실시간 방송 송출, 시청자의 실시간 장바구니 담기·일괄 결제, 비즈니스 타임라인 등 멤버십 전용 기능이 포함된 유료 서비스</li>
                </ul>
              </li>
              <li><span className="text-slate-300 font-bold">회원:</span> 서비스에 가입하여 기본 링크 관리 기능을 이용하는 고객을 의미합니다.</li>
              <li><span className="text-slate-300 font-bold">멤버십 회원(셀러):</span> 라이브 커머스 방송 기능 등 멤버십 전용 기능을 이용하기 위해 유료 정기 구독을 체결한 회원을 의미합니다.</li>
              <li><span className="text-slate-300 font-bold">시청자(구매자):</span> 멤버십 회원(셀러)의 라이브 방송을 시청하고, 방송 중 소개되는 상품을 장바구니에 담아 결제하는 고객을 의미합니다.</li>
              <li><span className="text-slate-300 font-bold">정기 구독:</span> 멤버십 회원(셀러)이 라이브 커머스 기능을 이용하기 위해 월 단위로 구독료를 결제하고 해지 전까지 자동 갱신되는 이용 방식을 말합니다.</li>
              <li><span className="text-slate-300 font-bold">판매 대금:</span> 시청자(구매자)가 멤버십 회원(셀러)의 방송을 통해 상품을 구매하면서 결제대행사(PG)를 통해 결제한 금액을 의미합니다.</li>
            </ul>
          </div>
        </section>

        {/* 제2장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 2장 서비스 이용 및 요금 정책</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 3조 (서비스의 구분 및 이용)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">기본 서비스:</span> 링크 생성, 프로필 편집, 비즈니스 제안서 관리 등 기본적인 멀티링크 기능은 회원가입 후 무료로 이용할 수 있습니다.</li>
              <li><span className="text-slate-300 font-bold">유료 서비스(라이브 커머스):</span> 실시간 라이브 방송 송출, 장바구니 담기·일괄 결제 등 커머스 특화 기능과 비즈니스 타임라인 등 멤버십 전용 기능을 이용하고자 하는 회원은 회사가 정한 유료 멤버십 정기 구독을 체결해야 합니다.</li>
              <li><span className="text-slate-300 font-bold">시청자(구매자)의 이용:</span> 시청자는 별도의 유료 구독 없이 멤버십 회원(셀러)의 방송을 시청하고 상품을 구매할 수 있으며, 이때 발생하는 비용은 구매한 상품 대금에 한합니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 4조 (멤버십 구독료 및 결제)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">정기 구독료:</span> 픽스폴리오 멤버십은 두 가지 플랜으로 운영됩니다. 스탠다드 멤버십(포트폴리오 영상 커버 · 콘텐츠 구성)은 월 4,900원(VAT 포함), 커머스 멤버십(스탠다드 혜택 + 라이브 커머스 송출)은 월 13,900원(VAT 포함)이며, 회사의 정책 변경 시 사전 공지 후 조정될 수 있습니다. 비즈니스 수신함과 협업 타임라인은 모든 이용자에게 무료로 제공됩니다.</li>
              <li><span className="text-slate-300 font-bold">결제 및 자동 갱신:</span> 멤버십 회원(셀러)은 등록한 결제 수단(신용/체크카드, 카카오페이 등)을 통해 매월 자동으로 구독료를 지불하며, 해지 전까지 서비스 이용 기간은 자동 갱신됩니다.</li>
              <li><span className="text-slate-300 font-bold">상품 대금 결제(시청자):</span> 시청자는 방송 중 장바구니에 담은 상품을 회사가 제공하는 일괄 결제 시스템을 통해 결제하며, 결제는 등록된 결제대행사(PG)를 통해 처리됩니다.</li>
            </ul>
          </div>
        </section>

        {/* 제3장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 3장 라이브 커머스 운영 및 책임</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 5조 (장바구니 및 일괄 결제 시스템)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 시청자(구매자)가 방송 중 담은 상품을 방송 종료 후 한 번에 결제할 수 있는 일괄 결제 시스템을 제공합니다.</li>
              <li>결제 대금은 결제대행사(PG)를 통해 처리되며, 회사는 약정된 정산 주기에 따라 판매 대금을 멤버십 회원(셀러)의 등록된 정산 계좌로 입금합니다.</li>
              <li>멤버십 회원(셀러)이 라이브 방송을 송출하고 판매 대금을 정산받기 위해서는 사업자 정보 및 정산 계좌 등록을 완료해야 하며, 관련 법령상 필요한 경우 세무 신고를 위한 정보를 추가로 제공할 수 있습니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 6조 (통신판매중개자로서의 면책)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>픽스폴리오는 통신판매중개자로서 라이브 커머스 시스템과 결제·정산 수단만을 제공하며, 방송을 통해 판매되는 상품의 등록·품질·배송·교환·환불 등 거래 이행에 관한 모든 책임은 판매 주체인 멤버십 회원(셀러)에게 있습니다.</li>
              <li>시청자(구매자)와 멤버십 회원(셀러) 간에 발생한 거래 관련 분쟁에 대하여 회사는 고의 또는 중과실이 없는 한 개입하거나 책임을 지지 않으며, 이러한 사실을 서비스 내 적절한 방법으로 고지합니다.</li>
            </ul>
          </div>
        </section>

        {/* 제4장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 4장 계약 해지 및 환불 정책</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 7조 (멤버십 구독 해지 및 환불)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">정기 구독 해지:</span> 멤버십 회원(셀러)은 언제든지 서비스 내 구독 관리 기능을 통해 정기 구독 해지를 신청할 수 있습니다. 해지 시 다음 결제일부터 추가 결제가 이루어지지 않으며, 남은 구독 기간 동안은 라이브 커머스 기능을 정상적으로 이용할 수 있습니다.</li>
              <li>
                <span className="text-slate-300 font-bold">구독료 환불 규정:</span>
                <ul className="mt-2 ml-4 space-y-2">
                  <li>결제 후 7일 이내에 라이브 방송을 단 1회도 송출하지 않았고, 비즈니스 타임라인 등 유료 기능 또한 이용하지 않은 경우에 한하여 전액 환불이 가능합니다.</li>
                  <li>라이브 방송 송출 이력이 1회 이상 있거나 유료 기능을 이용한 내역이 있는 경우, 해당 월의 구독료는 환불되지 않습니다.</li>
                </ul>
              </li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 8조 (시청자 구매 상품의 환불·교환)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>시청자(구매자)가 라이브 방송을 통해 구매한 상품의 청약 철회, 교환, 반품, 환불 등은 전자상거래법 등 관련 법령 및 해당 멤버십 회원(셀러)이 고지한 판매 정책에 따라 처리됩니다.</li>
              <li>회사는 환불 요청이 접수되면 결제대행사(PG)와 연동하여 결제 취소·환불 처리를 지원하며, 정산 완료된 판매 대금에 대해서는 셀러와의 정산 조정을 통해 환불이 이루어집니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 9조 (구독 만료 후 서비스 유지)</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              정기 구독이 만료되거나 해지된 경우, 라이브 커머스 관련 유료 기능(방송 송출, 커머스 대시보드, 비즈니스 타임라인 등)은 즉시 정지되나, 기본 서비스인 링크 관리 기능은 회원 상태가 유지되는 한 지속적으로 이용할 수 있습니다.
            </p>
          </div>
        </section>

        {/* 제5장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 5장 회원 및 이용계약 관리</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 10조 (약관의 명시 및 개정)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 이 약관의 내용과 상호, 대표자 성명, 영업소 소재지, 전화번호, 이메일 주소, 사업자등록번호, 통신판매업 신고번호, 개인정보 보호책임자 등을 회원이 쉽게 확인할 수 있도록 서비스 초기화면 또는 연결화면에 게시합니다.</li>
              <li>회사는 「약관의 규제에 관한 법률」, 「전자상거래 등에서의 소비자보호에 관한 법률」, 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」, 「전자금융거래법」, 「전자서명법」, 「소비자기본법」 등 관련 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있습니다.</li>
              <li>약관이 개정되는 경우 회사는 적용일자 및 개정사유를 명시하여 현행 약관과 함께 적용일자 7일 전부터(회원에게 불리한 내용으로 변경하는 경우에는 30일 전부터) 서비스 초기화면에 공지하며, 회원에게 불리한 변경의 경우 등록된 이메일 또는 서비스 내 알림으로 별도 통지합니다.</li>
              <li>회사가 개정 약관을 공지 또는 통지하면서 회원에게 공지 기간(원칙적으로 7일, 불리한 변경은 30일) 내에 거부 의사를 표시하지 아니하면 동의한 것으로 본다는 뜻을 명확히 고지하였음에도 회원이 명시적으로 거부 의사를 표시하지 아니한 경우, 회원은 개정 약관 적용에 동의한 것으로 봅니다.</li>
              <li>회원은 개정된 약관에 동의하지 않을 경우 회원 탈퇴를 할 수 있으며, 변경된 약관의 공지 또는 통지에도 불구하고 이를 확인하지 않아 발생한 피해에 대해서는 회사가 책임을 지지 않습니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 11조 (이용계약의 체결)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>서비스 이용계약은 서비스를 이용하려는 자가 본 약관 및 개인정보처리방침에 동의하고 회사가 정한 양식에 따라 가입을 신청한 후, 회사가 이를 승낙함으로써 성립합니다.</li>
              <li>멤버십 회원(셀러)의 경우 라이브 커머스 이용에 필요한 사업자 정보, 정산 계좌 및 정산에 필요한 세무 정보를 회사가 요청하는 바에 따라 제공해야 하며, 회사는 해당 정보의 확인 절차를 거친 후 이용 승낙 여부를 결정합니다.</li>
              <li>회사는 다음 각 호에 해당하는 경우 이용 신청에 대한 승낙을 거부하거나 사후 이용계약을 해지할 수 있습니다.
                <ul className="mt-2 ml-4 space-y-2">
                  <li>타인의 정보를 도용하거나 허위 정보를 기재한 경우</li>
                  <li>과거 본 약관 위반 등의 사유로 회원 자격을 상실한 이력이 있는 경우</li>
                  <li>관련 법령 또는 공서양속에 위배되는 목적으로 서비스를 이용하려는 경우</li>
                  <li>기타 회사가 정한 이용 신청 요건을 충족하지 못한 경우</li>
                </ul>
              </li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 12조 (계정 및 접속정보의 관리)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회원의 계정(이메일, 비밀번호, 소셜 로그인 식별자 등 접속정보)에 대한 관리 책임은 회원에게 있으며, 회원은 어떠한 경우에도 자신의 접속정보를 타인에게 양도하거나 대여할 수 없습니다.</li>
              <li>회사의 귀책사유 없이 접속정보의 유출, 양도, 대여로 인해 발생한 손실이나 손해에 대해서는 해당 회원이 전적으로 책임을 부담합니다.</li>
              <li>회원은 접속정보의 도난 또는 제3자의 무단 사용 사실을 인지한 즉시 회사에 통보해야 하며, 회사는 이를 신속하게 처리하기 위해 최선의 노력을 다합니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 13조 (회원 정보의 변경 의무)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회원은 가입 시 허위의 정보를 제공하여서는 아니 되며, 기재한 사항이 변경되었을 경우 지체 없이 최신 정보로 수정하여야 합니다.</li>
              <li>회사의 회원에 대한 통지는 회원이 등록한 접속정보(이메일 등)에 도달함으로써 통지된 것으로 보며, 회원이 정보를 수정하지 않아 발생한 손해는 해당 회원이 전적으로 부담합니다.</li>
              <li>회사는 판매 대금 정산, 배송, 세금계산서 발행 등 거래 이행에 필요한 범위에서 회원의 정보를 제3자(결제대행사, 배송업체, 세무 대리인 등)에게 제공할 수 있으며, 이 경우 개인정보처리방침에 따릅니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 14조 (서비스의 일시 중단)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 정보통신설비의 보수·점검·교체·고장, 통신의 두절, 운영상 합리적 필요 등의 사유가 발생한 경우 서비스 제공을 일시적으로 중단할 수 있으며, 그 사실과 사유를 사전 또는 사후에 서비스 내 공지사항을 통해 알립니다.</li>
              <li>천재지변, 국가 비상사태, 해결이 곤란한 기술적 결함, 기간통신사업자의 서비스 중지 등 불가항력적 사유로 서비스를 제공할 수 없는 경우 회사는 서비스 제공을 제한하거나 중단할 수 있으며, 이로 인해 회원 또는 제3자가 입은 손해에 대해서는 고의 또는 중과실이 없는 한 책임을 지지 않습니다.</li>
            </ul>
          </div>
        </section>

        {/* 제6장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 6장 상품 거래의 이행</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 15조 (매매계약의 체결 및 대금 결제)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>상품의 매매계약은 시청자(구매자)가 멤버십 회원(셀러)이 제시한 상품의 판매 조건에 응하여 청약의 의사표시를 하고, 이에 대하여 셀러가 승낙의 의사표시를 함으로써 체결됩니다. 구매하려는 상품의 내용과 거래 조건을 확인하지 않고 구매함으로써 발생하는 손실과 손해는 시청자(구매자) 본인에게 귀속됩니다.</li>
              <li>회원이 결제 과정에서 입력한 정보 및 그로 인해 발생한 책임은 전적으로 해당 회원이 부담합니다.</li>
              <li>회사는 시청자(구매자)의 상품 매매계약 체결 내역을 서비스 내 주문·결제 내역 화면을 통해 확인할 수 있도록 제공합니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 16조 (배송)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>상품의 배송과 관련된 일체의 책임은 판매 주체인 멤버십 회원(셀러)에게 있으며, 회사는 통신판매중개자로서 배송에 관여하지 않습니다.</li>
              <li>배송 소요 기간은 대금 결제 확인일의 익일을 기산일로 하여 배송이 완료되기까지의 기간(공휴일 및 휴무일 제외)을 말합니다.</li>
              <li>셀러는 약속된 배송 일정보다 3일 이상 지연이 예상되는 경우 시청자(구매자)에게 사전에 고지하여야 하며, 이와 관련한 클레임에 대해 성실히 응대해야 합니다.</li>
              <li>천재지변 등 불가항력적 사유가 발생한 경우 해당 기간은 배송 소요 기간에서 제외됩니다.</li>
              <li>배송과 관련하여 셀러, 시청자(구매자), 배송업체, 금융기관 등 사이에 발생하는 분쟁은 당사자들 간의 해결을 원칙으로 하며, 회사는 고의 또는 중과실이 없는 한 책임을 지지 않습니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 17조 (취소·반품·교환)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>상품의 취소·반품·교환과 관련된 일체의 책임은 판매 주체인 멤버십 회원(셀러)에게 있으며, 구체적 처리 기준은 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관련 법령과 셀러가 고지한 판매 정책을 따릅니다.</li>
              <li>시청자(구매자)는 상품 수령 후 7일 이내에 관련 법령에 따라 반품 또는 교환을 신청할 수 있으며, 라이브 방송 종료 이후 상품을 수령하기 전이라도 상품 불량이나 하자 사유가 명확한 경우에는 주문 취소를 요청할 수 있습니다.</li>
              <li>취소·반품·교환에 소요되는 배송비는 귀책 사유가 있는 자가 부담함을 원칙으로 합니다(단순 변심은 구매자 부담, 상품 하자는 셀러 부담).</li>
              <li>환불은 취소·반품·교환 사유 및 배송비 부담 주체가 확인된 후 5영업일 이내에 결제 수단에 따라 처리됨을 원칙으로 하며, 정산이 완료된 판매 대금에 대해서는 셀러와의 정산 조정을 거쳐 환불이 이루어집니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 18조 (청약철회·반품·교환의 제한)</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-3">시청자(구매자)는 다음 각 호에 해당하는 경우 청약철회, 반품 또는 교환을 요청할 수 없습니다.</p>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed list-disc list-inside">
              <li>시청자(구매자)의 책임 있는 사유로 상품이 멸실·훼손된 경우</li>
              <li>시청자(구매자)의 사용 또는 일부 소비로 상품의 가치가 현저히 감소한 경우</li>
              <li>시간 경과에 의해 재판매가 곤란할 정도로 상품의 가치가 현저히 감소한 경우</li>
              <li>복제가 가능한 상품의 포장을 훼손한 경우</li>
              <li>주문에 따라 개별적으로 생산된 상품 등 청약철회를 인정하는 경우 셀러에게 회복할 수 없는 중대한 피해가 예상되어 사전에 해당 거래에 대해 별도로 고지하고 시청자(구매자)의 서면(전자문서 포함) 동의를 받은 경우</li>
              <li>기타 관련 법령이 청약철회 등을 제한하는 경우</li>
            </ul>
          </div>
        </section>

        {/* 제7장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 7장 회원의 의무 및 금지행위</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 19조 (금지행위)</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-3">회원은 서비스 이용과 관련하여 다음 각 호의 행위를 하여서는 아니 됩니다.</p>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed list-disc list-inside">
              <li>서비스를 우회하여 시청자(구매자)와 셀러 간에 직거래를 유도하거나 결제 시스템 외부에서 대금을 수수하는 행위</li>
              <li>타인의 결제 수단을 도용하거나 허위 주문·자전거래 등 결제 부정행위</li>
              <li>서비스 시스템, API, 방송 송출 인프라에 대한 비정상적 접근·해킹·역공학·자동화 도구를 이용한 부정 이용 행위</li>
              <li>타인의 지식재산권, 초상권, 명예, 개인정보 등을 침해하거나 음란·폭력·차별·혐오 등 공서양속에 반하는 콘텐츠를 등록하거나 방송하는 행위</li>
              <li>허위·과장 광고, 원산지·성능·효능의 오인을 유발하는 표시, 관련 법령이 금지하는 상품의 판매 등 「전자상거래 등에서의 소비자보호에 관한 법률」, 「표시·광고의 공정화에 관한 법률」, 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」 등을 위반하는 행위</li>
              <li>기타 서비스의 원활한 운영을 방해하거나 방해할 우려가 있는 행위</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 20조 (회원 관리 및 제재)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 회원이 본 약관 또는 관련 법령을 위반하거나 일반 상거래 원칙에 반하는 행위를 하는 경우 경고, 특정 기능의 이용 제한, 라이브 방송 송출 중단, 판매 대금 정산의 보류, 회원 자격의 일시 정지 또는 이용계약의 해지 등 필요한 조치를 취할 수 있습니다.</li>
              <li>회사는 전항의 조치를 취하기 전에 사전에 회원에게 통보함을 원칙으로 하나, 회원과 연락이 두절되거나 긴급을 요하는 부득이한 경우에는 먼저 조치를 취한 후 사후에 통보할 수 있습니다.</li>
              <li>회원은 본 조에 따른 조치에 대해 이의가 있을 경우 회사에 항변할 수 있으며, 회사는 회원의 항변이 정당하다고 인정되는 경우 해당 조치를 철회하거나 조정할 수 있습니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 21조 (금지행위 확인을 위한 조사)</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              회사는 회원의 금지행위가 의심되는 경우 일시적으로 서비스 이용을 정지하고 사실 확인 및 소명을 위해 정지일로부터 15일 이내에 필요 최소한의 증빙자료(거래사실증명서, 상품 수급 및 발주 내역, 배송 증빙서류 등)를 회원에게 요청할 수 있습니다. 회원이 정당한 사유 없이 정해진 기한 내에 자료를 제출하지 않거나 제출한 자료가 미비하여 소명이 되지 않는 경우, 회사는 이용 제한 또는 이용계약 해지 등의 조치를 취할 수 있습니다.
            </p>
          </div>
        </section>

        {/* 제8장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 8장 게시물·콘텐츠 및 지식재산권</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 22조 (게시물 및 방송 콘텐츠의 권리)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회원이 서비스에 등록한 게시물(텍스트, 이미지, 댓글 등, 영상 제외)의 저작권은 해당 게시물을 작성한 회원 본인에게 귀속되며, 게시물이 타인의 권리를 침해하는 경우 그에 대한 책임은 작성한 회원이 부담합니다.</li>
              <li>멤버십 회원(셀러)이 송출한 라이브 방송 및 이를 녹화한 다시보기 영상의 저작권, 영상에 등장하는 자의 초상권은 원칙적으로 셀러에게 귀속되며, 셀러는 회사에 대해 서비스의 운영·홍보·개선, 관련 서비스 연동, 기술적 전송에 필요한 범위에서 해당 영상을 사용, 복제, 전시, 전송, 편집, 2차적 저작물 작성할 수 있는 비독점적이고 무상의 라이선스를 부여합니다.</li>
              <li>셀러는 회사의 사전 동의 없이 회사에 부여한 위 권리를 제한하는 방식으로 저작권을 제3자에게 양도하거나 처분할 수 없습니다.</li>
              <li>회원이 서비스 외부에서 방송 영상이나 홍보 자료 등을 사용하는 경우 픽스폴리오의 서비스 명칭, 로고 또는 출처 URL을 명시하여 해당 콘텐츠가 픽스폴리오를 통해 제작·유통된 것임을 밝혀야 합니다.</li>
              <li>회사가 자체적으로 제작한 서비스 UI, 디자인, 로고, 코드, 문구 등에 대한 저작권 및 기타 지식재산권은 회사에 귀속되며, 회원은 회사의 사전 서면 동의 없이 이를 복제, 전송, 출판, 배포, 방송, 기타 방법으로 이용하거나 제3자에게 이용하게 할 수 없습니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 23조 (게시물의 관리)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 회원이 등록한 게시물이 관련 법령, 본 약관, 또는 서비스 운영 정책에 위반된다고 판단되는 경우 사전 통보 없이 해당 게시물을 삭제·비공개 처리하거나 해당 회원에 대해 특정 기능의 이용 제한 등의 조치를 취할 수 있습니다.</li>
              <li>회사가 게시물을 삭제하거나 관련 조치를 취한 경우 해당 게시자는 회사에 이의를 제기할 수 있으며, 회사는 이의가 정당하다고 판단되는 경우 신속히 이를 시정합니다.</li>
              <li>단순히 구매한 상품에 대한 불만 등 셀러에게 불리한 내용이 포함되었다는 사유만으로 회사가 게시물을 임의로 삭제하지 아니합니다.</li>
            </ul>
          </div>
        </section>

        {/* 제9장 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-purple-400 mb-6">제 9장 고객지원, 면책 및 준거법</h2>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 24조 (고객센터 운영 및 분쟁 조정)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 셀러의 법령 위반 행위 또는 타인의 권리 침해 행위에 대한 신고, 회원 상호 간 또는 회원과 제3자 간의 불만 및 분쟁의 조정을 위하여 고객센터를 운영합니다. 회원은 서비스 내 고객센터를 통해 관련 사항을 접수할 수 있으며, 필요한 경우 한국소비자원 소비자분쟁조정위원회, 전자거래분쟁조정위원회 등에 대한 피해구제 신청의 대행을 요청할 수 있습니다.</li>
              <li>회사는 고객센터를 통해 접수된 신고·불만·이의 제기가 정당하다고 판단되는 경우 이를 신속하게 처리합니다.</li>
              <li>소비자분쟁조정위원회, 전자거래분쟁조정위원회, 공정거래위원회, 지방자치단체 등 관련 기관이 요청하는 경우 회사는 분쟁 해결에 필요한 범위에서 셀러의 상호, 대표자 성명, 주소, 전화번호, 이메일 주소 등을 제공하여 협조할 수 있습니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 25조 (회원에 대한 통지)</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              이 약관에 따라 회사가 회원에게 통지하는 경우 서비스 내 공지사항 게시, 회원이 등록한 이메일, 앱 푸시 알림, 서비스 내 메시지 등의 방법을 사용할 수 있으며, 통지가 회원의 등록된 접속정보에 도달한 시점에 통지 효력이 발생한 것으로 봅니다.
            </p>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 26조 (회사의 면책)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 통신판매중개자로서 라이브 커머스 및 멀티링크 서비스의 거래 시스템만을 제공할 뿐이며, 시청자(구매자)와 멤버십 회원(셀러) 간 거래의 당사자가 아닙니다. 거래 내용에 관한 모든 분쟁 및 책임은 거래 당사자가 부담하며, 회사는 고의 또는 중과실이 없는 한 책임을 지지 않습니다.</li>
              <li>서비스 화면에 게시되는 상품 정보, 광고, 영상, 기타 게시물은 원칙적으로 셀러 또는 작성자 본인에 의해 등록된 것으로, 그 정확성·적시성·적법성·타당성에 대하여 회사는 보증하지 아니합니다.</li>
              <li>회사는 제14조에 따라 서비스를 일시 중단 또는 제한하는 경우 회원 또는 제3자가 입은 손해에 대해 고의 또는 중과실이 없는 한 책임을 지지 않으며, 천재지변 등 불가항력으로 인한 손해에 대해서는 책임을 면합니다.</li>
              <li>회원의 귀책사유로 인한 서비스 이용 장애, 회원이 자신의 접속정보 또는 개인정보를 타인에게 유출·제공함으로써 발생한 피해에 대해 회사는 책임을 지지 않습니다.</li>
              <li>서비스 화면에서 링크, 배너 등을 통해 연결된 외부 사이트 또는 제휴업체(이하 "피연결업체")와 회원 간에 이루어진 거래에 대해 회사는 개입하지 아니하며 책임을 지지 않습니다.</li>
              <li>라이브 방송 및 관련 서비스는 회원의 네트워크 환경, 이동통신사업자의 상태 등에 따라 지연되거나 제한될 수 있으며, 회사는 이로 인해 발생하는 불이익에 대해 고의 또는 중과실이 없는 한 책임을 지지 않습니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 27조 (준거법 및 관할법원)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>이 약관의 해석 및 회사와 회원 간의 분쟁에 대해서는 대한민국 법령을 준거법으로 합니다.</li>
              <li>이 약관에 명시되지 아니한 사항은 「전자상거래 등에서의 소비자보호에 관한 법률」, 「약관의 규제에 관한 법률」, 「정보통신망 이용촉진 및 정보보호 등에 관한 법률」, 공정거래위원회가 정하는 「전자상거래 등에서의 소비자보호지침」 및 기타 관계 법령 또는 상관례에 따릅니다.</li>
              <li>회사와 회원 간에 발생한 분쟁에 관한 소송은 제소 당시 회원의 주소에 의하고, 주소가 없는 경우에는 거소를 관할하는 지방법원의 전속관할로 합니다. 다만, 제소 당시 회원의 주소 또는 거소가 분명하지 않거나 외국 거주자의 경우에는 「민사소송법」상의 관할법원에 제기합니다.</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">제 28조 (기타조항)</h3>
            <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
              <li>회사는 필요에 따라 특정 서비스(혹은 그 일부)를 사전 공지 후 일시적 또는 영구적으로 수정하거나 중단할 수 있습니다.</li>
              <li>회사와 회원은 상대방의 명백한 동의 없이 이 약관상의 권리·의무를 제3자에게 양도할 수 없습니다.</li>
              <li>이 약관과 관련하여 당사자 간의 합의에 의해 추가로 작성된 계약서·협정서·통보서, 회사의 정책 변경, 관련 법령의 제·개정 또는 공공기관의 고시·지침 등에 따라 회사가 서비스를 통해 회원에게 공지하는 내용도 이 약관의 일부를 구성합니다.</li>
              <li>이 약관의 일부 조항이 관련 법령에 의해 무효 또는 집행 불가능한 것으로 판단되더라도 나머지 조항의 효력에는 영향을 미치지 않습니다.</li>
            </ul>
          </div>
        </section>

        <div className="border-t border-white/10 pt-8 mt-16">
          <p className="text-slate-600 text-xs font-bold">&copy; {new Date().getFullYear()} Picksfolio. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService;
