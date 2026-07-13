# PICKSFOLIO - Daily Curation Platform

일상을 큐레이션하는 하이엔드 링크인바이오(Link-in-bio) 플랫폼입니다.

## 주요 기능
- **AI 트렌드 스카우트**: 무신사, 올리브영 등 주요 플랫폼의 실시간 트렌드 분석
- **그리드 템플릿**: 감각적인 디자인의 포트폴리오 및 링크 관리
- **커스텀 도메인**: 개인 도메인 연결 지원

## 기술 스택
- **Frontend**: React 19, Vite, Tailwind CSS
- **Backend**: Supabase (Auth, Database)
- **Deployment**: Vite Build System

## 시작하기

1. 저장소 클론:
   ```bash
   git clone <your-repository-url>
   ```

2. 패키지 설치:
   ```bash
   npm install
   ```

3. 환경 변수 설정:
   `.env.example` 파일을 참고하여 `.env` 파일을 생성하고 필요한 API 키를 입력하세요.

4. 로컬 실행:
   ```bash
   npm run dev
   ```

## 배포
이 프로젝트는 Vite를 사용하여 빌드됩니다.
```bash
npm run build
```
빌드된 결과물은 `dist` 폴더에 생성됩니다.
# 결제 운영 설정

나이스정보통신 카드 결제는 PortOne V2의 **실 연동** 채널만 사용합니다. Netlify의 production
환경에 `VITE_PORTONE_NICE_CHANNEL_KEY`를 PortOne 콘솔에서 발급한 운영 채널 키로 설정해야
카드 결제가 활성화됩니다. 서버 결제 검증에는 `PORTONE_V2_API_SECRET`이 필요합니다.
MID별 설정을 사용하는 현재 환경에서는 `VITE_PORTONE_NICE_CHANNEL_KEY_IM0029308m`을 기본
나이스정보통신 카드 채널로 인식합니다.
이 키에는 포트원 채널 관리에서 **나이스정보통신 / 신모듈 결제창 일반결제**로 등록한 운영
채널을 연결해야 합니다. 나이스정보통신은 일반결제와 API 수기·정기결제 MID가 다르므로,
정기결제용 MID 채널 키를 카드 일반결제 키로 사용하면 결제창 호출이 실패합니다.
운영 결제 완료 API는 PortOne 조회 결과의 채널 유형이 `LIVE`인 경우만 승인하며, 카드 결제는
나이스정보통신 채널인지 추가로 확인합니다. 테스트 채널 결제는 적립·주문·멤버십 활성화에
사용되지 않습니다.

테스트 채널 키는 소스 기본값으로 제공하지 않습니다. 운영 채널 키가 없거나 형식이 잘못되면
카드 결제 요청을 시작하지 않고 설정 오류를 표시합니다.
