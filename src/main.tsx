
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { LanguageProvider } from './contexts/LanguageContext';
import { completeKakaoSdkLogin, isKakaoSdkCallback } from './utils/kakaoLogin';
import { purgeRemovedLoginSaveKeys } from './utils/loginPersistence';

// 없어진 "로그인 저장" 옵션들이 브라우저에 남겨 둔 값을 지운다. 기능이 없는데 값이
// 남아 있으면 안 된다.
purgeRemovedLoginSaveKeys();

// Mobile debug console — activated by `?debug=1` query param so field users
// (especially in-app WebViews like KakaoTalk, where external devtools cannot
// attach) can surface console logs and WebRTC/HLS errors on-screen. Off by
// default so it never ships to normal viewers.
try {
  const params = new URLSearchParams(window.location.search);
  if (params.has('debug')) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/eruda';
    s.onload = () => {
      const w = window as unknown as { eruda?: { init: () => void } };
      w.eruda?.init();
    };
    document.head.appendChild(s);
  }
} catch {
  // Never block app mount on debug setup.
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const RootFallback = (
  <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-[#f8fafc] text-center">
    <div className="text-5xl mb-4">⚠️</div>
    <h2 className="text-xl font-black text-slate-900 mb-2">앱을 표시할 수 없습니다.</h2>
    <p className="text-slate-500 text-sm mb-6">잠시 후 다시 시도해주세요. 문제가 계속되면 새로고침을 눌러주세요.</p>
    <button
      onClick={() => window.location.reload()}
      className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-blue-700 transition-all"
    >
      새로고침
    </button>
  </div>
);

const root = ReactDOM.createRoot(rootElement);
const renderApp = () =>
  root.render(
    <React.StrictMode>
      <ErrorBoundary fallback={RootFallback}>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );

// 카카오 간편로그인(카카오톡 앱 연동) 콜백은 앱을 그리기 전에 끝낸다. 인가 코드를
// 세션으로 바꾸고 주소를 원래 가려던 경로로 되돌린 다음 앱이 떠야, App.tsx 의 기존
// OAuth 처리(`?code=` → Supabase 코드 교환)가 카카오가 준 코드를 자기 것으로 착각해
// 실패하는 일이 없다. 콜백이 아닌 보통의 방문은 그대로 즉시 그린다.
if (isKakaoSdkCallback()) {
  completeKakaoSdkLogin()
    .catch((err) => {
      console.error('[main] 카카오 간편로그인 콜백 처리 실패', err);
    })
    .finally(renderApp);
} else {
  renderApp();
}
