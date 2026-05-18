
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
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
            className="bg-purple-600 text-white px-6 py-3 rounded-xl font-black text-sm hover:bg-purple-700 transition-all"
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
