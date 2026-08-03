
import { Component, ErrorInfo, ReactNode } from 'react';
import {
  attemptChunkReload,
  clearChunkReloadFlag,
  isChunkLoadError,
} from '../utils/chunkReload';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  /** 지연 로딩 청크를 못 받아서 생긴 오류인지. 안내와 복구 버튼이 다르다. */
  isChunkError: boolean;
}

// 청크 판별과 "한 번만 새로고침" 규칙은 App 의 lazyWithRetry 와 같은 규칙을 써야
// 한다. 예전에는 양쪽에 같은 코드가 따로 있어서 한쪽만 고쳐지곤 했다.
export { clearChunkReloadFlag };

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    isChunkError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, isChunkError: isChunkLoadError(error) };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    // 배포 갱신으로 청크가 사라진 경우는 새 매니페스트를 받아오면 해결된다.
    // 쿨다운 안이면(방금 새로고침했으면) 아래 안내 화면으로 떨어진다.
    if (isChunkLoadError(error)) {
      attemptChunkReload();
    }
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      // 청크 오류는 데이터 문제가 아니다. localStorage 를 지우면 로그인까지
      // 풀려 버리므로, 새로고침만 다시 시도하게 한다.
      if (this.state.isChunkError) {
        return (
          <div className="min-h-[400px] flex flex-col items-center justify-center p-10 text-center bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 m-4">
            <div className="text-4xl mb-4">🔄</div>
            <h2 className="text-xl font-black text-slate-900 mb-2">화면을 불러오지 못했습니다.</h2>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">
              앱이 업데이트되었거나 네트워크가 불안정할 때 생길 수 있어요.
              <br />
              다시 시도하면 최신 버전을 받아옵니다.
            </p>
            <button
              onClick={() => {
                // 사용자가 직접 눌렀으니 자동 회복 기록을 비워 준다.
                clearChunkReloadFlag();
                window.location.reload();
              }}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-blue-700 transition-all"
            >
              다시 시도
            </button>
          </div>
        );
      }

      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-10 text-center bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 m-4">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-slate-900 mb-2">화면을 불러오는 중 오류가 발생했습니다.</h2>
          <p className="text-slate-500 text-sm mb-6">데이터 형식이 올바르지 않거나 일시적인 오류일 수 있습니다.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-blue-700 transition-all"
            >
              새로고침
            </button>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="bg-white text-slate-600 border border-slate-200 px-6 py-3 rounded-xl font-black text-sm hover:bg-slate-100 transition-all"
            >
              데이터 초기화 후 새로고침
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
