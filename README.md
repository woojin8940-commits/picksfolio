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
