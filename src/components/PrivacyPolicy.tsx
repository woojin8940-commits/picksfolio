import React from 'react';

interface PrivacyPolicyProps {
  onNavigateHome: () => void;
}

/**
 * 개인정보처리방침.
 *
 * 종전 방침은 라이브 커머스를 전제로 쓰여 있었다 — 시청자(구매자)의 이름·휴대폰·
 * 배송지를 받아 셀러에게 넘기고, 장바구니와 주문·결제 기록을 보관하고, 방송 송출
 * 인프라를 위탁한다는 내용이었다. 그 기능이 없어졌으므로 그 항목들을 지웠다.
 * 없는 처리를 적어 두는 것은 단순한 오래된 문서 문제가 아니라, 받지도 않는 정보를
 * 받는다고 알리는 것이어서 그대로 두면 안 된다.
 *
 * 대신 지금 실제로 일어나는 흐름을 적었다: 개인 페이지 운영, 브랜드 협업 중개(제품
 * 발송을 위해 배송지를 브랜드에 제공), 협업 대가 정산(신분증 사본과 입금 계좌를
 * 받아 3.3% 원천징수), 인스타그램 연동(디엠 자동화·릴스 인사이트), 협업 타임라인
 * AI 어시스턴트(대화 내용이 모델 제공사로 전달 — 국외 이전).
 *
 * 이 문서는 `public/privacy.html` 과 같은 내용을 담는다(연락처는 각 파일에 적혀
 * 있는 값을 그대로 둔다). netlify.toml 이 /privacy 를 정적 파일로 보내므로 한쪽만
 * 고치면 같은 주소에서 서로 다른 방침이 보인다.
 */
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
        <p className="text-slate-500 text-sm font-bold mb-12">시행일: 2026년 9월 15일 (개정)</p>

        {/* 1. 개인정보처리방침이란? */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">1. 개인정보처리방침이란?</h2>
          <div className="space-y-4 text-slate-400 text-sm leading-relaxed">
            <p>
              픽스폴리오(이하 "회사")는 회원의 개인정보보호를 매우 중요시하며, 이용자가 회사의 서비스(이하 "서비스")를 이용함과 동시에 온라인상에서 회사에 제공한 개인정보가 보호 받을 수 있도록 최선을 다하고 있습니다. 이에 회사는 개인정보보호법 등 관련 법규를 준수하고 있습니다.
            </p>
            <p>
              회사는 아래와 같이 개인정보처리방침을 명시하여 회원이 제공한 개인정보가 어떠한 용도와 방식으로 이용되고 있는지 알려드립니다. 본 방침은 정부의 지침이나 회사의 내부 정책에 따라 변경될 수 있으며, 개정 시 즉시 서비스 화면에 게시합니다.
            </p>
            <p>
              회사가 제공하는 서비스는 크리에이터의 개인 페이지(멀티링크) 운영과 브랜드·크리에이터 간 협업의 중개 및 정산입니다. 본 방침에서 "크리에이터 회원"은 개인 페이지를 운영하고 협업에 참여하는 회원을, "브랜드 회원"은 협업 제안이나 캠페인을 등록하는 사업자 회원을 의미합니다.
            </p>
          </div>
        </section>

        {/* 2. 개인정보의 수집 및 이용목적 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">2. 개인정보의 수집 및 이용목적</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            회사는 더욱 향상된 사용자 경험과 원활한 협업 환경을 제공하기 위해 최소한의 개인정보를 수집하며, 다음의 목적 이외의 용도로는 이용하지 않습니다.
          </p>
          <ul className="space-y-4 text-slate-400 text-sm leading-relaxed">
            <li><span className="text-slate-300 font-bold">회원관리 및 이용자 식별:</span> 회원 가입의사 확인, 카카오 로그인 또는 아이디·비밀번호를 통한 본인 식별, 멤버십 구독 서비스 제공 및 유지관리</li>
            <li><span className="text-slate-300 font-bold">개인 페이지(멀티링크) 운영:</span> 프로필과 링크·콘텐츠·오픈 일정의 공개, 개인 페이지로 접수된 비즈니스 제안의 전달, 페이지 조회·클릭 통계의 제공</li>
            <li><span className="text-slate-300 font-bold">브랜드 협업의 중개 및 진행:</span> 협업 제안과 캠페인의 연결, 지원자 심사 및 선정, 협업 단계(가이드 전달, 제품 발송, 초안 확인, 업로드, 성과 공유)의 진행과 알림 발송</li>
            <li><span className="text-slate-300 font-bold">협업 대가의 정산:</span> 지급 대상 확인, 입금 처리, 「소득세법」에 따른 원천징수 신고·납부 및 관련 증빙의 보관</li>
            <li><span className="text-slate-300 font-bold">유료 서비스의 결제:</span> 멤버십 구독료 및 클로드 플랜 크레딧의 결제·자동결제·환불 처리, 결제 내역의 제공</li>
            <li><span className="text-slate-300 font-bold">외부 플랫폼 연동 기능의 제공:</span> 회원이 연동한 인스타그램 프로페셔널 계정의 디엠 자동 응답 발송, 릴스 등 콘텐츠 지표의 조회 및 코칭 제공</li>
            <li><span className="text-slate-300 font-bold">AI 어시스턴트의 제공:</span> 협업 타임라인의 대화 요약, 일정 정리, 답장 초안 작성 등 회원이 요청한 처리의 수행</li>
            <li><span className="text-slate-300 font-bold">고객지원:</span> 민원 사항 확인 및 사실 조사를 위한 연락, 협업 분쟁의 조정 지원, 처리 결과 통보</li>
            <li><span className="text-slate-300 font-bold">마케팅 및 품질 개선:</span> 신규 기능 개발, 서비스 이용 패턴 분석, 광고성 정보(이벤트 등) 제공(마케팅 수신은 별도 동의를 받아 처리)</li>
          </ul>
        </section>

        {/* 3. 수집하는 개인정보 항목과 수집방법 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">3. 수집하는 개인정보 항목과 수집방법</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            회사는 서비스 제공을 위해 아래와 같은 개인정보를 수집합니다.
          </p>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">회원가입 및 로그인 시</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">필수 (카카오 로그인):</span> 카카오 계정 고유 식별값, 이름(닉네임), 휴대폰 번호(알림톡 발송용), 프로필 사진</li>
              <li><span className="text-slate-300 font-bold">필수 (아이디·비밀번호 가입):</span> 이메일 주소, 비밀번호(단방향 암호화하여 저장), 이름(닉네임), 휴대폰 번호</li>
              <li><span className="text-slate-300 font-bold">브랜드 회원 추가 항목:</span> 회사명(브랜드명), 담당자 이름, 담당자 연락처 및 이메일 주소</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">개인 페이지 운영 시</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">회원이 직접 입력·게시하는 정보:</span> 사용자 이름(페이지 주소), 소개글, 프로필 이미지, 외부 채널 주소(카카오톡 채널·유튜브·틱톡·네이버 등), 회원이 추가한 링크, 업로드한 이미지·영상 콘텐츠, 오픈(공동구매 등) 일정</li>
              <li><span className="text-slate-300 font-bold">유의사항:</span> 개인 페이지에 게시된 정보는 공개 상태로 누구나 열람할 수 있습니다. 회원은 공개를 원하지 않는 정보를 게시하지 않아야 합니다.</li>
              <li><span className="text-slate-300 font-bold">비즈니스 제안 접수 시:</span> 제안자의 이름·회사명, 연락처, 이메일 주소, 제안 내용(제안자가 직접 입력하는 정보이며, 해당 개인 페이지의 회원에게 전달할 목적으로만 처리)</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">브랜드 협업 진행 시</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">수집 항목:</span> 협업 참여 이력, 채널 정보 및 지원 시 기재한 소개 내용, 협업 타임라인의 대화 내용과 첨부 파일, 제작한 콘텐츠의 주소 및 게재 성과 지표</li>
              <li><span className="text-slate-300 font-bold">제품 발송이 있는 협업:</span> 수령인 이름, 휴대폰 번호, 배송지 주소(회원이 협업의 배송 정보 입력 단계에서 직접 입력)</li>
              <li><span className="text-slate-300 font-bold">수집 시점:</span> 해당 협업의 진행에 필요한 단계에 이르렀을 때에 한하여 최소한의 정보만 수집합니다.</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">협업 대가 정산 시</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">필수:</span> 이름, 연락처, 예금주명, 은행명, 계좌번호</li>
              <li><span className="text-slate-300 font-bold">지급 대상 확인용:</span> 신분증(주민등록증·운전면허증) 사본 이미지 또는 PDF</li>
              <li><span className="text-slate-300 font-bold">세무 신고용:</span> 주민등록번호(「소득세법」상 원천징수 및 지급명세서 제출 의무의 이행을 위해 법령에 근거하여 처리)</li>
              <li><span className="text-slate-300 font-bold">처리 원칙:</span> 본 항목은 대가의 지급과 세무 신고 목적으로만 이용되며, 브랜드 회원에게는 제공되지 않습니다. 회사 내부에서도 정산 업무를 담당하는 인원에게만 접근을 허용합니다.</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">멤버십 구독 및 크레딧 결제 시</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">필수:</span> 이름, 이메일 주소, 연락처, 결제 및 환불 내역</li>
              <li><span className="text-slate-300 font-bold">결제 정보:</span> 구독료·크레딧 결제를 위한 카드/간편결제 식별값(결제대행사 보관, 회사는 카드번호 등 결제 수단 정보를 직접 보관하지 않음)</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">인스타그램 계정 연동 시 (선택 기능)</h3>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">수집 항목:</span> 인스타그램 계정 식별값 및 사용자 이름, 접근 토큰, 게시물·릴스의 성과 지표, 디엠 자동화 설정에 필요한 범위의 메시지 및 발신자 식별값</li>
              <li><span className="text-slate-300 font-bold">수집 근거:</span> 회원이 연동에 명시적으로 동의하고 해당 플랫폼의 인증을 완료한 경우에만 수집하며, 회원이 연동을 해제하면 접근 토큰을 지체 없이 파기합니다.</li>
            </ul>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-3">AI 어시스턴트 이용 시</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              회원이 협업 타임라인에서 요약·일정 정리·답장 초안 등을 요청하는 경우, 해당 협업의 대화 내용과 회원이 입력한 지시문이 처리를 위해 AI 모델 제공사로 전송됩니다. 자세한 사항은 아래 '개인정보의 국외 이전'에서 안내합니다.
            </p>
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
          <h2 className="text-xl font-black text-blue-400 mb-6">4. 개인정보의 제3자 제공 및 취급위탁</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            회사는 회원의 동의 없이 개인정보를 외부에 제공하지 않으나, 협업의 이행 및 서비스 운영을 위해 아래와 같이 제공 및 위탁하고 있습니다.
          </p>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">개인정보의 제3자 제공</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-3">
              브랜드 회원이 제품 또는 서비스를 제공하는 협업의 경우, 제품 발송을 위해 다음과 같이 해당 브랜드 회원에게 크리에이터 회원의 개인정보를 제공합니다.
            </p>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">제공받는 자:</span> 해당 협업의 브랜드 회원(제품 발송 주체)</li>
              <li><span className="text-slate-300 font-bold">제공 목적:</span> 협업 제품의 발송, 수령 확인 및 관련 문의 응대</li>
              <li><span className="text-slate-300 font-bold">제공 항목:</span> 수령인 이름, 휴대폰 번호, 배송지 주소</li>
              <li><span className="text-slate-300 font-bold">보유 기간:</span> 해당 협업의 종료 및 관련 법령에 따른 보존 기간 종료 시까지</li>
              <li><span className="text-slate-300 font-bold">제공하지 않는 항목:</span> 정산을 위해 수집한 신분증 사본, 주민등록번호, 계좌 정보는 브랜드 회원에게 제공되지 않습니다.</li>
            </ul>
            <p className="text-slate-400 text-sm leading-relaxed mt-3">
              이 밖에 법령에 근거가 있거나 수사기관이 적법한 절차에 따라 요청하는 경우, 분쟁 조정 기관이 조정을 위해 요청하는 경우에는 필요한 범위에서 개인정보를 제공할 수 있습니다.
            </p>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">개인정보의 취급위탁</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-4">
              회사는 원활한 서비스 제공을 위해 아래 업체에 업무를 위탁합니다.
            </p>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">솔라피(Solapi):</span> 카카오 알림톡 및 SMS 발송 대행</li>
              <li><span className="text-slate-300 font-bold">포트원(PortOne):</span> 신용카드·카카오페이 등 결제 대행(나이스정보통신 PG), 멤버십 정기 구독 빌링 및 크레딧 결제 처리</li>
              <li><span className="text-slate-300 font-bold">수파베이스(Supabase):</span> 회원 계정 인증, 서비스 데이터 및 업로드 파일 보관</li>
              <li><span className="text-slate-300 font-bold">넷라이파이(Netlify):</span> 서비스 호스팅 및 서버 기능 운영</li>
              <li><span className="text-slate-300 font-bold">아마존웹서비스(AWS):</span> 클라우드 서버 및 파일 저장 인프라 운영</li>
              <li><span className="text-slate-300 font-bold">앤스로픽(Anthropic):</span> AI 어시스턴트(Claude) 처리</li>
            </ul>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-white mb-3">개인정보의 국외 이전</h3>
            <p className="text-slate-400 text-sm leading-relaxed mb-4">
              회사는 아래와 같이 개인정보를 국외로 이전하여 처리합니다. 회원은 국외 이전을 거부할 수 있으며, 이 경우 해당 기능의 이용이 제한될 수 있습니다.
            </p>
            <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
              <li><span className="text-slate-300 font-bold">앤스로픽(Anthropic PBC, 미국):</span> AI 어시스턴트 처리를 위해 회원이 요청한 협업의 대화 내용 및 입력 지시문을 전송하며, 처리 완료 시까지 보관합니다. 전송은 회원이 해당 기능을 실행하는 시점에 네트워크를 통해 이루어집니다.</li>
              <li><span className="text-slate-300 font-bold">메타(Meta Platforms, Inc., 미국·아일랜드):</span> 회원이 인스타그램 연동 기능을 이용하는 경우, 디엠 발송 및 콘텐츠 지표 조회를 위해 해당 계정의 식별값과 메시지 내용이 인스타그램 플랫폼과 주고받아집니다.</li>
              <li><span className="text-slate-300 font-bold">수파베이스(Supabase Inc.), 넷라이파이(Netlify, Inc.), 아마존웹서비스(Amazon Web Services, Inc.):</span> 서비스 운영에 필요한 계정 및 서비스 데이터를 보관·전송하며, 회원의 개인정보 보유 기간 동안 보관합니다.</li>
            </ul>
          </div>
        </section>

        {/* 5. 개인정보의 처리 및 보유기간 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">5. 개인정보의 처리 및 보유기간</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            회사는 수집 시 동의 받은 보유 기간 또는 법령에 따른 기간 내에서 개인정보를 처리합니다.
          </p>
          <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
            <li><span className="text-slate-300 font-bold">회원 탈퇴 시:</span> 탈퇴 요청 5일 후 지체 없이 파기 (단, 재가입 방지를 위한 아이디 정보는 30일간 보관)</li>
            <li><span className="text-slate-300 font-bold">협업 배송 정보:</span> 해당 협업의 제품 발송이 완료되고 협업이 종료된 후 지체 없이 파기</li>
            <li><span className="text-slate-300 font-bold">정산 서류(신분증 사본):</span> 지급 및 원천징수 신고가 완료된 후 지체 없이 파기</li>
            <li><span className="text-slate-300 font-bold">원천징수 및 지급 관련 기록:</span> 5년 (「국세기본법」 등 세법)</li>
            <li><span className="text-slate-300 font-bold">전자상거래 결제 기록:</span> 5년 (전자상거래법)</li>
            <li><span className="text-slate-300 font-bold">소비자 불만 또는 분쟁 처리 기록:</span> 3년 (전자상거래법)</li>
            <li><span className="text-slate-300 font-bold">접속 로그 및 IP:</span> 3개월 (통신비밀보호법)</li>
          </ul>
        </section>

        {/* 6. 이용자의 권리와 행사 방법 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">6. 이용자의 권리와 행사 방법</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            이용자는 언제든지 자신의 개인정보를 열람, 정정하거나 삭제 요청(회원 탈퇴)을 할 수 있으며, 처리의 정지를 요구할 수 있습니다.
          </p>
          <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
            <li>사이트 내 '프로필 수정' 또는 '회원 탈퇴' 기능을 통해 직접 처리 가능합니다.</li>
            <li>개인 페이지의 공개 여부와 게시 항목은 회원이 직접 수정하거나 삭제할 수 있습니다.</li>
            <li>인스타그램 연동은 서비스 내 연동 관리 화면에서 언제든지 해제할 수 있으며, 해제 시 접근 토큰이 파기되어 해당 기능의 데이터 처리가 중단됩니다.</li>
            <li>마케팅 정보 수신 동의는 언제든지 철회할 수 있고, 철회하더라도 서비스 이용에 필요한 알림(협업 진행, 결제, 정산 등)은 계속 발송됩니다.</li>
            <li>고객센터를 통해 서면, 이메일로 요청 시 지체 없이 조치하겠습니다.</li>
          </ul>
        </section>

        {/* 7. 쿠키 안내 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">7. 개인정보 자동 수집 장치(쿠키) 안내</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            회사는 로그인 상태의 유지와 개인화된 맞춤 서비스를 제공하기 위해 쿠키 및 브라우저 저장소를 사용합니다. 이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 로그인 유지 및 회원 전용 기능(협업 타임라인, 정산, 멤버십 등) 이용에 어려움이 있을 수 있습니다.
          </p>
        </section>

        {/* 8. 개인정보 보호책임자 안내 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">8. 개인정보 보호책임자 안내</h2>
          <p className="text-slate-400 text-sm leading-relaxed mb-4">
            회사는 이용자의 개인정보를 보호하고 관련 불만을 처리하기 위해 책임자를 지정하고 있습니다.
          </p>
          <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
            <li><span className="text-slate-300 font-bold">책임자:</span> 신우진</li>
            <li><span className="text-slate-300 font-bold">연락처:</span> 010-3563-8940</li>
            <li><span className="text-slate-300 font-bold">이메일:</span> woojin8940@inplace-ad.com</li>
          </ul>
          <p className="text-slate-400 text-sm leading-relaxed mt-4">
            개인정보 침해로 인한 상담이 필요한 경우 개인정보분쟁조정위원회(1833-6972), 한국인터넷진흥원 개인정보침해신고센터(118), 대검찰청 사이버수사과(1301), 경찰청 사이버수사국(182)에 문의하실 수 있습니다.
          </p>
        </section>

        {/* 부칙 */}
        <section className="mb-12">
          <h2 className="text-xl font-black text-blue-400 mb-6">부칙</h2>
          <ul className="space-y-2 text-slate-400 text-sm leading-relaxed">
            <li>① 본 개인정보처리방침은 2026년 9월 15일부터 적용되며, 2026년 4월 1일자 방침을 대체합니다.</li>
            <li>② 라이브 커머스 서비스의 종료에 따라 시청자(구매자)의 이름·휴대폰 번호·배송지 주소·장바구니 및 주문·결제 기록의 수집, 해당 정보를 판매자에게 제공하는 제3자 제공, 라이브 방송 송출 인프라의 위탁에 관한 사항은 삭제되었습니다.</li>
            <li>③ 브랜드 협업의 진행 및 정산, 인스타그램 계정 연동, AI 어시스턴트 이용에 관한 수집·이용·제공·국외 이전 사항이 추가되었습니다.</li>
          </ul>
        </section>

        <div className="border-t border-white/10 pt-8 mt-16">
          <p className="text-slate-600 text-xs font-bold">&copy; {new Date().getFullYear()} Picksfolio. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
