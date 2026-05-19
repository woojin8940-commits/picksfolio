
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

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
root.render(
  <React.StrictMode>
    <ErrorBoundary fallback={RootFallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
