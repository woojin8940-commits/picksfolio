
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

// A failed dynamic import() (lazy-loaded route chunk) is the most common cause
// of an intermittent full-screen crash here: after a new deploy the hashed
// chunk filenames in the user's cached manifest no longer exist, and in-app
// WebViews (KakaoTalk/Naver/Instagram) drop chunk requests on flaky networks.
// These errors surface with recognizable names/messages — detect them so we can
// self-heal with a one-time reload instead of stranding the user on the error
// screen.
const isChunkLoadError = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name || '';
  const message = (error as { message?: string })?.message || '';
  return (
    name === 'ChunkLoadError' ||
    /Loading (CSS )?chunk [\d]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /import\(\) failed/i.test(message)
  );
};

// One-time reload guard. A stale chunk is fixed by reloading the page (which
// pulls the fresh manifest), but we must never loop: the flag is set before the
// reload and cleared once the app mounts successfully (see clearChunkReloadFlag).
const CHUNK_RELOAD_KEY = 'picks_chunk_reload';

export const clearChunkReloadFlag = () => {
  try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch {}
};

const tryRecoverFromChunkError = (): boolean => {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false; // Already reloaded once
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    window.location.reload();
    return true;
  } catch {
    return false;
  }
};

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    // Auto-recover from stale-chunk / dynamic-import failures: reload once so the
    // fresh asset manifest is fetched. Falls through to the fallback UI if we've
    // already retried this session (prevents reload loops).
    if (isChunkLoadError(error)) {
      tryRecoverFromChunkError();
    }
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-10 text-center bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 m-4">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-slate-900 mb-2">화면을 불러오는 중 오류가 발생했습니다.</h2>
          <p className="text-slate-500 text-sm mb-6">데이터 형식이 올바르지 않거나 일시적인 오류일 수 있습니다.</p>
          <button 
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-blue-700 transition-all"
          >
            데이터 초기화 후 새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
